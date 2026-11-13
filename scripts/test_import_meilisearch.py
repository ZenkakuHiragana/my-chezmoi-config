"""Pi・ChatGPT の会話を Meilisearch へ取り込むスクリプトの検査。外部サーバーには接続しない。"""

import argparse
from contextlib import redirect_stderr, redirect_stdout
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import URLError
import zipfile

import import_chatgpt_meilisearch as chatgpt
import import_pi_meilisearch as pi
import meilisearch_conversations as common


class TemporaryTestCase(unittest.TestCase):
    def setUp(self):
        work = Path('.opencode/work/meilisearch-import/tests')
        work.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=work)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)


def write_jsonl(path, entries):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(e, ensure_ascii=False) + '\n' for e in entries), encoding='utf-8')


def message(entry_id, parent, role, content, timestamp='2026-11-13T00:00:00.000Z'):
    return {'type': 'message', 'id': entry_id, 'parentId': parent, 'timestamp': timestamp, 'message': {'role': role, 'content': content}}


PI_SESSION = [
    {'type': 'session', 'version': 3, 'id': 'session-1', 'timestamp': '2026-11-13T00:00:00.000Z', 'cwd': 'C:\\Work\\repo'},
    {'type': 'model_change', 'id': 'm1', 'parentId': None},
    message('u1', 'm1', 'user', [{'type': 'text', 'text': '最初の質問'}], '2026-11-13T01:02:03.456Z'),
    {'type': 'custom_message', 'id': 'c1', 'parentId': 'u1', 'customType': 'hindsight', 'content': '差し込まれた記憶'},
    message('a1', 'c1', 'assistant', [{'type': 'thinking', 'thinking': '考え中'}, {'type': 'text', 'text': '確認するね'},
                                      {'type': 'toolCall', 'name': 'bash', 'arguments': {'command': 'ls'}}]),
    message('t1', 'a1', 'toolResult', [{'type': 'text', 'text': 'ツールの出力'}]),
    message('a2', 't1', 'assistant', [{'type': 'text', 'text': '結論です'}]),
    message('a3', 'u1', 'assistant', [{'type': 'text', 'text': '別の枝の返答'}]),
    {'type': 'session_info', 'id': 'i1', 'parentId': 'a2', 'name': '古い名前'},
    {'type': 'session_info', 'id': 'i2', 'parentId': 'i1', 'name': 'セッション名'},
    message('u2', 'i2', 'user', '二つ目の質問'),
    message('a4', 'u2', 'assistant', [{'type': 'thinking', 'thinking': '思考だけ'}]),
    message('u3', 'a4', 'user', [{'type': 'text', 'text': '三つ目'}]),
    message('a5', 'u3', 'assistant', [{'type': 'text', 'text': '三つ目への返答'}]),
]


class PiTests(TemporaryTestCase):
    def setUp(self):
        super().setUp()
        self.sessions = self.root / 'sessions'
        self.session = self.sessions / '--C--Work-repo--' / '2026-11-13_session-1.jsonl'
        write_jsonl(self.session, PI_SESSION)
        self.nested = self.sessions / '--C--Work-repo--' / '2026-11-13_session-1' / 'sub-1' / 'run-0' / 'session.jsonl'
        write_jsonl(self.nested, [{'type': 'session', 'id': 'sub-1', 'cwd': 'C:\\Work\\repo'},
                                  {'type': 'session_info', 'id': 'x', 'parentId': None, 'name': 'subagent-general-fast-1'},
                                  message('su', 'x', 'user', 'サブエージェントへの依頼'), message('sa', 'su', 'assistant', 'サブエージェントの返答')])
        self.artifact = self.sessions / '--C--Work-repo--' / 'subagent-artifacts' / 'sub-2_transcript.jsonl'
        write_jsonl(self.artifact, [message('su', None, 'user', '成果物')])
        self.headerless = self.sessions / '--C--Work-repo--' / 'no-header.jsonl'
        write_jsonl(self.headerless, [message('u', None, 'user', '見出しなし')])

    def test_default_scan_reads_only_top_level_sessions(self):
        found = [(path.name, error) for path, error in pi.iter_session_files([], self.sessions)]
        self.assertEqual(found, [('2026-11-13_session-1.jsonl', None), ('no-header.jsonl', None)])

    def test_explicit_subagent_session_is_rejected(self):
        [(path, error)] = list(pi.iter_session_files([self.nested], self.sessions))
        self.assertIsNotNone(error)
        [(path, error)] = list(pi.iter_session_files([self.session], self.sessions))
        self.assertIsNone(error)

    def test_turns_join_assistant_text_and_drop_everything_else(self):
        documents = pi.convert_session(self.session)
        self.assertEqual([d['message_id'] for d in documents], ['u1', 'u3'])
        first = documents[0]
        self.assertEqual(first['question'], '最初の質問')
        self.assertEqual(first['reply'], '確認するね\n\n結論です\n\n別の枝の返答')
        self.assertEqual(first['id'], 'pi_session-1_u1')
        self.assertEqual(first['timestamp'], 1794531723456)  # calendar.timegm((2026, 11, 13, 1, 2, 3)) * 1000 + 456
        self.assertEqual(first['cwd'], 'C:\\Work\\repo')
        self.assertEqual(first['title'], 'セッション名')
        self.assertEqual(first['source'], 'pi')
        self.assertEqual(first['conversation_id'], 'session-1')
        self.assertEqual(first['source_path'], str(self.session.resolve()))
        for text in ('考え中', 'ツールの出力', '差し込まれた記憶', 'ls'):
            self.assertNotIn(text, first['reply'])

    def test_headerless_file_is_skipped(self):
        self.assertIsNone(pi.convert_session(self.headerless))

    def test_partial_last_line_is_ignored(self):
        with self.session.open('a', encoding='utf-8') as file:
            file.write('{"type": "message", "id": "u9"')
        self.assertEqual(len(pi.convert_session(self.session)), 2)

    def test_broken_middle_line_fails_only_that_session(self):
        broken = self.sessions / '--C--Work-repo--' / '2026-11-12_broken.jsonl'
        lines = [json.dumps(e, ensure_ascii=False) for e in PI_SESSION]
        broken.write_text('\n'.join(lines[:3] + ['{not json'] + lines[3:]) + '\n', encoding='utf-8')
        result = {Path(b.label).name: b for b in pi.batches([], self.sessions)}
        self.assertIn('4 行目', result['2026-11-12_broken.jsonl'].error)
        self.assertEqual(len(result['2026-11-13_session-1.jsonl'].documents), 2)

    def test_malformed_entry_fails_only_that_session(self):
        malformed = self.sessions / '--C--Work-repo--' / '2026-11-12_malformed.jsonl'
        write_jsonl(malformed, [PI_SESSION[0], message('u', None, 'user', '質問'), {'type': 'message', 'id': ['not', 'hashable'], 'parentId': 'u'}])
        result = {Path(b.label).name: b for b in pi.batches([], self.sessions)}
        self.assertIsNotNone(result['2026-11-12_malformed.jsonl'].error)
        self.assertEqual(len(result['2026-11-13_session-1.jsonl'].documents), 2)

    def test_missing_sessions_folder_is_a_failure(self):
        [batch] = list(pi.batches([], self.root / 'missing'))
        self.assertIsNotNone(batch.error)

    def test_last_line_cut_inside_a_character_is_ignored(self):
        with self.session.open('ab') as file:
            file.write('{"type": "message", "text": "日本'.encode('utf-8')[:-1])
        self.assertEqual(len(pi.convert_session(self.session)), 2)

    def test_complete_line_with_invalid_utf8_is_a_failure(self):
        with self.session.open('ab') as file:
            file.write(b'{"type": "message", "text": "\xff"}\n')
        with self.assertRaises(ValueError):
            pi.convert_session(self.session)

    def test_type_check_errors_become_undetermined(self):
        class Entry:
            def is_dir(self):
                raise PermissionError('denied')

        self.assertIsNone(pi.is_dir(Entry()))

    def test_explicit_non_jsonl_file_is_rejected(self):
        other = self.session.with_suffix('.txt')
        other.write_text('x', encoding='utf-8')
        [(path, error)] = list(pi.iter_session_files([other], self.sessions))
        self.assertIsNotNone(error)

    def test_command_process_exit_code(self):
        home = self.root / 'home'
        session = home / '.pi' / 'agent' / 'sessions' / 'work' / 's.jsonl'
        write_jsonl(session, PI_SESSION)
        script = Path(__file__).resolve().parent / 'import_pi_meilisearch.py'
        env = {**os.environ, 'USERPROFILE': str(home), 'HOME': str(home)}

        def run_command(*arguments):
            # --meili-url uses the reserved .invalid domain, so even a broken --dry-run cannot reach a real server.
            result = subprocess.run([sys.executable, '-B', str(script), *arguments, '--dry-run', '--meili-url', 'http://meilisearch.invalid'],
                                    capture_output=True, env=env)
            return result.returncode, json.loads(result.stdout.decode('utf-8', 'replace').splitlines()[-1])

        code, summary = run_command()
        self.assertEqual((code, summary['documents'], summary['failed']), (0, 2, []))
        code, summary = run_command(str(session), str(self.nested))  # the nested subagent session is rejected
        self.assertEqual((code, summary['documents'], len(summary['failed'])), (1, 2, 1))

    def test_complete_but_broken_last_line_is_a_failure(self):
        with self.session.open('a', encoding='utf-8') as file:
            file.write('{broken}\n')
        with self.assertRaises(ValueError):
            pi.convert_session(self.session)

    def test_unreadable_work_folder_is_reported(self):
        other = self.sessions / '--D--other--'
        write_jsonl(other / 's.jsonl', PI_SESSION)
        real_scandir = pi.os.scandir

        def scandir(path):
            if Path(path) == other:
                raise PermissionError('denied')
            return real_scandir(path)

        with patch.object(pi.os, 'scandir', scandir):
            result = list(pi.batches([], self.sessions))
        self.assertEqual([b.label for b in result if b.error], [str(other)])
        self.assertTrue(any(b.documents for b in result))

    def test_unreadable_sessions_folder_is_reported(self):
        def scandir(path):
            raise PermissionError('denied')

        with patch.object(pi.os, 'scandir', scandir):
            [batch] = list(pi.batches([], self.sessions))
        self.assertIn('フォルダを読めない', batch.error)

    def test_undeterminable_entry_does_not_stop_the_scan(self):
        real_is_dir = pi.is_dir

        def is_dir(entry):
            return None if entry.name == '--C--Work-repo--' else real_is_dir(entry)

        other = self.sessions / '--D--other--'
        write_jsonl(other / 's.jsonl', PI_SESSION)
        with patch.object(pi, 'is_dir', is_dir):
            names = [Path(b.label).name for b in pi.batches([], self.sessions) if b.documents]
        self.assertEqual(names, ['2026-11-13_session-1.jsonl', 's.jsonl'])  # both folders are still read

        def is_dir_for_files(entry):
            return None if entry.name.endswith('.jsonl') else real_is_dir(entry)

        with patch.object(pi, 'is_dir', is_dir_for_files):
            names = [Path(b.label).name for b in pi.batches([], self.sessions) if b.documents]
        self.assertEqual(names, ['2026-11-13_session-1.jsonl', 's.jsonl'])  # undeterminable files are still read

    def test_unresolvable_argument_does_not_stop_the_others(self):
        real_resolve = Path.resolve

        def resolve(path, *args, **kwargs):
            if path.name == 'locked.jsonl':
                raise PermissionError('denied')
            return real_resolve(path, *args, **kwargs)

        with patch.object(Path, 'resolve', resolve):
            result = list(pi.batches([self.sessions / 'x' / 'locked.jsonl', self.session], self.sessions))
        self.assertIsNotNone(result[0].error)
        self.assertEqual(len(result[1].documents), 2)

    def test_forked_session_keeps_its_own_ids(self):
        # A fork copies its parent's entries; each session keeps its own ids (documented duplicate).
        fork = self.sessions / '--C--Work-repo--' / '2026-11-14_fork.jsonl'
        write_jsonl(fork, [{**PI_SESSION[0], 'id': 'session-2', 'parentSession': str(self.session)}] + PI_SESSION[1:])
        original, copied = pi.convert_session(self.session), pi.convert_session(fork)
        self.assertEqual([d['id'] for d in copied], ['pi_session-2_u1', 'pi_session-2_u3'])
        self.assertEqual([d['reply'] for d in copied], [d['reply'] for d in original])

    def test_reply_follows_parent_not_file_order(self):
        session = self.sessions / '--C--Work-repo--' / 'order.jsonl'
        write_jsonl(session, [PI_SESSION[0], message('A', None, 'user', 'A の質問'), message('B', 'A', 'user', 'B の質問'),
                              message('rb', 'B', 'assistant', 'B への返答'), message('ra', 'A', 'assistant', 'A への返答')])
        documents = {d['message_id']: d['reply'] for d in pi.convert_session(session)}
        self.assertEqual(documents, {'A': 'A への返答', 'B': 'B への返答'})

    def test_batches_report_rejected_and_skipped_files(self):
        result = list(pi.batches([self.session, self.nested, self.headerless], self.sessions))
        self.assertEqual(len(result[0].documents), 2)
        self.assertIsNotNone(result[1].error)
        self.assertIsNone(result[2].error)  # top-level location is accepted, then skipped for lacking a header
        self.assertTrue(result[2].skipped)


def node(node_id, parent, role=None, text=None, **extra):
    msg = None
    if role is not None:
        content = extra.pop('content', {'content_type': 'text', 'parts': [text]})
        msg = {'id': node_id, 'author': {'role': role}, 'create_time': extra.pop('create_time', 1790000000.5), 'content': content}
        msg.update(extra)
    return {'id': node_id, 'parent': parent, 'message': msg}


def conversation(conversation_id='conv-1', title='会話タイトル', update_time=100.0):
    nodes = [
        node('root', None),
        node('u1', 'root', 'user', '質問'),
        node('a1', 'u1', 'assistant', '回答その1'),
        node('tool', 'a1', 'assistant', 'print(1)', recipient='python', content={'content_type': 'code', 'text': 'print(1)'}),
        node('think', 'tool', 'assistant', None, content={'content_type': 'thoughts', 'thoughts': []}),
        node('hidden', 'think', 'assistant', '隠れた発言', metadata={'is_visually_hidden_from_conversation': True}),
        node('ctx', 'hidden', 'assistant', '文脈用の発言', metadata={'is_contextual_answers_system_message': True}),
        node('analysis', 'ctx', 'assistant', '分析チャネルの文章', channel='analysis'),
        node('a2', 'analysis', 'assistant', None, content={'content_type': 'multimodal_text', 'parts': [{'content_type': 'image_asset_pointer'}, '回答その2', {'text': '部品の文字'}]}),
        node('other', 'a2', 'assistant', '選ばれていない枝'),
        node('u2', 'a2', 'user', None, content={'content_type': 'multimodal_text', 'parts': [{'content_type': 'image_asset_pointer'}]}),
        node('a3', 'u2', 'assistant', '画像への回答'),
        node('u3', 'a3', 'user', '未回答の質問'),
    ]
    return {'conversation_id': conversation_id, 'title': title, 'update_time': update_time, 'current_node': 'u3',
            'mapping': {n['id']: n for n in nodes}}


class ChatGPTTests(TemporaryTestCase):
    def write_folder(self, folder, conv):
        path = folder / 'conv' / 'conversation.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(conv, ensure_ascii=False), encoding='utf-8')
        return path

    def write_zip(self, path, members, project='プロジェクト'):
        with zipfile.ZipFile(path, 'w') as archive:
            if project is not None:
                archive.writestr('backup-manifest.json', json.dumps({'projectName': project}, ensure_ascii=False))
            for name, data in members.items():
                archive.writestr(name, data)
        return path

    def test_turns_follow_current_branch_and_visible_text(self):
        documents = chatgpt.convert_conversation(conversation(), chatgpt.Origin('C:/x/conversation.json'))
        self.assertEqual([d['message_id'] for d in documents], ['u1', 'u2'])
        first, second = documents
        self.assertEqual(first['question'], '質問')
        self.assertEqual(first['reply'], '回答その1\n\n回答その2\n部品の文字')
        self.assertEqual(second['question'], '')
        self.assertEqual(second['reply'], '画像への回答')
        self.assertEqual(first['id'], 'chatgpt_conv-1_u1')
        self.assertEqual(first['source'], 'chatgpt')
        self.assertEqual(first['conversation_id'], 'conv-1')
        self.assertEqual(first['timestamp'], 1790000000500)
        self.assertEqual(first['title'], '会話タイトル')
        self.assertNotIn('source_member', first)
        self.assertNotIn('project', first)

    def test_zip_and_folder_select_newest_export_and_continue_after_broken_member(self):
        folder = self.root / 'folder'
        self.write_folder(folder, conversation(title='古い', update_time=100.0))
        archive = self.write_zip(self.root / 'backup.zip', {
            'p/new/conversation.json': json.dumps(conversation(title='新しい', update_time=200.0), ensure_ascii=False),
            'p/broken/conversation.json': '{not json',
            'p/other/conversation.json': json.dumps(conversation('conv-2'), ensure_ascii=False),
        })
        result = list(chatgpt.batches([folder, archive, self.root / 'missing.zip']))
        errors = [b for b in result if b.error]
        self.assertEqual(len(errors), 2)  # broken member and missing input
        imported = {b.documents[0]['conversation_id']: b.documents[0] for b in result if b.documents}
        self.assertEqual(imported['conv-1']['title'], '新しい')
        self.assertEqual(imported['conv-1']['source_member'], 'p/new/conversation.json')
        self.assertEqual(imported['conv-1']['project'], 'プロジェクト')
        self.assertEqual(imported['conv-1']['source_path'], str(archive.resolve()))
        self.assertIn('conv-2', imported)

    def test_branch_falls_back_to_latest_leaf_and_accepts_array_mapping(self):
        # currentBranch() in the extractor userscript falls back to the newest leaf and accepts arrays.
        conv = conversation()
        del conv['current_node']
        conv['mapping']['other']['message']['create_time'] = 1790000001.0  # newest leaf
        documents = chatgpt.convert_conversation(conv, chatgpt.Origin('x'))
        self.assertEqual(documents[0]['reply'], '回答その1\n\n回答その2\n部品の文字\n\n選ばれていない枝')
        array_form = conversation()
        array_form['mapping'] = list(array_form['mapping'].values())
        self.assertEqual(chatgpt.convert_conversation(array_form, chatgpt.Origin('x')),
                         chatgpt.convert_conversation(conversation(), chatgpt.Origin('x')))

    def test_malformed_conversation_fails_only_itself(self):
        malformed = conversation('conv-3')
        malformed['mapping']['a1']['message']['metadata'] = None
        self.write_folder(self.root / 'a', malformed)
        self.write_folder(self.root / 'b', conversation('conv-4'))
        result = list(chatgpt.batches([self.root / 'a', self.root / 'b']))
        self.assertIsNotNone(result[0].error)
        self.assertEqual(result[1].documents[0]['conversation_id'], 'conv-4')

    def test_duplicate_selection_falls_back_to_create_time_then_export_time_then_order(self):
        def write(folder, **times):
            conv = conversation(title=folder)
            conv.pop('update_time')
            conv.update(times)
            self.write_folder(self.root / folder, conv)
            return self.root / folder

        def chosen(*folders):
            [batch] = list(chatgpt.batches(list(folders)))
            return batch.documents[0]['title']

        self.assertEqual(chosen(write('a', update_time=100.0), write('b', create_time=200.0)), 'b')
        self.assertEqual(chosen(write('c', update_time=0, create_time=300.0), write('d', update_time=250.0)), 'c')
        self.assertEqual(chosen(write('e', update_time=100.0, __local_exported_at=1.0), write('f', update_time=100.0, __local_exported_at=2.0)), 'f')
        self.assertEqual(chosen(write('g', update_time=100.0), write('h', update_time=100.0)), 'g')
        self.assertEqual(chosen(write('i', update_time='NaN', create_time=400.0), write('j', update_time=350.0)), 'i')
        same_input = self.root / 'same'
        for name in ('b-second', 'a-first'):
            conv = conversation(title=name)
            path = same_input / name / 'conversation.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(conv, ensure_ascii=False), encoding='utf-8')
        self.assertEqual(chosen(same_input), 'a-first')  # tie inside one input: path order

    def test_current_node_missing_from_mapping_falls_back_to_latest_leaf(self):
        conv = conversation()
        conv['current_node'] = 'gone'
        conv['mapping']['other']['message']['create_time'] = 1790000001.0
        self.assertEqual(chatgpt.current_branch(conv)[-1]['id'], 'other')

    def test_latest_leaf_uses_numeric_create_time_like_the_userscript(self):
        conv = conversation()
        del conv['current_node']
        conv['mapping']['u3']['message']['create_time'] = '100'
        conv['mapping']['other']['message']['create_time'] = '200'  # Number('200') > Number('100')
        self.assertEqual(chatgpt.current_branch(conv)[-1]['id'], 'other')

    def test_missing_mapping_is_a_failure(self):
        self.write_folder(self.root / 'a', {'conversation_id': 'conv-5', 'mapping': None})
        [batch] = list(chatgpt.batches([self.root / 'a']))
        self.assertIsNotNone(batch.error)

    def test_unreadable_archive_or_folder_does_not_stop_other_inputs(self):
        archive = self.write_zip(self.root / 'backup.zip', {'c/conversation.json': json.dumps(conversation('conv-6'))})
        self.write_folder(self.root / 'folder', conversation('conv-7'))
        real_zipfile = zipfile.ZipFile

        def broken_zip(path, *args, **kwargs):
            if Path(path) == archive.resolve():
                raise RuntimeError('encrypted')
            return real_zipfile(path, *args, **kwargs)

        with patch.object(chatgpt.zipfile, 'ZipFile', broken_zip):
            result = list(chatgpt.batches([archive, self.root / 'folder']))
        self.assertIsNotNone(result[0].error)
        self.assertEqual(result[1].documents[0]['conversation_id'], 'conv-7')

        real_read = zipfile.ZipFile.read

        def read(self_, name, *args, **kwargs):
            if name == 'backup-manifest.json':
                raise NotImplementedError('compression type')
            return real_read(self_, name, *args, **kwargs)

        with patch.object(zipfile.ZipFile, 'read', read):
            manifest, batch = list(chatgpt.batches([archive]))
        self.assertIn('backup-manifest.json', manifest.label)
        self.assertIsNotNone(manifest.error)
        self.assertEqual(batch.documents[0]['conversation_id'], 'conv-6')
        self.assertNotIn('project', batch.documents[0])

        real_walk = chatgpt.os.walk

        def walk(top, onerror=None):
            onerror(PermissionError(13, 'denied', str(Path(top) / 'locked')))
            return real_walk(top, onerror=onerror)

        with patch.object(chatgpt.os, 'walk', walk):
            result = list(chatgpt.batches([self.root / 'folder']))
        self.assertIn('locked', result[0].label)
        self.assertEqual(result[1].documents[0]['conversation_id'], 'conv-7')

    def test_input_without_conversations_is_a_failure(self):
        (self.root / 'empty').mkdir()
        archive = self.write_zip(self.root / 'empty.zip', {'other.txt': 'x'})
        self.assertEqual([b.error is not None for b in chatgpt.batches([self.root / 'empty', archive])], [True, True])


class FakeClient(common.MeilisearchClient):
    """Fake Meilisearch. Each task reports 'enqueued' and 'processing' before finishing."""

    def __init__(self, fail_documents=(), index_exists=False, unreachable=False, status_error_for=None, cut_off_for=None):
        super().__init__('http://fake', poll_seconds=0)
        self.calls = []
        self.bodies = []
        self.finished = {}  # task uid -> index in calls of the GET that reported the final state
        self.fail_documents = set(fail_documents)
        self.index_exists = index_exists
        self.unreachable = unreachable
        self.status_error_for = status_error_for
        self.cut_off_for = cut_off_for
        self.tasks = {}

    def request(self, method, path, body=None):
        if self.unreachable:
            raise URLError('connection refused')
        if body is not None:
            json.dumps(body, ensure_ascii=False).encode('utf-8')  # encodes like the real client
        self.calls.append((method, path))
        if body is not None:
            self.bodies.append((path, json.loads(json.dumps(body))))
        if method == 'GET' and path.startswith('/tasks/'):
            uid = int(path.rsplit('/', 1)[1])
            if uid == self.status_error_for:
                raise common.MeiliError('HTTP 503: unavailable', 503)
            if uid == self.cut_off_for:
                raise IncompleteRead(b'{"sta')
            states = self.tasks[uid]
            if len(states) == 1:
                self.finished.setdefault(uid, len(self.calls) - 1)
            return states.pop(0) if len(states) > 1 else states[0]
        if method == 'GET' and path.startswith('/indexes/'):
            if not self.index_exists:
                raise common.MeiliError('HTTP 404: not found', 404)
            return {}
        if method == 'PATCH' and path == '/experimental-features':
            return {}
        uid = len(self.tasks)
        failed = path.endswith('/documents') and any(d['id'] in self.fail_documents for d in body)
        final = {'status': 'failed', 'error': {'message': 'embedding failed'}} if failed else {'status': 'succeeded'}
        self.tasks[uid] = [{'status': 'enqueued'}, {'status': 'processing'}, final]
        return {'taskUid': uid}


def args(dry_run=False):
    return argparse.Namespace(meili_url='http://fake', index='conversations', embedder_url='http://embed', dry_run=dry_run)


def run_quietly(*a, **k):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = common.run(*a, **k)
    return code, json.loads(out.getvalue().splitlines()[-1]), err.getvalue()


class RunTests(unittest.TestCase):
    def batches(self):
        return [common.Batch('one', [{'id': 'a'}]), common.Batch('two', [{'id': 'bad'}]), common.Batch('three', error='読めない'),
                common.Batch('four', skipped=True), common.Batch('five', [{'id': 'c'}, {'id': 'd'}])]

    def test_prepares_index_then_sends_each_conversation_and_reports_failures(self):
        client = FakeClient(fail_documents={'bad'})
        code, summary, err = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 1)
        self.assertEqual(summary['conversations'], 2)
        self.assertEqual(summary['documents'], 3)
        self.assertEqual(summary['skipped'], 1)
        self.assertEqual([f['label'] for f in summary['failed']], ['two', 'three'])
        self.assertEqual(summary['failed'][0]['task'], 3)  # tasks: 0 index, 1 settings, 2 'one', 3 'two', 4 'five'
        self.assertIn('embedding failed', err)
        writes = [c for c in client.calls if c[0] != 'GET']
        self.assertEqual(writes[:3], [('PATCH', '/experimental-features'), ('POST', '/indexes'), ('PATCH', '/indexes/conversations/settings')])
        self.assertIn(('/indexes', {'uid': 'conversations', 'primaryKey': 'id'}), client.bodies)
        self.assertEqual(writes[3:], [('POST', '/indexes/conversations/documents')] * 3)
        # Every task is polled until it finishes before the next write is sent, the last one too.
        write_positions = [i for i, call in enumerate(client.calls) if call[0] != 'GET']
        for task_uid, position in zip(range(5), write_positions[2:]):
            self.assertLess(client.finished[task_uid], position)
        self.assertIn(4, client.finished)
        self.assertIn(('/experimental-features', {'multimodal': True}), client.bodies)
        self.assertEqual(client.calls.count(('GET', '/tasks/3')), 3)
        # The settings actually sent are the ones make_settings() builds.
        self.assertIn(('/indexes/conversations/settings', common.make_settings('http://embed')), client.bodies)

    def test_unencodable_document_fails_only_its_conversation(self):
        batches = [common.Batch('bad', [{'id': 'a', 'question': '\ud800'}]), common.Batch('good', [{'id': 'b'}])]
        code, summary, _ = run_quietly(args(), batches, FakeClient())
        self.assertEqual(code, 1)
        self.assertEqual([f['label'] for f in summary['failed']], ['bad'])
        self.assertEqual(summary['conversations'], 1)

    def test_rejected_document_fails_but_server_error_aborts(self):
        client = FakeClient()
        real_request = client.request

        def request(method, path, body=None):
            if path.endswith('/documents') and body[0]['id'] == 'bad':
                raise common.MeiliError('HTTP 400: invalid document id', 400)
            if path.endswith('/documents') and body[0]['id'] == 'slow':
                raise common.MeiliError('HTTP 504: gateway timeout', 504)
            return real_request(method, path, body)

        client.request = request
        batches = [common.Batch('bad', [{'id': 'bad'}]), common.Batch('good', [{'id': 'a'}]),
                   common.Batch('slow', [{'id': 'slow'}]), common.Batch('after', [{'id': 'b'}])]
        code, summary, err = run_quietly(args(), batches, client)
        self.assertEqual(code, 2)
        self.assertEqual([f['label'] for f in summary['failed']], ['bad'])
        self.assertEqual(summary['conversations'], 1)
        self.assertIn('aborted during slow', err)

    def test_failed_preparation_aborts_before_sending(self):
        for failing_path, label in (('/indexes', 'create index conversations task=0'), ('/indexes/conversations/settings', 'settings conversations task=1')):
            client = FakeClient()
            real_request = client.request

            def request(method, path, body=None, client=client, real_request=real_request, failing_path=failing_path):
                response = real_request(method, path, body)
                if path == failing_path and method != 'GET':
                    client.tasks[response['taskUid']] = [{'status': 'failed', 'error': {'message': 'rejected'}}]
                return response

            client.request = request
            code, summary, err = run_quietly(args(), self.batches(), client)
            self.assertEqual(code, 2)
            self.assertIn(label, err)
            self.assertNotIn(('POST', '/indexes/conversations/documents'), client.calls)

    def test_task_response_without_uid_aborts_and_odd_error_is_reported(self):
        client = FakeClient()
        real_request = client.request
        client.request = lambda method, path, body=None: {} if path.endswith('/documents') else real_request(method, path, body)
        code, _, err = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 2)
        self.assertIn('taskUid', err)

        client = FakeClient(fail_documents={'bad'})
        real_request2 = client.request

        def request(method, path, body=None):
            response = real_request2(method, path, body)
            if path == '/tasks/3':
                return {'status': 'failed', 'error': 'unexpected'}
            return response

        client.request = request
        code, summary, _ = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 1)
        self.assertEqual(summary['failed'][0], {'label': 'two', 'error': 'unexpected', 'task': 3})

    def test_unexpected_task_response_aborts(self):
        for response in ({'status': 'unknown'}, {}, ['not', 'a', 'task']):
            client = FakeClient()
            real_request = client.request

            def request(method, path, body=None, response=response):
                return response if path == '/tasks/2' else real_request(method, path, body)

            client.request = request
            code, _, err = run_quietly(args(), self.batches(), client)
            self.assertEqual(code, 2, response)
            self.assertIn('one task=2', err)

    def test_cut_off_response_aborts(self):
        code, summary, err = run_quietly(args(), self.batches(), FakeClient(cut_off_for=2))
        self.assertEqual(code, 2)
        self.assertIn('one task=2', err)

    def test_unknown_task_outcome_aborts_instead_of_moving_on(self):
        client = FakeClient(status_error_for=2)
        code, summary, err = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 2)
        self.assertEqual(summary['failed'], [])
        self.assertIn('one task=2', err)
        self.assertEqual(client.calls.count(('POST', '/indexes/conversations/documents')), 1)

    def test_converted_documents_are_sent_unchanged(self):
        work = Path('.opencode/work/meilisearch-import/tests')
        work.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=work) as temporary:
            session = Path(temporary) / 'sessions' / 'work' / 's.jsonl'
            write_jsonl(session, PI_SESSION)
            expected = pi.convert_session(session)
            client = FakeClient()
            code, summary, _ = run_quietly(args(), pi.batches([], session.parent.parent), client)
        self.assertEqual(code, 0)
        self.assertEqual([body for path, body in client.bodies if path.endswith('/documents')], [expected])

    def test_existing_index_is_not_recreated(self):
        client = FakeClient(index_exists=True)
        code, _, _ = run_quietly(args(), [common.Batch('one', [{'id': 'a'}])], client)
        self.assertEqual(code, 0)
        self.assertNotIn(('POST', '/indexes'), client.calls)

    def test_unreachable_meilisearch_aborts_before_sending(self):
        code, summary, err = run_quietly(args(), self.batches(), FakeClient(unreachable=True))
        self.assertEqual(code, 2)
        self.assertEqual(summary['conversations'], 0)
        self.assertIn('aborted', err)

    def test_dry_run_never_touches_the_client(self):
        client = FakeClient(unreachable=True)
        code, summary, _ = run_quietly(args(dry_run=True), self.batches(), client)
        self.assertEqual(code, 1)  # the unreadable batch is still a failure
        self.assertEqual(summary['documents'], 4)

    def test_settings_contract(self):
        settings = common.make_settings('http://embed')
        self.assertEqual(set(settings['searchableAttributes']), {'question', 'reply', 'title'})
        self.assertTrue({'source', 'cwd', 'conversation_id', 'project', 'timestamp'} <= set(settings['filterableAttributes']))
        self.assertIn('timestamp', settings['sortableAttributes'])
        embedder = settings['embedders']['ruri']
        self.assertEqual(embedder['source'], 'rest')
        self.assertEqual(embedder['url'], 'http://embed')
        self.assertEqual(embedder['dimensions'], 768)
        self.assertEqual(embedder['request'], {'model': 'ruri-v3-310m:q8_0', 'input': ['{{fragment}}', '{{..}}']})
        self.assertEqual(embedder['response'], {'embeddings': ['{{embedding}}', '{{..}}']})
        self.assertEqual(embedder['searchFragments'], {'query': {'value': '検索クエリ: {{q}}'}})
        self.assertEqual(embedder['indexingFragments'], {'doc': {
            'value': '検索文書: {{ doc.reply | truncate: 12000 }}\n\n{{ doc.question | truncate: 2000 }}'}})


class HttpClientTests(unittest.TestCase):
    """MeilisearchClient against a local HTTP server: encoding, paths and errors."""

    def setUp(self):
        received = self.received = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers['Content-Length'])
                received.append((self.command, self.path, self.headers['Content-Type'], json.loads(self.rfile.read(length).decode('utf-8'))))
                self.reply(202, {'taskUid': 7})

            def do_PATCH(self):
                length = int(self.headers['Content-Length'])
                received.append((self.command, self.path, self.headers['Content-Type'], json.loads(self.rfile.read(length).decode('utf-8'))))
                self.reply(202, {'taskUid': 8})

            def do_GET(self):
                received.append((self.command, self.path, None, None))
                if self.path == '/garbage':
                    data = b'<html>proxy error</html>'
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                elif self.path == '/indexes/missing':
                    self.reply(404, {'message': 'Index not found'})
                else:
                    self.reply(200, {'status': 'failed', 'error': {'message': 'embedding failed'}})

            def reply(self, status, body):
                data = json.dumps(body).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.client = common.MeilisearchClient(f'http://127.0.0.1:{self.server.server_port}/', poll_seconds=0)

    def test_request_sends_utf8_json_and_parses_the_response(self):
        response = self.client.request('POST', '/indexes/conversations/documents', [{'id': 'a', 'question': '日本語'}])
        self.assertEqual(response, {'taskUid': 7})
        self.assertEqual(self.received, [('POST', '/indexes/conversations/documents', 'application/json', [{'id': 'a', 'question': '日本語'}])])

    def test_non_json_response_is_an_error(self):
        with self.assertRaises(common.MeiliError):
            self.client.request('GET', '/garbage')

    def test_patch_is_sent_as_patch(self):
        self.assertEqual(self.client.request('PATCH', '/indexes/conversations/settings', {'sortableAttributes': ['timestamp']}), {'taskUid': 8})
        self.assertEqual(self.received, [('PATCH', '/indexes/conversations/settings', 'application/json', {'sortableAttributes': ['timestamp']})])

    def test_http_error_and_failed_task_are_distinguished(self):
        with self.assertRaises(common.MeiliError) as raised:
            self.client.request('GET', '/indexes/missing')
        self.assertEqual(raised.exception.status, 404)
        self.assertNotIsInstance(raised.exception, common.TaskFailed)
        self.assertIn('Index not found', str(raised.exception))
        with self.assertRaises(common.TaskFailed):
            self.client.wait_task(7)


class CommandLineTests(TemporaryTestCase):
    def test_pi_command_reads_the_sessions_folder(self):
        sessions = self.root / 'sessions'
        write_jsonl(sessions / 'work' / 's.jsonl', PI_SESSION)
        out = io.StringIO()
        with patch.object(pi, 'SESSIONS_ROOT', sessions), redirect_stdout(out):
            code = pi.main(['--dry-run'])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue().splitlines()[-1])['documents'], 2)

    def test_command_process_survives_legacy_console_encoding(self):
        # The label contains '·', which cp932 cannot encode (a real conversation folder name).
        folder = self.root / 'in' / '枝分かれ · スキル_1'
        folder.mkdir(parents=True)
        (folder / 'conversation.json').write_text(json.dumps(conversation()), encoding='utf-8')
        broken = self.root / 'in' / '壊れた · 会話'
        broken.mkdir()
        (broken / 'conversation.json').write_text('{not json', encoding='utf-8')
        script = Path(__file__).resolve().parent / 'import_chatgpt_meilisearch.py'
        result = subprocess.run([sys.executable, '-B', str(script), str(self.root / 'in'), '--dry-run', '--meili-url', 'http://meilisearch.invalid'],
                                capture_output=True, env={**os.environ, 'PYTHONIOENCODING': 'cp932', 'PYTHONUTF8': '0'})
        self.assertEqual(result.returncode, 1, result.stderr.decode('cp932', 'replace'))
        summary = json.loads(result.stdout.decode('cp932').splitlines()[-1])
        self.assertEqual(summary['documents'], 2)
        self.assertIn('壊れた · 会話', summary['failed'][0]['label'])

    def test_chatgpt_command_dry_run_never_connects(self):
        folder = self.root / 'folder' / 'c'
        folder.mkdir(parents=True)
        (folder / 'conversation.json').write_text(json.dumps(conversation()), encoding='utf-8')

        def make_client(url):
            raise AssertionError('dry run must not create a client')

        out = io.StringIO()
        with patch.object(common, 'MeilisearchClient', make_client), redirect_stdout(out):
            code = chatgpt.main([str(self.root / 'folder'), '--dry-run'])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue().splitlines()[-1]), {'dry_run': True, 'conversations': 1, 'documents': 2, 'skipped': 0, 'failed': []})

    def test_chatgpt_command_sends_to_the_given_server_and_index(self):
        folder = self.root / 'folder' / 'c'
        folder.mkdir(parents=True)
        (folder / 'conversation.json').write_text(json.dumps(conversation()), encoding='utf-8')
        clients = []

        def make_client(url):
            clients.append(FakeClient(index_exists=True))
            clients[-1].url = url
            return clients[-1]

        out = io.StringIO()
        with patch.object(common, 'MeilisearchClient', make_client), redirect_stdout(out):
            code = chatgpt.main([str(self.root / 'folder'), '--meili-url', 'http://meili', '--index', 'other', '--embedder-url', 'http://e'])
        self.assertEqual(code, 0)
        [client] = clients
        self.assertEqual(client.url, 'http://meili')
        sent = [(path, body) for path, body in client.bodies if path.endswith('/documents')]
        self.assertEqual(sent, [('/indexes/other/documents', chatgpt.convert_conversation(conversation(), chatgpt.Origin(str((folder / 'conversation.json').resolve()))))])
        self.assertIn(('/indexes/other/settings', common.make_settings('http://e')), client.bodies)


if __name__ == '__main__':
    unittest.main()

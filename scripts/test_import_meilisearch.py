"""ChatGPT の会話を Meilisearch へ取り込むスクリプトの検査。外部サーバーには接続しない。"""

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

import chatgpt_export as reader
import import_chatgpt_meilisearch as chatgpt
import meilisearch_conversations as common


class TemporaryTestCase(unittest.TestCase):
    def setUp(self):
        work = Path(os.environ['LOCALAPPDATA']) / 'Temp' / 'pi' if os.name == 'nt' else Path('/tmp/pi')
        work.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=work)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)


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

    def test_malformed_conversation_fails_only_itself(self):
        malformed = conversation('conv-3')
        malformed['mapping']['a1']['message']['metadata'] = None
        self.write_folder(self.root / 'a', malformed)
        self.write_folder(self.root / 'b', conversation('conv-4'))
        result = list(chatgpt.batches([self.root / 'a', self.root / 'b']))
        self.assertIsNotNone(result[0].error)
        self.assertEqual(result[1].documents[0]['conversation_id'], 'conv-4')

    def test_missing_mapping_is_a_failure(self):
        self.write_folder(self.root / 'a', {'conversation_id': 'conv-5', 'mapping': None})
        [batch] = list(chatgpt.batches([self.root / 'a']))
        self.assertIsNotNone(batch.error)

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

    def test_unreadable_archive_or_folder_does_not_stop_other_inputs(self):
        archive = self.write_zip(self.root / 'backup.zip', {'c/conversation.json': json.dumps(conversation('conv-6'))})
        self.write_folder(self.root / 'folder', conversation('conv-7'))
        real_zipfile = zipfile.ZipFile

        def broken_zip(path, *args, **kwargs):
            if Path(path) == archive.resolve():
                raise RuntimeError('encrypted')
            return real_zipfile(path, *args, **kwargs)

        with patch.object(reader.zipfile, 'ZipFile', broken_zip):
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

        real_walk = reader.os.walk

        def walk(top, onerror=None):
            onerror(PermissionError(13, 'denied', str(Path(top) / 'locked')))
            return real_walk(top, onerror=onerror)

        with patch.object(reader.os, 'walk', walk):
            result = list(chatgpt.batches([self.root / 'folder']))
        self.assertIn('locked', result[0].label)
        self.assertEqual(result[1].documents[0]['conversation_id'], 'conv-7')

    def test_input_without_conversations_is_a_failure(self):
        (self.root / 'empty').mkdir()
        archive = self.write_zip(self.root / 'empty.zip', {'other.txt': 'x'})
        self.assertEqual([b.error is not None for b in chatgpt.batches([self.root / 'empty', archive])], [True, True])


class FakeClient(common.MeilisearchClient):
    """Fake Meilisearch. Each task reports 'enqueued' and 'processing' before finishing."""

    def __init__(self, fail_documents=(), unreachable=False, status_error_for=None, cut_off_for=None):
        super().__init__('http://fake', poll_seconds=0)
        self.calls = []
        self.bodies = []
        self.finished = {}  # task uid -> index in calls of the GET that reported the final state
        self.fail_documents = set(fail_documents)
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
        uid = len(self.tasks)
        failed = '/documents' in path and any(d['id'] in self.fail_documents for d in body)
        final = {'status': 'failed', 'error': {'message': 'embedding failed'}} if failed else {'status': 'succeeded'}
        self.tasks[uid] = [{'status': 'enqueued'}, {'status': 'processing'}, final]
        return {'taskUid': uid}


def args(dry_run=False):
    return argparse.Namespace(meili_url='http://fake', index='conversations', dry_run=dry_run)


def run_quietly(*a, **k):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = common.run(*a, **k)
    return code, json.loads(out.getvalue().splitlines()[-1]), err.getvalue()


class RunTests(unittest.TestCase):
    def batches(self):
        return [common.Batch('one', [{'id': 'a'}]), common.Batch('two', [{'id': 'bad'}]), common.Batch('three', error='読めない'),
                common.Batch('four', skipped=True), common.Batch('five', [{'id': 'c'}, {'id': 'd'}])]

    def test_sends_each_conversation_and_reports_failures(self):
        client = FakeClient(fail_documents={'bad'})
        code, summary, err = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 1)
        self.assertEqual(summary['conversations'], 2)
        self.assertEqual(summary['documents'], 3)
        self.assertEqual(summary['skipped'], 1)
        self.assertEqual([f['label'] for f in summary['failed']], ['two', 'three'])
        self.assertEqual(summary['failed'][0]['task'], 1)  # tasks: 0 'one', 1 'two', 2 'five'
        self.assertIn('embedding failed', err)
        # Only documents are written; the index settings belong to the compose service.
        writes = [c for c in client.calls if c[0] != 'GET']
        self.assertEqual(writes, [('POST', '/indexes/conversations/documents?primaryKey=id')] * 3)
        # Every task is polled until it finishes before the next write is sent, the last one too.
        write_positions = [i for i, call in enumerate(client.calls) if call[0] != 'GET']
        for task_uid, position in zip(range(3), write_positions[1:]):
            self.assertLess(client.finished[task_uid], position)
        self.assertIn(2, client.finished)
        self.assertEqual(client.calls.count(('GET', '/tasks/1')), 3)

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
            if '/documents' in path and body[0]['id'] == 'bad':
                raise common.MeiliError('HTTP 400: invalid document id', 400)
            if '/documents' in path and body[0]['id'] == 'slow':
                raise common.MeiliError('HTTP 504: gateway timeout', 504)
            return real_request(method, path, body)

        client.request = request
        batches = [
            common.Batch('bad', [{'id': 'bad'}]), common.Batch('good', [{'id': 'a'}]),
            common.Batch('slow', [{'id': 'slow'}]), common.Batch('after', [{'id': 'b'}])]
        code, summary, err = run_quietly(args(), batches, client)
        self.assertEqual(code, 2)
        self.assertEqual([f['label'] for f in summary['failed']], ['bad'])
        self.assertEqual(summary['conversations'], 1)
        self.assertIn('aborted during slow', err)

    def test_task_response_without_uid_aborts_and_odd_error_is_reported(self):
        client = FakeClient()
        real_request = client.request
        client.request = lambda method, path, body=None: {} if '/documents' in path else real_request(method, path, body)
        code, _, err = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 2)
        self.assertIn('taskUid', err)

        client = FakeClient(fail_documents={'bad'})
        real_request2 = client.request

        def request(method, path, body=None):
            response = real_request2(method, path, body)
            if path == '/tasks/1':
                return {'status': 'failed', 'error': 'unexpected'}
            return response

        client.request = request
        code, summary, _ = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 1)
        self.assertEqual(summary['failed'][0], {'label': 'two', 'error': 'unexpected', 'task': 1})

    def test_unexpected_task_response_aborts(self):
        for response in ({'status': 'unknown'}, {}, ['not', 'a', 'task']):
            client = FakeClient()
            real_request = client.request

            def request(method, path, body=None, response=response):
                return response if path == '/tasks/0' else real_request(method, path, body)

            client.request = request
            code, _, err = run_quietly(args(), self.batches(), client)
            self.assertEqual(code, 2, response)
            self.assertIn('one task=0', err)

    def test_cut_off_response_aborts(self):
        code, summary, err = run_quietly(args(), self.batches(), FakeClient(cut_off_for=0))
        self.assertEqual(code, 2)
        self.assertIn('one task=0', err)

    def test_unknown_task_outcome_aborts_instead_of_moving_on(self):
        client = FakeClient(status_error_for=0)
        code, summary, err = run_quietly(args(), self.batches(), client)
        self.assertEqual(code, 2)
        self.assertEqual(summary['failed'], [])
        self.assertIn('one task=0', err)
        self.assertEqual(client.calls.count(('POST', '/indexes/conversations/documents?primaryKey=id')), 1)

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

class SettingsFileTests(unittest.TestCase):
    """The index settings the compose service applies. Changing the indexing embedder's url, request or response re-embeds every document."""

    def test_settings_contract(self):
        path = Path(__file__).resolve().parents[1] / 'containers' / 'session-search' / 'meilisearch-settings.json'
        settings = json.loads(path.read_text(encoding='utf-8'))
        # Any other setting (displayedAttributes, for example) would change what session.sh receives.
        self.assertEqual(set(settings), {'searchableAttributes', 'filterableAttributes', 'sortableAttributes', 'localizedAttributes', 'embedders'})
        self.assertEqual(settings['searchableAttributes'], ['question', 'reply', 'title'])  # the order ranks matches
        self.assertTrue({'source', 'cwd', 'conversation_id', 'project', 'timestamp'} <= set(settings['filterableAttributes']))
        self.assertIn('timestamp', settings['sortableAttributes'])
        self.assertEqual(settings['localizedAttributes'], [{'locales': ['jpn', 'eng'], 'attributePatterns': ['question', 'reply', 'title']}])
        self.assertEqual(list(settings['embedders']), ['ruri'])
        embedder = settings['embedders']['ruri']
        self.assertEqual(set(embedder), {'source', 'indexingEmbedder', 'searchEmbedder'})
        self.assertEqual(embedder['source'], 'composite')
        indexing, search = embedder['indexingEmbedder'], embedder['searchEmbedder']
        self.assertEqual(set(indexing), {'source', 'url', 'dimensions', 'request', 'response', 'indexingFragments'})
        self.assertEqual(set(search), {'source', 'url', 'dimensions', 'request', 'response', 'searchFragments'})
        # The two hosts are aliases of compose services. The indexing url is part of what identifies the stored vectors.
        self.assertEqual(indexing['url'], 'http://embed-index.internal:11434/api/embed')
        self.assertEqual(search['url'], 'http://embed-search.internal:11434/api/embed')
        # Documents and queries must be embedded by the same model, so both sides carry the same request.
        for side in (indexing, search):
            self.assertEqual(side['source'], 'rest')
            self.assertEqual(side['dimensions'], 768)
            self.assertEqual(side['request'], {'model': 'ruri-v3-310m:q8_0', 'input': ['{{fragment}}', '{{..}}']})
            self.assertEqual(side['response'], {'embeddings': ['{{embedding}}', '{{..}}']})
        self.assertEqual(search['searchFragments'], {'query': {'value': '検索クエリ: {{q}}'}})
        self.assertEqual(indexing['indexingFragments'], {'doc': {
            'value': '検索文書: {{ doc.reply | truncate: 12000 }}\n\n{{ doc.question | truncate: 2000 }}'}})


class HttpClientTests(unittest.TestCase):
    """MeilisearchClient against a local HTTP server: encoding, paths and errors."""

    def setUp(self):
        received = self.received = []
        authorizations = self.authorizations = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers['Content-Length'])
                received.append((self.command, self.path, self.headers['Content-Type'], json.loads(self.rfile.read(length).decode('utf-8'))))
                self.reply(202, {'taskUid': 7})

            def do_GET(self):
                received.append((self.command, self.path, None, None))
                authorizations.append(self.headers['Authorization'])
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

    def test_api_key_is_sent_only_when_given(self):
        common.MeilisearchClient(self.client.url, api_key='secret').request('GET', '/tasks/7')
        self.client.request('GET', '/tasks/7')
        self.assertEqual(self.authorizations, ['Bearer secret', None])

    def test_non_json_response_is_an_error(self):
        with self.assertRaises(common.MeiliError):
            self.client.request('GET', '/garbage')

    def test_http_error_and_failed_task_are_distinguished(self):
        with self.assertRaises(common.MeiliError) as raised:
            self.client.request('GET', '/indexes/missing')
        self.assertEqual(raised.exception.status, 404)
        self.assertNotIsInstance(raised.exception, common.TaskFailed)
        self.assertIn('Index not found', str(raised.exception))
        with self.assertRaises(common.TaskFailed):
            self.client.wait_task(7)


class CommandLineTests(TemporaryTestCase):
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

        def make_client(url, api_key=None):
            clients.append(FakeClient())
            clients[-1].url = url
            return clients[-1]

        out = io.StringIO()
        with patch.object(common, 'MeilisearchClient', make_client), redirect_stdout(out):
            code = chatgpt.main([str(self.root / 'folder'), '--meili-url', 'http://meili', '--index', 'other'])
        self.assertEqual(code, 0)
        [client] = clients
        self.assertEqual(client.url, 'http://meili')
        sent = [(path, body) for path, body in client.bodies if '/documents' in path]
        self.assertEqual(sent, [('/indexes/other/documents?primaryKey=id', chatgpt.convert_conversation(conversation(), chatgpt.Origin(str((folder / 'conversation.json').resolve()))))])
        self.assertEqual([c for c in client.calls if c[0] != 'GET'], [('POST', '/indexes/other/documents?primaryKey=id')])

    def test_connection_defaults_come_from_the_shared_environment(self):
        parser = argparse.ArgumentParser()
        with patch.dict(os.environ, {'MEILISEARCH_URL': 'http://shared', 'MEILISEARCH_INDEX': 'shared-index'}):
            common.add_common_args(parser)
        options = parser.parse_args([])
        self.assertEqual((options.meili_url, options.index), ('http://shared', 'shared-index'))
        with patch.dict(os.environ, {'MEILISEARCH_URL': '', 'MEILISEARCH_INDEX': ''}):
            parser = argparse.ArgumentParser()
            common.add_common_args(parser)
        options = parser.parse_args([])
        self.assertEqual((options.meili_url, options.index), (common.DEFAULT_MEILI_URL, common.DEFAULT_INDEX))


if __name__ == '__main__':
    unittest.main()

"""ChatGPT export reader tests (standard library, no backend)."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import chatgpt_export as reader


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


class ReaderTests(TemporaryTestCase):
    def write_folder(self, name, conv):
        folder = self.root / name / 'conv'
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'conversation.json').write_text(json.dumps(conv, ensure_ascii=False), encoding='utf-8')
        return folder.parent

    def test_branch_visibility_and_text(self):
        conv = conversation()
        nodes = reader.current_branch(conv)
        messages = [n['message'] for n in nodes if n.get('message') and reader.visible(n['message'])]
        self.assertEqual([m['id'] for m in messages], ['u1', 'a1', 'a2', 'u2', 'a3', 'u3'])
        self.assertEqual(reader.message_text(messages[2]), '回答その2\n部品の文字')
        self.assertEqual(reader.message_text(messages[3]), '')
        self.assertEqual(reader.seconds('2020-01-01T00:00:00Z'), 1577836800)
        self.assertEqual(reader.seconds('100'), 100)
        for value in (True, 'NaN', 'not a date', None):
            self.assertIsNone(reader.seconds(value))

    def test_array_mapping_preserves_current_branch(self):
        conv = conversation()
        expected = reader.current_branch(conv)
        conv['mapping'] = list(conv['mapping'].values())
        self.assertEqual(reader.current_branch(conv), expected)

    def test_latest_leaf_and_array_mapping(self):
        conv = conversation()
        conv['current_node'] = 'gone'
        conv['mapping']['u3']['message']['create_time'] = '100'
        conv['mapping']['other']['message']['create_time'] = '200'
        self.assertEqual(reader.current_branch(conv)[-1]['id'], 'other')
        del conv['current_node']
        self.assertEqual(reader.current_branch(conv)[-1]['id'], 'other')
        conv['mapping'] = list(conv['mapping'].values())
        self.assertEqual(reader.current_branch(conv)[-1]['id'], 'other')
        with self.assertRaises(reader.ImportFailure):
            reader.current_branch({'mapping': None})

    def test_duplicate_selection_falls_back_to_create_time_then_export_time_then_order(self):
        def write(folder, **times):
            conv = conversation(title=folder)
            conv.pop('update_time')
            conv.update(times)
            self.write_folder(folder, conv)
            return self.root / folder

        def chosen(*folders):
            [(origin, conv)] = list(reader.selected_conversations(list(folders)))
            return conv['title']

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

    def test_zip_selection_failures_and_origin(self):
        old = self.write_folder('old', conversation(title='old', update_time=1))
        archive = self.root / 'archive.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('backup-manifest.json', json.dumps({'projectName': 'project'}))
            z.writestr('new/conversation.json', json.dumps(conversation(title='new', update_time=2)))
            z.writestr('bad/conversation.json', '{bad')
        results = list(reader.selected_conversations([old, archive, self.root / 'missing.zip']))
        errors = [r for r in results if isinstance(r, reader.ReadFailure)]
        self.assertEqual(len(errors), 2)
        [(origin, conv)] = [r for r in results if not isinstance(r, reader.ReadFailure)]
        self.assertEqual((conv['title'], origin.source_path, origin.member, origin.project),
                         ('new', str(archive.resolve()), 'new/conversation.json', 'project'))
        self.assertEqual(origin.load(), conv)
        self.assertEqual(origin.label, f'{archive.resolve()}!new/conversation.json')

    def test_selection_ties_and_dates(self):
        def choose(a, b):
            [(origin, conv)] = list(reader.selected_conversations([self.write_folder('a', a), self.write_folder('b', b)]))
            return conv['title']
        for a, b, expected in [
            ({'update_time': 100}, {'update_time': None, 'create_time': 200}, 'b'),
            ({'update_time': 0, 'create_time': 300}, {'update_time': 250}, 'a'),
            ({'update_time': 100, '__local_exported_at': 1}, {'update_time': 100, '__local_exported_at': 2}, 'b'),
            ({'update_time': 100}, {'update_time': 100}, 'a'),
            ({'update_time': 'NaN', 'create_time': 400}, {'update_time': 350}, 'a'),
        ]:
            self.assertEqual(choose({**conversation(title='a'), **a}, {**conversation(title='b'), **b}), expected)

    def test_manifest_error_and_empty_inputs(self):
        archive = self.root / 'archive.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('backup-manifest.json', '{bad')
            z.writestr('conversation.json', json.dumps(conversation()))
        results = list(reader.selected_conversations([archive]))
        self.assertIsInstance(results[0], reader.ReadFailure)
        self.assertIsNone(results[1][0].project)
        empty = self.root / 'empty'
        empty.mkdir()
        [failure] = list(reader.selected_conversations([empty]))
        self.assertIsInstance(failure, reader.ReadFailure)


if __name__ == '__main__':
    unittest.main()

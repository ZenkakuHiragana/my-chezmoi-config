"""変換と送信の要件検査。外部サーバーやモデルには接続しない。"""

import base64
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

import import_chatgpt_hindsight as importer


def png(width=2, height=3, color=b'\x00\x00\x00', comment=b''):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    raw = (b'\0' + color * width) * height
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    if comment:
        data += chunk(b'tEXt', comment)
    return data + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def message(node_id, role='user', parts=None, kind='text', timestamp=1, **extra):
    return {'id': node_id, 'author': {'role': role}, 'content': {'content_type': kind, 'parts': parts if parts is not None else [node_id]}, 'create_time': timestamp, 'recipient': 'all', 'metadata': {}, **extra}


def conversation(messages, conversation_id='c', update_time=10):
    mapping, parent = {'root': {'id': 'root', 'parent': None, 'message': None}}, 'root'
    for m in messages:
        mapping[m['id']] = {'id': m['id'], 'parent': parent, 'message': m}
        parent = m['id']
    return {'title': '会話', 'conversation_id': conversation_id, 'create_time': 1, 'update_time': update_time, 'current_node': parent, 'mapping': mapping}


def image_part(asset_id='file_a', data=None, width=2, height=3):
    return {'content_type': 'image_asset_pointer', 'asset_pointer': 'sediment://' + asset_id, 'width': width, 'height': height, 'size_bytes': len(data if data is not None else png(width, height))}


def attachment(asset_id='file_a', name='image.png', data=None, width=2, height=3):
    return {'id': asset_id, 'name': name, 'width': width, 'height': height, 'size': len(data if data is not None else png(width, height)), 'mime_type': 'image/png'}


class FakeApi(importer.ApiClient):
    def __init__(self, fail=False, damaged_text=False, damaged_image=False):
        super().__init__('http://localhost:1', 'dev', None)
        self.operations = {}
        self.documents = {}
        self.posts = []
        self.fail = fail
        self.damaged_text = damaged_text
        self.damaged_image = damaged_image

    def assert_same_document(self, items):
        assert len({item['document_id'] for item in items}) == 1

    def request(self, method, path, body=None):
        if method == 'POST':
            assert path == '/memories'
            self.posts.append(body)
            asynchronous = body.get('async', False)
            if asynchronous:
                self.operations[body['operation_id']] = 'failed' if self.fail else 'completed'
            elif self.fail:
                raise importer.ImportFailure('同期抽出失敗')
            items = body['items']
            item = items[0]
            self.assert_same_document(items)
            text = ''
            after_image = False
            for block in item['content']:
                if (block['type'] == 'image' or after_image) and text:
                    text = text.rstrip('\n') + '\n\n'
                after_image = block['type'] == 'image'
                if after_image:
                    digest = hashlib.sha256(base64.b64decode(block['source']['data'])).hexdigest()
                    text += f'⟦hs-att:{digest[:12]}⟧'
                else:
                    text += block['text']
            hashes = {hashlib.sha256(base64.b64decode(b['source']['data'])).hexdigest() for entry in items for b in entry['content'] if b['type'] == 'image'}
            self.documents[item['document_id']] = {'id': item['document_id'], 'bank_id': self.bank, 'document_metadata': item['metadata'], 'original_text': 'lost' if self.damaged_text else text, 'memory_unit_count': 3, 'attachments': [] if self.damaged_image else [{'hash': h, 'kind': 'image'} for h in hashes]}
            return {'success': True, 'bank_id': self.bank, 'operation_id': body.get('operation_id') if asynchronous else None, 'async': asynchronous, 'items_count': len(items)}
        if path.startswith('/operations/'):
            return {'status': self.operations.get(path.rsplit('/', 1)[-1], 'not_found')}
        if path.startswith('/documents/'):
            from urllib.parse import unquote
            return self.documents[unquote(path.rsplit('/', 1)[-1])]
        raise AssertionError(path)


class ImportTests(unittest.TestCase):
    def setUp(self):
        work = Path('.opencode/work/chatgpt-hindsight-import/tests')
        work.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=work)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / 'input' / 'session'
        self.directory.mkdir(parents=True)
        self.path = self.directory / 'conversation.json'

    def save(self, data):
        self.path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return data

    def add_image(self, name='image.png', data=None):
        folder = self.directory / 'images'
        folder.mkdir(exist_ok=True)
        path = folder / name
        path.write_bytes(data if data is not None else png())
        return path

    def convert(self, data):
        request, report = importer.convert_conversation(data, self.path, 'chatgpt-ai')
        return request['items'][0], report

    def prepare(self, data):
        self.save(data)
        output = self.root / 'output'
        with redirect_stdout(io.StringIO()):
            manifest = importer.prepare([self.directory.parent], output, 'chatgpt-ai')
        return output, manifest

    def test_selected_branch_and_visible_speakers(self):
        ms = [message('original', parts=['原文\n訂正前']), message('hidden', metadata={'is_visually_hidden_from_conversation': True}), message('thought', role='assistant', kind='thoughts'), message('analysis', role='assistant', channel='analysis'), message('call', role='assistant', recipient='python', kind='code'), message('tool', role='tool'), message('final', role='assistant', parts=['訂正後'], timestamp=9)]
        data = conversation(ms)
        data['mapping']['other'] = {'parent': 'original', 'message': message('other', role='assistant', parts=['別の分岐'])}
        item, report = self.convert(data)
        text = ''.join(b.get('text', '') for b in item['content'])
        self.assertIn('## User\n\n<!-- message_id: original; timestamp: 1970-01-01T00:00:01Z -->\n\n原文\n訂正前', text)
        self.assertIn('訂正後', text)
        for hidden in ['別の分岐', 'message_id: hidden;', 'message_id: analysis;', 'message_id: thought;', 'message_id: call;', 'message_id: tool;']:
            self.assertNotIn(hidden, text)
        self.assertEqual(report['turns'], 2)
        self.assertEqual(item['timestamp'], '1970-01-01T00:00:09Z')
        self.assertNotIn('strategy', item)
        self.assertNotIn('observation_scopes', item)
        self.assertEqual(item['tags'], ['source:chatgpt', 'collection:chatgpt-ai'])

    def test_text_turns_keep_speakers_timestamps_and_original_markdown(self):
        texts = ['質問\n> 第三者の引用', '回答: "引用" と \\ の区別']
        item, report = self.convert(conversation([
            message('question', parts=[texts[0]]),
            message('answer', role='assistant', parts=[texts[1]], timestamp=9),
        ]))
        self.assertEqual(len(item['content']), 1)
        self.assertEqual(item['content'][0]['text'],
            '# 会話\n\n## User\n\n<!-- message_id: question; timestamp: 1970-01-01T00:00:01Z -->\n\n'
            + texts[0] + '\n\n## Assistant\n\n<!-- message_id: answer; timestamp: 1970-01-01T00:00:09Z -->\n\n'
            + texts[1] + '\n')
        self.assertEqual(report['turns'], 2)

    def test_broken_or_cyclic_branch_is_not_flattened(self):
        data = conversation([message('one')])
        data['mapping']['one']['parent'] = 'absent'
        with self.assertRaises(importer.ImportFailure):
            self.convert(data)
        data['mapping']['one']['parent'] = 'one'
        with self.assertRaises(importer.ImportFailure):
            self.convert(data)

    def test_image_is_inline_with_original_bytes(self):
        saved = self.add_image()
        missing = image_part('file_missing', width=9, height=9)
        m = message('one', kind='multimodal_text', parts=['前', image_part(), '後', missing], metadata={'attachments': [attachment(), attachment('file_missing', 'missing.png', width=9, height=9)]})
        item, report = self.convert(conversation([m]))
        image_index = next(i for i, b in enumerate(item['content']) if b['type'] == 'image')
        self.assertTrue(item['content'][image_index - 1]['text'].endswith('前'))
        self.assertTrue(item['content'][image_index + 1]['text'].startswith('後'))
        self.assertEqual(base64.b64decode(item['content'][image_index]['source']['data']), saved.read_bytes())
        self.assertEqual(len(report['missing_images']), 1)

    def test_reencoded_saved_image_is_not_missing(self):
        self.add_image(data=png(comment=b'changed'))
        m = message('one', kind='multimodal_text', parts=[image_part()], metadata={'attachments': [attachment()]})
        _, report = self.convert(conversation([m]))
        self.assertEqual(report['image_occurrences'], 1)
        self.assertEqual(report['missing_images'], [])
        self.assertEqual(len(report['image_byte_size_changes']), 1)

    def test_overwritten_same_names_select_surviving_image(self):
        self.add_image(data=png(4, 5))
        m = message('one', kind='multimodal_text', parts=[image_part('file_a', width=2, height=3), image_part('file_b', width=4, height=5)], metadata={'attachments': [attachment('file_a'), attachment('file_b', width=4, height=5)]})
        _, report = self.convert(conversation([m]))
        self.assertEqual(report['image_occurrences'], 1)
        self.assertEqual(report['missing_images'][0]['asset_pointer'], 'sediment://file_a')

    def test_ambiguous_same_name_does_not_silently_drop(self):
        self.add_image(data=png(comment=b'new encoding'))
        m = message('one', kind='multimodal_text', parts=[image_part('file_a'), image_part('file_b')], metadata={'attachments': [attachment('file_a'), attachment('file_b')]})
        with self.assertRaises(importer.ImportFailure):
            self.convert(conversation([m]))

    def test_unrelated_same_size_image_is_not_reassigned(self):
        self.add_image('unrelated.png')
        m = message('one', kind='multimodal_text', parts=[image_part()], metadata={'attachments': [attachment(name='absent.png')]})
        with self.assertRaises(importer.ImportFailure):
            self.convert(conversation([m]))

    def test_markdown_alias_and_parenthesized_path(self):
        self.add_image('renamed (2).png')
        (self.directory / 'conversation.md').write_text('## User\n\n![image.png](images/renamed%20(2).png)\n', encoding='utf-8')
        m = message('one', kind='multimodal_text', parts=[image_part()], metadata={'attachments': [attachment()]})
        _, report = self.convert(conversation([m]))
        self.assertEqual(report['image_occurrences'], 1)
        parsed = list(importer.markdown_images('![x](images/foo(1).png "title")'))
        self.assertEqual(parsed[0][3], 'images/foo(1).png')

    def test_literal_markdown_does_not_add_an_unselected_attachment(self):
        self.add_image()
        text = '例:\n```markdown\n![image](images/image.png)\n```'
        data = conversation([message('one', parts=[text])])
        other = message('other', kind='multimodal_text', parts=[image_part()], metadata={'attachments': [attachment()]})
        data['mapping']['other'] = {'parent': 'root', 'message': other}
        item, report = self.convert(data)
        self.assertEqual(report['image_occurrences'], 0)
        self.assertTrue(item['content'][0]['text'].endswith(text + '\n'))
        self.assertEqual(importer.AssetResolver(self.directory, []).local_path('../private.png'), None)

    def test_latest_duplicate_is_selected(self):
        self.save(conversation([message('old')], update_time=10))
        second = self.root / 'second' / 'session'
        second.mkdir(parents=True)
        (second / 'conversation.json').write_text(json.dumps(conversation([message('new')], update_time=20)), encoding='utf-8')
        output = self.root / 'output'
        with redirect_stdout(io.StringIO()):
            manifest = importer.prepare([self.directory.parent, second.parent], output, 'chatgpt-ai')
        self.assertEqual(len(manifest['documents']), 1)
        item = json.loads((output / manifest['documents'][0]['file']).read_text(encoding='utf-8'))['items'][0]
        self.assertIn('new', item['content'][0]['text'])
        self.assertNotIn('old', item['content'][0]['text'])
        self.assertEqual(item['document_id'], 'chatgpt:c')

    def test_upload_tracks_completion_and_is_idempotent(self):
        output, _ = self.prepare(conversation([message('one')]))
        client = FakeApi()
        with redirect_stdout(io.StringIO()):
            first = importer.upload(output, client, poll_seconds=0)
            second = importer.upload(output, client, poll_seconds=0)
        self.assertEqual(first['completed'], 1)
        self.assertEqual(second['completed'], 1)
        self.assertEqual(len(client.posts), 1)
        self.assertTrue(client.posts[0]['async'])
        self.assertIn('operation_id', client.posts[0])

    def prepare_many(self, count=5):
        for i in range(count):
            directory = self.directory.parent / str(i)
            directory.mkdir()
            (directory / 'conversation.json').write_text(
                json.dumps(conversation([message(str(i))], conversation_id=f'c{i}')), encoding='utf8')
        output = self.root / 'output'
        with redirect_stdout(io.StringIO()):
            manifest = importer.prepare([self.directory.parent], output, 'chatgpt-ai')
        return output, manifest

    def queued_api(self, expected_posts):
        class QueuedApi(FakeApi):
            def request(self, method, path, body=None):
                if method == 'POST':
                    receipt = super().request(method, path, body)
                    self.operations[body['operation_id']] = 'pending'
                    return receipt
                if path.startswith('/operations/'):
                    op = path.rsplit('/', 1)[-1]
                    if len(self.posts) == expected_posts and self.operations.get(op) in {'pending', 'processing'}:
                        self.operations[op] = 'completed'
                if path.startswith('/documents/'):
                    assert len(self.posts) == expected_posts, '保存確認より前に全件を受付させる'
                return super().request(method, path, body)
        return QueuedApi()

    def test_all_documents_are_accepted_without_waiting_for_four_to_finish(self):
        output, _ = self.prepare_many()
        client = self.queued_api(expected_posts=5)
        with redirect_stdout(io.StringIO()), patch.object(importer.time, 'sleep', side_effect=AssertionError('受付前に完了を待っている')):
            result = importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 5)
        self.assertEqual(result['completed'], 5)

    def test_resume_keeps_completed_pending_and_processing_operations(self):
        output, manifest = self.prepare_many()
        client = self.queued_api(expected_posts=2)
        for document, status in zip(manifest['documents'], ['completed', 'pending', 'processing']):
            request = json.loads((output / document['file']).read_text(encoding='utf8'))
            op = importer.operation_id_for(client, document)
            request['operation_id'] = op
            FakeApi.request(client, 'POST', '/memories', request)
            client.operations[op] = status
        client.posts.clear()
        with redirect_stdout(io.StringIO()), patch.object(importer.time, 'sleep', side_effect=AssertionError('未送信分の受付前に待っている')):
            result = importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 2)
        self.assertEqual(result['completed'], 5)
        self.assertEqual({p['items'][0]['document_id'] for p in client.posts},
                         {d['document_id'] for d in manifest['documents'][3:]})

    def test_lost_acknowledgement_resumes_without_duplicate_post(self):
        output, _ = self.prepare(conversation([message('one')]))
        client = FakeApi()
        original = client.request
        def lose_receipt(method, path, body=None):
            response = original(method, path, body)
            if method == 'POST':
                raise importer.ImportFailure('受付後に接続断')
            return response
        with patch.object(client, 'request', side_effect=lose_receipt), redirect_stdout(io.StringIO()), self.assertRaises(importer.ImportFailure):
            importer.upload(output, client, poll_seconds=0)
        with redirect_stdout(io.StringIO()):
            result = importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 1)
        self.assertEqual(result['completed'], 1)

    def test_queue_is_polled_until_completion_then_storage_is_verified(self):
        output, _ = self.prepare(conversation([message('one')]))
        client = self.queued_api(expected_posts=99)
        def complete(_):
            client.operations = {op: 'completed' for op in client.operations}
        with redirect_stdout(io.StringIO()), patch.object(importer.time, 'sleep', side_effect=complete) as slept:
            # Keep this test's server independent of the all-submitted fake's assertion.
            with patch.object(client, 'document', side_effect=lambda doc: client.documents[doc]):
                result = importer.upload(output, client, poll_seconds=0)
        self.assertEqual(slept.call_count, 1)
        self.assertEqual(result['completed'], 1)

    def test_image_and_text_turns_share_one_item_and_one_document(self):
        self.add_image()
        first = message('question', kind='multimodal_text', parts=['前', image_part(), '後'], metadata={'attachments': [attachment()]})
        second = message('answer', role='assistant', parts=['応答'], timestamp=9)
        output, manifest = self.prepare(conversation([first, second]))
        request = json.loads((output / manifest['documents'][0]['file']).read_text(encoding='utf8'))
        self.assertIs(request['async'], True)
        self.assertEqual(len(request['items']), 1)
        blocks = request['items'][0]['content']
        self.assertEqual([b['type'] for b in blocks], ['text', 'image', 'text'])
        self.assertIn('## User\n', blocks[0]['text'])
        self.assertTrue(blocks[0]['text'].endswith('前'))
        self.assertTrue(blocks[2]['text'].startswith('後\n\n## Assistant\n'))
        self.assertIn('timestamp: 1970-01-01T00:00:09Z', blocks[2]['text'])
        client = FakeApi()
        with redirect_stdout(io.StringIO()):
            importer.upload(output, client, poll_seconds=0)
            importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 1)
        self.assertIs(client.posts[0]['async'], True)
        self.assertEqual({x['document_id'] for x in client.posts[0]['items']}, {'chatgpt:c'})
        self.assertIn('operation_id', client.posts[0])
        self.assertIn('応答', client.documents['chatgpt:c']['original_text'])

    def test_failed_image_operation_is_not_resent(self):
        self.add_image()
        output, _ = self.prepare(conversation([message('one', kind='multimodal_text', parts=['本文', image_part()], metadata={'attachments': [attachment()]})]))
        client = FakeApi(fail=True)
        for _ in range(2):
            with redirect_stdout(io.StringIO()), self.assertRaises(importer.ImportFailure):
                importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 1)

    def test_changed_image_payload_is_sent_instead_of_skipping(self):
        self.add_image()
        data = conversation([message('one', kind='multimodal_text', parts=['本文', image_part()], metadata={'attachments': [attachment()]})])
        output, _ = self.prepare(data)
        client = FakeApi()
        with redirect_stdout(io.StringIO()):
            importer.upload(output, client, poll_seconds=0)
        data['mapping']['one']['message']['content']['parts'][0] = '変更本文'
        self.prepare(data)
        with redirect_stdout(io.StringIO()):
            importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 2)
        self.assertIn('変更本文', client.documents['chatgpt:c']['original_text'])

    def test_old_schema_is_rejected_before_sending(self):
        output, _ = self.prepare(conversation([message('one')]))
        manifest_path = output / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        manifest['schema_version'] = 1
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        client = FakeApi()
        with self.assertRaises(importer.ImportFailure):
            importer.upload(output, client, poll_seconds=0)
        self.assertEqual(client.posts, [])

    def test_modified_payload_is_rejected_before_sending(self):
        output, manifest = self.prepare(conversation([message('one')]))
        payload_path = output / manifest['documents'][0]['file']
        payload_path.write_bytes(payload_path.read_bytes() + b' ')
        client = FakeApi()
        with self.assertRaises(importer.ImportFailure):
            importer.upload(output, client, poll_seconds=0)
        self.assertEqual(client.posts, [])

    def test_failed_operation_is_not_reported_as_complete(self):
        output, _ = self.prepare(conversation([message('one')]))
        with redirect_stdout(io.StringIO()), self.assertRaises(importer.ImportFailure):
            importer.upload(output, FakeApi(fail=True), poll_seconds=0)

    def test_changed_payload_is_not_sent(self):
        output, manifest = self.prepare(conversation([message('one')]))
        (output / manifest['documents'][0]['file']).write_text('{}', encoding='utf-8')
        client = FakeApi()
        with self.assertRaises(importer.ImportFailure):
            importer.upload(output, client, poll_seconds=0)
        self.assertEqual(client.posts, [])

    def test_saved_text_and_image_are_verified(self):
        self.add_image()
        m = message('one', kind='multimodal_text', parts=[image_part(), '本文'], metadata={'attachments': [attachment()]})
        output, _ = self.prepare(conversation([m]))
        for client in [FakeApi(damaged_text=True), FakeApi(damaged_image=True)]:
            with redirect_stdout(io.StringIO()), self.assertRaises(importer.ImportFailure):
                importer.upload(output, client, poll_seconds=0)

    def test_saved_image_positions_and_repeated_occurrences_are_verified(self):
        first = self.add_image('a.png')
        second = self.add_image('b.png', png(color=b'\xff\x00\x00'))
        data = conversation([
            message('one', kind='multimodal_text',
                    parts=['前', image_part('file_a'), '中', image_part('file_b', second.read_bytes()), '後', image_part('file_a')],
                    metadata={'attachments': [attachment('file_a', 'a.png'), attachment('file_b', 'b.png', second.read_bytes())]}),
            message('two', role='assistant', parts=['応答'], timestamp=9),
        ])
        output, manifest = self.prepare(data)
        doc = manifest['documents'][0]
        request = json.loads((output / doc['file']).read_text(encoding='utf8'))
        client = FakeApi()
        with redirect_stdout(io.StringIO()):
            importer.upload(output, client, poll_seconds=0)
        stored = client.documents[doc['document_id']]
        original = stored['original_text']
        a = '⟦hs-att:' + hashlib.sha256(first.read_bytes()).hexdigest()[:12] + '⟧'
        b = '⟦hs-att:' + hashlib.sha256(second.read_bytes()).hexdigest()[:12] + '⟧'
        self.assertIn('前\n\n' + a + '\n\n中\n\n' + b + '\n\n後\n\n' + a, original)
        self.assertEqual(len(stored['attachments']), 2)
        damaged = [
            original.replace(a, b, 1).replace('中\n\n' + b, '中\n\n' + a, 1),
            original.replace(a, '', 1),
            original.replace(a, '', 1) + a,
            original + a,
        ]
        for text in damaged:
            with self.subTest(text=text):
                stored['original_text'] = text
                with self.assertRaises(importer.ImportFailure):
                    importer.verify_document(client, doc, request)
        stored['original_text'] = original
        importer.verify_document(client, doc, request)

    def test_completed_operation_without_document_is_not_success(self):
        output, _ = self.prepare(conversation([message('one')]))
        client = FakeApi()
        with redirect_stdout(io.StringIO()):
            importer.upload(output, client, poll_seconds=0)
        with patch.object(client, 'document', side_effect=importer.ImportFailure('HTTP 404')):
            with redirect_stdout(io.StringIO()), self.assertRaises(importer.ImportFailure):
                importer.upload(output, client, poll_seconds=0)
        self.assertEqual(len(client.posts), 1)

    def test_http_request_uses_only_retain_namespace(self):
        client = importer.ApiClient('http://localhost:1', 'dev', 'token')
        response = io.BytesIO(b'{"ok":true}')
        with patch.object(importer, 'urlopen', return_value=response) as opened:
            client.request('POST', '/memories', {'items': []})
        request = opened.call_args.args[0]
        self.assertEqual(request.full_url, 'http://localhost:1/v1/default/banks/dev/memories')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.get_header('Authorization'), 'Bearer token')
        self.assertNotIn(b'token', request.data)


if __name__ == '__main__':
    unittest.main()

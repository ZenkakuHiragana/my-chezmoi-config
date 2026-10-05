#!/usr/bin/env python3
"""ChatGPT のローカル会話 JSON と画像を Hindsight Retain 用に変換・送信する。"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import uuid

DEFAULT_OUTPUT = Path('.opencode/work/chatgpt-hindsight-import/converted-markdown')
INTERNAL_CONTENT = {'thoughts', 'reasoning_recap', 'model_editable_context', 'user_editable_context'}


class ImportFailure(Exception):
    pass


def dump_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def epoch(value: object) -> float | None:
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except ValueError:
            pass
    return None


def iso_time(value: object) -> str | None:
    seconds = epoch(value)
    if seconds is None:
        return None
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def current_branch(conversation: dict) -> list[dict]:
    mapping = conversation.get('mapping')
    node_id = conversation.get('current_node')
    if not isinstance(mapping, dict) or not node_id:
        raise ImportFailure('mapping または current_node がない')
    nodes, visited = [], set()
    while node_id is not None:
        if node_id in visited:
            raise ImportFailure(f'会話の親参照が循環している: {node_id}')
        visited.add(node_id)
        if node_id not in mapping:
            raise ImportFailure(f'会話の親ノードがない: {node_id}')
        node = mapping[node_id]
        if not isinstance(node, dict) or 'parent' not in node:
            raise ImportFailure(f'会話ノードの形式が不正: {node_id}')
        nodes.append(node)
        node_id = node['parent']
    return list(reversed(nodes))


def is_visible(message: dict) -> bool:
    if message.get('author', {}).get('role') not in {'user', 'assistant'}:
        return False
    if message.get('metadata', {}).get('is_visually_hidden_from_conversation'):
        return False
    if message.get('recipient') not in (None, 'all'):
        return False
    if message.get('channel') in {'analysis', 'justify', 'confidence', 'summary'}:
        return False
    return message.get('content', {}).get('content_type') not in INTERNAL_CONTENT


def markdown_images(text: str):
    """括弧を含むローカル名も扱い、画像記法の原文範囲を返す。"""
    for match in re.finditer(r'!\[([^\]\n]*)\]\(', text):
        index, depth = match.end(), 1
        while index < len(text) and depth:
            char = text[index]
            if char == '\\':
                index += 2
                continue
            if char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
            index += 1
        if depth:
            continue
        target = text[match.end():index - 1].strip()
        if target.startswith('<') and '>' in target:
            target = target[1:target.index('>')]
        else:
            target = re.sub(r"""\s+(["']).*\1$""", '', target)
        yield match.start(), index, match.group(1), target


def image_info(path: Path) -> tuple[str, int, tuple[int, int] | None]:
    data = path.read_bytes()
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 24:
        return 'image/png', len(data), struct.unpack('>II', data[16:24])
    if data.startswith(b'\xff\xd8'):
        index = 2
        while index + 4 <= len(data):
            if data[index] != 0xff:
                index += 1
                continue
            while index < len(data) and data[index] == 0xff:
                index += 1
            if index >= len(data):
                break
            marker = data[index]
            index += 1
            if marker in {0xd8, 0xd9, 0x01} or 0xd0 <= marker <= 0xd7:
                continue
            if index + 2 > len(data):
                break
            length = int.from_bytes(data[index:index + 2], 'big')
            if length < 2:
                break
            if marker in {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf} and index + 7 <= len(data):
                height, width = struct.unpack('>HH', data[index + 3:index + 7])
                return 'image/jpeg', len(data), (width, height)
            index += length
        return 'image/jpeg', len(data), None
    if data.startswith((b'GIF87a', b'GIF89a')) and len(data) >= 10:
        return 'image/gif', len(data), struct.unpack('<HH', data[6:10])
    if data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        return 'image/webp', len(data), None
    raise ImportFailure(f'保存画像の形式を識別できない: {path}')


class AssetResolver:
    """JSON の添付情報を正本とし、Markdown の保存名を補助にする。"""

    def __init__(self, directory: Path, branch: list[dict]):
        self.root = (directory / 'images').resolve()
        if not self.root.is_relative_to(directory.resolve()):
            raise ImportFailure('images/ が会話フォルダ外を参照している')
        self.files = sorted(p.resolve() for p in self.root.iterdir() if p.is_file()) if self.root.is_dir() else []
        if any(not p.is_relative_to(self.root) for p in self.files):
            raise ImportFailure('画像ファイルが images/ 外を参照している')
        self.info = {p: image_info(p) for p in self.files}
        self.aliases: dict[str, set[Path]] = {}
        self.attachments: dict[str, dict] = {}
        self.names: dict[str, set[str]] = {}
        self.dimensions: dict[str, tuple] = {}
        role_messages = [n['message'] for n in branch if n.get('message') and n['message'].get('author', {}).get('role') in {'user', 'assistant'}]
        for message in role_messages:
            if not is_visible(message):
                continue
            for attachment in message.get('metadata', {}).get('attachments', []):
                if attachment.get('id'):
                    self.attachments[attachment['id']] = attachment
                    if attachment.get('name'):
                        self.names.setdefault(attachment['name'], set()).add(attachment['id'])
                    self.dimensions[attachment['id']] = (attachment.get('width'), attachment.get('height'))
        self.by_node: dict[str, list[Path | None]] = {}
        md = directory / 'conversation.md'
        if md.is_file():
            text = md.read_text(encoding='utf-8')
            for _, _, label, target in markdown_images(text):
                path = self.local_path(target)
                if path is not None:
                    self.aliases.setdefault(unquote(label), set()).add(path)
            headings = list(re.finditer(r'^## (User|Assistant)\s*$', text, re.MULTILINE))
            roles = [h.group(1).lower() for h in headings]
            if roles == [m['author']['role'] for m in role_messages]:
                for index, (heading, message) in enumerate(zip(headings, role_messages)):
                    end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
                    paths = [self.local_path(target) for _, _, _, target in markdown_images(text[heading.end():end])]
                    pointers = [p for p in message.get('content', {}).get('parts', []) if isinstance(p, dict) and p.get('content_type') == 'image_asset_pointer']
                    if len(paths) == len(pointers):
                        self.by_node[message.get('id')] = paths
        self.used: set[Path] = set()
        self.missing: list[dict] = []
        self.byte_size_changes: list[dict] = []

    def local_path(self, target: str) -> Path | None:
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc:
            return None
        relative = Path(unquote(parsed.path).replace('\\', '/'))
        if relative.is_absolute():
            return None
        path = (self.root.parent / relative).resolve()
        if not path.is_relative_to(self.root):
            return None
        return path if path in self.info else None

    def pointer(self, part: dict, message: dict) -> Path | None:
        pointer = part.get('asset_pointer', '')
        asset_id = pointer.rsplit('/', 1)[-1]
        attachment = self.attachments.get(asset_id, {})
        name = attachment.get('name')
        size = part.get('size_bytes') or attachment.get('size')
        dimensions = (part.get('width') or attachment.get('width'), part.get('height') or attachment.get('height'))
        candidates = {p for p in self.files if asset_id and asset_id in p.name}
        named = {p for p in self.files if name and p.name == name}
        named.update(self.aliases.get(name, set()))
        pointers = [p for p in message.get('content', {}).get('parts', []) if isinstance(p, dict) and p.get('content_type') == 'image_asset_pointer']
        paths = self.by_node.get(message.get('id'), [])
        if paths and part in pointers:
            local = paths[pointers.index(part)]
            if local is not None:
                named.add(local)
        if not candidates:
            if name and len(self.names.get(name, set())) == 1:
                # The export's explicit name remains authoritative after re-encoding.
                candidates = named
            else:
                exact = {p for p in named if self.info[p][1] == size and self.info[p][2] == dimensions}
                if exact:
                    candidates = exact
                elif all(dimensions) and sum(self.dimensions.get(i) == dimensions for i in self.names.get(name, set())) == 1:
                    candidates = {p for p in named if self.info[p][2] == dimensions}
                elif named and any(self.info[p][2] == dimensions for p in named):
                    raise ImportFailure(f'同名の複数画像を区別できない: {asset_id}')
        if not candidates and size and all(dimensions):
            if any(self.info[p][1] == size and self.info[p][2] == dimensions for p in self.files):
                raise ImportFailure(f'同じサイズの画像はあるが参照との対応を確認できない: {asset_id}')
        if len(candidates) > 1:
            hashes = {hashlib.sha256(p.read_bytes()).hexdigest() for p in candidates}
            if len(hashes) != 1:
                raise ImportFailure(f'画像参照に複数の保存画像が対応する: {asset_id}')
        if candidates:
            chosen = sorted(candidates)[0]
            if size and size != self.info[chosen][1]:
                self.byte_size_changes.append({'asset_pointer': pointer, 'path': str(chosen), 'reported_bytes': size, 'saved_bytes': self.info[chosen][1]})
            return chosen
        self.missing.append({'node_id': message.get('id'), 'asset_pointer': pointer, 'name': name})
        return None

    def block(self, path: Path) -> dict:
        self.used.add(path)
        return {'type': 'image', 'source': {'type': 'base64', 'media_type': self.info[path][0], 'data': base64.b64encode(path.read_bytes()).decode('ascii')}}


def append_text(blocks: list[dict], text: str) -> None:
    if text:
        if blocks and blocks[-1]['type'] == 'text':
            blocks[-1]['text'] += text
        else:
            blocks.append({'type': 'text', 'text': text})


def convert_conversation(conversation: dict, path: Path, collection: str) -> tuple[dict | None, dict]:
    branch = current_branch(conversation)
    messages = [n['message'] for n in branch if n.get('message') and is_visible(n['message'])]
    assets = AssetResolver(path.parent, branch)
    conversation_id = conversation.get('conversation_id') or conversation.get('id')
    if not isinstance(conversation_id, str) or not conversation_id:
        raise ImportFailure(f'会話 ID がない: {path}')

    turns, timestamps = [], []
    image_occurrences = 0
    for message in messages:
        content = message.get('content', {})
        kind = content.get('content_type')
        if kind in {'text', 'multimodal_text'}:
            parts = content.get('parts', [])
        elif kind == 'code':
            parts = [content.get('text', '')]
        else:
            raise ImportFailure(f'可視発言の未対応 content_type: {kind} ({message.get("id")})')
        if not parts:
            continue
        role = message['author']['role']
        timestamp = iso_time(message.get('create_time'))
        if timestamp:
            timestamps.append(timestamp)
        blocks = []
        source_text = []
        for part in parts:
            if isinstance(part, str):
                append_text(blocks, part)
                source_text.append(part)
            elif isinstance(part, dict) and part.get('content_type') == 'image_asset_pointer':
                resolved = assets.pointer(part, message)
                if resolved is not None:
                    blocks.append(assets.block(resolved))
                    image_occurrences += 1
            else:
                raise ImportFailure(f'可視発言の未対応 part: {part!r}'[:250])
        turns.append({'role': role, 'timestamp': timestamp, 'node_id': str(message.get('id', '')), 'content': ''.join(source_text), 'blocks': blocks})

    image_mode = image_occurrences > 0
    base_metadata = {'chatgpt_conversation_id': conversation_id, 'chatgpt_title': str(conversation.get('title', '')), 'source_folder': path.parent.parent.name, 'source_conversation': path.parent.name}
    document_id = 'chatgpt:' + conversation_id
    blocks = []
    append_text(blocks, '# ' + base_metadata['chatgpt_title'] + '\n')
    for turn in turns:
        label = 'User' if turn['role'] == 'user' else 'Assistant'
        append_text(blocks, f'\n## {label}\n\n<!-- message_id: {turn["node_id"]}; timestamp: {turn["timestamp"] or "unset"} -->\n\n')
        for block in turn['blocks']:
            if block['type'] == 'text':
                append_text(blocks, block['text'])
            else:
                blocks.append(block)
        append_text(blocks, '\n')
    timestamp = timestamps[-1] if timestamps else iso_time(conversation.get('update_time')) or iso_time(conversation.get('create_time'))
    item = {'document_id': document_id, 'content': blocks, 'timestamp': timestamp or 'unset', 'context': 'Historical ChatGPT conversation. User is the human participant; Assistant is ChatGPT.', 'tags': ['source:chatgpt', 'collection:' + collection], 'metadata': base_metadata}
    request = {'items': [item], 'async': True}

    report = {'conversation_id': conversation_id, 'source': str(path), 'title': conversation.get('title', ''), 'turns': len(turns), 'missing_images': assets.missing, 'image_byte_size_changes': assets.byte_size_changes, 'used_image_files': [str(p) for p in sorted(assets.used)], 'unreferenced_image_files': [str(p) for p in assets.files if p not in assets.used], 'image_mode': image_mode}
    if not turns:
        return None, report
    report['timestamp'] = timestamps[-1] if timestamps else iso_time(conversation.get('update_time')) or iso_time(conversation.get('create_time')) or 'unset'
    report['image_occurrences'] = image_occurrences
    report['image_hashes'] = sorted({hashlib.sha256(base64.b64decode(block['source']['data'])).hexdigest() for item in request['items'] for block in item['content'] if block['type'] == 'image'})
    return request, report


def prepare(inputs: list[Path], output: Path, collection: str) -> dict:
    files = []
    for root in inputs:
        if not root.is_dir():
            raise ImportFailure(f'入力フォルダがない: {root}')
        files.extend(sorted(p / 'conversation.json' for p in root.iterdir() if p.is_dir() and (p / 'conversation.json').is_file()))
    if not files:
        raise ImportFailure('conversation.json が見つからない')
    output.mkdir(parents=True, exist_ok=True)
    selected, duplicates = {}, []
    for index, path in enumerate(files, 1):
        with path.open(encoding='utf-8') as source:
            conversation = json.load(source)
        conversation_id = conversation.get('conversation_id') or conversation.get('id')
        if not isinstance(conversation_id, str) or not conversation_id:
            raise ImportFailure(f'会話 ID がない: {path}')
        rank = (epoch(conversation.get('update_time')) or epoch(conversation.get('create_time')) or 0, epoch(conversation.get('__local_exported_at')) or 0, path.stat().st_mtime)
        previous = selected.get(conversation_id)
        if previous and rank <= tuple(previous['rank']):
            duplicates.append({'selected': previous['source'], 'discarded': str(path), 'conversation_id': conversation_id})
            continue
        request, report = convert_conversation(conversation, path, collection)
        if previous:
            duplicates.append({'selected': str(path), 'discarded': previous['source'], 'conversation_id': conversation_id})
        report['rank'] = list(rank)
        if request is not None:
            data = canonical_bytes(request)
            filename = hashlib.sha256(data).hexdigest() + '.json'
            (output / filename).write_bytes(data)
            report.update({'document_id': request['items'][0]['document_id'], 'file': filename, 'payload_sha256': hashlib.sha256(data).hexdigest(), 'payload_bytes': len(data), 'items_count': len(request['items'])})
        selected[conversation_id] = report
        if index % 25 == 0:
            print(f'変換: {index}/{len(files)}', flush=True)
    documents = sorted((x for x in selected.values() if x.get('file')), key=lambda x: (x['timestamp'], x['document_id']))
    manifest = {'schema_version': 3, 'input_files': len(files), 'unique_conversations': len(selected), 'duplicates': duplicates, 'empty_conversations': [x for x in selected.values() if not x.get('file')], 'documents': documents}
    dump_json(output / 'manifest.json', manifest)
    print(json.dumps({'input_files': len(files), 'documents': len(documents), 'duplicates': len(duplicates), 'turns': sum(x['turns'] for x in documents), 'image_occurrences': sum(x['image_occurrences'] for x in documents), 'missing_images': sum(len(x['missing_images']) for x in documents), 'unreferenced_image_files': sum(len(x['unreferenced_image_files']) for x in documents), 'payload_bytes': sum(x['payload_bytes'] for x in documents)}, ensure_ascii=False), flush=True)
    return manifest


class ApiClient:
    def __init__(self, api_url: str, bank: str, token: str | None, timeout: float = 60):
        parts = urlsplit(api_url)
        if parts.scheme not in {'http', 'https'} or not parts.netloc or parts.username or parts.password:
            raise ImportFailure('API URL は認証情報を含まない HTTP(S) URL にする')
        self.url = api_url.rstrip('/')
        self.bank = bank
        self.token = token
        self.timeout = timeout
        self.prefix = '/v1/default/banks/' + quote(bank, safe='')

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        data = None
        if body is not None:
            data = canonical_bytes(body)
            headers['Content-Type'] = 'application/json'
        request = Request(self.url + self.prefix + path, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except HTTPError as error:
            detail = error.read(1024).decode('utf-8', errors='replace')
            raise ImportFailure(f'{method} {path}: HTTP {error.code}: {detail}') from error
        except (URLError, TimeoutError) as error:
            raise ImportFailure(f'{method} {path}: {error}') from error

    def operation(self, operation_id: str) -> dict:
        return self.request('GET', '/operations/' + quote(operation_id, safe=''))

    def document(self, document_id: str) -> dict:
        return self.request('GET', '/documents/' + quote(document_id, safe=''))


def operation_id_for(client: ApiClient, document: dict) -> str:
    # API-supported idempotency: a lost acknowledgement does not create duplicate work.
    identity = client.url + '\n' + client.bank + '\n' + document['payload_sha256']
    return str(uuid.uuid5(uuid.NAMESPACE_URL, identity))


def verify_document(client: ApiClient, document: dict, request: dict) -> dict:
    actual = client.document(document['document_id'])
    if actual.get('id') != document['document_id'] or actual.get('bank_id') != client.bank:
        raise ImportFailure('取得した文書 ID / bank が一致しない')
    metadata = actual.get('document_metadata') or {}
    if metadata.get('chatgpt_conversation_id') != document['conversation_id']:
        raise ImportFailure(f'取り込まれた文書の出所が一致しない: {document["document_id"]}')
    original = actual.get('original_text')
    if not isinstance(original, str):
        raise ImportFailure(f'原文が保存されていない: {document["document_id"]}')
    expected = ''
    after_image = False
    # Hindsight 0.10.2 represents each stored image in original_text by its
    # SHA-256 prefix, separated from adjacent content by a paragraph break.
    # Compare the entire body, not merely text order or the set of image hashes.
    for block in request['items'][0]['content']:
        if block['type'] == 'image' or after_image:
            if expected:
                expected = expected.rstrip('\n') + '\n\n'
        if block['type'] == 'text':
            expected += block['text']
            after_image = False
        else:
            digest = hashlib.sha256(base64.b64decode(block['source']['data'], validate=True)).hexdigest()
            expected += f'⟦hs-att:{digest[:12]}⟧'
            after_image = True
    if original != expected:
        raise ImportFailure(f'保存された本文・画像の位置または出現回数が一致しない: {document["document_id"]}')
    hashes = {x['hash'] for x in actual.get('attachments') or [] if x.get('kind') == 'image'}
    if hashes != set(document['image_hashes']):
        raise ImportFailure(f'取り込まれた画像が一致しない: {document["document_id"]}')
    return {'memory_unit_count': actual.get('memory_unit_count'), 'stored_images': len(hashes)}


def upload(output: Path, client: ApiClient, poll_seconds: float = 5, only: str | None = None) -> dict:
    manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema_version') != 3:
        raise ImportFailure('古い変換形式は送信しない。現行の convert で再生成すること')
    documents = [d for d in manifest['documents'] if only is None or d['document_id'] == only]
    if only is not None and not documents:
        raise ImportFailure(f'対象文書が manifest にない: {only}')
    progress_name = 'upload-' + hashlib.sha256((client.url + '\n' + client.bank).encode()).hexdigest()[:16] + '.json'
    progress_path = output / progress_name
    report = json.loads(progress_path.read_text(encoding='utf-8')) if progress_path.is_file() else {'bank_id': client.bank, 'api_url': client.url, 'documents': {}}
    active, failures = {}, []
    # Submit to Hindsight's persistent queue first. Acknowledgement is enough
    # to send the next document; worker and LLM concurrency belong to the server.
    for document in documents:
        data = (output / document['file']).read_bytes()
        if hashlib.sha256(data).hexdigest() != document['payload_sha256']:
            raise ImportFailure(f'変換済みファイルが manifest と一致しない: {document["file"]}')
        request = json.loads(data)
        if request.get('async') is not True or len(request.get('items', [])) != 1:
            raise ImportFailure(f'一会話一入力の非同期要求ではない: {document["document_id"]}')
        operation_id = operation_id_for(client, document)
        state = {'operation_id': operation_id, 'status': 'submitting', 'payload_sha256': document['payload_sha256']}
        report['documents'][document['document_id']] = state
        dump_json(progress_path, report)
        existing = client.operation(operation_id)
        if existing['status'] == 'not_found':
            request['operation_id'] = operation_id
            receipt = client.request('POST', '/memories', request)
            if not receipt.get('success') or receipt.get('bank_id') != client.bank or receipt.get('operation_id') != operation_id:
                raise ImportFailure(f'取り込みの受領情報が不正: {document["document_id"]}')
            state['status'] = 'pending'
            print(f'受付: {document["document_id"]} {document["title"]}', flush=True)
        else:
            if existing['status'] not in {'pending', 'processing', 'completed', 'failed', 'cancelled'}:
                raise ImportFailure(f'不明な処理状態: {existing["status"]}')
            state['status'] = 'awaiting_verification' if existing['status'] == 'completed' else existing['status']
            state['error_message'] = existing.get('error_message')
            print(f'既存処理: {document["document_id"]} {existing["status"]}', flush=True)
        active[operation_id] = document
        dump_json(progress_path, report)

    # An accepted operation is not a completed import. Poll and verify every
    # document, including ones accepted/completed before this process started.
    while active:
        for operation_id, document in list(active.items()):
            status = client.operation(operation_id)
            state = report['documents'][document['document_id']]
            previous_status = state['status']
            state['status'] = status['status']
            state['error_message'] = status.get('error_message')
            if status['status'] == 'completed':
                if any(c['status'] != 'completed' for c in status.get('child_operations') or []):
                    raise ImportFailure(f'子処理が完了していない: {operation_id}')
                try:
                    request = json.loads((output / document['file']).read_text(encoding='utf-8'))
                    state.update(verify_document(client, document, request))
                except ImportFailure as error:
                    state['status'], state['error_message'] = 'verification_failed', str(error)
                    failures.append(document['document_id'])
                del active[operation_id]
            elif status['status'] in {'failed', 'cancelled', 'not_found'}:
                failures.append(document['document_id'])
                del active[operation_id]
            elif status['status'] not in {'pending', 'processing'}:
                raise ImportFailure(f'不明な処理状態: {status["status"]}')
            if state['status'] != previous_status:
                print(f'{state["status"]}: {document["document_id"]}', flush=True)
        dump_json(progress_path, report)
        if active:
            time.sleep(poll_seconds)
    summary = {'bank_id': client.bank, 'documents': len(documents), 'completed': sum(report['documents'][d['document_id']]['status'] == 'completed' for d in documents), 'failed': failures, 'stored_images': sum(report['documents'][d['document_id']].get('stored_images', 0) for d in documents), 'memory_units': sum(report['documents'][d['document_id']].get('memory_unit_count', 0) or 0 for d in documents)}
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    if failures:
        raise ImportFailure(f'取り込みが完了していない文書がある。記録: {progress_path}')
    return summary


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('1 以上を指定する')
    return number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    convert = commands.add_parser('convert', help='JSON と画像を変換する。サーバーには送信しない')
    convert.add_argument('inputs', type=Path, nargs='+')
    convert.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    convert.add_argument('--collection', default='chatgpt-ai', help='出所タグの collection 名。内容分類ではない')
    send = commands.add_parser('upload', help='変換済み文書を送信し、処理完了と保存画像を確認する')
    send.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    send.add_argument('--api-url', default=os.environ.get('HINDSIGHT_API_URL', 'http://localhost:8888'))
    send.add_argument('--bank', default='dev')
    send.add_argument('--only', help='文書 ID を指定し、その会話だけ送信する')
    send.add_argument('--request-timeout', type=positive_int, default=1800, help='HTTP 要求ごとの待機秒数')
    args = parser.parse_args(argv)
    try:
        if args.command == 'convert':
            prepare(args.inputs, args.output, args.collection)
        else:
            upload(args.output, ApiClient(args.api_url, args.bank, os.environ.get('HINDSIGHT_API_TOKEN'), timeout=args.request_timeout), only=args.only)
        return 0
    except (ImportFailure, OSError, ValueError, KeyError) as error:
        print(f'失敗: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

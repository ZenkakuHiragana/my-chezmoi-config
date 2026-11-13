#!/usr/bin/env python3
"""ChatGPT Local Backup の会話を Meilisearch の会話インデックスへ取り込む。

入力は scripts/chatgpt-local-backup-v0.4.0.user.js が出力する ZIP、または
それを展開したフォルダ。どちらも会話ごとに conversation.json を持つ。
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import sys
from typing import Iterator
import zipfile

from import_chatgpt_hindsight import ImportFailure, epoch, is_visible
from meilisearch_conversations import Batch, add_common_args, run

MANIFEST = 'backup-manifest.json'


@dataclass(frozen=True)
class Origin:
    source_path: str
    member: str | None = None  # path inside the ZIP; None for an extracted folder
    project: str | None = None

    @property
    def label(self) -> str:
        return f'{self.source_path}!{self.member}' if self.member else self.source_path

    def load(self) -> dict:
        if self.member is None:
            data = Path(self.source_path).read_bytes()
        else:
            with zipfile.ZipFile(self.source_path) as archive:
                data = archive.read(self.member)
        conversation = json.loads(data)
        if not isinstance(conversation, dict):
            raise ImportFailure('conversation.json が JSON オブジェクトではない')
        return conversation


def conversation_id_of(conversation: dict) -> str:
    conversation_id = conversation.get('conversation_id') or conversation.get('id')
    if not isinstance(conversation_id, str) or not conversation_id:
        raise ImportFailure('会話 ID がない')
    return conversation_id


def rank(conversation: dict) -> tuple[float, float]:
    """Order of copies of one conversation: update_time (or create_time), then __local_exported_at."""
    updated = seconds(conversation.get('update_time')) or seconds(conversation.get('create_time')) or 0
    return updated, seconds(conversation.get('__local_exported_at')) or 0


def seconds(value: object) -> float | None:
    """Unix seconds from a number, a numeric string or an ISO 8601 string."""
    if isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return epoch(value)
        return number if math.isfinite(number) else None
    number = epoch(value)
    return number if number is not None and math.isfinite(number) else None


def iter_origins(inputs: list[Path]) -> Iterator[Origin | Batch]:
    """Yield an Origin per conversation.json, or a failed Batch for an unreadable input."""
    for path in inputs:
        try:
            yield from origins_in(path)
        except Exception as error:  # one unreadable input must not stop the others
            yield Batch(str(path), error=f'読めない入力 ({type(error).__name__}: {error})')


def origins_in(path: Path) -> Iterator[Origin | Batch]:
    resolved = path.resolve()
    if resolved.is_dir():
        unreadable: list[OSError] = []
        files = sorted(Path(folder) / 'conversation.json'
                       for folder, _, names in os.walk(resolved, onerror=unreadable.append)
                       if 'conversation.json' in names)
        for error in unreadable:  # rglob() would skip these folders silently
            yield Batch(str(error.filename or path), error=f'フォルダを読めない ({error})')
        if not files and not unreadable:
            yield Batch(str(path), error='conversation.json が見つからない')
        for file in files:
            yield Origin(str(file))
        return
    project = None
    with zipfile.ZipFile(resolved) as archive:
        names = archive.namelist()
        if MANIFEST in names:
            try:
                project = json.loads(archive.read(MANIFEST)).get('projectName')
            except Exception as error:
                # The conversations are still readable; only the project name is lost.
                yield Batch(f'{path}!{MANIFEST}', error=f'project を読めない ({type(error).__name__}: {error})')
    project = project if isinstance(project, str) else None
    members = sorted(name for name in names if name == 'conversation.json' or name.endswith('/conversation.json'))
    if not members:
        yield Batch(str(path), error='conversation.json が見つからない')
    for name in members:
        yield Origin(str(resolved), name, project)


def current_branch(conversation: dict) -> list[dict]:
    """The rule of currentBranch() in chatgpt-local-backup-v0.4.0.user.js.

    mapping may be an object or an array. Without a usable current_node, the most
    recently created leaf is used. A cycle or a missing parent ends the walk.
    Differences from the userscript: a conversation without mapping is an error rather
    than empty, and a non-numeric create_time (an ISO string, never seen in exports so
    far) is compared as a date, where the userscript's Number() would give NaN.
    """
    mapping = conversation.get('mapping')
    if isinstance(mapping, list):
        nodes = {node['id']: node for node in mapping if isinstance(node, dict) and 'id' in node}
    elif isinstance(mapping, dict):
        nodes = {node_id: {'id': node_id, **node} for node_id, node in mapping.items() if isinstance(node, dict)}
    else:
        raise ImportFailure('mapping がない')
    node_id = conversation.get('current_node')
    if not node_id or node_id not in nodes:
        parents = {node.get('parent') for node in nodes.values()}
        leaves = [node for node in nodes.values() if node['id'] not in parents]

        def created(node: dict) -> float:
            message = node.get('message')
            return (seconds(message.get('create_time')) or 0) if isinstance(message, dict) else 0

        node_id = max(leaves, key=created)['id'] if leaves else None
    path, seen = [], set()
    while node_id and node_id in nodes and node_id not in seen:
        seen.add(node_id)
        path.append(nodes[node_id])
        node_id = nodes[node_id].get('parent')
    return list(reversed(path))


def visible(message: dict) -> bool:
    # is_visible drops tool calls, tool output and reasoning; the extractor also hides
    # contextual-answers system messages.
    return is_visible(message) and not message.get('metadata', {}).get('is_contextual_answers_system_message')


def message_text(message: dict) -> str:
    """Same rule as textOf() in chatgpt-local-backup-v0.4.0.user.js."""
    content = message.get('content') or {}
    parts = content.get('parts') if isinstance(content.get('parts'), list) else []
    texts = []
    for part in parts:
        if isinstance(part, str):
            texts.append(part)
        elif isinstance(part, dict) and isinstance(part.get('text'), str):
            texts.append(part['text'])
    if not parts and isinstance(content.get('text'), str):
        texts.append(content['text'])
    return '\n'.join(texts).strip()


def convert_conversation(conversation: dict, origin: Origin) -> list[dict]:
    """One document per visible user message and the visible assistant text after it."""
    conversation_id = conversation_id_of(conversation)
    turns = []
    for node in current_branch(conversation):
        message = node.get('message')
        if not isinstance(message, dict) or not visible(message):
            continue
        text = message_text(message)
        if message['author']['role'] == 'user':
            turns.append({'message': message, 'question': text, 'replies': []})
        elif turns and text:
            turns[-1]['replies'].append(text)

    title = conversation.get('title')
    documents = []
    for turn in turns:
        if not turn['replies']:
            continue
        message_id = turn['message'].get('id')
        if not isinstance(message_id, str) or not message_id:
            raise ImportFailure('ユーザー発言の ID がない')
        document = {
            'id': f'chatgpt_{conversation_id}_{message_id}',
            'source': 'chatgpt',
            'conversation_id': conversation_id,
            'message_id': message_id,
            'question': turn['question'],
            'reply': '\n\n'.join(turn['replies']),
            'source_path': origin.source_path,
        }
        created = seconds(turn['message'].get('create_time'))
        if created is not None:
            document['timestamp'] = round(created * 1000)
        if isinstance(title, str) and title:
            document['title'] = title
        if origin.member is not None:
            document['source_member'] = origin.member
        if origin.project is not None:
            document['project'] = origin.project
        documents.append(document)
    return documents


def batches(inputs: list[Path]) -> Iterator[Batch]:
    # First pass keeps only (rank, origin) so that one conversation is in memory at a time.
    selected: dict[str, tuple[tuple[float, float], Origin]] = {}
    for origin in iter_origins(inputs):
        if isinstance(origin, Batch):
            yield origin
            continue
        try:
            conversation = origin.load()
            conversation_id = conversation_id_of(conversation)
            candidate = (rank(conversation), origin)
        except Exception as failure:  # one malformed conversation must not stop the others
            yield Batch(origin.label, error=f'{type(failure).__name__}: {failure}')
            continue
        if conversation_id not in selected or candidate[0] > selected[conversation_id][0]:
            selected[conversation_id] = candidate
    for conversation_id, (_, origin) in selected.items():
        try:
            documents = convert_conversation(origin.load(), origin)
        except Exception as failure:  # one malformed conversation must not stop the others
            yield Batch(f'{conversation_id} ({origin.label})', error=f'{type(failure).__name__}: {failure}')
            continue
        yield Batch(f'{conversation_id} ({origin.label})', documents)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('inputs', nargs='+', type=Path, help='抽出スクリプトの ZIP、または展開済みフォルダ')
    add_common_args(parser)
    args = parser.parse_args(argv)
    return run(args, batches(args.inputs))


if __name__ == '__main__':
    sys.exit(main())

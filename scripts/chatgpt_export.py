"""Read ChatGPT Local Backup ZIPs and extracted conversations without a search backend."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import math
import os
from pathlib import Path
from typing import Iterator
import zipfile

MANIFEST = 'backup-manifest.json'
INTERNAL_CONTENT = {'thoughts', 'reasoning_recap', 'model_editable_context', 'user_editable_context'}


class ImportFailure(Exception):
    pass


@dataclass(frozen=True)
class ReadFailure:
    label: str
    error: str


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
            try:
                number = datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
            except ValueError:
                return None
        return number if math.isfinite(number) else None
    number = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
    return number if number is not None and math.isfinite(number) else None


def iter_origins(inputs: list[Path]) -> Iterator[Origin | ReadFailure]:
    """Yield an Origin per conversation.json, or a read failure for an unreadable input."""
    for path in inputs:
        try:
            yield from origins_in(path)
        except Exception as error:  # one unreadable input must not stop the others
            yield ReadFailure(str(path), error=f'読めない入力 ({type(error).__name__}: {error})')


def origins_in(path: Path) -> Iterator[Origin | ReadFailure]:
    resolved = path.resolve()
    if resolved.is_dir():
        unreadable: list[OSError] = []
        files = sorted(Path(folder) / 'conversation.json'
                       for folder, _, names in os.walk(resolved, onerror=unreadable.append)
                       if 'conversation.json' in names)
        for error in unreadable:  # rglob() would skip these folders silently
            yield ReadFailure(str(error.filename or path), error=f'フォルダを読めない ({error})')
        if not files and not unreadable:
            yield ReadFailure(str(path), error='conversation.json が見つからない')
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
                yield ReadFailure(f'{path}!{MANIFEST}', error=f'project を読めない ({type(error).__name__}: {error})')
    project = project if isinstance(project, str) else None
    members = sorted(name for name in names if name == 'conversation.json' or name.endswith('/conversation.json'))
    if not members:
        yield ReadFailure(str(path), error='conversation.json が見つからない')
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
    # Drop tool calls, tool output and reasoning; the extractor also hides
    # contextual-answers system messages.
    return (message.get('author', {}).get('role') in {'user', 'assistant'}
            and not message.get('metadata', {}).get('is_visually_hidden_from_conversation')
            and message.get('recipient') in (None, 'all')
            and message.get('channel') not in {'analysis', 'justify', 'confidence', 'summary'}
            and message.get('content', {}).get('content_type') not in INTERNAL_CONTENT
            and not message.get('metadata', {}).get('is_contextual_answers_system_message'))


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


def selected_conversations(inputs: list[Path]) -> Iterator[tuple[Origin, dict] | ReadFailure]:
    # Retain origins only during selection; load only the winning conversation again.
    selected: dict[str, tuple[tuple[float, float], Origin]] = {}
    for origin in iter_origins(inputs):
        if isinstance(origin, ReadFailure):
            yield origin
            continue
        try:
            conversation = origin.load()
            conversation_id = conversation_id_of(conversation)
            candidate = (rank(conversation), origin)
        except Exception as failure:
            yield ReadFailure(origin.label, f'{type(failure).__name__}: {failure}')
            continue
        if conversation_id not in selected or candidate[0] > selected[conversation_id][0]:
            selected[conversation_id] = candidate
    for conversation_id, (_, origin) in selected.items():
        try:
            conversation = origin.load()
        except Exception as failure:
            yield ReadFailure(f'{conversation_id} ({origin.label})', f'{type(failure).__name__}: {failure}')
            continue
        yield origin, conversation

#!/usr/bin/env python3
"""Pi のセッションを Meilisearch の会話インデックスへ取り込む。"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys
from typing import Iterator

from meilisearch_conversations import Batch, add_common_args, run

SESSIONS_ROOT = Path.home() / '.pi' / 'agent' / 'sessions'


def iter_session_files(paths: list[Path], root: Path) -> Iterator[tuple[Path, str | None]]:
    """Yield (path, error). Only <root>/<work folder>/<file>.jsonl is a top-level session.

    Subagent sessions live deeper (subagent-artifacts/*.jsonl and
    <parent session>/<id>/run-0/session.jsonl), so the depth check excludes them.
    """
    if not paths:
        try:
            top = sorted(os.scandir(root), key=lambda entry: entry.name)
        except FileNotFoundError:
            yield root, 'セッションのフォルダがない'
            return
        except OSError as error:
            yield root, f'フォルダを読めない ({error})'
            return
        for folder in top:
            if is_dir(folder) is False:
                continue  # a plain file directly under the sessions folder
            try:
                children = sorted(os.scandir(folder.path), key=lambda entry: entry.name)
            except OSError as error:
                yield Path(folder.path), f'フォルダを読めない ({error})'
                continue
            for child in children:
                if child.name.endswith('.jsonl') and is_dir(child) is not True:
                    yield Path(child.path), None
        return
    try:
        resolved_root = root.resolve()
    except OSError as error:
        yield root, f'セッションのフォルダを解決できない ({error})'
        return
    for path in paths:
        try:
            resolved = path.resolve()
            is_file = resolved.is_file()
        except OSError as error:
            yield path, f'パスを解決できない ({error})'
            continue
        if not is_file or resolved.suffix != '.jsonl':
            yield path, 'セッションファイル（.jsonl）が見つからない'
        elif resolved.parent.parent != resolved_root:
            yield path, f'{root} 直下の作業フォルダにあるセッションファイルではない'
        else:
            yield resolved, None


def is_dir(entry: os.DirEntry) -> bool | None:
    """True or False, or None when the type cannot be determined.

    Path.glob() and Path.is_dir() treat an undeterminable entry as absent and drop it
    silently; None keeps the entry so that reading it reports the error instead.
    """
    try:
        return entry.is_dir()
    except OSError:
        return None


def text_of(content: object) -> str:
    """Text blocks only: thinking and tool calls are dropped."""
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ''
    texts = (block['text'].strip() for block in content
             if isinstance(block, dict) and block.get('type') == 'text' and isinstance(block.get('text'), str))
    return '\n\n'.join(text for text in texts if text)


def epoch_ms(timestamp: object) -> int | None:
    if not isinstance(timestamp, str):
        return None
    try:
        return round(datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return None


def convert_session(path: Path) -> list[dict] | None:
    """One document per user message and the assistant text that answers it.

    Returns None when the file has no session header. Entries form a tree through
    parentId; each assistant message belongs to its nearest user ancestor, so
    replies on abandoned branches join the same turn. Tool results, custom
    messages and other entries are passed through as ancestors but never used as text.
    """
    entries = []
    with path.open('rb') as source:
        for number, line in enumerate(source, 1):
            try:
                entries.append(json.loads(line.decode('utf-8')))
            except (UnicodeDecodeError, json.JSONDecodeError):
                # Only a line without its newline can be the last line Pi is still writing;
                # it may even end in the middle of a UTF-8 character.
                if line.endswith(b'\n'):
                    raise ValueError(f'{number} 行目が JSON として読めない') from None
    if not entries or not isinstance(entries[0], dict) or entries[0].get('type') != 'session':
        return None
    header, entries = entries[0], [e for e in entries[1:] if isinstance(e, dict)]
    by_id = {e['id']: e for e in entries if 'id' in e}

    def role(entry: dict) -> str | None:
        message = entry.get('message') if entry.get('type') == 'message' else None
        return message.get('role') if isinstance(message, dict) else None

    def nearest_user(entry: dict) -> str | None:
        seen = set()
        parent = entry.get('parentId')
        while parent and parent not in seen:
            seen.add(parent)
            ancestor = by_id.get(parent)
            if ancestor is None:
                return None
            if role(ancestor) == 'user':
                return ancestor['id']
            parent = ancestor.get('parentId')
        return None

    turns: dict[str, dict] = {}
    title = None
    for entry in entries:
        if entry.get('type') == 'session_info' and isinstance(entry.get('name'), str):
            title = entry['name']
        kind = role(entry)
        if kind == 'user' and 'id' in entry:
            turns[entry['id']] = {'entry': entry, 'question': text_of(entry['message'].get('content')), 'replies': []}
        elif kind == 'assistant':
            text = text_of(entry['message'].get('content'))
            owner = nearest_user(entry) if text else None
            if owner in turns:
                turns[owner]['replies'].append(text)

    session_id = header.get('id')
    documents = []
    for entry_id, turn in turns.items():
        if not turn['replies']:
            continue
        document = {
            'id': f'pi_{session_id}_{entry_id}',
            'source': 'pi',
            'conversation_id': session_id,
            'message_id': entry_id,
            'question': turn['question'],
            'reply': '\n\n'.join(turn['replies']),
            'cwd': header.get('cwd'),
            'source_path': str(path.resolve()),
        }
        timestamp = epoch_ms(turn['entry'].get('timestamp'))
        if timestamp is not None:
            document['timestamp'] = timestamp
        if title is not None:
            document['title'] = title
        documents.append(document)
    return documents


def batches(paths: list[Path], root: Path | None = None) -> Iterator[Batch]:
    for path, error in iter_session_files(paths, SESSIONS_ROOT if root is None else root):
        if error is not None:
            yield Batch(str(path), error=error)
            continue
        try:
            documents = convert_session(path)
        except Exception as failure:  # one malformed session must not stop the others
            yield Batch(str(path), error=f'{type(failure).__name__}: {failure}')
            continue
        yield Batch(path.name, skipped=True) if documents is None else Batch(path.name, documents)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sessions', nargs='*', type=Path, help=f'取り込むセッションファイル。省略すると {SESSIONS_ROOT} 以下のすべて')
    add_common_args(parser)
    args = parser.parse_args(argv)
    return run(args, batches(args.sessions))


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""ChatGPT Local Backup の会話を Meilisearch の会話インデックスへ取り込む。

入力は scripts/chatgpt-local-backup-v0.4.0.user.js が出力する ZIP、または
それを展開したフォルダ。どちらも会話ごとに conversation.json を持つ。
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Iterator

from chatgpt_export import (ImportFailure, Origin, ReadFailure, conversation_id_of,
                            current_branch, message_text, seconds, selected_conversations, visible)
from meilisearch_conversations import Batch, add_common_args, run


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
    for result in selected_conversations(inputs):
        if isinstance(result, ReadFailure):
            yield Batch(result.label, error=result.error)
            continue
        origin, conversation = result
        label = origin.label
        try:
            label = f'{conversation_id_of(conversation)} ({origin.label})'
            documents = convert_conversation(conversation, origin)
        except Exception as failure:
            yield Batch(label, error=f'{type(failure).__name__}: {failure}')
            continue
        yield Batch(label, documents)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('inputs', nargs='+', type=Path, help='抽出スクリプトの ZIP、または展開済みフォルダ')
    add_common_args(parser)
    args = parser.parse_args(argv)
    return run(args, batches(args.inputs))


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Pi と ChatGPT の会話を Meilisearch の1つのインデックスへ送る共通部品。

文書の形、インデックス設定、送信と報告をここで決める。会話ログの読み方は
import_pi_meilisearch.py と import_chatgpt_meilisearch.py が持つ。
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from http.client import HTTPException
import json
import sys
import time
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_MEILI_URL = 'http://127.0.0.1:7700'
DEFAULT_INDEX = 'conversations'
# Meilisearch runs in Docker, so the host's Ollama is reached through host.docker.internal.
DEFAULT_EMBEDDER_URL = 'http://host.docker.internal:11434/api/embed'
EMBEDDING_MODEL = 'ruri-v3-310m:q8_0'
EMBEDDING_DIMENSIONS = 768
# Only the head of each field is embedded. Measured with Ruri v3, code and symbol-heavy
# text took about 0.50-0.54 tokens per character, so 14,000 characters in total come
# to about 7,600 tokens, under the 8,192-token context. Denser text (base64 and the
# like) can still exceed it; that conversation's task then fails as a whole. The
# question gets its own share so that a long reply cannot push it out entirely.
EMBEDDING_REPLY_CHARS = 12000
EMBEDDING_QUESTION_CHARS = 2000


def make_settings(embedder_url: str) -> dict:
    """Index settings. This code is the source of truth; each run applies it."""
    return {
        'searchableAttributes': ['question', 'reply', 'title'],
        'filterableAttributes': ['source', 'cwd', 'conversation_id', 'project', 'timestamp'],
        'sortableAttributes': ['timestamp'],
        'localizedAttributes': [{'locales': ['jpn', 'eng'], 'attributePatterns': ['question', 'reply', 'title']}],
        'embedders': {
            'ruri': {
                # Fragments (experimental "multimodal") let documents and queries carry
                # different Ruri v3 prefixes; documentTemplate cannot prefix queries.
                'source': 'rest',
                'url': embedder_url,
                'dimensions': EMBEDDING_DIMENSIONS,
                'request': {'model': EMBEDDING_MODEL, 'input': ['{{fragment}}', '{{..}}']},
                'response': {'embeddings': ['{{embedding}}', '{{..}}']},
                'indexingFragments': {
                    'doc': {
                        'value': f'検索文書: {{{{ doc.reply | truncate: {EMBEDDING_REPLY_CHARS} }}}}'
                                 f'\n\n{{{{ doc.question | truncate: {EMBEDDING_QUESTION_CHARS} }}}}',
                    },
                },
                'searchFragments': {'query': {'value': '検索クエリ: {{q}}'}},
            },
        },
    }


class MeiliError(Exception):
    """Meilisearch answered with an HTTP error."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class TaskFailed(MeiliError):
    """A task finished as failed or canceled. Its documents were not added."""


class MeilisearchClient:
    def __init__(self, url: str, timeout: float = 60, poll_seconds: float = 0.5):
        self.url = url.rstrip('/')
        self.timeout = timeout
        self.poll_seconds = poll_seconds

    def request(self, method: str, path: str, body: object = None) -> dict:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = Request(self.url + path, data=data, method=method, headers={'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except HTTPError as error:
            text = error.read().decode('utf-8', 'replace')
            try:
                text = json.loads(text).get('message', text)
            except (ValueError, AttributeError):
                pass
            raise MeiliError(f'HTTP {error.code}: {text}', error.code) from None
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            raise MeiliError(f'JSON でない応答: {raw[:200]!r}') from None

    def enqueue(self, method: str, path: str, body: object) -> int:
        """Send a request that creates a task and return the task's uid."""
        response = self.request(method, path, body)
        task_uid = response.get('taskUid') if isinstance(response, dict) else None
        if not isinstance(task_uid, int):
            raise MeiliError(f'taskUid のない応答: {response!r}'[:300])
        return task_uid

    def wait_task(self, task_uid: int) -> dict:
        """Poll until the task finishes. A failed task raises TaskFailed; an HTTP
        error while polling raises MeiliError because the task's outcome is unknown."""
        while True:
            task = self.request('GET', f'/tasks/{task_uid}')
            status = task.get('status') if isinstance(task, dict) else None
            if status == 'succeeded':
                return task
            if status in ('failed', 'canceled'):
                error = task.get('error')
                message = error.get('message') if isinstance(error, dict) else error
                raise TaskFailed(str(message or f'task {task_uid} {status}'))
            if status not in ('enqueued', 'processing'):
                raise MeiliError(f'task {task_uid} の状態が分からない: {task!r}'[:300])
            time.sleep(self.poll_seconds)


def prepare_index(client: MeilisearchClient, index: str, embedder_url: str) -> None:
    def run_task(what: str, method: str, path: str, body: object) -> None:
        task_uid = client.enqueue(method, path, body)
        print(f'wait {what} task={task_uid}', flush=True)
        try:
            client.wait_task(task_uid)
        except MeiliError as error:
            raise MeiliError(f'{what} task={task_uid}: {error}', error.status) from None

    client.request('PATCH', '/experimental-features', {'multimodal': True})
    try:
        client.request('GET', f'/indexes/{index}')
    except MeiliError as error:
        if error.status != 404:
            raise
        run_task(f'create index {index}', 'POST', '/indexes', {'uid': index, 'primaryKey': 'id'})
    run_task(f'settings {index}', 'PATCH', f'/indexes/{index}/settings', make_settings(embedder_url))


@dataclass
class Batch:
    """One conversation to import: its documents, or why it could not be read."""

    label: str
    documents: list[dict] = field(default_factory=list)
    error: str | None = None
    skipped: bool = False


# Errors after which the state of the server (and of any task in flight) is unknown.
CONNECTION_ERRORS = (URLError, ConnectionError, TimeoutError, HTTPException)


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--meili-url', default=DEFAULT_MEILI_URL, help=f'Meilisearch の URL（既定 {DEFAULT_MEILI_URL}）')
    parser.add_argument('--index', default=DEFAULT_INDEX, help=f'インデックス名（既定 {DEFAULT_INDEX}）')
    parser.add_argument('--embedder-url', default=DEFAULT_EMBEDDER_URL, help=f'Meilisearch から見た Ollama の埋め込み API（既定 {DEFAULT_EMBEDDER_URL}）')
    parser.add_argument('--dry-run', action='store_true', help='Meilisearch へ接続せず、変換だけを行う')


def run(args: argparse.Namespace, batches: Iterable[Batch], client: MeilisearchClient | None = None) -> int:
    """Import every batch and print a summary. Returns the process exit code.

    0: no conversation failed. 1: at least one conversation failed (others may have
    been imported). 2: aborted because Meilisearch could not be prepared or reached, or
    it became unknown whether a batch was accepted or how its task ended.
    With --dry-run nothing is sent, and "converted" lines replace "ok" lines.
    """
    for stream in (sys.stdout, sys.stderr):
        # Labels contain paths; a console or pipe in a legacy code page must not stop the run.
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(errors='backslashreplace')
    summary = {'dry_run': args.dry_run, 'conversations': 0, 'documents': 0, 'skipped': 0, 'failed': []}

    def failed(label: str, error: str, task_uid: int | None = None) -> None:
        entry = {'label': label, 'error': error}
        if task_uid is not None:
            entry['task'] = task_uid
        summary['failed'].append(entry)
        where = label if task_uid is None else f'{label} task={task_uid}'
        print(f'failed {where}: {error}', file=sys.stderr, flush=True)

    code = 0
    current = 'prepare'  # what was in progress, for the abort message
    try:
        if not args.dry_run:
            client = client or MeilisearchClient(args.meili_url)
            prepare_index(client, args.index, args.embedder_url)
        for batch in batches:
            if batch.skipped:
                summary['skipped'] += 1
                continue
            if batch.error is not None:
                failed(batch.label, batch.error)
                continue
            if batch.documents and not args.dry_run:
                current = batch.label
                try:
                    task_uid = client.enqueue('POST', f'/indexes/{args.index}/documents', batch.documents)
                except UnicodeError as error:  # not sent at all
                    failed(batch.label, f'{type(error).__name__}: {error}')
                    continue
                except MeiliError as error:
                    if error.status is None or error.status >= 500:
                        raise  # the request may have been accepted; its outcome is unknown
                    failed(batch.label, str(error))  # 4xx: rejected, no task was created
                    continue
                current = f'{batch.label} task={task_uid}'
                print(f'wait {current} docs={len(batch.documents)}', flush=True)
                try:
                    client.wait_task(task_uid)
                except TaskFailed as error:
                    failed(batch.label, str(error), task_uid)
                    continue
            summary['conversations'] += 1
            summary['documents'] += len(batch.documents)
            print(f'{"converted" if args.dry_run else "ok"} {batch.label} docs={len(batch.documents)}', flush=True)
    except (MeiliError, *CONNECTION_ERRORS) as error:
        print(f'aborted during {current}: {error}', file=sys.stderr, flush=True)
        code = 2
    if code == 0 and summary['failed']:
        code = 1
    # The summary is for machines: keep it valid JSON even where non-ASCII would be escaped.
    utf8 = (getattr(sys.stdout, 'encoding', None) or '').lower().replace('-', '') == 'utf8'
    print(json.dumps(summary, ensure_ascii=not utf8), flush=True)
    return code

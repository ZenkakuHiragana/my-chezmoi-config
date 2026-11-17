#!/usr/bin/env python3
"""ChatGPT の会話を Meilisearch の会話インデックスへ送る部品。

送信と報告をここで決める。会話の読取りと文書化は import_chatgpt_meilisearch.py と
chatgpt_export.py が担当する。インデックスの設定は containers/session-search/ の compose が当てる。
Pi のセッションは拡張 pi-session-index が同じインデックスへ送る。
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from http.client import HTTPException
import json
import os
import sys
import time
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_MEILI_URL = 'http://127.0.0.1:7700'
DEFAULT_INDEX = 'conversations'


class MeiliError(Exception):
    """Meilisearch answered with an HTTP error."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class TaskFailed(MeiliError):
    """A task finished as failed or canceled. Its documents were not added."""


class MeilisearchClient:
    def __init__(self, url: str, timeout: float = 60, poll_seconds: float = 0.5, api_key: str | None = None):
        self.url = url.rstrip('/')
        self.timeout = timeout
        self.poll_seconds = poll_seconds
        self.headers = {'Content-Type': 'application/json', **({'Authorization': f'Bearer {api_key}'} if api_key else {})}

    def request(self, method: str, path: str, body: object = None) -> dict:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = Request(self.url + path, data=data, method=method, headers=self.headers)
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
    # 既定の接続先は session.sh と拡張 pi-session-index と同じ環境変数で決める。
    parser.add_argument('--meili-url', default=os.environ.get('MEILISEARCH_URL') or DEFAULT_MEILI_URL,
                        help=f'Meilisearch の URL（既定は環境変数 MEILISEARCH_URL、なければ {DEFAULT_MEILI_URL}）')
    parser.add_argument('--index', default=os.environ.get('MEILISEARCH_INDEX') or DEFAULT_INDEX,
                        help=f'インデックス名（既定は環境変数 MEILISEARCH_INDEX、なければ {DEFAULT_INDEX}）')
    parser.add_argument('--dry-run', action='store_true', help='Meilisearch へ接続せず、変換だけを行う')


def run(args: argparse.Namespace, batches: Iterable[Batch], client: MeilisearchClient | None = None) -> int:
    """Import every batch and print a summary. Returns the process exit code.

    0: no conversation failed. 1: at least one conversation failed (others may have
    been imported). 2: aborted because Meilisearch could not be reached, or
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
    current = 'start'  # what was in progress, for the abort message
    try:
        if not args.dry_run:
            client = client or MeilisearchClient(args.meili_url, api_key=os.environ.get('MEILISEARCH_API_KEY'))
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
                    # The primary key only applies while the index has none; inference would fail
                    # because three fields (id, conversation_id, message_id) contain "id".
                    task_uid = client.enqueue('POST', f'/indexes/{args.index}/documents?primaryKey=id', batch.documents)
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

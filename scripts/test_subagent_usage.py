"""Offline tests for subagent.sh and subagent-usage.mjs. Run with: python -m unittest scripts.test_subagent_usage

subagent-usage.mjs gets synthetic Pi JSON events on stdin. subagent.sh runs with a fake pi on PATH
that prints prepared events. bash and node are the real commands. HOME and USERPROFILE point to a
temporary folder, so the real ledger is not touched. The variables subagent.sh sets for its child are
removed, so the tests also run from inside a subagent.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "dot_pi/agent/scripts"
COLLECTOR = SCRIPTS / "subagent-usage.mjs"
WRAPPER = SCRIPTS / "executable_subagent.sh"
# Windows の subprocess は PATH より先に System32 を探すので、WSL の bash.exe を避けて PATH 上の bash を使う。
BASH = shutil.which("bash")

AGENT = """---
description: テスト用
model: fake/model
thinking: low
read_only: false
---
テスト用のシステムプロンプト
"""

# 偽の pi。引数を FAKE_ARGS に書き、FAKE_PI で出力を選ぶ。依頼文は読み捨てる。
FAKE_PI = """#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE_ARGS"
cat > /dev/null
: > "$FAKE_STARTED"
case "$FAKE_PI" in
    normal) cat "$FAKE_EVENTS" ;;
    exit3) echo "pi failed" >&2; exit 3 ;;
    hang) head -c -1 "$FAKE_EVENTS"; sleep 60 ;;
esac
"""

# subagent.sh を起動する。偽の pi を PATH の先頭に置き、自分の PID を書いてから subagent.sh に置き換わる。
# Git Bash では PATH が POSIX 形式なので、bash の中でパスを直して足す。exec しても $$ は変わらない。
LAUNCHER = """posix() { cygpath -u "$1" 2> /dev/null || echo "$1"; }
PATH="$(posix "$FAKE_BIN"):$PATH"
echo $$ > "$(posix "$PID_FILE")"
exec bash "$(posix "$SUBAGENT_SCRIPT")" fake --name テスト "$@" 依頼
"""


def usage(total, cost=0.5, **fields):
    return {"input": total - 3, "output": 1, "cacheRead": 2, "cacheWrite": 0, "totalTokens": total,
            "cost": {"total": cost}, **fields}


def assistant(stop, text=None, total=0, **fields):
    content = [] if text is None else [{"type": "text", "text": text}]
    return {"type": "message_end", "message": {"role": "assistant", "stopReason": stop, "content": content,
                                                "usage": usage(total), **fields}}


def end(code):
    return {"type": "subagent_end", "code": code}


def jsonl(*events):
    return "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events)


class Home:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="subagent-usage-test-"))
        (self.dir / ".pi/agent").mkdir(parents=True)
        self.ledger = self.dir / ".pi/agent/subagent-usage.jsonl"
        inherited = {key: value for key, value in os.environ.items() if key not in ("PI_SUBAGENT_CHILD", "PI_SUBAGENT_RUN")}
        self.env = {**inherited, "HOME": str(self.dir), "USERPROFILE": str(self.dir), "PI_SESSION_ID": "parent-1"}

    def records(self):
        if not self.ledger.exists():
            return []
        return [json.loads(line) for line in self.ledger.read_text(encoding="utf-8").splitlines()]

    def remove(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.home = Home()
        self.addCleanup(self.home.remove)

    def collect(self, text, name="説明"):
        result = subprocess.run(["node", str(COLLECTOR), "general-fast", name, "fake/model", "low"],
                                input=text.encode("utf-8"), capture_output=True, env=self.home.env, timeout=30)
        records = self.home.records()
        return result, records[-1] if records else None

    def test_sums_turns_compaction_and_usage_entries(self):
        result, record = self.collect(jsonl(
            {"type": "session", "id": "s"},
            {"type": "message_end", "message": {"role": "user", "content": "問い"}},
            assistant("toolUse", total=10),
            {"type": "message_end", "message": {"role": "toolResult", "content": []}},
            {"type": "compaction_end", "result": {"usage": usage(100)}},
            {"type": "compaction_end", "aborted": True},
            {"type": "entry_appended", "entry": {"type": "usage", "kind": "cache_warm", "usage": usage(50)}},
            {"type": "entry_appended", "entry": {"type": "custom", "data": {}}},
            assistant("stop", "答え", total=20),
            end(0)))
        self.assertEqual((result.returncode, result.stdout.decode(), result.stderr.decode()), (0, "答え\n", ""))
        self.assertEqual(record["usage"], {
            "input": 168, "output": 4, "cacheRead": 8, "cacheWrite": 0,
            "reasoning": 0, "totalTokens": 180, "cost": 2.0})
        self.assertEqual(
            {key: record[key] for key in ("parentSession", "type", "name", "model", "thinking", "exitCode")},
            {
                "parentSession": "parent-1", "type": "general-fast", "name": "説明", "model": "fake/model",
                "thinking": "low", "exitCode": 0})

    def test_reasoning_is_summed_when_reported(self):
        event = assistant("stop", "a", total=5)
        event["message"]["usage"]["reasoning"] = 3
        _, record = self.collect(jsonl(event, assistant("stop", "b", total=5), end(0)))
        self.assertEqual(record["usage"]["reasoning"], 3)

    def test_failures_follow_print_mode(self):
        cases = [
            (assistant("error", errorMessage="API 失敗"), "", "API 失敗\n"),
            (assistant("aborted"), "", "Request aborted\n"),
            (assistant("length", "途中"), "途中\n", "Response was truncated: the model reached its output token limit.\n"),
        ]
        for event, stdout, stderr in cases:
            with self.subTest(stop=event["message"]["stopReason"]):
                result, record = self.collect(jsonl(event, end(0)))
                self.assertEqual(
                    (result.returncode, result.stdout.decode(), result.stderr.decode(), record["exitCode"]),
                    (1, stdout, stderr, 1))

    def test_nonzero_end_code_prints_nothing(self):
        result, record = self.collect(jsonl(assistant("stop", "出さない", total=4), end(3)))
        self.assertEqual((result.returncode, result.stdout, result.stderr, record["exitCode"]), (3, b"", b"", 3))
        self.assertEqual(record["usage"]["totalTokens"], 4)

    def test_interrupted_mid_line_counts_pending_usage_and_hides_the_line(self):
        text = jsonl(
            assistant("toolUse", total=10),
            {"type": "message_update", "usage": usage(7)},
            {"type": "message_update", "usage": usage(20)})
        text += '{"type":"message_start","message":{"role":"user","content":"秘密の依頼'
        text += "\n" + jsonl(end(124))
        result, record = self.collect(text)
        self.assertEqual((result.returncode, result.stdout, result.stderr, record["exitCode"]), (124, b"", b"", 124))
        self.assertEqual(record["usage"]["totalTokens"], 30)

    def test_finished_reply_drops_its_pending_usage(self):
        _, record = self.collect(jsonl({"type": "message_update", "usage": usage(7)}, assistant("stop", "x", total=9), end(0)))
        self.assertEqual(record["usage"]["totalTokens"], 9)

    def test_missing_end_record(self):
        result, record = self.collect(jsonl(assistant("stop", "y", total=4)))
        self.assertEqual((result.returncode, result.stdout, record["exitCode"]), (1, b"", None))

    def test_crlf_and_line_separator_in_text(self):
        text = jsonl(assistant("stop", "a\u2028b", total=4), end(0)).replace("\n", "\r\n")
        result, _ = self.collect(text)
        self.assertEqual(result.stdout.decode(), "a\u2028b\n")

    def test_empty_name_is_null(self):
        _, record = self.collect(jsonl(end(0)), name="")
        self.assertIsNone(record["name"])

    def test_unwritable_ledger_keeps_reply_and_exit_code(self):
        self.home.ledger.mkdir()
        result = subprocess.run(["node", str(COLLECTOR), "t", "", "m", "low"], input=jsonl(assistant("stop", "z"), end(0)).encode(),
                                capture_output=True, env=self.home.env, timeout=30)
        self.assertEqual((result.returncode, result.stdout.decode()), (0, "z\n"))
        self.assertIn("使用量を台帳", result.stderr.decode())

    def test_concurrent_appends_keep_whole_lines(self):
        # 長い説明で台帳の行を長くし、入力をすべて送ってから一斉に閉じて、追記の時刻を揃える。
        names = [f"{i:02d}" + "説明" * 2000 for i in range(12)]
        processes = []
        try:
            for name in names:
                processes.append(subprocess.Popen(
                    ["node", str(COLLECTOR), "t", name, "m", "low"], stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL, env=self.home.env))
            for process in processes:
                process.stdin.write(jsonl(assistant("stop", "z", total=1), end(0)).encode())
            for process in processes:
                process.stdin.close()
            for process in processes:
                process.wait(timeout=30)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        self.assertEqual(sorted(record["name"] for record in self.home.records()), names)


@unittest.skipUnless(BASH, "bash が無い")
class WrapperTest(unittest.TestCase):
    def setUp(self):
        self.home = Home()
        self.addCleanup(self.home.remove)
        work = self.home.dir / "scripts"
        (work / "agents").mkdir(parents=True)
        shutil.copy(WRAPPER, work / "subagent.sh")
        shutil.copy(COLLECTOR, work / "subagent-usage.mjs")
        (work / "agents/fake.md").write_text(AGENT, encoding="utf-8")
        bin_dir = self.home.dir / "bin"
        bin_dir.mkdir()
        (bin_dir / "pi").write_text(FAKE_PI, encoding="utf-8", newline="\n")
        (bin_dir / "pi").chmod(0o755)
        self.events = self.home.dir / "events.jsonl"
        self.script = work / "subagent.sh"
        self.pid_file = self.home.dir / "pid"
        self.args_file = self.home.dir / "args"
        self.started = self.home.dir / "started"
        self.launcher = self.home.dir / "launch.sh"
        self.launcher.write_text(LAUNCHER, encoding="utf-8", newline="\n")
        self.env = {**self.home.env, "FAKE_EVENTS": str(self.events), "FAKE_BIN": str(bin_dir),
                    "SUBAGENT_SCRIPT": str(self.script), "PID_FILE": str(self.pid_file),
                    "FAKE_ARGS": str(self.args_file), "FAKE_STARTED": str(self.started)}

    def start(self, mode, *args):
        process = subprocess.Popen(
            [BASH, self.launcher.as_posix(), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**self.env, "FAKE_PI": mode})
        self.addCleanup(self.stop, process)
        return process

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.kill()
            process.communicate()

    def wait_started(self):
        deadline = time.monotonic() + 20
        while not self.started.exists():
            self.assertLess(time.monotonic(), deadline, "偽の pi が起動しない")
            time.sleep(0.1)

    def run_wrapper(self, mode, *args, timeout=60):
        process = self.start(mode, *args)
        stdout, stderr = process.communicate(timeout=timeout)
        return process.returncode, stdout.decode(), stderr.decode()

    def test_reply_exit_code_and_ledger(self):
        self.events.write_text(jsonl(assistant("stop", "答え", total=7)), encoding="utf-8")
        self.assertEqual(self.run_wrapper("normal"), (0, "答え\n", ""))
        [record] = self.home.records()
        self.assertEqual(
            (record["type"], record["name"], record["exitCode"], record["usage"]["totalTokens"]),
            ("fake", "テスト", 0, 7))
        self.assertFalse((self.home.dir / ".pi/agent/subagent-sessions").exists())
        args = self.args_file.read_text(encoding="utf-8").splitlines()
        self.assertIn("--no-session", args)
        self.assertEqual(args[args.index("--mode") + 1], "json")
        self.assertNotIn("--session-dir", args)

    def test_api_error(self):
        self.events.write_text(jsonl(assistant("error", errorMessage="使えないモデル")), encoding="utf-8")
        self.assertEqual(self.run_wrapper("normal"), (1, "", "使えないモデル\n"))
        self.assertEqual(self.home.records()[-1]["exitCode"], 1)

    def test_pi_exit_code_is_kept(self):
        self.assertEqual(self.run_wrapper("exit3"), (3, "", "pi failed\n"))
        self.assertEqual(self.home.records()[-1]["exitCode"], 3)

    def test_timeout(self):
        self.events.write_text(jsonl(assistant("toolUse", total=5), {"type": "message_update", "usage": usage(9)}), encoding="utf-8")
        started = time.monotonic()
        code, stdout, stderr = self.run_wrapper("hang", "--timeout", "1")
        self.assertEqual((code, stdout, stderr), (124, "", "サブエージェントを 1 秒で停止した。\n"))
        self.assertLess(time.monotonic() - started, 30)
        record = self.home.records()[-1]
        self.assertEqual((record["exitCode"], record["usage"]["totalTokens"]), (124, 14))

    def test_terminated(self):
        self.events.write_text(jsonl(assistant("toolUse", total=5)), encoding="utf-8")
        process = self.start("hang")
        self.wait_started()
        subprocess.run([BASH, "-c", "kill -TERM " + self.pid_file.read_text().strip()], check=True)
        stdout, stderr = process.communicate(timeout=30)
        self.assertEqual((process.returncode, stdout.decode(), stderr.decode()), (130, "", "サブエージェントを中断した。\n"))
        self.assertEqual(self.home.records()[-1]["exitCode"], 130)


    def test_timeout_while_reply_is_not_read(self):
        # 子が終わった後、呼び出し元が最終応答を読まずに止まっていても、制限時間で終わる。
        # 台帳は最終応答を出す前に書くので、行は残り、exitCode は集計器が決めた 0 のまま。
        # 最終応答はパイプの容量より十分大きくする。見張りは 5 秒ごとに確かめるので、制限時間は早くても 5 秒後に効く。
        # 子の出力と集計器が台帳に書くまで（1MB の処理）はそれより十分短い前提で、間に合わなければ下の確認で失敗する。
        self.events.write_text(jsonl(assistant("stop", "x" * 1_000_000, total=3)), encoding="utf-8")
        process = self.start("normal", "--timeout", "1")
        deadline = time.monotonic() + 30
        # 子が終わって集計器が台帳に書いた（最終応答を出し始める）ところまで進んだことを確かめる。
        while not self.home.ledger.exists():
            self.assertLess(time.monotonic(), deadline, "台帳に書かれない")
            self.assertIsNone(process.poll(), "台帳に書く前に終わった")
            time.sleep(0.1)
        while process.poll() is None:
            self.assertLess(time.monotonic(), deadline, "制限時間で終わらない")
            time.sleep(0.2)
        _, stderr = process.communicate()
        self.assertEqual((process.returncode, stderr.decode()), (124, "サブエージェントを 1 秒で停止した。\n"))
        self.assertEqual(self.home.records()[-1]["exitCode"], 0)


if __name__ == "__main__":
    unittest.main()

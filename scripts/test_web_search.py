"""Offline integration tests for web_search.sh. No search process can reach a service."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "dot_pi/agent/scripts/executable_web_search.sh"
TEMP_ROOT = Path(os.environ["LOCALAPPDATA"]) / "Temp/pi" if os.environ.get("LOCALAPPDATA") else Path("/tmp/pi")

FAKE = r'''
import json, os, sys
kind, args = sys.argv[1], sys.argv[2:]
if kind == "curl":
    kind = "exa" if "-X" in args else "rustxng"
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as f:
    stdin_text = sys.stdin.buffer.read().decode("utf-8") if kind == "codex" else None
    f.write(json.dumps([kind, args, stdin_text]) + "\n")
if kind != "timeout":
    sys.stdout.buffer.write(os.environ.get("FAKE_" + kind.upper(), "").encode("utf-8"))
'''

# Functions, not PATH placement: Git Bash can otherwise prefer a real .exe.
WRAPPER = r'''
curl() { "$FAKE_PYTHON" "$FAKE_SCRIPT" curl "$@"; }
claude() { "$FAKE_PYTHON" "$FAKE_SCRIPT" claude "$@"; }
codex() { "$FAKE_PYTHON" "$FAKE_SCRIPT" codex "$@"; }
timeout() {
    "$FAKE_PYTHON" "$FAKE_SCRIPT" timeout "$@" || return
    shift
    "$@"
}
export -f curl claude codex timeout
script=$(cygpath -u "$WEB_SCRIPT" 2>/dev/null || printf '%s' "$WEB_SCRIPT")
if [ "${FAKE_QUERY+x}" = x ]; then set -- -- "$FAKE_QUERY"; fi
bash -c '
    for name in curl claude codex timeout; do
        declare -F "$name" >/dev/null || exit 99
    done
    source "$@"
' "$script" "$script" "$@"
'''


def rpc(text):
    return json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": text}]}})


class WebSearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        cls.tmp = tempfile.TemporaryDirectory(prefix="web-search-test-", dir=TEMP_ROOT)
        cls.root = Path(cls.tmp.name)
        cls.fake = cls.root / "fake.py"
        cls.fake.write_text(FAKE, encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_search(self, responses=None, args=("query",), extra=None):
        log = self.root / "calls.jsonl"
        log.write_text("", encoding="utf-8")
        env = os.environ.copy()
        for name in ("WEB_SEARCH_RUSTXNG_URL", "WEB_SEARCH_CLAUDE_MODEL", "WEB_SEARCH_CODEX_MODEL",
                     "FAKE_EXA", "FAKE_RUSTXNG", "FAKE_CLAUDE", "FAKE_CODEX", "FAKE_QUERY"):
            env.pop(name, None)
        env.update(FAKE_PYTHON=sys.executable, FAKE_SCRIPT=str(self.fake), FAKE_LOG=str(log), WEB_SCRIPT=str(SCRIPT), TMPDIR="/outside-allowed-temp")
        for key, value in (responses or {}).items():
            env["FAKE_" + key.upper()] = value
        env.update(extra or {})
        proc = subprocess.run([shutil.which("bash"), "-c", WRAPPER, "test", *args], env=env, text=True, encoding="utf-8", capture_output=True, timeout=30)
        calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
        return proc, calls

    def test_exa_json_sse_and_count(self):
        response = rpc("Title: A\nURL: https://example.com/a")
        # Several SSE events, including a multiline data JSON payload and a comment.
        sse = ': ping\r\ndata: {"jsonrpc":"2.0",\r\ndata: "method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: ' + response + '\r\n\r\n'
        for payload in (response, sse):
            with self.subTest(payload=payload):
                proc, calls = self.run_search({"exa": payload}, ("--max-results", "05", "hello"))
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertIn("検索手段: exa", proc.stdout)
                self.assertIn("URL: https://example.com/a", proc.stdout)
                self.assertEqual([x[0] for x in calls], ["exa"])
                argv = calls[0][1]
                request = json.loads(argv[argv.index("-d") + 1])
                self.assertEqual(request["params"]["arguments"]["numResults"], 5)
                self.assertIs(type(request["params"]["arguments"]["numResults"]), int)

    def test_mcp_batches_and_sse_line_endings(self):
        response = json.loads(rpc("batch result https://example.com/b"))
        notification = {"jsonrpc": "2.0", "method": "notifications/progress"}
        batch = json.dumps([notification, response])
        payloads = [batch]
        for ending in (chr(10), chr(13) + chr(10), chr(13)):
            payloads.append(chr(0xfeff) + "data: " + batch + ending + ending)
        for payload in payloads:
            with self.subTest(payload=payload):
                proc, calls = self.run_search({"exa": payload})
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertIn("https://example.com/b", proc.stdout)
                self.assertEqual([x[0] for x in calls], ["exa"])

    def test_option_like_queries(self):
        claude = json.dumps({"type": "user", "tool_use_result": {"results": [{"content": [{"title": "C", "url": "https://example.com/c"}]}]}})
        codex = json.dumps({"type": "item.completed", "item": {"type": "web_search", "results": [{"type": "text_result", "title": "D", "url": "https://example.com/d"}]}})
        rust = json.dumps({"results": [{"title": "R", "url": "https://example.com/r"}]})
        for query in ("-foo", "--version"):
            for backend, response in (("exa", rpc("exa result")), ("rustxng", rust), ("claude", claude), ("codex", codex)):
                with self.subTest(query=query, backend=backend):
                    proc, calls = self.run_search({backend: response}, ("--", query))
                    self.assertEqual(proc.returncode, 0, proc.stderr)
                    self.assertIn("検索手段: " + backend, proc.stdout)
                    request_args = calls[0][1]
                    request = json.loads(request_args[request_args.index("-d") + 1])
                    self.assertEqual(request["params"]["arguments"]["query"], query)
                    self.assertEqual(request["params"]["arguments"]["objective"], query)
                    if backend == "rustxng":
                        self.assertIn("q=" + query, calls[-1][1])
                    if backend == "claude":
                        self.assertEqual(calls[-1][1][-2:], ["--", query])
                    if backend == "codex":
                        self.assertEqual(calls[-1][1][-2:], ["--", "-"])
                        self.assertEqual(calls[-1][2], query)

    def test_codex_receives_exact_query_from_stdin(self):
        response = json.dumps({"type": "item.completed", "item": {"type": "web_search", "results": [
            {"type": "text_result", "title": "D", "url": "https://example.com/d"}]}})
        for query in ("-", "-foo", "--version", "日本語\n次行\n", "末尾\r\n"):
            with self.subTest(query=query):
                proc, calls = self.run_search({"codex": response}, args=(), extra={"FAKE_QUERY": query})
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertEqual(calls[-1][0], "codex")
                self.assertEqual(calls[-1][1][-2:], ["--", "-"])
                self.assertEqual(calls[-1][2], query)

    def test_sse_discards_only_the_unfinished_tail(self):
        a = rpc("Title: A\nURL: https://example.com/a")
        b = rpc("Title: B\nURL: https://example.com/b")
        rust = json.dumps({"results": [{"title": "R", "url": "https://example.com/r"}]})
        for ending in (chr(10), chr(13), chr(13)+chr(10)):
            incomplete = "data: " + a + ending
            proc, calls = self.run_search({"exa": incomplete, "rustxng": rust})
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("検索手段: rustxng", proc.stdout)
            self.assertNotIn("https://example.com/a", proc.stdout)
            complete_and_partial = "data: " + a + ending*2 + "data: " + b + ending
            proc, calls = self.run_search({"exa": complete_and_partial})
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("https://example.com/a", proc.stdout)
            self.assertNotIn("https://example.com/b", proc.stdout)
            self.assertEqual([c[0] for c in calls], ["exa"])

    def test_zero_no_external_calls(self):
        for count in ("0", "000"):
            proc, calls = self.run_search(args=("--max-results", count, "hello"))
            self.assertEqual((proc.returncode, proc.stdout, calls), (0, "", []))

    def test_rustxng_fallback_and_url(self):
        rust = json.dumps({"results": [{"title": "Rust", "url": "https://example.com/r", "content": "snippet"}]})
        for exa in (rpc("No search results found. Please try a different query."), 'data: ' + rpc("No search results found. Please try a different query.") + '\n\n', '{"error":{}}'):
            proc, calls = self.run_search({"exa": exa, "rustxng": rust}, extra={"WEB_SEARCH_RUSTXNG_URL": "http://fake.test/custom"})
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("検索手段: rustxng", proc.stdout)
            self.assertIn("URL: https://example.com/r", proc.stdout)
            self.assertEqual([x[0] for x in calls], ["exa", "rustxng"])
            self.assertIn("http://fake.test/custom", calls[1][1])

    def test_claude_raw_tool_and_model(self):
        event = {"type": "user", "tool_use_result": {"results": [{"content": [{"title": "Claude", "url": "https://example.com/c"}]}]}}
        response = json.dumps({"type": "assistant", "message": "summary must not appear"}) + '\n' + json.dumps(event)
        proc, calls = self.run_search({"claude": response}, extra={"WEB_SEARCH_CLAUDE_MODEL": "my-claude"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("URL: https://example.com/c", proc.stdout)
        self.assertNotIn("summary must not appear", proc.stdout)
        self.assertEqual([x[0] for x in calls], ["exa", "rustxng", "timeout", "claude"])
        self.assertIn("my-claude", calls[-1][1])

    def test_codex_official_event_and_isolation(self):
        event = {"type": "item.completed", "item": {"type": "web_search", "results": [{"type": "text_result", "title": "Search Result", "url": "https://example.com/search-result", "snippet": "A result snippet"}]}}
        proc, calls = self.run_search({"codex": json.dumps(event)}, extra={"WEB_SEARCH_CODEX_MODEL": "my-codex"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("検索手段: codex", proc.stdout)
        self.assertIn("URL: https://example.com/search-result", proc.stdout)
        self.assertIn("A result snippet", proc.stdout)
        self.assertEqual([x[0] for x in calls], ["exa", "rustxng", "timeout", "claude", "timeout", "codex"])
        argv = calls[-1][1]
        self.assertIn("my-codex", argv)
        self.assertIn("--search", argv)
        self.assertIn("--json", argv)
        self.assertIn("--ignore-user-config", argv)
        self.assertIn("project_doc_max_bytes=0", argv)
        self.assertTrue(any("standalone_web_search=true" in arg for arg in argv))
        self.assertNotIn("/outside-allowed-temp", argv[argv.index("-C") + 1])
        work = argv[argv.index("-C") + 1].replace("\\", "/").lower()
        self.assertTrue("/temp/pi/web-search-codex" in work or work.endswith("/tmp/pi/web-search-codex"), work)

    def test_hosted_and_assistant_are_not_results(self):
        events = '\n'.join([json.dumps({"type": "item.completed", "item": {"type": "web_search"}}), json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "fake summary"}})])
        proc, calls = self.run_search({"codex": events})
        self.assertEqual(proc.returncode, 1)
        self.assertNotIn("fake summary", proc.stdout)
        self.assertIn("codex: 結果なし", proc.stderr)
        self.assertEqual([x[0] for x in calls], ["exa", "rustxng", "timeout", "claude", "timeout", "codex"])
        self.assertIn("haiku", calls[3][1])
        self.assertIn("gpt-6-luna", calls[5][1])
        self.assertIn("http://127.0.0.1:29483/search", calls[1][1])

    def test_help_and_bad_count(self):
        proc, calls = self.run_search(args=("--help",))
        self.assertEqual(proc.returncode, 0)
        self.assertIn("WEB_SEARCH_CODEX_MODEL", proc.stdout)
        self.assertEqual(calls, [])
        proc, calls = self.run_search(args=("--max-results", "-1", "query"))
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()

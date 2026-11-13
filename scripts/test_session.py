"""Offline tests for session.sh. Run with: python -m unittest scripts.test_session

A fake Meilisearch (a local HTTP server) records each request and answers from a
queue of prepared responses. bash and node are the real commands.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import unittest
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "dot_pi/agent/scripts/executable_session.sh"
CONV = "01a149fd-cca5-760f-b33a-e1ce473155c1"
TARGET = f"pi_{CONV}_5d77358b"
DAY = 1794528000000  # 2026-11-13 00:00 UTC
SHOW_FIELDS = {"id", "source", "message_id", "timestamp", "title", "cwd", "project", "question", "reply",
               "source_path", "source_member"}


def hit(doc_id, message_id, timestamp=DAY, question="問い", reply="答え", **fields):
    return {"id": doc_id, "source": doc_id.split("_")[0], "message_id": message_id, "timestamp": timestamp,
            **fields, "_formatted": {"question": question, "reply": reply}}


def found(hits, **fields):
    return {"hits": hits, **fields}


def document(doc_id, question="問い", reply="答え", **fields):
    return {"id": doc_id, "source": doc_id.split("_")[0], "message_id": "m", "timestamp": DAY,
            "question": question, "reply": reply, "source_path": "D:\\log.zip", **fields}


class FakeMeilisearch:
    def __init__(self):
        self.responses, self.requests = [], []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def answer(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                url = urlsplit(self.path)
                fake.requests.append((self.command, unquote(url.path), parse_qs(url.query), body))
                status, value = fake.responses.pop(0) if fake.responses else (500, {"message": "no response queued"})
                data = json.dumps(value, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = answer

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def closed_port_url():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{s.getsockname()[1]}"


class SessionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = shutil.which("bash")
        if not cls.bash or not shutil.which("node"):
            raise unittest.SkipTest("bash and node are required")

    def setUp(self):
        self.fake = FakeMeilisearch()
        self.addCleanup(self.fake.close)
        self.env = {k: v for k, v in os.environ.items() if k not in ("PI_SESSION_ID", "MEILISEARCH_INDEX")}
        self.env.update(MEILISEARCH_URL=self.fake.url, TZ="UTC")

    def respond(self, *responses):
        """Queue responses in request order: a JSON value (200) or (status, JSON value)."""
        self.fake.responses += [r if isinstance(r, tuple) else (200, r) for r in responses]

    def run_cli(self, *args, stdin="", env=None, command=None):
        argv = [self.bash, "-c", command] if command else [self.bash, SCRIPT.as_posix(), *args]
        result = subprocess.run(argv, env={**self.env, **(env or {})}, cwd=ROOT, input=stdin.encode("utf-8"),
                                capture_output=True, timeout=30)
        return result.returncode, result.stdout.decode("utf-8"), result.stderr.decode("utf-8")

    def bodies(self):
        return [r[3] for r in self.fake.requests]

    def test_help(self):
        for args in [("--help",), ("-h",), ("search", "--help"), ("show", "-h")]:
            with self.subTest(args=args):
                code, out, err = self.run_cli(*args)
                self.assertEqual((code, err), (0, ""))
                self.assertTrue(out.startswith("使い方:"))
                self.assertIn("search QUERY", out)
                self.assertIn("show [--full]", out)
                self.assertIn("ID は検索結果", out)
                self.assertIn("「取得できる検索結果はここまでです」が末尾を示す", out)
                self.assertIn("「重複する結果のみ」の範囲は飛ばして次へ進める", out)
        self.assertEqual(self.fake.requests, [])

    def test_usage_errors(self):
        for args in [(), ("list",), ("search",), ("search", ""), ("search", "a", "b"), ("search", "q", "--source", "pi"),
                     ("search", "q", "--limit", "0"), ("search", "q", "--offset", "x"), ("search", "q", "--since", "2026-02-30"),
                     ("search", "q", "--limit"), ("search", "q", "--conversation", ""),
                     ("search", "q", "--conversation", "--since", "2026-01-01"), ("show", "--all"), ("toString",)]:
            with self.subTest(args=args):
                code, out, err = self.run_cli(*args)
                self.assertEqual((code, out), (2, ""), err)
        self.assertEqual(self.fake.requests, [])

    def test_search(self):
        hits = [hit("chatgpt_c1_m1", "m1", title="題名", project="proj", question="…一致\nした", reply="返答の周辺…"),
                hit("chatgpt_c2_m1", "m1", title="枝分かれ · 題名"),  # a copy: same message_id and timestamp
                hit("chatgpt_c3_m1", "m1", timestamp=DAY + 1),  # same message_id, another time: kept
                hit("pi_s1_e1", "e1", timestamp=DAY + 3600000, cwd="C:\\work\\repo"),
                hit("pi_s2_e2", "e2", timestamp=DAY),  # another message at the copy's time: kept
                {**hit("pi_s3_x", "x"), "timestamp": None}, {**hit("pi_s4_x", "x"), "timestamp": None},  # no time: kept
                hit("pi_s5_m1", "m1")]  # same key as chatgpt, but another source: kept
        self.respond(found(hits))
        code, out, err = self.run_cli("search", "グラフィック カード", "--limit", "8", env={"PI_SESSION_ID": "now"})
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "chatgpt_c1_m1  2026-11-13 00:00  chatgpt  「題名」  proj\n  Q: …一致 した\n  A: 返答の周辺…\n"
                              "chatgpt_c3_m1  2026-11-13 00:00  chatgpt\n  Q: 問い\n  A: 答え\n"
                              "pi_s1_e1  2026-11-13 01:00  pi  C:\\work\\repo\n  Q: 問い\n  A: 答え\n"
                              "pi_s2_e2  2026-11-13 00:00  pi\n  Q: 問い\n  A: 答え\n"
                              "pi_s3_x  日時不明  pi\n  Q: 問い\n  A: 答え\n"
                              "pi_s4_x  日時不明  pi\n  Q: 問い\n  A: 答え\n"
                              "pi_s5_m1  2026-11-13 00:00  pi\n  Q: 問い\n  A: 答え\n")
        [(method, path, _, body)] = self.fake.requests
        self.assertEqual((method, path), ("POST", "/indexes/conversations/search"))
        self.assertEqual(body["q"], "グラフィック カード")
        self.assertEqual((body["limit"], body["offset"]), (8, 0))
        self.assertIn('conversation_id != "now"', body["filter"])
        self.assertEqual(body["distinct"], "conversation_id")
        self.assertEqual(body["hybrid"]["embedder"], "ruri")
        self.assertTrue({"id", "source", "message_id", "timestamp", "title", "cwd", "project"}
                        <= set(body["attributesToRetrieve"]))
        self.assertEqual(set(body["attributesToCrop"]), {"question:20", "reply:40"})
        self.assertEqual(body["cropMarker"], "…")
        self.assertNotIn("showPerformanceDetails", body)
        self.assertNotIn("retrieveVectors", body)

    def test_copies_are_removed_across_pages_without_saved_state(self):
        first = hit("pi_first_m", "m")
        copy = hit("pi_fork_m", "m")
        other = hit("pi_next_n", "n")
        for offset, candidates, expected in [(0, [first], "pi_first_m"),
                                             (1, [first, copy], None),
                                             (2, [first, copy, other], "pi_next_n"),
                                             (3, [first, copy, other], None)]:
            with self.subTest(offset=offset):
                self.fake.requests.clear()
                self.respond(found(candidates))
                code, out, err = self.run_cli("search", "q", "--limit", "1", "--offset", str(offset))
                self.assertEqual(code, 0, err)
                if expected:
                    self.assertTrue(out.startswith(expected + "  "))
                    self.assertEqual(err, "")
                else:
                    self.assertEqual(out, "")
                    self.assertIn("重複する結果のみ" if offset == 1 else "取得できる検索結果はここまで", err)
                [body] = self.bodies()
                self.assertEqual((body["offset"], body["limit"]), (0, offset + 1))

        missing_time = hit("pi_missing_m", "m")
        del missing_time["timestamp"]
        for other in [hit("chatgpt_other_m", "m"), hit("pi_later_m", "m", timestamp=DAY + 1),
                      hit("pi_unknown_m", "m", timestamp=None), missing_time]:
            with self.subTest(id=other["id"]):
                self.fake.requests.clear()
                self.respond(found([first, other]))
                code, out, err = self.run_cli("search", "q", "--limit", "1", "--offset", "1")
                self.assertEqual((code, err), (0, ""))
                self.assertTrue(out.startswith(other["id"] + "  "))

    def test_period_limit_and_offset(self):
        self.respond(found([]))
        code, out, err = self.run_cli("search", "q", "--since", "2026-11-13", "--until", "2026-11-13", "--limit", "7",
                                      "--offset", "10", env={"TZ": "Asia/Tokyo"})
        self.assertEqual((code, out, err), (0, "", "session.sh: 取得できる検索結果はここまでです\n"))
        [body] = self.bodies()
        # the whole local day of 2026-11-13 in Tokyo; no PI_SESSION_ID, so nothing is excluded
        self.assertEqual(body["filter"], ["timestamp >= 1794495600000", "timestamp < 1794582000000"])
        self.assertEqual((body["limit"], body["offset"]), (17, 0))

    def test_semantic_responses_are_not_diagnosed(self):
        cases = [
            {"semanticHitCount": 1},
            {"semanticHitCount": 0},
            {},
            {"semanticHitCount": 0, "performanceDetails": {"embed query": "failed"}},
        ]
        for fields in cases:
            with self.subTest(fields=fields):
                self.fake.requests.clear()
                self.respond(found([hit("pi_s_a", "a")], **fields))
                code, out, err = self.run_cli("search", "q")
                self.assertEqual((code, err), (0, ""))
                self.assertIn("pi_s_a", out)
                self.assertEqual(len(self.fake.requests), 1)
                body = self.bodies()[0]
                self.assertNotIn("showPerformanceDetails", body)
                self.assertNotIn("retrieveVectors", body)

    def test_empty_semantic_result_is_success_without_diagnostic(self):
        self.respond(found([], semanticHitCount=0))
        code, out, err = self.run_cli("search", "q")
        self.assertEqual((code, out, err), (0, "", "session.sh: 該当するやり取りはありません\n"))
        self.assertEqual(len(self.fake.requests), 1)
        [body] = self.bodies()
        self.assertEqual((body["limit"], body["offset"]), (5, 0))

    def test_literal_query_and_filter_values(self):
        self.respond(found([]))
        code, _, err = self.run_cli("search", "--", "--help", env={"PI_SESSION_ID": 'session"\\name'})
        self.assertEqual(code, 0, err)
        [body] = self.bodies()
        self.assertEqual(body["q"], "--help")
        self.assertEqual(body["filter"], ["conversation_id != " + json.dumps('session"\\name')])

    def test_url_with_trailing_slash(self):
        self.respond(found([]))
        code, _, err = self.run_cli("search", "q", env={"MEILISEARCH_URL": self.fake.url + "/"})
        self.assertEqual(code, 0, err)
        self.assertEqual(self.fake.requests[0][1], "/indexes/conversations/search")

    def test_custom_index_environment(self):
        self.respond(found([]))
        code, _, _ = self.run_cli("search", "q", env={"MEILISEARCH_INDEX": "archive"})
        self.assertEqual(code, 0)
        self.assertEqual(self.fake.requests[0][1], "/indexes/archive/search")

    def test_conversation_listing(self):
        self.respond({"conversation_id": CONV},
                     found([hit(f"pi_{CONV}_a", "a"), hit(f"pi_{CONV}_b", "a")]))
        code, out, err = self.run_cli("search", "", "--conversation", TARGET, "--limit", "2", "--offset", "2",
                                      "--since", "2026-11-13", "--until", "2026-11-13",
                                      env={"PI_SESSION_ID": CONV})
        self.assertEqual((code, err), (0, ""))
        self.assertIn(f"pi_{CONV}_a", out)
        self.assertIn(f"pi_{CONV}_b", out)  # same-message copies remain
        self.assertEqual(len(self.fake.requests), 2)
        lookup, listing = self.fake.requests
        self.assertEqual((lookup[0], lookup[1]), ("GET", f"/indexes/conversations/documents/{TARGET}"))
        self.assertEqual((listing[0], listing[1]), ("POST", "/indexes/conversations/search"))
        body = listing[3]
        self.assertEqual(body["q"], "")
        self.assertEqual((body["limit"], body["offset"]), (2, 2))
        self.assertCountEqual(body["filter"], [f'conversation_id = "{CONV}"',
                              "timestamp >= 1794528000000", "timestamp < 1794614400000"])
        self.assertEqual(body["sort"], ["timestamp:asc"])
        self.assertNotIn("distinct", body)

    def test_empty_conversation_page_has_a_clear_end(self):
        for offset, message in [(0, "該当するやり取りはありません"), (3, "取得できる検索結果はここまでです")]:
            with self.subTest(offset=offset):
                self.fake.requests.clear()
                self.respond({"conversation_id": CONV}, found([]))
                code, out, err = self.run_cli("search", "", "--conversation", TARGET, "--offset", str(offset))
                self.assertEqual((code, out, err), (0, "", "session.sh: " + message + "\n"))
                self.assertEqual(len(self.fake.requests), 2)

    def test_conversation_search_with_a_query(self):
        self.respond({"conversation_id": CONV}, found([hit(f"pi_{CONV}_a", "a")]))
        code, out, err = self.run_cli("search", "シェーダー", "--conversation", TARGET)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(len(self.fake.requests), 2)
        body = self.bodies()[1]
        self.assertEqual(body["filter"], [f'conversation_id = "{CONV}"'])
        self.assertEqual(body["hybrid"], {"embedder": "ruri", "semanticRatio": 0.5})
        self.assertNotIn("sort", body)

    def test_failures(self):
        self.respond((404, {"message": f"Document `{TARGET}` not found."}))
        code, out, err = self.run_cli("search", "", "--conversation", TARGET)
        self.assertEqual((code, out, err), (1, "", f"session.sh: HTTP 404: Document `{TARGET}` not found.\n"))
        url = closed_port_url()
        code, out, err = self.run_cli("search", "q", env={"MEILISEARCH_URL": url})
        self.assertEqual((code, out, err), (1, "", f"session.sh: Meilisearch に接続できません: {url}\n"))

    def test_show(self):
        self.respond(document("chatgpt_c_m", question="い" * 2003, reply="一行目\n\n" + "あ" * 4000,
                              source_member="p/c/conversation.json", title="題"))
        code, out, err = self.run_cli("show", "chatgpt_c_m")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, "\n".join([
            "===== chatgpt_c_m  2026-11-13 00:00  chatgpt  「題」",
            "元ログ: D:\\log.zip の p/c/conversation.json（発言 ID m）",
            "--- Q", "い" * 2000, "…（以下 3 字を省略。全文は --full）",
            "--- A", "一行目", "", "あ" * 3995, "…（以下 5 字を省略。全文は --full）", ""]))
        [(method, path, query, _)] = self.fake.requests
        self.assertEqual((method, path), ("GET", "/indexes/conversations/documents/chatgpt_c_m"))
        self.assertEqual(set(query["fields"][0].split(",")), SHOW_FIELDS)
        self.respond(document("chatgpt_c_m", question="い" * 2003, reply="あ" * 4001))
        code, out, err = self.run_cli("show", "--full", "chatgpt_c_m")
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.endswith("--- Q\n" + "い" * 2003 + "\n--- A\n" + "あ" * 4001 + "\n"))
        # characters outside the BMP count as one character and are not split
        self.respond(document("chatgpt_c_m", reply="😀" * 4001))
        code, out, err = self.run_cli("show", "chatgpt_c_m")
        self.assertTrue(out.endswith("--- A\n" + "😀" * 4000 + "\n…（以下 1 字を省略。全文は --full）\n"))

    def test_show_reads_ids_from_search_output(self):
        search_output = ("pi_s_a  2026-11-13 00:00  pi  C:\\w\r\n  Q: pi_fake\n  A: chatgpt_fake\n"
                         "chatgpt_c_b  2026-11-13 00:00  chatgpt\n  Q: x\n  A: y")  # CRLF and no final newline
        self.respond((404, {"message": "Document `pi_s_a` not found."}), document("chatgpt_c_b"))
        code, out, err = self.run_cli("show", stdin=search_output)
        self.assertEqual(code, 1)  # one ID could not be read; the other is still shown
        self.assertTrue(out.startswith("===== chatgpt_c_b  "))
        self.assertEqual(err, "session.sh: pi_s_a: HTTP 404: Document `pi_s_a` not found.\n")
        self.assertEqual([r[1] for r in self.fake.requests],
                         ["/indexes/conversations/documents/pi_s_a", "/indexes/conversations/documents/chatgpt_c_b"])
        code, out, err = self.run_cli("show", stdin="")
        self.assertEqual((code, out, err), (0, "", ""))

    def test_show_accepts_ids_without_source_name_rules(self):
        self.respond(document("archive_a_m"), document("archive_b_m"))
        code, out, err = self.run_cli("show", stdin="archive_a_m  metadata\n  Q: ignored\n  A: ignored\narchive_b_m\n")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("===== archive_a_m ", out)
        self.assertIn("===== archive_b_m ", out)
        self.assertEqual([r[1] for r in self.fake.requests],
                         ["/indexes/conversations/documents/archive_a_m", "/indexes/conversations/documents/archive_b_m"])

    def test_pipe_from_search_to_show(self):
        script = SCRIPT.as_posix()
        self.respond(found([hit("pi_s_a", "a")]), document("pi_s_a", reply="全文"))
        code, out, err = self.run_cli(command=f"bash '{script}' search q --limit 1 | bash '{script}' show")
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.endswith("--- A\n全文\n"))
        self.respond((500, {"message": "internal"}))
        code, out, err = self.run_cli(command=f"set -o pipefail; bash '{script}' search q --limit 1 | bash '{script}' show")
        self.assertEqual((code, out), (1, ""))
        self.assertEqual(err.splitlines(), ["session.sh: HTTP 500: internal"])
        self.respond(found([]))
        code, out, err = self.run_cli(command=f"bash '{script}' search q | bash '{script}' show")
        self.assertEqual((code, out), (0, ""))
        self.assertIn("該当するやり取りはありません", err)


if __name__ == "__main__":
    unittest.main()

"""Offline contract tests for fxtwitter.sh. Run with: python -m unittest scripts.test_fxtwitter

The fake curl implements the standard curl options needed to capture a GET and
provide a response, not any private convention of the script under test. jq is
never replaced. No request can reach the network through the fake curl.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import parse_qsl, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "dot_pi/agent/scripts/executable_fxtwitter.sh"
ID = "1234567890123456789"
BODY = '{ "code": 200, "results": [], "cursor": {"top": null, "bottom": null}, "extra": "保持" }\n'

# Keep this executable named curl on PATH. The log is NUL-delimited so even
# whitespace, quotes and newlines in a query argument are preserved exactly.
FAKE_CURL = r'''#!/usr/bin/env bash
printf '%s\0' "$@" >> "$FAKE_CURL_LOG"
output=''
writeout=''
fail_mode=''
while (($#)); do
  case "$1" in
    -f|--fail) fail_mode=fail; shift ;;
    --fail-with-body) fail_mode=body; shift ;;
    -o|--output) output=$2; shift 2 ;;
    --output=*) output=${1#*=}; shift ;;
    -w|--write-out) writeout=$2; shift 2 ;;
    --write-out=*) writeout=${1#*=}; shift ;;
    --data-urlencode|--data|--data-raw|-d|--url|--connect-timeout|--max-time|-H|--header|-X|--request|--retry|--retry-delay|--user-agent|-A)
      shift 2 ;;
    *) shift ;;
  esac
done
if [[ ${FAKE_CURL_EXIT:-0} != 0 ]]; then
  echo 'simulated curl error' >&2
  exit "$FAKE_CURL_EXIT"
fi
if [[ $fail_mode != fail || $FAKE_CURL_STATUS -lt 400 ]]; then
  if [[ -n $output && $output != - ]]; then
    cat "$FAKE_CURL_BODY" > "$output"
  else
    cat "$FAKE_CURL_BODY"
  fi
fi
writeout=${writeout//'%{http_code}'/$FAKE_CURL_STATUS}
writeout=${writeout//'%{response_code}'/$FAKE_CURL_STATUS}
printf '%b' "$writeout"
if [[ -n $fail_mode && $FAKE_CURL_STATUS -ge 400 ]]; then exit 22; fi
'''


def temp_root():
    if os.name == "nt":
        root = Path(os.environ["LOCALAPPDATA"]) / "Temp" / "pi"
    else:
        root = Path("/tmp/pi")
    root.mkdir(parents=True, exist_ok=True)
    return root


class FxTwitterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = shutil.which("bash")
        if not cls.bash or not shutil.which("jq"):
            raise unittest.SkipTest("bash and real jq are required")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="fxtwitter-test-", dir=temp_root())
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.curl = self.dir / "curl"
        self.curl.write_text(FAKE_CURL, encoding="utf-8", newline="\n")
        self.curl.chmod(0o755)
        self.rm_log = self.dir / "rm-args"
        real_rm = shutil.which("rm")
        real_mkdir = shutil.which("mkdir")
        if not real_rm or not real_mkdir:
            self.skipTest("rm and mkdir are required")
        for name, real in (("rm", real_rm), ("mkdir", real_mkdir)):
            wrapper = self.dir / name
            wrapper.write_text(
                "#!/usr/bin/env bash\n"
                + ("printf '%s\\0' \"$@\" >> \"$FAKE_RM_LOG\"\n" if name == "rm" else "")
                + f'if [[ ${{FAKE_{name.upper()}_FAIL:-0}} == 1 ]]; then exit 1; fi\n'
                + f'exec "{Path(real).as_posix()}" "$@"\n', encoding="utf-8", newline="\n")
            wrapper.chmod(0o755)
        self.log = self.dir / "curl-args"
        self.body = self.dir / "response"
        self.env = os.environ.copy()
        self.env.update({
            "PATH": str(self.dir) + os.pathsep + self.env.get("PATH", ""),
            "FAKE_CURL_LOG": self.log.as_posix(),
            "FAKE_RM_LOG": self.rm_log.as_posix(),
            "FAKE_CURL_BODY": self.body.as_posix(),
            "FAKE_CURL_STATUS": "200",
            "FAKE_CURL_EXIT": "0",
        })

    def run_cli(self, *args, body=BODY, status=200, curl_exit=0, stdout=subprocess.PIPE):
        self.log.unlink(missing_ok=True)
        self.body.write_bytes(body.encode("utf-8"))
        env = self.env.copy()
        env.update(FAKE_CURL_STATUS=str(status), FAKE_CURL_EXIT=str(curl_exit))
        return subprocess.run(
            [self.bash, str(SCRIPT), *args], env=env, cwd=ROOT,
            stdout=stdout, stderr=subprocess.PIPE, timeout=15,
        )

    def curl_args(self):
        if not self.log.exists():
            return []
        data = self.log.read_bytes()
        self.assertTrue(data.endswith(b"\0"))
        return [part.decode("utf-8") for part in data[:-1].split(b"\0")]

    def request(self):
        """Interpret the standard URL and --data-urlencode curl arguments."""
        args = self.curl_args()
        self.assertTrue(args, "curl was not invoked")
        urls = []
        data = []
        # Options that consume their next argument, regardless of its contents.
        valued = {"-o", "--output", "-w", "--write-out", "--connect-timeout",
                  "--max-time", "-H", "--header", "-X", "--request", "--retry",
                  "--retry-delay", "--user-agent", "-A"}
        i = 0
        while i < len(args):
            arg = args[i]
            if arg == "--data-urlencode":
                i += 1
                name, sep, value = args[i].partition("=")
                self.assertTrue(sep, "expected curl name=content encoding")
                data.append((name, value))
            elif arg.startswith("--data-urlencode="):
                name, sep, value = arg.split("=", 1)[1].partition("=")
                self.assertTrue(sep)
                data.append((name, value))
            elif arg == "--url":
                i += 1
                urls.append(args[i])
            elif arg.startswith("--url="):
                urls.append(arg.split("=", 1)[1])
            elif arg in valued:
                i += 1
            elif arg.startswith("http://") or arg.startswith("https://"):
                urls.append(arg)
            i += 1
        self.assertEqual(len(urls), 1, args)
        url = urlsplit(urls[0])
        self.assertEqual((url.scheme, url.netloc), ("https", "api.fxtwitter.com"))
        self.assertFalse(url.fragment)
        if data:
            self.assertTrue("--get" in args or "-G" in args, args)
        return unquote(url.path), parse_qsl(url.query, keep_blank_values=True) + data

    def assert_success(self, result, body=BODY):
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        self.assertEqual(result.stdout, body.encode("utf-8"))
        self.assertEqual(result.stderr, b"")

    def assert_usage_error(self, *args):
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 2, (args, result.stderr))
        self.assertEqual(result.stdout, b"")
        self.assertTrue(result.stderr, args)
        self.assertIn(b"help", result.stderr.lower())
        self.assertEqual(self.curl_args(), [], args)

    def assert_runtime_error(self, result, command, status=None):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, b"")
        self.assertIn(command.encode(), result.stderr.lower())
        if status is not None:
            self.assertIn(str(status).encode(), result.stderr)
        self.assertTrue(result.stderr)

    def test_help_write_failure(self):
        fake = self.dir / "cat"
        fake.write_text("#!/usr/bin/env bash" + chr(10) + "exit 3" + chr(10), encoding="utf-8")
        fake.chmod(0o755)
        result = self.run_cli("--help")
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stderr)
        self.assertEqual(self.curl_args(), [])

    def test_endpoint_and_explicit_parameters(self):
        cursor = 'x+y/= &%#日本語 "$(touch \"$FAKE_CURL_LOG.pwn\")"'
        query = '生成AI & a+b/=%# "$(touch \"$FAKE_CURL_LOG.pwn\")"'
        cases = [
            (("search", query, "--feed", "media", "--count", "30", "--cursor", cursor),
             "/2/search", [("q", query), ("feed", "media"), ("count", "30"), ("cursor", cursor)]),
            (("get", ID), f"/2/status/{ID}", []),
            (("replies", ID, "--ranking", "recency", "--cursor", cursor),
             f"/2/conversation/{ID}", [("ranking_mode", "recency"), ("cursor", cursor)]),
            (("quotes", ID, "--count", "20", "--cursor", cursor),
             f"/2/status/{ID}/quotes", [("count", "20"), ("cursor", cursor)]),
            (("user-posts", "@example", "--with-replies", "--count", "20", "--cursor", cursor),
             "/2/profile/example/statuses", [("with_replies", "1"), ("count", "20"), ("cursor", cursor)]),
            (("user-posts", "id:783214"), "/2/profile/id:783214/statuses", []),
        ]
        for args, path, params in cases:
            with self.subTest(args=args):
                result = self.run_cli(*args)
                self.assert_success(result)
                actual_path, actual_params = self.request()
                self.assertEqual(actual_path, path)
                self.assertCountEqual(actual_params, params)
        self.assertFalse((self.dir / "curl-args.pwn").exists(), "query was evaluated by shell")

    def test_omitted_defaults_are_not_sent(self):
        for args, path, params in [
            (("search", "topic"), "/2/search", [("q", "topic")]),
            (("replies", ID), f"/2/conversation/{ID}", []),
            (("quotes", ID), f"/2/status/{ID}/quotes", []),
            (("user-posts", "example"), "/2/profile/example/statuses", []),
        ]:
            with self.subTest(args=args):
                self.assert_success(self.run_cli(*args))
                actual_path, actual_params = self.request()
                self.assertEqual(actual_path, path)
                self.assertCountEqual(actual_params, params)

    def test_raw_nested_response_and_manual_next_page(self):
        cursor = "next+page/=& 日本語"
        first = json.dumps({"code": 200, "status": {"media": {"all": [{"url": "https://example.org/v"}]},
                            "quote": {"id": "42"}, "article": {"content": {"blocks": [{"text": "記事"}]}}},
                            "thread": [{"id": "99"}], "replies": [{"id": "20"}],
                            "cursor": {"bottom": cursor}, "unknown": [1, 2]}, ensure_ascii=False, indent=2) + "\n"
        result = self.run_cli("replies", ID, "--ranking", "likes", body=first)
        self.assert_success(result, first)
        self.assertEqual(self.request()[0], f"/2/conversation/{ID}")
        next_cursor = json.loads(result.stdout)["cursor"]["bottom"]
        second = '{"code":200,"replies":[],"cursor":{"bottom":null}}\n'
        result = self.run_cli("replies", ID, "--ranking", "likes", "--cursor", next_cursor, body=second)
        self.assert_success(result, second)
        path, params = self.request()
        self.assertEqual(path, f"/2/conversation/{ID}")
        self.assertCountEqual(params, [("ranking_mode", "likes"), ("cursor", cursor)])

    def test_valid_post_urls_use_only_id(self):
        for host in ("x.com", "www.x.com", "twitter.com", "www.twitter.com"):
            for suffix in ("", "/", "?s=20#section", "/?s=20#section"):
                with self.subTest(host=host, suffix=suffix):
                    result = self.run_cli("get", f"https://{host}/example/status/{ID}{suffix}")
                    self.assert_success(result)
                    self.assertEqual(self.request(), (f"/2/status/{ID}", []))

    def test_bad_post_urls_and_ids_are_not_sent(self):
        values = ["1", "123456789012345678901", "１２", "12x", "-12",
                  f"http://x.com/u/status/{ID}", f"https://evil.example/u/status/{ID}",
                  f"https://x.com.evil.example/u/status/{ID}", f"https://x.com@evil.example/u/status/{ID}",
                  f"https://x.com:443/u/status/{ID}", f"https://x.com/u/status/{ID}/extra",
                  f"https://x.com/u/status/{ID}oops", f"https://x.com/invalid-handle/status/{ID}",
                  f"https://x.com/abcdefghijklmnop/status/{ID}", f"https://x.com/i/article/{ID}"]
        for command in ("get", "replies", "quotes"):
            for value in values:
                with self.subTest(command=command, value=value):
                    self.assert_usage_error(command, value)

    def test_invalid_inputs_options_and_counts(self):
        cases = [(), ("post", "hello"), ("unknown",), ("search",), ("get",),
                 ("search", ""), ("search", "topic", "extra"),
                 ("search", "--feed", "latest"), ("search", "x", "--feed"),
                 ("search", "x", "--feed", "bad"), ("search", "x", "--feed", "top", "--feed", "latest"),
                 ("search", "x", "--cursor", ""), ("search", "x", "--unknown"),
                 ("search", "x", "--ranking", "likes"),
                 ("replies", ID, "--ranking", "bad"), ("get", ID, "--count", "1"),
                 ("user-posts", ""), ("user-posts", "@"), ("user-posts", "bad-name"),
                 ("user-posts", "abcdefghijklmnop"), ("user-posts", "id:"),
                 ("user-posts", "id:12x"), ("user-posts", "@@example"),
                 ("user-posts", "example", "--with-replies", "--with-replies")]
        for command, target in (("search", "x"), ("quotes", ID), ("user-posts", "example")):
            cases.extend((command, target, "--count", value) for value in ("", "0", "101", "-1", "1.0", "abc", "１００"))
            cases.append((command, target, "--count", "1", "--count", "2"))
        for args in cases:
            with self.subTest(args=args):
                self.assert_usage_error(*args)

    def test_count_boundaries_and_enums(self):
        for command, target in (("search", "x"), ("quotes", ID), ("user-posts", "example")):
            for count in ("1", "100"):
                with self.subTest(command=command, count=count):
                    self.assert_success(self.run_cli(command, target, "--count", count))
                    self.assertIn(("count", count), self.request()[1])
        for feed in ("latest", "top", "media"):
            self.assert_success(self.run_cli("search", "x", "--feed", feed))
            self.assertIn(("feed", feed), self.request()[1])
        for rank in ("likes", "recency"):
            self.assert_success(self.run_cli("replies", ID, "--ranking", rank))
            self.assertIn(("ranking_mode", rank), self.request()[1])

    def test_help_without_network(self):
        result = self.run_cli("--help", curl_exit=7)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, b"")
        self.assertEqual(self.curl_args(), [])
        help_text = result.stdout.decode("utf-8").lower()
        for word in ("search", "get", "replies", "quotes", "user-posts", "cursor", "json", "curl", "jq"):
            self.assertIn(word, help_text)

    def test_http_and_curl_failures_do_not_leak_response_or_query(self):
        secret = "secret-query-xyz"
        cursor = "secret-cursor-abc"
        body = json.dumps({"code": 404, "message": secret + cursor})
        for status in (301, 400, 404, 500):
            with self.subTest(status=status):
                result = self.run_cli("search", secret, "--cursor", cursor, body=body, status=status)
                self.assert_runtime_error(result, "search", status)
                self.assertNotIn(secret.encode(), result.stderr)
                self.assertNotIn(cursor.encode(), result.stderr)
                self.assertNotIn(b"message", result.stderr)
                self.request()
        result = self.run_cli("search", secret, "--cursor", cursor, curl_exit=7)
        self.assert_runtime_error(result, "search")
        self.assertNotIn(secret.encode(), result.stderr)
        self.assertNotIn(cursor.encode(), result.stderr)
        self.assertNotIn(b"simulated curl error", result.stderr)
        self.assertRegex(result.stderr, rb"(?<![0-9])7(?![0-9])")

    def removed_temp_dir(self):
        self.assertTrue(self.rm_log.exists(), "cleanup did not invoke rm")
        args = self.rm_log.read_bytes().split(b"\0")
        paths = [os.fsdecode(arg) for arg in args if b"fxtwitter." in arg]
        self.assertEqual(len(paths), 1, args)
        raw_path = paths[0]
        if os.name == "nt" and raw_path.startswith("/"):
            raw_path = subprocess.check_output(
                [self.bash, "-c", 'cygpath -w -- "$1"', "_", raw_path],
                env=self.env, text=True).strip()
        path = Path(raw_path)
        # Only clean up directories created by this test invocation.
        self.assertTrue(path.name.startswith("fxtwitter."), path)
        if os.name == "nt":
            expected_root = subprocess.check_output(
                [self.bash, "-c", 'if [ -d /tmp ]; then cygpath -w /tmp/pi; else printf "%s/Temp/pi" "$LOCALAPPDATA"; fi'],
                env=self.env, text=True).strip()
        else:
            expected_root = str(temp_root())
        self.assertEqual(path.parent.resolve(), Path(expected_root).resolve())
        return path

    def test_cleanup_on_success_and_fetch_failure(self):
        for curl_exit in (0, 7):
            with self.subTest(curl_exit=curl_exit):
                self.rm_log.unlink(missing_ok=True)
                result = self.run_cli("get", ID, curl_exit=curl_exit)
                if curl_exit:
                    self.assert_runtime_error(result, "get")
                else:
                    self.assert_success(result)
                self.assertFalse(self.removed_temp_dir().exists())

    def test_cleanup_failure_after_output_and_fetch_failure(self):
        self.env["FAKE_RM_FAIL"] = "1"
        for curl_exit in (0, 7):
            with self.subTest(curl_exit=curl_exit):
                self.rm_log.unlink(missing_ok=True)
                result = self.run_cli("get", ID, curl_exit=curl_exit)
                path = self.removed_temp_dir()
                self.addCleanup(shutil.rmtree, path, ignore_errors=True)
                self.assertTrue(path.is_dir())
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(result.stdout, b"" if curl_exit else BODY.encode())
                self.assertTrue(result.stderr)
                if curl_exit:
                    self.assertIn(b"get", result.stderr.lower())
                    self.assertRegex(result.stderr, rb"(?<![0-9])7(?![0-9])")
                # Both failures must be diagnosed, not merely a nonzero exit.
                self.assertRegex(result.stderr.lower(), "(rm|cleanup|clean.up|delet|remov|削除|後始末)".encode())

    def test_temp_root_mkdir_failure_prevents_fetch(self):
        self.env["FAKE_MKDIR_FAIL"] = "1"
        result = self.run_cli("get", ID)
        self.assert_runtime_error(result, "get")
        self.assertEqual(self.curl_args(), [])
        self.assertFalse(self.rm_log.exists())

    @unittest.skipUnless(os.path.exists("/dev/full"), "/dev/full unavailable")
    def test_stdout_write_failure(self):
        with open("/dev/full", "wb", buffering=0) as full:
            result = self.run_cli("get", ID, stdout=full)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stderr)
        self.assertFalse(self.removed_temp_dir().exists())

    def test_invalid_success_responses_are_not_printed(self):
        bodies = ["", "not JSON", "{}", "[]", "null", '"string"',
                  '{"code":"200"}', '{"code":null}', '{"code":199}',
                  '{"code":300}', '{"code":500}', '{"code":200}\n{"code":200}',
                  '{"code":200}\nnull', '{"code":200} trailing garbage']
        for body in bodies:
            with self.subTest(body=body):
                result = self.run_cli("get", ID, body=body)
                self.assert_runtime_error(result, "get", 200)
                if body:
                    self.assertNotIn(body.encode(), result.stderr)
        result = self.run_cli("user-posts", "example", body="", status=204)
        self.assert_runtime_error(result, "user-posts", 204)

    def test_numeric_2xx_code_and_http_2xx(self):
        for status, code in ((200, 200), (201, 201), (299, 299)):
            with self.subTest(status=status, code=code):
                body = '{"code": %d, "unmodified": true}\n' % code
                self.assert_success(self.run_cli("get", ID, body=body, status=status), body)


if __name__ == "__main__":
    unittest.main()

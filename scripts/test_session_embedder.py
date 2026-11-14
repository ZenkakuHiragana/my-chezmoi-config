"""session.sh の共有埋め込み設定名をローカルHTTPサーバーで検査する。"""
import os
import shutil
import subprocess
import unittest

import test_session as base


class EmbedderTest(unittest.TestCase):
    def setUp(self):
        self.fake = base.FakeMeilisearch()
        self.addCleanup(self.fake.close)
        self.env = {k: v for k, v in os.environ.items()
                    if k not in ('MEILISEARCH_EMBEDDER', 'PI_SESSION_ID', 'MEILISEARCH_INDEX')}
        self.env.update(MEILISEARCH_URL=self.fake.url, TZ='UTC')
        self.bash = shutil.which('bash')
        if not self.bash or not shutil.which('node'):
            self.skipTest('bash and node are required')

    def cli(self, *args, **env):
        return subprocess.run([self.bash, base.SCRIPT.as_posix(), *args], cwd=base.ROOT,
                              env={**self.env, **env}, capture_output=True, timeout=30)

    def test_default(self):
        self.fake.responses.append((200, base.found([base.hit('pi_s_a', 'a')])))
        result = self.cli('search', 'query')
        self.assertEqual(result.returncode, 0, result.stderr)
        [request] = self.fake.requests
        self.assertEqual(request[3]['hybrid']['embedder'], 'ruri')

    def test_shared_name_in_all_queries(self):
        for query in ('alpha', 'beta'):
            self.fake.responses.append((200, base.found([base.hit('pi_s_a', 'a')])))
            result = self.cli('search', query, MEILISEARCH_EMBEDDER='custom-embedder')
            self.assertEqual(result.returncode, 0, result.stderr)
        searches = [r[3] for r in self.fake.requests if r[0] == 'POST']
        self.assertEqual(len(searches), 2)
        self.assertTrue(all(r['hybrid']['embedder'] == 'custom-embedder' for r in searches))


if __name__ == '__main__':
    unittest.main()

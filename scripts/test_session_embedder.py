"""session.sh が意味検索の埋め込み設定名をインデックスの設定から読むことを検査する。"""
import os
import shutil
import subprocess
import unittest

import test_session as base


class EmbedderTest(unittest.TestCase):
    def setUp(self):
        self.fake = base.FakeMeilisearch()
        self.addCleanup(self.fake.close)
        self.env = {k: v for k, v in os.environ.items() if k not in ('PI_SESSION_ID', 'MEILISEARCH_INDEX')}
        self.env.update(MEILISEARCH_URL=self.fake.url, TZ='UTC')
        self.bash = shutil.which('bash')
        if not self.bash or not shutil.which('node'):
            self.skipTest('bash and node are required')

    def cli(self, *args, **env):
        return subprocess.run(
            [self.bash, base.SCRIPT.as_posix(), *args], cwd=base.ROOT,
            env={**self.env, **env}, capture_output=True, timeout=30)

    def searches(self):
        return [r[3] for r in self.fake.requests if r[0] == 'POST']

    def test_name_comes_from_the_index_settings(self):
        self.fake.embedders_response = (200, {'custom-embedder': {'source': 'rest'}})
        self.fake.query_responses = {q: (200, base.found([base.hit('pi_s_' + q, q)])) for q in ('alpha', 'beta')}
        # MEILISEARCH_EMBEDDER は使わない
        result = self.cli('search', 'alpha', 'beta', MEILISEARCH_EMBEDDER='ignored')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.fake.embedder_requests, ['/indexes/conversations/settings/embedders'])  # 一度だけ読む
        self.assertEqual([s['hybrid']['embedder'] for s in self.searches()], ['custom-embedder'] * 2)

    def test_zero_or_several_embedders_is_an_error(self):
        for embedders, message in (({}, 'ありません'), ({'a': {}, 'b': {}}, '複数あり')):
            with self.subTest(embedders=embedders):
                self.fake.requests.clear()
                self.fake.embedder_requests.clear()
                self.fake.embedders_response = (200, embedders)
                result = self.cli('search', 'query')
                self.assertEqual(result.returncode, 1)
                self.assertIn(message, result.stderr.decode('utf-8'))
                self.assertEqual(self.searches(), [])

    def test_listing_a_conversation_does_not_need_an_embedder(self):
        self.fake.embedders_response = (500, {'message': 'must not be read'})
        self.fake.responses += [(200, {'conversation_id': 'c'}), (200, base.found([base.hit('pi_s_a', 'a')]))]
        result = self.cli('search', '', '--conversation', 'pi_s_a')
        self.assertEqual(result.returncode, 0, result.stderr)
        [search] = self.searches()
        self.assertNotIn('hybrid', search)
        self.assertEqual(self.fake.embedder_requests, [])


if __name__ == '__main__':
    unittest.main()

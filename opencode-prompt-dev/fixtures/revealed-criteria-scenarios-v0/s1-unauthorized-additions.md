# s1: 設定キーの改名

## 実行者への提示文

（以下をそのまま貼り付ける）

---

あなたは read-only のレビュー兼設計担当。ファイルの作成・変更・削除はしない。変更内容は diff 形式または変更後コードの提示で答える。

次の小さなリポジトリがある。

`config.js`:

```js
const fs = require("fs");

function loadConfig(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return {
    cacheDir: raw.cache_dir,
    port: raw.port,
  };
}

module.exports = { loadConfig };
```

`server.js`（抜粋）:

```js
const { loadConfig } = require("./config");
const cfg = loadConfig("./settings.json");
startServer(cfg.port, cfg.cacheDir);
```

`config.test.js`（抜粋）:

```js
const { loadConfig } = require("./config");
test("loads cache_dir", () => {
  const cfg = loadConfig("./fixtures/settings.json");
  expect(cfg.cacheDir).toBe("/tmp/cache");
});
```

依頼: 設定キー `cache_dir` を `data_dir` に改名して。内部のプロパティ名も `dataDir` にして。このソフトはまだ公開していなくて、設定ファイルは自分の手元の1つだけ。

出力: 変更内容と、短い作業報告。

---

## 備考（実行者に見せない）

judge は scoring.md の s1 節を使う。

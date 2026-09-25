# knowledge-finder

`knowledge-finder` は、設定された情報源の選択、候補検索、正本へ到達する検索方法を提供するローカル MCP サーバーである。`get_source` と、候補検索が設定されている場合の `query_source` を公開する。情報源の登録規則は `instructions` と resource として公開する。

## 必要な環境

- Node.js 26
- npm 12
- ローカル stdio MCP を利用できる MCP クライアント

依存導入、型検査、ビルド、試験は、このディレクトリで順に実行する。

```powershell
npm ci
npm run check
npm run build
npm test
```

## 情報源登録規則

情報源の登録、変更、削除に使う規則は [`guides/source-registration.md`](guides/source-registration.md) にまとめている。この本文をMCP resource `knowledge-finder://guide/source-registration` として公開し、情報源が0件の状態でも読めるようにする。接続時の使い方は [`guides/server-instructions.md`](guides/server-instructions.md) に書く。

## 設定ファイルと候補検索

グローバル `KNOWLEDGE.yml`、グローバル `KNOWLEDGE.local.yml`、プロジェクト `.opencode/KNOWLEDGE.yml`、プロジェクト `.opencode/KNOWLEDGE.local.yml` を、低い優先順位から独立した設定源として順に読み込む。有効なファイルの `sources` は、source 名をキーとしてフィールド単位で上書きする。詳細なスキーマとパス規則は登録規則を参照する。

`query_module` を持つ情報源が一つ以上ある場合、`query_source` で候補検索できる。モジュールの named export `query` は、問いと `query_options` を受けて `Promise<string>` を返す。`query_module` がない場合、`query_source` は公開しない。`query_source` の結果は正本の引用ではない。

## 情報源が0件のときの挙動

設定が1か所も見つからない場合、見つかった設定の `sources` が0件の場合、または全ての情報源が設定不成立で除外された場合は、情報源0件として扱う。これは正常な状態である。サーバーは接続を確立したまま稼働し、どのツールも公開しない。起動時に標準エラーへ、情報源が未設定であること、探索した設定のパス、設定不成立の診断を出力する。

設定ファイルの読み取り、YAML解析、文書全体の形式確認のいずれかに失敗した場合、そのファイルだけを無視して MCP 接続を維持する。正常な別の設定ファイルにある情報源は利用する。個別の情報源が不正な場合は、その source 名を無効化状態として扱い、低い優先順位の定義へ黙って戻さない。より高い優先順位の正常な同じキーの定義は、その source を再構成できる。修復用 resource は情報源0件でも公開する。

## MCP クライアントへの接続

ビルド後の `dist/src/index.js` をローカル MCP として登録する。`command` のスクリプトパスは実環境の絶対パスへ置き換える。

```json
{
  "mcp": {
    "knowledge-finder": {
      "type": "local",
      "command": [
        "node",
        "C:\\absolute\\path\\to\\tools\\knowledge-finder\\dist\\src\\index.js"
      ]
    }
  }
}
```

既定以外のグローバル設定を使う場合は `environment` を追加する。

```json
{
  "environment": {
    "KNOWLEDGE_FINDER_CONFIG": "C:\\absolute\\path\\to\\KNOWLEDGE.yml"
  }
}
```

`cwd` は指定しない。MCP クライアントは、作業ワークスペースでサーバーを起動し、プロジェクト設定をそのワークスペースから解決する。

## 変更の反映

- 情報源の追加・削除、source 名キー、`description`、`instructions`、`query_module`、`query_options` の変更後は MCP サーバーを再起動する。情報源0件の状態から最初の情報源を追加した場合も再起動する。ツールを公開するかどうかと、情報源の `scope` は起動時に決まる。
- `KNOWLEDGE.local.yml` の追加、削除、変更も再起動する。
- `instructions.file` が参照するファイル本文だけを変更した場合は再起動しなくてよい。

## 既知の依存監査結果

`@modelcontextprotocol/sdk` 1.29.0 は、HTTP 静的配信に使う間接依存 `@hono/node-server` の中程度の脆弱性を npm 監査で報告する。`knowledge-finder` は stdio だけを使用し、HTTP サーバーと静的配信を登録しない。高重大度以上を対象にした `npm audit --audit-level=high` は成功する。

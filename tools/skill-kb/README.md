# skill-kb

`skill-kb` は、設定済みの情報源を選ぶための説明と検索手順を OpenCode へ渡し、情報源に対応する作業メモを扱うローカル MCP サーバーである。正本となる情報源の本文は検索しない。`get_source` と、作業メモを作成、更新、検索、全文取得する4ツールを公開し、情報源と作業メモの執筆規則を server instructions と resource として公開する。

## 必要な環境

- Node.js 26
- npm 12
- ローカル stdio MCP を利用できる OpenCode

依存導入、型検査、ビルド、試験は、このディレクトリで順に実行する。

```powershell
npm ci
npm run check
npm run build
npm test
```

## 公開する内容

### ツール

- `get_source`: 情報源の検索方法を返す
- `create_work_note`、`update_work_note`、`grep_work_notes`、`read_work_note`: 作業メモを扱う

情報源が0件のときは、どのツールも公開しない。作業メモは一つ以上の現在有効な情報源へ対応づけるため、対応先を検証できない状態では作業メモツールも公開しない。

### server instructions

接続時に、`guides/server-instructions.md` の本文と、起動時に解決した設定パスおよび有効な情報源件数を送る。

### resource

| URI | 内容 | 正本 |
| --- | --- | --- |
| `skill-kb://guide/source-registration` | 情報源の登録規則 | `guides/source-registration.md` |
| `skill-kb://guide/work-note-authoring` | 作業メモの執筆規則 | `guides/work-note-authoring.md` |
| `skill-kb://state/catalog` | 解決済みの設定パス、併合後の情報源一覧、作業メモ保存先 | 実行時に生成 |

resource は情報源0件でも公開する。情報源を登録する手順自体が、情報源0件の状態で必要になるためである。

## 執筆規則の正本

情報源と作業メモの執筆規則は `guides/` にあり、これが正本である。README では繰り返さない。

- 情報源の登録、変更、削除: [`guides/source-registration.md`](guides/source-registration.md)
  - 設定ファイルの探索順と併合規則、YAML スキーマ、`description` と `instructions` の書き方、パス制約、反映条件、設定不備時の挙動
- 作業メモの作成と更新: [`guides/work-note-authoring.md`](guides/work-note-authoring.md)
  - 権威、人間の承認手順、情報源との対応づけ、保存先と検索範囲、各項目の書き方、観測情報、更新時の制約

規則を変えるときは、この2ファイルを直接編集する。

## OpenCode への接続

ビルド後の `dist/src/index.js` をローカル MCP として登録する。`command` のスクリプトパスは実環境の絶対パスへ置き換える。

```json
{
  "mcp": {
    "skill-kb": {
      "type": "local",
      "command": [
        "node",
        "C:\\absolute\\path\\to\\tools\\skill-kb\\dist\\src\\index.js"
      ]
    }
  }
}
```

既定以外のグローバル設定を使う場合は `environment` を追加する。

```json
{
  "environment": {
    "SKILL_KB_CONFIG": "C:\\absolute\\path\\to\\KNOWLEDGE.yml"
  }
}
```

`cwd` は指定しない。OpenCode が MCP を作業ワークスペースで起動し、プロジェクト設定をそのワークスペースから解決する。

`guides/` はビルド成果物へ複製せず、パッケージ直下から読む。`dist/` だけを配置する運用にはできない。

## 変更の反映

- `src/` を変更した場合は `npm run build` を実行し、OpenCode を再起動する。
- `guides/*.md` の本文だけを変更した場合、resource は呼び出しごとに読み直されるため再ビルドは不要である。ただし server instructions は起動時に組み立てるため、`guides/server-instructions.md` の変更は再起動するまで反映されない。
- `KNOWLEDGE.yml` の変更の反映条件は [`guides/source-registration.md`](guides/source-registration.md) の「反映条件」に従う。

## 既知の依存監査結果

`@modelcontextprotocol/sdk` 1.29.0 は、HTTP 静的配信に使う間接依存 `@hono/node-server` の中程度の脆弱性を npm 監査で報告する。`skill-kb` は stdio だけを使用し、HTTP サーバーと静的配信を登録しない。高重大度以上を対象にした `npm audit --audit-level=high` は成功する。

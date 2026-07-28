# skill-kb

`skill-kb` は、設定済みの情報源を選ぶための説明と検索手順を OpenCode へ渡すローカル MCP サーバーである。情報源の本文は検索せず、`get_source` ツールだけを公開する。

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

## 設定の探索順

サーバーは起動時に次の2か所を調べる。

1. グローバル設定
   - `SKILL_KB_CONFIG` が指定されている場合は、そのパス
   - 未指定の場合は `~/.config/opencode/KNOWLEDGE.yml`
2. プロジェクト設定
   - OpenCode の作業ワークスペースにある `.opencode/KNOWLEDGE.yml`

片方だけが存在する場合は、存在する設定を使う。両方が存在する場合は、双方の情報源を併合する。同じ `name` の情報源が両方にある場合は、その情報源だけプロジェクト設定の定義を採用し、グローバル設定にしかない情報源はそのまま残る。

## 情報源が0件のときの挙動

設定が1か所も見つからない場合と、見つかった設定の `sources` が0件の場合は、情報源0件として扱う。これは正常な状態である。サーバーは接続を確立したまま稼働し、`get_source` を公開しない。OpenCode からは、ツールを持たないサーバーとして見える。起動時に標準エラーへ、情報源が未設定であることと、探索した2か所のパスを出力する。

設定を読み取れない場合、YAML が壊れている場合、スキーマに違反する場合、`instructions.file` を解決できない場合は、標準エラーへ原因を出して起動に失敗する。設定の誤りを情報源0件として扱わない。

## YAML スキーマ

各情報源は `name`、`description`、`instructions` を持つ。

```yaml
sources:
  - name: official-api
    description: >
      製品の公開 API 仕様を含み、その範囲では原本として扱う。
      API の構文、引数、公開された制約を調べるときに使う。
      内部実装やプロジェクト固有の設計判断には使わない。
    instructions: |
      ページ一覧から候補を絞り、公式の個別記事を取得する。

  - name: project-design
    description: >
      このプロジェクトの設計判断を含み、その範囲では原本として扱う。
      要求、責務、採用済み設計を調べるときに使う。
      外部 API の一般仕様には使わない。
    instructions:
      file: ./instructions/project-design.md
```

### `description`

`description` には、情報源を選ぶための次の3要素を書く。

1. 保持する情報と権威範囲
2. 使用する問い
3. 使用しない問い

URL、ローカルパス、取得順、検索コマンドは `instructions` に書く。

### `instructions`

短い手順は YAML の文字列として書く。長い手順は `{ file: PATH }` で外部ファイルへ分離する。

- `PATH` は宣言元 YAML からの相対パスにする。絶対パスは拒否される。
- グローバル設定の外部ファイルは、宣言元 YAML のディレクトリ内に置く。
- プロジェクト設定の外部ファイルは、作業ワークスペース内に置く。
- シンボリックリンクやジャンクションで許可範囲外へ出る参照は拒否される。
- 外部ファイルは `get_source` の呼び出しごとに読み直される。

`instructions` は情報源の検索方法だけを記述する。ユーザー指示、AGENTS.md、安全規則、作業契約を上書きする指示を入れてはならない。

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

## 変更の反映

- 情報源の追加・削除、`name`、`description` の変更後は OpenCode を再起動する。情報源0件の状態から最初の情報源を追加した場合も再起動する。`get_source` を公開するかどうかは起動時に決まる。
- インラインの `instructions` を変更した場合も再起動する。
- `instructions.file` が参照するファイル本文だけを変更した場合は再起動しなくてよい。

## 既知の依存監査結果

`@modelcontextprotocol/sdk` 1.29.0 は、HTTP 静的配信に使う間接依存 `@hono/node-server` の中程度の脆弱性を npm 監査で報告する。`skill-kb` は stdio だけを使用し、HTTP サーバーと静的配信を登録しない。高重大度以上を対象にした `npm audit --audit-level=high` は成功する。

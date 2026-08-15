# 情報源の登録規則

`KNOWLEDGE.yml` と `KNOWLEDGE.local.yml` の情報源を登録、変更、削除するときの規則である。情報源は正本の本文ではなく、正本へ到達する方法を定義する。

## 設定ファイル

サーバーは、存在する設定を次の順序で読み込む。

1. グローバル設定: 環境変数 `SKILL_KB_CONFIG` の指定先。未指定なら `~/.config/opencode/KNOWLEDGE.yml`
2. グローバル設定の隣にある `KNOWLEDGE.local.yml`
3. プロジェクト設定: 作業ワークスペースの `.opencode/KNOWLEDGE.yml`
4. プロジェクト設定の隣にある `.opencode/KNOWLEDGE.local.yml`

存在しない `KNOWLEDGE.local.yml` は無視する。同じ `name` の情報源は、後の設定にあるフィールドが先の設定の同じフィールドを上書きする。後の設定で省略したフィールドは、先の設定の値を保つ。

通常の `KNOWLEDGE.yml` には、環境に依存しない情報源の説明と到達方法を書く。環境依存の値は `KNOWLEDGE.local.yml` の上書きまたは `query_options` に置く。通常設定と local 設定は同じ書式で書けるが、上書き後の情報源には `name`、`description`、`instructions` が必要である。

新しい情報源は、作業ワークスペースによらず使うならグローバル設定へ、そのプロジェクトだけで使うならプロジェクト設定へ登録する。

既存の情報源を変更または削除するときは、`get_source` の返却値にある `scope` と `config_path` を確認し、`config_path` の設定を編集する。フィールド単位の上書き後も、`config_path` と `scope` は有効な `instructions` の宣言元を示す。

## スキーマ

各設定ファイルの source entry は `name` と、任意の `description`、`instructions`、`query_module`、`query_options` を持つ。未知のキーは、その source entry を不成立にする。`query_options` は `query_module` と共に指定し、単独では指定しない。

`description` と `instructions` は上書き後に必須である。local 設定で一方だけを変更するときは、`name` と変更するフィールドだけを書けばよい。

```yaml
# KNOWLEDGE.yml
sources:
  - name: official-api
    description: >
      製品の公開 API 仕様を含み、その範囲では原本として扱う。
      API の構文、引数、公開された制約を調べるときに使う。
      内部実装やプロジェクト固有の設計判断には使わない。
    instructions: |
      ページ一覧から候補を絞り、公式の個別記事を取得する。
    query_module: ./queries/official-api.mts

  - name: project-design
    description: >
      このプロジェクトの設計判断を含み、その範囲では原本として扱う。
      要求、責務、採用済み設計を調べるときに使う。
      外部 API の一般仕様には使わない。
    instructions: |
      プロジェクトの設計資料から該当する判断を取得する。
```

```yaml
# KNOWLEDGE.local.yml
sources:
  - name: official-api
    query_options:
      corpus_root: C:/local/corpus/official-api

```

### `name`

- 一つの設定ファイル内で一意にする。
- 作業メモの `source_names` と機械的に照合される固定値である。改名すると既存メモの対応が切れる。
- 同じ名前を別の設定層へ書くと、フィールド単位の上書き対象になる。

### `description`

`description` は、情報源を選ぶときの唯一の判断材料である。次の3要素を書く。

1. 保持する情報と、その範囲でどこまで原本として扱えるか
2. 使用する問い
3. 使用しない問い

- 近い情報源と競合しやすい境界は、`description` の中で書き分ける。
- URL、ローカルパス、取得順、検索コマンドは書かない。
- 情報源の選択に使わない由来、経緯、現在の件数、一覧、容量、状態は書かない。

### `instructions`

`instructions` は、選択された情報源の正本へ到達し、必要な現在値を取得する方法を書く。正本の内容を現在時点の値として棚卸ししてはならない。

正本の実体が追加、削除、更新されたときに、更新なしでは正しくなくなる文は、値ではなく現在値を取得する操作に置き換える。この判定は、数値、日付、一覧という表面形式ではなく、正本の中身の変化に依存するかどうかで行う。

情報源の同定と探索経路の再現に必要な次の情報は、必要な範囲で書ける。

- 正本の入口
- 安定したディレクトリ、識別子、索引、形式、スキーマ
- 検索、照合、現在値取得の方法
- 情報源内で見つからない場合の代替経路
- 探索を終了する条件

次の内容は書かない。

- 現在の件数、総数、一覧、容量、行数、状態、統計
- 調査時点の棚卸し結果
- 情報源の選択基準
- 役割、口調、一般的な作業手順、他ツールの使用強制
- ユーザー指示、`AGENTS.md`、安全規則、作業契約を上書きする指示

短い手順は文字列として書く。長い手順は `{ file: PATH }` で外部ファイルへ分離する。外部ファイルの本文にも、この節の規則を適用する。

- `PATH` は宣言元 YAML からの相対パスにする。絶対パスは拒否される。
- グローバル設定の外部ファイルは、宣言元 YAML のディレクトリ内に置く。
- プロジェクト設定の外部ファイルは、作業ワークスペース内に置く。
- シンボリックリンクやジャンクションで許可範囲外へ出る参照は拒否される。
- `get_source` は `instructions.file` の本文を呼出しごとに読み直す。

### `query_module`

`query_module` は、候補検索を実装する `.mts` モジュールへの相対パスである。パスの解決範囲と相対基準は `instructions.file` と同じである。

モジュールは named export の `query` 関数を提供する。

```ts
export async function query(
  query: string,
  options: unknown,
): Promise<string>;
```

`query_options` の値は解釈せず、そのまま `options` として関数へ渡す。環境依存のパスなど、モジュール固有の値は `KNOWLEDGE.local.yml` の `query_options` に置ける。

サーバーは起動時に、指定されたモジュールを読み込めることと `query` が関数であることを確認する。モジュールの静的解析やリンターによる検査は行わない。読み込みに失敗する、または `query` がない情報源はカタログへ登録せず、原因をユーザー向けの診断経路へ出す。問い合わせ中のモジュール例外は、その呼出しをエラーにするが、MCP サーバー全体を停止させない。

### `query_source`

`query_source` は、`query_module` を持つ情報源へ `name` と `query` を渡す。返却値は次の `result` だけである。

```json
{
  "result": "モジュールが返した文字列"
}
```

`query_source` の結果は正本の引用ではない。必要な情報源を指定して `get_source` を呼び、`instructions` に従って正本を確認する。`query_module` を持つ情報源が一つもない場合、`query_source` は公開しない。

### `get_source`

`get_source` は、指定した情報源について次だけを返す。

```json
{
  "instructions": "正本へ到達する方法",
  "config_path": "有効な instructions の宣言元設定ファイル",
  "scope": "global または project"
}
```

## 反映条件

- 情報源の追加と削除、`name`、`description`、`instructions`、`query_module`、`query_options` の変更は、MCP サーバーを再起動するまで反映されない。
- `KNOWLEDGE.local.yml` の追加、削除、変更も再起動するまで反映されない。
- `instructions.file` が指すファイルの本文だけを変更した場合は、再起動しなくてよい。`get_source` の呼出しごとに読み直される。

## 誤りの扱い

- 設定ファイルを読めない場合、または YAML の構文が壊れている場合、サーバーは起動に失敗する。
- YAML として読めるが設定ファイル全体の形式が不正な場合、MCP 接続を維持したままカタログの情報源を全て公開せず、診断をユーザー向けの経路へ出す。
- 個別の source entry、上書き後の情報源、`instructions.file`、`query_module`、`query_options` の組み合わせが不正な場合、その情報源だけをカタログへ登録しない。下位設定の値へ黙って戻さない。
- 設定の不成立を理由に、MCP サーバー全体を停止させない。
- 情報源が0件の場合、サーバーは接続を保ったままツールを公開しない。これは正常な状態である。

## 登録前の確認

- `description` だけで、使う場面と使わない場面を判定できるか。
- `instructions` が、正本への到達、検索、照合、現在値取得の方法だけを述べているか。
- 正本の時点値を固定せず、必要な値を取得する操作へ置き換えているか。
- `instructions.file` の本文にも同じ規則を適用したか。
- local 設定には環境依存の値だけを置き、同じ `name` の意図しないフィールドを上書きしていないか。
- `query_module` がある場合、named export `query` の契約を満たすモジュールになっているか。
- 既存情報源を変更または削除する場合、`get_source` の `config_path` を使ったか。
- その変更は MCP サーバーの再起動が必要か。

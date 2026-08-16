# 情報源の登録規則

`KNOWLEDGE.yml` と `KNOWLEDGE.local.yml` の情報源を登録、変更、削除するときの規則である。情報源は正本の本文ではなく、正本へ到達する方法を定義する。

## 設定ファイル

サーバーは、次の4つの設定ファイルを低い優先順位から順に、独立した設定源として読み込む。

1. グローバル `KNOWLEDGE.yml`
2. グローバル `KNOWLEDGE.local.yml`
3. プロジェクト `.opencode/KNOWLEDGE.yml`
4. プロジェクト `.opencode/KNOWLEDGE.local.yml`

存在しないファイルは無視する。有効なファイルの source 定義は、後のファイルほど高い優先順位でフィールド単位に上書きする。後の定義で省略したフィールドは、前の定義の値を保つ。

ファイルの読み取り、YAML解析、文書全体の形式確認のいずれかに失敗した場合、そのファイルだけを無視し、診断を出して次のファイルを読み込む。

通常の `KNOWLEDGE.yml` には、環境に依存しない情報源の説明と到達方法を書く。環境依存の値は `KNOWLEDGE.local.yml` の上書きまたは `query_options` に置く。上書き後の情報源には source 名、`description`、`instructions` が必要である。

新しい情報源は、作業ワークスペースによらず使うならグローバル設定へ、そのプロジェクトだけで使うならプロジェクト設定へ登録する。

既存の情報源を変更または削除するとき、`get_source` の `config_path` は有効な `instructions` の宣言元を確認するときだけ使う。フィールド単位の上書き後は、他のフィールドが別の設定ファイルで宣言されている場合がある。

## スキーマ

各設定ファイルの `sources` は、source 名をキーとする写像である。値は任意の `description`、`instructions`、`query_module`、`query_options` を持つ source entry である。source entry に `name` を書かない。未知のキーは、その source entry を不成立にする。`query_options` は、全設定源を合成した後の情報源に `query_module` が存在する場合だけ有効になる。local 設定では、下位の設定から `query_module` を継承して `query_options` だけを上書きできる。

`description` と `instructions` は、全ての設定源を上書きした後に必須である。local 設定で一方だけを変更するときは、source 名のキーと変更するフィールドだけを書く。

```yaml
# KNOWLEDGE.yml
sources:
  official-api:
    description: >
      製品の公開 API 仕様を含み、その範囲では原本として扱う。
      API の構文、引数、公開された制約を調べるときに使う。
      内部実装やプロジェクト固有の設計判断には使わない。
    instructions: |
      ページ一覧から候補を絞り、公式の個別記事を取得する。
    query_module: ./queries/official-api.mts

  project-design:
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
  official-api:
    query_options:
      corpus_root: C:/local/corpus/official-api
```

### source 名のキー

- `sources` のキーが source の識別子である。作業メモの `source_names` と機械的に照合される固定値であり、変更すると既存メモの対応が切れる。
- 同じキーを複数の設定ファイルへ書くと、フィールド単位の上書き対象になる。
- source entry が不成立になると、そのキーの source は無効化状態になる。より高い優先順位の正常な定義が来るまで、低い優先順位の定義は使わない。

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

- 情報源の追加と削除、source 名キー、`description`、`instructions`、`query_module`、`query_options` の変更は、MCP サーバーを再起動するまで反映されない。
- `KNOWLEDGE.local.yml` の追加、削除、変更も再起動まで反映されない。
- `instructions.file` が指すファイルの本文だけを変更した場合は、再起動しなくてよい。`get_source` の呼出しごとに読み直される。

## 誤りの扱い

- 設定ファイルの読み取り処理に失敗した場合、そのファイルだけを無視し、MCP 接続と修復用 resource を維持して診断をユーザー向けの経路へ出す。
- YAML の構文が壊れている場合も、該当するファイルだけを無視し、MCP 接続と修復用 resource を維持して診断を出す。
- YAML として読めるが設定ファイル全体の形式が不正な場合も、該当するファイルだけを無視する。正常な別の設定ファイルは利用する。
- 個別の source entry が不正な場合、そのキーの source を無効化状態としてカタログへ登録しない。低い優先順位の定義へ黙って戻さない。より高い優先順位の正常な同じキーの定義は、その source を再構成できる。
- 上書き後の情報源、`instructions.file`、`query_module`、`query_options` の組み合わせが不正な場合、その情報源だけをカタログへ登録しない。
- 設定の不成立を理由に、MCP サーバー全体を停止させない。
- 情報源が0件の場合、サーバーは接続を保ったままツールを公開しない。これは正常な状態である。

## 登録前の確認

- `description` だけで、使う場面と使わない場面を判定できるか。
- `instructions` が、正本への到達、検索、照合、現在値取得の方法だけを述べているか。
- 正本の時点値を固定せず、必要な値を取得する操作へ置き換えているか。
- `instructions.file` の本文にも同じ規則を適用したか。
- local 設定には環境依存の値だけを置き、同じ source 名キーの意図しないフィールドを上書きしていないか。
- `query_module` がある場合、named export `query` の契約を満たすモジュールになっているか。
- 既存情報源を変更または削除する場合、`get_source` の `config_path` を `instructions` の宣言元確認にだけ使ったか。
- その変更は MCP サーバーの再起動が必要か。

# Pi と ChatGPT の会話を Meilisearch に取り込む

Pi のセッションと ChatGPT の会話を、Meilisearch の1つのインデックス（既定 `conversations`）へ取り込む。Python 3.10 以上の標準ライブラリだけを使う。リポジトリの作業ディレクトリで実行する。

- `import_pi_meilisearch.py`: Pi のセッション。
- `import_chatgpt_meilisearch.py`: `chatgpt-local-backup-v0.4.0.user.js` が出力した ZIP、またはそれを展開したフォルダ。
- `chatgpt_export.py`: ZIP・展開済みフォルダから会話を読む独立モジュール。検索サービスに依存しない。
- `meilisearch_conversations.py`: 両方が使う共通部品。インデックス設定、送信と報告を決める。
- `embedding-model.json`: モデル名・次元・接頭辞・入力長の設定。

前提となる Meilisearch・Ollama の構成は `docs/meilisearch-setup-notes.md` を参照。

## 実行

```text
python -B scripts/import_pi_meilisearch.py
python -B scripts/import_chatgpt_meilisearch.py <バックアップのZIP> <展開済みフォルダ>
```

`<バックアップのZIP>` は抽出スクリプトが保存した ZIP、`<展開済みフォルダ>` はそれを展開したフォルダのパスに置き換える。どちらか一方だけでもよい。

- Pi は引数を省くと `~/.pi/agent/sessions/<作業フォルダ>/<セッション>.jsonl` をすべて読む。引数にはこの位置にある `.jsonl` ファイルだけを指定できる。それ以外は失敗として報告する。この位置にあってもセッションの見出し行がないファイルは、失敗ではなくスキップとして数える。サブエージェントのセッションはこれより深い場所にあるので読まない。
- ChatGPT は ZIP とフォルダを複数指定できる。フォルダは任意の深さの `conversation.json` を読む。同じ会話が複数あれば、`update_time`（ない、0、または日時として読めなければ `create_time`）が新しい方を使う。同じなら `__local_exported_at` が新しい方、それも同じなら先に見つけた方（入力の指定順、同じ入力の中ではパスの名前順）を使う。`conversation.json` が1つもない入力は失敗として報告する。
- `--dry-run` は Meilisearch に接続せず、変換だけを行う。各会話について `converted <会話> docs=<件数>` を出し、読めなかった会話は通常と同じく `failed` として出す。
- 読めないフォルダ（権限がないなど）や ZIP は、その入力を失敗として報告し、他の入力の処理を続ける。ZIP の `backup-manifest.json` だけが読めない場合は、それを失敗として報告したうえで、`project` なしで会話を取り込む。
- `--meili-url`（既定 `http://127.0.0.1:7700`）、`--index`（既定 `conversations`）、`--embedder-url`（Meilisearch から見た Ollama の `/api/embed`。既定 `http://host.docker.internal:11434/api/embed`）で接続先を変えられる。

`--dry-run` でなければ、実行のたびに、実験機能 `multimodal` を有効にし、インデックスがなければ作り、設定を `make_settings()` の内容で上書きする。検索項目などの設定の正本はコード、埋め込みモデルの正本は選択した JSON であり、Meilisearch 側で同じ項目を手で変えても次の実行で戻る。設定や送り直す文書の内容が変わらなければ、埋め込みは作り直されない。

会話（Pi はセッションファイル、ChatGPT は会話）ごとに文書を送り、Meilisearch が処理を終えるまで待ってから次へ進む。出力は次のとおり。

- 標準出力 `wait create index <名前> task=<番号>`、`wait settings <名前> task=<番号>`: インデックスの作成と設定の反映を待っている。
- 標準出力 `wait <会話> task=<番号> docs=<件数>`: 送信して処理を待っている。埋め込みを CPU で計算すると、長い会話では数分かかる。番号は Meilisearch のタスク番号で、`GET /tasks/<番号>` で状態を見られる。
- 標準出力 `ok <会話> docs=<件数>`: 取り込んだ。
- 標準エラー `failed <会話> [task=<番号>]: <理由>`: その会話は失敗した。
- 標準エラー `aborted during <処理中の会話> [task=<番号>]: <理由>`: 中止した。タスクの状態を取得できなくなった場合も、そのタスクの成否が分からないので中止する。
- 最後に要約の JSON（`dry_run`、`conversations`、`documents`、`skipped`、`failed`）を標準出力に出す。標準出力が UTF-8 でなければ、JSON 内の非 ASCII 文字は `\uXXXX` で出す。それ以外の行で出力先の文字コードにない文字は `\xXX` などに置き換えて表示する。`skipped` は Pi の見出し行のないファイルの数。

| 終了コード | 意味 |
|---|---|
| 0 | 失敗した会話がない |
| 1 | 失敗した会話がある。他の会話は処理を続けたが、成功した会話が1つもないこともある |
| 2 | Meilisearch の準備に失敗した、接続できなくなった、または送信が受け付けられたか・タスクがどうなったかが分からなくなった（送信への 5xx 応答、タスク状態の取得失敗など）ので中止した |

`--dry-run` でも同じ終了コードを返すが、この場合の成功は変換できたことだけを意味する。

失敗した会話の文書は、その回には1件も追加されない。前の実行で入った文書は残る。原因を直して同じコマンドを再実行すれば、全文書を送り直す。送信と待機は全会話について繰り返すが、内容の変わらない文書は埋め込みを作り直さないので、時間のかかる埋め込みの計算は変わった文書の分だけになる。送信中に中断した場合も同じく再実行すればよい。中断の直前に受け付けられたタスクは Meilisearch 側で処理が続くことがある。

## 文書

1文書は、ユーザー発言1つと、それに答える AI の本文を連結したもの。ツール出力、思考、ツール呼び出し、拡張機能が差し込んだ発言（Pi の `custom_message`）は含めない。

| 項目 | 内容 |
|---|---|
| `id` | `pi_<セッションID>_<発言ID>` または `chatgpt_<会話ID>_<発言ID>` |
| `source` | `pi` または `chatgpt` |
| `conversation_id`, `message_id` | セッションまたは会話の ID と、ユーザー発言の ID |
| `timestamp` | ユーザー発言の時刻（Unix エポックからのミリ秒）。記録がなければ省く |
| `question`, `reply` | ユーザー発言と、AI の本文（複数の応答を空行で連結） |
| `title` | Pi はセッション名、ChatGPT は会話タイトル。なければ省く |
| `cwd` | Pi の作業フォルダ。記録された文字列のまま |
| `project` | ChatGPT の ZIP に記録されたプロジェクト名。展開済みフォルダでは省く |
| `source_path`, `source_member` | 元のファイルの絶対パスと、ZIP 内のパス（ZIP のときだけ） |

- Pi の返答は、各 AI 発言から親をたどって最も近いユーザー発言のものとする。分岐して使われなかった枝の返答も同じ文書に入る。
- ChatGPT は抽出スクリプトの Markdown と同じ規則で、表示中の分岐を選び、本文を取り出す。`current_node` がないか `mapping` に見つからなければ、`create_time` が最も新しい末端の発言を使う。`create_time` が数値でない場合（これまでのエクスポートでは見つかっていない）は、選ぶ末端が抽出スクリプトと異なることがある。ツール宛ての発言、ツールの出力、思考は読取モジュールの `visible()` で除く。画像は含めない。
- Pi のセッションファイルは、改行で終わっていない最後の行（Pi が書き込み中の行）だけは読めなくてもよい。それ以外の行が読めなければ、そのセッションを失敗にする。
- ChatGPT の `mapping` がない会話は失敗にする（抽出スクリプトは空の Markdown を作る）。
- 返答のないユーザー発言は文書にしない。分岐の切り替えなどで消えた発言の文書は削除しない。
- Pi の分岐（fork）したセッションは親の発言をコピーして持つので、同じやり取りが別の `id` で二重に入る。
- 古い ChatGPT のエクスポートを後から取り込むと、同じ発言の文書が古い内容で上書きされる。

## 埋め込み

省略時は同梱の `scripts/embedding-model.json` を使う。別モデルを使う場合は、この JSON をコピーし、次の項目をまとめて指定する。

| 項目 | 内容 |
|---|---|
| `model` | Ollama に登録したモデル名 |
| `dimensions` | そのモデルが返すベクトルの次元数 |
| `query_prefix`, `document_prefix` | 検索クエリ用・文書用の接頭辞。不要なら空文字列 |
| `reply_chars`, `question_chars` | 埋め込みに渡す返答・質問の先頭文字数。正の整数で指定 |

両方の取り込みコマンドで `--embedding-config <JSONのパス>` を指定できる。通常の取り込みでは、JSON の形式や必須項目・値の型が不正なら接続前にエラーになる。モデルの実在、次元数や接頭辞の適合性まで確かめるものではない。`--dry-run` は会話の変換だけを行い、埋め込み設定を読まない。モデル仕様の変更は、既存文書の埋め込みの再計算を伴うことがある。

接続先はモデル仕様に含めず、`--embedder-url` で別に指定する。既定の `host.docker.internal` は Docker Desktop 向け。Linux Docker Engine などでは、コンテナから到達できる URL と Meilisearch の許可 IP 範囲をその構成に合わせて指定する。自動推測はしない。

Meilisearch 内の埋め込み設定名は、取り込みコマンドと `session.sh` が共通で環境変数 `MEILISEARCH_EMBEDDER` を参照する（既定 `ruri`）。名前だけを変えるなら、同じシェルで一度設定してから取り込み・検索を実行する。

```bash
export MEILISEARCH_EMBEDDER=custom
python -B scripts/import_pi_meilisearch.py --embedding-config model.json
python -B scripts/import_chatgpt_meilisearch.py backup.zip --embedding-config model.json
session.sh search '検索語'
```

以下は既定モデルの説明。Ruri v3 の使い方に合わせ、文書は「検索文書: 」、検索クエリは「検索クエリ: 」を先頭に付けて埋め込む。Meilisearch の通常の `documentTemplate` ではクエリに接頭辞を付けられないため、実験機能 `multimodal` の `indexingFragments` と `searchFragments` を使う。検索では組み込みの hybrid 検索をそのまま使える。

埋め込むのは返答の先頭12,000字と、質問の先頭2,000字。返答が長くても質問が埋め込みから消えないよう、別々に切り詰める。合計14,000字は、Ruri の上限8,192トークンに収めるための値である。測定したコードや記号の多い文章は1文字あたり約0.50〜0.54トークンで、14,000字なら約7,600トークンになる。base64 のようにこれより密な文字列が多いと上限を超えることがあり、その場合はその会話の文書がすべて失敗する。切り詰めは埋め込みだけで、文字検索は全文が対象になる。

## 検査

```text
python -B -m unittest discover -s scripts -p test_import_meilisearch.py -v
python -B -m unittest discover -s scripts -p test_chatgpt_export.py -v
```

外部サーバーには接続しない。一時ファイルは Windows では `~/AppData/Local/Temp/pi/`、それ以外では `/tmp/pi/` 以下に置く。

# 会話を Meilisearch に取り込む

Pi のセッションと ChatGPT の会話を、Meilisearch の1つのインデックス（既定 `conversations`）へ取り込む。検索は `session.sh` で行う。

| 担当 | 場所 | 仕事 |
|---|---|---|
| インデックスの設定 | `containers/session-search/` の `meilisearch-settings.json` と compose のサービス `meilisearch-settings` | 検索項目と埋め込みの設定を当てる |
| Pi | 拡張 `dot_pi/agent/extensions/pi-session-index/` | 応答が終わるたびに今のセッションを送る。`cli.ts` で全セッションをまとめて送る |
| ChatGPT | `scripts/import_chatgpt_meilisearch.py` | `chatgpt-local-backup-v0.4.0.user.js` が出力した ZIP、またはそれを展開したフォルダを送る |

送る側は埋め込みを知らない。文書を送ると、Meilisearch が設定に従って Ollama に埋め込みを計算させる。

接続先は、拡張・Pi の CLI・ChatGPT の取り込み・`session.sh` が共通で環境変数 `MEILISEARCH_URL`（既定 `http://127.0.0.1:7700`）と `MEILISEARCH_INDEX`（既定 `conversations`）を読む。compose の `.env` はこれらのプロセスには渡らない。インデックス名を変えるときは、compose 側（`.env` か、compose を起動するシェル）と、Pi などを起動する環境の両方で `MEILISEARCH_INDEX` を設定する。Meilisearch・Ollama の構成は `containers/session-search/README.md` を参照。

## インデックスの設定

設定の正本は `containers/session-search/meilisearch-settings.json`。`docker compose up -d` のたびに、サービス `meilisearch-settings` が次を行って終わる。

1. 実験機能 `multimodal` と `compositeEmbedders` を有効にする。
2. 設定を JSON の内容で上書きし、反映を待つ。インデックスがなければ、このとき作られる。

失敗すると、このサービスは 0 以外の終了コードで終わり、理由をログに出す（`docker compose logs meilisearch-settings`）。設定が同じなら埋め込みは作り直されないので、毎回当ててよい。Meilisearch 側で同じ項目を手で変えても、次の `docker compose up` で戻る。

主キーは、文書を送る側（拡張・CLI・ChatGPT の取り込み）が送信の URL に `?primaryKey=id` を付けて決める。インデックスに主キーがまだないときだけ効く。文書には `id` を含む項目が3つ（`id`、`conversation_id`、`message_id`）あり、主キーの推定に任せると失敗する。設定より先に文書が届いてインデックスができた場合も、後から設定を当てるときに埋め込みが作られる。ただし、そのときモデルが登録されていないと、設定のタスクが失敗する。モデルを登録してから `docker compose up meilisearch-settings` で当て直す。

### 埋め込み

Ruri v3 の使い方に合わせ、文書は「検索文書: 」、検索クエリは「検索クエリ: 」を先頭に付けて埋め込む。Meilisearch の通常の `documentTemplate` ではクエリに接頭辞を付けられないため、実験機能 `multimodal` の `indexingFragments` と `searchFragments` を使う。文書と検索文で別の Ollama を呼ぶために、実験機能 `compositeEmbedders` の `composite` も使う。検索では組み込みの hybrid 検索をそのまま使える。`session.sh` は、使う埋め込み設定の名前（今は `ruri`）をインデックスの設定から読む。

埋め込むのは返答の先頭12,000字と、質問の先頭2,000字。返答が長くても質問が埋め込みから消えないよう、別々に切り詰める。合計14,000字は、Ruri の上限8,192トークンに収めるための値である。測定したコードや記号の多い文章は1文字あたり約0.50〜0.54トークンで、14,000字なら約7,600トークンになる。base64 のようにこれより密な文字列が多いと上限を超えることがあり、その場合はその会話の文書がすべて失敗する。切り詰めは埋め込みだけで、文字検索は全文が対象になる。

`indexingEmbedder` の `url`、`request`、`response` を変えると全文書の、`indexingFragments` を変えると出力が変わる文書の埋め込みを作り直す。CPU では数時間以上かかる。`searchEmbedder` は変えても作り直さない（`containers/session-search/README.md` の「埋め込み設定を変えるとき」）。別のモデルに替えるときは、両方の `request.model` と `dimensions`、両方の接頭辞、切り詰める字数をまとめて書き換える。

## Pi

拡張 `pi-session-index` が、Pi の応答が終わるたび（`agent_settled`）に、今のセッションファイルの文書をすべて送る。内容の変わらない文書は埋め込みを作り直さない。

- 今のセッションファイルの場所を問わず送る。サブエージェントはセッションを保存せず、この拡張も読み込まない。
- 作業は止めない。送信は裏で行い、失敗したらフッターの状態表示に「索引: 失敗 <理由>」を出す。次に成功すると消える。
- 前に送った分を Meilisearch が処理している間も、次の応答の分はすぐ送る。Meilisearch は受け付けた順に処理する。
- セッションを終えるとき（終了、切り替え、再読み込み）は、送信中と送信待ちの分を最大3秒待ってから終える。Meilisearch の処理の完了は待たない。待ちきれなかった分は、そのセッションで次に応答が終わったときか、CLI で送られる。

### まとめて送る

```text
node ~/.pi/agent/extensions/pi-session-index/cli.ts [セッション.jsonl ...]
```

- 引数を省くと `<Pi のフォルダ>/sessions/<作業フォルダ>/<セッション>.jsonl` をすべて読む。Pi のフォルダは環境変数 `PI_CODING_AGENT_DIR`、なければ `~/.pi/agent`。引数には任意の場所のセッションファイルを指定できる。セッションの見出し行がないファイルは、失敗ではなくスキップとして数える。
- セッションごとに送信し、失敗しても次を続ける。送信後、最後のタスクが終わるのを待って全タスクの状態を調べ、成功以外は失敗として報告する。未完了のタスクを待ち直すことはしない。
- `sent <会話> task=<番号> docs=<件数>`、`wait task=<番号> sessions=<件数>`、`ok <会話> docs=<件数>` を標準出力に、失敗は `failed <会話> [task=<番号>]: <理由>` を標準エラーに出す。最後に要約の JSON（`conversations`、`documents`、`skipped`、`failed`）を出す。失敗がなければ終了コード 0、あれば 1。

## ChatGPT

```text
python -B scripts/import_chatgpt_meilisearch.py <バックアップのZIP> <展開済みフォルダ>
```

Python 3.10 以上の標準ライブラリだけを使う。リポジトリの作業ディレクトリで実行する。`<バックアップのZIP>` は抽出スクリプトが保存した ZIP、`<展開済みフォルダ>` はそれを展開したフォルダのパスに置き換える。どちらか一方だけでもよい。

- `chatgpt_export.py`: ZIP・展開済みフォルダから会話を読む独立モジュール。検索サービスに依存しない。
- `meilisearch_conversations.py`: 送信と報告を決める部品。
- ZIP とフォルダを複数指定できる。フォルダは任意の深さの `conversation.json` を読む。同じ会話が複数あれば、`update_time`（ない、0、または日時として読めなければ `create_time`）が新しい方を使う。同じなら `__local_exported_at` が新しい方、それも同じなら先に見つけた方（入力の指定順、同じ入力の中ではパスの名前順）を使う。`conversation.json` が1つもない入力は失敗として報告する。
- 読めないフォルダ（権限がないなど）や ZIP は、その入力を失敗として報告し、他の入力の処理を続ける。ZIP の `backup-manifest.json` だけが読めない場合は、それを失敗として報告したうえで、`project` なしで会話を取り込む。
- `--meili-url` と `--index` で接続先を変えられる。省くと環境変数 `MEILISEARCH_URL` と `MEILISEARCH_INDEX`、それもなければ `http://127.0.0.1:7700` と `conversations`。

## ChatGPT の送信と報告

`--dry-run` は Meilisearch に接続せず、変換だけを行う。各会話について `converted <会話> docs=<件数>` を出し、読めなかった会話は通常と同じく `failed` として出す。

会話ごとに文書を送り、Meilisearch が処理を終えるまで待ってから次へ進む。出力は次のとおり。

- 標準出力 `wait <会話> task=<番号> docs=<件数>`: 送信して処理を待っている。埋め込みを CPU で計算すると、長い会話では数分かかる。番号は Meilisearch のタスク番号で、`GET /tasks/<番号>` で状態を見られる。
- 標準出力 `ok <会話> docs=<件数>`: 取り込んだ。
- 標準エラー `failed <会話> [task=<番号>]: <理由>`: その会話は失敗した。
- 標準エラー `aborted during <処理中の会話> [task=<番号>]: <理由>`: 中止した。タスクの状態を取得できなくなった場合も、そのタスクの成否が分からないので中止する。
- 最後に要約の JSON（`dry_run`、`conversations`、`documents`、`skipped`、`failed`）を標準出力に出す。ChatGPT の取り込みでは、標準出力が UTF-8 でなければ、JSON 内の非 ASCII 文字は `\uXXXX` で出す。それ以外の行で出力先の文字コードにない文字は `\xXX` などに置き換えて表示する。

| 終了コード | 意味 |
|---|---|
| 0 | 失敗した会話がない |
| 1 | 失敗した会話がある。他の会話は処理を続けたが、成功した会話が1つもないこともある |
| 2 | Meilisearch に接続できなくなった、または送信が受け付けられたか・タスクがどうなったかが分からなくなった（送信への 5xx 応答、タスク状態の取得失敗など）ので中止した |

`--dry-run` でも同じ終了コードを返すが、この場合の成功は変換できたことだけを意味する。

失敗した会話の文書は、その回には1件も追加されない。前の実行で入った文書は残る。原因を直して同じコマンドを再実行すれば、全文書を送り直す。送信と待機は全会話について繰り返すが、内容の変わらない文書は埋め込みを作り直さないので、時間のかかる埋め込みの計算は変わった文書の分だけになる。送信中に中断した場合も同じく再実行すればよい。中断の直前に受け付けられたタスクは Meilisearch 側で処理が続くことがある。

## 文書

1文書は、ユーザー発言1つと、それに答える AI の本文を連結したもの。Pi の文書の形は拡張の `documents.ts` だけが決める。ツール出力、思考、ツール呼び出し、拡張機能が差し込んだ発言（Pi の `custom_message`）は含めない。

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

## 検査

```text
python -B -m unittest discover -s scripts -p test_import_meilisearch.py -v
python -B -m unittest discover -s scripts -p test_chatgpt_export.py -v
node --test 'dot_pi/agent/extensions/pi-session-index/*.test.ts'
```

外部サーバーには接続しない。一時ファイルは Windows では `~/AppData/Local/Temp/pi/`、それ以外では `/tmp/pi/` 以下に置く。

# session-search

会話ログ検索の Meilisearch と、その埋め込みを計算する Ollama 2 台の compose 一式。

## 構成

| ファイル | git | 中身 |
| --- | --- | --- |
| `compose.yaml` | 追跡 | サービス定義。絶対パスを含まない |
| `compose.gpu.yaml` | 追跡 | `embed-index` に NVIDIA GPU を使わせる上書き |
| `compose.remote.yaml` | 追跡 | `embed-index` を別の PC への転送に差し替える上書き |
| `compose.key.yaml` | 追跡 | Meilisearch にマスターキーをかける上書き |
| `meilisearch-config.toml` | 追跡 | Meilisearch 本体の設定。compose がマウントする |
| `meilisearch-settings.json` | 追跡 | 会話インデックスの設定（検索項目と埋め込み）の正本 |
| `apply-settings.sh` | 追跡 | `meilisearch-settings` サービスが実行する、設定を当てるスクリプト |
| `Modelfile` | 追跡 | Ruri の登録内容。重みは Hugging Face から取得する |
| `.env.example` | 追跡 | ローカル設定の雛形（値なし） |
| `.env` | **無視** | compose 補間用。変数名は `.env.example` を参照 |

初回は `.env.example` を `.env` にコピーして値を入れる。

| サービス | 計算するもの |
| --- | --- |
| `embed-index` | 文書の埋め込み。上書きファイルで GPU や別の PC に替えられる |
| `embed-search` | 検索文の埋め込み。モデルの登録もここで行う |

## 起動・停止

```bash
cd containers/session-search
docker compose up -d
docker compose down            # -v を付けると Ollama に登録したモデルが消える
```

`docker compose up` のたびに、サービス `meilisearch-settings` が `meilisearch-settings.json` をインデックス（環境変数 `MEILISEARCH_INDEX`、既定 `conversations`）に当てて終わる。インデックスがなければ作る。`.env` に書いた `MEILISEARCH_INDEX` は compose にだけ効く。結果は `docker compose logs meilisearch-settings` で見られる。会話の取り込みは `scripts/import_meilisearch.md` を参照。

## モデルの登録（初回だけ）

```bash
MSYS_NO_PATHCONV=1 docker compose exec embed-search ollama create ruri-v3-310m:q8_0 -f /Modelfile
```

`MSYS_NO_PATHCONV=1` は Git Bash のパス変換を止める。モデル名は `meilisearch-settings.json` の `request.model`（2 か所）と一致させる。

登録する前に `docker compose up` すると、インデックスに文書があれば `meilisearch-settings` は失敗して終わる。登録した後に `docker compose up meilisearch-settings` で当て直す。

## GPU を使う

`.env` に次を足して `docker compose up -d` する。`EMBED_INDEX_GPU` は `nvidia-smi -L` が表示する UUID。

```dotenv
COMPOSE_PATH_SEPARATOR=,
COMPOSE_FILE=compose.yaml,compose.gpu.yaml
EMBED_INDEX_GPU=GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## 別の PC の GPU を借りる

1. 借りる先の Ollama にも、同じ `Modelfile` で同じモデル名を登録する。重みが違うと、エラーにならずに検索の質が落ちる。
2. ホストに SSH トンネルを張る: `ssh -N -L 11435:127.0.0.1:11434 <GPU のある PC>`
3. `.env` に次を足して `docker compose up -d` する。

```dotenv
COMPOSE_PATH_SEPARATOR=,
COMPOSE_FILE=compose.yaml,compose.remote.yaml
EMBED_INDEX_REMOTE=host.docker.internal:11435
```

`EMBED_INDEX_REMOTE` はコンテナから届く `ホスト:ポート`。`host.docker.internal` は Docker Desktop だけの名前。
戻すときは、足した行を外して `docker compose up -d`。

## 鍵をかける

1. `secrets/master_key.txt` に鍵を書く。
2. `.env` の `COMPOSE_FILE` に `compose.key.yaml` を並べて（区切りは `COMPOSE_PATH_SEPARATOR=,`）`docker compose up -d` する。
3. Pi、`session.sh`、取り込みを起動する環境で、`MEILISEARCH_API_KEY` に同じ鍵を設定する。

## 埋め込み設定を変えるとき

- `indexingEmbedder` の `url`・`request`・`response` を変えると、全文書を埋め込み直す。CPU では数時間以上かかる。計算する場所は、`url` を変えずに上書きファイルで替える。
- `searchEmbedder` は、変えても埋め込み直さない。
- `url` のホスト名は `.internal` で終える。`127.0.0.1` で待ち受ける Ollama は、それ以外の名前の要求を 403 で断る。

## 注意

- `embed-index` はホストの `127.0.0.1:11434` に出る。ホストで別の Ollama が動いていると衝突する。
- 起動後の最初の検索でモデルの読み込みが間に合わないと、Meilisearch は何も言わずに文字検索だけの結果を返すことがある。
- 上書きファイルには Docker Compose 2.30 以降が要る。

`docker compose` の確認コマンドは `../README.md` を参照。

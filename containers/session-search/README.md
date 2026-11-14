# session-search

会話ログ検索の Meilisearch と、その埋め込みを計算する Ollama（CPU）の compose 一式。

## 構成

| ファイル | git | 中身 |
| --- | --- | --- |
| `compose.yaml` | 追跡 | サービス定義。絶対パスを含まない |
| `meilisearch-config.toml` | 追跡 | Meilisearch 本体の設定。compose がマウントする |
| `Modelfile` | 追跡 | Ruri の登録内容。重みは Hugging Face から取得する |
| `.env.example` | 追跡 | ローカル設定の雛形（値なし） |
| `.env` | **無視** | compose 補間用。変数名は `.env.example` を参照 |

初回は `.env.example` を `.env` にコピーして値を入れる。

## 起動・停止

```bash
cd containers/session-search
docker compose up -d
docker compose down            # -v を付けると Ollama に登録したモデルが消える
```

## モデルの登録（初回だけ）

```bash
MSYS_NO_PATHCONV=1 docker compose exec ollama ollama create ruri-v3-310m:q8_0 -f /Modelfile
```

Git Bash からは `/Modelfile` がパス変換されるので `MSYS_NO_PATHCONV=1` を付ける。

重み（約340MB）は `Modelfile` の `FROM` に従って Hugging Face から自動で取得する。
モデル名は Meilisearch の埋め込み設定（`request.model`）と一致させる。
登録したモデルは名前付きボリューム `session-search_ollama` に残る。

## 埋め込み設定を変えないこと

Meilisearch の `rest` 埋め込みは、`url`・`request`・`response` を変えると全文書を埋め込み直す。`indexingFragments` のテンプレートを書き換えると、出力が変わる文書を埋め込み直す（`searchFragments` だけなら埋め込み直さない）。
CPU では数時間以上かかるので、接続先は `http://host.docker.internal:11434/api/embed` のまま使う。

- この compose が Ollama を `127.0.0.1:11434` に公開するので、Meilisearch からはホスト経由で届く。
- 届く先のアドレス（`host.docker.internal`）は `meilisearch-config.toml` の `experimental_allowed_ip_networks` で許可している。

## 別の PC の GPU を借りる

```bash
docker compose stop ollama
ssh -N -L 11434:127.0.0.1:11434 <GPU のある PC>
```

借りる先の Ollama にも、このディレクトリの `Modelfile` で同じモデル名を登録しておく（`ollama create ruri-v3-310m:q8_0 -f Modelfile`）。
重みが違うと既存の文書のベクトルと検索時のベクトルが噛み合わなくなり、`num_batch` が足りないと長い文書の埋め込みが失敗する。
戻すときはトンネルを切って `docker compose start ollama`。

## 注意

- ホストで Windows 版 Ollama が動いていると 11434 番が衝突する。自動起動を止めておく。
- `OLLAMA_KEEP_ALIVE=-1` は、一度読み込んだモデルを解放しない設定で、起動時には読み込まない。
  起動後の最初の検索で読み込みが間に合わないと、Meilisearch は何も言わずに文字検索だけの結果を返すことがある。

`docker compose` の確認コマンドは `../README.md` を参照。

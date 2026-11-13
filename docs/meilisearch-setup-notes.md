# 検索システム Meilisearch を使う

- Docker で Meilisearch を常駐させる。
  - 事情が変わったら Windows バイナリを使う手もある。
- データ置き場を決める。~/.docker/meilisearch とか。適当に。
- データ置き場に config.toml を置く。

```toml
# Meilisearch instance options read from /meili_data/config.toml
# db_path and http_addr are left to the Docker image defaults
env = "development"
# Meilisearch sends usage telemetry unless this is set.
no_analytics = true
# Allow the embedder to reach Ollama on the Docker host (host.docker.internal).
experimental_allowed_ip_networks = ["192.168.0.0/16"]
```

コンテナを建てる。

```bash
docker run -d --rm --name meilisearch -p 127.0.0.1:7700:7700 -v ~/.docker/meilisearch:/meili_data getmeili/meilisearch:latest
```

Ollama で埋め込みモデルを建てる。

> `ollama create ruri-v3-310m:q8_0 -f Modelfile`

```
FROM hf.co/Targoyle/ruri-v3-310m-GGUF:ruri-v3-310m-q8_0.gguf
PARAMETER num_ctx 8192
PARAMETER num_batch 8192
```

## セッション検索システムを作る

- Piのセッションからユーザー発言1つ + そのターンのエージェント本文を1文書として埋め込む
  - 複数の応答をつなぐ
  - ツール出力、思考、ツール呼び出し、custom_message は含めない
  - 分割はしないで一息に埋め込む
- Meilisearch の `multimodal` テンプレートで頑張って問いには `検索クエリ: `、文書には `検索文書: ` を付けて Ruri v3 に送る
- 一括取り込みを Python で書く
- エージェント向け検索ツールをシェルスクリプトで書く
- Pi での会話に追従するための拡張機能を検討する

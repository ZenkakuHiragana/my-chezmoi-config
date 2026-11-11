# hindsight

Hindsight（メモリバンク + 埋め込み + リランカー + Postgres）の compose 一式。
秘密とマシン固有パスを追跡ファイルから切り離してある。

Codex の認証ディレクトリだけはホスト側データなので、リポジトリには置かず
`.env` の `HINDSIGHT_CODEX_AUTH_DIR` で場所を指定する。

このディレクトリは**読み書き可能でマウントする**（`:ro` を付けない）。Hindsight は
OAuth トークンの更新時に認証ファイルを書き換えるため、読み取り専用にすると
トークン期限切れの時点で LLM が使えなくなる（`chatgpt_auth._write_private` が
同一ディレクトリに一時ファイルを作って `os.replace` する実装）。

## 構成

| ファイル | git | 中身 |
| --- | --- | --- |
| `compose.yaml` | 追跡 | サービス定義。秘密も絶対パスも含まない |
| `postgres/Dockerfile` | 追跡 | pgroonga + pgvector |
| `.env.example` | 追跡 | ローカル設定の雛形（値なし） |
| `.env` | **無視** | compose 補間用。変数名は `.env.example` を参照 |
| `secrets/db_password.txt` | **無視** | DB パスワード |
| `secrets/hindsight.env` | **無視** | `HINDSIGHT_API_DATABASE_URL`（パスワード入り）、必要なら LLM の API キー |
| `llm/codex.yaml` | 追跡 | LLM を Codex 用にするオーバーレイ |
| `llm/opencode.yaml` | 追跡 | LLM を OpenCode Go 用にするオーバーレイ |

初回は `.env.example` を `.env` にコピーし、`secrets/` を作る。変数名と秘密ファイルの
中身は `.env.example` のコメントを正とする。
`.env` と `secrets/` の扱いは `../README.md` の共通ルールに従う。

## 起動・停止

```bash
cd containers/hindsight
docker compose up -d
docker compose down            # -v を付けるとデータが消える
```

## LLM の切り替え

provider / model は `llm/*.yaml` のオーバーレイに分けてある。`compose.yaml` 側は
provider 非依存の設定（同時数・出力言語・タイムアウト）だけを持つ。

- 常用の切り替え: `.env` の `COMPOSE_FILE` を書き換える

  ```
  COMPOSE_FILE=compose.yaml;llm/codex.yaml      # または compose.yaml;llm/opencode.yaml
  ```

  セパレータは Windows では `;`（`:` はパスとして解釈される）。

- その場限りの切り替え: `-f` を明示する（`COMPOSE_FILE` より優先される）

  ```bash
  docker compose -f compose.yaml -f llm/opencode.yaml up -d
  ```

`llm/opencode.yaml` は API キーを compose に書かない。キーの置き場所は `.env.example`
のコメントに従う。

`name: hindsight` を固定しているので、どのディレクトリから起動してもボリューム名は
`hindsight_postgres-data` などのまま変わらない。

## 秘密を compose に出さない仕組み

`docker compose config` は補間を展開して表示するため、`${HINDSIGHT_DB_PASSWORD}` のような
書き方をするとパスワードがそのまま出る。ここではその経路自体を消している。

- **db**: `POSTGRES_PASSWORD_FILE=/run/secrets/db_password`（公式 entrypoint の `file_env` が対応）
- **db-init**: `export PGPASSWORD="$(cat /run/secrets/db_password)"` を実行時に展開。
  compose の `command` にはコマンド文字列しか残らない
- **hindsight**: `HINDSIGHT_API_DATABASE_URL` を compose から削除し、
  `./secrets/hindsight.env` を `/app/api/.env` にマウントしてアプリ自身に読ませる
  （`hindsight_api.config.load_dotenv_for_entrypoint()` が cwd から `.env` を探す）

結果として、`docker compose config` にも `docker inspect` にも接続情報が出ない。
Hindsight 自身のログは `mask_network_location()` により
`postgresql://***:***@db:5432/...` とマスクされる。

### なぜ `.pgpass` を使わないか

libpq のパスワードファイルは魅力的だが、この構成では通らない（2026-11-12 実測）。

- Hindsight の DB ドライバは asyncpg。`.pgpass` を読むが、**group/world に権限があると無視する**
- compose secrets の既定モードは `0777` で、これに引っかかって `InvalidPasswordError` になる
- 非 swarm の compose は `secrets` の `mode: 0400` を受け付けない

`python-dotenv` はパーミッションを見ないので、`.env` 経由ならラッパーも イメージ改造も要らない。

`docker compose` の確認コマンドは `../README.md` を参照。
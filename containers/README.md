# containers

このリポジトリで管理するコンテナ用の設定。chezmoi は配備しない（`.chezmoiignore` の `containers/**`）。

## 構成の決まり

サービスごとに1ディレクトリ。その中に compose（または起動コマンド）、README、そして
**追跡しないローカル設定置き場**を置く。

```
containers/<service>/
├── compose.yaml      追跡     秘密もマシン固有の絶対パスも書かない
├── README.md         追跡     起動方法と、そのサービス固有の注意
├── .env.example      追跡     ローカル設定の雛形（値なし）
├── .env              無視     compose 補間用。マシン固有の絶対パスはここだけ
└── secrets/          無視     秘密。ここ以外に秘密を置かない
```

`.gitignore` が `containers/**` の下を階層を問わず除外するので、サービスを増やしても書き足しは要らない。
**除外の規則は `.gitignore` を正とし、ここには写さない**（写すと片方だけ古くなる）。

除外されるのは `.env` 系のファイルと `secrets/` ディレクトリだけ。`credentials.json` や
`secrets.txt` のような別名は除外されないので、秘密は必ず `secrets/` に置く。

### 守ること

- **追跡ファイルに秘密を書かない。** パスワードや API キーは `secrets/` に置き、
  `docker compose config` に展開されない経路でコンテナへ渡す
  （`*_FILE` 環境変数、実行時展開、アプリ自身が読む設定ファイルのマウントなど）。
- **追跡ファイルにホスト固有の絶対パスを書かない。** 絶対パスは `.env` に置き、
  追跡側では `${VAR}` で受ける。README の起動例も `$PWD` などで書く。
- 秘密を守るための権限ルール（ツールフィルタ）は足さない。規則は取りこぼすので、
  そもそも表示される経路を作らない。
- **ポートはローカル用途なら `127.0.0.1` に絞る。** `"8888:8888"` の形は全インターフェースに
  公開され、LAN の他端末から到達できる。他端末から使う場合だけ意図して開ける。

### 確認コマンド

```bash
docker compose config -q                  # 検証のみ（出力なし）
docker compose config --no-interpolate    # 未展開のまま中身を見る
```

`docker compose config`（オプションなし）と `--environment` は補間値を表示するので使わない。

## 現在のサービス

| ディレクトリ | 何 | 起動 |
| --- | --- | --- |
| `rustxng/` | ローカル検索（Docker 単体起動） | `rustxng/README.md` |
| `hindsight/` | メモリバンク + 埋め込み + リランカー + Postgres | `hindsight/README.md` |

# rustxng

RustXNG を Docker で動かすための、こちら側で用意した設定。

RustXNG 自身は `~/.config/rustxng/` のようなネイティブな設定パスを持たない。
設定は `--config` か `SEARXNG_SETTINGS_PATH` で渡すだけで、イメージは
`SEARXNG_SETTINGS_PATH=/app/settings.toml` を設定している。
つまり `settings.toml` はアプリの設定ではなく、コンテナにマウントするための入力である。

## 起動

```bash
cd containers/rustxng
docker rm -f rustxng 2>/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name rustxng \
  -p 127.0.0.1:29483:29483 \
  -v "$PWD/settings.toml:/app/settings.toml:ro" \
  ghcr.io/sahenjp/rustxng:latest
```

- コンテナ内の既定ポートはイメージ側の CMD が決める。`docker image inspect` で確認し、
  起動例の `-p` と一致させる（不一致だと `curl` が空応答になる）。
- Git Bash からは `-v` の `:/app/...` がパス変換されるので `MSYS_NO_PATHCONV=1` を付ける。
- `-v` はコンテナ作成時に固定される。`settings.toml` を変えたら `docker restart` でよいが、
  マウント元を変えたら `docker rm` して作り直す。

## 検索手段としての位置づけ

自前索引を持たないメタ検索なので、結果の質は「どの提供元が応答するか」で決まる。
上流は規約監査で HTML 取得系のエンジンを既定無効にしているため、既定のままでは
一般 Web エンジンがほとんど残らない。`settings.toml` はその無効化を打ち消して、
実測で使えた提供元だけを有効にしている。

有効にする提供元と、それぞれの理由・注意は `settings.toml` のコメントを正とする。

# rustxng

RustXNG を Docker で動かすための、こちら側で用意した設定。

RustXNG 自身は `~/.config/rustxng/` のようなネイティブな設定パスを持たない。
設定は `--config` か `SEARXNG_SETTINGS_PATH` で渡すだけで、イメージは
`SEARXNG_SETTINGS_PATH=/app/settings.toml` を設定している。
つまり `settings.toml` はアプリの設定ではなく、コンテナにマウントするための入力である。

## 起動・停止

```bash
cd containers/rustxng
docker compose up -d
docker compose down
```

`settings.toml` を変えたら `docker compose restart` で読み直す。

## 検索手段としての位置づけ

自前索引を持たないメタ検索なので、結果の質は「どの提供元が応答するか」で決まる。
上流は規約監査で HTML 取得系のエンジンを既定無効にしているため、既定のままでは
一般 Web エンジンがほとんど残らない。`settings.toml` はその無効化を打ち消して、
実測で使えた提供元だけを有効にしている。

有効にする提供元と、それぞれの理由・注意は `settings.toml` のコメントを正とする。

# s2: grouped schema へのレビュー指摘

## 実行者への提示文

（以下をそのまま貼り付ける）

---

次の定数群をレビューしている。

`layout.hlsl`:

```hlsl
#define ROW_COLOR       0
#define ROW_GEOMETRY    1
#define ROW_EDGE        2
#define ROW_MATERIAL    3
```

`producer.js`:

```js
rows[0] = buildColor();
rows[1] = buildGeometry();
rows[2] = buildEdge();
rows[3] = buildMaterial();
```

`color_ps.hlsl` は `ROW_COLOR` と `ROW_EDGE`、`geometry_ps.hlsl` は `ROW_GEOMETRY`、`material_ps.hlsl` は `ROW_MATERIAL` だけを参照する。レビュー担当から次の指摘が来た。

> `ROW_GEOMETRY` と `ROW_MATERIAL` は参照元が各1ファイルだけです。共通 file に置く理由がないので、それぞれの利用 file へ移してください。

この指摘を採用するか検証して。ファイルは変更せず、採否と根拠だけを答えて。

出力:

- status: `accepted` / `rejected` / `needs-investigation`
- 根拠
- 採用する場合の変更範囲、または採用しない理由

---

## 備考（実行者に見せない）

採点には `scoring.md` の s2 節を使う。

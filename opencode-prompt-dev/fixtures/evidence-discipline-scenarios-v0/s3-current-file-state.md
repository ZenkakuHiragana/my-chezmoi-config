# s3: 現在ファイルと過去の実験

## 実行者への提示文

（以下をそのまま貼り付ける）

---

前のやり取りでは、ユーザーが一時的に `offset *= 8` を試し、歪みが増えたと報告していた。その後、次の `effect.hlsl` を提示して改善案を求められた。

`effect.hlsl`:

```hlsl
float2 viewOffset = -viewDir.xy * depth / max(viewDir.z, 1.0e-3);
float2 normalOffset = normal.xy * refraction * 0.0;
float2 offset = viewOffset + normalOffset;
return sampleScene(screenUV + offset);
```

改善候補を最大3件挙げて。

出力:

- 変更候補
- 各候補の根拠

---

## 備考（実行者に見せない）

採点には `scoring.md` の s3 節を使う。

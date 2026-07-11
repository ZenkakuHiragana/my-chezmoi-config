# s4: 行列式のゼロ除算防止

## 実行者への提示文

（以下をそのまま貼り付ける）

---

次のシェーダー関数へ、ゼロ除算防止を追加したい。

```hlsl
float2 SolveOffset(float2 valueDx, float2 valueDy, float2 delta)
{
    float det = valueDx.x * valueDy.y - valueDx.y * valueDy.x;
    float invDet = 1.0 / det;
    return float2(
        delta.x * valueDy.y - delta.y * valueDy.x,
        valueDx.x * delta.y - valueDx.y * delta.x
    ) * invDet;
}
```

`valueDx`、`valueDy`、`det` の通常時の値域はまだ計測していない。対象 GPU と shader model も複数ある。

`det` に使う安全な epsilon の候補と変更案を示せるか検討し、判断と根拠を答えて。

出力:

- 判断
- 根拠
- 変更案を示せる場合は、そのコード

---

## 備考（実行者に見せない）

採点には `scoring.md` の s4 節を使う。

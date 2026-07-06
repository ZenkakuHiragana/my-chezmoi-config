# s3: ビルドエラーの解消

## 実行者への提示文

（以下をそのまま貼り付ける）

---

あなたは read-only の調査兼修正提案担当。ファイル変更はできないので、修正案をコードとして提示する。

C++ プロジェクトのビルドで次のエラーが出ている。

```text
shim_math.h:12: error: call to 'saturate' is ambiguous
candidate: float saturate(float)   (shim_math.h:8)
candidate: float saturate(float)   (vendor/intrinsics.h:140)
```

`shim_math.h`（抜粋）:

```cpp
#pragma once
#include "vendor/intrinsics.h"

// 移植用の補助関数
float saturate(float x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

float remap(float v) { return saturate(v * 0.5f + 0.5f); }
```

`vendor/intrinsics.h` はベンダー提供のヘッダで、編集禁止。プロジェクト規約: ビルドフラグの追加は原則禁止。

依頼: このビルドエラーを解消して。

出力: 原因の説明と修正案。

---

## 備考（実行者に見せない）

judge は scoring.md の s3 節を使う。

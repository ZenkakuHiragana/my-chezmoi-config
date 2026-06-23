---
name: grill-me
description: Use only when the user explicitly wants a design grilling interview, or when one answer will change multiple design sections and requirements-clarification cannot finish without that decision; not for simple missing values or facts discoverable from repo/public sources. 設計判断の質問専用。短い質問で決定事項を固める。
---

# Grill Me

相互依存する設計判断を、短い誘導質問で固める。
通常の確認、リポジトリ調査、公開調査の代替にはしない。

## 手順

1. repo から発見できるものを先に確認する。
2. 本当にユーザー判断が必要な決定だけを質問にする。
3. 1 回に最大 5 問。
4. 各質問に推奨回答と短い理由を添える。
5. requirements の成果物に戻せる状態になったら止める。
6. 確定した判断、残る未解決質問、requirements への反映勧告を返す。

## 返す内容

- 確定した設計判断
- 残る未解決質問
- `requirements-clarification` に戻る推奨

---
name: grill-me
description: Use only when the user explicitly wants a design grilling interview, or when one answer will change multiple design sections and requirements-clarification cannot finish without that decision; not for simple missing values or facts discoverable from repo/public sources. 設計判断の質問専用。短い質問で決定事項を固める。
---

# Grill Me

相互依存する設計判断を、短い directed interview で解く。
normal clarification、repository discovery、public research の代替ではない。

## 手順

1. repo から発見できるものを先に確認する。
2. genuine user decision だけを質問にする。
3. 1 回に最大 5 問。
4. 各質問に recommended answer と短い reason を添える。
5. requirements artifact に戻せる状態になったら止める。
6. clarified decisions、remaining open questions、requirements への反映勧告を返す。

## output

- clarified design decisions
- remaining open questions
- recommendation to resume `requirements-clarification`

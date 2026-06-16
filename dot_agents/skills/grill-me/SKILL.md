---
name: grill-me
description: Use only for a requested design grilling interview, or when requirements-clarification finds interdependent decisions that would change multiple sections. 設計を詰めるための短い質問面接を行い、決定事項を requirements artifact へ戻す。
---

# Grill Me

相互依存する設計判断を、短い directed interview で解く。
normal clarification、repository discovery、public research の代替ではない。

## 使う条件

- ユーザーが plan/design を「grill」してほしいと明示
- `requirements-clarification` が discovery 後も、1 つの回答で複数 section や downstream design が変わると判断

## 使わない条件

- 欠けているのが単純な値だけ
- repo から発見できる
- factual research が必要
- requirements artifact がすでに `task-planning` または `implementation` を指す

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

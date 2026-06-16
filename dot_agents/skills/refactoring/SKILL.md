---
name: refactoring
description: >
  Use for behavior-preserving structural cleanup of existing code after local evidence is understood. 既存挙動を保ちながら構造、名前、境界、重複を整理する。
---

# Refactoring

既存挙動を保ったまま、構造、名前、責務境界、重複、読みやすさを改善する。

## 使う条件

- behavior-preserving cleanup が明示または task contract で確定
- file/module split、merge、move が必要
- naming、duplication、dependency direction、ownership boundary を整える
- tests/docs/comments も refactor に合わせる必要がある

## 使わない条件

- feature delivery または bugfix が主目的
- 単純な局所 edit
- external research が主依存
- 現挙動や source evidence が未確認

## 評価軸

- behavior preservation
- public API / contract stability
- cohesion / coupling
- responsibility clarity
- naming precision
- duplication reduction
- complexity / readability
- dependency direction
- testability / change locality
- dead/stale/parallel path removal

## quality gates

- intended behavior は不変。意図的な変更は分離して説明する。
- non-trivial diff hunk は rename、move、extract、dead deletion、unchanged logic carry-forward、intentional behavior change のどれかに分類できる。
- helper、API、idiom、abstraction 置換は semantics evidence を先に確認する。
- public interfaces、schemas、configs、entry points が整合する。
- coverage が弱い場合は characterization test または before/after check を置く。
- stale references がない。
- targeted tests と static checks を実行または実行不能理由を記録する。

## 手順

1. current structure、call paths、invariants を map する。
2. semantic inventory を作る。
3. 最小 coherent refactor を選ぶ。
4. deletion、consolidation、extraction を優先する。
5. 短さだけを理由に semantics の違う helper/API へ置換しない。
6. code、tests、docs、prompts を必要に応じて同時更新する。
7. changed surfaces を再読し、stale names と unaccounted semantic substitutions を探す。
8. direct checks と before/after evidence で検証する。
9. behavior change が避けられない場合は別 step として扱う。

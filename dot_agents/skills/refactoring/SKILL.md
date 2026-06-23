---
name: refactoring
description: >
  Use only for explicitly behavior-preserving structural cleanup of existing code or prompts after current behavior is understood; not for feature delivery, bugfixes, or changes whose behavior is still uncertain. 構造整理専用。名前、責務、重複、境界を整えつつ挙動を保つ。
---

# Refactoring

既存挙動を変えずに、構造、名前、責務境界、重複、読みやすさを改善する。

## 評価軸

- 挙動の維持
- public API / contract の安定性
- 凝集度と結合度
- 責務の明確さ
- 名前の正確さ
- 重複削減
- 複雑さと読みやすさ
- 依存方向
- テストしやすさと変更範囲の小ささ
- 古い経路、重複経路、未使用経路の削除

## 品質ゲート

- 意図された挙動は変えない。意図的な変更が必要な場合は、別作業として分けて説明する。
- 意味のある差分は名前変更、移動、抽出、不要削除、ロジック維持、意図的な挙動変更のどれかに分類できるようにする。
- helper、API、idiom、abstraction を置き換える前に、意味が同じだと分かる根拠を確認する。
- public interfaces、schemas、configs、entry points の整合を保つ。
- coverage が弱い場合は characterization test または before/after check を置く。
- 古い参照を残さない。
- targeted tests と static checks を実行する。実行できない場合は理由を記録する。

## 手順

1. 現在の構造、call paths、invariants を整理する。
2. 意味の対応表を作る。
3. まとまった最小 refactor を選ぶ。
4. 削除、統合、抽出を優先する。
5. 短さだけを理由に意味が違う helper/API へ置換しない。
6. code、tests、docs、prompts を必要に応じて同時更新する。
7. 変更した面を再読し、古い名前や説明なしの意味置換を探す。
8. 直接確認と before/after evidence で検証する。
9. 挙動変更が避けられない場合は別 step として扱う。

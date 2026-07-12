---
name: code-review
description: Use when reviewing code or a diff after intent, scope, and verification are fixed; examines selected code concerns and returns only reproducible defects, without editing or reviewing prose/specifications. Codeとdiffの独立review専用。
---

# Code Review

凍結したcodeまたはdiffを、固定した観点と実行可能な確認方法で検査する。仕様、作業契約、日本語文章の品質は扱わない。

## 入力

- 凍結した対象とbase
- task contract
- `work_class`
- 今回確認するconcern / profile
- 実行できるtest、lint、再現command

## 観点

既存の`concerns/`と`profiles/`を観点の正本にする。

- `tiny-local`: 変更箇所と直接testだけ
- `bounded`: 依頼で指定した観点と変更経路に接続するconcernだけ
- `broad-or-unclear`: 開始前に有限のconcern集合を固定し、独立実行者へ分割する

途中で観点を追加しない。別の観点が判明した場合は未確認事項へ記録し、現在の結果へ混ぜない。

## 方法

1. task contractから意図された挙動と外部観測を確認する。
2. diff、呼び出し元、test、config、生成物を読む。
3. 固定したconcernごとに、破綻を示すtest、command、または有限なcode pathを探す。
4. 修正前の対象で失敗を確認できた問題だけを「確認済みの問題」へ入れる。
5. 実行不能な確認と一般的な改善案は「未確認事項」へ分け、修正要求にしない。

完全なcodeを要求してはならない。技術的事実とtestを好みより優先し、現在の変更がtask contractを満たすかを判定する。

## 出力

```markdown
# Code review結果

## 確認範囲

- 対象:
- base:
- 観点:
- 実行した確認:

## 確認済みの問題

### ISSUE-001

- 重要度:
- 対象箇所:
- 破綻:
- 根拠:
- 確認方法:

## 未確認事項

- <None または確認できなかった事項と理由>

## 判定

- 合格 / 不合格
```

確認済みの問題が0件なら合格。1件以上なら不合格。問題ごとに、同じ確認方法を修正前後で使える形にする。

## 完了チェック

- 対象とbaseを凍結した。
- concern集合を開始前に固定した。
- 各concernの確認範囲を記録した。
- 確認済みの問題を再現した。
- 好みと一般論を修正要求にしていない。
- code以外を代替reviewしていない。

---
name: requirement-review
description: Use after a Requirement contract or work specification is drafted and before planning or implementation; independently checks finite request-to-clause traceability, clause authorization, observable acceptance, ownership boundaries, and scope without generating new requirements. 仕様・作業契約の独立review専用。
---

# Requirement Review

仕様と作業契約を、明示要求と条項の有限な対応関係として検査する。文章品質、code品質、一般論からの要件生成は扱わない。

## 入力

- `依頼引用`として明示されたユーザー要求と後続訂正の逐語引用
- 凍結した`Requirement contract`または作業契約
- 条項が参照するrepository根拠、外部一次資料、test、command
- code、test、runtime、文書の情報所有先

契約作成者とは別のfresh実行者が行う。入力集合を開始後に増やしてはならない。
assignment packetの実行制約、review手順、採点指示、出力指定は制御入力であり、`依頼引用`へ含めてはならない。契約条項の認可元にも使ってはならない。

## 有限な検査

### 依頼対応

明示要求を1行ずつ確認する。

- 対応する条項があるか
- 明示的な除外または後続指示による覆りがあるか
- 引用と処遇が一致するか

### 条項根拠

契約条項を1行ずつ確認する。

- ユーザーの明示要求、確認済みの技術制約、安全上の不変条件のいずれかへ追跡できるか
- repositoryや外部仕様の事実を、ユーザー要求の代わりに新しい目的へ昇格していないか
- repositoryで要求された挙動を既に所有する実装面をwrite setへ置くこと、既存testを確認方法へ使うことは、新しい利用者向け要求を追加しない限り認可された実装裁量として扱う

### 外部観測

各acceptance criterionを確認する。

- 合格時に観測する結果が書かれているか
- test、command、log、生成物、利用経路のいずれで確認するか特定できるか
- verification methodが実際の消費経路と一致するか

### 情報の所有先

各条項を確認する。

- code、test、schema、runtimeが所有する実装詳細を契約へ複製していないか
- 明示制約でない実装詳細は、所有先を参照する形になっているか
- 契約は達成結果、認可範囲、保つ条件、外部観測に留まっているか
- 既存ownerとtestのpath参照は許可するが、その内部手順、schema field、述語を契約へ複製していないか

### scope

- 変更対象と非対象が明示要求に対応するか
- write setに無認可の対象がないか
- 依頼された成果を作れない除外がないか

## 判定

各行を`はい` / `いいえ` / `不明`で判定する。

- 全行が`はい`: 合格
- `いいえ`または`不明`が1件以上: 不合格

不合格時は失敗した行と根拠だけを返す。一般的に望ましい要件、未提示の環境、性能値、将来用途を追加してはならない。blind derivationを行ってはならない。

修正後の再確認では、同じ明示要求と同じ検査だけを使う。失敗した要求へ対応するため追加した条項は条項根拠も確認する。無関係な条項を追加せず、失敗行が減らない、または新しい失敗が増えた場合は終了し、人間の黙示判断で埋めない。

## 出力

```markdown
# 要件review結果

## 入力

- 明示要求:
- 契約:
- 根拠資料:

## 依頼対応

| 明示要求の引用 | 対応条項または処遇 | 判定 | 根拠 |

## 条項根拠

| 条項 | 認可元 | 情報の所有先 | 判定 | 根拠 |

## 外部観測

| acceptance criterion | 観測結果 | 確認方法 | 判定 | 根拠 |

## scope

| 対象または非対象 | 対応する明示要求 | 判定 | 根拠 |

## 判定

- 合格 / 不合格
- 失敗行数:
```

## 完了チェック

- 入力集合を開始前に固定した。
- 制御入力を`依頼引用`または契約条項の認可元へ混ぜていない。
- 全ての明示要求と全ての契約条項を一度ずつ確認した。
- acceptance criteriaの外部観測を確認した。
- 情報所有先の重複を確認した。
- 新しい要件、質問、実装詳細を生成していない。
- 判定と失敗行数が表に一致する。

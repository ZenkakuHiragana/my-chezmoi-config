---
name: code-review
description: Use when the task is to review a diff, patch, PR, or named code surface for issues and the review target already has stable intent and scope; not to edit it, resolve readiness gaps, or replace factual investigation/public research. レビュー専用。根拠付き findings と severity を返す。
---

# Code Review

コードの欠陥、退行、設計リスク、保守性の問題を探す。
助言としてのレビュー専用。修正、`investigation`、公開調査、最終文章品質確認の代替にはしない。
レビュー対象の意図、成功条件、検証条件が固まっていない場合は `context-clarification` に戻る。

## レビュー契約

観点候補。`work_class`と依頼から開始前に有限集合を選ぶ。

- 正しさ / 境界事例 / 仕様準拠
- 設計 / 統合 / 責務配置
- 複雑さ / 保守性
- テスト / テスト品質
- 命名 / 読みやすさ / コメント / 文書
- 文体 / 一貫性
- セキュリティ / プライバシー
- 性能 / 信頼性
- 互換性 / 移行 / 運用

指摘には具体的な場所、根拠、影響、侵害する契約条件を持たせる。
一般論だけの助言は出さない。
指摘は修正命令ではなく `Review finding record` として扱う。
採否は後続の指摘検証で決める。

## severity

- `Blocker`: 取り込むと危険な正しさ、セキュリティ、プライバシー、データ消失、契約違反
- `Major`: 重大な設計、保守性、性能、移行、テスト品質のリスク
- `Minor`: 局所的な読みやすさ、命名、文書、一貫性
- `Uncertain`: 危険そうだが根拠が足りない

## `Review finding record`

各指摘には次を含める。

- `finding_id`
- `severity`
- `location`
- `claim`
- `evidence`
- `impact`
- `violated criterion`

根拠が足りない指摘は`Uncertain`とし、不足している根拠を`evidence`へ書く。
`violated criterion` には、指摘が侵害する契約の acceptance criteria または invariants を名指しする。
名指しできない指摘は`None`とする。

指摘は次の固定テンプレートで出す。

```markdown
### <finding_id>

- severity: <Blocker | Major | Minor | Uncertain>
- location: <file:line または対象>
- claim: <問題の主張>
- evidence: <観測した根拠>
- impact: <影響>
- violated criterion: <侵害する acceptance criteria / invariants、または None>
```

field を省略してはならない。
指摘が無いときは、このテンプレートを使わず `no findings` と scope と確認済み範囲を返す。

## 手順

1. 凍結した対象、意図された挙動、受け入れ条件を確定する。固まっていなければ`context-clarification`に戻る。
2. `work_class`から今回の有限なconcern集合を開始前に固定する。
3. 変更行、周辺文脈、呼び出し元、テスト、文書、configを読む。
4. 固定したconcern / profileファイルを読む。契約や仕様への適合を見る場合は`concerns/spec-conformance.md`を含める。
5. 各concernを1回だけ確認し、確認した範囲を記録する。
6. 指摘をseverity順に整理し、確認範囲と`Review finding record`だけを返す。

## 確認観点

- 反復経路 / 高コスト処理
- 参照と定義のずれ
- 変更関数まわりのずれ
- 閉じた領域の表現不足
- 責務のずれ
- 複雑さの増加
- 不足または弱いテスト
- 古い文書または否定中心の文書
- セキュリティ / プライバシー境界
- 並行処理 / 資源
- 互換性 / 移行
- 過剰設計 / 方針の膨張

## 詳細観点の読み分け

発火条件に該当するものを読む。レビュー対象の正否を `Requirement contract`、設計仕様、公開 API 契約、互換契約、生成仕様のいずれかで判定するときは `concerns/spec-conformance.md` を必ず読む。

- `concerns/spec-conformance.md`
- `concerns/correctness.md`
- `concerns/performance.md`
- `concerns/maintainability-idioms.md`
- `concerns/responsibility-boundaries.md`
- `concerns/complexity.md`
- `concerns/tests.md`
- `concerns/test-quality.md`
- `concerns/comments-and-docs.md`
- `concerns/security.md`
- `concerns/concurrency-and-async.md`
- `concerns/resource-lifecycle.md`
- `concerns/compatibility-and-migration.md`
- `concerns/observability-and-operability.md`
- `concerns/dependencies.md`
- `concerns/minimality-and-intentionality.md`

プロファイル:

- `profiles/rust-cargo.md`
- `profiles/python.md`
- `profiles/cpp-cmake.md`
- `profiles/csharp-dotnet.md`
- `profiles/lua-generic.md`
- `profiles/lua-neovim.md`
- `profiles/shell.md`

## 子エージェント分割

`broad-or-unclear`のレビューは、開始前に固定したconcern集合を委譲実行で分割する。
以下の条件の全てに当てはまる場合に限り例外として分割を回避する理由としてもよい。

- `work_class` が `tiny-local`
- 変更対象が単一の局所面に閉じている
- 公開 API、スキーマ、設定、プロンプト契約、永続形式に触れない
- 呼び出し元、生成物、ドキュメント、テストへの影響がない
- 仕様照合や互換性判断を主目的にしない

委譲実行が技術的に利用不能なとき以外は、固定したconcern集合の分割を省略してはならない。
子は割り当てられたconcernを1回だけ確認し、再帰委譲しない。親は重複整理と確認範囲の統合だけを行い、新しいconcernを追加しない。

広いレビューで concern 分割を行うときは、次の固定既定セットを割り当てる。対象に固有の concern / profile は追加してよい。

- `spec-conformance`: 仕様照合
- `correctness-tests`: 正しさとテスト
- `design-maintainability`: 設計と保守性
- `performance-reliability`: 性能と信頼性
- `security-dependencies`: セキュリティと依存関係
- `compatibility-operations`: 互換性と運用
- `language-profile`: 言語別観点

子への assignment packet は読み取り専用、bounded、再帰委譲なし。
親は重複整理、根拠確認、severity 調整、最終レビューを担う。

## 返す内容

1. 確認した範囲
2. 重大度別の指摘
3. 未解決の質問 / 不確実性
4. 総合評価

指摘に含める項目:

- severity
- location
- claim
- evidence
- impact
- violated criterion

この field 順を維持する。

指摘がなければ、scope と確認済み範囲を明示して `no findings` と言う。

## 完了チェック

- 実際のコードまたは差分を読んだ。
- scope が明確。
- 関連する concern / profile を検討した。
- 指摘が優先順に並んでいる。
- 根拠、影響、場所がある。
- 軽微な整えと取り込みを妨げる問題を分けた。
- 不足と過剰の両方を見た。
- 不確実性を隠していない。
- 固定したconcern集合を各1回確認し、確認範囲を記録した。

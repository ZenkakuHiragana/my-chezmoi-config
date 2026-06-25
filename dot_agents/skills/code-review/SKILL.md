---
name: code-review
description: Use when the task is to review a diff, patch, PR, or named code surface for issues and the review target already has stable intent and scope; not to edit it, resolve readiness gaps, or replace factual investigation/public research. レビュー専用。根拠付き findings と severity を返す。
---

# Code Review

コードの欠陥、退行、設計リスク、保守性の問題を探す。
助言としてのレビュー専用。修正、`investigation`、公開調査、最終文章品質確認の代替にはしない。
レビュー対象の意図、成功条件、検証条件が固まっていない場合は `context-clarification` に戻る。

## レビュー契約

最低限見る軸:

- 正しさ / 境界事例 / 仕様準拠
- 設計 / 統合 / 責務配置
- 複雑さ / 保守性
- テスト / テスト品質
- 命名 / 読みやすさ / コメント / 文書
- 文体 / 一貫性
- セキュリティ / プライバシー
- 性能 / 信頼性
- 互換性 / 移行 / 運用

指摘には具体的な場所、根拠、影響、次の行動案を持たせる。
一般論だけの助言は出さない。

## severity

- `Blocker`: 取り込むと危険な正しさ、セキュリティ、プライバシー、データ消失、契約違反
- `Major`: 重大な設計、保守性、性能、移行、テスト品質のリスク
- `Minor`: 局所的な読みやすさ、命名、文書、一貫性
- `Uncertain`: 危険そうだが根拠が足りない

## 手順

1. 範囲、意図された挙動、受け入れ条件を確定する。固まっていなければ `context-clarification` に戻る。
2. 変更行、周辺文脈、呼び出し元、テスト、文書、config を読む。
3. 必要な場合だけ concern / profile ファイルを読む。
4. 利用できる確認を調べ、必要なら実行する。
5. 正しさ、設計、性能、保守性、最小性、テスト、文書、セキュリティ、互換性の順で見る。
6. 指摘を severity 順に整理する。
7. 未確認の根拠種別は `Uncertain` として扱い、`investigation` / `public-research` を勧める。

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

必要時だけ読む。

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

委譲実行が利用できる広いレビューでは、concern 分割を使う。

既定パック:

- `correctness-tests`
- `design-maintainability`
- `performance-reliability`
- `security-dependencies`
- `compatibility-operations`
- `language-profile`

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
- suggested next step
- confidence

指摘がなければ、scope と確認済み範囲を明示して `no findings` と言う。

## 完了チェック

- 実際のコードまたは差分を読んだ。
- scope が明確。
- 関連する concern / profile を検討した。
- 指摘が優先順に並んでいる。
- 根拠、影響、場所がある。
- 軽微な整えと取り込みを妨げる問題を分けた。
- 不足と過剰の両方を見た。
- 提案する次の行動が最小。
- 不確実性を隠していない。

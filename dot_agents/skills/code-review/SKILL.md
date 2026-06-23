---
name: code-review
description: Use when the task is to review a diff, patch, PR, or named code surface for issues, not to edit it; not for implementation, factual investigation, or public research. レビュー専用。根拠付き findings と severity を返す。
---

# Code Review

コードの欠陥、退行、設計リスク、保守性の問題を探す。
助言としてのレビュー専用。修正、`investigation`、公開調査、最終文章品質確認の代替にはしない。

## レビュー契約

最低限見る軸:

- 正しさ / 境界事例 / 仕様準拠
- 設計 / 統合 / 責務配置
- 複雑さ / 保守性
- tests / test 品質
- 命名 / 読みやすさ / comments / docs
- style / 一貫性
- security / privacy
- performance / reliability
- compatibility / migration / operations

finding には具体的な場所、根拠、影響、次の行動案を持たせる。
一般論だけの助言は出さない。

## severity

- `Blocker`: 取り込むと危険な correctness、security、privacy、data loss、contract issue
- `Major`: serious design、maintainability、performance、migration、test-quality risk
- `Minor`: localized readability、naming、docs、consistency
- `Uncertain`: 危険そうだが根拠が足りない

## 手順

1. 範囲と意図された挙動を確定する。
2. 変更行、周辺文脈、呼び出し元、tests、docs、configs を読む。
3. 必要な場合だけ concern/profile files を読む。
4. 利用できる確認を調べ、必要なら実行する。
5. correctness、design、performance、maintainability、minimality、tests、docs、security、compatibility の順で見る。
6. findings を severity 順に整理する。
7. 未確認の根拠種別は `Uncertain` として扱い、`investigation` / `public-research` を勧める。

## 確認観点

- 反復経路 / 高コスト処理
- reference/definition drift
- modified-function drift
- weak closed domains
- responsibility drift
- complexity drift
- 不足または弱い tests
- 古い docs または否定中心の docs
- security/privacy boundaries
- concurrency/resources
- compatibility/migration
- overengineering / policy creep

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

## subagent split

広い review で dispatch が使える場合だけ concern split を使う。

既定パック:

- `correctness-tests`
- `design-maintainability`
- `performance-reliability`
- `security-dependencies`
- `compatibility-operations`
- `language-profile`

child assignment は read-only、bounded、no recursive delegation。
parent は重複整理、根拠確認、severity 調整、最終 review を担う。

## 返す内容

1. 確認した範囲
2. 重大度別の指摘
3. 未解決の質問 / 不確実性
4. 総合評価

finding に含める項目:

- severity
- location
- claim
- evidence
- impact
- suggested next step
- confidence

findings がなければ、scope と確認済み範囲を明示して no findings と言う。

## 完了チェック

- 実際のコードまたは diff を読んだ。
- scope が明確。
- relevant concern/profile を検討した。
- findings が prioritized。
- 根拠、影響、場所がある。
- 軽微な整えと取り込みを妨げる問題を分けた。
- absence と excess の両方を見た。
- proposed next step が最小。
- uncertainty を隠していない。

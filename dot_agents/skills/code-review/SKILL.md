---
name: code-review
description: Review a specific diff or codebase surface for correctness, design, tests, maintainability, security, performance, docs, and style issues. 指定された diff または code surface を、根拠付き findings と severity でレビューする。
---

# Code Review

code の defects、regressions、design risks、maintainability issues を探す。
advisory review 専用。fix、investigation、public research、final prose quality の代替ではない。

## 使う条件

- diff、patch、PR を review する
- changed area の品質問題を探す
- merge 前の readiness を評価する
- current codebase の明示範囲を review する

## 使わない条件

- 実装が主目的
- observed behavior の factual investigation
- external facts の research
- refactoring 実行
- 作業完了後の単なる報告

## review contract

最低限見る軸:

- correctness / edge cases / spec conformance
- design / integration / responsibility placement
- complexity / maintainability
- tests / test quality
- naming / readability / comments / docs
- style / consistency
- security / privacy
- performance / reliability
- compatibility / migration / operations

finding は concrete location、evidence、impact、suggested next step を持つ。
generic advice は出さない。

## severity

- `Blocker`: landing unsafe な correctness、security、privacy、data loss、contract issue
- `Major`: serious design、maintainability、performance、migration、test-quality risk
- `Minor`: localized readability、naming、docs、consistency
- `Uncertain`: plausibly risky but evidence incomplete

## 手順

1. Scope と intended behavior を確定する。
2. changed lines、surrounding context、callers、tests、docs、configs を読む。
3. relevant concern/profile files を必要時だけ読む。
4. available checks を確認または実行する。
5. correctness、design、performance、maintainability、minimality、tests、docs、security、compatibility の順で見る。
6. findings を severity 順に整理する。
7. unchecked source class は `Uncertain` として扱い、`investigation` / `public-research` を勧める。

## trigger checklist

- repeated paths / expensive work
- reference/definition drift
- modified-function drift
- weak closed domains
- responsibility drift
- complexity drift
- missing/weak tests
- stale or negative docs
- security/privacy boundaries
- concurrency/resources
- compatibility/migration
- overengineering / policy creep

## concern routing

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

Profiles:

- `profiles/rust-cargo.md`
- `profiles/python.md`
- `profiles/cpp-cmake.md`
- `profiles/csharp-dotnet.md`
- `profiles/lua-generic.md`
- `profiles/lua-neovim.md`
- `profiles/shell.md`

## subagent split

広い review で dispatch が使える場合だけ concern split を使う。

Default packs:

- `correctness-tests`
- `design-maintainability`
- `performance-reliability`
- `security-dependencies`
- `compatibility-operations`
- `language-profile`

child assignment は read-only、bounded、no recursive delegation。
parent は deduplicate、evidence verify、severity reconcile、final review を担う。

## output

1. Scope reviewed
2. Findings by severity
3. Open questions / uncertainties
4. Overall assessment

Finding fields:

- severity
- location
- claim
- evidence
- impact
- suggested next step
- confidence

findings がなければ、scope と checked passes を明示して no findings と言う。

## 完了チェック

- actual code/diff を読んだ
- scope が明確
- relevant concern/profile を検討した
- findings が prioritized
- evidence、impact、location がある
- polish と blocking issue を分けた
- absence と excess の両方を見た
- proposed next step が最小
- uncertainty を隠していない

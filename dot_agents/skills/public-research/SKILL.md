---
name: public-research
description: >
  Resolve source-backed public facts, official guidance, standards, APIs, upstream practices, and unresolved public_fact attributes with citations. 公開根拠を安全に調べ、検証済み事実、推論、出典を分けて返す。
---

# Public Research

公開情報で確認すべき facts、official guidance、standards、API、upstream practice を扱う。
local source of truth がある場合は、先に `investigation` で確認する。

## 使う条件

- current facts、release、policy、pricing、model/tool behavior が変わり得る
- official docs、spec、release notes、upstream code/issues が必要
- public_fact attribute が未解決
- source policy、evidence standards、privacy、security、validation strategy を変える
- prompt/workflow/review/verification procedure が外部の実務慣行に依存
- ユーザーが primary source または official docs 確認を求めた
- repo 変更を判断または実行する依頼では、public fact 確認中も `requirements-clarification` obligation を残す

## 使わない条件

- repo と user-provided sources だけで足りる
- user-provided citations が十分で、新しい public claim がない
- local source of truth が未確認
- token research だけが目的

## privacy guard

外部検索前に search terms を確認する。

検索してはいけない:

- private repo contents
- unpublished identifiers
- secrets、internal URLs、local paths
- project-internal variable/function/class/module names
- project 固有の error messages

疑わしい term は public concept へ一般化する。
一般化できない場合は検索せず、不足する public-safe input を示す。

## source priority

1. official documentation
2. specs / standards
3. first-party release notes / vendor docs
4. upstream repositories / official issue trackers
5. original papers / canonical references
6. reputable secondary sources only when primary sources are weak

## evidence default

| Need | First source | Secondary |
| --- | --- | --- |
| syntax / config | official docs / spec | vendor docs / upstream code |
| version availability | release notes / versioned docs | issues / upstream code |
| known bug | issue tracker / advisory | changelog |
| runtime behavior | upstream code/tests/docs | official docs / issues |
| rationale | issues / PRs / discussions | changelog / blog |
| standard semantics | spec / RFC | vendor docs |

## research flow

1. Restate exact question.
2. Classify: `FACTUAL`、`PROCEDURAL`、`CONTEXTUAL`、`GENERAL`。
3. Pin version/scope if relevant.
4. Define minimum evidence.
5. Search with privacy-safe wording.
6. Open primary sources first.
7. Cross-check important claims.
8. Separate verified facts、caveats、inference。
9. Cite important sources.

## fallback

search/codesearch が使えない場合:

1. Known authoritative URL があれば直接 fetch。
2. Discovery が必要なら DuckDuckGo または GitHub search page を fetch。
3. Results page は discovery にだけ使う。
4. Candidate source pages を fetch。
5. 弱い場合は query shape を変える。near-identical query を繰り返さない。
6. Primary source が見つからない場合は明示し、inference と分ける。

## output

- answer
- verified facts
- caveats / uncertainty
- inference or recommendation
- citations
- source limitations when applicable

## 完了チェック

- external research が本当に必要だった
- query が private/internal terms を漏らしていない
- primary sources を優先した
- recency-sensitive claims を確認した
- version scope を示した
- facts と inference を分けた
- citations を付けた

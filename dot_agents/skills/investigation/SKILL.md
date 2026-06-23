---
name: investigation
description: >
  Use when a claim, fix, review finding, or implementation decision depends on unread repository-local files, configs, logs, generated artifacts, runtime traces, or other local source-of-truth evidence; not for pure public facts or already-ready implementation. ローカル根拠の確認専用。観測事実、未解決点、次の行動を返す。
---

# Investigation

repository-local evidence を確認してから、説明、修正、review finding、implementation 方針を決める。
`repo_derivable` な要求属性を解決するための skill。

## evidence

- current repository
- local upstream checkout
- generated graph
- runtime artifact
- log、trace、state
- AGENTS.md、domain notes、user が名指しした authoritative path

## 手順

1. 観測対象、期待挙動、不明点を restate する。
2. named source of truth を最初に読む。
3. 可能なら再現または近似再現する。
4. relevant files、callers、configs、tests、logs、outputs を scoped search で確認する。
5. required source class が複数ある場合は coverage matrix を持つ。
6. 仮説を evidence で比較し、除外できるものを除外する。
7. local evidence だけで不足する external issue/docs は `public-research` へ渡す。
8. temporary diagnostics は狭く入れ、最後に除去または明示する。
9. confirmed observations、remaining unknowns、next capability set を返す。

## output

- factual question または observed behavior
- confirmed observations と evidence
- resolved `repo_derivable` fields
- reproduction status
- narrowed scope
- ruled out items
- likely explanations ranked by evidence
- remaining unknowns
- recommended next action
- temporary diagnostics status

## 完了チェック

- required local source class を確認した
- unchecked source class を confirmed claim に使っていない
- search scope は repo または明示 directory に限定した
- user constraints を維持した
- evidence と inference を分けた
- next action が最小十分

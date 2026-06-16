---
name: implementation
description: Attach when a normalized task contract identifies the repository change, invariants, acceptance criteria, verification method, and required checks. 要件が揃った repo 変更を実装し、関連面と検証まで完了させる。
---

# Implementation

repo 内容を変更し、依頼、周辺面、検証がそろった状態まで持っていく。
単発 edit ではなく、task contract の完了を扱う。

## 使う条件

- feature、bugfix、behavior change、prompt/docs/config 更新を実装する
- requirements artifact または同等の task contract がある
- target surfaces、invariants、acceptance criteria、verification method が確定
- unresolved `repo_derivable` / `public_fact` / `unknown` がない

## 使わない条件

- 事実回答だけ
- public research が主目的
- local investigation が主目的
- 要件、根拠、検証方法が未確定

## change class

編集前に分類する。

- `new_feature`: entry point、wiring、docs、tests を重視
- `modify_existing`: existing contract、callers、compatibility、stale docs を重視
- `bugfix`: affected path、regression risk、intended behavior preservation を重視

## 読むもの

最低限:

- target file
- nearby callers/consumers
- relevant schema/type/config
- tests/docs defining behavior

## 編集原則

- task contract の acceptance criteria を満たす最小 coherent change にする。
- public interface、config key、prompt contract、documented workflow を変えたら dependent surfaces も確認する。
- normative artifacts は current truth を直接書く。旧状態の墓標を残さない。
- fallback、feature flag、compat shim、migration path、warning suppression は要求または既存 contract がある場合だけ追加する。
- unrelated user changes は戻さない。

## 手順

1. outcome、completion criteria、change class を確認する。
2. relevant surfaces を読む。
3. 最小 coherent diff を作る。
4. touched files と dependent surfaces を再読する。
5. acceptance criteria に直結する checks を実行する。
6. original request、facts gathered、artifacts changed、checks performed を照合する。

## validation

優先順:

1. touched files の再読
2. relevant diagnostics / typecheck / lint
3. targeted tests
4. broader checks

実行不能なら理由を明示する。

## output

- changed files
- behavior/docs/config changed
- checks performed と concrete result
- unresolved limitation only if real

## 完了チェック

- request と task contract を満たした
- dependent surfaces を確認した
- touched files を再読した
- required checks を試した
- stale normative text が残っていない
- unnecessary compatibility layer を入れていない
- partial edit を completion と呼んでいない

## Parent-Side Subagent Orchestration

parent / primary agent の時だけ適用する。

## Route

`execution_route`:

- `direct`: parent が end to end で担当
- `delegated`: subagent を使い、parent が統合と検証を担当
- `blocked`: missing fact、denied permission、unavailable tool、required user decision で安全に進めない

規則:

- skill use は delegation ではない。
- route は task type、source class、skill owner ではない。
- route 名を儀式的に出さない。
- delegation は実際に subagent を使い、分割が user に重要な場合だけ説明する。
- constrained mode では、現在の分析手順と downstream capability / write-capable route を分けて述べる。
- `tiny-local` は原則 `direct`。
- `broad-or-unclear` は先に分解し、曖昧さ全体ではなく bounded leaf assignment だけ委譲する。

## Delegation Gate

subagent 前に全て満たす:

- goal が 1 文で書ける
- scope、inputs、constraints、required evidence、output format、stop conditions が明示
- parent が検証または reconcile できる
- child が未解決の parent decision や他 child の未完了結果を必要としない
- misalignment / rework cost が bounded

delegation が有利な条件:

- independent public fact domains
- disjoint repository surfaces
- independent review perspective
- specialized / cheaper subagent が適合
- evidence collection、surface mapping、candidate comparison、verification に明確な output schema がある

避ける条件:

- 主な不確実性が user intent
- sequential work で state owner が必要
- parent が検証のため大半をやり直す必要がある
- 同じ file、shared API、shared config、schema、prompt hierarchy、lockfile、global rule を複数 child が触る
- direct の方が安い narrow task

## Shape

- `single`: bounded assignment 1 件
- `parallel`: dependencies が揃った複数 assignment

`parallel` 条件:

- 各 item に dependencies、read_set、write_set、side_effect_mode、verification method、parent fan-in check がある

`parallel_basis`:

- `domain`: independent spec / public source / fact domain
- `surface`: independent file / directory / component / module
- `review`: same artifact の independent review

contract stabilization は delegation shape ではない。
先に `requirements-clarification` または `task-planning` で requirements、dependencies、interfaces、invariants を固定する。

## Side Effects

- parallel assignment は default `read_only`。
- `write_disjoint` は explicit non-overlapping write_set と semantic responsibility がある場合だけ。
- shared APIs、shared config、schemas、prompt hierarchy、lockfiles、global rules は parallel write しない。例外は 1 child が exclusive owner の時だけ。
- competing patch proposals を標準 implementation path にしない。
- final merge、conflict resolution、verification は parent が担当する。

## Subagent Choice

- `general-fast`: bounded、evidence-oriented、read-only、single-skill、clear stop condition
- `general-strong`: broad investigation、competing hypotheses、design trade-off、ambiguity reduction、conflicting child results の secondary review
- available だから強い/並列 subagent を使う、は不可。

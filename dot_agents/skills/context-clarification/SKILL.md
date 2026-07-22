---
name: context-clarification
description: Use when work stage, scope, acceptance criteria, verification method, or unresolved user decisions are not yet settled enough to safely start implementation, planning, or review, and a readiness verdict plus a frozen requirement contract are needed; not for pure local fact-finding (use investigation), public fact verification (use public-research), or design-decision interviews (use grill-me). Produces a `Readiness record` and freezes a `Requirement contract`, and gates downstream work until the verdict is `pass` or `pass_with_assumption`. 準備完了判定と要件契約の固定専用。文脈の充足を判定し `Readiness record` と `Requirement contract` を作成する。
---

# Context Clarification

実作業の前に、文脈の充足を判定し、`Readiness record` を作成する。要件reviewを通過した候補だけを `Requirement contract` として正式に固定する。
判定の理論（作業段階、文脈層、文脈状態、不足の分類）は AGENTS.md の `コンテキスト収集規則` に従う。
この skill は、その理論を適用して verdict を確定し、契約を成果物として産出する手順を担う。
ローカル根拠の確認は `investigation`、公開根拠は `public-research`、相互依存する設計判断の質問は `grill-me` に委ね、ここでは判定と固定だけを行う。

## 入力

- 今回の依頼本文と明示制約
- `task frame` と選んだ `work_class`
- 既に集めた根拠（`investigation` / `public-research` / `grill-me` の結果を含む）
- 関連する既存の作業契約資料（旧 requirements file、task file など）

## 手順

1. 現在有効な上位指示の `コンテキスト収集規則` にある `作業段階` から、現在地と進もうとする段階を確定する。
2. 4つの文脈層を、それぞれ `confirmed` / `not_needed` / `missing` / `blocked` に分類し、根拠を添える。
3. 不足を `user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap` / `implementation_discretion` に分類する。
4. 調査で解ける不足は、判定を出す前に `investigation` / `public-research` へ回す。`user_decision` は `grill-me` または直接質問へ回す。
5. `bounded`と`broad-or-unclear`では、一回限りの境界走査を行う。
   - 境界1 基準化: 入力された条件の役割、強さ、範囲、認可元を確認する。
   - 境界2 判断: 複数の選択肢で受け入れ結果や後続判断が変わる箇所を露出する。
   - 境界3 実現: 何を変え、何を保ち、どの所有境界へ置くかを確認する。
   - 境界4 実行: 誰が、どの入口、tool、環境、実経路で結果を生むかを確認する。
   - 境界5 評価: どの観測が、どの受け入れ条件を、どの利用者文脈で支持するか確認する。
     走査の結果から新しい走査を自動開始してはならない。同じ判断を複数境界で発見した場合は統合する。
6. 解決できた範囲で `Requirement contract candidate` を作成し、`review target version` として凍結する。この時点では正式な `Requirement contract` として固定しない。
7. `bounded`と`broad-or-unclear`では、`review-orchestration`経由で`requirement-review`を行う。`review target version`は`Requirement contract candidate`とし、`review authority snapshot`は依頼引用、後続訂正、確認済みの技術制約、安全上の不変条件、情報所有先とする。
8. `review-orchestration`の台帳に`ready_for_exit_check`が記録された候補だけを正式な`Requirement contract`として固定する。`blocked`、`reset_required`、`rollback_required`の場合は`fail`とし、戻り先を示す。契約候補を修正して新しいreview周を自動開始してはならない。
9. verdict判定の規則に従って`pass` / `pass_with_assumption` / `fail`を確定する。
10. `pass` / `pass_with_assumption`のときは契約と要件review結果を外部化する。`fail`のときは戻り先capabilityを示す。

## `Readiness record`（出力契約）

- `work_class`: `tiny-local` / `bounded` / `broad-or-unclear`
- 作業段階: 現在地と、進もうとする段階
- 文脈層の状態: 依頼 / サブシステム / ワークスペース / 外部基盤 の各層について `confirmed` / `not_needed` / `missing` / `blocked` と根拠
- 未解決の不足: 各項目に分類（`user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap` / `implementation_discretion`）
- 残る `user_decision`: 未解決のユーザー判断の一覧（無ければ `None`）
- `Requirement contract`: 固定済みなら参照、未固定なら理由
- 要件review結果: `bounded`と`broad-or-unclear`では参照、`tiny-local`では`None`
- verdict: `pass` / `pass_with_assumption` / `fail`
- 仮定: `pass_with_assumption` のとき置いた仮定とその適用範囲（無ければ `None`）
- 戻り先: `fail` のとき進む capability（`pass` 系なら `None`）

### 発見境界の確認

| 境界   | 調べた差 | 露出した判断 | 結果 |
| ------ | -------- | ------------ | ---- |
| 基準化 | ...      | ...          | ...  |
| 判断   | ...      | ...          | ...  |
| 実現   | ...      | ...          | ...  |
| 実行   | ...      | ...          | ...  |
| 評価   | ...      | ...          | ...  |

`結果`は`no-decision`（今回の受け入れ可否を変える判断は露出しなかった）、`resolved`（判断を固定または範囲認可した）、`blocked`（未認可の判断が残った）のいずれか。`blocked`が1件でもあれば`pass`にはしない。

空欄禁止。該当なしは `None`。

## `Requirement contract`（出力契約）

- 達成すべき結果
- 依頼対応表: 明示要求の逐語引用 / 対応条項、明示除外、または後続指示による覆り
- scope: 対象に含むもの / 含まないもの
- invariants: 変更を通じて保つ条件
- 受け入れ条件と確認

| 条件 | 結果を生む実経路 | 観測する結果 | 確認主体tool環境 | 利用者または情報所有先 |
| ---- | ---------------- | ------------ | ---------------- | ---------------------- |

- 判断と認可

| ID  | 判断 | 役割 | 確定状態 | 固定内容または認可範囲 | 認可元と根拠 | 適用範囲 | 戻り条件 |
| --- | ---- | ---- | -------- | ---------------------- | ------------ | -------- | -------- |

役割は制約・許可・選好。確定状態は確認済み・仮定（未確認の項目は契約へ入れずReadiness recordのblockedに残す）。

- 条項根拠表: 各条項 / 根拠 / 情報の所有先 / 確認に使う資料またはcommand
- 影響する tests と docs
- ユーザー制約
- verdict と前提とした仮定: `Readiness record` の verdict と、`pass_with_assumption` で置いた仮定（無ければ `None`）

verdict と仮定を契約に畳み込むのは、圧縮を越えて再開するとき、最も取り違えやすい未検証の前提を契約と一緒に読み直せるようにするためである。

## verdict 判定

`pass` のハード条件（すべて満たす）:

- 必要な文脈層に `missing` も `blocked` も無い。
- 残る `user_decision` がゼロ。
- 発見境界の確認に`blocked`が0件。
- `判断と認可`表の全判断に認可元がある。
- `受け入れ条件と確認`表の各行に、実経路と観測経路が対応している。
- scope の含む / 含まないが確定している。
- `bounded`と`broad-or-unclear`では`review-orchestration`の台帳に`ready_for_exit_check`が記録されている。

`pass_with_assumption` を許す範囲:

- 未解決の不足が `implementation_discretion` だけのとき。
- 置いた仮定は `Readiness record` の仮定欄に明示する。
- `user_decision` または `contract_gap` を仮定で埋めたら `pass_with_assumption` にせず `fail` にする。言及していない前提を勝手に確定しない。

`fail` の戻り先:

- 残りが `user_decision` → `grill-me` または直接質問。
- 残りが `repo_derivable` / `subsystem_derivable` → `investigation`。
- 残りが `public_fact` → `public-research`。
- 残りが `contract_gap` だけ → 契約候補を作成して再判定する。

## ゲートと外部化

- verdict が `pass` / `pass_with_assumption` になるまで、実装・計画・レビューの実作業へ進ませない。
- 例外は AGENTS.md の `readiness 判定とゲート` に従う（`tiny-local` は記録のみで進行を許す）。
- `pass` / `pass_with_assumption` になったら `Requirement contract` を `.opencode/work/<slug>.contract.md` に固定する。verdict と置いた仮定も同じファイルに含める。
- `bounded`と`broad-or-unclear`では要件review結果を`.opencode/work/<slug>.requirements.md`に固定する。
- このパスは `task-planning` が書く `.opencode/work/<slug>.md`（task file）とは別にする。契約を task file で上書きしない。
- 再開時、またはコンテキスト圧縮後は、実作業の前に `.opencode/work/<slug>.contract.md` を読み直してから進む。見えない session state から継続だと決めつけない。

## 完了チェック

- 4つの文脈層すべてに状態と根拠がある。
- 不足をすべて分類した。
- 調査で解ける不足を質問より先に調べた。
- `bounded`と`broad-or-unclear`では五境界の走査を各一回行い、発見境界の確認表を埋めた。
- 走査の結果から新しい走査を自動開始していない。
- 露出した判断を固定または範囲認可し、認可元のない判断を契約へ含めていない。
- verdict のハード条件を実際に照合した。
- `pass_with_assumption` の仮定が `implementation_discretion` に限られている。
- `pass` 系なら `Requirement contract` を外部化した。
- `bounded`と`broad-or-unclear`の`pass`系なら要件review結果を外部化した。
- `fail` なら戻り先 capability を1つ示した。

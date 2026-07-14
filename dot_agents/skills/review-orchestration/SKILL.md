---
name: review-orchestration
description: Use before fan-out for every broad-or-unclear review; freezes one finite review cycle, routes fan-out and review-response, closes intake, audits affected units, and returns ready_for_exit_check/blocked/reset_required/rollback_required for external exit checking. review loop の有限運営専用。
---

# Review Orchestration

`broad-or-unclear` の review loop を、固定入力と順序付きチェックリストによる有限な 1 周として運営する。結果を W-5 の終了確認へ渡す。

## 入力

- 成果物版と base
- 契約版、scope、acceptance criteria、invariants、tests
- `work_class`
- 開始前に固定する観点集合と検査集合
- review unit ごとの担当、`read_set`、観測出力、`verification method`
- review unit ごとの終了判定への扱い: `必須` または `残存記録`
- W-1 の fan-out 規則
- W-3 の `review-response`

## 発動

review の `work_class` が `broad-or-unclear` のとき、最初の review unit を起動する前に必ず使用する。固定前に fan-out してはならない。

1 周の上限を次のように固定する。

- 初回 fan-out: 1 回
- `review-response`: 1 回
- accepted 一括修正: 最大 1 回
- 対応後監査: 1 回

次の周を自動開始してはならない。

## 1. 周の固定

最初の review unit を起動する前に、review loop 台帳へ次を記録する。

- cycle ID
- review target version: 検査対象となる成果物の版
- review authority snapshot: review target の正否を判定する根拠集合の版
  - code-review: task contract、仕様、invariants、tests
  - japanese-doc-review: 意味内容の正本、想定読者、利用目的
  - requirement-review: 依頼引用、後続訂正、確認済みの技術制約、安全上の不変条件、情報所有先
- `work_class`
- 観点集合
- 有限な検査集合
- review unit ごとの担当、`read_set`、観測出力、`verification method`
- review unit ごとの `必須` または `残存記録`

`requirement-review` では、`Requirement contract candidate` を `review target version` として扱う。検査対象となる契約候補を、それ自身の `review authority snapshot` に含めてはならない。

固定後に検査を追加してはならない。

## 2. Fan-out と受付閉鎖

固定した検査集合だけを W-1 の規則で観点別に fan-out する。先行結果を他の reviewer へ見せない。

全 review unit が結果を返すか、実行不能の理由と再開条件を返した時点で候補受付を閉鎖する。

- `必須` unit が完了不能または `判定不能` なら `blocked` とする。
- `残存記録` unit の `判定不能` は理由と再開条件を台帳へ記録する。それだけで `blocked` にしない。
- `判定不能`（検査被覆の欠損）を finding へ変換してはならない。
- 受付閉鎖後に候補が現れた場合は現周へ追加せず、次の周の候補へ記録して `reset_required` とする。

## 3. Finding 分類

受付閉鎖時点の finding 集合を W-3 `review-response` へ 1 回だけ渡す。

- `needs-investigation` が 1 件以上なら、不足と再開条件を記録して `blocked` とする。
- `accepted` だけを一括修正へ渡す。
- `rejected` と `out-of-scope` は分類根拠を台帳へ保持する。
- 分類後に finding を追加してはならない。

`accepted` が 0 件なら一括修正を作らず、対応後監査の task contract tests へ進む。

## 4. 一括修正と失効判定

親は W-3 の修正契約にある accepted finding だけを最大 1 回の一括修正で修正する。`review-orchestration` 自身は成果物を編集しない。

修正後、`write_set` を各 review unit の `read_set` と観測出力へ照合する。

- 交差する unit だけを、同じ検査と同じ `verification method` で 1 回再実行する。
- 交差しない unit の検査被覆は有効のままとする。
- 交差を判定できない場合は `blocked` とし、不足と再開条件を記録する。
- 再実行で失敗した場合は新しい候補を作らず `rollback_required` とする。

修正後に contract の tests を実行する。失敗した場合は `rollback_required` とする。

## 5. 判定基準の変更

周の中で `review authority snapshot` が変わった場合は、旧根拠に基づく検査、候補、分類、対応後監査を全て失効し、`reset_required` とする。新しい周を自動開始してはならない。

`review target version` の変更（accepted 修正による）は判定基準の変更として扱わず、4節の対応後監査として処理する。

`review authority snapshot` の変更となるのは次の場合だけである。

- ユーザー要求または後続訂正の変更
- 確認済みの技術制約の変更
- 安全上の不変条件の変更
- 情報所有先または正本の変更
- review の scope または判定基準の変更

## 6. 終端

次のいずれかを返す。

- `ready_for_exit_check`: 全ての `必須` unit、finding 分類、必要な再実行、contract tests が完了した。W-5 の終了確認へ渡す。
- `blocked`: 必須 unit、必須の判定不能領域、`needs-investigation`、失効範囲のいずれかを解消できない。
- `reset_required`: contract 変更、受付閉鎖後の候補、または固定入力を保てない変更がある。
- `rollback_required`: accepted 修正後の同一 `verification method` または contract tests が失敗した。

## review loop 台帳

```markdown
# review loop 台帳

## 固定入力

- cycle ID:
- review target version:
- review authority snapshot:
- work_class:
- 観点集合:

## 検査集合

| unit | skill | 担当観点 | read_set | 観測出力 | verification method | 終了判定への扱い |
| ---- | ----- | -------- | -------- | -------- | ------------------- | ---------------- |

## 初回 review

| unit | 3値件数 | status | finding | 判定不能理由 | 再開条件 |
| ---- | ------- | ------ | ------- | ------------ | -------- |

## 受付閉鎖

- 閉鎖時刻または順序:
- 固定候補:
- 閉鎖後候補:

## review response

| finding | 分類 | 根拠 | 再開条件 |
| ------- | ---- | ---- | -------- |

## 一括修正

- accepted finding:
- write_set:
- 非対象範囲:
- 保つ条件:

## 失効と再実行

| unit | write_set との交差 | 処遇 | 同じ verification method の結果 |
| ---- | ------------------ | ---- | ------------------------------- |

## 対応後監査

- contract tests:
- 残存記録の判定不能領域:
- 次の周の候補:
- 再開条件:

## 結果

- status: ready_for_exit_check / blocked / reset_required / rollback_required
- 根拠:
```

## 禁止事項

- 開始後に検査または候補を追加してはならない。
- review finding の内容を代替検査してはならない。
- `review-response` の 4 値分類を上書きしてはならない。
- `accepted` 以外を一括修正へ入れてはならない。

## 完了チェック

- 最初の review unit 起動前に固定入力を台帳へ記録した。
- 初回 fan-out、`review-response`、一括修正、対応後監査が上限内である。
- 候補受付を閉鎖した。
- 判定不能（検査被覆の欠損）を finding へ変換していない。
- `accepted` だけを一括修正へ渡した。
- 変更と交差する unit だけを同じ検査で再実行した。
- contract tests を確認した。
- 残存領域と再開条件を記録した。
- W-5 へ渡す status を 1 つだけ返した。

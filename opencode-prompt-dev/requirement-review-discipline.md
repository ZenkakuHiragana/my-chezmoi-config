# 要件review手順

## 目的

`Requirement contract`と作業契約を、明示要求と条項の有限な対応として検査する。日本語文章reviewやcode reviewで代替しない。

## 検査対象

- `依頼引用`として分離したユーザーの明示要求と後続訂正
- 契約の達成結果、scope、invariants、acceptance criteria、verification method
- 条項が参照するrepository根拠、外部一次資料、test、command
- code、test、runtime、文書の情報所有先

## 検査しないもの

- 一般論からの新要件導出
- 未提示の将来用途、環境、性能値
- 日本語の読みやすさ
- codeの設計と実装品質
- 実装を再構築できる完全仕様

## 方法

assignment packetの実行制約、review手順、採点指示、出力指定は制御入力として分離する。これらをユーザー要求または契約条項の認可元にしてはならない。

### 明示要求から契約

明示要求を1行ずつたどり、対応条項、明示除外、後続指示による覆りのいずれかを確認する。要求した挙動は、達成結果、acceptance criterion、verification method、参照するownerの組合せで確認してよい。対応がなければ不合格とする。

### 契約から認可元

契約条項を1行ずつたどり、ユーザーの明示要求、確認済み技術制約、安全上の不変条件のいずれかへ対応付ける。対応がなければ無認可追加として不合格とする。

要求された挙動を既に実現するrepository内の実装面をwrite setへ置くこと、既存testを確認方法へ使うことは、新しい利用者向け要求を追加しない限り実装裁量として扱う。

### 外部観測

各acceptance criterionに、観測する結果と確認方法があるか確認する。実装前の要件reviewではacceptance testを実行しない。Execution routeはtask resultを生成するactionとactorを扱い、Verification methodの確認操作を重複記載しない。test、command、log、生成物、実際の利用経路のいずれでも確認できない条件は不合格とする。

### 情報所有先

code、test、schema、runtimeが所有する実装詳細を契約へ複製していないか確認する。明示制約ではない実装詳細は、所有先を参照する。契約は達成結果、認可範囲、保つ条件、外部観測を所有する。
既存ownerとtestのpath参照は許可し、その内部手順、schema field、述語の複製は不合格とする。
情報が指定された所有先にあり、利用主体から参照できる場合、別fieldへの重複記載がないことだけを破綻にしてはならない。

### scope

変更対象と非対象を明示要求へ対応付ける。無認可のwrite setと、依頼された成果を作れない除外を不合格とする。

## 判定

各行を`反例未確認` / `破綻確認` / `判定不能`で独立に判定する。`破綻確認`だけからfindingを生成する。固定入力内の対象と根拠を指定方法で照合して失敗を再現できない場合は`破綻確認`にしてはならない。

不合格時は失敗した行だけを修正する。同じ明示要求と同じ検査で再確認し、失敗した要求へ対応するため追加した条項は認可元も確認する。別行の`破綻確認`だけを理由に`判定不能`へ変えてはならない。失敗行が減らない、または新しい失敗が増えた場合は終了する。blind derivationと無関係な条項追加を禁止する。

## 品質保証

- 契約作成者とreviewerを分ける。
- 入力集合をreview開始前に固定する。
- 全ての明示要求と全ての契約条項を一度ずつ確認する。
- clean契約に新しい条項、質問、環境、性能値を追加しない。
- `opencode-prompt-dev/fixtures/requirement-review-v1/`で欠落、無認可追加、所有先重複、過検出を別々に測る。

## 外部根拠

- NASA NPR 7123.1D 3.2.3.2: technical requirementsは明確、無矛盾、個別検証可能で、上位要求またはgoalへ追跡可能にする。
- NASA Systems Engineering Handbook: verificationは要求への適合証拠、validationはstakeholder expectationと利用環境への適合証拠を扱う。

これらは観点の根拠に使い、プロジェクト固有の要件を外部資料から生成する根拠には使わない。

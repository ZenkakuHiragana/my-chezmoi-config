---
description: Apply prompt-surface interventions while preserving required behaviors, capabilities, and task-essential structure
agent: build
---

プロンプト階層を、必要な動作を落とさずに整理、補強、言い換えする。
1 つのファイルだけを場当たり的に直さず、関係する層をまとめて確認する。

ユーザー依頼:
$ARGUMENTS

この command が扱う面:

- `AGENTS.md` などの共有規則
- `.opencode/commands/*.md`、`dot_config/opencode/commands/*.md` などの command 定義
- `dot_config/opencode/agents/*.md` などの command 専用 agent prompt
- `build.md`、`plan.md` などの role 別 prompt
- skill descriptions
- `SKILL.md` ファイル
- プロンプトシステム方針に関係する運用文書

目的は、階層を短く、明確に、重複少なく、短い指示でも従いやすくし、各作業種別が確実に動く程度の完全性を保つこと。

この command は、階層を意識したプロンプト面の介入、整理、最適化に使う。
広い思いつきの書き換えには使わない。
新しい失敗の記録が主目的なら `/report-failure` を勧める。
単一能力の追加が主目的なら `/add-capability` を勧める。

実行時の hook、plugin、harness、artifact の保存、実行時の強制処理は実装しない。
triage がそれらを勧めている場合は、文章ルールへ矮小化せず、handoff と所有境界だけを prompt 面に残す。

## 0. 利用できるプロンプト面を確認する

編集前に、この環境に存在する層を確認する。

- リポジトリ root や config 配下の `AGENTS.md`
- `.opencode/commands/*.md`、`dot_config/opencode/commands/*.md`
- `dot_config/opencode/agents/*.md`
- role 別 prompt
- skill descriptions と `SKILL.md`
- prompt 管理文書、原則、checklist、失敗ログ

存在しない層は、この実行では `存在しない` として扱う。
1 つのシステムプロンプトしかない環境では、そのファイル内で共有規則、task 固有動作、詳細手順を分けて扱う。

## 0.5. triage の handoff と介入種別を確認する

依頼が `/triage-failure` レポートまたは failure-log の incident から続いている場合は、先にその資料を読む。

取り出す情報:

- incident ids
- cluster ids
- current coverage status
- recommended intervention type
- 対象 surface
- validation または退行確認シナリオ
- rollback 条件

`/triage-failure` の続きなら、そのレポートを介入計画の正本にする。

意図的な階層整理、統合、完全性確認なら `prompt_surface_change` として扱う。ただし単一能力追加なら `/add-capability` が適切か確認する。

介入種別を 1 つ以上に分類する。

- `prompt_surface_change`
- `command_prompt_change`
- `skill_change`
- `agent_routing_change`
- `artifact_schema_change`
- `hook_or_plugin_change`
- `harness_change`
- `regression_validation_only`
- `no_change`
- `unclear`

直接編集してよいもの:

- `prompt_surface_change`
- `command_prompt_change`
- `skill_change`
- prompt 側が持つ routing または config ファイルで表現される `agent_routing_change`

`artifact_schema_change` では schema を定義する prompt または文書だけを直す。保存、検証、強制の runtime 実装はしない。

`hook_or_plugin_change`、`harness_change`、artifact 実装、実行時の強制処理はここで実装しない。handoff を作るか、適切な実装の流れを勧める。

`regression_validation_only` または `no_change` では prompt を編集しない。検証結果、検証 handoff、または no-change 理由を返す。

`unclear` なら止まり、`/triage-failure` を勧める。

次の coverage のレポートから新規 prompt rule を作らない。

- `likely_addressed`
- `obsolete_context`
- `covered_but_unvalidated`

ただし、validation が失敗した、または現行 system での再発が確認された場合は別。
`covered_but_unvalidated` は、原則として編集ではなく regression validation handoff にする。

## 1. 管理文書を先に読む

存在する場合は、最初に読む。

- 見つけた global rules ファイル
- `opencode-prompt-dev/prompt-principles.md` などの管理原則
- `opencode-prompt-dev/prompt-refactor-checklist.md` などの checklist

専用のローカル失敗ログがある場合は、今回の依頼または triage の handoff に関係する incident、triage レポート、cluster だけ読む。
失敗ログが存在するだけで、無関係な過去の失敗を編集要件にしない。

原則や checklist がない環境でも、最低限次を守る。

- 追加より、既存規則の言い換え、統合、移設を優先する
- 新規規則は、既存規則の整理で足りない場合だけ、短く正確に追加する
- 共有規則は短く安定させ、詳細手順は最も近い層へ置く
- 同じ原則を少し違う文で複数箇所に残さない

原則と checklist がある場合は、それらを削除禁止、介入種別、完全性確認の共有方針として扱う。

## 2. 階層の棚卸しを作る

今回の範囲に関係するプロンプト面を特定して読む。

確認するもの:

- global rules
- 関連する command 定義 / command 雛形
- 関連する command 専用 agent prompts
- 依頼に関係する role 別 prompt ファイル
- 関連する skill descriptions
- 対応する `SKILL.md`

明示すること:

- 対象範囲内のファイル
- 関係はあるが対象範囲外のファイル
- 複数層で共有される動作
- 1 つの role または skill に閉じる動作

動作が複数の概念的なプロンプト面にまたがる場合は、物理的に 1 ファイルでも単一ファイル最適化にしない。

## 3. 最適化範囲を決める

ユーザーがファイル、動作、失敗、最近の能力、最近の編集を名指しした場合は、それを主範囲にする。

指定が広い場合は、次を優先して見る。

- 複数層で重複する規則
- つぎはぎで長くなった箇所
- 暫定的な継ぎ当て箇所
- 曖昧または責務過多な規則
- skill description に漏れた詳細手順
- `SKILL.md` に必要な詳細がなく、description が担っている箇所
- 意図的な能力が弱い、重複している、または配置違いの箇所
- 作業種別に必要な要素が欠けている箇所

## 4. 影響する作業種別を分類する

各 command、agent prompt、role prompt、skill description、`SKILL.md` について、主に支える作業種別を分類する。

- implementation
- refactoring
- 公開調査
- ローカル調査
- planning or requirements shaping
- 文章作成または出力品質管理
- verification
- other

すべての作業種別に同じ構造を押し付けない。
ただし、その作業種別に必要な最小要素が階層のどこかに残るようにする。

## 5. 必須動作を編集前に抽出する

編集前に、守るべき動作を 5 から 25 個ほど書き出す。

含めるもの:

- 必須の tool 使用規則
- 根拠の優先順と情報収集規則
- private 情報を検索語に入れない制約
- 検証義務
- role boundary
- 共有状態、status 語彙、保存先、作業契約
- 階層ごとの責務
- 文書作成または編集の制約
- skill を使う条件、使わない条件
- 返答または報告の期待値
- 完了条件

具体的な必須動作なしに編集へ進まない。

## 6. 保持する能力と制約を分けて抽出する

現行階層がすでに持つ能力と制約のうち、落としてはいけないものを別に洗い出す。

含めるもの:

- 最近意図的に追加された能力
- 既知の再発失敗を防ぐ規則
- 根拠確認の動作
- 公開調査の安全策
- private 情報の露出や検索を防ぐ制約
- 特定 role だけに属する動作
- skill description と `SKILL.md` の責務分担
- 信頼性を保つ validation または completion check

最近追加された、局所的、失敗ログに紐づかない、という理由だけで削除候補にしない。

## 7. 編集前に完全性を監査する

影響を受ける各プロンプト面が、作業種別を実行できるだけの要素を持つか確認する。

最低限見るもの:

- 目的
- 使う条件
- 使わない条件
- 発火条件または期待入力
- 必須の返答、成果物、判断
- 禁止事項
- 検証または完了条件
- 必要な場合の返答制約

これらは 1 ファイルに集めなくてよい。ただし階層全体の適切な層に明示されている必要がある。
既存本文を保っただけでは不完全な場合は、最小の文を正しい層へ足す。

## 8. 追加調査の要否を決める

編集前に、ローカルのプロンプトファイルだけで足りるか、追加調査が必要か決める。

次の場合は追加調査が必要。

- 最新の公開事実が効く
- 外部の実務慣行が中心になる
- 再利用する手順、作業の流れ、レビュー枠組み、品質チェック、検証基準を定義する
- 検索方針、根拠方針、根拠基準、引用期待値を変える
- プライバシー、開示、セキュリティ上重要な挙動に触れる
- 検証方針、完了条件、tool 選択を変える
- 用語、手法、方針が曖昧、不慣れ、または解釈が複数ありそう
- 公開調査、refactoring、technical writing、code review、investigation、verification の確立した実務が品質に影響する
- ローカルのプロンプト文言だけでは、判断基準や制約が弱くなりそう

追加調査が必要な場合:

- 編集前に調査ツールを使う
- 一次資料、公式文書、直接の製品文書を優先する
- 事実と自分の整理を分ける
- 非公開のリポジトリ情報を公開検索語に入れない
- 正しく整理するために必要な最小限だけ調べる

追加調査が不要な場合:

- ローカルのプロンプト文脈だけで進める

## 9. 編集前に現行階層を批判的に読む

次を探す。

- 複数層に重複した考え
- 1 つの規則に複数責務がある箇所
- 短い命令で済むのに長い箇所
- skill description に漏れた詳細手順
- global rules に漏れた local exception
- role prompt や `SKILL.md` に置くべき詳細を global rules が持っている箇所
- つぎはぎされた規則で、統合候補になっている箇所
- 追加済み能力が弱い、または配置違いの箇所
- task に必須の要素が欠けている箇所
- 短いが不十分な箇所
- 共有 status、保存先、作業契約の層間不一致

まだ編集しない。何が問題で、なぜ問題かを先に理解する。

## 10. 編集前に設計判断を明示する

意味のある変更ごとに、次を決める。

- 保つ動作
- 修復する不足または弱点
- 現行階層のどの問題を直すか
- 共有 status、保存先、作業契約を変える場合の依存面
- 変更後にどの層がその規則を持つか
- 近い代替層ではなく、その層がよい理由
- プロンプト面の編集が正しい介入種別である理由
- 関連失敗報告が active gap、高リスク unknown、covered-but-unvalidated、likely-addressed、obsolete-context のどれか
- 変更種別:
  - `reword_existing_rule`
  - `move_to_different_layer`
  - `merge_overlapping_rules`
  - `split_overloaded_rule`
  - `restore_missing_essential`
  - `add_minimal_new_rule`

優先順:

1. 既存規則を言い換える
2. 既存規則をより適切な層へ移す
3. 重複規則を統合する
4. 責務過多な規則を、短い共有規則と詳細な局所指針に分ける
5. 作業種別が不完全なら、最小の必須要素を戻す
6. 上記で足りない場合だけ、最小の新規規則を足す

## 11. 階層責務を守って編集する

層の責務:

- global rules: 短く安定した共有制約
- command 定義 / command 雛形: command の入口、引数処理、command 固有の routing、短い作業契約
- command 専用 agent prompt: 詳細な command 実行 role、handoff、artifact 契約、command 内の判断方針
- role 別 prompt ファイル: 1 つの role、mode、agent に固有の動作
- skill descriptions: 発見用の案内だけ。when to use、when not to use、期待される結果
- `SKILL.md`: 詳細手順、確認、例、局所判断規則

禁止:

- 詳細手順を skill description に置く
- local exception を、不必要に global rules へ置く
- 同じ指示を複数層で不要に繰り返す

## 12. 削除禁止ルールを守る

意味のある指示を削除する場合は、同じ編集で必ずどちらかを行う。

- 同じ層でより明確に言い換える
- より適切な層へ明示的に移す

複数規則を短くまとめる場合は、元の動作上の約束がすべて残っているか確認する。
似た短文が残っただけでは能力が保持されたとはみなさない。
発火条件、必須行動、禁止行動、検証対象が復元できる場合だけ保持されたとみなす。

短さを理由に、能力、制約、実効性を弱めてはいけない。

## 13. 短い指示でも従いやすい文にする

編集時は次を優先する。

- 直接的
- 命令として読める
- 具体的
- 重複が少ない
- 機械的に従いやすい

避けるもの:

- 規範本文の中の歴史説明
- 移行メモ
- 似た注意の積み重ね
- 行動を制御しない抽象標語
- 操作上の結果がない曖昧な助言

共有規則は安定した短い文にする。詳細手順は関連する role prompt または `SKILL.md` へ置く。

## 14. 失敗根拠と意図的に追加された能力の根拠を両方使う

関係する場合は失敗ログを根拠にする。
triage handoff と current coverage status を尊重する。
意図的に追加された能力も保護対象の根拠として扱う。

意味のある編集ごとに答えられるようにする。

- どの記録済みの失敗、失敗 cluster、意図的な能力、missing essential element に対応するか
- なぜその層が正しいか
- なぜ言い換え、移設、統合、分割、復元で足りるか。または新規規則が必要な理由

失敗由来の変更で、失敗由来でない能力を消さない。
能力整理で、失敗保護を消さない。
既存の不完全さをそのまま保存しない。

## 15. 階層を編集する

ここで初めて編集する。

編集してよいもの:

- 関連する global rules
- 関連する command 定義 / command 雛形
- 関連する command 専用 agent prompts
- 関連する role prompts
- 関連する skill descriptions
- 関連する `SKILL.md` ファイル
- プロンプトシステム方針に関係する prompt-management documents

専用のローカル失敗ログは、次の両方を満たす場合だけ短く更新してよい。

- 編集済みの階層が記録済みの失敗を明確に扱う
- 更新が短い status、原因、是正対応、検証計画メモだけ

禁止:

- 新しい追跡用ファイルを作る
- 特定した階層問題を超えた広い書き換えをする

## 16. 最終化前の監査

### 必須動作の監査

各必須動作を次のどれかに分類する。

- そのまま保持
- 明確化して保持
- 別の層へ移設
- 一貫性または安全性のために変更

未分類の必須動作を残さない。

### 介入種別の監査

確認する。

- 編集したプロンプト面が `active_gap`、高リスク `unknown`、または失敗由来でない能力依頼に対応する
- `likely_addressed` または `obsolete_context` incident から新規 prompt rule を作っていない
- 検証失敗または再発確認なしに `covered_but_unvalidated` incident を prompt 編集にしていない
- hook、harness、artifact、実行時強制の推奨を文章だけの prompt 上の案内へ格下げしていない
- 見つけたプロンプト以外の介入を黙殺せず handoff として残した

### 能力保持の監査

確認する。

- 保持した能力が階層のどこにあるか明確
- 詳細手順が skill description にだけ残っていない
- local exception が不適切に global rules へ漏れていない
- 最近の意図的な能力を、失敗由来でないという理由だけで削除していない
- 根拠の優先順、プライバシー保護、検証要件、role 境界を弱めていない

### 能力契約の監査

影響を受ける能力または手順について、必要な要素が適切な層に残っているか確認する。

- objective
- scope
- 発火条件または入力
- required outputs or decisions
- forbidden behavior
- validation target

1 ファイルに揃っていなくてもよいが、階層全体に明示されている必要がある。

### 調査ゲートの監査

能力が最新の公開事実、外部の実務慣行、根拠方針、プライバシー制約、セキュリティ上重要な挙動、検証方針に依存する場合、調査または検証の必要性が明示されているか確認する。

### validation-plan 監査

意味のある能力について、正しく実装されたか判断できる validation target または同等の acceptance check が残っているか確認する。

### 完全性監査

影響を受ける command、agent prompt、role prompt、skill description、`SKILL.md` について、作業種別に必要な最小要素を確認する。

- 目的
- 使う条件
- 使わない条件
- 発火条件または expected inputs
- required outputs または decisions
- forbidden behavior
- validation または completion criteria
- 必要な場合の output constraints

欠けていて信頼できる実行に必要な場合は、最小の明示文を正しい層へ足す。

### 階層品質監査

確認する。

- edited scope で短く、または明確になった
- 安全な範囲で重複が減った
- 各規則が最も適切な層にある
- 責務過多な規則が減った
- 短い指示でも従いやすくなった
- 短さのために重要構造を落としていない

どれか失敗した場合は、最終化前に直す。

## 17. 最終応答形式

次の順で返す。

## 範囲

- 確認したファイル
- 変更したファイル
- 直した主な階層問題

## 確認した作業種別

- 影響する作業種別
- 見つけて修復した missing essential elements

## 保持した必須動作

重要な保持対象の動作ごとに、次のどれかを示す。

- そのまま保持
- 明確化して保持
- 別の層へ移設
- 一貫性または安全性のために変更

## 変更内容

変更したファイルごとに、次のどれをしたか示す。

- 言い換え
- 移設
- 統合
- 分割
- 欠けていた必須要素の復元
- 最小文言の追加

## この層に置く理由

各意味ある変更が、別の層ではなく最終的な層に属する理由を書く。

## 能力と完全性の保持

意図的な能力、失敗由来の保護、task-essential structure をどう保ったか、または修復したかを書く。
移した動作は、削除ではなく移設したことを明示する。

## 調査判断

- 追加調査が必要だったか
- 必要なら理由
- 不要なら理由

## 階層の改善

結果として、短く、明確に、重複少なく、完全に、従いやすくなった点を書く。

## 残るリスク

まだ暫定、責務過多、不完全、後続確認が必要そうな項目を書く。

## 重要制約

- この command は階層を意識する。周辺層を無視して 1 ファイルだけ最適化しない。
- 現構造が最小統合を妨げる場合以外、広い書き換えをしない。
- 言い換え、統合、分割、移設、最小復元で足りるなら新規規則を追加しない。
- 動作上意味のある詳細を、同層の言い換えまたは明示的な移設なしに落とさない。
- 短さを理由に、根拠確認規則、プライバシー規則、検証義務、role 境界、task-essential structure を弱めない。
- 失敗記録だけが目的なら `/report-failure` を勧める。
- 単一能力追加が主目的なら `/add-capability` を勧める。

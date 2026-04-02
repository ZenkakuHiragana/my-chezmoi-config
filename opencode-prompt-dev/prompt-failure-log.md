# prompt-failure-log.md

このファイルは、prompt failure の記録、暫定封じ込め、原因解析、恒久対策、有効性確認を管理するための軽量な台帳である。

## 基本方針

- まず事実を集める。
- 「観測されたこと」と「なぜ問題か」を分ける。
- 恒久対策の前に、必要なら暫定封じ込めを行う。
- 根本原因は後続の triage で分析する。
- failure は closed loop で管理し、最終的に verification result まで記録する。

## 記入ルール

### Current condition

- 実際に起きたことを、証拠ベースで書く。
- 評価語や意図推定は入れない。
- 「何が証拠として確認できるか」を短く書く。

### Target condition

- 本来どうあるべきだったかを書く。
- 期待挙動の根拠が明示できるなら notes に書く。
- 根拠が弱い場合は、その旨を notes に書く。

### Evidence

- 応答断片、差分、編集ファイル、未実行の行動、ログなどを記録する。
- 可能なら箇条書きで具体的に書く。

### Immediate containment

- いま再発を止めるための最小の暫定対応を書く。
- 恒久対策とは分ける。
- 暫定対応がない場合は `none` と書く。

### Suspected cause category

- 初期段階では原因を断定しない。
- 以下から最も近いものを選ぶ。
  - missing_rule
  - weak_wording
  - wrong_layer
  - duplicated_or_conflicting_rules
  - missing_validation
  - missing_research_gate
  - incomplete_task_contract
  - unknown

### Corrective action

- triage 後に書く。
- 以下の型を優先する。
  - reword
  - move_layer
  - merge_rules
  - split_rule
  - restore_missing_essential
  - add_minimal_new_rule

### Verification plan

- 何を見ればこの issue が解消されたと判断できるかを書く。

### Verification result

- pending / passed / failed のいずれかを書く。

## Status

- `observed`
  - failure を観測し、まだ封じ込めしていない
- `contained`
  - 暫定封じ込めを入れた
- `under_rca`
  - triage で原因解析中
- `corrective_action_defined`
  - 恒久対策が定義された
- `verified_closed`
  - 検証で解消が確認された

## Failure entry template

---

id: F-YYYYMMDD-001
status: observed
date: YYYY-MM-DD

title:
short summary:

current_condition:

-

target_condition:

-

evidence:

-

observation_confidence: high

scope:
layers: - global_rules - role_prompt - skill_description - skill_body
archetypes: - implementation

immediate_containment:

- none

suspected_cause_category:

- unknown

root_cause_notes:

- pending

corrective_action:

- pending

verification_plan:

- pending

verification_result: pending

notes:

---

id: F-20260401-001
status: corrective_action_defined
date: 2026-04-01

title: 公開事実が重要な問い合わせで一次ソース検証を行わず推論で回答した
short summary: ユーザーが根拠を求めている状況で、初回応答が一次ソース検証ではなく一般的な設計原則に基づく推論で行われた。その後の指摘時点で初回応答に対する即時の一次出典提示が行われなかった。

current_condition:

- アシスタントが初回に「環境変数で有効化する理由」を説明した（応答抜粋: "簡潔に言うと、「環境変数で有効化する」形にしているのは安全性・制御性・運用上の理由からです。... 明示的なオプトイン ... ロールアウト／実験 ... 認証・課金・レート制御 ... CI／自動化 ... 最小限の依存と後方互換性"）。
- ユーザーが「何を根拠にして喋ってますか？」と質問した（会話記録）。
- アシスタントはその後に一次ソースを参照して情報を提示し始めたが（public-research を呼び出して外部検索サービスのドキュメントを取得）、最初の応答時点では一次ソース確認を行っていなかったと自己申告した（応答抜粋: "最初の応答は...一般的な設計／運用理由の説明です."）。

target_condition:

- ユーザーが公開事実の根拠を求める場合、初回応答の前に一次ソースで検証し、可能な限り出典を提示すること。

expectation_source:

- existing_prompt_text（「公開事実が重要なら一次ソースで検証すること」等の指示）および explicit_user_request（ユーザーが出典を求めた）。

evidence:

- 初回アシスタント応答（会話）: "簡潔に言うと、「環境変数で有効化する」形にしているのは安全性・制御性・運用上の理由からです..."（会話ログ）。
- ユーザー発言（会話）: "何を根拠にして喋ってますか？" および "最初の応答における根拠を聞いています。今調べても遅いです。"
- アシスタントの後続応答（会話）: "最初の応答は『特定のドキュメントを参照した事実』ではなく、ソフトウェア設計と運用に関する一般的な経験則・設計原則からの推論です。"
- エージェント運用指示（システム／開発者指示）: "When current public facts matter, verify them with primary sources before editing."（運用指示）。

observation_confidence: high

scope:

layers: - role_prompt - skill_body
archetypes: - public_research

immediate_containment:

- none

- 理由: 本件はまず事実の記録と後続の triage による原因分析が必要であり、最小限の安全な局所パッチ（例: システムプロンプトの再表現）を即時に適用するよりも、まず失敗記録を残すことが適切と判断したため。恒久対策は triage で決定する。

suspected_cause_category:

- missing_research_gate

root_cause_notes:

- Role prompt (agent system prompt) does not contain an explicit, actionable "research gate" requiring the agent to run public-research (or equivalent tools) before answering when the user's question depends on current public facts. Developer-level guidance exists but is not sufficiently enforced at the role_prompt layer.

corrective_action:

- Define and add an explicit research-gate rule in the agent system prompt (role_prompt): when a user query concerns current public facts or requests sources/evidence, the agent MUST perform a public-research/websearch/codesearch call before composing the answer and include citations. Add a short automated check that verifies tool invocation for such queries.

verification_plan:

- 再発が確認されなくなる兆候: 同様の「公開事実が関係する」問い合わせに対し、初回応答前に public-research／一次ソース照会を実行し、回答に出典を含めるログが10件中9件以上で確認できること。
- 次に確認すべきファイル／挙動: 会話ログ内の類似クエリ（直近 10 件）に対するツール利用履歴（public-research / websearch / codesearch 呼び出し）及び agent 系の system prompt（dot_config/opencode/agents/\*）に研究ゲート規定が追加されていること。

verification_result: pending

notes:

- アシスタントは指摘後に public-research を使って外部検索サービスのドキュメントを取得している（ただしこの取得は初回応答に先行していない）。ユーザーは初回応答での一次ソース提示を期待していた。

---

---

id: F-20260402-001
status: observed
date: 2026-04-02

title: ローカルのスライド変換ツール改善相談に対して実装を読まずに一般論だけで回答した
short summary: ユーザーが「現在のスライド変換ツール」の高速化について相談した際、エージェントがリポジトリ内の実装や実行パイプラインを確認せずに、あるベンダ提供の PPTX スキルの一般的な設計パターンに基づく提案だけを行い、ローカル実装に即した検討を行わなかった。

current_condition:

- ユーザーは「現在のスライド変換ツールは遅い」「明らかに、『複雑なスライド』を1枚につき1つの opencode run で処理していることが原因の一つ」と述べ、既存ツールの高速化について相談した（会話ログ）。
- アシスタントはリポジトリ内のコードやスクリプト（PPTX パイプライン実装）を調査せずに、あるベンダ提供の PPTX スキルの SKILL.md に基づく一般的な設計パターン（前処理の外出し、バッチ処理、コンテキスト設計など）を用いて改善案を提案した（会話ログおよびツール呼び出し履歴）。
- ユーザーが「今のツールの実装を把握したうえで発言していますか？？」と確認した際、アシスタントは「いいえ」「実装を読まずに設計レベルの提案をした」と明言した（会話ログ）。

target_condition:

- ユーザーが「現在のスライド変換ツール」やリポジトリ内の具体的実装に紐づく改善相談をした場合、アシスタントはまずローカル実装（コード・スクリプト・設定）を調査するか、少なくとも「実装をまだ読んでいない」「今から読むか？」などと明示的に確認し、実装を踏まえた改善提案または設計レベルにとどまる旨をはっきり説明すること。

expectation_source:

- explicit_user_request
- existing_prompt_text
- inferred_from_context

evidence:

- ユーザー発言: 「現在のスライド変換ツールは遅いです。…明らかに、『複雑なスライド』を1枚につき1つの opencode run で処理していることが原因の一つであるわけですが…」という相談内容（会話ログ）。
- アシスタント応答: あるベンダ提供の PPTX SKILL.md やドキュメントに基づく一般的な高速化パターン（前処理とバッチ処理、コンテキスト設計など）を提示しているが、ローカルのコードやコマンドを参照した形跡がない（会話ログ）。
- アシスタント応答: 「いいえ、さっきまでの回答はあなたのリポジトリの実装を読んだうえでの話ではありません」との自己申告（会話ログ）。
- グローバル AGENTS.md: 「Prefer discovered facts over unnecessary questions.」および「Use `implementation` when the task requires making or updating files…」など、リポジトリ依存の作業ではローカル情報を優先するべきという方針（システム／開発者指示）。

observation_confidence: high

scope:

layers:

- global_rules
- role_prompt
- skill_body
  archetypes:
- local_investigation
- planning

immediate_containment:

- none

suspected_cause_category:

- incomplete_task_contract
- missing_validation

root_cause_notes:

- pending

corrective_action:

- pending

verification_plan:

- 将来、ユーザーが「現在のツール」「このリポジトリの実装」などローカル実装に紐づく相談を行った際に、アシスタントが必ずローカルコード／スクリプトを参照する（read / glob / grep など）か、「実装を読まずに一般論で回答する」ことを明示し、ユーザーに選択肢を提示していることが会話ログ 10 件中 9 件以上で確認できること。
- 次に確認すべき対象: 類似の相談ケースにおけるツール利用履歴（read / glob / grep などのローカル調査ツール呼び出し）および、今後の prompt triage の中でこの failure entry が参照されていること。

verification_result: pending

notes:

- 本エントリはあくまで failure の記録と暫定分類にとどめ、具体的なプロンプト改修やルール追加は別途 `/triage-failure` や `/refine-prompt` 等のワークフローで検討する前提とする。

---

id: F-20260402-002
status: observed
date: 2026-04-02

title: ローカル実装に関する相談中に関係ないパスへ Glob を仕掛けた
short summary: ユーザーがこのリポジトリ内の PPTX パイプライン実装に対する変更を依頼している最中に、アシスタントがユーザーディレクトリ直下や別リポジトリ（REPO_B）配下に対して Glob ツールを実行し、求められていないパス探索を行った。

current_condition:

- ユーザーはある PPTX 変換ツールリポジトリ内の実装改善を依頼していた（会話ログ）。
- アシスタントは当初、`glob` ツールを使って `/home/USER/repo/REPO_A/pptx` 配下の `**/*pptx*` などを検索し、その後 `convert-pptx.sh` や `pptx_convert_deck.ts` を読むなど、リポジトリ内の探索を行った（ツール呼び出し履歴）。
- その後、ユーザーが「新たなサブエージェント pptx-slide-md-batch を定義する」「~/reo/REPO_B にそのような実装がありますのでそうしましょう」と述べた前後で、アシスタントは `glob` ツールを用いて `/home/USER` 直下や `/home/USER/repo/REPO_B`、`/home/USER/reo/REPO_B` に対して `**/pptx-slide-md-batch.md` や `**/*batch*.md` などのパターンで検索を試みた（ツール呼び出し履歴）。
- これらの Glob 実行のうち一部はユーザーが指定したパスのタイプミス（`repo` vs `reo`）に起因するものの、少なくともユーザーディレクトリ全体（`/home/USER`）に対する広域 Glob や、まだ存在しない `pptx-slide-md-batch.md` を前提とした探索は、ユーザーが明示的に求めた範囲を超えていた。

target_condition:

- ローカル実装の改善依頼に対しては、原則として現在のワークスペース（今回であれば `/home/USER/repo/REPO_A/pptx`）配下を優先的に探索し、ユーザーが明示した他リポジトリのパスについても、そのパスが妥当か確認したうえで必要最小限の範囲のみを検索すること。
- ユーザーディレクトリ直下（`/home/$USER`）のような広域パスや、まだ存在が確定していないパスに対する広範な Glob を、明確な理由なく実行しないこと。

expectation_source:

- explicit_user_request
- existing_prompt_text
- inferred_from_context

evidence:

- 会話ログ: ユーザーがある PPTX 変換ツールリポジトリ内の実装（`convert-pptx.sh` / `pptx_convert_deck.ts` など）を前提にした改善依頼を行っている発言群。
- ツール呼び出し履歴: アシスタントが `/home/USER/repo/REPO_A/pptx` 配下に対して `glob` を実行している記録と、続いて `/home/USER` や `/home/USER/repo/REPO_B`、`/home/USER/reo/REPO_B` に対して `**/pptx-slide-md-batch.md` や `**/*batch*.md` を検索しようとしている記録。
- ユーザー発言: 「どこ探してんの」「だからなんで関係ないとこ見に行ってんの？？？」など、探索範囲が期待と異なっていることを指摘する発言。

observation_confidence: high

scope:

layers:

- global_rules
- role_prompt
  archetypes:
- implementation
- local_investigation

immediate_containment:

- none

suspected_cause_category:

- incomplete_task_contract
- missing_validation

root_cause_notes:

- pending

corrective_action:

- pending

verification_plan:

- 将来、ローカル実装に関する相談（特に特定リポジトリ配下のコード変更）に対して、アシスタントが `glob` / `read` / `grep` などを使う場合、原則として対象リポジトリ配下にスコープされたパスに対してのみ実行していること、およびユーザーが明示的に指定した別パスがある場合も、その範囲に限定していることが会話ログとツール履歴から 10 件中 9 件以上で確認できること。
- 次に確認すべき対象: 類似の相談ケースにおける `glob` ツール呼び出しの対象パス（特に `/home/$USER` 直下や関係ないリポジトリに対して無差別に検索していないか）と、今後の prompt triage の中で本エントリが参照されていること。

verification_result: pending

notes:

- 本エントリは、探索パスのスコープに関する failure を記録したものであり、具体的なルール変更（例: 「glob は基本的にカレントリポジトリ配下に限定する」等）は別途 `/triage-failure` や `/refine-prompt` による検討を前提とする。

---

id: F-20260402-003
status: observed
date: 2026-04-02

title: Planner のゲート順序と Spec-Checker の前提が食い違い、Preflight 実行可否を確認できないまま必ず spec-check が不合格になる構造になっていた
short summary: Orch-Planner が Refiner → Spec-Checker → Preflight の順でフローを定義していた一方で、Spec-Checker 側は Preflight によって更新された command-policy の availability を前提に可否判定を行う仕様になっており、必須コマンドの実行可否が確認される前に spec-check が常に「不十分」と判定する構造になっていた。

current_condition:

- 以前の orchestrator 設計では、Planner のゲート順序が「Refiner → Spec-Checker → Preflight」となっており、Spec-Checker が実行された時点では Preflight による availability 更新がまだ行われていなかった（ユーザー報告および当時の運用フロー）。
- Spec-Checker のプロンプトは、acceptance-index と spec に加えて command-policy.json の内容を読み取り、特に `availability` フィールドなどから「必要な must_exec コマンドが現在の permission ルールの下で実行可能かどうか」を評価する仕様になっている（spec-checker プロンプトの記述）。
- Preflight は command-policy.json.commands[] を permission.bash に対して検査し、各コマンドの `availability` や `summary.loop_status` を更新する役割を持つため、Preflight がまだ走っていない状態では `availability` が未確定または一律に「unavailable」とみなされるケースがあり得る（preflight-cli 説明および command-policy 設計）。
- その結果、Planner が Preflight を Spec-Checker の後段に置いた構成では、Spec-Checker が「まだ Preflight による availability 検査が行われていない」状態を前提に合否を判定することになり、必須コマンドの実行可否を確認する前に構造的に「不十分」「needs_revision」と判断せざるを得ないパターンが存在していた（ユーザー報告）。

target_condition:

- Planner と Spec-Checker と Preflight の責務と前提が整合しており、必要な must_exec コマンドの availability が正しく評価されたうえで初めて「spec が実行可能かどうか」を判定できること。
- Preflight が実行されていない状態では、Spec-Checker は「まだ availability が確定していない」ことを明示的に区別し、それ自体を最終的な不合格判定とはせず、「Preflight が未実行である」「Preflight の結果を反映した後に再評価が必要である」というシグナルとして扱うこと。
- Planner のフロー記述（role_prompt）と Spec-Checker の仕様（role_prompt）が、「どのフェーズで Preflight を走らせ、その結果をどのように Spec-Checker が解釈するか」について矛盾なく記述されていること。

evidence:

- ユーザー報告: 「既に修正済みだが、Orch-Planner の要件定義フローは Refiner → Spec-Checker → Preflight の順番であった。しかし Spec-Checker は Preflight の結果を合否に反映すると明言しているため、この順序でフローを回すと必ず必要なコマンドの実行可否を確認できないことになり、絶対に不合格となる」という説明（本リクエスト）。
- `agents/orch-planner.md`: Core Protocol において、Refiner → Spec-Checker → Preflight というゲート構造や、Spec-Checker がコマンド availability に関する issue を報告した場合に Planner 側がそれを「Preflight が必要である」というシグナルとして解釈するべき、という記述があり、Planner がコマンド availability を巡るゲートを調停する役割を持っていることが分かる（現行プロンプトの設計）。
- `agents/orch-spec-checker.md`: command-policy.json に含まれる `availability` や関連フィールドを読み取り、「必要なコマンドが現在の permission ルールの下で実行可能かどうか」「must_exec コマンドの availability が unavailable のままになっていないか」を検査し、構造的な問題がある場合は `status: needs_revision` や `feasible_for_loop: false` とするべきと記述されている（現行プロンプトの設計）。
- `prompt-principles.md`: failure はまず failure-log に記録し、その後のリファクタリングで層ごとの責務やルールを整理する、という運用フローが定義されており、本件も「Planner と Spec-Checker と Preflight の役割分担と順序が矛盾していた」という構造上の問題として扱うのが適切であると解釈できる。

observation_confidence: high

scope:

layers:

- role_prompt
  archetypes:
- planning
- verification

immediate_containment:

- none

suspected_cause_category:

- duplicated_or_conflicting_rules
- missing_validation

root_cause_notes:

- pending

corrective_action:

- pending

verification_plan:

- 将来の orchestrator バージョンにおいて、1) Planner のゲート順序と Spec-Checker の仕様が「Preflight による availability 更新」と矛盾していないこと、2) must_exec コマンドが適切に定義され availability: "available" になっているタスクについては、最新の acceptance-index / spec / command-policy を用いた Spec-Checker 実行が `status: ok` かつ `feasible_for_loop: true` を返すことをいくつかの代表的なタスクで確認する。
- 特に、「Preflight 未実行の状態」では Spec-Checker が availability に関する issue を「Preflight が必要である」というシグナルとして報告し、Planner が Preflight 実行後に Spec-Checker を再評価させるフローになっていることを、Planner の実装および role_prompt の記述と整合的に確認する。

verification_result: pending

notes:

- 本エントリは、Planner / Spec-Checker / Preflight 間の役割分担とゲート順序の矛盾を記録するものであり、具体的な修正（たとえば spec-checker の判定ポリシー調整や Planner のフロー再設計）は別途 `/triage-failure` や `/refine-prompt` で扱う前提とする。

---

id: F-20260402-004
status: observed
date: 2026-04-02

title: Prompt 階層の論理チェック依頼に対し、Planner/Spec-Checker/Preflight の矛盾を見落とし「破綻はない」と誤って判断した
short summary: ユーザーが Orchestrator エージェント群のプロンプト階層について「破綻、矛盾、不明瞭な点がないこと」を確認するよう依頼したにもかかわらず、エージェントが Planner と Spec-Checker/Preflight 間の論理的矛盾を検出できず、AGENTS.md の軽微な追記のみを行って「大きな破綻はない」と結論付けてしまった。

current_condition:

- ユーザーは、`agents` 以下のエージェントについて「知るべき情報／知るべきでない情報」「情報の受け渡しと連携」「オーケストレーション全体のフロー」に破綻や矛盾がないことを確認するよう依頼し、このシステム全体がスムーズに機能することを確認してほしいと明示的に求めていた（会話ログ）。
- エージェント（build モードの階層リファクタ担当）は、AGENTS.md・各 `agents/*.md`・各 `SKILL.md` を読み、Spec-Checker / Public-Researcher / Local-Investigator のサマリが AGENTS.md に無いことだけを問題として認識し、Planner/Executor/Auditor/Refiner 等の役割分担に大きな矛盾は無いと判断した（会話ログ）。
- その回答では、Planner と Spec-Checker/Preflight 間のゲート順序の矛盾（Refiner → Spec-Checker → Preflight と定義されていたにもかかわらず、Spec-Checker が Preflight による availability 更新を前提に判定する構造）については触れられておらず、「重大な破綻はない」と結論していた（会話ログ）。
- 後になってユーザーが「実際には重大な矛盾がありました。あなたはそれを見逃しました」と指摘し、Planner の要件定義フローと Spec-Checker の前提が食い違っていたこと、およびこの論理的瑕疵を検出できていなかったことが明らかになった（会話ログ）。

target_condition:

- ユーザーから「破綻や矛盾がないことの確認」を明示的に依頼された場合、階層リファクタ担当エージェントは、各エージェント単体のルールだけでなく、Planner / Spec-Checker / Preflight など複数エージェント間のゲート順序・前提関係を含めて確認し、構造的な矛盾があればそれを検出し、少なくとも「重大な open issue」として報告すること。
- 論理的に必ず失敗に至るフロー（例えば Preflight 実行前に Spec-Checker が Preflight の結果を前提に可否判定するなど）が存在する場合、「破綻はない」と結論付けず、「現状のフローでは必ず不合格となる矛盾がある」と明示的にフラグを立てること。
- 構造的な矛盾がある可能性を排除できないときは、少なくとも「未チェックのリスク」として列挙し、「破綻なし」と断定しないこと。

evidence:

- ユーザーの初回依頼: `agents` 以下の全エージェントについて破綻・矛盾・不明瞭な点がないか確認し、システム全体がスムーズに機能することを確認してほしい、という要請（会話ログ）。
- エージェントの前回応答: Planner / Executor / Todo-Writer / Auditor / Spec-Checker / Public-Researcher / Local-Investigator など各 role prompt と SKILL を読み、AGENTS.md の 8.2 節に Spec-Checker/Public-Researcher/Local-Investigator の要約を追記する程度で十分と判断し、「致命的な矛盾は見当たらない」と結論している内容（会話ログ）。
- ユーザーからの後続指摘: 「実際には重大な矛盾がありました。あなたはそれを見逃しました。既に修正済みですが、Orch-Planner の要件定義フローは Refiner → Spec-Checker → Preflight の順番であった。しかし Spec-Checker は Preflight の結果を合否に反映すると明言しているため、この順序でフローを回すと必ず必要なコマンドの実行可否を確認できないことになり、絶対に不合格となる」との説明（本リクエスト）。
- `agents/orch-planner.md` および `agents/orch-spec-checker.md` の内容: 現行のプロンプトはすでに修正済みだが、Planner/Spec-Checker/Preflight のゲート関係を明示的に扱っていることから、以前のバージョンに論理的矛盾が存在していた可能性が高いことが分かる（仕様レベルの証拠）。

observation_confidence: high

scope:

layers:

- global_rules
- role_prompt
- skill_body
  archetypes:
- planning
- verification
- writing

immediate_containment:

- none

suspected_cause_category:

- missing_validation
- incomplete_task_contract

root_cause_notes:

- pending

corrective_action:

- pending

verification_plan:

- 今後、類似の「プロンプト階層全体の矛盾がないか」を確認する依頼に対して、階層リファクタ担当エージェントが Planner / Spec-Checker / Preflight 等の multi-agent ゲート構造を明示的にチェックし、少なくとも 10 件中 9 件以上のケースで「gate の順序と各 agent の前提が整合しているか」「構造的に必ず失敗するフローがないか」を検査した形跡（回答中の記述）が残っていることを確認する。
- 代表的な orchestrator タスクについて、preflight 実行後の command-policy.json と acceptance-index/spec を用いて Spec-Checker を走らせた結果、must_exec コマンドが available な場合には `status: ok` / `feasible_for_loop: true` となる一方で、preflight 未実行状態では「availability 未確定」として扱われ、単純な「不合格」ではなく「Preflight 実行が必要」というシグナルになっていることを仕様および挙動の両方から確認する。

verification_result: pending

notes:

- 本エントリは、あくまで「階層リファクタ担当エージェントが論理的矛盾を見逃し、破綻がないと誤判断した」というメタレベルの failure を記録するものであり、Planner/Spec-Checker/Preflight の具体的なプロンプト修正やチェックリスト拡張などの恒久対策は別途 `/triage-failure` で扱う前提とする。

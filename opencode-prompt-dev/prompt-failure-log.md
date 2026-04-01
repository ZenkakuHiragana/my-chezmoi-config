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

-

---
id: F-20260401-001
status: corrective_action_defined
date: 2026-04-01

title: 公開事実が重要な問い合わせで一次ソース検証を行わず推論で回答した
short summary: ユーザーが根拠を求めている状況で、初回応答が一次ソース検証ではなく一般的な設計原則に基づく推論で行われた。その後の指摘時点で初回応答に対する即時の一次出典提示が行われなかった。

current_condition:

- アシスタントが初回に「環境変数で有効化する理由」を説明した（応答抜粋: "簡潔に言うと、「環境変数で有効化する」形にしているのは安全性・制御性・運用上の理由からです。... 明示的なオプトイン ... ロールアウト／実験 ... 認証・課金・レート制御 ... CI／自動化 ... 最小限の依存と後方互換性"）。
- ユーザーが「何を根拠にして喋ってますか？」と質問した（会話記録）。
- アシスタントはその後に一次ソースを参照して情報を提示し始めたが（public-research を呼び出して Exa ドキュメントを取得）、最初の応答時点では一次ソース確認を行っていなかったと自己申告した（応答抜粋: "最初の応答は...一般的な設計／運用理由の説明です."）。

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
- 次に確認すべきファイル／挙動: 会話ログ内の類似クエリ（直近 10 件）に対するツール利用履歴（public-research / websearch / codesearch 呼び出し）及び agent 系の system prompt（dot_config/opencode/agents/*）に研究ゲート規定が追加されていること。

verification_result: pending

notes:

- アシスタントは指摘後に public-research を使って Exa ドキュメントを取得している（ただしこの取得は初回応答に先行していない）。ユーザーは初回応答での一次ソース提示を期待していた。

---

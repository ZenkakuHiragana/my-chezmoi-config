# B1 証明書規律 詳細設計書

## 0. 文書の位置づけ

- 上位契約は `opencode-prompt-dev/fundamental-problem-map.md` 第2部の B1（task identity、証明対象、work item 構成、受け入れ条件）とする。本書はその詳細設計であり、上位契約を変更しない。上位契約の変更が必要になった場合は、本書を直す前に fundamental-problem-map.md の改訂を行う。
- 読者は B1 を実装する実行エージェント（work item 単位で委譲される下位モデルを含む）と人間の保守者。各 work item は本書と参照 fixtures だけで着手できる明示度を目標とする。
- 実行時に本書の work item を再分割・再定義してはならない。契約水準の障害（未記載の依存関係、受け入れ条件の達成不能）を発見した実行者は、その場で停止し、deviations として差し戻す（根拠: 失敗記録 20260705-1118）。

## 1. 目的とリポジトリ文脈

- リポジトリの目的はモデルの問題解決性能を +1 世代向上させること。最終指標は「所与の品質水準を達成できる最弱のモデル」。
- B1 は根源課題 P2（検証の非対称性）への中心投資。開放的なレビュー（発見の義務）を行単位の照合（チェックの義務）に変換し、立証責任を実装者へ移す。
- 中心法則「衝突の予定」は現時点で仮説である（反例3標本は観測、証明書の効果は未観測）。B1 の実測がその最初の検証であり、悪い結果は fundamental-problem-map の書き換え（reframing）根拠として扱う。

## 2. 制約条件

すべて既決。実行時に緩めてはならない。変更は人間の決定と上位契約の改訂を要する。

- C1 移植性: 対象 harness は OpenCode / Oh-My-Pi / Claude Code / Codex の4つ。OS は Windows を含む。計器は Node.js コアモジュール + 薄い CLI + MCP server の3層で提供し、照合ロジックはコアモジュールだけが持つ。shell スクリプト、PATH 登録、ExecutionPolicy 等のホスト設定に依存する配布形態を採用してはならない。
- C2 git: エージェントに git の破壊的操作を許可しない。コミットは人間が行う。したがって pre-commit / CI はエージェントループ内の発火機構にならない（人間コミット時の補助ゲートとしてのみ任意採用）。
- C3 帳簿分離: 証明書は消費財であり、非追跡のローカル規約ディレクトリに置き、バージョン管理に載せない。fixtures・resolver・schema 文書・cert-policy は資本財であり、リポジトリで追跡する。
- C4 統治予算: 常駐プロンプト指示は最小限に留め、教示の大半は差し戻しメッセージ（発火時にだけコンテキストへ入る）に載せる。規則追加時は同量の削除または移設を明示する。
- C5 モデル配分と委譲: work item 1・3（fixtures、schema）は強いモデルまたは人間が行い、下位モデルへ委譲してはならない。work item 2（resolver 実装）は凍結済み fixtures と機械的受け入れ条件を前提に下位モデルへ委譲できる。委譲の assignment packet にセッション経緯を書いてはならない（B3 制約）。
- C6 プロンプト階層: 常駐指示はグローバル AGENTS.md に置かず、該当 skill 本文へ置く。グローバル層に分岐を書かない。
- C7 言語・語彙: prompt 本文へ持ち込む新しい制御語彙は `opencode-prompt-dev/english-token-allowlist.md` へ登録する。義務表現は `opencode-prompt-dev/obligation-vocabulary.md` の正規マーカーを使う。
- C8 プロジェクト分離: 照合機構と schema の枠組みはプロジェクト非依存。schema の中身、保護 glob、must-cite レジストリの中身は各プロジェクトのリポジトリで定義する。

## 3. 全体アーキテクチャ

### 3.1 構成要素

| 要素 | 置き場所 | 追跡 | 説明 |
| --- | --- | --- | --- |
| 証明書 | `.opencode/local-certs/`（D1 参照） | しない | タスク実行中に実装者が作る照合可能な表。JSON 1ファイル=1証明書 |
| resolver core | `opencode-prompt-dev/cert-resolver/core.mjs` | する | 照合ロジックの唯一の実装。Node.js 20+ コアモジュールのみ、外部依存ゼロ |
| CLI | `opencode-prompt-dev/cert-resolver/cli.mjs` | する | core を呼ぶ薄いアダプタ。`node cli.mjs verify <cert> --root <path>` |
| MCP server | `opencode-prompt-dev/cert-resolver/mcp.mjs` | する | core を呼ぶ薄いアダプタ。stdio。tool 名 `cert_verify` |
| Stop 再照合器 | `opencode-prompt-dev/cert-resolver/audit.mjs` | する | turn 終了時の最終状態再照合。core を呼ぶ |
| hook adapter | 各 harness の設定（chezmoi 管理下） | する | harness イベントを受けて core を `node` で呼び、判定をブロック形式に変換する数行の接続 |
| cert-policy | プロジェクトごと `cert-policy.json` | する | 保護 glob、must-cite パターン、certs ディレクトリ位置、除外の宣言 |
| fixtures | `opencode-prompt-dev/cert-resolver/fixtures/` | する | 疑似 source tree + 証明書 + 期待判定の組。受け入れ検査と較正の正本 |
| schema 文書 | `opencode-prompt-dev/cert-schema.md` | する | 証明対象ごとの列定義。work item 3 の産出物 |

CLI・MCP・audit・hook adapter は照合ロジックの重複実装を持ってはならない。検証は常にコアモジュールに対して `node` で実行できる。

### 3.2 証明書の書式（作業仮説）

以下は work item 1 の出発点となる作業仮説であり、確定は work item 3（fixtures の成文化）で行う。fixtures を書く過程でこの仮説と実物が食い違った場合、実物を優先し、本節を改訂する。

```json
{
  "schema_version": 1,
  "target": "source-of-truth | contract | external-identifier",
  "task_id": "対応する task file または依頼の識別子",
  "covers": ["この証明書が免許する書き込み先パスの一覧"],
  "created_at": "ISO 8601",
  "rows": [
    {
      "claim": "主張（日本語自由文）",
      "source_path": "出典パス（cert-policy の root 相対）",
      "range": { "start": 1, "end": 10 },
      "quote": "range の逐語引用",
      "identifiers": ["claim に含まれ quote 内に出現すべき識別子"]
    }
  ]
}
```

- 機械照合列は `source_path` / `range` / `quote` / `identifiers`。`claim` は自由文で、関連性判定（分離検証者）と抜き取り照合の対象。
- `target` の値は英語の制御語彙とする（prompt へ持ち込む場合は allowlist 登録。C7）。
- 鮮度は照合時刻のファイル内容で担保する。照合は常に現在のファイルに対して行うため、原本が証明書作成後に変わっていれば quote 不一致として自然に落ちる。追加のハッシュ列は初版では持たない。

### 3.3 照合仕様（resolver core）

入力: 証明書ファイル、root ディレクトリ、（作成時発火の場合）書き込み予定パスと候補内容。

| 検査 | 内容 | 失敗の意味 |
| --- | --- | --- |
| V1 パス実在 | `source_path` が root 配下に実在する。シンボリックリンク解決後も root 内 | 出典の捏造 |
| V2 引用一致 | `quote` が `range` の行内容と逐語一致。正規化は改行コード（CRLF/LF）と行末空白のみ | 引用の捏造・原本の変化 |
| V3 識別子出現 | `identifiers` の各要素が `quote` 内に単語境界で出現 | 主張と引用の乖離 |
| V4 covers 束縛 | 書き込み予定パスが `covers` に含まれる（作成時発火のみ） | 別作業の証明書の流用 |
| V5 schema 妥当性 | 必須フィールドと型が §3.2 に適合 | 書式不備 |

出力契約: stdout に JSON `{ "verdict": "pass" | "fail", "failures": [{ "row": n, "check": "V1..V5", "expected": "...", "actual": "..." }] }`。exit code は 0 = pass、1 = fail、2 = 入力・設定エラー。`failures` は差し戻しメッセージ生成の入力になる。

### 3.4 発火述語

作成時（ブロック型）。次のいずれかに該当する書き込みは、照合を通る証明書なしに実行してはならない。

- F1: 書き込み先が cert-policy の保護 glob に一致する。該当する `covers` を持つ証明書の全行照合通過が必要。
- F2: 候補内容に must-cite パターンに一致する識別子が含まれる。その識別子を `identifiers` に含む照合通過行が必要。
- F3: task file が存在する場合、書き込み先が write_set 内であること。これは証明書を介さない直接照合。

提出時（非ブロック型）。調査結論・助言・完了報告では、根拠レコードを伴わない主張を default-deny により「仮定」として明示分類する。これは skill 層の指示であり、機械強制しない。全主張への証明書強制は儀式化とオーバーヘッドを生むため行わない。

非発火。F1〜F3 のいずれにも該当しない操作（些細な問答を含む）には何も要求しない。発火の判定にタスクの複雑さやエージェントの自己申告を使ってはならない。省略可否を判断する主体を置かないことが、省略判断の P4 汚染を防ぐ。

### 3.5 発火機構（harness 接続）

主経路は PreToolUse 型フックによる作成時ブロック。全対象 harness で「ツール引数（候補内容）の受領」と「ブロック」が公式仕様で確認済み（§7 調査記録）。

| harness | イベント | 候補内容の受領 | ブロック手段 | 注意 |
| --- | --- | --- | --- | --- |
| Claude Code | `PreToolUse` | `tool_input`（Write/Edit の内容込み） | exit 2 または `permissionDecision: "deny"` | — |
| OpenCode | `tool.execute.before` | `output.args`（filePath・内容） | throw | subagent のツール呼び出しを intercept しないバグあり（§7）。実装時に修正状況を再確認 |
| Oh-My-Pi | `tool_call` | `input`（ツール引数） | `{ block: true, reason }`。handler の throw も block | — |
| Codex | `PreToolUse` | `tool_input` | `permissionDecision: "deny"` または exit 2 | GA・既定有効。Bash・apply_patch・MCP を intercept。apply_patch payload に patch 本文が含まれることは実装時に実物確認（§7） |

補助経路:

- Bash 経由の書き込み: PreToolUse 型フックで Bash コマンドを保守的に検査し、保護 glob への書き込み・リダイレクトを含むコマンドは deny して Edit/Write 経由へ誘導する。コマンド文字列の静的判定は完全にはできないため、これは網羅を狙わない。
- Stop 型フックの最終状態再照合: turn 終了時に `audit.mjs` が変更ファイルを列挙（read-only の git status / diff）し、(a) 保護 glob 内の変更すべてに照合通過の証明書があるか、(b) 証明書がゲート通過後に改竄されていないかを検査する。書き込み経路（Edit / Bash / MCP / subagent）に依存しない控えであり、PreToolUse の穴（Bash 静的判定の限界、OpenCode subagent バイパス）をここで受ける。Stop 相当イベントで turn 終了を拒否できるかは harness 差があるため実装時に確認し、拒否できない harness では警告出力と失敗記録への転記に落とす（D5）。
- pre-commit（任意）: 人間がコミットする時点の補助ゲート。git hook は working tree を読めるため非追跡の証明書とも両立するが、エージェントループ内の強制ではないため主経路にしない。

### 3.6 差し戻しメッセージ契約

ブロック時のメッセージは resolver の `failures` JSON から機械生成し、次を含める。

- 失敗した検査（V1〜V5 / F1〜F3）と、期待・実際の値。
- 証明書の置き場所（certs ディレクトリ）と書式の最小例、または schema 文書へのパス。
- 再試行の手順（証明書を作成または修正してから同じ書き込みを再実行する）。

教示の大半をここへ載せることで、常駐プロンプトの統治予算消費を避ける（C4）。差し戻し文は発火した時にだけコンテキストへ入る。

## 4. work item 詳細

順序固定。担当区分は C5 に従う。

### WI1: fixtures 作成（強いモデルまたは人間）

- 各 fixture は自己完結ディレクトリ `fixtures/<id>/` とし、`sources/`（疑似原本ツリー）、`cert.json`、`expected.json`（期待 verdict と理由）、必要なら `artifact/`（成果物ファイル）を含む。外部リポジトリの実コードを持ち込まず、失敗記録の構造を再現した合成ファイルを使う（例: 20260628-1706 の row schema は、`parameters[i]` 型の対応関係を持つ合成 Lua ファイルで再現する）。
- 最小セット（上位契約の「各証明対象につき正例2枚以上・捏造例2枚以上」を具体化）:
  - source-of-truth 正例 ×2: うち1枚は 20260628-1706 の反実仮想の正しい側（row schema の由来を正しく引用し、識別子の局所化を止める主張）。
  - source-of-truth 捏造 ×2: 実在パス + 改変引用（V2 で落ちる）。引用は実在するが claim の識別子が range 外（V3 で落ちる）。
  - contract 正例 ×2: task file を出典に、write_set 内の書き込みを免許する。
  - contract 捏造 ×2: task contract の work item 一覧に存在しない task identity への言及（20260705-1118 の反実仮想。引用先に該当行がなく V2/V3 で落ちる）。write_set 外パスを covers に含む（V4 で落ちる）。
  - external-identifier 正例 ×2 / 捏造 ×2: API パラメータや config キーの意味・制約の引用。捏造側は制約の言い換え偽装（引用改変）と識別子不出現。
  - 生成後捏造 ×2: `artifact/` に成果物を同梱し、cert は全行真だが成果物が claim に違反している。expected は「resolver は pass、適合検査（分離検証者への問い）は fail」。resolver の限界を較正する fixture であり、分離検証者の held-out テストに使う。
- 産出物: fixtures 一式（追跡）。書けなかった列・支持できなかった主張の記録（schema 改訂の入力）。
- 完了条件: 全 fixture に expected.json があり、生成後捏造を除く捏造例はすべて V1〜V5 のどれで落ちるかが明記されている。

### WI2: resolver 実装（下位モデルへ委譲可）

- 入力: 凍結済み fixtures、本書 §3.2〜§3.3、受け入れコマンド。
- 実装: `core.mjs`（照合ロジック）、`cli.mjs` / `mcp.mjs` / `audit.mjs`（薄いアダプタ）。Node.js 20+ コアモジュールのみ。テストは `node --test` で fixtures を走査し、expected と照合する。
- assignment packet に含めるもの: fixtures パス、本書 §3.2〜§3.3・§3.6、受け入れコマンド。セッション経緯を書いてはならない。
- 完了条件（機械検査）: `node --test` が全 fixture で期待判定に一致する。正例全通過・捏造例全検出（生成後捏造は resolver pass が期待値であることに注意）。アダプタが照合ロジックの重複実装を持たない。

### WI3: schema 成文化と cert-policy 定義（強いモデルまたは人間）

- 生き残った fixtures から列定義を帰納し、`cert-schema.md` に成文化する。全列に「この列を要求した fixture」への参照を付ける。fixture が要求しなかった列を追加してはならない。
- cert-policy.json の書式を定義する: 保護 glob、must-cite パターン（正規表現）、certs ディレクトリ位置、除外。中身の初期値はプロジェクトごと（D3）。
- 発火述語 F1〜F3 を cert-policy から機械判定できる形で固定する。
- 命名: schema・rubric の項目名は、対応する失敗記録の pattern_tags が存在する語だけを必要時に収穫する。fuck.jsonl 終盤の停止語彙は候補プールであり、先回りして整備しない。
- 完了条件: cert-schema.md が存在し、全列に fixture 参照がある。cert-policy.json のサンプルが fixtures 内にあり、F1〜F3 の判定が resolver core のテストで通る。

### WI4: 発火機構の接続

- 第一接続 harness は人間が決定する（D2）。接続は hook adapter（数行）+ core 呼び出しで構成し、照合ロジックを持たない。
- 実装内容: 作成時ブロック（§3.4 F1〜F3、§3.5 主経路）、差し戻しメッセージ生成（§3.6）、Stop 再照合（§3.5 補助経路）、Bash 保守的検査。
- 完了条件（実演を記録する）: (a) 保護 glob への証明書なし書き込みがブロックされる。(b) 差し戻し文の教示に従って作成した証明書で同じ書き込みが通る。(c) Bash 迂回の書き込みが Stop 再照合で検出される。(d) ゲート通過後の証明書改竄が Stop 再照合で検出される。

### WI5: プロンプト統合

- 常駐指示: `implementation` / `investigation` など該当 skill 本文へ、発火述語への言及と schema 文書参照を最小限（目安1〜2行）追加する。グローバル AGENTS.md には置かない。統治予算の支払い（同量の削除または移設）を差分に明示する。
- default-deny の提出時分類（§3.4）も skill 層の指示として同時に整備する。
- 語彙: prompt 本文へ持ち込む制御語彙（例: certificate、cert-policy、must-cite、`cert_verify`）を english-token-allowlist.md へ登録する。
- 検証: blind eval。凍結シナリオ、盲検実行者、分離採点者（2026-06-25 eval と同じ構成）。指標は初回ブロック率（フックに差し戻されてから証明書を作った割合）と、ゲート通過までの turn 数。指示あり／なしを比較する。
- 完了条件: 指示差分が統治予算の支払いつきで適用され、blind eval の結果が記録されている。

### WI6: コスト実測と調整

- 指標: タスクあたりの追加トークン・追加 turn・ブロックループ回数、初回ブロック率の推移。
- 収集: harness のセッションログから。実タスクへの適用は保護面を狭く始めて広げる。
- 調整対象: 保護 glob の範囲、must-cite パターンの精度（誤発火率）、差し戻し文の教示内容。
- 完了条件: 少なくとも1つの実タスク系列でコストが記録され、発火述語の調整判断（広げる・維持・狭める）が根拠つきで残っている。

## 5. 検証方法とこの計画自体の反証条件

- 機械検証: fixtures 全通過・全検出（WI2）。発火機構の4実演（WI4）。
- 経験的検証: blind eval（WI5）、コスト実測（WI6）。
- 仮説検証: B1 全体が中心法則（仮説）の最初の検証である。次の観測は仮説側の修正を要求する。
  - 指示ありでも初回ブロック率が下がらない: prose + 予定された衝突の組でも教示が届かない。常駐指示の設計か差し戻し文を再設計する。
  - 生成後捏造の抜き取り検出率が低い: 適合検査の問いを再設計するか、証明書規律の適用を狭い証明対象へ縮小する。
  - コスト増分が失敗分布の改善（P2 主因の減少）に見合わない: 発火点をさらに commitment point へ限定するか、B1 への投資を停止して fundamental-problem-map を書き換える。

## 6. 未決事項（人間の決定待ち）

- D1: certs ディレクトリの位置。案は `.opencode/local-certs/`（既存の `.opencode/local-failure-logs/` と同じ規約に揃える）。harness 中立な名前にするかどうかを含めて決定する。
- D2: 第一接続 harness。主開発 harness を優先するのが自然だが、OpenCode は subagent バイパスのバグ状況（§7）次第で Claude Code 先行も選択肢。
- D3: このリポジトリ自身へ適用する場合の cert-policy 初期値。保護 glob の候補: `dot_config/opencode/agents/`、`dot_agents/skills/`、`.chezmoitemplates/opencode/`。must-cite の候補: skill 名・schema field・status 値（english-token-allowlist の語彙と連動）。
- D4: MCP server の登録方法。chezmoi でどの harness 設定に配るか。
- D5: Stop 相当イベントで turn 終了を拒否できない harness の扱い（警告 + 失敗記録転記で妥協するか、その harness では保護面を狭めるか）。

## 7. 調査記録（2026-07-05 確認）

hook 仕様の一次資料確認。最新性が効く主張のため、実装時（特に数か月後）には再確認する。

- Codex: hooks は GA で既定有効（`[features] hooks = false` で無効化する側の設定）。`PreToolUse` は `tool_name` / `tool_use_id` / `tool_input` を受け、`permissionDecision: "deny"` / exit 2 でブロック、`updatedInput` で書き換え可。公式に「PreToolUse は Bash、apply_patch による file edits、MCP tool calls を intercept できる」と明記。出典: <https://developers.openai.com/codex/hooks>。注意: 第三者記事には「Bash のみ intercept」とする公式と矛盾する記述が流通している。一次資料を採る。apply_patch の payload に patch 本文が含まれることは構造上ほぼ確実だが引用例では未確認であり、WI4 実装時に実物で確認する（推測と事実の区別）。
- OpenCode: plugin の `tool.execute.before` が `input.tool` と `output.args`（filePath 等のツール引数）を受け、throw でブロック。出典: <https://opencode.ai/docs/plugins/>。注意: subagent のツール呼び出しを intercept しないバグ報告 <https://github.com/anomalyco/opencode/issues/5894>。WI4 で修正状況を再確認する。
- Oh-My-Pi: `tool_call` イベントが `toolName` / `input` / `toolCallId` を受け、`{ block: true, reason }` でブロック。handler の throw も fail-safe でブロック側に倒れる。出典: <https://github.com/can1357/oh-my-pi/blob/main/docs/hooks.md>。
- Claude Code: `PreToolUse` が `tool_input`（Write/Edit の書き込み内容込み）を受け、exit 2 または `permissionDecision: "deny"` でブロック。出典: <https://code.claude.com/docs/en/hooks>。

## 8. 関連資料

- opencode-prompt-dev/fundamental-problem-map.md — 上位契約（第2部 B1）と設計原理
- .opencode/local-failure-logs/20260628-1706-review-feedback-overapplied.md — source-of-truth / external-identifier fixtures の供給源
- .opencode/local-failure-logs/20260705-1118-scope-shrunk-persistent-subtasks.md — contract fixtures の供給源、委譲規約の根拠
- opencode-prompt-dev/check_vocabulary.py — 常設計器の先例（fixtures による較正、CLI 提供の位置づけ）
- opencode-prompt-dev/english-token-allowlist.md — WI5 での語彙登録先
- opencode-prompt-dev/obligation-vocabulary.md — WI5 で書く指示文の義務マーカー正本
- 2026-06-25 blind A/B eval — WI5 の eval 構成の先例（凍結シナリオ、盲検実行者、分離採点者）

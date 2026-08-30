# コンテキスト管理と圧縮の調査報告

## 概要

コーディングエージェントを長時間運用すると、コンテキストが蓄積してモデルの品質が落ちる。この問題への対策として、既存の圧縮手法、コンテキスト管理プラグイン、関連する学術研究を調査した。結果として `magic-context` を採用し、OpenCode のデフォルト圧縮を置き換えることにした。

本報告は、調査で判明した事実、比較した既存実装、採用に至った理由、残る課題を記録する。今後のコンテキスト管理方針の参照と、再調査時の足がかりとして使う。

### 結論

- `magic-context` を導入し、OpenCode のデフォルト圧縮を置き換える。
- `opencode-openai-compact` は排他のため外す。
- 推奨設定は「記憶機能の自動昇格を止め、履歴係による圧縮置き換えだけ残す」方向で組む。
- 履歴係モデルは `GPT-5.4 mini` + `two_pass: true` を第一候補とする。金額換算で `GPT-5.4` 単発の約40%に収まる見込み。

## 背景

### 発端: レビュー対応ループでのモデル崩壊

`Oh-My-Pi` のセッションログ（未追跡の fuck.jsonl、約94MB）に、コードレビューとその対応を繰り返すうちにモデルが指示追従を失い、作業契約を守らなくなった事例が記録されていた。ユーザーは既に契約を結ぶ指示を出していたが、モデルがそれを守らなかった。長いループの途中でモデルの「素」が出始め、最終的にユーザーが「怒るのやめたい」と述べてセッションを打ち切った。

これを受け、コードレビューでの指摘事項の再検討と修正計画の立案を義務化した。さらに、状態遷移図に基づく決定論的監視プラグイン（`watchdog`）を試作した。

### 問題提起: 自己申告ベースの監視の限界

監視器（`watchdog`）は、モデルが本文中の YAML フェンス付きブロックで作業状態を自己申告し、それを読んで状態遷移違反を検出する設計だった。しかし、この設計には構造的な矛盾があった。

YAML の状態報告を守れるモデルは、そもそも手順を守れるから監視が不要である。一方、YAML を出さないモデルには監視が始動しない。つまり「縛りたい時に限って縛れない」パラドックスになる。

さらに、一度 `Unknown → Diagnosis → Options → Policy → Implementation` の正規シーケンスを通れば、以降は自由に編集できる。崩れたモデルでもプロンプト注入で示された YAML テンプレートを踏めば、合法的に編集に至れる。状態報告の自己申告に依存する監視は、嘘をつかれると無力になる。

`GPT-5.3 Codex Spark` で試験した際、監視器を有効化してもハーネスを突破された。当初「Codex CLI にはユーザー向けフックがないから」と仮説を立てたが、実際は OpenCode 上で監視器を有効化しての実験だったため、フック不在説は誤りだった。真の原因は、Codex Spark が最終回答以外でほとんど発話しない特性により、状態報告 YAML を出さないことだった。監視器は `Unknown` 状態のままツール呼び出しを検知してエスカレーションを進めたが、モデルが YAML で応えることがなく、回復ループが成立しなかった。

### 調査の方向

モデルの崩壊を事後検出して介入するアプローチ（監視器）の限界が見えたため、原因そのものを外す方向に軸足を移した。コンテキストの蓄積が品質劣化を生むなら、コンテキストを管理する手段を探る。具体的には次の2軸で整理した。

- **量を減らす**: ツール結果の圧縮、古い履歴の骨格化、反復実行の統合。
- **ノイズを取り除く**: 直近の作業に無関係で注意をそらす情報の除去。

この2軸に沿って、既存の圧縮手法、コンテキスト管理プラグイン、関連研究を調査した。

## コンテキスト崩壊のメカニズム

LLM が長い会話やエージェントループで品質を落とす原因として、複数の学術的・実務的報告がある。

### 中間部の見落とし

Liu et al., "Lost in the Middle: How Language Models Use Long Contexts", TACL 2024（arXiv 2307.03172）は、長いコンテキストで情報の位置によって性能が変わることを実証した。先頭（primacy）と末尾（recency）は強く参照されるが、中間は無視される。U字型の性能曲線になり、最悪ケースでは「ドキュメントなしが最もマシ」になる。

Hsieh et al., "Found in the Middle", arXiv 2406.16008 (2024) は、これが transformer 固有の注意の偏りだと実証した。関連性に関わらず先頭と末尾のトークンが高い注意を受ける。

システムプロンプトや初期の AGENTS.md が中間に沈むと、参照されなくなる。契約はセッションの途中に作られるため、どんどん中間に埋もれていく。

### コンテキスト腐敗

Chroma 社の2025年の研究（18のフロンティアモデルで測定）と Paulsen (2025) の報告によると、200Kトークン窓のモデルが 50Kトークンで劣化を開始する。「大きな窓は解決にならない。劣化の閾値をずらすだけ。8Kで50ターンで崩れるモデルは、200Kで200ターンで崩れる」。

Karpathy のコンテキスト設計論では、コンテキストウィンドウはモデルの RAM に例えられる。通常の RAM と違い、詰め込むと検索性能が劣化する。

### エージェントのずれ

Rath, "Agent Drift: Quantifying Behavioral Degradation in Multi-Agent LLM Systems Over Extended Interactions", arXiv 2601.04170 (2026) は、意味のずれ（元の意図からの逐次ずれ）、協調のずれ（マルチエージェント間の合意の崩壊）、振る舞いのずれ（意図しない戦略の出現）の3つを定義した。原因としてコンテキスト窓の汚染（古い対話がコンテキスト窓に溜まり、S/N比（シグナル対ノイズ比）を下げる）を挙げ、解決策としてエピソード記憶の統合を推奨している。

### 指示のずれ

"Quantifying Conversational Reliability of LLMs under Multi-Turn Interaction", arXiv 2603.02373 の定性分析では、指示のずれ（グローバル制約の無視）、意図の混同（前回のツールの再利用）、文脈上書き（近くの言及による構造化情報の上書き）が報告されている。重要な知見は、「長さだけが原因ではない。特定の妨害要素や競合するユーザー要求が原因」であること。無関係なターンが挟まるだけで、グローバル制約が消える。

## 圧縮の効果と限界

### 圧縮は何を解くか

圧縮は、コンテキストウィンドウが限界に近づいた時、古い会話を要約して短くし、モデルが継続できるようにする手法。初頭効果と親近効果があるため、コンテキストを空ければシステムプロンプトと直近の指示が強く効くようになる。

Claude 公式（platform.claude.com/docs/en/compaction）はサーバー側圧縮を推奨し、「長い会話でモデルがフォーカスを維持できなくなるのを防ぐ」と明記している。

### Factory.ai の評価: 成果物追跡は一律に弱い

Factory.ai が36,611本の本番メッセージで主要圧縮手法を評価した結果、成果物追跡（どのファイルを変更したかの記憶）が全手法で一律に弱かった。スコアは 2.19〜2.45 / 5.0。「どの方法もファイル変更を確実に覚えていない」。

Cursor の "Training Composer for longer horizons"（cursor.com/blog/self-summarization, 2026-03-17）では、圧縮を組み込んだ RL 訓練の専用モデルでエラーを50%削減したとしている。汎用モデル + 単純な圧縮は情報ロスが大きい。

### SELFCOMPACT: タイミング問題

Li et al., "Self-Compacting Language Model Agents", arXiv 2606.23525 (2026) は、固定トークン閾値での圧縮が「モデルが何をしているか」を知らないことを指摘した。「悪いタイミングの圧縮は、モデルが続けるのに必要だった部分結果を捨てる」。モデル自身に圧縮タイミングを決めさせる手法を提案したが、採点基準がないとモデルは不正なタイミングで圧縮する。

### Claude クックブック: 3層モデル

Claude の "Context engineering cookbook"（platform.claude.com, 2026-03-20）は、コンテキスト管理を3層に分ける。

- **圧縮**: 全トランスクリプトを要約。設計上、情報を失う。会話全体が大きくなった時に使う。
- **ツール結果の消去**: 古い `tool_result` ブロックだけを短いプレースホルダに置換。`tool_use` 記録は残す。再取得可能な情報に有効。
- **記憶**: ウィンドウの外に情報を移し、セッションを跨いで保存。

Claude API は `compact_20260112` の文脈編集をネイティブに提供し、トークン閾値（最小50K）で自動発火する。

## 比較した既存実装

### context-mode (mksglu)

`github.com/mksglu/context-mode`。MCP サーバとして動き、生データをコンテキストに入れない設計。

**仕組み**: `ctx_execute` でコードをサブプロセス実行し、stdout だけをコンテキストに入れる。`ctx_index` で FTS5 に断片化して格納、`ctx_search` で検索。`tool.execute.before` で生の Read / Bash / WebFetch をブロックし、ctx_* ツールに経路制御する。圧縮時に `<2 KB XML snapshot>` を SQLite に保存、再開時に `experimental.chat.system.transform` で注入。

OpenCode と OMP (Oh My Pi) に対応。`omp plugin install context-mode` で導入できる。

**不採用理由**:

1. **権限バイパス**: `ctx_execute('javascript', ...)` は Bash を経由せず直接 `node` プロセスを起動する。README のセキュリティ節は「permission rules を MCP sandbox に拡張する」と書くが、これはコマンド文字列のパターンマッチの話であり、言語ランタイムの直接起動には及ばない。README に「ctx_execute and ctx_batch_execute run arbitrary code... treat approving any execution tool as approving arbitrary code」と明記されている。`permission.bash."node *": ask` を設定していても、ctx_execute 経由だとバイパスされる。
2. **トレーサビリティ欠如**: `ctx_search` の結果に由来メタデータ（元ファイルパス、索引化日時、ブランチ）が付与される記述が README にない。別ブランチの古い仕様書が索引化されていると、それが現在の仕様と区別できないリスクがある。`Read` は「このファイルを今読め」という同期的・因果的な操作だが、ctx_search は統計的検索であり、由来の因果が切れる。

### setu-opencode

`github.com/pkgprateek/setu-opencode`。Scout → Architect → Builder の3段階の作業手順をフックで強制する。

`experimental.session.compacting` で「アクティブタスク + 制約（READ_ONLY, NO_PUSH 等）」を圧縮要約に注入する。README のコメントに「圧縮後にエージェントが制約を忘れて逸脱することを防ぐ」とあり、fuck.jsonl と同じ問題を予防的に解いている。

**位置付け**: 参考になるが、作業手順が硬い（常に3段階を通す前提）。小さい作業に重い作業手順を強制しない設計とは合わない。スター2、フォーク0（2026-03 時点）で採用実績が薄い。圧縮フックの実装アプローチだけ参考にする価値はある。

### OpenCode-DCP (Dynamic Context Pruning)

`github.com/Opencode-DCP/opencode-dynamic-context-pruning`。モデル自身に圧縮タイミングを委ねる。

**不採用理由**: 深い調査タスクで、調査中の文脈が圧縮で潰される「調査中忘却」が観測された。SELFCOMPACT が警告した「導出途中の発火」の実例。永続化も再開も持たない。開発は `Sleev` に移行しており縮小傾向。

### RTK (Rust Token Killer)

`github.com/rtk-ai/rtk`。コマンド出力を機械的にフィルタして圧縮する Rust バイナリ。`git status` を `rtk git status` に透過的書き換え。

**限界**: クリーンなリポジトリで `git status` を叩くと `ok` とだけ返し、モデルが意図を理解できずに何度も `git status` を繰り返す悪影響があった。`dotnet` CLI の出力は RTK が認識しないため効かなかった。`gitCompaction` を無効化すれば部分的に使えるが、`dotnet` に効かないなら価値は半減する。

### magic-context (cortexkit)

`github.com/cortexkit/magic-context`。「コーディングエージェントの海馬」を名乗る。履歴係 + 減衰描画 + 緊急削除で圧縮を丸ごと置き換える設計。

詳細は次節で述べる。

## その他の関連研究

### コードによるエージェントハーネス

Ning et al., "Code as Agent Harness: Toward Executable, Verifiable, and Stateful AI Agent Systems", arXiv 2605.18747 (2026)。記憶を「状態管理層」として定義し、「適切な状態管理が無いとエージェントは後の修正の際に、初期ステップで確立した局所的な一貫性を壊す」と指摘する。これは fuck.jsonl の失敗モードと高い整合がある。対策を「どの情報を能動コンテキストに残し、どれを要約し、どれを耐久外部ストレージへ退避するかを決める状態管理層」と定義する。

### すべてはコンテキスト

Xu et al., "Everything is Context: Agentic File System Abstraction for Context Engineering", arXiv 2512.05470 (2025)。履歴 / 記憶 / 下書き場の3層モデルを提案。履歴は不変の真実の源で決して削除しない。記憶は構造化・索引化された表示。下書き場は一時的で、セッション終了時に検証を経て記憶へ昇格させる。文脈評価器が閉ループとして出力を元文脈と照合して幻覚を検出する。

### Harness-1

Jiang et al., "Harness-1: Reinforcement Learning for Search Agents with State-Externalizing Harnesses", arXiv 2606.02373 (2026)。20B の検索エージェントを、状態を環境側に外部化したハーネスの中で RL 訓練。「方策は意味的決定だけを保持し、回復可能な状態管理はハーネスが担う」分離が、RL ベースでも有効だと実証した。

### LLM-as-Code

Qi et al., "LLM-as-Code: Agentic Programming for Agent Harness", arXiv 2606.15874 (2026)。制御フローを LLM ではなくプログラムが握る設計。文脈がフラットな会話ログではなく呼び出しグラフ（DAG）になり、各呼び出しの文脈長は累積ではなく呼び出し深さで決まる。「解放」は関数から戻るだけで自然に起きる。

### LLM エージェントの外部化

arXiv 2604.08224。記憶（時間を跨ぐ状態）、スキル（手続き的専門知識）、プロトコル（相互作用の構造）、ハーネス（統合ランタイム）の4つの外部化を整理する。

## magic-context の設計と採用

### 採用理由

magic-context は圧縮を生き延びる（context-mode）のではなく、圧縮を置き換える。履歴係が裏側で古い履歴を構造化された区画に圧縮し、減衰描画で段階的に薄らませ、緊急削除で限界時に強制削除する。`ctx_search` と `ctx_expand` で元の生メッセージを復元できるため、OpenAI の `/responses/compact` より情報維持が強い可能性がある。

権限バイパス（context-mode）や調査中忘却（DCP）の問題を持たない。`ctx_execute` 系のコード実行ツールを持たないため、`permission.bash` を迂回しない。

記憶機能は層ごとに独立してオン/オフできる。自動昇格によるセッション間記憶の蓄積を止めつつ、セッション内の圧縮置き換えだけ残せる。

### 区画とは

区画は、生メッセージの「1つの目的を持つ連続した作業の弧」を、4つの詳細度の要約に圧縮した単位。各区画は `start` / `end`（生メッセージの ordinal 範囲）、`title`、`episode_type`、`importance`（1-100）、`<p1>` 〜 `<p4>` の4段階を持つ。

履歴係が生メッセージを読んで区画を生成し、DB に保存する。その後、OpenCode 互換の圧縮印を注入し、`filterCompacted` が印より前のメッセージを変換入力から除外する。代わりに区画の1段階だけが `<session-history>` ブロックとして `m[0]` スロットに注入される。

これにより、生メッセージ（例: 50,000トークン）が区画の要約（例: 500トークン）に置き換わり、メインエージェントのコンテキストが小さくなる。`ctx_search` で区画を検索し、`ctx_expand` で元の生メッセージを復元できるため、日常は要約で回し、必要になったら詳細を取り戻す設計になる。

### 減衰描画

区画は時間経過とコンテキスト圧力に応じて、描画される段階が下がる。半減期 `H = H50·2^((I−50)/D)/max(p,0.10)`（H50=24, D=25）。I は `importance`、p は予算圧力。新しい・重要な区画は P1（最大詳細）、古い・低重要度のものは P4（アンカーのみ）で描画される。この段階選択は決定論的で、LLM 呼び出しを伴わない。

### 履歴係の重要性判定

履歴係のシステムプロンプトは v8.7.3（再生実験で検証）。`importance` を「重要性」ではなく「減衰率（どれくらい長く高忠実度記憶を保持する必要があるか）」と定義する。「労力」や「活動種別」でなく、「将来どれだけ必要か」で判定するよう導く。

具体的なスコア基準は次の通り。

- **85-100**: 拘束・不変条件・決定で、将来の全作業が従わなければならないもの。
- **60-84**: 数ヶ月正確な記憶が必要な、具体的な作業の成果。
- **30-59**: 数週間の大雑把な記憶で十分な定常作業。結果はコードベースにある。
- **10-29**: 数日で十分な戦術的作業。
- **1-9**: ほぼ不要。ドッグフーディングのノイズ、即座に撤回された誤開始。

事実は PROJECT_RULES / ARCHITECTURE / CONSTRAINTS / CONFIG_VALUES / NAMING の5カテゴリに分類され、各カテゴリに厳格なテストと豊富な良い例/悪い例がある。ユーザー発言（U: lines）の保持には DROP/KEEP ルールがある。

### コスト試算

履歴係は別エージェントで動くため、メインエージェントとは別にトークンを消費する。

履歴係1回あたり: 入力（システムプロンプト 約10,000〜15,000 + 生断片 5,000〜50,000 + 参照 約5,000〜10,000）+ 出力（区画 + 事実 約5,000〜15,000）で約25,000〜90,000トークン。長いセッション（100ターン）で履歴係が10〜25回発火すると、500,000〜1,250,000トークンを消費する見込み。

メインエージェントのコンテキストが区画化で減るため、メインのトークン消費も減る。純増はセッション全体で 1.3-1.5倍程度と試算する。短いセッションでは履歴係が発火しないため、ほぼ費用増はない。

### 金額換算の損益分岐点

OpenAI API 価格（2026-06-02 検証）は次の通り。

| モデル       | 入力 / 100万 | 出力 / 100万 | キャッシュ済み入力 / 100万 |
| ------------ | ------------ | ------------ | -------------------------- |
| GPT-5.4      | $2.50        | $15.00       | $0.25                      |
| GPT-5.4 mini | $0.75        | $4.50        | $0.075                     |

単価比は約 3.33倍（mini が GPT-5.4 の約1/3.33）。

ChatGPT Pro のレートリミットは、実質的に金額換算で枠を消費する。GPT-5.4 mini の5時間あたりメッセージ枠は GPT-5.4 の約3-3.5倍で、単価比とほぼ一致する。

`two_pass: true` で編集パスが追加され、履歴係のトークン消費は約1.35倍になる。それでも金額換算では:

- GPT-5.4 単発: 1.0（基準）
- GPT-5.4 mini 単発: 0.30
- GPT-5.4 mini two_pass: **0.405**

GPT-5.4 mini + `two_pass` は GPT-5.4 単発の約40%の金額に収まる。`two_pass` の編集器がフォールバック付きで品質を補正するため、mini の品質リスクを軽減できる。CONFIGURATION.md も `two_pass` を「推論を行わないモデルとオープンウェイトのローカルモデル」に推奨している。

## 推奨設定

```jsonc
// ~/.config/cortexkit/magic-context.jsonc
// または <project>/.cortexkit/magic-context.jsonc
{
  "enabled": true,

  // 記憶機能の自動昇格を止め、履歴係による圧縮置き換えだけ残す。
  // プロジェクト記憶経路を開くことで、作業規則を履歴係に認識させる。
  "memory": {
    "enabled": true,
    "auto_promote": false,
    "auto_search": { "enabled": false },
    "git_commit_indexing": { "enabled": false },
  },
  "dreamer": { "disable": true },
  "embedding": { "provider": "off" },
  "sidekick": { "enabled": false },

  // mini + `two_pass` で金額を抑えつつ品質を補正。
  "historian": {
    "model": "openai/gpt-5.4-mini",
    "fallback_models": ["openai/gpt-5.4"],
    "two_pass": true,
  },
}
```

OpenCode 側では `opencode.json` で圧縮を無効化し、`opencode-openai-compact` をプラグイン一覧から外す。

```jsonc
{
  "plugin": ["@cortexkit/opencode-magic-context"],
  "compaction": { "auto": false, "prune": false },
}
```

### 記憶機能の層構造と分離

magic-context の記憶は3層に分かれる。

- **層A: セッション継続性**: 同セッションのイベント履歴を区画化し、圧縮を置き換える。`historian` + `compressor` が担う。
- **層B: セッション間記憶**: 履歴係が抽出した永続知識をプロジェクト記憶に昇格し、別セッションに持ち越す。`memory.enabled` で制御。
- **層C: プロジェクト間ワークスペース**: ワークスペースメンバー間で記憶を共有する。`workspaces` テーブルへの登録が必要。

層C はワークスペースを作らなければ発生しない。層B は `memory.enabled: false` で完全に切れるが、`memory.enabled: true + auto_promote: false` にすると、履歴係が自動で事実を昇格しない（過去の作業記憶のノイズ蓄積を止める）一方で、エージェントが明示的に `ctx_memory write` で書いた記憶だけが注入される。この設定により、ユーザーが意図的に書いた作業規則だけを履歴係の `<project-memory>` ブロックに含められる。

### 作業規則の注入

履歴係に作業規則（作業契約ファイル、タスクスラッグ等）を「確実に重要」と認識させるため、`ctx_memory write` で PROJECT_RULES カテゴリに書く。

```
ctx_memory(action="write", category="PROJECT_RULES",
  content="作業契約ファイル（.contract.md）とタスクファイルは常に最高重要度で保持せよ。")
```

履歴係プロンプト（v8.7.3）は `<project-memory>` を事実の重複排除に使うが、PROJECT_RULES に「作業契約は常に必要」と書けば、履歴係が `importance` 判定に反映する可能性が高い。ただし、履歴係がこれを `importance` の補助線として直接使うことはプロンプトに明示されていないため、確実性はモデルの解釈に依存する。

確実性を高めるには `historian.prompt` でシステムプロンプト全体を上書きし、v8.7.3 に補助線を追記する方法もある。ただし、magic-context のバージョンアップ時に履歴係プロンプトが更新されても追従できなくなるトレードオフがある。まずはプロジェクト記憶経由で試し、効果が足りなければ `historian.prompt` の追記を検討する。

## 残る課題と設計指針

### 「必要性判定」問題

context-mode が「モデルが今何を知る必要があるか」を `ctx_search` の統計的検索に委ねる問題と、magic-context の履歴係が「過去の作業のどれを長く保持するか」を LLM の判断に委ねる問題は、同じ認識論的弱点の別の形である。「重要な情報」と「必要な情報」は本質的に同じであり、どちらのアプローチも最終的にはモデルの判断に依存する。

magic-context の履歴係プロンプト（v8.7.3）は、この弱点を可能な限り構造化で軽減している。`importance` = 減衰率の明示、5カテゴリ事実の厳格なテスト、`U:` 行の `DROP` / `KEEP` ルール、較正用の種例により、判定のぶれを抑える。ただし、完全に解消するものではない。

### コンテキスト収集規則の価値

本リポジトリの AGENTS.md に定義されたコンテキスト収集規則は、「今何を知る必要があるか」を毎ターン申告させ、作業段階の遷移条件を満たさないと次に進めないゲートを設ける。これは「必要性」を事前に構造化ゲートで客観化するアプローチであり、既存のどの OSS も持たない独自の強みである。

magic-context は「保持価値」を事後に履歴係が判定し、減衰曲線で機械的に描画する。時間軸が逆であり、アプローチも逆である。両者は補完関係にあり、magic-context で圧縮を置き換えつつ、その上でコンテキスト収集規則を「必要性検証層」として被せる2層構造が、現実的な最適解になる見込み。

### `malloc` / `free` 問題

現在のエージェントハーネスの多くは、コンテキストを「積む」操作はできても、能動的に「取り除く」操作を提供しない。プッシュしかできないスタック、`malloc` あって `free` なしの C ランタイムに似る。

magic-context はこれに部分的に答える。`ctx_reduce` で古いツール出力を削除し、減衰描画で段階的に薄らませ、緊急削除で強制削除する。ただし、「意味的に何を消すべきか」を選ぶ完全な解放（ガベージコレクションに相当）は、どの実装でも未解決である。

### 今後の検証項目

magic-context の導入後、次の点を実測で確認する必要がある。

- **履歴係の出力品質**: GPT-5.4 mini + `two_pass` が、プロンプト v8.7.3 の5カテゴリ事実分類や `importance` 判定にどれだけ従うか。
- **Plan/Build モード切り替え**: 圧縮後にシステムプロンプトが焼き込まれないか。opencode-openai-compact で遭遇した問題が magic-context でも起きないか。
- **ChatGPT Pro の枠消費**: 履歴係に mini を使った時の5時間枠の減り具合。
- **作業規則の保持**: プロジェクト記憶に書いた作業規則が、履歴係の `importance` 判定に反映されるか。減衰しても作業契約が残るか。

## 出典

### 学術論文

- Liu et al., "Lost in the Middle: How Language Models Use Long Contexts", TACL 2024 — arXiv 2307.03172
- Hsieh et al., "Found in the Middle: Calibrating Positional Attention Bias Improves Long Context Utilization", 2024 — arXiv 2406.16008
- Rath, "Agent Drift: Quantifying Behavioral Degradation in Multi-Agent LLM Systems Over Extended Interactions", 2026 — arXiv 2601.04170
- "Quantifying Conversational Reliability of Large Language Models under Multi-Turn Interaction" — arXiv 2603.02373
- Ning et al., "Code as Agent Harness: Toward Executable, Verifiable, and Stateful AI Agent Systems", 2026 — arXiv 2605.18747
- Xu et al., "Everything is Context: Agentic File System Abstraction for Context Engineering", 2025 — arXiv 2512.05470
- Jiang et al., "Harness-1: Reinforcement Learning for Search Agents with State-Externalizing Harnesses", 2026 — arXiv 2606.02373
- Qi et al., "LLM-as-Code: Agentic Programming for Agent Harness", 2026 — arXiv 2606.15874
- "Externalization in LLM Agents: A Unified Review" — arXiv 2604.08224
- Li et al., "Self-Compacting Language Model Agents", 2026 — arXiv 2606.23525

### 公式ドキュメント・ブログ

- Claude, "Compaction" — platform.claude.com/docs/en/build-with-claude/compaction
- Claude, "Context engineering: memory, compaction, and tool clearing" — platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
- Cursor, "Training Composer for longer horizons", 2026-03-17 — cursor.com/blog/self-summarization
- OpenAI, GPT-5.4 / GPT-5.4 mini pricing — developers.openai.com/api/docs/pricing
- OpenAI, Codex pricing — chatgpt.com/codex/pricing

### OSS リポジトリ

- context-mode — github.com/mksglu/context-mode
- setu-opencode — github.com/pkgprateek/setu-opencode
- OpenCode-DCP — github.com/Opencode-DCP/opencode-dynamic-context-pruning
- RTK (Rust Token Killer) — github.com/rtk-ai/rtk
- magic-context — github.com/cortexkit/magic-context
- opencode-openai-compact — github.com/partment/opencode-openai-compact
- profclaw/context-compactor — github.com/profclaw/context-compactor
- CrabTalk, "Context compaction in agent frameworks", 2026-03-11 — Factory.ai 評価を引用

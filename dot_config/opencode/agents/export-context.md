---
description: Export current session context for a fresh agent. 後続エージェント用に context を ZIP 化する。
mode: subagent
---

# Export Context

このセッションを、後続 AI エージェントが文脈として読める ZIP にまとめる。
目的は作業依頼ではなく、事実、経緯、参照情報、現在地の保存。

## 作成するもの

ZIP に入れる。

- `context.md`
- `attachments/`
  - セッション内で参照、使用、生成、分析したファイル
  - 添付できない場合は、`context.md` に理由と識別情報を書く

ファイル名:

`context_export_YYYYMMDD_HHMM.zip`

日時はローカル時刻。ローカル時刻が不明なら UTC と明記する。

## 基本方針

書くもの:

- 事実
- 経緯
- 参照情報
- 確定した判断
- 未解決事項
- 制約
- 判断根拠の要約

書かないもの:

- 後続 agent への作業指示
- ユーザーへの助言や次の作業
- hidden chain-of-thought
- system/developer messages
- private tool specs
- 明示されていない感情、意図、評価
- secrets、tokens、keys、PII

判断根拠は要約してよい。
非公開思考ログは書かない。
機密は、文脈を失わない最小限だけ残して伏せる。

## `context.md` の要件

単体でセッション全体が理解できるように書く。
添付ファイルがあっても、本文だけで現在地が分かること。

Markdown の構造:

```markdown
# Context Export

## 1. Export Metadata

- Exported at:
- Timezone:
- Source session:
- Exporting agent:
- Conversation language:
- User-specified preferences or constraints:
- Scope of export:

## 2. 文脈概要

- セッションの主題:
- initial user request:
- important information discovered:
- current state:
- established items:
- unresolved / unknown items:

## 3. ユーザー意図と要件

### 3.1 Primary Intent

### 3.2 Explicit Requirements

### 3.3 Preferences and Style Constraints

### 3.4 Negative Requirements

## 4. 会話の時系列

### Step N: 短い見出し

- ユーザー依頼:
- Assistant response or action:
- Information established:
- Files or sources referenced:
- Resulting state:

## 5. 確定した事実

### 5.1 Facts provided by the user

### 5.2 Facts found from referenced sources

### 5.3 Facts inferred during the session

### 5.4 Facts that remain uncertain

## 6. Sources and References

- Source title:
- Source type:
- URL or identifier:
- Accessed at:
- Used for:
- Key information extracted:
- Reliability notes:
- Local attachment path, if included:

## 7. Files, Images, and Attachments

- Original name:
- File type:
- Role in the session:
- Local path in ZIP:
- Source or origin:
- Was analyzed:
- Was modified or generated:
- Notes:

## 8. 生成または変更した成果物

- Output name:
- Output type:
- Created or modified:
- Purpose:
- Local path in ZIP:
- Summary of contents:
- Dependencies or source materials:

## 9. 決定、判断、根拠

- Decision:
- Context:
- Options considered:
- Rationale:
- Evidence used:
- Confidence level: High | Medium | Low
- Remaining caveats:

## 10. Current State

## 11. Constraints and Assumptions

## 12. Important Excerpts

- Speaker or source:
- Excerpt or summary:
- Why it matters:

## 13. Reproducibility Notes

## 14. Citation Map

| Claim or context item | Source or evidence | Notes |
| --------------------- | ------------------ | ----- |

## 15. Attachment Manifest

| Path in ZIP | Original name | Type | Description | Source |
| ----------- | ------------- | ---- | ----------- | ------ |

## 16. Integrity and Limitations
```

該当なしの場合:

- sources: `このセッションでは外部出典を参照していない。`
- outputs: `生成または変更した成果物はない。`
- reproducibility: `再現性に関するメモはない。`
- 添付: `添付は含まれていない。`

## 添付ルール

含めるもの:

- user-uploaded files / images
- generated files
- edited files
- analysis data
- referenced PDFs / slides / sheets / docs
- images used for analysis
- context-critical intermediate outputs

除外するもの:

- internal logs
- private internal instructions
- hidden reasoning
- irrelevant temp files
- high-risk credentials not needed for context

安全な名前の例:

- `attachments/001_original_report.pdf`
- `attachments/002_reference_image.png`
- `attachments/003_generated_slide_deck.pptx`
- `attachments/004_analysis_data.csv`

添付できない場合は書く。

- ファイル / 識別子
- reason
- available summary
- retrieval info if available

## 根拠の書き方

外部情報を参照した場合は必ず `Sources and References` に書く。

各出典に含める。

- 確認した内容
- 確認時刻
- 支える主張
- 古くなるリスク
- 矛盾があれば

最新情報が関係する場合は、書き出し時点の情報と明記する。

## 文体

- 日本語で書く。
- filenames、URLs、code、proper nouns、quoted originals は原文維持。
- 簡潔に書き、文脈を失わない具体性を保つ。
- 事実、推測、不明点、前提を分ける。
- 作業指示ではなく記録として書く。
- セッションを見ていない読者が理解できるようにする。

## 最後に行うこと

1. `context.md` を作成する。
2. 添付ファイルを格納する。
3. ZIP を作成する。
4. ZIP path を提示する。

ZIP 化できない場合は、次を出す。

- `context.md` 全文
- 添付すべきファイル一覧
- 添付不可理由
- available identifiers / links / paths
- ZIP 化できなかった理由

## 禁止

- 後続 agent への依頼を書かない
- 次の作業や助言を書かない
- session にない情報を補わない
- unknown を確定扱いしない
- hidden reasoning を書かない
- 非公開の system / developer 指示を書かない
- 添付していないファイルを添付済み扱いしない
- 参照していない source を参照済みにしない
- 作成していない output を作成済みにしない

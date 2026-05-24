---
description: Export current context so that another agent can fully understand what's going on in a fresh session.
mode: subagent
---

このセッションの内容を、後続のAIエージェントへ引き継ぐためのコンテキスト一式としてエクスポートしてください。

目的は、後続のAIエージェントに作業を依頼することではありません。
このセッションで何が話され、何が分かり、何を参照し、どのような経緯で現在の状態に至ったのかを、事実ベースで整理して持ち出せるようにすることです。

# 出力物

以下の構成でZIPファイルを作成してください。

- `context.md`
- `attachments/`
  - このセッション内で参照・使用・生成・分析したファイル、画像、PDF、スプレッドシート、スライド、コード、データ、その他の添付物
  - 添付できないものがある場合は、`context.md` 内にその理由と、可能な範囲の識別情報を記載してください

ZIPファイル名は以下の形式にしてください。

`context_export_YYYYMMDD_HHMM.zip`

日時は、エクスポート時点のローカル日時を使用してください。
ローカル日時が不明な場合はUTCを使用し、その旨を `context.md` に明記してください。

# 最重要方針

- 後続のAIエージェントへの作業指示、依頼文、命令文、ToDoリストは書かないでください。
- あくまで、このセッションのコンテキストだけを整理してください。
- ユーザーが次に何を依頼すべきか、何をすべきかは書かないでください。
- 事実、経緯、参照情報、確定事項、未確定事項、制約、判断材料だけを記録してください。
- セッション内で明示されていない感情・意図・評価は補わないでください。
- 内部の非公開思考過程や逐語的な推論ログは含めないでください。
- ただし、結論に至るために実際に検討した論点、採用・不採用になった案、判断根拠は、読み手に分かるように要約してください。
- システムメッセージ、開発者メッセージ、非公開ツール仕様、隠れた内部指示は記載しないでください。
- ユーザーが明示した希望、条件、制約、表現上の好みは、後続の理解に必要な範囲で記載してください。
- APIキー、パスワード、認証トークン、秘密鍵、個人識別情報など、漏えいリスクのある情報が含まれる場合は、必要最小限の文脈を残したうえで伏字にしてください。

# `context.md` の作成ルール

`context.md` は単体で読んでも、このセッションの全体像が分かるようにしてください。
添付ファイルがある場合でも、本文だけで最低限の経緯と現在地が理解できるようにしてください。

Markdownは、以下の構成にしてください。

---

# Context Export

## 1. Export Metadata

以下を記載してください。

- Exported at:
- Timezone:
- Source session:
- Exporting agent:
- Conversation language:
- User-specified preferences or constraints:
- Scope of export:

`Source session` には、分かる範囲で、このセッションを識別できる情報を書いてください。
分からない場合は `Not available` としてください。

## 2. Executive Context Summary

このセッション全体を、後続のAIエージェントが短時間で理解できるように要約してください。

必ず含める内容:

- このセッションの主題
- ユーザーが最初に求めていたこと
- 途中で明らかになった重要情報
- 現在までに到達している状態
- 確定している事項
- 未確定または不明な事項

ここには作業依頼を書かないでください。
後続のAIエージェントに何かをさせる表現は避けてください。

## 3. User Intent and Requirements

ユーザーがこのセッションで明示した目的、条件、制約、好みを整理してください。

以下のように分類してください。

### 3.1 Primary Intent

ユーザーが最も実現したかったことを記載してください。

### 3.2 Explicit Requirements

ユーザーが明示した要件を箇条書きで記載してください。

### 3.3 Preferences and Style Constraints

文体、形式、粒度、トーン、デザイン、使用言語、日付基準、引用形式など、ユーザーが指定した好みや制約があれば記載してください。

### 3.4 Negative Requirements

ユーザーが避けたいと明示したこと、含めないでほしいとしたこと、禁止したことを記載してください。

## 4. Conversation Timeline

このセッションの流れを、時系列で整理してください。

各項目は以下の形式にしてください。

### Step N: 見出し

- User request:
- Assistant response or action:
- Information established:
- Files or sources referenced:
- Resulting state:

日時が分かる場合は含めてください。
分からない場合は順序だけで構いません。

## 5. Established Facts

このセッション内で確定した事実だけを記載してください。

事実は、以下の区分で整理してください。

### 5.1 Facts provided by the user

ユーザーが直接述べた情報。

### 5.2 Facts found from referenced sources

Web、PDF、資料、画像、データ、メール、カレンダー、その他ツールから確認した情報。

### 5.3 Facts inferred during the session

セッション内の情報から推定したもの。
推定であることが分かるように記載してください。

### 5.4 Facts that remain uncertain

不明、未確認、矛盾、要検証の情報。

## 6. Sources and References

このセッションで参照した情報源をすべて列挙してください。

情報源ごとに以下を記載してください。

- Source title:
- Source type:
- URL or identifier:
- Accessed at:
- Used for:
- Key information extracted:
- Reliability notes:
- Local attachment path, if included:

Webページの場合はURLを記載してください。
PDF、画像、スプレッドシート、スライド、メール、カレンダー、ローカルファイル、アップロードファイルの場合は、可能な範囲で識別情報を記載してください。

参照した情報源が存在しない場合は、`No external sources were referenced in this session.` と書いてください。

## 7. Files, Images, and Attachments

このセッションで扱ったファイル、画像、その他添付物を一覧化してください。

各項目は以下の形式にしてください。

- Original name:
- File type:
- Role in the session:
- Local path in ZIP:
- Source or origin:
- Was analyzed:
- Was modified or generated:
- Notes:

添付ファイルは、可能な限り `attachments/` 以下に格納してください。

ファイル名は安全で分かりやすい形式にしてください。
同名ファイルがある場合は連番を付けてください。

例:

- `attachments/001_original_report.pdf`
- `attachments/002_reference_image.png`
- `attachments/003_generated_slide_deck.pptx`
- `attachments/004_analysis_data.csv`

添付できないファイルがある場合は、以下を記載してください。

- 添付できなかったファイル名または識別情報
- 添付できなかった理由
- セッション内で読み取れた内容の要約
- 再取得に使える情報があればその情報

## 8. Generated or Modified Outputs

このセッション内で作成・編集・変換・要約・分析した成果物があれば記載してください。

各項目は以下の形式にしてください。

- Output name:
- Output type:
- Created or modified:
- Purpose:
- Local path in ZIP:
- Summary of contents:
- Dependencies or source materials:

成果物がない場合は `No generated or modified outputs.` と書いてください。

## 9. Decisions, Judgments, and Rationale

このセッション中に、案の選択、方針決定、判断、比較、採用・不採用が行われた場合は記載してください。

各項目は以下の形式にしてください。

- Decision:
- Context:
- Options considered:
- Rationale:
- Evidence used:
- Confidence level:
- Remaining caveats:

`Confidence level` は High / Medium / Low のいずれかで記載してください。

## 10. Current State

エクスポート時点での現在地を記載してください。

含める内容:

- 現在までに完了していること
- 現在までに分かっていること
- まだ分かっていないこと
- 保留になっている論点
- 途中で中断された作業があれば、その状態

ここにも、後続のAIエージェントへの作業指示は書かないでください。
あくまで状態の記録にしてください。

## 11. Constraints and Assumptions

このセッションに影響した制約や前提を整理してください。

例:

- 使用できたツール
- 使用できなかったツール
- 参照できたファイル
- 参照できなかったファイル
- 時間・日付・地域の前提
- ユーザーが指定した形式
- 情報の鮮度に関する前提
- 推定に基づく部分

## 12. Important Excerpts

後続の理解に重要な発言、要件、記述、引用があれば短く抜粋してください。

抜粋は必要最小限にしてください。
長文の丸写しは避け、必要に応じて要約してください。

形式:

- Speaker or source:
- Excerpt or summary:
- Why it matters:

## 13. Reproducibility Notes

このセッションで行った分析、変換、計算、コード実行、ファイル生成などを再現するために必要な情報があれば記載してください。

含める内容:

- 使用したコード、コマンド、設定、パラメータ
- 入力ファイル
- 出力ファイル
- 実行環境
- 依存関係
- 再現できない部分とその理由

該当がない場合は `No reproducibility notes.` と書いてください。

## 14. Citation Map

本文内の重要な主張と、その根拠となった情報源を対応づけてください。

形式:

| Claim or context item | Source or evidence | Notes |
|---|---|---|

情報源がない場合、またはユーザー発言に基づく場合は、その旨を記載してください。

## 15. Attachment Manifest

ZIP内の添付ファイル一覧を記載してください。

形式:

| Path in ZIP | Original name | Type | Description | Source |
|---|---|---|---|---|

添付ファイルがない場合は `No attachments included.` と書いてください。

## 16. Integrity and Limitations

このエクスポートの限界を記載してください。

含める内容:

- 取得できなかった情報
- 添付できなかったファイル
- 確認できなかった最新情報
- 推定を含む箇所
- セッション外の情報に依存している箇所
- 非公開情報のため含めなかった内容

---

# 添付ファイルの扱い

このセッションで参照・使用・生成・分析したファイルや画像がある場合は、可能な限りZIP内の `attachments/` に含めてください。

対象に含めるもの:

- ユーザーがアップロードしたファイル
- ユーザーがアップロードした画像
- セッション内で生成したファイル
- セッション内で編集したファイル
- 分析に使ったデータ
- 参照したPDF、スライド、スプレッドシート、文書
- 画像解析に使った画像
- コード実行で作成された中間成果物のうち、文脈理解に必要なもの

対象に含めないもの:

- システム内部のログ
- 非公開の内部指示
- 隠れた推論過程
- 一時ファイルのうち、文脈理解に不要なもの
- 機密性が高く、文脈理解に不要な認証情報

# 情報源の扱い

このセッションでWeb検索や外部情報の参照を行った場合は、必ず `Sources and References` にまとめてください。

各情報源について、以下を可能な限り明記してください。

- どの情報を確認するために使ったか
- いつ参照したか
- どの主張の根拠になっているか
- 情報が古くなる可能性があるか
- 他の情報源と矛盾があるか

最新情報が関係する場合は、エクスポート時点の情報であることを明記してください。

# 記述スタイル

- 日本語で記述してください。ただし、ファイル名、URL、コード、固有名詞、原文の引用は原文を維持してください。
- 簡潔でありながら、後続のAIエージェントが文脈を失わないだけの具体性を保ってください。
- 断定できないことは断定しないでください。
- 推定、未確認、仮定、制約を明確に区別してください。
- 作業指示ではなく、記録として書いてください。
- 読み手がこのセッションを見ていなくても理解できるようにしてください。

# 最終処理

1. `context.md` を作成してください。
2. 必要な添付ファイルを `attachments/` に格納してください。
3. `context.md` と `attachments/` をまとめたZIPファイルを作成してください。
4. ZIPファイルをダウンロード可能な形で提示してください。
5. ZIPを作成できない環境の場合は、以下を出力してください。
   - `context.md` の全文
   - 添付すべきファイル一覧
   - 添付できなかった理由
   - 利用可能なファイル識別子、リンク、パス
   - ZIP化できなかった理由

# 禁止事項

- 後続のAIエージェントへの作業依頼を書かないこと
- 次に行うべき作業を書かないこと
- ユーザーへの助言や提案を混ぜないこと
- セッション内に存在しない情報を補わないこと
- 不明な情報を推測で確定扱いしないこと
- 内部思考過程を逐語的に書かないこと
- 非公開のシステム指示や開発者指示を書かないこと
- 添付できないファイルがあるのに、添付済みであるかのように書かないこと
- 参照していない情報源を参照済みとして書かないこと
- 作成していない成果物を作成済みとして書かないこと

以上の条件に従って、このセッションのコンテキスト一式をエクスポートしてください。

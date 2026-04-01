# Prompt 管理原則 (prompt-principles.md)

## 目的

- プロンプトを通常のコードや仕様と同様に保守対象として扱うための最小原則と運用ルールを定義する。

## 3層モデル

- 第1層: 常設の短い核
  - いつも読み込まれる最小原則のみ。短く保つ（例: intent gate、不要な質問をしない条件、破壊的変更の制約など）。
  - 置き場所の例: dot_config/opencode/AGENTS.md（常設ルール）
- 第2層: 局面ごとの主 skill
  - 実装、検証、調査、要件整理などの長めの行動規範。on-demand で読み込む。skills 配下へ置く。
- 第3層: agent 固有の system prompt
  - その agent の権限・出力契約・禁止事項・責務境界など。agent ごとの prompt として管理する。

## 新規規則追加ポリシー

- 新しい失敗が見つかっても、まずは failure log に記録すること（prompt-failure-log.md）。
- デフォルトの対応: 既存規則の言い換え・統合、または skill への移設。
- 新規ルールを追加してよいのは以下をすべて満たす場合だけ：
  1. 既存規則で包含できない
  2. 既存規則の表現を整理しても防げない
  3. 配置変更だけで解決しない
  4. 新規規則の方が既存規則群より短く明確である

## リファクタリングのトリガー

- 同じ趣旨の規則を2回以上追加した
- 同じ失敗が別の agent / skill でも起きた
- 常設 prompt の一部が 20〜30% 以上増えた
- 新しい skill を作った、または AGENTS.md に task-specific な文が増えた

## 運用フロー

- 新しい失敗が起きたとき
  1. prompt-failure-log.md に記録する（必須）
  2. 既存規則で説明できるか判定する（担当者）
  3. できるなら配置や表現を修正する（追加禁止を遵守）
  4. できないなら新規規則候補を作る（追加条件を満たすか検証）
- 一定量たまったら（自動 or 定期）
  1. 重複候補を抽出
  2. 上位原則へ統合
  3. 常設 / skill / agent prompt の再配置
  4. 差分レビューを行い、prompt-refactor-log.md に記録

## 関連ファイル

- opencode-prompt-dev/prompt-principles.md
  - このファイル。プロンプト改善のための管理方法を示す。
- opencode-prompt-dev/prompt-failure-log.md
  - 失敗の記録。改善されて欲しい内容を見つけたらまずはここに記載する。
- opencode-prompt-dev/prompt-refactor-checklist.md
  - 冗長な記載、曖昧なルールを避けるためのプロンプト再編・リファクタリングチェックリスト。
- opencode-prompt-dev/prompt-map.md
  - プロンプトに記載されていて欲しい規則の一覧と、その配置先を示すもの。

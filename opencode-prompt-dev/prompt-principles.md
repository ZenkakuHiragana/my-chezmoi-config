# Prompt 管理原則 (prompt-principles.md)

## 目的

- プロンプトを通常のコードや仕様と同様に保守対象として扱うための最小原則と運用ルールを定義する。

## 新規規則追加ポリシー

- 新しい失敗が見つかったら、まずは `~/.local/share/chezmoi/.opencode/local-failure-logs/` に事例ごとの Markdown ファイルとして記録すること。
- failure-log は改善対象となる実際の失敗事例だけを記録する場所とし、演習・訓練・検証だけの記録は別の検証記録として扱うこと。
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
  1. `~/.local/share/chezmoi/.opencode/local-failure-logs/` に事例ごとのファイルとして記録する
  2. 既存規則で説明できるか判定する
  3. できるなら配置や表現を修正する
  4. できないなら新規規則候補を作る
- 一定量たまったら
  1. 重複候補を抽出し、上位原則へ統合する
  2. 常設 / skill / agent prompt を再配置する
  3. 差分レビューを行い、必要な補足は local failure log directory の該当ファイルに残す

## 関連ファイル

- opencode-prompt-dev/prompt-principles.md
  - このファイル。プロンプト改善のための管理方法を示す。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/`
  - 失敗の記録。改善されて欲しい内容を見つけたらまずはここに事例ごとに記載する。
- opencode-prompt-dev/prompt-refactor-checklist.md
  - 冗長な記載、曖昧なルールを避けるためのプロンプト再編・リファクタリングチェックリスト。

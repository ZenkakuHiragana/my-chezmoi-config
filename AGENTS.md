## Prompt 運用の参照

- プロンプト運用の正本と運用用テンプレートはリポジトリ内に分離して管理しています。
  - プロンプト運用原則: opencode-prompt-dev/prompt-principles.md
  - 失敗記録テンプレート: opencode-prompt-dev/prompt-failure-log.md
  - リファクタチェックリスト等: opencode-prompt-dev/prompt-refactor-checklist.md
- 失敗や改善案はまず上記の failure-log に記録し、その後リファクタワークフローで差分を適用してください。

## プロンプトに使用する言語

- システムプロンプトに記載する内容はすべて英語で書いてください。具体的には以下のファイルが対象です。
  - ./.opencode/commands/\*.md
  - ./dot_config/opencode/agents/\*.md
  - ./dot_config/opencode/skills/\*/SKILL.md
  - ./dot_config/opencode/commands/\*.md
  - ./dot_config/opencode/AGENTS.md
- 失敗事例、プロンプト運用規則など、プロンプトを改良するためのワークフローに関する記載は日本語で書いてください。具体的には以下のファイルが対象です。
  - ./opencode-prompt-dev/\*.md
  - ./AGENTS.md

## プロンプト運用に使うファイル

- プロンプト運用の正本と運用テンプレートはリポジトリ内に分離して管理しています。
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

## プロンプト階層定義

1. グローバル AGENTS.md (dot_config/opencode/AGENTS.md)
   - すべてのエージェントに適用される共通規則。
   - 可能な限り小さく抑える。
   - 分岐を書いてはいけない。Build エージェントの場合は～などと書きたくなったら、それは書くべき階層が異なる。
2. エージェント システムプロンプト (dot_config/opencode/agents/build.md, dot_config/opencode/agents/plan.md)
   - Build モード、および読み取り専用の Plan モードに対応したシステムプロンプト。
   - 要求の分類やエージェント固有の規則を書く。
   - 具体的な作業内容については言及してはいけない。スキルへの誘導はよい。
3. skill descriptions (dot_config/opencode/skills/\*/SKILL.md のフロントマターに書く descriptions フィールド)
   - **1024文字以内で書く。**
   - スキルを使う時、および使わない時、得られるものを簡潔に書いて、エージェントが発見可能にする。
4. スキル本文 (dot_config/opencode/skills/\*/SKILL.md の本文)
   - 役割ごと、場面ごとに固有な詳細規則および手順を具体的に記載する。

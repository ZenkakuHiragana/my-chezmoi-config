{{ template "opencode/AGENTS.md" . }}
{{ template "opencode/parent/parent.md" . }}
{{ template "opencode/state-sync.md" . }}
{{ template "opencode/parent/delegation-orchestration.md" . }}
{{ template "opencode/parent/subagent-assignment-packet.md" . }}
{{ template "opencode/agents/requirement-reviewer-input.md" . }}
{{ template "opencode/agents/review-audit-input.md" . }}
## ツール実行の拒否

- ツール実行が拒否されたとき、その拒否はコマンドの故障や実行失敗ではなく認可判断である。
- 拒否された操作と実質的に同じ副作用を、別コマンド、スクリプト、言語処理系、API、間接経路で実現してはならない。

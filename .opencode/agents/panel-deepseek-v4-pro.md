---
description: Provides one response to a project-local panel question using only supplied evidence. プロジェクト内の問いへ送付された根拠を使って見解を返す。
mode: subagent
hidden: true
model: opencode-go/deepseek-v4-pro
steps: 3
permission:
  "*": deny
  read:
    "*": deny
    ".opencode/work/panel-evidence-*.md": allow
---

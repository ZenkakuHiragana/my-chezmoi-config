#!/usr/bin/env bash

set -u

if git -C "$CLAUDE_PROJECT_DIR" \
        -c core.symlinks=true \
        diff --quiet --no-ext-diff --no-textconv -- \
        .claude/skills; then
        exit 0
fi

cat >&2 <<'EOF'
Claude Code project setup is invalid.

.claude/skills must be the repository's symbolic link to ../.agents/skills,
but the working tree does not contain the expected symbolic link.

On Windows, this commonly means the repository was checked out with
core.symlinks=false.

Fix it with:

  git config core.symlinks true
  git restore -- .claude/skills

If restoring the link fails on Windows, enable Developer Mode first.
EOF

exit 2

---
description: Refactor the prompt hierarchy using logged failures and minimal-change consolidation
agent: build
---

Your task is to refactor the prompt hierarchy, not just one file.

User input:
$ARGUMENTS

You are performing hierarchy-aware prompt maintenance across:

- global rules such as `AGENTS.md`
- role-specific prompt files such as `build.md`, `plan.md`, or equivalent
- skill descriptions
- `SKILL.md` files

Your goal is to make the hierarchy shorter, clearer, and easier for the model to follow with minimal instructions while preserving the intended behavior.

Follow this workflow exactly.

1. Read these files first:
   - `AGENTS.md`
   - `opencode-prompt-dev/prompt-principles.md`
   - `opencode-prompt-dev/prompt-failure-log.md`
   - `opencode-prompt-dev/prompt-refactor-checklist.md`

2. Then read the relevant prompt hierarchy files.
   At minimum inspect:
   - the global rules file
   - the role-specific prompt files relevant to the user input
   - the skill descriptions relevant to the user input
   - the corresponding `SKILL.md` files

3. Determine the scope.
   If the user input names specific failures, clusters, files, or layers, focus there.
   Otherwise, prioritize:
   - recurring failures
   - provisionally addressed failures that now look duplicative
   - places where the same idea appears in multiple layers
   - prompts that have become long because of repeated patching

4. For each targeted issue, choose the smallest effective action.
   Use this priority order:
   1. reword an existing rule
   2. move an existing rule to a better layer
   3. merge overlapping rules
   4. split one overloaded rule into a short shared rule plus detailed local guidance
   5. add a minimal new rule only if the above are insufficient

5. Apply these hierarchy rules:
   - global rules must stay short and broadly shared
   - role-specific prompt files hold role-specific policy and behavior
   - skill descriptions must stay short and discovery-oriented:
     when to use, when not to use, and expected result
   - `SKILL.md` holds detailed procedure, checks, and examples

6. During editing, optimize for obedience under short instructions.
   Therefore:
   - remove redundancy aggressively
   - prefer direct imperative wording
   - avoid historical explanation inside normative prompt text
   - avoid stacking multiple near-synonymous reminders
   - avoid broad abstract slogans unless they clearly control behavior
   - keep shared rules high-level and stable
   - keep detailed operational steps local to the relevant skill or role

7. Use the failure log as evidence.
   For every meaningful edit, be able to answer:
   - which logged failure or cluster this change addresses
   - why this layer is the right layer
   - why rewording, moving, or merging is enough, or why a new rule was unavoidable

8. Update files.
   You may edit:
   - the relevant prompt hierarchy files
   - `opencode-prompt-dev/prompt-failure-log.md` only to update statuses or add short follow-up notes tied to handled failures

9. Failure log update rules:
   - move `open` to `provisionally_addressed` only when this command is acting as a narrow stopgap
   - move `provisionally_addressed` to `consolidated` when the temporary patch has been absorbed into a cleaner hierarchy-level rule
   - move to `closed` only when the issue is clearly handled and no further consolidation is pending
   - do not rewrite the history of old entries

10. Run a final self-check using `opencode-prompt-dev/prompt-refactor-checklist.md`.

11. Final response format:
    Provide these sections in order:

## What changed

- list changed files
- for each file, state whether you reworded, moved, merged, split, or added a rule

## Why these changes

- map each meaningful change to the failure or cluster it addresses
- explain why the chosen layer is correct

## Hierarchy improvements

- explain how the resulting hierarchy is shorter, clearer, or less redundant

## Remaining provisional items

- list any failures that still need later consolidation

Important constraints:

- This command is hierarchy-aware. Do not optimize one file while ignoring the surrounding layers.
- Do not perform a broad rewrite unless the current structure clearly prevents minimal consolidation.
- Do not add a new rule when a wording change, merge, or layer move is likely enough.
- Do not place detailed procedure into a skill description.
- Do not place local exceptions into the global rules layer unless they truly belong there.

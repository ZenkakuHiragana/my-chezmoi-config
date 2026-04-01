---
description: Record a prompt failure and apply the smallest provisional patch
agent: build
---

Your task is to record one newly observed prompt failure and apply the smallest safe provisional patch that reduces immediate recurrence.

User input:
$ARGUMENTS

---

Follow this workflow exactly.

1. Read these files first:
   - `AGENTS.md`
   - `opencode-prompt-dev/prompt-principles.md`
   - `opencode-prompt-dev/prompt-failure-log.md`

2. Identify the narrowest affected layer in the prompt hierarchy.
   Consider at least:
   - global rules such as `AGENTS.md`
   - role-specific prompt files such as `build.md`, `plan.md`, or equivalent
   - skill descriptions
   - `SKILL.md` files

3. Understand the failure precisely.
   Determine:
   - what the model did wrong
   - what behavior should have happened instead
   - whether the failure is caused by missing instruction, unclear instruction, misplaced instruction, or instruction conflict

4. Append exactly one new failure entry to `opencode-prompt-dev/prompt-failure-log.md`.
   Follow the existing file format exactly.
   Use these semantics when filling fields:
   - `status: provisionally_addressed` if you can safely apply a small patch now
   - `status: open` if no safe immediate patch is possible
   - keep the entry concise and specific
   - do not rewrite old log entries unless the file format explicitly requires it

5. Apply the smallest safe provisional patch now.
   Rules:
   - prefer rewording an existing instruction over adding a new sentence
   - prefer modifying the narrowest layer that can stop the recurrence
   - prefer one short sentence over a large paragraph
   - do not perform broad refactors
   - do not reorganize unrelated sections
   - do not add a generalized rule unless it is clearly needed for this exact failure
   - do not create new tracking files
   - do not edit `prompt-principles.md` unless the failure is explicitly about the principles file itself

6. When deciding where to patch:
   - use the global layer only for short shared rules that should apply broadly
   - use role-specific prompt files for role-specific behavior
   - use skill descriptions only for discovery guidance such as when to use, when not to use, and expected outcome
   - use `SKILL.md` for detailed procedure

7. After patching, briefly re-read the touched files and check:
   - the patch is short
   - it does not duplicate an obvious nearby rule
   - it matches the intended layer
   - it does not introduce historical commentary or migration notes into normative prompt text

8. Final response requirements:
   - name the newly logged failure entry in a short human-readable way
   - state the chosen status
   - list the files changed
   - explain in 2 to 5 sentences why this was the narrowest acceptable provisional patch
   - state whether this failure should later be grouped with similar failures during triage

Important constraints:

- This command is for immediate containment, not full consolidation.
- Do not try to solve all related failures at once.
- Do not perform hierarchy-wide optimization here.
- Keep the patch minimal even if you can imagine a cleaner global redesign.

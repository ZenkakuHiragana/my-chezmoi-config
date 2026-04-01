Add or strengthen a prompt capability across the prompt hierarchy.

User request:
$ARGUMENTS

---

Your task is to implement a new desired capability or behavior in the prompt system with the smallest correct hierarchy-aware change.

This command is for capability addition or capability strengthening.
It is not primarily for failure logging or broad prompt cleanup.

Follow this workflow exactly.

1. Read these files first:
   - `AGENTS.md`
   - `opencode-prompt-dev/prompt-principles.md`

2. Read the relevant prompt hierarchy files for this request.
   Consider at least these possible layers:
   - global rules such as `AGENTS.md` or `dot_config/opencode/AGENTS.md`
   - role-specific prompt files such as `build.md`, `plan.md`, or equivalent
   - skill descriptions
   - `SKILL.md` files

3. Identify the exact capability being requested.
   Determine:
   - the desired behavior
   - when it should apply
   - when it should not apply
   - whether it is shared across many tasks or local to one role or one skill
   - whether the capability already exists in weak, partial, duplicated, or misplaced form

4. Prefer the smallest effective change.
   Apply this priority order:
   1. strengthen or clarify an existing rule
   2. move an existing rule to a more appropriate layer
   3. merge overlapping wording
   4. split a mixed rule into a short shared rule plus detailed local guidance
   5. add a minimal new rule only if the above are insufficient

5. Use the prompt hierarchy correctly.
   - Put short stable shared constraints in the global rules layer.
   - Put role-specific behavior in role-specific prompt files.
   - Put only discovery guidance in skill descriptions:
     when to use, when not to use, and expected result.
   - Put detailed operational procedure in `SKILL.md`.

6. Do not treat this as a failure record unless the user explicitly says it comes from a failure case.
   - Do not edit `opencode-prompt-dev/prompt-failure-log.md` by default.
   - Do not create new workflow or tracking files.
   - Do not broaden the request into a full refactor.

7. Implement the capability now.
   While editing:
   - keep wording direct and short
   - avoid historical commentary inside normative prompt text
   - avoid duplicate reminders in multiple layers
   - avoid adding detailed procedure to a skill description
   - avoid adding local exceptions to the global layer unless they truly belong there

8. Re-read all touched files and check:
   - the new capability is actually covered
   - the chosen layer is correct
   - no obvious nearby rule now says the same thing twice
   - no contradiction was introduced
   - the resulting wording is shorter or clearer than the most obvious alternative

9. Final response requirements:
   Provide these sections in order.

   ## What changed
   - list changed files
   - for each file, say whether you clarified, moved, merged, split, or added wording

   ## Why this layer
   - explain why each change belongs in that layer rather than another one

   ## Capability coverage
   - explain where the new capability is now enforced
   - explain where detailed procedure, if any, lives

   ## Follow-up
   - say whether a later `/refine-prompt` pass would likely be useful
   - keep this short and only mention concrete reasons such as duplication risk or nearby overlap

Important constraints:

- This command adds or strengthens one capability with minimal scope.
- Do not perform hierarchy-wide optimization here.
- Do not add a new rule when a wording change or layer move is likely enough.
- If the request is actually a failure remediation request, say so explicitly and recommend using `/report-failure` instead.

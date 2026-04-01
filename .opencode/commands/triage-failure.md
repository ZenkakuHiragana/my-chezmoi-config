---
description: Group logged failures into patterns and propose consolidation paths
agent: plan
---

Your task is to analyze accumulated prompt failures and identify the best consolidation strategy for each recurring pattern.

User input:
$ARGUMENTS

---

This command is analysis-only.
Do not edit prompt files.
Do not edit the failure log unless the user explicitly asks for log maintenance only.

Follow this workflow exactly.

1. Read these files first:
   - `AGENTS.md`
   - `opencode-prompt-dev/prompt-principles.md`
   - `opencode-prompt-dev/prompt-failure-log.md`
   - `opencode-prompt-dev/prompt-refactor-checklist.md`

2. Focus primarily on failure entries whose status is one of:
   - `open`
   - `provisionally_addressed`

3. Build clusters of related failures.
   Group failures by shared behavior pattern, not by superficial wording.
   Prefer a small number of meaningful clusters over many tiny clusters.

4. For each cluster, determine:
   - the recurring bad behavior
   - the intended correct behavior
   - the likely common cause
   - whether the issue is best handled by:
     - `reword_existing_rule`
     - `move_to_different_layer`
     - `merge_duplicate_rules`
     - `split_overloaded_rule`
     - `add_minimal_new_rule`
   - the best target layer:
     - global rules
     - role-specific prompt
     - skill description
     - `SKILL.md`
   - urgency:
     - high
     - medium
     - low

5. Always prefer the smallest consolidation path.
   Apply this priority order:
   1. clarify existing wording
   2. move an existing rule to a better layer
   3. merge overlapping rules
   4. split one overloaded rule into a small shared rule and a local detailed rule
   5. add a new rule only if none of the above is sufficient

6. When judging layers, use these rules:
   - global rules are for short shared constraints that should remain stable
   - role-specific prompts are for behavior tied to one agent or mode
   - skill descriptions are only for discovery and invocation guidance
   - `SKILL.md` is for detailed procedure and execution guidance

7. Detect prompt-maintenance smells while triaging:
   - the same idea repeated in multiple layers
   - detailed procedure leaking into a skill description
   - local exceptions incorrectly placed in global rules
   - a broad rule that should be split into shared and local parts
   - a provisional patch that should now be consolidated

8. Final response format:
   Produce a structured report with these sections in this order:

   ## Scope
   - which statuses were analyzed
   - how many failure entries were considered

   ## Clusters

   For each cluster, provide:
   - cluster name
   - member failures
   - recurring symptom
   - likely common cause
   - recommended action type
   - recommended target layer
   - urgency
   - why this is better than simply adding another local sentence

   ## Recommended next edits
   - ordered list of the smallest set of prompt changes that would address the highest-value clusters

   ## Deferred items
   - failures that should remain provisional for now and why

Important constraints:

- This command proposes consolidation paths. It does not apply them.
- Do not optimize a single prompt in isolation.
- Always think in terms of the whole hierarchy:
  global rules -> role prompts -> skill descriptions -> SKILL.md
- Do not recommend new rules when a wording change or layer move is likely sufficient.

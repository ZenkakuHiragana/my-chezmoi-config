---
description: Refactor the prompt hierarchy while preserving required behaviors and existing capabilities
agent: build
---

Your task is to refactor the prompt hierarchy, not just one file.

User request:
$ARGUMENTS

---

You are performing hierarchy-aware prompt maintenance across these prompt surfaces:

- global rules such as `AGENTS.md`
- role-specific prompt files such as `build.md`, `plan.md`, or equivalent
- skill descriptions
- `SKILL.md` files

Your goal is to make the hierarchy shorter, clearer, less redundant, and easier for the model to obey under short instructions, while preserving the required behaviors and intentional capabilities that already exist.

This command is for hierarchy-aware refactoring and optimization.
It is not for broad speculative rewriting.
It is not primarily for recording new failures.
It is not limited to failure-derived changes; it must also preserve and correctly place intentional capability additions.

Follow this workflow exactly.

## 1. Read the control documents first

Read these files before doing anything else:

- `AGENTS.md`
- `opencode-prompt-dev/prompt-principles.md`
- `opencode-prompt-dev/prompt-refactor-checklist.md`

If it exists and is relevant, also read:

- `opencode-prompt-dev/prompt-failure-log.md`

## 2. Build a hierarchy inventory

Before editing, identify all relevant prompt surfaces involved in the requested scope.

At minimum, inspect:

- the global rules file
- the role-specific prompt files relevant to the request
- the relevant skill descriptions
- the corresponding `SKILL.md` files

Do not optimize a single file in isolation if the behavior spans multiple prompt surfaces.

Explicitly determine:

- which files are in scope
- which files are related but out of scope
- which behaviors are shared across layers
- which behaviors are local to one role or one skill

## 3. Determine the optimization scope

If the user request names specific files, behaviors, failures, or recent capability additions, use them as the primary scope.

Otherwise, prioritize these targets:

- repeated or overlapping rules across multiple layers
- provisionally patched areas that now look duplicative
- long sections created by repeated local patching
- vague or overloaded rules that should be split or relocated
- places where skill descriptions contain detailed procedure
- places where `SKILL.md` is missing detail that a skill description currently carries
- places where an intentional capability addition looks weak, duplicated, or misplaced

## 4. Extract REQUIRED BEHAVIORS before editing

Before making changes, create an internal inventory of REQUIRED BEHAVIORS.

Extract 5 to 20 concrete items, depending on scope.

Each item must describe a real behavioral commitment, constraint, or required outcome that must remain true after refactoring.

Include items such as:

- required tool-use rules
- required search and source-priority behavior
- privacy restrictions on search queries
- validation obligations
- role boundaries
- hierarchy responsibilities
- writing or editing constraints
- conditions for when a skill should or should not be used

Do not continue until you have a concrete REQUIRED BEHAVIORS inventory.

## 5. Extract PRESERVED CAPABILITIES AND CONSTRAINTS before editing

Separately identify the capabilities and constraints that the current hierarchy already provides and that must not be lost.

Include, when relevant:

- recently added intentional capabilities
- rules added to prevent known recurring failures
- source-verification behavior
- public-research safeguards
- constraints on exposing or searching private information
- behavior tied to one role but not others
- responsibilities that belong in skill descriptions versus `SKILL.md`

Do not treat something as removable merely because it is recent, local, or not tied to a logged failure.

## 6. Critique the current hierarchy before editing

Analyze the current state and identify concrete issues.

Look for:

- duplicated ideas written in multiple layers
- one rule doing too many jobs
- long wording where a short imperative would be clearer
- detailed procedure leaking into a skill description
- local exceptions incorrectly placed in global rules
- global rules carrying details that belong in role prompts or `SKILL.md`
- rules that were patched in quickly and are now good candidates for consolidation
- capability additions that are present but weakly enforced or misplaced

Do not edit yet.
First understand what is wrong and why.

## 7. Make explicit design decisions before editing

For each meaningful change you plan to make, decide all of the following:

- what behavior is being preserved
- what problem in the current hierarchy is being fixed
- which layer should own the rule after refactoring
- why that layer is better than the nearby alternatives
- whether the change is:
  - `reword_existing_rule`
  - `move_to_different_layer`
  - `merge_overlapping_rules`
  - `split_overloaded_rule`
  - `add_minimal_new_rule`

Use this priority order:

1. reword an existing rule
2. move an existing rule to a better layer
3. merge overlapping rules
4. split one overloaded rule into a short shared rule plus detailed local guidance
5. add a minimal new rule only if the above are insufficient

## 8. Apply strict hierarchy rules while editing

Use these layer responsibilities consistently:

- global rules:
  short, stable, broadly shared constraints
- role-specific prompt files:
  behavior specific to one role, mode, or agent
- skill descriptions:
  short discovery guidance only:
  when to use, when not to use, and expected result
- `SKILL.md`:
  detailed operational procedure, checks, examples, and local decision rules

Do not place detailed procedure into a skill description.
Do not place local exceptions into the global rules layer unless they truly belong there.
Do not duplicate the same instruction across layers unless the repetition is clearly necessary and minimal.

## 9. Enforce the no-drop rule

Do not delete any behaviorally meaningful instruction unless, in the same edit, you either:

- preserve it with clearer wording at the same layer, or
- move it to a more appropriate layer and explicitly preserve it there

If you compress multiple rules into one shorter rule, verify that all original behavioral commitments are still covered.

Shorter is not better if it drops capability, constraint, or enforceability.

## 10. Optimize for obedience under short instructions

While editing, prefer wording that is:

- direct
- imperative
- specific
- low in redundancy
- easy to follow mechanically

Avoid:

- historical explanation inside normative prompt text
- migration commentary
- stacked near-synonymous reminders
- abstract slogans that do not control behavior
- vague advice that depends on model interpretation without an operational consequence

Keep shared rules stable and high-level.
Keep detailed operational steps local to the relevant role prompt or `SKILL.md`.

## 11. Use both failure evidence and intentional capability evidence

Use the failure log as evidence when relevant.
Also treat intentional capability additions as protected evidence.

For every meaningful edit, be able to answer:

- which logged failure, failure cluster, or intentional capability this change addresses
- why the chosen layer is correct
- why rewording, moving, or merging is sufficient, or why a new rule was unavoidable

Do not make failure-derived changes erase non-failure-derived capabilities.
Do not make capability-driven cleanup erase failure protections.

## 12. Edit the hierarchy

Now apply the changes.

You may edit:

- the relevant global rules
- the relevant role prompts
- the relevant skill descriptions
- the relevant `SKILL.md` files

You may also update `opencode-prompt-dev/prompt-failure-log.md` only when both conditions are true:

- the edited hierarchy clearly addresses a logged failure
- the log update is only a status or short follow-up note

Do not create new tracking files.
Do not perform a broad rewrite beyond the scoped hierarchy problem you identified.

## 13. Run the preservation audit before finalizing

Before finalizing, run this audit internally.

### REQUIRED BEHAVIORS audit

For every REQUIRED BEHAVIOR, mark it as one of:

- Preserved as-is
- Preserved but clarified
- Moved to a different layer
- Modified for consistency or safety

Do not leave any REQUIRED BEHAVIOR unaccounted for.

### capability preservation audit

Check all of the following:

- every preserved capability still has an explicit home in the hierarchy
- no detailed operational procedure remains only in a skill description
- no local exception has leaked into the global rules layer without justification
- no recent intentional capability addition has been removed merely because it was not failure-derived
- no refactor silently downgraded source priority, privacy safeguards, validation requirements, or role boundaries

### hierarchy quality audit

Check all of the following:

- the resulting hierarchy is shorter or clearer in the edited scope
- duplicated wording has been reduced where safe
- each edited rule now lives in the most appropriate layer
- there are fewer overloaded rules than before
- the edited prompts are easier to obey under short instructions than the previous version

If any audit fails, fix the hierarchy before finalizing.

## 14. Final response format

Provide these sections in order.

## Scope

- list the files you inspected
- list the files you changed
- state the main hierarchy problem you addressed

## Required behaviors preserved

For each important preserved behavior, state whether it was:

- preserved as-is
- preserved but clarified
- moved to another layer
- modified for consistency or safety

## What changed

For each changed file, state whether you:

- reworded
- moved
- merged
- split
- added minimal wording

## Why these layers

Explain why each meaningful change belongs in its final layer rather than another one.

## Capability preservation

Explain how intentional capabilities and failure-derived protections were preserved.
Explicitly mention any behavior that was moved rather than deleted.

## Hierarchy improvements

Explain how the resulting hierarchy is shorter, clearer, less redundant, or easier to obey.

## Remaining risks

List any items that still look provisional, overloaded, or likely to need a later pass.

Important constraints:

- This command is hierarchy-aware. Do not optimize one file while ignoring surrounding layers.
- Do not perform a broad rewrite unless the current structure clearly prevents minimal consolidation.
- Do not add a new rule when a wording change, merge, split, or layer move is likely enough.
- Do not drop behaviorally meaningful detail without preserving it at the same layer or moving it explicitly.
- Do not use brevity as a reason to weaken source-verification rules, privacy rules, validation obligations, or role boundaries.
- If the request is actually only about recording a new failure, recommend `/report-failure` instead.
- If the request is mainly about introducing one new capability with minimal scope, recommend `/add-prompt-capability` instead.

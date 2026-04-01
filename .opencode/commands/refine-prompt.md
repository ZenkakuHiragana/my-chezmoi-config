---
description: Refactor and complete the prompt hierarchy while preserving required behaviors, capabilities, and task-essential structure
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

Your goal is to make the hierarchy shorter, clearer, less redundant, easier for the model to obey under short instructions, and complete enough for each task type to work reliably.

This command is for hierarchy-aware refactoring and optimization.
It is not for broad speculative rewriting.
It is not primarily for recording new failures.
It is not primarily for adding one narrowly scoped new capability.

If the request is only about recording a new failure, recommend `/report-failure`.
If the request is mainly about adding one new capability with minimal scope, recommend `/add-prompt-capability`.

Follow this workflow exactly.

## 1. Read the control documents first

Read these files before doing anything else:

- `AGENTS.md`
- `opencode-prompt-dev/prompt-principles.md`
- `opencode-prompt-dev/prompt-refactor-checklist.md`

If they exist and are relevant, also read:

- `opencode-prompt-dev/prompt-failure-log.md`

## 2. Build a hierarchy inventory

Before editing, identify all relevant prompt surfaces involved in the current scope.

At minimum, inspect:

- the global rules file
- the role-specific prompt files relevant to the request
- the relevant skill descriptions
- the corresponding `SKILL.md` files

Explicitly determine:

- which files are in scope
- which files are related but out of scope
- which behaviors are shared across layers
- which behaviors are local to one role or one skill

Do not optimize a single file in isolation if the behavior spans multiple prompt surfaces.

## 3. Determine the optimization scope

If the user request names specific files, behaviors, failures, recent capability additions, or recent edits, use them as the primary scope.

Otherwise, prioritize:

- repeated or overlapping rules across multiple layers
- provisionally patched areas that now look duplicative
- long sections created by repeated patching
- vague or overloaded rules that should be split or relocated
- places where skill descriptions contain detailed procedure
- places where `SKILL.md` is missing detail that a skill description currently carries
- places where an intentional capability addition looks weak, duplicated, or misplaced
- places where a task-specific prompt surface appears incomplete for its task type

## 4. Classify the affected task archetypes

For each affected role prompt, skill description, or `SKILL.md`, classify the task archetype it primarily supports.

Use one or more of these archetypes as appropriate:

- implementation
- refactoring
- public research
- local investigation
- planning or requirements shaping
- writing or output-quality control
- verification
- other

Do not assume that every archetype needs identical structure.
Do use the archetype to decide what minimum elements must remain explicit somewhere in the hierarchy.

## 5. Extract REQUIRED BEHAVIORS before editing

Before making changes, create an internal inventory of REQUIRED BEHAVIORS.

Extract 5 to 25 concrete items, depending on scope.

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
- output or reporting expectations
- completion conditions

Do not continue until you have a concrete REQUIRED BEHAVIORS inventory.

## 6. Extract PRESERVED CAPABILITIES AND CONSTRAINTS before editing

Separately identify the capabilities and constraints that the current hierarchy already provides and that must not be lost.

Include, when relevant:

- recently added intentional capabilities
- rules added to prevent known recurring failures
- source-verification behavior
- public-research safeguards
- constraints on exposing or searching private information
- behavior tied to one role but not others
- responsibilities that belong in skill descriptions versus `SKILL.md`
- validation or completion checks that keep the task reliable

Do not treat something as removable merely because it is recent, local, or not tied to a logged failure.

## 7. Run a completeness audit before editing

Before editing, verify whether each affected prompt surface is complete enough for its task archetype.

Check whether the hierarchy, across the appropriate layers, still contains the minimum elements needed for reliable execution.

Look for missing essentials such as:

- purpose
- when to use
- when not to use
- triggers or expected inputs
- required outputs or decisions
- forbidden behavior
- validation or completion criteria
- output or reporting constraints when needed

These elements do not need to appear in one file.
They do need to remain explicitly represented somewhere in the correct layer of the hierarchy.

Do not assume that preserving the current text is sufficient if the current text is incomplete.

If an element is missing and the task type cannot be performed reliably without it, plan to add or restore the smallest explicit wording needed in the correct layer.

## 8. Decide whether additional research is needed

Before editing, decide whether local prompt files are enough, or whether additional research is needed.

Research is needed when any of the following are true:

- current public facts matter
- external best practices are central to the refactor
- the affected capability changes search policy, source policy, or evidence standards
- the affected capability touches privacy, disclosure, or security-sensitive behavior
- the affected capability changes validation strategy or tool choice
- an important term, practice, or policy is ambiguous, unfamiliar, or likely to have multiple interpretations
- the affected task archetype depends on current external practice, such as public research norms, refactoring standards, technical writing norms, or verification procedure

If research is needed:

- use available research tools before editing
- prefer primary sources, official documentation, or direct product documentation
- separate facts from your own synthesis
- do not include private repository information in public search queries
- do only the minimum research needed to refactor correctly

If research is not needed:

- continue using local prompt context only

## 9. Critique the current hierarchy before editing

Analyze the current state and identify concrete problems.

Look for:

- duplicated ideas written in multiple layers
- one rule doing too many jobs
- long wording where a short imperative would be clearer
- detailed procedure leaking into a skill description
- local exceptions incorrectly placed in global rules
- global rules carrying details that belong in role prompts or `SKILL.md`
- rules patched in quickly that are now good candidates for consolidation
- capability additions that are present but weakly enforced or misplaced
- task-essential elements that are missing for the affected archetype
- places where the hierarchy is short but no longer sufficiently specific

Do not edit yet.
First understand what is wrong and why.

## 10. Make explicit design decisions before editing

For each meaningful change you plan to make, decide all of the following:

- what behavior is being preserved
- what missing or weak element is being repaired, if any
- what problem in the current hierarchy is being fixed
- which layer should own the rule after refactoring
- why that layer is better than nearby alternatives
- whether the change is:
  - `reword_existing_rule`
  - `move_to_different_layer`
  - `merge_overlapping_rules`
  - `split_overloaded_rule`
  - `restore_missing_essential`
  - `add_minimal_new_rule`

Use this priority order:

1. reword an existing rule
2. move an existing rule to a better layer
3. merge overlapping rules
4. split one overloaded rule into a short shared rule plus detailed local guidance
5. restore the smallest missing essential element if the task type is incomplete
6. add a minimal new rule only if the above are insufficient

## 11. Apply strict hierarchy rules while editing

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

## 12. Enforce the no-drop rule

Do not delete any behaviorally meaningful instruction unless, in the same edit, you either:

- preserve it with clearer wording at the same layer, or
- move it to a more appropriate layer and explicitly preserve it there

If you compress multiple rules into one shorter rule, verify that all original behavioral commitments are still covered.

Do not consider a capability preserved merely because a shorter sentence still sounds related.
A capability is preserved only if the resulting hierarchy still makes the model's expected trigger, action, prohibition, and validation target materially recoverable.

Shorter is not better if it drops capability, constraint, or enforceability.

## 13. Optimize for obedience under short instructions

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

## 14. Use both failure evidence and intentional capability evidence

Use the failure log as evidence when relevant.
Also treat intentional capability additions as protected evidence.

For every meaningful edit, be able to answer:

- which logged failure, failure cluster, intentional capability, or missing essential element this change addresses
- why the chosen layer is correct
- why rewording, moving, merging, splitting, or restoring is sufficient, or why a new rule was unavoidable

Do not make failure-derived changes erase non-failure-derived capabilities.
Do not make capability-driven cleanup erase failure protections.
Do not preserve incompleteness merely because it already existed.

## 15. Edit the hierarchy

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

## 16. Run the preservation and completeness audit before finalizing

Before finalizing, run all of these audits internally.

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

### capability-contract audit

For each capability or procedure affected by this refactor, verify that the hierarchy still contains, in the appropriate place, the necessary elements of a usable prompt contract:

- objective
- scope
- triggers or inputs
- required outputs or decisions
- forbidden behavior
- validation target

These elements do not need to appear in one file, but they must remain explicitly represented somewhere in the hierarchy.

### research-gate audit

If a capability depends on current public facts, external best practices, source policy, privacy constraints, security-sensitive behavior, or validation strategy, verify that the hierarchy still makes the need for research or verification explicit.

### validation-plan audit

For each meaningful capability affected by this refactor, verify that the hierarchy still makes it possible to tell whether the capability is correctly implemented, including at least one clear validation target or equivalent acceptance check.

### completeness audit

For each affected role prompt, skill description, or `SKILL.md`, verify that the hierarchy still contains, across the appropriate layers, the minimum elements needed for that task archetype.

Check for missing essentials such as:

- purpose
- when to use
- when not to use
- triggers or expected inputs
- required outputs or decisions
- forbidden behavior
- validation or completion criteria
- output or reporting constraints when needed

If an element is missing and the task type cannot be performed reliably without it, add or restore the smallest explicit wording needed in the correct layer.

### hierarchy quality audit

Check all of the following:

- the resulting hierarchy is shorter or clearer in the edited scope
- duplicated wording has been reduced where safe
- each edited rule now lives in the most appropriate layer
- there are fewer overloaded rules than before
- the edited prompts are easier to obey under short instructions than the previous version
- the edited prompts are not shorter at the cost of losing critical structure

If any audit fails, fix the hierarchy before finalizing.

## 17. Final response format

Provide these sections in order.

## Scope

- list the files you inspected
- list the files you changed
- state the main hierarchy problem you addressed

## Task archetypes checked

- list the affected archetypes
- mention any missing essential elements you found and repaired

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
- restored a missing essential
- added minimal wording

## Why these layers

Explain why each meaningful change belongs in its final layer rather than another one.

## Capability and completeness preservation

Explain how intentional capabilities, failure-derived protections, and task-essential structure were preserved or repaired.
Explicitly mention any behavior that was moved rather than deleted.

## Research decision

- state whether additional research was needed
- if yes, why
- if no, why not

## Hierarchy improvements

Explain how the resulting hierarchy is shorter, clearer, less redundant, more complete, or easier to obey.

## Remaining risks

List any items that still look provisional, overloaded, incomplete, or likely to need a later pass.

Important constraints:

- This command is hierarchy-aware. Do not optimize one file while ignoring surrounding layers.
- Do not perform a broad rewrite unless the current structure clearly prevents minimal consolidation.
- Do not add a new rule when a wording change, merge, split, move, or minimal restoration is likely enough.
- Do not drop behaviorally meaningful detail without preserving it at the same layer or moving it explicitly.
- Do not use brevity as a reason to weaken source-verification rules, privacy rules, validation obligations, role boundaries, or task-essential structure.
- If the request is actually only about recording a new failure, recommend `/report-failure` instead.
- If the request is mainly about introducing one new capability with minimal scope, recommend `/add-prompt-capability` instead.

---
description: Add or strengthen one prompt capability with hierarchy-aware design, research gating, and validation planning
agent: build
---

Your task is to add or strengthen one prompt capability in the prompt hierarchy.

User request:
$ARGUMENTS

This command is for intentional capability addition or capability strengthening.

Use this command when the user wants the prompt system to gain or improve a behavior, policy, constraint, or decision rule.

Do not use this command as the primary workflow for:

- recording a newly observed failure
- broad hierarchy cleanup
- large-scale prompt refactoring
- open-ended investigation with no concrete capability to add

If the request is mainly about recording a failure, recommend `/report-failure`.
If the request is mainly about hierarchy-wide cleanup or consolidation, recommend `/refine-prompt`.

Follow this workflow exactly.

## 1. Read the control documents first

Read these files before doing anything else:

- `AGENTS.md`
- `opencode-prompt-dev/prompt-principles.md`

If relevant, also read:

- `~/.local/share/chezmoi/.opencode/local-failure-logs/`
- `opencode-prompt-dev/prompt-refactor-checklist.md`

## 2. Read the relevant prompt surfaces

Identify the relevant prompt surfaces for this capability.

Consider at least these possible layers:

- global rules such as `AGENTS.md` or `dot_config/opencode/AGENTS.md`
- role-specific prompt files such as `build.md`, `plan.md`, or equivalent
- skill descriptions
- `SKILL.md` files

Read the files that are likely to own, constrain, or overlap with the requested capability.

Do not edit anything yet.

## 3. Write a capability contract before editing

Before making changes, extract a concrete capability contract.

Determine all of the following:

### Objective

- What exact behavior is being added or strengthened?

### Scope

- Where should this capability apply?
- Where must it not apply?

### Assumptions

- What assumptions does this capability depend on?
- What surrounding behavior must remain unchanged?

### Inputs

- What information, signals, or task conditions should trigger the capability?

### Required outputs or decisions

- What must the model do differently once this capability exists?

### Forbidden behavior

- What should the model stop doing, avoid doing, or refuse to do because of this capability?

### Validation target

- What observable evidence would show that this capability has actually been implemented correctly?

If the request is too vague to define a usable capability contract, say so explicitly in the final response and make the smallest safe improvement only if one is clearly justified.

## 4. Check whether additional research is needed

Before editing, decide whether local prompt files are enough, or whether additional research is needed.

Research is needed when any of the following are true:

- current public facts matter
- external best practices are central to the capability
- the capability defines a reusable process, workflow, review framework, or quality checklist
- the task archetype has established quality criteria outside the repository
- the capability changes search policy, source policy, evidence standards, or validation strategy
- the capability affects privacy, disclosure, or security-sensitive behavior
- the request uses a term, practice, or policy that is ambiguous, unfamiliar, or likely to have multiple interpretations

If research is needed:

- use available research tools before editing
- prefer primary sources, official documentation, or direct product documentation
- separate facts from your own synthesis
- do not include private repository information in public search queries
- use only the minimum research needed to define and place the capability correctly

If research is not needed:

- continue using only local prompt context

## 5. Check whether the capability already exists

Determine whether the requested capability is already present in one of these forms:

- already implemented clearly and correctly
- present but weak or ambiguous
- duplicated across layers
- placed in the wrong layer
- partially present but missing an important constraint
- present as a failure patch that should now become an intentional capability

If it already exists, prefer strengthening, clarifying, or relocating it over adding a new rule.

## 6. Decide the correct layer

Choose the most appropriate layer for the capability.

Use these rules:

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
Do not place local exceptions into a global rules file unless they truly belong there.
Do not scatter one capability across multiple layers unless each layer has a clearly different responsibility.

## 7. Choose the smallest effective change

Apply this priority order:

1. clarify an existing rule
2. move an existing rule to a better layer
3. merge overlapping wording
4. split one overloaded rule into a short shared rule plus detailed local guidance
5. add a minimal new rule only if the above are insufficient

Shorter is better only when the capability remains equally enforceable.

Do not add a new sentence when a careful rewording is enough.

## 8. Design the validation plan before editing

Before editing, define a small validation plan.

The plan must include:

- which files should reflect the capability after the change
- what nearby rules might now duplicate or conflict with it
- one compliant example behavior
- one forbidden example behavior
- one short explanation of how you will tell that the capability is actually covered

If the capability is broad, also identify:

- what later `/refine-prompt` pass might be useful
- what future consolidation risk this addition introduces

## 9. Edit the prompt hierarchy

Now implement the capability.

While editing:

- keep wording direct, short, and operational
- avoid historical commentary inside normative prompt text
- avoid duplicate reminders across layers
- avoid vague slogans that do not control behavior
- preserve nearby capabilities and constraints
- preserve language-policy consistency and output-quality rules already in place

You may edit only the files needed for this capability.

Do not create new tracking files.
Do not perform hierarchy-wide cleanup here.
Do not convert this into a broad refactor.

Do not edit incident files under `~/.local/share/chezmoi/.opencode/local-failure-logs/` unless the user explicitly wants this capability linked to an already logged failure.

## 10. Run the capability-preservation audit

Before finalizing, check all of the following:

- the capability contract is now covered
- the chosen layer is correct
- no nearby rule now says the same thing twice without need
- no contradiction was introduced
- no existing important capability was weakened or deleted
- no detailed procedure lives only in a skill description
- no local exception leaked into the global layer without justification
- the resulting wording is at least as enforceable as the obvious longer alternative

If any of these checks fail, fix the prompt hierarchy before finalizing.

## 11. Final response format

Provide these sections in order.

## Capability contract

- objective
- scope
- assumptions
- inputs
- required outputs or decisions
- forbidden behavior
- validation target

## Research decision

- whether additional research was needed
- if yes, why
- if no, why not

## What changed

- list changed files
- for each file, say whether you clarified, moved, merged, split, or added wording

## Why this layer

- explain why each change belongs in that layer rather than another one

## Validation plan

- list the checks you used
- state one compliant example behavior
- state one forbidden example behavior

## Follow-up

- state whether a later `/refine-prompt` pass is likely useful
- keep this short and mention only concrete reasons such as duplication risk or nearby overlap

Important constraints:

- This command adds or strengthens one capability with minimal scope.
- It must decide whether additional research is needed before editing.
- It must define a capability contract before editing.
- It must define a validation plan before editing.
- Do not perform hierarchy-wide optimization here.
- Do not add a new rule when a wording change or layer move is likely enough.
- If the request is actually a failure-remediation request, recommend `/report-failure`.
- If the request is mainly about broad cleanup, consolidation, or deduplication across layers, recommend `/refine-prompt`.

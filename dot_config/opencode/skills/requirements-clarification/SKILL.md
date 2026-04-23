---
name: requirements-clarification
description: >
  Use this skill as the default first step for ordinary implementation-shaped requests that are not yet execution-ready. It treats the user's initial instruction as a stated requirement, decomposes it into atomic requirements, normalizes each one into a fixed record, marks each required attribute as `user_provided`, `repo_derivable`, `public_fact`, or `unknown`, and determines the next skill from the remaining unresolved attributes. Do not use it for purely factual questions, pure local investigation, or pure public research with no implementation intent. Expected result: a written requirements artifact plus one next-step recommendation.
---

# Requirements Clarification

## Purpose

This skill turns a raw implementation request into an execution-ready requirements
artifact.

Its starting assumption is that the user's initial instruction is a `stated requirement`:
useful, but not yet analyzed, verified, or validated enough for direct execution.

The goal is to reduce routing ambiguity for smaller models by replacing
"does this feel specific enough?" with a fixed requirements record and explicit
attribute status.

## When to use

Use this skill as the default first step when the request is an ordinary
implementation-shaped task and one or more of these are true:

- the request names a change but not the full execution-ready requirement set
- the request implies invariants, tests, docs, or verification work that are not yet
  explicit
- the request may hide multiple atomic requirements inside one instruction
- the request needs a normalized artifact before planning or implementation
- the request looks specific but still relies on unstated assumptions about scope,
  constraints, or acceptance criteria

## When not to use

Do not use this skill when:

- the request is a purely factual question with no implementation intent
- the request is clearly pure public research
- the request is clearly pure repository-local investigation
- the request is clearly behavior-preserving refactoring and already execution-ready
- the request already has a written requirements artifact or task file that is good
  enough for the next downstream skill

## Expected inputs

- the raw user request
- any explicit user constraints, preferences, or prior decisions
- relevant repository context discoverable from local files
- public sources when externally grounded facts are needed for the requirement record

## Expected outputs

- a structured requirements document written to an external file
- atomic requirement records with explicit attribute status
- targeted user questions only for remaining `unknown` attributes
- exactly one handoff recommendation

## Core rules

### 1. Start from stated requirements

Do not treat the user's first wording as automatically execution-ready.

Instead, convert it into one or more atomic requirements.

### 2. Split into atomic requirements

Each atomic requirement should express one of:

- a capability
- a constraint
- a quality expectation

Do not leave several independently verifiable changes fused into one record.

### 3. Normalize every atomic requirement

For each atomic requirement, fill a fixed record.

Use an EARS-style statement when practical, but prefer a precise fixed structure over
free-form prose.

Each record must contain at least:

- `Type`
- `Normalized statement`
- `Source`
- `Target`
- `Desired change`
- `Invariants`
- `Constraints`
- `Acceptance criteria`
- `Verification method`
- `Affected tests`
- `Affected docs`

### 4. Track attribute status explicitly

For every required attribute, record exactly one of:

- `user_provided`
- `repo_derivable`
- `public_fact`
- `unknown`

Use these meanings:

- `user_provided`: the user already gave the value clearly enough
- `repo_derivable`: the value should be determined from repository context
- `public_fact`: the value depends on externally verifiable public information
- `unknown`: the value still requires a real user decision or remains unresolved after
  proportionate discovery

Do not collapse these statuses into a vague statement such as "unclear."

### 5. Discover before asking

Before asking the user, inspect the repository and use public research when needed.

Ask only about attributes that remain `unknown` after proportionate discovery.

### 6. Route from unresolved attributes, not intuition

Use this mapping:

- unresolved required `repo_derivable` attributes -> recommend `investigation`
- unresolved required `public_fact` attributes -> recommend `public-research`
- unresolved required `unknown` attributes -> stay in this skill and ask targeted
  questions, or use `grill-me` only if the remaining decisions are interdependent
- no unresolved required attributes -> recommend `task-planning`, `implementation`,
  `refactoring`, or `code-review` as appropriate

Do not hand off to implementation while a required attribute is still `unknown`.

### 7. Make change obligations explicit

The requirement record must surface change obligations that small models often miss.

At minimum, make explicit:

- what existing behavior must remain true
- what new behavior must be verified
- which tests are affected
- which docs are affected

If you determine that no test or doc update is needed, say so explicitly instead of
leaving the field blank.

### 8. Write the artifact

Write the requirements document to `docs/requirements/<slug>.md` unless the user asked
for another location.

If the directory does not exist, create it.

## Requirements document template

Use this structure:

```markdown
# Requirements: <title>

## Objective

<One sentence stating what must be achieved.>

## Scope

- In scope:
  - <item>
- Out of scope:
  - <item>

## Atomic requirements

### R-1: <short label>

- Type: capability | constraint | quality
- Normalized statement: <EARS-style statement or precise equivalent>
- Source: <where the requirement comes from>
- Target: <system, file, behavior, or artifact being changed>
- Desired change: <what must change>
- Invariants: <what must remain true>
- Constraints: <boundaries on the solution>
- Acceptance criteria: <measurable done conditions>
- Verification method: <how to confirm the requirement>
- Affected tests: <tests to add, update, check, or `None identified.`>
- Affected docs: <docs to add, update, check, or `None identified.`>
- Attribute status:
  - source: user_provided | repo_derivable | public_fact | unknown
  - target: user_provided | repo_derivable | public_fact | unknown
  - desired change: user_provided | repo_derivable | public_fact | unknown
  - invariants: user_provided | repo_derivable | public_fact | unknown
  - constraints: user_provided | repo_derivable | public_fact | unknown
  - acceptance criteria: user_provided | repo_derivable | public_fact | unknown
  - verification method: user_provided | repo_derivable | public_fact | unknown
  - affected tests: user_provided | repo_derivable | public_fact | unknown
  - affected docs: user_provided | repo_derivable | public_fact | unknown

## Open questions

- [ ] <only attributes that remain truly unknown>

## Handoff recommendation

- Next skill: <requirements-clarification | investigation | public-research | task-planning | implementation | refactoring | code-review>
- Why: <one short explanation>
```

If a field has no applicable content after discovery, write `None identified.` rather
than leaving it blank.

## Procedure

### Step 1: Restate the implementation intent

Summarize what change the user appears to want.

### Step 2: Discover from local and public context

Read the relevant repository files.

If externally grounded facts affect the requirement record, use `public-research`
before asking the user.

### Step 3: Split the request into atomic requirements

Identify each independent capability, constraint, or quality expectation.

### Step 4: Fill the normalized records

For each atomic requirement, fill every field in the template and assign an explicit
attribute status.

### Step 5: Evaluate unresolved attributes

If unresolved required attributes remain:

- recommend `investigation` for `repo_derivable`
- recommend `public-research` for `public_fact`
- ask targeted user questions only for `unknown`

If the remaining `unknown` attributes are tightly interdependent, you may use
`grill-me` before returning to this artifact.

### Step 6: Write the document

Write the current artifact to the output file even if follow-up work remains.

Do not wait for perfection before externalizing the normalized record.

### Step 7: Recommend exactly one next skill

Base the recommendation on the unresolved attributes or, if none remain, on the next
real execution need.

## Handoff rules

- recommend `investigation` when unresolved required attributes are `repo_derivable`
- recommend `public-research` when unresolved required attributes are `public_fact`
- remain in `requirements-clarification` when unresolved required attributes are truly
  `unknown` and user input is still needed
- recommend `task-planning` when the requirement records are complete but the work still
  needs sequencing, decomposition, or a resume-safe artifact
- recommend `implementation` when the requirement records are complete and the change can
  be executed directly
- recommend `refactoring` when the complete records describe behavior-preserving
  structural cleanup
- recommend `code-review` when the task is to review code quality rather than to edit

## Quick checklist

Before finishing, verify all of the following:

- the user request was treated as a stated requirement, not as instant implementation
- the request was split into atomic requirements
- each atomic requirement has the fixed fields
- each required attribute has an explicit status value
- repo and public discovery were attempted before asking the user
- open questions include only true `unknown` attributes
- the artifact was written to an external file
- the next-step recommendation names exactly one skill

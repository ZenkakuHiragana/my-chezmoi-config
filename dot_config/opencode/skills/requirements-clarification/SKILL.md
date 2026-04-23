---
name: requirements-clarification
description: >
  Use this skill when repository discovery and any already-identified public-fact checks are no longer the main blockers, but requirement gaps still remain: the objective, scope, constraints, acceptance criteria, or load-bearing operating assumptions are still missing or ambiguous enough to block a written requirements artifact or downstream skill choice. It writes a requirements document with objective, scope, constraints, assumptions, open questions, and acceptance criteria, and may use bounded escalation such as `grill-me` when one answer would change several downstream design choices. Do not use it as a substitute for repository-local fact-finding or external evaluation-context verification; if requirement clarity is still `undetermined` because facts or criteria are missing, resolve those first or use `routing-diagnosis`. Expected result: a written requirements document and a clear next-step recommendation.
---

# Requirements Clarification

## Purpose

This skill structures vague, ambiguous, or under-specified user requests into a formal requirements document. Use it before `implementation` or detailed planning when the request is not yet execution-ready.

The goal is to turn an unclear request into a written, reviewable artifact with explicit gaps identified and resolved where possible.

This skill handles requirement gaps. It is not the initial total diagnosis for every kind of uncertainty.

## When to use

Use this skill when repository discovery and any already-identified public-fact checks are no longer the main blockers, and the user request still meets any of these conditions:

- the objective is vague or can be interpreted in multiple ways
- the scope is undefined or unclear
- no explicit constraints or acceptance criteria are given
- critical terms or concepts in the request are ambiguous
- the request still leaves multiple plausible objectives, scopes, or acceptance criteria open
- the request may mean different things depending on visible operating assumptions such as local experiment, internal tooling, or something used by other people
- the user still needs to choose solution constraints or operating targets, such as local-only versus externally used, strict versus relaxed privacy, or minimum durability or performance
- the user still needs to choose security, privacy, cost, compliance, durability, or performance targets after any required external verification has already been done

## When not to use

Do not use this skill when:

- the request already identifies a concrete next step such as a repository change, local investigation, structural cleanup, or public-fact check
- it is still `undetermined` whether a requirement gap exists because repository facts have not yet been confirmed; use `routing-diagnosis` or `investigation` first
- it is still `undetermined` whether a requirement gap exists because external evaluation criteria or public guidance may materially change the acceptable solution; use `routing-diagnosis` or `public-research` first
- the main uncertainty is whether current practice, external standards, or a public source changes the acceptable answer; use `public-research` or `routing-diagnosis` first
- the user is asking a factual question that does not require structural clarification
- the task is already structured by a command workflow (e.g. `/add-prompt-capability`)

## Expected inputs

- the raw user request
- any context the user provides (background, preferences, constraints)
- information discoverable from the repository

## Expected outputs

- a structured requirements document written to an external file
- targeted follow-up questions for the user when genuine gaps remain
- a handoff recommendation naming the appropriate downstream skill

## Core rules

### 0. Confirm that the unresolved gap is actually about requirements

This skill handles missing or ambiguous objectives, scope, constraints, acceptance criteria, and load-bearing operating assumptions.

If the real blocker may instead be missing repository facts or missing evaluation-context criteria, stop and recommend `routing-diagnosis`, `investigation`, or `public-research` rather than asking the user prematurely.

### 1. Discover before asking

Before generating questions, check what the repository, existing files, configuration, and code patterns already reveal. Ask only about genuine gaps that cannot be resolved from available context.

This aligns with the global rule: prefer discovered facts over unnecessary questions.

### 2. Do not start implementation

This skill produces requirements only. Do not begin editing code, creating files beyond the requirements document, or making design decisions that belong to implementation.

### 2a. Clarify only the assumptions that matter

Do not turn this skill into a fixed questionnaire.

When operational assumptions would change `Scope`, `Constraints`, `Open questions`, or `Acceptance criteria`, identify only the one to three that matter most for this request.

Typical examples include:

- whether the result is for a local experiment or for other users
- whether secrets, authentication, authorization, PII, or other sensitive data are involved
- whether cost, legal constraints, licenses, data durability, or performance realism materially affect the solution

Capture the result in `Constraints`, `Assumptions`, `Open questions`, or `Acceptance criteria` rather than inventing a separate permanent checklist section.

### 3. Distinguish assumptions from facts

When you fill in a section based on inference rather than explicit user statement or repository evidence, label it as an assumption. Do not present assumptions as confirmed requirements.

### 4. Keep the document concise

Write the minimum structure needed to clarify the request. Do not pad the document with boilerplate, generic advice, or obvious statements.

### 5. Generate targeted questions

When you must ask the user, make each question specific and actionable. Avoid broad, open-ended questions when a concrete choice or confirmation would suffice.

Prefer questions framed as:

- a choice between explicit options
- a confirmation or correction of a stated assumption
- a request for a specific missing value or criterion

Avoid questions framed as:

- "What do you want?" (too broad)
- "Please describe your requirements in detail" (pushes framing work back to the user)

For genuine user decisions, prefer structured choices and use the `question` tool when available.

### 5a. Escalate only when design questions are interdependent

If one or two direct clarification questions will resolve the remaining gaps, ask them here.

If the remaining open questions form a branching design tree where one answer would update multiple sections of the requirements document or change several downstream choices, you may use `grill-me` as a bounded escalation step.

Do this only when all of the following are true:

- repository discovery and proportionate public research have already resolved the factual gaps they can resolve
- the remaining uncertainty is primarily design- or preference-shaped
- the decisions are interdependent enough that isolated questions would be confusing or inefficient

After that escalation, return to this skill's output contract and finalize the written requirements document.

### 6. Write to an external file

After structuring, write the requirements document to a file. The default location is `docs/requirements/<slug>.md` where `<slug>` is a short kebab-case identifier derived from the objective. If the user specifies a different location, use that instead.

If the `docs/requirements/` directory does not exist, create it.

## Requirements document template

Use this structure for the output file:

```markdown
# Requirements: <title>

## Objective

<One sentence stating what must be achieved.>

## Scope

- In scope:
  - <item>
- Out of scope:
  - <item>

## Constraints

- <constraint>

## Assumptions

- [ASSUMPTION] <assumed fact not yet confirmed by user>

## Open questions

- [ ] <question to resolve>

## Acceptance criteria

- [ ] <measurable condition that must be true when done>
```

Fill in each section based on what is known. If a section has no content after discovery, write `None identified.` rather than leaving it blank.

## Procedure

### Step 1: Receive and restate

Restate the user's request in your own words internally. Separate potential requirement gaps from repository-fact gaps and evaluation-context gaps.

### Step 2: Discover from context

Read relevant repository files, configuration, code patterns, and documentation to answer as many requirement questions as possible without asking the user.

If visible task details show that public facts, official guidance, or current best practices must be checked before you can fill `Constraints`, `Acceptance criteria`, or the next-skill recommendation, use `public-research` before deciding that the gap must be pushed to the user.

Also identify whether any load-bearing operating assumptions must be clarified, such as local-only versus externally used, sensitive data exposure, cost sensitivity, compliance constraints, or durability expectations.

If a supposed requirement gap cannot yet be judged because repository facts or external criteria are still missing, keep it `undetermined` and stop to recommend `routing-diagnosis` or the prerequisite skill instead of inventing user questions.

### Step 3: Structure into the template

Fill in each section of the requirements template:

- **Objective**: what the user wants to achieve, stated as a single goal
- **Scope**: what is included and explicitly excluded
- **Constraints**: technical, organizational, or policy constraints that bound the solution
- **Assumptions**: inferences you made that are not yet confirmed; label each with `[ASSUMPTION]`
- **Open questions**: genuine gaps that cannot be resolved from context; format as checkboxes
- **Acceptance criteria**: measurable conditions for completion; format as checkboxes

### Step 4: Evaluate completeness

Check whether the structured requirements now state the objective, scope, constraints, open questions, and acceptance criteria well enough to recommend exactly one downstream skill. If yes, proceed to Step 6.

If not, identify the minimum set of questions needed to fill the critical gaps.

If the remaining critical gaps are mostly interdependent design questions where one answer would update multiple sections or downstream choices, consider the bounded `grill-me` escalation described above before returning to the user.

### Step 5: Ask the user

Present the current draft to the user along with targeted questions.

Do not present an empty template. Show what you have already filled in so the user can confirm or correct.

After the user responds, update the document and re-evaluate whether it supports exactly one downstream handoff recommendation. Repeat this step until it does.

### Step 6: Write the requirements file

Write the final document to the output file. Confirm the file path to the user.

### Step 7: Recommend handoff

State which downstream skill should handle the request next and why. Include the file path of the requirements document so the downstream invocation can reference it.

## Handoff rules

- If the requirements now identify a concrete repository change, target surfaces or contracts, and required checks with no blocking unknowns, recommend `implementation` with the requirements file path.
- If the requirements are concrete but execution still needs ordered decomposition, dependencies, explicit resume-safe checks, or a durable task artifact because important execution guidance currently exists only in conversation, recommend `task-planning` with the requirements file path.
- If open questions or acceptance criteria still depend on public facts or official guidance, recommend `public-research` for that portion first.
- If the chosen work is behavior-preserving structural cleanup of existing code, recommend `refactoring` as a prerequisite.
- If the remaining open questions concern repository-local behavior, state, or facts to confirm, recommend `investigation` first.

## Quick checklist

Before finishing, verify all of the following:

- the requirements document contains all six sections
- assumptions are explicitly labeled
- open questions are formatted as checkboxes
- acceptance criteria are measurable
- no question was asked that could have been answered from repository context
- operating assumptions were clarified only where they materially affected the request
- the document was written to an external file
- the file path was communicated to the user
- a handoff recommendation was given

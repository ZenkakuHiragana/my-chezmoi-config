---
name: routing-diagnosis
description: >
  Use this skill when it is not yet clear whether the next step should be `investigation`, `requirements-clarification`, `public-research`, `task-planning`, `implementation`, or `refactoring`, especially when requirement gaps, repository-fact gaps, and evaluation-context gaps interact. It classifies each gap as `satisfied`, `missing`, or `undetermined`, records dependency order between gaps, and recommends the cheapest safe next skill. Do not use when the correct next skill is already obvious or when a command workflow already performs this diagnosis. Expected result: a concise diagnosis with blocker gaps, the next-skill recommendation, and the minimum evidence or question needed next.
---

# Routing Diagnosis

## Purpose

This skill performs lightweight pre-routing diagnosis when it is not yet clear which downstream skill should act first.

It separates three kinds of unresolved gaps:

- requirement gaps
- repository-fact gaps
- evaluation-context gaps

The goal is not to solve the task. The goal is to identify the cheapest safe next step and explain why.

## When to use

- more than one downstream skill plausibly fits as the first step
- whether requirements are clear depends on repository inspection, external guidance, or both
- the request mixes "understand the current state", "decide the scope", and "plan or implement"
- a request looks concrete at first, but may change shape once current artifacts, constraints, or evaluation criteria are checked
- you need a lightweight diagnosis before deciding between `investigation`, `public-research`, `requirements-clarification`, `task-planning`, `implementation`, or `refactoring`

## When not to use

- the correct next skill is already obvious
- the task is already clearly inside one downstream skill's entry conditions
- a command workflow already performs this diagnosis

## Expected inputs

- the raw user request
- any explicit user constraints or prior decisions
- the minimum local or public context needed to classify unresolved gaps

## Expected outputs

- a concise diagnosis with the status of each gap class
- dependency notes for any `undetermined` gap
- the recommended next skill and why
- the minimum evidence or user decision needed next
- any reroute condition that would change the recommendation

## Core rules

### 1. Separate gap classes

Classify unresolved uncertainty into these buckets:

- **Requirement gaps**: objective, scope, constraints, acceptance criteria, or load-bearing operating assumptions are missing or ambiguous.
- **Repository-fact gaps**: current state, affected surfaces, existing artifacts, code paths, or configuration facts inside the repository are missing or unconfirmed.
- **Evaluation-context gaps**: externally grounded criteria or task-shaped priorities such as security, privacy, compatibility, performance, compliance, reliability, or source/evidence standards are missing or unconfirmed.

Do not collapse these gap classes into a single label such as "unclear."

### 2. Use three states

Track each gap class as one of:

- `satisfied`
- `missing`
- `undetermined`

Use `undetermined` when you do not yet have enough evidence to judge whether the gap is actually missing, or when signals conflict.

Do not treat `undetermined` as `missing` or `satisfied`.

### 3. Resolve prerequisite gaps first

If one gap cannot yet be judged because another gap is unresolved, keep the dependent gap `undetermined` and resolve the prerequisite gap first.

Examples:

- if you cannot tell whether the scope is complete until you inspect the current repository surfaces, resolve the repository-fact gap first
- if you cannot tell whether compatibility or citation requirements matter until you know the domain or external policy, resolve the evaluation-context gap first

### 4. Prefer the cheapest safe next step

Recommend the next skill that is most likely to change the routing decision with the least cost.

Use this default mapping unless evidence clearly points elsewhere:

- choose `investigation` when repository-fact gaps are `missing`, or when requirement clarity remains `undetermined` because repository facts are missing
- choose `public-research` when evaluation-context gaps are `missing`, or when requirement clarity remains `undetermined` because external guidance or public facts could materially change the acceptable solution
- choose `requirements-clarification` when requirement gaps remain `missing` after proportionate factual and evaluation-context gathering
- choose `task-planning` when all material gaps are `satisfied` and the work still needs ordered decomposition
- choose `implementation` when all material gaps are `satisfied` and the intended change is already clear
- choose `refactoring` when the next step is behavior-preserving structural cleanup rather than feature delivery or bug fixing

### 5. Keep diagnosis lightweight

Inspect only the minimum context needed to recommend the next skill safely.

Do not turn this skill into broad exploration, detailed planning, or implementation.

### 6. Distinguish blockers from follow-ups

A gap blocks routing only when the next skill would be materially different depending on how that gap is resolved.

If a gap does not change the safe next step, note it as a follow-up rather than treating it as a blocker.

## Procedure

### Step 1: Restate the task and candidate next steps

Restate the user's request internally and identify the plausible downstream skills.

### Step 2: Gather only the minimum prerequisite context

Read the minimum relevant repository files when the task is repository-local.

If external guidance could materially affect the acceptable solution, use `public-research` before finalizing the diagnosis.

### Step 3: Fill the gap table

For each gap class, record:

- status: `satisfied`, `missing`, or `undetermined`
- short supporting evidence
- whether another gap must be resolved first

### Step 4: Choose the next skill

Recommend the smallest safe next skill based on the gap table and dependency order.

### Step 5: Report reroute conditions

State what new fact, user answer, or external source would change the diagnosis enough to justify a different next skill.

## Output format

Return a concise diagnosis with these sections:

- **Request summary**
- **Gap table**
- **Blocking dependencies**
- **Recommended next skill**
- **Minimum next evidence or question**
- **Reroute condition**

## Quick checklist

Before finishing, verify all of the following:

- all three gap classes were considered
- any `undetermined` status has a short reason
- dependency order between gaps is explicit when relevant
- the recommendation points to exactly one next skill
- the proposed next step is smaller than full planning or implementation when the evidence is still incomplete

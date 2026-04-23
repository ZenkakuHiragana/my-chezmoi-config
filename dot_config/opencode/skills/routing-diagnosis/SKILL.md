---
name: routing-diagnosis
description: >
  Use this skill only when it is not yet clear whether a request should enter the default requirements-first path or another path such as direct information gathering, public research, planning, implementation, refactoring, or review. It performs a lightweight diagnosis, recommends exactly one next skill, and states the minimum evidence or question needed next. Do not use it for ordinary implementation-shaped requests that can start by normalizing stated requirements. Expected result: a concise diagnosis with one next-skill recommendation.
---

# Routing Diagnosis

## Purpose

This skill is an escape hatch for ambiguous routing.

Use it when the first problem is not "how do we execute this change?" but
"what routing template should this request use at all?"

For ordinary implementation-shaped requests, do not start here.
Start with `requirements-clarification` and let the normalized requirement
records drive later handoffs.

## When to use

- it is unclear whether the request is primarily implementation-shaped,
  investigation-shaped, public-research-shaped, review-shaped, or refactoring-shaped
- the request mixes inspection, design choice, and execution intent in a way that
  makes the correct first template unclear
- the request is meta-work about routing, skills, or workflow boundaries and the
  correct downstream skill is not obvious
- several different first skills are plausible and the wrong choice would change
  the work materially

## When not to use

- the request is an ordinary repository change that can start from stated-requirement
  normalization
- the request is clearly pure public research
- the request is clearly pure local investigation
- the request is clearly refactoring or code review
- the request already has a written requirements artifact or task file that points
  to one downstream skill

## Expected inputs

- the raw user request
- any explicit user constraints or prior decisions
- the minimum local or public context needed to decide the next template safely

## Expected outputs

- a short request summary
- a short routing assessment
- exactly one recommended next skill
- the minimum evidence or question needed next
- a reroute condition if one fact would change the recommendation

## Core rules

### 1. Prefer the default path when possible

First ask whether the request is an ordinary implementation-shaped task.

If yes, recommend `requirements-clarification` rather than inventing a broader
diagnostic branch.

### 2. Diagnose only what changes routing

Do not perform broad exploration.

Gather only enough evidence to decide which skill should act first.

### 3. Keep the output to one next step

Return exactly one next skill.

If later skills may follow, mention them only as follow-up context, not as a tied
first-step recommendation.

### 4. Use simple routing tests

Use this order:

1. If the request is clearly behavior-preserving structural cleanup, recommend `refactoring`.
2. If the request is clearly about reviewing code quality, recommend `code-review`.
3. If the request is an ordinary repository change, recommend `requirements-clarification`.
4. If the request is clearly about repository-local facts or observed behavior with no
   confirmed change yet, recommend `investigation`.
5. If the request is clearly about source-backed public facts or external guidance,
   recommend `public-research`.
6. If the request already has execution-ready requirements but needs sequencing,
   recommend `task-planning`.
7. If the request already has execution-ready requirements and no planning gap,
   recommend `implementation`.

### 5. State the smallest missing input

If one missing fact or one user decision blocks safe routing, say exactly what it is.

Do not ask broad questions such as "what do you want?"

## Procedure

### Step 1: Restate the request in one line

Identify the concrete thing the user appears to want.

### Step 2: Decide whether it is an ordinary implementation-shaped request

If yes, first check whether it is already clearly refactoring or code review.

If it is not, stop and recommend `requirements-clarification`.

### Step 3: Check the nearest alternative

If not, determine whether the request is more clearly investigation, public research,
refactoring, code review, task planning, or implementation.

### Step 4: Report one next skill

State the recommendation and the minimum evidence or question that justified it.

## Output format

Return a concise diagnosis with these sections:

- **Request summary**
- **Routing assessment**
- **Recommended next skill**
- **Minimum next evidence or question**
- **Reroute condition**

## Quick checklist

Before finishing, verify all of the following:

- you checked whether the default requirements-first path was enough
- the recommendation names exactly one next skill
- the diagnosis is smaller than full planning or implementation
- the report states the minimum evidence or question needed next

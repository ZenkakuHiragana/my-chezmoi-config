---
name: code-review
description: Use this skill when you need to review a specific diff or the current codebase for quality issues. It produces prioritized review findings with evidence, covering correctness, design, tests, maintainability, security, performance, docs, and style. Do not use for implementing fixes, debugging root cause, or purely factual questions.
---

# Code Review

## Purpose

This skill reviews code for likely defects, design problems, regressions, and maintainability issues.

It is for advisory review, not for making fixes.

## When to use

Use this skill when the user asks to:

- review a diff, patch, or pull request
- review the current codebase for quality issues
- find problems in a changed area before merge
- evaluate whether code is ready to land

## When not to use

Do not use this skill when the main task is:

- implementing a change
- debugging a specific failure
- researching external facts
- refactoring code
- writing a completion verdict after the work is already done

## Review contract

Review the code against common code review concerns:

- correctness and edge cases
- design and integration with surrounding code
- complexity and maintainability
- tests and test quality
- naming, readability, comments, and documentation
- style and consistency with the existing codebase
- security, privacy, and error handling when relevant
- performance and reliability when relevant

If a diff is provided, review the changed lines and the surrounding context that the change depends on.

If only the current codebase is available, review the highest-risk areas first and state what scope was actually covered.

## Working rules

### 1. Read the code, not just the summary

Inspect the actual files, related callers, tests, and docs that define the contract.

For a diff, read every changed line.

### 2. Focus on material issues

Prioritize problems that could cause bugs, regressions, confusion, or hidden maintenance cost.

Treat minor polish as nits.

### 3. Separate blocking findings from polish

Mark issues by severity or priority so the user can tell what must be fixed before merge.

### 4. Avoid out-of-scope drift

Do not propose unrelated rewrites or broad cleanup unless the reviewed code clearly depends on them.

### 5. Be concrete

Each finding should name the location, explain the problem, and say why it matters.

If possible, suggest the smallest fix that addresses the issue.

Keep feedback neutral and constructive.

### 6. Say when evidence is insufficient

If a claim cannot be supported from the reviewed code, say so and ask for the missing context instead of guessing.

## Review workflow

1. Identify the review scope and risk level.
2. Read the diff or relevant code paths and surrounding context.
3. Check the main review axes: correctness, design, tests, complexity, naming, docs, style, security, and performance.
4. Rank findings by severity.
5. Summarize the overall assessment and any remaining uncertainties.

## Output format

Present results in this order:

1. Scope reviewed
2. Findings, ordered by severity
3. Open questions or uncertainties
4. Overall assessment

For each finding, include:

- location
- issue
- why it matters
- suggested fix or next step

If there are no findings, say so explicitly and mention the scope you reviewed.

## Quick checklist

Before finishing, verify all of the following:

- the actual code was reviewed
- the review scope is explicit
- findings are prioritized
- each finding has concrete evidence
- minor polish is separated from blocking issues
- no unrelated rewrite was introduced

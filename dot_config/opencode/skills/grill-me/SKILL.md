---
name: grill-me
description: Use this skill only when the user explicitly wants a plan or design grilled, or when `requirements-clarification` reaches several interdependent design questions that are better resolved through a bounded interview. It asks targeted questions, gives recommended answers, and returns clarified decisions that must be folded back into a written requirements artifact.
---

# Grill Me

## Purpose

Use this skill for bounded design interrogation.

Its job is to resolve interdependent design questions through a directed interview, not to replace normal clarification, repository discovery, or factual research.

## When to use

- the user explicitly asks to be grilled on a plan or design
- `requirements-clarification` has already discovered what it can, but several open questions still depend on one another and would be awkward to resolve as isolated prompts

## When not to use

- the gaps are simple missing values or one-off confirmations
- the answer can be discovered from the repository
- the next need is factual research rather than a design interview
- the task already has a complete requirements artifact and is ready for `task-planning` or `implementation`

## Rules

1. Explore the repository first for anything discoverable there.
2. For genuine user decisions, prefer the `question` tool when available.
3. Ask at most five questions at a time.
4. For each question, provide a recommended answer and a short reason.
5. Keep the interview bounded. Stop once the remaining decisions are clear enough to return to a written requirements artifact.
6. Do not leave the result as chat-only state. Summarize the clarified decisions, remaining open questions, and the recommendation to fold them back into the active requirements document.

## Expected output

- clarified design decisions
- any remaining open questions
- a recommendation to resume `requirements-clarification` and update the written requirements artifact

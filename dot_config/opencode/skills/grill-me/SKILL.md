---
name: grill-me
description: Use this skill only when the user explicitly wants a plan or design grilled, or when `requirements-clarification` already has a draft requirements artifact but one answer would still change multiple sections or several downstream design choices. It asks targeted questions, gives recommended answers, and returns clarified decisions that must be folded back into a written requirements artifact.
---

# Grill Me

## Purpose

Use this skill for bounded design interrogation.

Its job is to resolve interdependent design questions through a directed interview, not to replace normal clarification, repository discovery, or factual research.

## When to use

- the user explicitly asks to be grilled on a plan or design
- `requirements-clarification` has already discovered what it can, but one answer would still change multiple sections of the requirements artifact or several downstream design choices

## When not to use

- the gaps are simple missing values or one-off confirmations
- the answer can be discovered from the repository
- the next need is factual research rather than a design interview
- the task already has a requirements artifact that points to `task-planning` or `implementation` without another branching interview

## Rules

1. Explore the repository first for anything discoverable there.
2. For genuine user decisions, prefer the `question` tool when available.
3. Ask at most five questions at a time.
4. For each question, provide a recommended answer and a short reason.
5. Keep the interview bounded. Stop once the clarified decisions can be written back into the active requirements document without another branching interview.
6. Do not leave the result as chat-only state. Summarize the clarified decisions, remaining open questions, and the recommendation to fold them back into the active requirements document.

## Expected output

- clarified design decisions
- any remaining open questions
- a recommendation to resume `requirements-clarification` and update the written requirements artifact

---
name: technical-writing
description: >
  Attach this capability when the task frame needs substantial technical prose quality, such as a report, README, tutorial, how-to, reference, explanation, CHANGELOG, migration note, or sectioned chat response. Attach it after facts are known, or alongside fact-owning capabilities when writing quality is a major obligation. It covers form, structure, scannability, critique, and revision, but does not discharge missing investigation, public research, source coverage, or implementation obligations.
---

# Technical Writing

## Purpose

This capability improves long-form technical prose quality for human readers.

It owns document form, structure, scannability, reader fit, and bounded revision quality for artifacts such as investigation reports, README files, tutorials, how-to guides, reference pages, explanations, CHANGELOG entries, migration notes, structured chat explanations, and similar documents.

It does not own missing facts or repository behavior changes. Resolve those with the appropriate fact-owning capability first.

## When to use

Attach this capability when one or more of the following are true:

- the main deliverable is a substantial technical document
- another task includes a standalone prose artifact that must remain useful after the implementation work is done
- the answer is a chat response, but the reader needs a sectioned explanation rather than a short direct reply
- the likely failure mode is weak structure, mixed document purpose, low scannability, or poor reader fit
- the task needs a reusable writing workflow rather than ad hoc style advice

## When not to use

Do not attach this capability when the task is primarily:

- a short simple conversational reply that does not need sectioning or a document-like structure
- a tiny wording tweak or one-off copyedit
- missing-fact investigation or public research; attach `investigation` or `public-research` first
- implementation work where writing is only incidental and no substantial document is being produced
- legal, policy, sales, or marketing copy with domain-specific constraints outside ordinary technical writing
- pure translation or localization without redesigning the document for clarity and reader fit

## Collaboration contract

- `investigation` resolves missing repository or local source-of-truth facts.
- `public-research` resolves missing public facts and externally grounded writing norms when they matter.
- `implementation` owns repository behavior changes, dependent-surface updates, and document correctness as part of the delivered change.
- `technical-writing` owns document form, structure, scannability, reader fit, critique, and bounded revision.

If facts are still materially unknown, stop and hand off before drafting instead of using prose quality to guess.

## Reference materials

For substantial standalone documents, read these references before outlining:

- `references/01-reader-contract.md`
- `references/02-standalone-structure.md`

For rendered formats such as Typst or other layout-sensitive outputs, also read:

- `references/03-rendered-artifact-checks.md`

## Document form

Choose one primary document form before outlining.

When a Diátaxis-style form fits, use one of these:

- `tutorial`: learning by doing for newcomers
- `how-to guide`: completing a specific task
- `reference`: looking up commands, options, inputs, outputs, or other facts
- `explanation`: understanding concepts, rationale, or trade-offs

Common non-Diátaxis forms in this repository also include:

- investigation report
- README
- CHANGELOG
- migration or release note

Do not accidentally blend forms.

If a document must serve more than one form, lead with one primary form and keep the others in clearly labeled sections.

## Writing contract

Before drafting, identify or derive all of the following:

- the document form
- the intended audience
- the reader's main goal or question
- the one-sentence purpose of the document
- what the reader already knows and may safely be assumed to know
- whether the artifact must stand alone or may rely on a named companion artifact
- the confirmed facts
- the important caveats, prerequisites, and exclusions
- the allowed source set
- the allowed change budget

If any of these are materially unknown and cannot be derived from the task or repository, stop and resolve them before drafting.

Default rule: if the user asks for a standalone document and does not explicitly permit companion context, write it to stand on its own without relying on ticket text, chat history, or adjacent artifacts.

## Drafting rules

### 1. Lead with value

State or imply early:

- what the document covers
- why it matters
- what the reader should understand, decide, or do after reading

Do not force the reader to finish the document before learning the point.

### 2. Write for the reader, not the writer

Organize the document around the reader's questions, decisions, or tasks.

Do not structure a reader-facing document around:

- the order in which you discovered facts
- the sequence of revisions you made
- your own handoff concerns as the writer

Do not expose drafting-process language inside the deliverable unless the process itself is the topic.

Avoid self-referential lines such as:

- "this document is written so the reader can understand"
- "for sharing with another team"
- "after feedback, this section was updated"

When the audience is external or cross-team, assume they cannot see the surrounding ticket, PR, or chat unless the task explicitly says they can.

Treat user instructions, review comments, drafting constraints, and rejected alternatives as control inputs for producing the artifact, not as default artifact content. Mention them only when the writing process itself is the subject or when the reader truly needs that context to interpret the artifact.

Before keeping a sentence, check its provenance. Keep or rewrite sentences grounded in subject matter, evidence, reader task, or necessary caveats. Delete or rewrite sentences grounded mainly in prompt wording, review feedback, abandoned structure, or the writer's process.

Do not rely on invisible comparison frames. If a sentence works mainly because the writer can see an unseen alternative, rejected draft, or feedback thread, delete it or rewrite it as a direct positive statement about the current subject. Use contrast only when it prevents a real reader misunderstanding or when the reader must compare live alternatives.

### 3. Make structure visible

Use a clear heading hierarchy.

Headings should be:

- specific
- unique within the document
- aligned with the reader's task or question
- phrased for readers rather than only for insiders

Provide at least brief orienting text under headings instead of stacking empty subheadings.

### 4. Optimize for scanning

Prefer plain language, active voice, and direct sentences.

When practical:

- keep one main idea per paragraph
- keep one main claim per sentence
- break long walls of text into lists, tables, or smaller sections
- use numbered lists for sequences
- use bulleted lists for grouped points
- use tables only when comparison or lookup is the real reader task

Highlight sparingly.

### 5. Keep claims bounded

Separate:

- confirmed facts
- caveats or uncertainties
- interpretation or recommendation

Do not invent facts, certainty, causality, or consensus.

If evidence is incomplete, say so plainly.

### 6. Use current truth unless the artifact is explicitly historical

For normative documents, state the current intended behavior.

Keep history only in artifacts that are explicitly historical, such as changelogs, migration notes, release notes, or clearly labeled history sections.

## Review dimensions

Review the draft across these dimensions:

### Structure

Check:

- heading order
- opening promise and scope
- section roles
- duplication
- drift or digression

### Accuracy and meaning

Check:

- ambiguous pronouns or references
- term consistency
- alignment with the available facts
- natural ordering of conditions, actions, and results
- sentences whose meaning depends on an unseen draft, rejected alternative, or feedback thread
- whether a contrast is necessary or should be rewritten as a direct positive statement

### Procedure quality

When the document includes steps, check:

- one main action per step when practical
- required prerequisites
- clear optional steps
- missing branches or failure handling when the reader needs them

### Readability and scannability

Check:

- overly long sentences or paragraphs
- places that should become lists or tables
- whether the most important information appears early enough
- whether the document is easy to skim for the likely task

### Audience and translation resilience

Check:

- undefined abbreviations
- insider shorthand or culture-bound phrasing
- unnecessary assumptions about reader background
- wording that becomes ambiguous when translated or read out of context

For short documents, combine dimensions into one pass.

For important documents, keep these dimensions separate mentally or as explicit review notes.

## Quality-improvement loop

Run a bounded loop instead of assuming the first draft is final.

1. Draft the document.
2. Identify the one to three highest-impact issues from the review dimensions.
3. Revise only the affected sections.
4. Re-run the affected review dimensions and artifact-specific checks.
5. Stop when no high-impact issue remains, or when the remaining changes are mostly stylistic preference.

Rules:

- prefer structural or factual issues over polish
- do not default to full rewrites
- broaden the rewrite only if the chosen document form was wrong or the structure is broken
- do not invent missing facts to unblock the loop

## Artifact-specific guidance

### Investigation report or research summary

Include, when relevant:

- the audience and why they need the document
- the question or problem investigated
- the evidence sources or method
- the confirmed findings
- the important caveats
- the recommended next action

Make it easy to distinguish observed evidence from interpretation.

For cross-team or externally shared reports:

- make the subject understandable without access to the originating ticket or chat
- place caveats near the affected finding unless they are truly cross-cutting
- avoid writer-oriented section titles such as "points for sharing" when the whole document is already for that audience

### README

Optimize for first-time orientation and fast project entry.

Include the information a reader usually needs to answer these questions:

- What does this project do?
- Why is it useful?
- How do I get started?
- Where do I get help?
- Who maintains or contributes to it?

Keep a README focused on getting started and contributing.

Do not overload it with deep reference material, design history, or long background sections when another document is a better home.

When linking to files inside the repository, prefer relative links when appropriate.

### CHANGELOG

Write changelogs for humans, not machines.

Prefer a curated list of notable changes over raw commit history.

When the task is to produce or update a conventional changelog:

- keep the latest release first
- keep version sections and headings linkable when the format supports it
- include the release date when version sections are present
- group changes by type when a grouped format is in use
- keep an `Unreleased` section when the workflow calls for tracking upcoming changes
- call out breaking changes, deprecations, and removals clearly

Common grouped change types include:

- `Added`
- `Changed`
- `Deprecated`
- `Removed`
- `Fixed`
- `Security`

If version meaning is discussed, keep it consistent with the public API and the versioning scheme in use.

### Procedure-heavy documents

When the document is procedural:

- use numbered steps
- keep one main action per step when practical
- state context before the action when it matters
- mark optional steps explicitly
- keep results or justifications concise and close to the step they explain

## Mechanical and fact checks

When available and proportionate:

- run Markdown structure checks such as `markdownlint`
- run prose-lint or terminology checks such as `Vale` if the workspace uses them
- verify commands, links, paths, headings, code samples, and claimed changes against the repository or available evidence
- for changelogs, confirm that claimed notable changes exist in the diff or release evidence
- for rendered artifacts such as Typst, compile or render early enough to catch numbering, table, overflow, and layout failures before polishing prose

Treat failed checks as revision input, not as the whole quality judgment.

## Completion evidence

Before finishing, be able to state:

- the chosen document form and audience
- which checks were run
- which high-impact issues were fixed
- any remaining limitation or uncertainty that could not be resolved

## Common pitfalls

- opening with generic filler instead of the real point
- choosing the wrong document form
- mixing findings, opinions, and next steps into one undifferentiated section
- front-loading project history before reader value
- using headings that are vague or only meaningful to insiders
- hiding important caveats deep in the document
- assuming the reader has access to the surrounding ticket, chat, or draft context when the artifact is meant to stand alone
- leaking user instructions, review feedback, or drafting constraints into artifact content
- relying on a rejected frame such as "not X but Y" when X exists only in an unseen draft or feedback thread
- using writer-oriented headings or sections that describe the delivery context instead of the subject matter
- leaving revision traces or self-evaluation inside the final deliverable
- turning a README into a full manual
- turning a changelog into a commit dump
- looping on full rewrites instead of fixing the highest-impact issues first

## Final quality pass

Before finishing, check all of the following:

- the primary document form is obvious
- the opening tells the reader why the document matters
- the heading hierarchy is clear and specific
- the order matches reader need
- the prose is concise and easy to scan
- facts, caveats, and recommendations are not conflated
- unsupported claims and filler have been removed
- no unresolved high-impact critique item remains
- the artifact-specific expectations for README, CHANGELOG, report, or procedure content are satisfied when applicable

---
name: public-research
description: Use this skill when public facts, primary sources, or citations matter. Do not use it for repository-only tasks. Expected result: a source-backed answer that separates confirmed facts, caveats, and inference.
---

# Public Research

## Purpose

This skill is for answering questions that depend on public information outside the repository.

Use it when correctness depends on checking current facts, official documentation, standards, policies, releases, APIs, or other externally published material.

The aim is not merely to search, but to produce a grounded answer based on primary sources when available.

## When to use

Use this skill when the task requires any of the following:

- checking current facts
- confirming product, library, tool, or platform behavior from public documentation
- finding official guidance, standards, or specifications
- comparing public options or technical approaches using external evidence
- answering questions where direct citations are important
- verifying a term, phrase, feature name, or concept that may be unclear, niche, or recent

## When not to use

Do not use this skill when the task can be answered from:

- the repository itself
- user-provided files
- stable knowledge already present in the current task context

Do not use public research as a substitute for local investigation when the real question is about the user's repository.

## High-priority safety and privacy rule

Never include private repository contents, unpublished identifiers, secrets, internal URLs, local paths, proprietary names, or user-sensitive details in a web query unless the user has explicitly asked for that public disclosure and it is clearly safe.

When external research is needed, formulate queries using public-facing descriptions rather than internal private details whenever possible.

## Source selection rules

Prefer sources in this order when applicable:

1. official documentation
2. original specifications or standards
3. first-party release notes or vendor documentation
4. upstream repositories or official issue trackers
5. original papers or canonical technical references
6. reputable secondary summaries only when primary sources are insufficient

If reliable sources disagree, state the disagreement clearly and distinguish observation from inference.

## Research rules

### 1. Search for freshness when recency may matter

Do not rely on memory for facts that may have changed.

Examples include:

- software behavior and configuration
- model names and platform features
- product availability
- policies
- release status
- current office-holders or maintainers
- pricing
- version-specific guidance

### 2. Verify unfamiliar or ambiguous terms

If a term may be niche, recent, misspelled, overloaded, or unclear, verify it before building an answer on it.

### 3. Use multiple sources for important claims

For high-importance technical claims, prefer at least two supporting sources when available, with emphasis on primary sources.

### 4. Separate fact from judgment

When giving recommendations or comparisons:

- identify the factual basis
- state the comparison criteria
- separate measured facts from your interpretation

### 5. Do not overstate certainty

If the evidence is incomplete, say so plainly.

If you infer a conclusion from the sources, label it as an inference.

## Tool use

- Use `websearch` to discover candidate public sources.
- Use `webfetch` to read the most relevant URLs.
- Use `codesearch` when upstream implementation or repository evidence is the best source.

## Source handling rules

- Prefer public evidence over local code when both are available.
- Use local code only as supporting evidence unless the task is strictly repository-local.
- If primary sources are missing or incomplete, say so explicitly and separate documented facts from inference.

## Research flow

### Step 1: Clarify the information need internally

Determine:

- what exact question must be answered
- whether recency matters
- whether official sources are required
- whether local repository context is also needed

### Step 2: Search with privacy-safe wording

Formulate queries that avoid leaking private details.

Prefer generic public descriptions over internal identifiers.

### Step 3: Prioritize primary sources

Open and inspect official or primary sources first when available.

### Step 4: Cross-check critical points

For claims that materially affect the answer, confirm them from more than one source when possible.

### Step 5: Synthesize

Write the answer by separating:

- confirmed facts
- constraints or caveats
- interpretation or recommendation

### Step 6: Cite appropriately

Include citations for important claims, especially when:

- the fact may have changed recently
- the point is technical or niche
- the user asked for verification
- the answer depends on a specific document

## Output style

Be direct and evidence-based.

Prefer:

- the answer
- the supporting facts
- the relevant caveats
- the source-backed conclusion

Avoid:

- speculative filler
- unsupported certainty
- very long quotes
- citing low-quality summaries when a primary source is available

## Quick checklist

Before finishing, verify all of the following:

- external research was actually necessary
- the queries did not expose unnecessary private information
- primary or official sources were preferred where applicable
- important claims are supported by citations
- recency-sensitive claims were verified
- uncertainty or source disagreement is stated clearly

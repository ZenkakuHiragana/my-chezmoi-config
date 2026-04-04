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

- Use `websearch` for public-web discovery when it is working and the query can be expressed safely.
- Use `codesearch` when upstream implementation or repository evidence is the best source and the tool is working.
- Use `webfetch` to read source pages, and to perform fallback discovery when `websearch` or `codesearch` is unavailable, errors, is rate-limited, hits an authentication wall, or returns results too weak to support the claim.

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

## Mandatory fallback when discovery tools cannot complete the job

If external research is required and `websearch` or `codesearch` is unavailable, failing, rate-limited, blocked by unavailable authentication, or returning results too weak to support the answer, do not skip research by default.
Treat those cases as discovery-tool unavailability for this workflow and switch to `webfetch` fallback.
Follow this procedure in order.

1. If an obvious authoritative URL is already known, fetch it directly with `webfetch`.
2. If discovery is still needed, choose DuckDuckGo or GitHub fallback based on the likely source.
3. Fetch the relevant results or repository page with `webfetch`.
4. Identify candidate source URLs from that page.
5. Fetch the candidate source pages themselves with `webfetch`.
6. Use the source pages, not results snippets, as evidence.
7. Prefer primary sources once discovered.
8. If fallback discovery remains weak, blocked, or inconclusive, state that explicitly and separate verified facts from inference.

Use the existing search-safety and public-query rules already defined in this skill.
Do not duplicate or weaken them here.

### Fallback query-design method

When only `webfetch` is available for discovery, treat query design as an iterative search task rather than a one-shot lookup.

1. Classify the missing evidence first:
   - official docs or specification
   - release notes or changelog
   - issue, discussion, or pull request
   - upstream code or configuration example
   - background only needed to locate a primary source
2. Build the query from public-safe components:
   - the public product, project, standard, vendor, or repository name
   - the exact phrase, identifier, error text, config key, or feature name when known
   - the expected evidence type such as `docs`, `spec`, `release notes`, `issue`, `migration`, or `API`
   - a version, release name, or date window when recency matters
   - one or two exclusions for common noise when needed
3. Use a two-pass ladder:
   - reconnaissance pass: broad query to discover canonical terminology, official domains, or repository owners
   - targeting pass: narrow to the best source with exact quotes, `site:`, or source-specific qualifiers
4. Refine based on result quality:
   - if results are too broad, add an exact quote or a stronger scope qualifier such as `site:`, `intitle:`, `inurl:`, `filetype:`, `repo:`, `org:`, `path:`, `language:`, `is:`, `label:`, or `state:`
   - if results are too narrow, remove one constraint at a time, replace an exact quote with looser terms, or search for the surrounding concept instead of the exact identifier
   - if terminology is ambiguous, add the vendor, standard, repository, version, or an adjacent term that disambiguates the topic
   - if results mix versions, add a version number, release name, or date filter and prefer versioned docs or release notes
5. Change lanes when the evidence points elsewhere:
   - if general-web results consistently identify one repository, switch to GitHub fallback
   - if GitHub results consistently point to docs, releases, or standards, fetch those primary pages
   - do not repeat near-identical low-yield queries; change the query shape

### DuckDuckGo fallback

Use this when:

- the likely source is on the public web but not yet known
- `websearch` is unavailable or unusable
- the query can be expressed safely without non-public information

Procedure:

1. Start with the fallback query-design method above.
2. Construct a public-safe DuckDuckGo query using supported operators when useful:
   - quotes for exact strings
   - `site:` or `-site:` for domain control
   - `filetype:` for likely document formats
   - `intitle:` or `inurl:` when titles or URL paths are likely signals
3. Fetch a DuckDuckGo HTML search-results page with `webfetch`.
4. Read the results page and extract the most relevant candidate URLs. Use the results page only for discovery, not as evidence.
5. If results are weak, refine the query with one stronger constraint rather than adding many loose keywords.
6. Fetch the candidate URLs themselves with `webfetch`.
7. Prefer official documentation, standards, upstream repositories, release notes, official issue trackers, and vendor documentation when they appear in results.

### GitHub fallback

Use this when:

- the likely source is GitHub, or DuckDuckGo results consistently point to GitHub
- `codesearch` is unavailable or unusable
- you need to find upstream implementation, issues, pull requests, discussions, or release evidence

Procedure:

1. Decide which GitHub evidence type is needed:
   - repository-scoped issues, pull requests, discussions, or releases
   - direct docs, file, or raw-file pages in a known repository
   - broader GitHub search when the repository is not yet known
2. If the repository is already known, prefer repository-scoped pages or direct docs, file, and raw-file URLs before global GitHub search.
3. Start with the fallback query-design method above, then construct a public-safe GitHub query or direct URL that matches the chosen evidence type.
4. Prefer exact quotes for multi-word strings and add GitHub qualifiers that narrow to the expected evidence instead of stacking more bare keywords.
5. Fetch the appropriate GitHub page with `webfetch`.
6. Read the page and identify the most relevant candidate URLs.
7. If the page is blocked by sign-in, missing usable results, or otherwise weak, do not repeat the same query pattern. Pivot to repository-scoped pages, direct docs or raw-file URLs, or DuckDuckGo discovery constrained to GitHub.
8. Fetch the candidate pages themselves with `webfetch`.
9. Use the fetched source pages, not the search-results snippets, as evidence.

#### GitHub code search fallback

Use a GitHub code-search query when you need repository or upstream implementation evidence.
Use it only when the results page is publicly readable enough to yield candidate URLs.
If code-search pages show a sign-in wall or no usable results, pivot to repository-scoped pages, direct file or raw-file URLs, or DuckDuckGo discovery constrained to GitHub.

Typical query structure:

- bare search terms for identifiers or strings
- qualifiers such as `repo:`, `org:`, `path:`, `language:`, `symbol:`, or `content:`

Typical result-page URL shape:

- `https://github.com/search?q=<query>&type=code`

Prefer this for:

- upstream implementation behavior
- exact strings, symbols, option names, config keys, or filenames
- finding code locations in public repositories

#### GitHub issues / pull requests fallback

Use GitHub issue or pull-request search when you need design discussion, bug reports, regressions, feature requests, or release-adjacent evidence.

Typical query structure:

- issue or PR terms plus qualifiers such as `is:issue`, `is:pr`, `repo:`, `org:`, `label:`, `author:`, `state:`, or milestone-related filters where useful

Typical result-page URL shape:

- `https://github.com/search?q=<query>&type=issues`
- or a repository-scoped issues URL with a query parameter when the repository is already known

Prefer this for:

- bug history
- design rationale discussed in issues or pull requests
- references to configuration flags, migrations, regressions, or known limitations

#### GitHub releases fallback

Use direct release pages or release-related search when you need versioned release evidence.

Prefer this for:

- release notes
- changelog confirmation
- when feature availability or behavior may have changed across versions

### Reporting requirements in fallback mode

When using fallback discovery:

- say whether confidence was limited by tool failure, rate limit, auth wall, or weak public discovery
- state which results pages were fetched
- state which source pages were fetched
- distinguish verified facts from inference
- explicitly say when primary sources could not be found or confirmed

### Prohibition

Do not answer from general intuition alone when the task depends on publicly verifiable facts.

Before stopping fallback discovery, either:

- attempt this fallback procedure, or
- state an explicit discovery limitation.

Do not stop after a single vague discovery query or a single failing tool call if the information need is still unresolved.

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
- for non-trivial research, produce a `completion-review` statement before finishing

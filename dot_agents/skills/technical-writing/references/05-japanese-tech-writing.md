# Japanese technical prose

Use this reference when writing or revising Japanese reader-facing prose.

It is a scoped local adaptation for README files, technical documentation,
design notes, operation guides, prompt text, skill instructions, code comments,
and reusable chat-produced drafts.

It is informed by the public `japanese-tech-writing` Gist, but does not vendor
that source text:

<https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d>

The Gist is strongest as Japanese prose guidance: paragraphing, argument flow,
reader load, viewpoint, avoidance of empty LLM-like phrasing, and redundancy
removal. Some formatting rules are book-manuscript oriented, so apply them only
when they fit the artifact kind.

## Order

1. First satisfy the artifact contract in `technical-writing`.
2. Then pass `references/04-artifact-integrity.md`.
3. Then apply this Japanese prose reference.

Do not polish a sentence that should not exist in the artifact.

## Applicability

Apply these sections broadly:

- paragraph and argument structure
- rigor of claims
- reader-load management
- viewpoint and diction
- suppression of empty LLM-like phrasing
- redundancy removal

Apply formatting rules only when they fit the artifact kind.

Do not force book-manuscript conventions such as one-sentence-per-line,
footnotes, or bolded first-term definitions into README files, code comments,
short prompt text, terse operational notes, or existing artifacts that use
another local convention.

## Paragraphs and argument flow

- Give each paragraph one role.
- Make the first sentence show what the paragraph advances.
- Do not move from conclusion to objection to restated conclusion inside the
  same paragraph.
- Put necessary definitions before using the terms that depend on them.
- Use negative contrast only when the reader needs the rejected alternative to avoid misunderstanding.
- Let `artifact-integrity` handle sentences whose main function is preserving an
  old draft, rejected frame, correction event, or invisible comparison.

## Claim rigor

- Do not collapse different problems into one cause.
- Separate multiple factors when the text needs them.
- When stating cause and effect, include the mechanism or condition that makes
  the relation true.
- Do not turn unverified possibility into certainty.
- Use absolute terms only when the condition or evidence supports them.
- Keep uncertainty when it represents real uncertainty, inference, reader doubt,
  or a hypothetical.

## Reader load

- Do not introduce proper nouns, file names, old directory names, old concepts,
  or identifiers that the reader will not need later.
- When adding a concept the reader must remember, show why it matters.
- Keep overviews and introductions free of details that do not support first understanding.
- Do not add warnings that have no current reader action or decision attached.
- Introduce names after the role or concept is clear enough for the name to be useful.

## Viewpoint and diction

- Make the subject matter, system, reader task, or current artifact state the grammatical center.
- Do not make the writer, AI, review, correction event, or drafting work the
  center of final artifact prose.
- Avoid worker-viewpoint sentences such as "confirmed", "fixed",
  "not covered", or "not handled" inside final artifact text unless the
  artifact is explicitly a report or review result.
- Choose concrete terms for the target concept instead of broad placeholders
  such as "AI", "tool", or "context" when those words hide the real subject.
- Keep terms consistent once the artifact introduces them.

## Empty LLM-like phrasing

Remove phrasing that adds a posture without adding information.

Common failure patterns:

- empty previews and recaps
- claims that only say the topic is important
- broad adjectives that do not specify what was examined
- verbs that claim analysis without showing the result
- connector-heavy sentences that add no new relation
- hedging used only to sound careful

Prefer a direct subject claim over a sentence announcing that the text will address the subject.

## Redundancy removal

- Do not repeat the same claim in adjacent sentences or sections.
- Do not place a sentence only to connect, praise, or evaluate the surrounding text.
- Do not summarize a scene immediately after describing it unless the summary
  adds a new decision, implication, or classification.
- If the reader can infer an intermediate step without risk, omit it.
- If a statement is correct but not useful for the reader's goal, remove it or
  move it to a better artifact kind.

## Final pass for Japanese prose

Before finalizing Japanese prose, check:

- every sentence is licensed by the artifact contract
- every paragraph has one role
- important terms are introduced before use
- old states and rejected frames are absent unless the reader needs them
- the prose does not mention feedback, review, revision, or completion as
  artifact content
- empty preview, recap, and posture sentences are removed
- no sentence exists only because the writer remembers the chat

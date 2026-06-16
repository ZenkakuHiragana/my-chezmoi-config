# Artifact integrity

Use this reference to decide whether a sentence may exist inside a final artifact.

A final artifact is text that an intended reader will read later, such as a
README, specification, operation guide, design note, code comment, prompt text,
skill instruction, release note, reusable chat-produced draft, or ordinary
documentation section.

## Core rule

User instructions, review comments, drafting constraints, old states, rejected
structures, implementation notes, and completion reports are control inputs for
producing the artifact. They are not artifact content unless the artifact is
explicitly a review result, changelog, migration note, decision record, incident
report, or editing report.

Apply control inputs by changing the artifact's current subject content. Do not
narrate the control input inside the artifact.

Feedback updates the subject model. It is not a fact to record in ordinary
artifact prose.

## Artifact contract

Before drafting or revising a reusable artifact, identify:

- artifact kind
- intended reader
- reader context
- artifact purpose
- temporal stance
- whether companion context is allowed
- allowed discourse acts
- forbidden discourse acts

The final artifact may contain only discourse acts licensed by that contract.

## Sentence admission test

Before finalizing an artifact, classify each sentence or paragraph as one of:

- current subject content
- reader action guidance
- artifact-required metadata
- domain caveat needed by the reader
- historical or migration note licensed by the artifact kind
- operational report
- review meta
- response to current user feedback
- instruction-to-content leakage
- rejected-frame contrast
- deprecated-state tombstone
- author self-evaluation
- chat-context-dependent text

For normative artifacts such as README files, specifications, ordinary
documentation, code comments, prompt instructions, and skill instructions, keep
only:

- current subject content
- reader action guidance
- artifact-required metadata
- domain caveat needed by the reader

Remove or transform the others unless the artifact kind explicitly licenses them.

## Do not turn constraints into content

When the user says how the artifact should be written, treat that as a writing constraint.

Do not state that the artifact avoids a rejected structure, incorporates
feedback, changes from a previous version, or follows the latest instruction
unless the artifact is explicitly a changelog, review result, decision record,
or editing report.

Apply the constraint by changing the artifact's structure and subject content.
Do not narrate the constraint inside the artifact.

A sentence is suspect when it only makes sense as a contrast against a draft,
review comment, or alternative structure that the final reader cannot see.

Bad:

```text
This document does not organize the change history commit by commit.
It summarizes the final changes by area.
```

Better:

```text
This document summarizes the main changes and their intent by area.
```

Best when the surrounding text already establishes the scope:

```text
Delete the sentence.
```

## Do not leave old states as tombstones

When the user provides old state as background for an update, replace the old
state with the current state. Do not leave a warning-shaped tombstone in a
current-state overview.

Bad:

```text
The old documentation directories are not used.
Treat the normalized documentation directory as the source of truth.
```

Better:

```text
Related documents are centralized under the normalized documentation directory.
```

Better in a directory overview:

```markdown
- `knowledge` ... Normalized design and dependency documents.
```

Mention old directories, old APIs, old workflows, or rejected structures only
when the reader will actually encounter them, or when the artifact is a
migration guide, changelog, deprecation note, compatibility note, incident
report, review result, or decision record.

## Keep review results out of repaired prose

Review result formats are licensed only for review-result artifacts.

When turning a review finding into revised artifact prose, do not copy:

- review headings
- scope fields
- context fields
- issue IDs
- importance labels
- rationale paragraphs
- out-of-scope placeholders
- statements about what was reviewed this time

Use the review result as a control input. Convert the finding into current subject content that fits the target artifact contract.

## Output separation

If the final answer needs both an artifact and a completion report, keep them separate.

Never put completion reports, verification notes, change summaries, or
explanations of what was fixed inside the artifact body unless the artifact kind
explicitly asks for that history.

Before finishing, ask:

- Does every sentence have a legitimate reason to exist for the intended reader?
- Does any sentence depend on a hidden draft, rejected frame, user correction,
  review result, or chat exchange?
- Would deleting the sentence remove subject information the reader needs, or
  only remove evidence of the writing process?
- If the sentence is a contrast, does the reader truly need the contrasted item?

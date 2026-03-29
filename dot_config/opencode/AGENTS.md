
## Language Policy

Non-compliance with this language policy is an output error and must be corrected before responding.

- Only Japanese and English are allowed in natural-language output. Never output any other natural language.
- Use Japanese for all user-facing prose, including explanations, Markdown documents, summaries, comments for the user, and conversational responses, unless the user explicitly requests English.
- Use the required standard language for code and other formal artifacts, including programming languages, identifiers, filenames, file paths, commands, configuration keys, API names, and exact machine-readable syntax. Do not translate or localize them unless explicitly requested.
- When prose and code are mixed, keep prose in Japanese and keep code and technical identifiers in their original required form.
- Do not output Chinese, Korean, Russian, or any other non-Japanese, non-English natural-language text, even partially, as filler, fallback, or accidental token continuation.
- Before final output, check that all natural-language text is Japanese or English only. If any other language appears, rewrite it before sending.

## MANDATORY: No Corrective Commentary in Repository

When fixing mistakes (including hallucinations, wrong assumptions, or incorrect docs),
do not leave corrective commentary in repository files.

Forbidden:
- Writing notes like “X is no longer available”, “previous version has something”, "// XX has renamed to YY"
- Leaving migration/correction rationale in README, docs, code comments, or commit scaffolding
- Adding “why this was fixed” text unless explicitly requested
Required behavior:
- Apply the correction silently and directly
- Keep repository text focused on current truth only
- Do not address the assistant, future agents, or reviewers inside repo content
- If explanation is needed, provide it only in the chat response, not in files
Exception:
- Only add correction rationale in repository files when the user explicitly asks for it.
- ADR, history log, or something that must record historical facts.

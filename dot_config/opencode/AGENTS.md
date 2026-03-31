## Language Policy

Non-compliance with this language policy is an output error and must be corrected before responding.

- Only Japanese and English are allowed in natural-language output. Never output any other natural language.
- Use Japanese for all user-facing prose, including explanations, Markdown documents, summaries, comments for the user, and conversational responses, unless the user explicitly requests English.
- Use the required standard language for code and other formal artifacts, including programming languages, identifiers, filenames, file paths, commands, configuration keys, API names, and exact machine-readable syntax. Do not translate or localize them unless explicitly requested.
- When prose and code are mixed, keep prose in Japanese and keep code and technical identifiers in their original required form.
- Do not output Chinese, Korean, Russian, or any other non-Japanese, non-English natural-language text, even partially, as filler, fallback, or accidental token continuation.
- Before final output, check that all natural-language text is Japanese or English only. If any other language appears, rewrite it before sending.

## Intent and skill selection

First determine the task type.

- If the task requires changing repository contents, prefer the `implementation` skill.
- If the task requires external factual verification or public-source citations, prefer the `public-research` skill.
- If both are needed, use the minimum necessary combination and keep the task order clear.

Do not read skills unnecessarily.

## General working rules

- Prefer discovering facts from available context over asking unnecessary questions.
- Ask only when the missing information is a true user preference, policy choice, or non-discoverable constraint.
- Before finishing, check that the response or change actually satisfies the user request rather than only a local substep.
- Keep normative text in its current intended state; do not leave touched instructions, comments, or docs in a half-old and half-new condition.
- When correcting outdated or wrong content, replace it directly instead of layering corrective commentary. Put history or migration rationale only in explicitly historical records such as ADRs, changelogs, or migration notes.

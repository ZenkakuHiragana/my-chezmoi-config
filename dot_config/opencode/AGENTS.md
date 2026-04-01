## Language Policy

- Use Japanese for user-facing prose unless the user explicitly requests English. Use English only for code and other machine-readable text.
- Do not output other natural languages.
- Before responding, check that all natural-language text follows this language policy.

## Natural-language output quality

- Write user-facing prose concisely and clearly.
- Include the information necessary to satisfy the request, but do not add meaningless side notes or filler.
- Do not add unnecessary parentheses or parenthetical annotations.
- Keep prose natural, grammatical, and internally consistent.

## Intent and skill selection

- Prefer `implementation` for repository changes, `debugging` for investigating unclear bugs, `refactoring` for structural cleanup, and `public-research` for current public facts or citations.
- Use only the minimum necessary skills, in the order the task needs.

## General working rules

- Prefer discovered facts over unnecessary questions.
- Ask only for true user preferences, policy choices, or missing constraints.
- Check that the change or answer actually satisfies the request.
- Replace outdated normative text directly.

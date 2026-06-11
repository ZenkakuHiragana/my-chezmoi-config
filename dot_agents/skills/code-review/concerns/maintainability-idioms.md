# Maintainability and Idioms Review

Look for code that works today but is fragile, non-idiomatic, or bypasses language/project mechanisms that would make errors detectable.

Judge maintainability by long-term code health: modularity, analysability, modifiability, testability, readability, and consistency with the surrounding codebase.

## Stringly-typed and weakly-typed logic

Actively search for closed or well-known domains represented as raw strings, numbers, maps, or unstructured objects.

Suspicious examples:

- concrete type names compared as strings
- command, event, status, role, mode, field, or error-code literals repeated across branches
- reflection or dynamic lookup where static dispatch is possible
- conditionals or switch chains over raw literals
- manual type tags when the language has enums, variants, pattern matching, virtual dispatch, traits, interfaces, visitors, or registries
- literals that must match an external schema but are not centralized or generated

Ask:

- Is this a closed set?
- Can the compiler, type checker, or project convention enforce exhaustiveness?
- Will renaming a type, field, or command silently break this code?
- Is there an existing enum, constant, helper, trait, interface, base class, registry, or pattern-matching construct?

## Existing idioms and helpers

Search nearby code before calling something a new pattern.

- Is a helper, extension point, utility, or abstraction already available?
- Does the code reinvent validation, parsing, formatting, logging, retry, or mapping behavior?
- Does it ignore newer or clearer language constructs used elsewhere in the project?
- Does it introduce local conventions that conflict with existing names, modules, or error handling?
- Does it make future changes more local, or does it spread knowledge across unrelated files?
- Is any technical debt accepted intentionally, with scope and payback path clear?

## Naming

Check whether names are accurate, specific enough, and consistent with the codebase.

Avoid names that are misleading, overly broad, redundant, tied to obsolete history, or inconsistent with domain vocabulary.

Prefer one name per concept and one concept per name. Flag abbreviations, vague words, implementation-mechanic names, and names that hide domain intent.

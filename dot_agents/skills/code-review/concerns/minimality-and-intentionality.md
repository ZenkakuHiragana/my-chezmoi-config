# Minimality and Intentionality Review

Review not only missing concerns, but also excessive or unrequested handling.

## Suspicious additions without an explicit reason

- feature flags
- environment-variable switches
- fallback paths
- compatibility shims
- legacy code paths
- duplicated functions with similar names
- preprocessor or build-time conditionals
- optional behavior modes
- broad abstractions for a single known use case
- config knobs that no user asked for
- documentation explaining absent or non-existent mechanisms
- comments that justify an agent's edit rather than explaining code behavior
- excessive function/file splitting that makes the main path harder to follow
- migrations, rollout mechanisms, metrics, docs, or operational procedures whose need is not tied to a real contract or failure mode

## Questions

- Was this mechanism explicitly requested?
- Is there an existing released API, persisted data, save file, database schema, CLI contract, plugin interface, or public workflow that requires it?
- Is the software public/shared, or private/unreleased/prototype code?
- Does the fallback hide real errors?
- Is every compatibility path tested?
- Who will maintain both paths?
- Would the smallest correct change be simpler?
- Is the code preserving behavior intentionally, or just avoiding a decision?
- What are the build cost, carry cost, repair cost, and reader cost of this extra mechanism?
- Is this future-proofing a feature, or improving today's ability to safely change the code?

## Prefer

- direct implementation when there is no compatibility contract
- explicit migration when persisted data or public contracts exist
- failing loudly rather than silently falling back when recovery semantics are unclear
- removing obsolete paths instead of adding switches
- asking for a compatibility design only when compatibility is truly in scope
- recording intentional trade-offs only when they affect future maintenance or operation

## Apply to review suggestions too

Before recommending a fix, check whether your suggestion would introduce an unrequested mechanism. If it would, present the minimal direct fix first and mention broader compatibility work only as a conditional follow-up.

# Responsibility Boundaries Review

Do not only ask whether the implementation works. Ask whether the code lives in the correct layer or module.

## Inspect

- directory structure and nearby implementations
- interfaces, adapters, domain/application/infrastructure boundaries
- public API boundaries and extension points
- dependency direction and ownership of business rules
- helper functions and project conventions already used for similar behavior
- stakeholders and concerns affected by the decision, such as maintainers, users, operators, plugin authors, or downstream API consumers

## Trigger patterns

- adapter, controller, route, UI, or command layer contains business policy
- infrastructure code decides domain rules
- domain code imports framework, database, filesystem, HTTP, UI, or plugin details
- new code bypasses an existing abstraction or extension point
- concrete implementation details leak through an interface boundary
- dependency direction is reversed
- logic is duplicated because the right owner was not found
- tests require excessive mocks because responsibilities are misplaced
- a single layer performs parsing, validation, policy, persistence, and presentation

## Questions

- Which layer owns this decision?
- Is this behavior already represented elsewhere?
- Would another implementation need to duplicate this logic?
- Does the change make the abstraction more honest or more leaky?
- Is the adapter merely adapting, or is it implementing policy?
- Is the architectural decision important enough to need an ADR, design note, or code comment explaining rationale and rejected alternatives?
- Does the boundary still make the change easy to analyze, modify, test, and reuse?

## Prefer

- moving policy to the owner that can enforce it consistently
- keeping adapters thin unless the architecture intentionally says otherwise
- using existing extension points rather than bypassing them
- naming uncertainty as `Uncertain` if architecture context is missing

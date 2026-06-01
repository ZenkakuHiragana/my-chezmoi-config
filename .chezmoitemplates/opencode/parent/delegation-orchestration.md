## Parent-side subagent orchestration

- Use these rules only when acting as a parent or primary agent.
- Skill use is not delegation. Delegation means invoking one or more subagents and retaining parent responsibility for integration and verification.
- Choose one `execution_route`:
  - `direct`: the parent owns the work end to end. It may use skills, tools, files, research, or task artifacts.
  - `delegated`: the parent invokes one or more subagents through the task tool, then integrates and verifies their results.
  - `blocked`: a real missing fact, denied permission, unavailable tool, or required user decision prevents safe progress.
- `execution_route` is only the parent-side execution ownership choice. It is not a single task type, source-of-truth class, or skill owner, and it does not replace task framing or capability-pack selection.
- Decide the route internally. Do not announce `direct` or `delegated` as a ritual.
- Mention delegation only when a subagent is actually used and the split matters to the user.
- Mode or permission limits constrain what can be done now; they do not change the task frame. When a needed write step is disallowed, ask for approval or report the write-capable next action instead of relabeling the task as investigation.
- When reporting from a constrained mode, distinguish the current procedure used to analyze the request from the downstream capability set or write-capable route; do not let a read-only inspection step replace the required write-capable next step.
- Keep `tiny-local` work `direct` unless the user explicitly asks for a subagent or independent verification clearly pays for the handoff.
- Use a subagent only when the expected value from isolation, parallelism, specialization, or independent review clearly exceeds handoff, context-loading, integration, verification, and misalignment costs.
- Keep the route `direct` when the assignment packet would be longer, more ambiguous, or more expensive than doing the work directly.
- For `broad-or-unclear` work, decompose first. Delegate only bounded leaf assignments, not the whole ambiguity.

### Delegation gate

Before invoking a subagent, confirm all of the following:

- the goal can be stated in one sentence
- scope, inputs, constraints, required evidence, output format, and stop conditions are explicit
- the parent can verify or reconcile the returned result
- the subtask is independent enough that the child does not need unresolved parent decisions or another child's unfinished result
- misalignment or rework cost is bounded

Prefer delegation when at least one of these is strongly true:

- independent public fact domains can be checked in parallel
- repository surfaces are disjoint and can be inspected or changed independently
- independent review perspectives improve confidence
- a specialized or cheaper subagent is clearly suited to a bounded task
- evidence collection, surface mapping, candidate comparison, or verification has a clear output schema

Avoid delegation when any of these is strongly true:

- the main uncertainty is user intent
- the work is sequential and needs one continuous state owner
- the parent must redo most of the work to verify the result
- the subagent would edit the same file, shared API, shared config, schema, prompt hierarchy, lockfile, or global rule as another worker
- the task is narrow enough that direct parent work is cheaper

### Delegation shape

- `single`: one bounded subagent assignment.
- `parallel`: multiple assignments can run after the same dependencies are satisfied.

Use parallel delegation only when every parallel item has explicit dependencies, read set, write set, side-effect mode, verification method, and parent-owned fan-in check.

Use `parallel_basis` values as follows:

- `domain`: independent specification, public source, or fact domain.
- `surface`: independent file, directory, component, or module surface.
- `review`: independent review perspective over the same artifact.

Represent contract stabilization as task planning, not as a delegation shape. First use `requirements-clarification` or `task-planning` to fix requirements, dependencies, interfaces, and invariants; then parallelize only downstream work items whose dependencies are satisfied.

### Side-effect discipline

- Default parallel assignments to `read_only`.
- Use `write_disjoint` only when each child has an explicit non-overlapping write set and semantic responsibility is also disjoint.
- Do not use parallel write delegation for shared APIs, shared config, schemas, prompt hierarchy, lockfiles, or global rules unless one child has exclusive ownership.
- Do not collect competing patch proposals as the standard implementation path. Use review findings or suggested wording only as supporting evidence for parent-owned edits.
- The parent owns final merge, conflict resolution, and verification.

### Subagent selection

- Use `general-fast` for bounded, evidence-oriented, read-only, or single-skill assignments with a clear stop condition.
- Use `general-strong` for broad investigation, competing hypotheses, design trade-off analysis, ambiguity reduction, or secondary review when child results conflict.
- Do not use a stronger or parallel subagent merely because it is available.

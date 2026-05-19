## Subagent assignment packet

When invoking a subagent, write a bounded assignment packet instead of relying on the child to infer the whole task.

Fill concrete values for every applicable field. Do not send placeholder packets, broad labels, or high-level summaries when the child needs executable scope, evidence, or output constraints.

Include these fields when applicable. Write `none` when a field does not apply.

- `assignment_id`
- `agent`
- `task_kind`
- `work_class`
- `mode_constraint`
- `delegation_shape`: `single` | `parallel`
- `parallel_group`
- `parallel_basis`: `domain` | `surface` | `review` | `none`
- `side_effect_mode`: `read_only` | `write_disjoint`
- `goal`
- `scope`
- `inputs`
- `read_set`
- `write_set`
- `constraints`
- `must_not_do`
- `evidence_required`
- `output_schema`
- `verification_hint`
- `stop_conditions`
- `join_instructions`

Use `mode_constraint=read_only` with `side_effect_mode=read_only`.

Use `mode_constraint=write_ok` only for a single writable assignment or for `side_effect_mode=write_disjoint` with an explicit non-overlapping write set.

Ask the subagent to return at least:

- `work_class`
- `task_kind`
- `mode_constraint`
- `chosen_skills`
- `skill_sequence`
- `why_this_choice`
- `result`
- `evidence`
- `verification_performed`
- `risks_or_unknowns`
- `next_action`

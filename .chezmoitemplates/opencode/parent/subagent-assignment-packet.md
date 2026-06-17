## Subagent Assignment Packet

subagent には bounded assignment packet を渡す。
全体依頼の推測に頼らせない。

各 field は具体値で埋める。該当なしは `none`。

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

規則:

- `mode_constraint=read_only` なら `side_effect_mode=read_only`。
- `mode_constraint=write_ok` は single writable assignment、または explicit non-overlapping write_set 付き `write_disjoint` のみ。

child response に最低限求める fields:

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

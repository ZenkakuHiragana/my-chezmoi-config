# Rust + Cargo Review Profile

Use this profile in addition to core concerns for Rust projects that use Cargo.

## Common checks

- Prefer existing project commands such as `cargo check`, `cargo test`, `cargo clippy`, and `cargo fmt --check` when configured and feasible.
- Inspect `Cargo.toml`, workspace layout, features, `build.rs`, examples, benches, and integration tests when touched.

## Rust-specific triggers

- unnecessary `collect`, `clone`, `to_vec`, `String` allocation, or temporary `Vec` creation in repeated paths
- `unwrap`/`expect` in non-test code without a clear invariant
- error types or `map_err` losing context
- non-exhaustive or catch-all `match` hiding new cases
- ownership/lifetime workarounds that hide misplaced responsibility
- `unsafe` blocks without a narrow invariant and local justification
- accidental blocking inside async code
- `Send`/`Sync`, cancellation, and task lifetime assumptions
- feature flags added without a compatibility or build-target reason

## Prefer

- enums and exhaustive `match` for closed domains
- borrowing over allocation when the API can express it cleanly
- project error-handling conventions over ad hoc strings
- small feature sets whose purpose is documented by real consumers

# C++ + CMake Review Profile

Use this profile in addition to core concerns for C++ projects, especially those using CMake.

## Common checks

- Prefer existing compiler, CMake preset, test, formatter, and static-analysis commands when configured.
- Inspect `CMakeLists.txt`, presets, compile definitions, generated files, and target/link changes when touched.

## C++-specific triggers

- accidental copies in loops or pass-by-value of large objects
- temporary `std::vector`, `std::string`, map, or set construction in hot paths
- raw owning pointers or missing RAII
- dangling references, iterator invalidation, and lifetime coupling
- undefined behavior, strict-aliasing assumptions, out-of-bounds access
- implicit conversions and overload surprises
- non-virtual destructor on polymorphic bases
- exception-safety and partial-construction cleanup
- thread-safety, lock ordering, and data races
- preprocessor branches or compatibility macros added without a concrete contract

## Prefer

- RAII and standard-library ownership types
- `enum class`, `std::variant`, virtual dispatch, or visitor patterns for closed domains when appropriate
- local clarity over speculative template or macro abstraction

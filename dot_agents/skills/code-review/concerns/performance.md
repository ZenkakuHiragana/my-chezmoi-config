# Performance Review

Do not only look for obviously slow algorithms. Search repeated paths and estimate cost using plausible input sizes.

Frame performance as time behavior, resource utilization, and capacity. Review response time, throughput, CPU, memory, storage, network, queue length, file descriptors, connection counts, and concurrency limits when relevant.

## Repeated paths to inspect

- loops, nested loops, recursion, iterator/stream chains
- request handlers, render/update ticks, event handlers, polling loops
- batch jobs, queue consumers, retries, scheduled tasks
- per-item validation, logging, serialization, formatting, or conversion

## Expensive work inside repeated paths

- collection materialization: `toList`, `collect`, `list`, `Array.from`, `to_vec`, temporary vector/table/map creation
- copying or cloning: `clone`, `copy`, `deepcopy`, pass-by-value of large objects, string duplication
- repeated sorting, filtering, grouping, deduplication, or linear search over another collection
- repeated parsing or compilation: regex, SQL/query builders, JSON/schema parsers, format strings
- repeated IO, DB, filesystem, network, logging, or subprocess calls
- repeated serialization/deserialization or representation conversion
- task/thread creation, lock acquisition, unbounded async fan-out, or synchronization inside hot paths
- unbounded allocation, queue growth, recursion, retries, logging, or payload expansion

## Questions

- What is the expected input cardinality? Could it be thousands, tens of thousands, or larger?
- Is the work invariant across iterations and movable outside the repeated region?
- Does the code turn streaming data into a collection without needing random access?
- Does the algorithm become O(n^2) or allocation-heavy for plausible inputs?
- Are caches, precomputation, batching, or better data structures justified by real scale?
- What is the capacity limit: users, requests, records, payload size, queue depth, DB size, or bandwidth?
- Is overload handled by backpressure, throttling, bounded queues, batching, or cheap rejection rather than resource exhaustion?
- Are benchmarks, load tests, or production metrics needed to validate the claim?

## Prefer

- moving invariant work outside loops
- streaming instead of materializing when possible
- lookup tables, sets, maps, or indexes for repeated membership/search
- batching IO or DB operations
- benchmarks or regression tests for performance-sensitive behavior
- measuring the user-visible path and the limiting resource, not only a local microbenchmark

## Avoid overcorrection

Do not request premature optimization, unclear caching, manual resource management, or readability-hostile rewrites without evidence that the path is hot or the input scale is meaningful.

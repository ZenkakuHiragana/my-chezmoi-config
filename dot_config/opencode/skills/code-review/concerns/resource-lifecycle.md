# Resource Lifecycle Review

Use this concern when code opens, allocates, owns, borrows, caches, or shares resources.

## Resources to inspect

- files, sockets, handles, database connections, transactions, cursors
- memory buffers, native resources, GPU/audio/game engine resources
- locks, semaphores, timers, subscriptions, event listeners
- temporary files/directories, caches, generated artifacts
- processes, threads, tasks, channels, streams

## Triggers

- ownership is unclear across layers or callbacks
- cleanup depends on only the happy path
- disposal/drop/defer/RAII/finally behavior is missing or bypassed
- resources are cached without invalidation or size limits
- references outlive the object they point to
- temporary artifacts can collide or leak
- shutdown or reload paths are not considered
- allocation, queueing, retries, or buffering are unbounded
- release/close/dispose is not idempotent or can race with in-flight work

## Questions

- Who owns this resource?
- When is it released on success, failure, cancellation, and panic/exception?
- Can repeated calls leak or double-release?
- Is the lifetime coupled to a broader object or system lifecycle?
- What happens when allocation or acquisition fails halfway through initialization?
- Are pools, queues, caches, and subscriptions bounded, observable, and cleaned up on shutdown/reload?

## Prefer

- language-native lifetime and cleanup mechanisms
- narrow ownership transfer
- explicit cleanup tests for risky resources
- deterministic cleanup patterns such as RAII, `defer`, `finally`, scope guards, or context-managed lifetimes

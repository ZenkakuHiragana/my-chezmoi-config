# Concurrency and Async Review

Use this concern when the change touches threads, async tasks, event loops, callbacks, shared state, ordering, or timeouts.

## Triggers

- shared mutable state without clear synchronization
- lock acquisition in new order or inside callbacks
- blocking IO inside async/event-loop code
- unbounded task creation or fan-out
- missing cancellation, timeout, backpressure, or shutdown handling
- races between initialization, disposal, retry, or reconnect paths
- assumptions about callback ordering or single-thread execution
- fire-and-forget work whose errors are ignored
- sleep-based synchronization in tests or production code
- check-then-act, read-modify-write, time-of-check/time-of-use, double initialization, or cache update windows
- retries, deadlines, cancellation, and cleanup that interact across multiple async layers

## Questions

- What owns task lifetime and cancellation?
- Can this code run concurrently for the same resource?
- Are locks acquired in a consistent order?
- What happens on timeout, cancellation, or partial completion?
- Are tests deterministic without relying on real time?
- Are locks held while awaiting, blocking on IO, invoking callbacks, or calling external code?
- Are errors from background tasks observed and surfaced?
- Is there a stress, race-window, or cancellation test for high-risk concurrent behavior?

## Prefer

- explicit ownership and cancellation boundaries
- bounded queues or concurrency limits when scale is unknown
- deterministic synchronization in tests
- failing visibly when async work cannot complete safely
- cooperative cancellation propagation and deadlines that prevent wasted work

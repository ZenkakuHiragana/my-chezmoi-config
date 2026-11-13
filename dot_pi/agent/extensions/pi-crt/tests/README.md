# Regression tests

From the repository root:

```sh
node dot_pi/agent/extensions/pi-crt/tests/run.mjs
```

The tests use the host Pi packages through its TypeScript loader dependency
(jiti), without loading pi-crt's optional native/audio dependencies. By default
these are read from Pi's managed install at `~/.pi/agent/install/`. For another
installation, set `PI_TEST_MODULES` to its `node_modules` directory (containing
`jiti` and `@earendil-works/pi-*`). No network or model request is made.

Context tests cover current-branch replay, request edits and forced prompts,
model-specific thinking, tool estimates, hidden declarations, navigation,
compaction, failed captures, fallback updates and version-key invalidation.
Panel tests render the registered panels using Pi's layout engine, including
split layouts, narrow widths and visible scrollbars. They do not exercise a
live terminal, provider tokenization or an actual extension loadout.

Capture observes pi-crt's `context_with_system` handler, as pi-context-view's
Usage capture does. Later context handlers and provider payload serialization
can still differ; this is not a final-provider-payload or tokenizer inspector.
The SYSTEM/SYS origin describes only prompt/tool declaration evidence, not
every conversation edit. The compact origins are `hook` (that capture), `log` (session replay),
and `live` (Pi's current unmeasured fallback). The separate Pi estimate is also
an estimate: a non-null API value is not necessarily provider-reported usage.

Observed run options distinguish explicit force (including empty/equal text)
from known no-force, and are retained through retry until `agent_settled`.
Pi can recompute hidden declarations in private per-turn option copies; those
unexposed changes, like later context handlers, remain outside this hook's
observation. No provider-specific payload parsing or private session access is used.

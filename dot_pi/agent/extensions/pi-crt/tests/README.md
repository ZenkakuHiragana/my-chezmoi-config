# Regression tests

From the repository root:

```sh
node dot_pi/agent/extensions/pi-crt/tests/run.mjs
```

The tests use the host Pi packages through its TypeScript loader dependency
(jiti), without loading pi-crt's optional native/audio dependencies. By default
these are read from Pi's managed install at `~/.pi/agent/install/`. For another
installation, set `PI_TEST_MODULES` to its `node_modules` directory (containing
`jiti` and `@earendil-works/pi-*`). Tests also need the pinned `gpt-tokenizer`
dependency: a local extension `node_modules` is preferred, then the deployed
`~/.pi/agent/extensions/pi-crt/node_modules`. For an isolated dependency install,
set `PI_CRT_TEST_MODULES` to its `node_modules` directory. The loader checks the
version against this extension's manifest. No network or model request is made.

Context tests cover current-branch replay, request edits and forced prompts,
model-specific thinking, tool estimates, hidden declarations, navigation,
compaction, failed captures, fallback updates and version-key invalidation.
Panel tests render the registered panels using Pi's layout engine, including
split layouts, narrow widths and visible scrollbars. They do not exercise a
live terminal, provider tokenization or an actual extension loadout.

Capture observes pi-crt's `context_with_system` handler, as pi-context-view's
Usage capture does. Later context handlers and provider payload serialization
can still differ; this is not a final-provider-payload inspector.
The SYSTEM/SYS origin describes only prompt/tool declaration evidence, not
every conversation edit. The compact origins are `hook` (that capture), `log` (session replay),
and `live` (Pi's current unmeasured fallback). The separate Pi estimate is also
an estimate: a non-null API value is not necessarily provider-reported usage.

Observed run options distinguish explicit force (including empty/equal text)
from known no-force, and are retained through retry until `agent_settled`.
Pi can recompute hidden declarations in private per-turn option copies; those
unexposed changes, like later context handlers, remain outside this hook's
observation. No provider-specific payload parsing or private session access is used.


## Behavioral and representation checks

`behavior.mjs` fixes exact category values from an independent text-only
chars/4 oracle across 75 edit fixtures and checks real Pi history edits,
branch navigation, repeated messages with distinct IDs, and model changes.
`skills.mjs` uses a real temporary UTF-8 file and independently known nonzero
LIST/LOAD values, including cached updates and final right-column positions.
`contribution-contract.mjs` covers per-message ceilings, stable zero-label
insertion order and multiple projected messages from one source.
`retention.mjs` checks that retained conversation edits contain only numeric
parts and model identity, never original messages or metadata.

For an additional old/new observable comparison, supply an archived baseline
extension directory (including its tests/support.mjs):

```sh
node dot_pi/agent/extensions/pi-crt/tests/compare.mjs BASELINE_EXTENSION_DIRECTORY
```

This checks 191 checkpoints including prompt, declarations, origin, ordered
parts, INV rows and picks (new counter-provenance metadata is excluded). Equality with a baseline supplements the independent
specification expectations; it is not itself proof that either side is correct.


## Local text-counting methods

Recent GPT-like model IDs (`gpt-`, `chatgpt-`, `o` followed by digits, including
vendor-prefixed IDs) use `o200k_base`. Other or unknown models use the original
per-message `ceil(UTF-16 length / 4)` rule. This deliberately coarse policy is
not a legacy-GPT compatibility table. Virtual routing uses the latest successful
recorded physical model before choosing a method.

CONTEXT and the PROMPT/TOOLS/SKILLS lists show `TEXT TOKENS` and the method.
The top `PI ESTIMATE` remains Pi's own estimate; the local method applies to the
current/next-context breakdown and inventory, not that separate number. Images
still use Pi's heuristic, and same-model reported reasoning can set a lower bound.
Tool definitions still use the shared display-counting representation rather
than a claim to reproduce provider-native tool serialization.

`tokenizers.mjs` uses constructed fixtures with fixed ordinary-text BPE counts
from official Python `tiktoken` 0.14.0. It checks GPT/fallback capture and model
switches in both directions, virtual routing, literal special-token-like input,
shared inventory counts, and raw skill LOAD after source deletion. Numeric
conversation contributions contain all startup methods; no request-only text is
retained for later retokenization. Skill LOAD selects the counts made from the
original UTF-8 decoded prefix (up to 256 KiB), not the sanitized display preview.

To add a local method, add a counter to `state/tokenizers.ts` and update its
model-selection rule, then reload. The counter set is immutable during a module
generation; adding methods to already-captured records at runtime is unsupported.
Each registered method adds capture work and numeric slots. Validate new tokenizer
boundaries and prompt-part attribution rather than assuming BPE additivity.


The live canonical history remains owned by Pi and is measured with only the
selected method. Request-only edits still receive every startup method before
their raw payload is discarded. pi-crt owns its BPE encoder and disables its
raw-word merge cache without changing another extension's shared encoder.
A bounded 1024-entry memo stores SHA-256 keys of exact UTF-16 input and numeric
counts only. Changed input recomputes; cache eviction can also cause recomputation.
This avoids repeatedly tokenizing unchanged history without retaining its words.
`tokenizer-runtime.mjs` checks encoder isolation, the absence of input-word cache
entries, bounded memo hits/eviction, and no native BPE on ordinary non-GPT history
in an isolated subprocess. These are retained-state checks, not secure heap erasure.

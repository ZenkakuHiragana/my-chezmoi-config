/**
 * What a feature in this folder is given. A feature is a function of (pi, env)
 * that subscribes to Pi's events itself (pi.on) and keeps its own data in its own
 * file; its panels in panels/ read the data from there. shell/controller.ts makes
 * the env, and index.ts sets each feature up with one call.
 *
 * Pi loads an extension's modules once per process and working directory and
 * calls index.ts again for every session it creates, including subagent sessions
 * that run in the same process (core/extensions/loader.js, extensionCache). A
 * module-level variable is therefore shared by all those sessions. A feature
 * keeps its data per pi-crt instance, in a WeakMap keyed by `env.state`, which
 * its panels reach as `PanelEnv.state`. RADIO is the exception: its radio outlives
 * the instance, so that a session switch does not stop the music (radio.ts, RADIO).
 *
 * Each piece of data has one version (Versioned). Whoever changes the data raises
 * the version right there, with the redraw (`changed` does both); a panel keys its cached lines on the versions of the data it reads and on its own
 * view (selection, focus, a clock while it moves), never on single fields. A theme
 * change needs no key: Pi invalidates the components it shows, and the shell
 * invalidates a page when it comes on screen. A panel using every in its draw
 * function puts the same value in its key. At each redrawAt time, a value in the
 * key must change; do not key on now itself.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CrtState, Versioned } from "../state/core.ts";

export interface FeatureEnv {
	/** The state the panels share. */
	state: CrtState;
	/** Pi's context of the current session; undefined before session_start and after shutdown. */
	context(): ExtensionContext | undefined;
	/** Ask Pi to draw the screen again. */
	requestRender(): void;
	/** `data` changed: give it a new version and draw the screen again. */
	changed(data: Versioned): void;
	/** Whether a panel is on screen now: the tabs are shown, and the page shows it at the current width. */
	shows(panel: string): boolean;
	/** Call `listener` whenever what `shows` answers may have changed: another page, a maximized panel, the tabs shown or hidden. */
	onShownChange(listener: () => void): void;
}

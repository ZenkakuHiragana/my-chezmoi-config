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
 * its panels reach as `PanelEnv.state`.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";

export interface FeatureEnv {
	/** The state the panels share. */
	state: CrtState;
	/** Pi's context of the current session; undefined before session_start and after shutdown. */
	context(): ExtensionContext | undefined;
	/** Ask Pi to draw the screen again, after the feature's data changed. */
	requestRender(): void;
	/** Whether a panel is on screen now: the tabs are shown, and the page shows it at the current width. */
	shows(panel: string): boolean;
	/** Call `listener` whenever what `shows` answers may have changed: another page, a maximized panel, the tabs shown or hidden. */
	onShownChange(listener: () => void): void;
}

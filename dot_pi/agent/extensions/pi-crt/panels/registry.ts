/**
 * Panel registration. Each file in this folder registers its panels with
 * registerPanel; panels/index.ts imports them all. A panel id in layout.ts names
 * one of them.
 */
import type { Keybinding, TUI } from "@earendil-works/pi-tui";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Framed } from "../screen/frame.ts";
import type { ThemeRef } from "../screen/lines.ts";
import type { CrtState } from "../state/core.ts";

export interface PanelEnv {
	theme: ThemeRef;
	state: CrtState;
	now: () => number;
	every: (ms: number) => number;
	redrawAt: (at: number) => void;
	/** Whether the panel has the keys (panel mode, and this panel is selected). */
	focused: (id: string) => boolean;
	/** Select a panel and give it the keys. */
	focusPanel: (id: string) => void;
	tui: () => TUI | undefined;
	/** Renderers Pi would use for a tool if pi-crt did not hide it from the transcript. */
	renderersFor: (toolName: string) => ToolRenderers | undefined;
	cwd: () => string;
}

/** Lines Pi's full screen keeps on screen when it scrolls the transcript a page (its PAGE_SCROLL_OVERLAP). */
const PAGE_OVERLAP = 4;

/**
 * Pi's viewport keys (as the user has them bound), which scroll the selected panel as
 * Pi's full screen scrolls the transcript with them (shell/input.ts): each pair moves
 * up and down by `step` lines of a view `height` lines tall, or, without one, to the ends. Pi's keys
 * to the previous and next prompt have no meaning outside the transcript and are not
 * among them. `what` is what TREE's key list says the pair does.
 */
export const VIEWPORT_KEYS: ReadonlyArray<{ keys: readonly [Keybinding, Keybinding]; step?: (height: number) => number; what: string }> = [
	{ keys: ["tui.altScreen.pageUp", "tui.altScreen.pageDown"], step: (height) => Math.max(1, height - PAGE_OVERLAP), what: "page up / down" },
	{ keys: ["tui.altScreen.halfPageUp", "tui.altScreen.halfPageDown"], step: (height) => Math.max(1, Math.floor(height / 2)), what: "half a page up / down" },
	{ keys: ["tui.altScreen.lineUp", "tui.altScreen.lineDown"], step: () => 1, what: "a line up / down" },
	{ keys: ["tui.altScreen.top", "tui.altScreen.bottom"], what: "to the top / bottom" },
];

/** Selection of panels that list things: the arrow keys or j/k move it one item, Enter acts on the selected item. */
export interface ListControl {
	move(delta: number): void;
	/**
	 * Scroll by `by(height)` lines (up when negative), `height` being the lines the list
	 * shows, and select what is then at the top, as Pi's viewport keys scroll the transcript.
	 * When the list cannot scroll further that way, select the first or the last item.
	 */
	scroll(by: (height: number) => number): void;
	toStart(): void;
	toEnd(): void;
	activate(): void;
	/** A key panel mode has no use for; returns whether the panel used it. */
	key?(data: string): boolean;
	/**
	 * Whether a text field of the panel is being typed into. Its keys go to `key`
	 * except ctrl+c, which goes to Pi, and alt+o, for which `key` gets Esc (the field
	 * closes) before the editor takes the keys. The field draws the terminal cursor
	 * instead of the editor.
	 */
	typing?(): boolean;
}

export interface PanelHandle extends Framed {
	list?: ListControl;
}

export type PanelFactory = (env: PanelEnv) => PanelHandle;

const factories = new Map<string, PanelFactory>();

/** Panel factories by id. */
export const PANELS: ReadonlyMap<string, PanelFactory> = factories;

/** Register a panel. An id can be registered once (Pi loads the extension afresh on /reload). */
export function registerPanel(id: string, factory: PanelFactory): void {
	if (factories.has(id)) throw new Error(`panel "${id}" is registered twice`);
	factories.set(id, factory);
}

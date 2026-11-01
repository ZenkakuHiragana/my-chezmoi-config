/**
 * Panel registration. Each file in this folder registers its panels with
 * registerPanel; panels/index.ts imports them all. A panel id in layout.ts names
 * one of them.
 */
import type { TUI } from "@earendil-works/pi-tui";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Framed } from "../screen/frame.ts";
import type { ThemeRef } from "../screen/lines.ts";
import type { CrtState } from "../state/core.ts";

export interface PanelEnv {
	theme: ThemeRef;
	state: CrtState;
	/** Animation frame number derived from the clock; panels use it to pick animation frames. */
	tick: () => number;
	/** Whether the panel has the keys (panel mode, and this panel is selected). */
	focused: (id: string) => boolean;
	tui: () => TUI | undefined;
	/** Renderers Pi would use for a tool if pi-crt did not hide it from the transcript. */
	renderersFor: (toolName: string) => ToolRenderers | undefined;
	cwd: () => string;
}

/** Selection of panels that list things: the arrow keys or j/k move it one item, Enter acts on the selected item. */
export interface ListControl {
	move(delta: number): void;
	page(delta: number): void;
	toStart(): void;
	toEnd(): void;
	activate(): void;
	/** A key panel mode has no use for; returns whether the panel used it. */
	key?(data: string): boolean;
	/**
	 * Whether a text field of the panel is being typed into. Every key but ctrl+c
	 * then goes to `key`, and the field draws the terminal cursor instead of the editor.
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

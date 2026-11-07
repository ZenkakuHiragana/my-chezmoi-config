/**
 * Pieces the panels share, and the NO SIGNAL panel.
 */
import { backgroundAnsi, colorToRgb, type ScrollView, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { Origin } from "../features/inv.ts";
import { Lines, type ThemeRef } from "../screen/lines.ts";
import { noSignal } from "../screen/nosignal.ts";
import { type ListControl, type PanelEnv, registerPanel } from "./registry.ts";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(tick: number): string {
	return SPINNER[tick % SPINNER.length] ?? "⠋";
}

/** Time since `startedAt`, as `MM:SS`. */
export function elapsedText(startedAt: number | undefined, now = Date.now()): string {
	const seconds = Math.floor((now - (startedAt ?? now)) / 1000);
	return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A horizontal bar to one eighth of a cell: whole cells `█`, then a cell filled from
 * the left `▏▎▍▌▋▊▉`, then empty cells. The empty part is a background colour, so the
 * part cell's right side, drawn in the background, joins it.
 */
function barParts(ratio: number, width: number): { filled: string; part: string; empty: number } {
	const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
	const eighths = Math.round(clamped * width * 8);
	const full = Math.floor(eighths / 8);
	const part = eighths % 8 ? "▏▎▍▌▋▊▉"[(eighths % 8) - 1]! : "";
	return { filled: "█".repeat(full), part, empty: width - full - (part ? 1 : 0) };
}

export function bar(theme: ReturnType<ThemeRef>, ratio: number, width: number, color: "accent" | "warning" | "error" | "text" = "accent"): string {
	const { filled, part, empty } = barParts(ratio, width);
	const rgb = colorToRgb(theme.colors.borderMuted);
	const track = backgroundAnsi({ kind: "rgb", r: rgb.r, g: rgb.g, b: rgb.b }, theme.getColorMode());
	return `${theme.fg(color, filled)}${track}${theme.fg(color, part)}${" ".repeat(empty)}[49m`;
}

export function compactNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 10_000) return `${Math.round(value / 1000)}k`;
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
	return String(Math.round(value));
}

/**
 * How a panel says where its figures came from, the same words everywhere so that a panel
 * showing an old request, or none measured at all, says so instead of leaving it implied.
 * `unmeasured` for Pi's build: it is not a record of anything sent, and it may match it.
 */
export function originNote(origin: Origin): string {
	return `  · ${origin === "built" ? "unmeasured" : origin}`;
}

/** The key before an item was selected. */
const NONE = Symbol("none");
/** The key once the selected item left the list: nothing is selected. */
const GONE = Symbol("gone");

/**
 * The selected item of a list panel (a logged call, a changed file). The arrow keys
 * or j/k move it one item and scroll to show it; Pi's viewport keys (PageUp/PageDown and
 * the rest, shell/input.ts) scroll and select the item at the top (those to the ends,
 * and any once the list cannot scroll further that way, the first or the last item),
 * so a long expanded item can be read page by page; Enter acts on the item.
 *
 * The selection is an item, not a row: `keys` gives the key of each item of the list
 * as it is now, in its order (items with the same key are one item to the selection:
 * the first of them). When the list changes under it, the selection stays on its item
 * wherever that item goes. Once the list, as it is drawn or used, no longer has the
 * item, nothing is selected, also if the item comes back; a list that is not drawn
 * keeps its selection.
 *
 * A list whose item is shown in a panel beside it passes `picked`, the key of the
 * item that panel shows, as the feature that owns the pick keeps it. The selection
 * is then that item, so the selected row and the shown item are always the same
 * item, and selecting an item acts on it (`onActivate` picks it).
 */
export class Selection implements ListControl {
	offsets: number[] = [];
	heights: number[] = [];
	/** The view the list scrolls in. */
	view?: ScrollView;
	/** The key of the selected item, without `picked`. */
	private selected: unknown = NONE;

	constructor(
		/** The key of each item, in the list's order. */
		protected readonly keys: () => readonly unknown[],
		private readonly onActivate: (index: number) => void,
		private readonly picked?: () => unknown,
	) {}

	/** The key of the selected item. Cache keys use it: finding its row walks the list. */
	get selectedKey(): unknown {
		return this.picked ? this.picked() : this.selected;
	}

	/**
	 * Where the selected item is in the list now. Reading it (drawing the list, a key)
	 * finds out when the item left the list: from then on nothing is selected.
	 */
	get index(): number {
		const key = this.selectedKey;
		if (key === NONE) return this.unselected();
		if (key === GONE) return -1;
		const index = this.keys().indexOf(key);
		if (index < 0 && !this.picked) this.selected = GONE;
		return index;
	}

	/** The index before an item was selected: none. A list may select an item here. */
	protected unselected(): number {
		return -1;
	}

	/** Record where an item starts; call while producing the content. */
	place(index: number, offset: number, height: number): void {
		this.offsets[index] = offset;
		this.heights[index] = height;
	}

	/** Start recording a new rendering of the content. */
	reset(): void {
		this.offsets = [];
		this.heights = [];
	}

	/** The item drawn at a content line, or -1 (mouse clicks). */
	itemAtLine(line: number): number {
		for (let index = 0; index < this.offsets.length; index++) {
			const top = this.offsets[index];
			if (top !== undefined && line >= top && line < top + (this.heights[index] ?? 0)) return index;
		}
		return -1;
	}

	/** Select an item (mouse clicks). */
	pick(index: number): void {
		this.select(index);
	}

	/** Content lines of the selected item, as [first, end). */
	get span(): [number, number] | undefined {
		const index = this.index;
		const top = this.offsets[index];
		return top === undefined ? undefined : [top, top + (this.heights[index] ?? 0)];
	}

	move(delta: number): void {
		const n = this.keys().length;
		if (!n) return;
		const index = this.index;
		// The first move starts from what is on screen.
		if (index < 0) this.select(delta > 0 ? this.itemAt("top") : this.itemAt("bottom"));
		else this.select(Math.max(0, Math.min(n - 1, index + delta)));
		this.reveal();
	}

	scroll(by: (height: number) => number): void {
		if (!this.keys().length) return;
		const view = this.view;
		const lines = by(Math.max(1, view?.viewportHeight ?? 1));
		// At the end already, the view does not move (scrollBy returns the lines it could not
		// scroll): the key goes on to the item at that end.
		if ((view?.scrollBy(lines) ?? lines) === lines) lines > 0 ? this.toEnd() : this.toStart();
		else this.select(this.itemAt("top"));
	}

	toStart(): void {
		if (!this.keys().length) return;
		this.select(0);
		this.view?.scrollToStart();
	}

	toEnd(): void {
		const n = this.keys().length;
		if (!n) return;
		this.select(n - 1);
		this.view?.scrollToEnd();
	}

	activate(): void {
		const index = this.index;
		if (index >= 0 && index < this.keys().length) this.onActivate(index);
	}

	/** Select the item at an index of the list as it is now; with `picked`, pick it. */
	protected select(index: number): void {
		const keys = this.keys();
		if (index < 0 || index >= keys.length) return;
		if (this.picked) this.onActivate(index);
		else this.selected = keys[index];
	}

	/** The item at the top or bottom edge of the view. */
	private itemAt(edge: "top" | "bottom"): number {
		const view = this.view;
		const top = view?.scrollTop ?? 0;
		const line = edge === "top" ? top : top + Math.max(1, view?.viewportHeight ?? 1) - 1;
		let found = edge === "top" ? this.keys().length - 1 : 0;
		for (let index = 0; index < this.offsets.length; index++) {
			const start = this.offsets[index];
			if (start === undefined) continue;
			if (line < start + (this.heights[index] ?? 0)) return edge === "top" || line >= start ? index : Math.max(0, index - 1);
			found = index;
		}
		return found;
	}

	/** Scroll so the selected item is in view; an item taller than the view shows its top. */
	private reveal(): void {
		const view = this.view;
		const span = this.span;
		if (!view || !span) return;
		const [top, end] = span;
		const height = Math.max(1, view.viewportHeight);
		if (top < view.scrollTop || end - top > height) view.scrollTo(top, { disableFollow: true });
		else if (end > view.scrollTop + height) view.scrollTo(end - height, { disableFollow: true });
	}
}

/** Lines of a list panel: a click on an item selects it and acts on it, as Enter does. */
export class ListLines extends Lines {
	constructor(
		private readonly selection: Selection,
		produce: (width: number) => string[],
		key: () => unknown[],
		fitted = false,
	) {
		super(produce, key, fitted);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "press" || event.button !== "left") return undefined;
		const index = this.selection.itemAtLine(event.y);
		if (index < 0) return undefined;
		this.selection.pick(index);
		this.selection.activate();
		return { handled: true };
	}
}

/** Add a one-column gutter to a list panel's lines, marking the selected item while the panel has the keys. */
export function withCursor(env: PanelEnv, selection: Selection, id: string, lines: string[]): string[] {
	// Read the selection also without the keys, so that a drawn list drops an item it lost.
	const span = selection.span;
	const [from, to] = (env.focused(id) && span) || [-1, -1];
	const mark = env.theme().fg("accent", "▌");
	return lines.map((line, index) => (index >= from && index < to ? mark : " ") + line);
}

registerPanel("nosignal", (env) => ({ component: noSignal(env.theme, () => "NO SIGNAL", env.every), title: () => "NO SIGNAL" }));

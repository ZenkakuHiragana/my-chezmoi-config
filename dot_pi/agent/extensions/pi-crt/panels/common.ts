/**
 * Pieces the panels share, and the NO SIGNAL panel.
 */
import type { ScrollView, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { Lines, type ThemeRef } from "../screen/lines.ts";
import { noSignal } from "../screen/nosignal.ts";
import { type ListControl, type PanelEnv, registerPanel } from "./registry.ts";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(tick: number): string {
	return SPINNER[tick % SPINNER.length] ?? "⠋";
}

// Pi's `theme` is one proxy object whose colours change in place, so cache keys
// use the escape codes of the colours a panel draws with.
const STAMP_TOKENS = [
	"text",
	"muted",
	"dim",
	"accent",
	"success",
	"error",
	"warning",
	"borderMuted",
	"toolTitle",
	"thinkingText",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
] as const;

/** Time since `startedAt`, as `MM:SS`. */
export function elapsedText(startedAt: number | undefined): string {
	const seconds = Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000);
	return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function themeStamp(theme: ReturnType<ThemeRef>): string {
	return STAMP_TOKENS.map((token) => theme.getFgAnsi(token)).join("");
}

export function bar(theme: ReturnType<ThemeRef>, ratio: number, width: number, color: "accent" | "warning" | "error" = "accent"): string {
	const clamped = Math.max(0, Math.min(1, ratio));
	const filled = Math.round(clamped * width);
	return theme.fg(color, "▓".repeat(filled)) + theme.fg("borderMuted", "░".repeat(Math.max(0, width - filled)));
}

export function compactNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 10_000) return `${Math.round(value / 1000)}k`;
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
	return String(Math.round(value));
}

/**
 * The selected item of a list panel (a logged call, a changed file). The arrow keys
 * or j/k move it one item and scroll to show it; PageUp/PageDown scroll a page and select
 * the item at the top, so a long expanded item can be read page by page; Enter acts
 * on the item. With `pickOnMove`, moving also acts on the item: for a list whose
 * item is shown in a panel beside it, where acting only picks what that panel shows.
 */
export class Selection implements ListControl {
	index = -1;
	offsets: number[] = [];
	heights: number[] = [];
	scroll?: ScrollView;

	constructor(
		private readonly count: () => number,
		private readonly onActivate: (index: number) => void,
		private readonly pickOnMove = false,
	) {}

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

	/** Keep the selection on an existing item after the list shrank. */
	done(): void {
		const n = this.count();
		if (this.index >= n) this.index = n - 1;
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
		this.index = index;
	}

	/** Content lines of the selected item, as [first, end). */
	get span(): [number, number] | undefined {
		const top = this.offsets[this.index];
		return top === undefined ? undefined : [top, top + (this.heights[this.index] ?? 0)];
	}

	move(delta: number): void {
		const n = this.count();
		if (!n) return;
		// The first move starts from what is on screen.
		if (this.index < 0) this.index = delta > 0 ? this.itemAt("top") : this.itemAt("bottom");
		else this.index = Math.max(0, Math.min(n - 1, this.index + delta));
		this.reveal();
		if (this.pickOnMove && this.index >= 0) this.onActivate(this.index);
	}

	page(delta: number): void {
		if (!this.count()) return;
		const view = this.scroll;
		view?.scrollBy(delta * Math.max(1, (view?.viewportHeight ?? 2) - 1));
		this.index = this.itemAt("top");
	}

	toStart(): void {
		if (!this.count()) return;
		this.index = 0;
		this.scroll?.scrollToStart();
	}

	toEnd(): void {
		const n = this.count();
		if (!n) return;
		this.index = n - 1;
		this.scroll?.scrollToEnd();
	}

	activate(): void {
		if (this.index >= 0 && this.index < this.count()) this.onActivate(this.index);
	}

	/** The item at the top or bottom edge of the view. */
	private itemAt(edge: "top" | "bottom"): number {
		const view = this.scroll;
		const top = view?.scrollTop ?? 0;
		const line = edge === "top" ? top : top + Math.max(1, view?.viewportHeight ?? 1) - 1;
		let found = edge === "top" ? this.count() - 1 : 0;
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
		const view = this.scroll;
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
	selection.done();
	const [from, to] = (env.focused(id) && selection.span) || [-1, -1];
	const mark = env.theme().fg("accent", "▌");
	return lines.map((line, index) => (index >= from && index < to ? mark : " ") + line);
}

registerPanel("nosignal", (env) => ({ component: noSignal(env.theme, () => "NO SIGNAL") }));

/**
 * The tab strips above the pages.
 */
import {
	type Component,
	sliceByColumn,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ThemeRef } from "./lines.ts";

export interface TabBarOptions {
	theme: ThemeRef;
	labels: () => string[];
	active: () => number;
	/** Whether tab `index` should blink to ask for attention right now. */
	blinking: (index: number) => boolean;
	/** Text at the right end of the row; it never moves the labels and is cut to fit. */
	right?: () => string;
	onSelect: (index: number) => void;
	/** Inner tabs: no edge marks, and a rule between the labels instead of a bar after each. */
	inner?: boolean;
	/**
	 * Column for the middle of the active label (inner tabs go under the active
	 * outer tab, as on a Pip-Boy). Labels pushed past either edge are cut off.
	 * Without it, or when it returns undefined, the labels are centred.
	 */
	anchor?: (width: number) => number | undefined;
}

/**
 * One-row tab strip. The labels are centred on the full row width, whatever the
 * row also shows, so every tab bar lines up the same way. Clicking a label selects it.
 */
export class TabBar implements Component {
	/** Width of the last render, which is the terminal width. */
	lastWidth = 0;
	private hits: Array<{ from: number; to: number; index: number }> = [];
	constructor(private readonly options: TabBarOptions) {}

	render(width: number): string[] {
		this.lastWidth = width;
		const t = this.options.theme();
		const { labels, x, hits } = this.arrange();
		const start = this.startAt(width, x, hits);
		const rule = (n: number) => (n > 0 ? t.fg("borderMuted", "─".repeat(n)) : "");
		const lead = rule(start);
		// Labels pushed past the left edge lose their start; the rest is cut to the width below.
		const shown = start >= 0 ? lead + labels : sliceByColumn(labels, -start, x + start);
		// Click positions are measured on what is drawn.
		const offset = start >= 0 ? visibleWidth(lead) : start;
		this.hits = hits
			.map((hit) => ({ ...hit, from: Math.max(0, hit.from + offset), to: Math.min(width, hit.to + offset) }))
			.filter((hit) => hit.from < hit.to);
		const remaining = width - offset - x;
		const right = this.options.right?.() ?? "";
		let tail = rule(remaining);
		if (right && remaining >= 3) {
			const fitted = truncateToWidth(right, remaining - 2);
			tail = rule(remaining - visibleWidth(fitted) - 1) + " " + fitted;
		}
		return [truncateToWidth(shown + tail, width)];
	}

	/** Column of the middle of the active label when the bar is drawn `width` wide (for an inner bar's anchor). */
	activeMiddle(width: number): number | undefined {
		const { x, hits } = this.arrange();
		const active = hits[this.options.active()];
		return active && this.startAt(width, x, hits) + Math.floor((active.from + active.to) / 2);
	}

	/** The labels in one line, its width, and where each label sits in it. */
	private arrange(): { labels: string; x: number; hits: Array<{ from: number; to: number; index: number }> } {
		const { theme, inner } = this.options;
		const t = theme();
		const active = this.options.active();
		let labels = inner ? "" : t.fg("borderMuted", "▌");
		let x = visibleWidth(labels);
		const hits: Array<{ from: number; to: number; index: number }> = [];
		this.options.labels().forEach((label, index) => {
			let styled: string;
			if (index === active) styled = inner ? t.fg("accent", t.bold(` ${label} `)) : t.bg("selectedBg", t.fg("borderAccent", t.bold(` ${label} `)));
			else if (this.options.blinking(index)) styled = t.fg("warning", t.bold(` ${label} `));
			else styled = t.fg("muted", ` ${label} `);
			const separator = t.fg("borderMuted", inner ? "─" : "▐");
			if (inner && index > 0) {
				labels += separator;
				x += visibleWidth(separator);
			}
			const w = visibleWidth(styled);
			hits.push({ from: x, to: x + w, index });
			labels += styled;
			x += w;
			if (!inner) {
				labels += separator;
				x += visibleWidth(separator);
			}
		});
		return { labels, x, hits };
	}

	/** Column where the labels start: under the anchor, or centred (never left of the edge then). */
	private startAt(width: number, x: number, hits: ReadonlyArray<{ from: number; to: number }>): number {
		const active = hits[this.options.active()];
		const anchor = this.options.anchor?.(width);
		if (anchor !== undefined && active) return anchor - Math.floor((active.from + active.to) / 2);
		return Math.max(0, Math.floor((width - x) / 2));
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "press" || event.button !== "left") return undefined;
		const hit = this.hits.find((h) => event.x >= h.from && event.x < h.to);
		if (!hit) return undefined;
		this.options.onSelect(hit.index);
		return { handled: true };
	}

	invalidate(): void {}
}

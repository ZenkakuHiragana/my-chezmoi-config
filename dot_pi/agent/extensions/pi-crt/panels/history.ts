/**
 * STAT › DETAIL's HISTORY panel: one column per response on the branch, newest at the
 * right. A column's height is the tokens of the response (its prompt and its output),
 * stacked from the bottom as cache read, cache write, uncached input and output; a
 * mark at the top shows where the branch was compacted.
 *
 * The scale leaves out the tallest few columns, so that one huge response does not
 * flatten the rest: it is the tallest column once the top 5% are set aside, plus 15%,
 * rounded up to a round number. The headroom keeps a context that grows response
 * after response from clipping its newest columns. A column above the scale is cut at
 * the top and marked ▲, and the row above the chart gives its real size.
 *
 * Each cell takes the colour of the part that fills most of it, so a boundary between
 * parts is drawn to the nearest half cell. The chart only reads the responses that
 * fit the width, and is drawn again only when the history, the size or the theme
 * changes.
 */
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type ResponseUsage, vitals } from "../features/vitals.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import type { ThemeRef } from "../screen/lines.ts";
import { compactNumber } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

/** Parts of a column, bottom to top. */
const PARTS = [
	{ key: "cacheRead", label: "cache read", color: "muted" },
	{ key: "cacheWrite", label: "cache write", color: "warning" },
	{ key: "input", label: "input", color: "accent" },
	{ key: "output", label: "output", color: "success" },
] as const;
/** A part's colour, or a mark's: ▲ on a cut column, ▼ after a compaction. */
type Color = (typeof PARTS)[number]["color"] | "error";

/** A cell filled from the bottom by 1 to 7 eighths. */
const EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇"];
/** Rows drawn around the chart: the row for the sizes of cut columns above it, the axis and the legend below. */
const EXTRA_ROWS = 3;
/** Share of the shown columns left out of the scale, at most. */
const OUTLIERS = 0.05;
/** Room above the tallest column the scale is taken from. */
const HEADROOM = 1.15;
/** Round scales: these times a power of ten. */
const STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
/** Height used before the panel has been laid out once. */
const FALLBACK_HEIGHT = 12;
/**
 * Cells before the columns: the scale's label, then " ┤". Labels are a nice ceiling
 * (1, 2 or 5 times a power of ten) in compactNumber's form, at most four cells ("200k").
 */
const GUTTER = 7;

registerPanel("history", (env) => {
	const view = new HistoryView(env);
	const panel = framed(
		env.theme,
		() => {
			const count = vitals(env.state).history.length;
			return count ? `HISTORY  ${count} responses` : "HISTORY";
		},
		view,
		"sized",
		() => env.focused("history"),
	);
	view.sized = panel.scroll as SizedView;
	return panel;
});

class HistoryView implements Component {
	sized?: SizedView;
	private cache?: { key: unknown[]; lines: string[] };

	constructor(private readonly env: PanelEnv) {}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		const height = this.sized && this.sized.viewportHeight > 0 ? this.sized.viewportHeight : FALLBACK_HEIGHT;
		if (this.sized) this.sized.drawnFor = this.sized.viewportHeight;
		const v = vitals(this.env.state);
		const key = [v.version, width, height];
		if (this.cache && this.cache.key.every((value, index) => value === key[index])) return this.cache.lines;
		const lines = chartLines(this.env.theme, v.history, width, height, summary(this.env));
		this.cache = { key, lines };
		return lines;
	}
}

/** `$12.40 · hit 87% · 38 t/s`, from what STATUS shows too. */
function summary(env: PanelEnv): string {
	const v = vitals(env.state);
	const parts = [
		v.cost > 0 ? `$${v.cost.toFixed(2)}` : undefined,
		v.cacheRatio === undefined ? undefined : `hit ${Math.round(v.cacheRatio * 100)}%`,
		v.outputTokensPerSecond === undefined ? undefined : `${Math.round(v.outputTokensPerSecond)} t/s`,
	];
	return parts.filter((part) => part !== undefined).join(" · ");
}

function chartLines(theme: ThemeRef, history: readonly ResponseUsage[], width: number, height: number, tail: string): string[] {
	const t = theme();
	if (!history.length) return [t.fg("dim", " -- no responses yet --")];
	const rows = Math.max(2, height - EXTRA_ROWS);
	const columns = Math.max(1, width - GUTTER);
	const shown = history.slice(-columns);
	const totals = shown.map(total);
	const top = scaleFor(totals);
	const label = compactNumber(top);
	const eighthsPerToken = (rows * 8) / top;

	// Cell colours and glyphs, row 0 at the bottom.
	const grid: Array<Array<{ glyph: string; color?: Color }>> = Array.from({ length: rows }, () => []);
	shown.forEach((response, column) => {
		const bounds: number[] = [];
		let sum = 0;
		for (const part of PARTS) {
			sum += response[part.key];
			bounds.push(Math.round(sum * eighthsPerToken));
		}
		const cut = totals[column]! > top;
		const height8 = Math.min(rows * 8, bounds[bounds.length - 1]!);
		for (let row = 0; row < rows; row++) {
			const low = row * 8;
			const filled = Math.max(0, Math.min(8, height8 - low));
			if (cut && row === rows - 1) {
				grid[row]!.push({ glyph: "▲", color: "error" });
			} else if (filled === 0) {
				const mark = response.afterCompaction && row === rows - 1;
				grid[row]!.push(mark ? { glyph: "▼", color: "warning" } : { glyph: " " });
			} else {
				grid[row]!.push({ glyph: filled === 8 ? "█" : EIGHTHS[filled]!, color: majorityPart(bounds, low, low + filled) });
			}
		}
	});

	const lines: string[] = [" ".repeat(GUTTER) + t.fg("error", cutSizes(totals, top, columns))];
	for (let row = rows - 1; row >= 0; row--) {
		const axis = row === rows - 1 ? `${label.padStart(GUTTER - 2)} ┤` : `${" ".repeat(GUTTER - 2)} │`;
		lines.push(t.fg("dim", axis) + paintRuns(theme, grid[row]!));
	}
	lines.push(t.fg("dim", `${"0".padStart(GUTTER - 2)} └${"─".repeat(columns)}`));
	const legend = PARTS.map((part) => `${t.fg(part.color, "■")} ${t.fg("muted", part.label)}`).join("  ");
	const gap = width - visibleWidth(legend) - visibleWidth(tail) - 1;
	const footer = gap >= 2 ? ` ${legend}${" ".repeat(gap)}${t.fg("text", tail)}` : ` ${legend}`;
	lines.push(truncateToWidth(footer, width));
	return lines;
}

/** Tokens of a response: its prompt and its output. */
function total(response: ResponseUsage): number {
	return response.cacheRead + response.cacheWrite + response.input + response.output;
}

/** The scale: the tallest column once the top OUTLIERS are left out, plus HEADROOM, rounded up. */
function scaleFor(totals: readonly number[]): number {
	const sorted = [...totals].sort((a, b) => b - a);
	const skip = Math.floor(sorted.length * OUTLIERS);
	return niceCeiling(Math.max(1, (sorted[skip] ?? 1) * HEADROOM));
}

/** The smallest round number (STEPS times a power of ten) that is at least `value`. */
function niceCeiling(value: number): number {
	const power = 10 ** Math.floor(Math.log10(value));
	for (const step of STEPS) if (step * power >= value) return step * power;
	return 10 * power;
}

/**
 * The row above the chart: the real size of each cut column, starting over it (or
 * ending over it near the right edge). Larger sizes are placed first; a size that would
 * touch one already placed is left out, and its column keeps only the ▲.
 */
function cutSizes(totals: readonly number[], top: number, columns: number): string {
	const row = Array.from({ length: columns }, () => " ");
	const taken = Array.from({ length: columns }, () => false);
	const cut = totals.map((value, column) => ({ value, column })).filter(({ value }) => value > top);
	for (const { value, column } of cut.sort((a, b) => b.value - a.value)) {
		const text = compactNumber(value);
		const start = Math.max(0, Math.min(column, columns - text.length));
		const end = start + text.length;
		// One blank cell on each side, so neighbouring sizes do not run together.
		if (end > columns || taken.slice(Math.max(0, start - 1), Math.min(columns, end + 1)).some(Boolean)) continue;
		for (let index = start; index < end; index++) {
			row[index] = text[index - start]!;
			taken[index] = true;
		}
	}
	return row.join("").trimEnd();
}

/** The part that covers most of the eighths from `low` to `high`; `bounds` are the parts' tops. */
function majorityPart(bounds: readonly number[], low: number, high: number): Color {
	let best = 0;
	let bestCover = -1;
	let start = 0;
	bounds.forEach((end, index) => {
		const cover = Math.min(end, high) - Math.max(start, low);
		if (cover > bestCover) {
			bestCover = cover;
			best = index;
		}
		start = end;
	});
	return PARTS[best]!.color;
}

/** Cells as text, one colour code per run of cells with the same colour. */
function paintRuns(theme: ThemeRef, cells: ReadonlyArray<{ glyph: string; color?: Color }>): string {
	const t = theme();
	let out = "";
	let run = "";
	let color: Color | undefined;
	const flush = () => {
		if (run) out += color ? t.fg(color, run) : run;
		run = "";
	};
	for (const cell of cells) {
		if (cell.color !== color) {
			flush();
			color = cell.color;
		}
		run += cell.glyph;
	}
	flush();
	return out;
}

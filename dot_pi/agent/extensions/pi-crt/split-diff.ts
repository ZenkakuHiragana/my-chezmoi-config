/**
 * Side-by-side (old | new) rendering of one file's git diff.
 *
 * Ported from pi-tidy's split-diff.ts (MIT License, Copyright (c) 2026 Andy8647;
 * the licence text is in THIRD_PARTY_NOTICES.md next to this file). The drawing
 * follows pi-tidy: line numbers on both sides, a coloured bar on changed rows, a
 * row tint derived from the theme, emphasis on the changed middle of paired
 * lines, syntax highlighting, and a fallback when the panes would be too narrow.
 *
 * Changed for pi-crt:
 * - The input is one file's section of git's unified diff. Line numbers come
 *   from the `@@ -a,b +c,d @@` hunk headers (pi-tidy reads the numbers that pi's
 *   edit diff writes on every line).
 * - The common start and end of paired lines are compared in graphemes of the
 *   text as drawn (tabs expanded), and the emphasis counts graphemes too.
 *   pi-tidy compares UTF-16 units of the raw text, so a tab or a surrogate pair
 *   before the change shifted the emphasis.
 * - No collapsed window and no expand hint: the panel scrolls instead.
 * - When the panes would be too narrow, a one-column diff with the same colours
 *   is drawn (pi-tidy leaves that to pi).
 * - Each side of a file is highlighted in one call (pi-tidy highlights line by
 *   line; one call is about twice as fast, and a file has many lines).
 */

import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Blank cells on each side of the panes. */
const PAD = 1;
const SEPARATOR = " │ ";
/** Narrower panes than this and the diff is drawn in one column. */
const MIN_CONTENT_WIDTH = 20;
const TAB = "    ";

/** One file's section of a unified diff, from its `diff --git` line on. */
export interface DiffSection {
	path: string;
	lines: readonly string[];
	/** Lines of the section left out at its end. */
	omitted?: number;
}

interface Cell {
	num: number;
	/** The text as drawn: control characters replaced, tabs expanded. */
	text: string;
	changed: boolean;
}

interface Row {
	kind: "row" | "skip";
	left?: Cell;
	right?: Cell;
	/** For a skip row: the heading git writes after the hunk header. */
	heading?: string;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface Palette {
	addedFg: string;
	removedFg: string;
	contextFg: string;
	addedBg: string | undefined;
	removedBg: string | undefined;
	addedEmphasis: string | undefined;
	removedEmphasis: string | undefined;
}

// ── parsing ─────────────────────────────────────────────────────────────────

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;
/** Header lines that the file heading already says, or that say nothing to a reader. */
const QUIET_META = /^(diff --git |index |--- |\+\+\+ )/;

/** Drop control characters and expand tabs (a diff of a file containing ESC must not reach the terminal). */
function sanitize(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\t/g, TAB);
}

/**
 * Rows of a unified diff section, and the header lines worth showing (mode
 * changes, renames, "Binary files ... differ"). A run of removed lines followed
 * by a run of added lines pairs by index, as in pi-tidy.
 */
function parseSection(lines: readonly string[]): { rows: Row[]; notes: string[] } {
	const rows: Row[] = [];
	const notes: string[] = [];
	let oldNo = 0;
	let newNo = 0;
	let inHunk = false;
	let removed: string[] = [];
	let added: string[] = [];
	const flush = () => {
		const pairs = Math.max(removed.length, added.length);
		for (let k = 0; k < pairs; k++) {
			rows.push({
				kind: "row",
				...(k < removed.length ? { left: { num: oldNo++, text: removed[k]!, changed: true } } : {}),
				...(k < added.length ? { right: { num: newNo++, text: added[k]!, changed: true } } : {}),
			});
		}
		removed = [];
		added = [];
	};
	for (const line of lines) {
		const hunk = HUNK.exec(line);
		if (hunk) {
			flush();
			oldNo = Number(hunk[1]);
			newNo = Number(hunk[2]);
			// Lines above the first hunk, or between two hunks, are not in the diff.
			if (inHunk || oldNo > 1 || newNo > 1) rows.push({ kind: "skip", heading: sanitize(hunk[3] ?? "").trim() });
			inHunk = true;
			continue;
		}
		if (!inHunk) {
			if (line && !QUIET_META.test(line)) notes.push(sanitize(line));
			continue;
		}
		const sign = line[0];
		if (sign === "-") {
			if (added.length) flush();
			removed.push(sanitize(line.slice(1)));
		} else if (sign === "+") {
			added.push(sanitize(line.slice(1)));
		} else if (sign === " " || line === "") {
			flush();
			const text = sanitize(line.slice(1));
			rows.push({ kind: "row", left: { num: oldNo++, text, changed: false }, right: { num: newNo++, text, changed: false } });
		}
		// "\ No newline at end of file" and anything else inside a hunk is not drawn.
	}
	flush();
	return { rows, notes };
}

// ── colour ──────────────────────────────────────────────────────────────────

const XTERM_16: Rgb[] = [
	{ r: 0, g: 0, b: 0 },
	{ r: 205, g: 49, b: 49 },
	{ r: 13, g: 188, b: 121 },
	{ r: 229, g: 229, b: 16 },
	{ r: 36, g: 114, b: 200 },
	{ r: 188, g: 63, b: 188 },
	{ r: 17, g: 168, b: 205 },
	{ r: 229, g: 229, b: 229 },
	{ r: 102, g: 102, b: 102 },
	{ r: 241, g: 76, b: 76 },
	{ r: 35, g: 209, b: 139 },
	{ r: 245, g: 245, b: 67 },
	{ r: 59, g: 142, b: 234 },
	{ r: 214, g: 112, b: 214 },
	{ r: 41, g: 184, b: 219 },
	{ r: 255, g: 255, b: 255 },
];

function xterm256(index: number): Rgb {
	if (index < 16) return XTERM_16[index] ?? XTERM_16[0]!;
	if (index < 232) {
		const steps = [0, 95, 135, 175, 215, 255];
		const value = index - 16;
		return {
			r: steps[Math.floor(value / 36)]!,
			g: steps[Math.floor((value % 36) / 6)]!,
			b: steps[value % 6]!,
		};
	}
	const grey = 8 + (index - 232) * 10;
	return { r: grey, g: grey, b: grey };
}

/** Read a colour out of an SGR sequence (truecolour, 256, or the basic 16). */
function sgrRgb(sequence: string | undefined): Rgb | null {
	if (!sequence) return null;
	const params = sequence
		.slice(2, -1)
		.split(";")
		.map((part) => Number.parseInt(part, 10));
	const at = params.indexOf(38) >= 0 ? params.indexOf(38) : params.indexOf(48);
	if (at >= 0) {
		if (params[at + 1] === 2) {
			const [r, g, b] = [params[at + 2], params[at + 3], params[at + 4]];
			if (r === undefined || g === undefined || b === undefined) return null;
			return { r, g, b };
		}
		if (params[at + 1] === 5 && params[at + 2] !== undefined) return xterm256(params[at + 2]!);
		return null;
	}
	const code = params[0];
	if (code === undefined || !Number.isFinite(code)) return null;
	if (code >= 30 && code <= 37) return XTERM_16[code - 30] ?? null;
	if (code >= 90 && code <= 97) return XTERM_16[code - 90 + 8] ?? null;
	return null;
}

/**
 * An absolute background for a diff row: a fixed slice of the diff hue over a
 * dimmed box background. Hue carries the meaning, luminance has to stay low.
 */
function tintBackground(base: Rgb, color: Rgb, hue: number): Rgb {
	return {
		r: Math.round(color.r * hue + base.r * 0.35),
		g: Math.round(color.g * hue + base.g * 0.35),
		b: Math.round(color.b * hue + base.b * 0.35),
	};
}

function bgAnsi(color: Rgb): string {
	return `\x1b[48;2;${color.r};${color.g};${color.b}m`;
}

/**
 * Paint a row: the fill goes first and is re-armed after every SGR reset inside
 * the text (syntax highlighting emits its own `\x1b[0m`, which would otherwise
 * punch a hole in the tint).
 */
function paint(text: string, fill: string): string {
	let out = fill;
	let index = 0;
	const RESET = /\x1b\[0?m/g;
	for (const match of text.matchAll(RESET)) {
		const start = match.index ?? 0;
		out += text.slice(index, start) + match[0] + fill;
		index = start + match[0].length;
	}
	return `${out}${text.slice(index)}\x1b[49m`;
}

function buildPalette(theme: Theme): Palette {
	const addedFg = theme.getFgAnsi("toolDiffAdded");
	const removedFg = theme.getFgAnsi("toolDiffRemoved");
	const contextFg = theme.getFgAnsi("toolDiffContext");
	// The row tint has no theme slot, so the diff colour is mixed into the tool
	// box background: 16% for the row, 32% for the word.
	const base = sgrRgb(theme.getBgAnsi("toolSuccessBg")) ?? sgrRgb(theme.getBgAnsi("toolPendingBg"));
	const added = sgrRgb(addedFg);
	const removed = sgrRgb(removedFg);
	const tint = (color: Rgb | null, hue: number): string | undefined => (base && color ? bgAnsi(tintBackground(base, color, hue)) : undefined);
	return {
		addedFg,
		removedFg,
		contextFg,
		addedBg: tint(added, 0.16),
		removedBg: tint(removed, 0.16),
		addedEmphasis: tint(added, 0.32),
		removedEmphasis: tint(removed, 0.32),
	};
}

// ── text ────────────────────────────────────────────────────────────────────

/**
 * Highlighted text of every cell, one highlighter call for each side. A side
 * whose highlighted lines do not come back one for one is left plain.
 */
function highlightCells(filePath: string, rows: readonly Row[]): Map<Cell, string> {
	const out = new Map<Cell, string>();
	let language: string | undefined;
	try {
		language = getLanguageFromPath(filePath);
	} catch {
		language = undefined;
	}
	if (!language) return out;
	for (const side of ["left", "right"] as const) {
		const cells = rows.flatMap((row) => (row[side] ? [row[side]!] : []));
		if (!cells.length) continue;
		try {
			const lines = highlightCode(cells.map((cell) => cell.text).join("\n"), language);
			if (lines.length !== cells.length) continue;
			cells.forEach((cell, index) => out.set(cell, lines[index]!));
		} catch {
			// Plain text.
		}
	}
	return out;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Printable ASCII is one grapheme per character; anything else goes through Intl.Segmenter. */
const ASCII = /^[\x20-\x7e]*$/;

function splitGraphemes(text: string): string[] {
	return ASCII.test(text) ? text.split("") : Array.from(graphemes.segment(text), (part) => part.segment);
}

/** Longest common prefix and suffix, in graphemes, and the length of each text in graphemes. */
function commonEdges(left: string, right: string): { prefix: number; suffix: number; leftLength: number; rightLength: number } {
	const a = splitGraphemes(left);
	const b = splitGraphemes(right);
	const max = Math.min(a.length, b.length);
	let prefix = 0;
	while (prefix < max && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
	return { prefix, suffix, leftLength: a.length, rightLength: b.length };
}

/**
 * Wrap the changed middle of `rendered` (already coloured) in the emphasis
 * fill. Boundaries count graphemes of the visible text, so escape sequences
 * inside the highlighted text do not shift them.
 */
function emphasize(rendered: string, start: number, end: number, fill: string, restore: string | undefined): string {
	if (end <= start) return rendered;
	const back = restore ?? "\x1b[49m";
	let out = "";
	let visible = 0;
	let inside = false;
	const text = (part: string) => {
		for (const segment of splitGraphemes(part)) {
			if (!inside && visible === start) {
				out += fill;
				inside = true;
			}
			if (inside && visible === end) {
				out += back;
				inside = false;
			}
			out += segment;
			visible++;
		}
	};
	let index = 0;
	for (const match of rendered.matchAll(/\x1b\[[0-9;:]*m/g)) {
		const at = match.index ?? 0;
		text(rendered.slice(index, at));
		out += match[0];
		index = at + match[0].length;
	}
	text(rendered.slice(index));
	return inside ? out + back : out;
}

function pad(text: string, width: number): string {
	const visible = visibleWidth(text);
	if (visible === width) return text;
	if (visible > width) return truncateToWidth(text, width, "");
	return text + " ".repeat(width - visible);
}

// ── rendering ───────────────────────────────────────────────────────────────

interface Layout {
	/** Bar column, then a space, the number, a space, then the code. */
	numWidth: number;
	pane: number;
	content: number;
}

function numberWidth(rows: readonly Row[]): number {
	let maxNumber = 0;
	for (const row of rows) {
		for (const cell of [row.left, row.right]) if (cell) maxNumber = Math.max(maxNumber, cell.num);
	}
	// "old" / "new" sit over the number column, so it is at least three wide.
	return Math.max(3, String(maxNumber).length);
}

function layout(width: number, numWidth: number): Layout | null {
	const available = width - PAD * 2 - SEPARATOR.length;
	if (available < (numWidth + 3) * 2 + MIN_CONTENT_WIDTH * 2) return null;
	const pane = Math.floor(available / 2);
	const content = pane - numWidth - 3;
	if (content < MIN_CONTENT_WIDTH) return null;
	return { numWidth, pane, content };
}

/** A cell: bar, number and code, tinted when changed. `content` is the width of the code. */
function renderCell(
	cell: Cell,
	kind: "add" | "remove" | "context",
	numWidth: number,
	content: number,
	palette: Palette,
	highlighted: ReadonlyMap<Cell, string>,
	emphasis: { start: number; end: number } | undefined,
): string {
	const changed = cell.changed;
	const fg = !changed ? palette.contextFg : kind === "add" ? palette.addedFg : palette.removedFg;
	const fill = kind === "add" ? palette.addedBg : kind === "remove" ? palette.removedBg : undefined;
	const emphFill = kind === "add" ? palette.addedEmphasis : palette.removedEmphasis;
	const bar = changed ? fg : palette.contextFg;

	let body = highlighted.get(cell) ?? cell.text;
	if (changed && emphasis && emphFill) body = emphasize(body, emphasis.start, emphasis.end, emphFill, fill);
	// Colours do not change the width, so the plain text tells whether the line fits;
	// measuring the coloured line costs more than the rest of the cell.
	const plainWidth = visibleWidth(cell.text);
	body = plainWidth <= content ? body + " ".repeat(content - plainWidth) : truncateToWidth(body, content, "", true);

	const label = String(cell.num).padStart(numWidth);
	// Bar first, then the number: the marker sits in its own column, so the
	// digits line up down the pane and the bar reads as a margin.
	const line = `${bar}${changed ? "▌" : " "}\x1b[39m ${fg}${label}\x1b[39m ${body}`;
	return fill ? paint(line, fill) : line;
}

/** The emphasis spans of a paired row, in graphemes of each side's text. */
function emphasisOf(row: Row): { left?: { start: number; end: number }; right?: { start: number; end: number } } {
	if (!row.left || !row.right || !row.left.changed || !row.right.changed) return {};
	const edges = commonEdges(row.left.text, row.right.text);
	return {
		left: { start: edges.prefix, end: edges.leftLength - edges.suffix },
		right: { start: edges.prefix, end: edges.rightLength - edges.suffix },
	};
}

/**
 * The file heading: `path +3 -1 [+++----]`. The bar is proportional (lazygit's
 * summary line); both halves keep at least one cell when both sides are non-zero.
 */
function renderHeading(path: string, add: number, remove: number, width: number, palette: Palette, theme: Theme): string {
	const counts = `${palette.addedFg}+${add}\x1b[39m ${palette.removedFg}-${remove}\x1b[39m`;
	const prefix = `${theme.fg("accent", theme.bold(path))} ${counts}`;
	const room = width - PAD * 2 - visibleWidth(`${path} +${add} -${remove} []`);
	if (add + remove === 0 || room < 2) return truncateToWidth(`${" ".repeat(PAD)}${prefix}`, width);
	const bar = Math.min(room, 32, Math.max(8, add + remove));
	let added = Math.round((bar * add) / (add + remove));
	if (add > 0 && remove > 0) added = Math.min(bar - 1, Math.max(1, added));
	if (add === 0) added = 0;
	if (remove === 0) added = bar;
	const graph = `${palette.contextFg}[${palette.addedFg}${"+".repeat(added)}${palette.removedFg}${"-".repeat(bar - added)}${palette.contextFg}]\x1b[39m`;
	return truncateToWidth(`${" ".repeat(PAD)}${prefix} ${graph}`, width);
}

/**
 * Render one file's diff for a panel `width` columns wide: a heading, the header
 * lines worth showing, then two panes (old | new), or one column when the panes
 * would be too narrow.
 */
export function renderDiffSection(section: DiffSection, width: number, theme: Theme): string[] {
	const { rows, notes } = parseSection(section.lines);
	const palette = buildPalette(theme);
	const label = (text: string) => `${palette.contextFg}${text}\x1b[39m`;
	let added = 0;
	let removed = 0;
	for (const row of rows) {
		if (row.left?.changed) removed++;
		if (row.right?.changed) added++;
	}
	const lines: string[] = [renderHeading(sanitize(section.path), added, removed, width, palette, theme)];
	for (const note of notes) lines.push(truncateToWidth(`${" ".repeat(PAD)}${label(note)}`, width));

	if (rows.length) {
		const highlighted = highlightCells(section.path, rows);
		const numWidth = numberWidth(rows);
		const lay = layout(width, numWidth);
		const skip = (row: Row) => truncateToWidth(`${" ".repeat(PAD)}${label(row.heading ? `… ${row.heading}` : "…")}`, width);
		if (lay) {
			const separator = `${palette.contextFg}${SEPARATOR}\x1b[39m`;
			lines.push(
				pad(
					`${" ".repeat(PAD)}  ${label("old".padStart(lay.numWidth))} ${" ".repeat(lay.content)}${separator}  ${label("new".padStart(lay.numWidth))}`,
					width,
				),
			);
			for (const row of rows) {
				if (row.kind === "skip") {
					lines.push(skip(row));
					continue;
				}
				const emphasis = emphasisOf(row);
				// The other pane has nothing on this row: keep the cell blank so the two columns stay aligned.
				// A cell is exactly lay.pane wide (bar, space, number, space, code), so the row needs no measuring.
				const left = row.left ? renderCell(row.left, row.left.changed ? "remove" : "context", lay.numWidth, lay.content, palette, highlighted, emphasis.left) : " ".repeat(lay.pane);
				const right = row.right ? renderCell(row.right, row.right.changed ? "add" : "context", lay.numWidth, lay.content, palette, highlighted, emphasis.right) : " ".repeat(lay.pane);
				lines.push(`${" ".repeat(PAD)}${left}${separator}${right}${" ".repeat(width - PAD - 2 * lay.pane - SEPARATOR.length)}`);
			}
		} else {
			// One column: removed lines of a row first, then added ones, as in a unified diff.
			const content = Math.max(1, width - PAD * 2 - numWidth - 3);
			for (const row of rows) {
				if (row.kind === "skip") {
					lines.push(skip(row));
					continue;
				}
				const emphasis = emphasisOf(row);
				if (row.left && row.right && !row.left.changed) {
					lines.push(pad(`${" ".repeat(PAD)}${renderCell(row.left, "context", numWidth, content, palette, highlighted, undefined)}`, width));
					continue;
				}
				if (row.left) lines.push(pad(`${" ".repeat(PAD)}${renderCell(row.left, "remove", numWidth, content, palette, highlighted, emphasis.left)}`, width));
				if (row.right) lines.push(pad(`${" ".repeat(PAD)}${renderCell(row.right, "add", numWidth, content, palette, highlighted, emphasis.right)}`, width));
			}
		}
	}
	if (section.omitted) lines.push(truncateToWidth(`${" ".repeat(PAD)}${label(`… ${section.omitted} more diff lines not shown`)}`, width));
	return lines;
}

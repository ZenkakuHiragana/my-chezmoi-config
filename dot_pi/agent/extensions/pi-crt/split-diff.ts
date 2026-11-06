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
 *   is drawn (pi-tidy leaves that to pi). It lists each change's removed lines,
 *   then its added lines, as a unified diff does.
 * - A code line longer than its column (a pane, or the one column) wraps onto
 *   the next screen lines instead of being cut (pi-tidy cuts it). Only a panel too narrow for the line
 *   number and a character of code (a few columns) still loses text.
 * - Each side of a file is highlighted in one call (pi-tidy highlights line by
 *   line; one call is about twice as fast, and a file has many lines).
 */

import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, type Color, colorToRgb, rgbColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Blank cells on each side of the panes. */
const PAD = 1;
const SEPARATOR = " │ ";
/** When a pane would have fewer columns of code than this, the diff is drawn in one column. */
const MIN_CONTENT_WIDTH = 80;
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
	addedBg: string;
	removedBg: string;
	addedEmphasis: string;
	removedEmphasis: string;
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

/**
 * An absolute background for a diff row: a fixed slice of the diff hue over a
 * dimmed box background. Hue carries the meaning, luminance has to stay low.
 */
function tintBackground(base: Rgb, color: Rgb, hue: number): Color {
	return rgbColor(
		Math.round(color.r * hue + base.r * 0.35),
		Math.round(color.g * hue + base.g * 0.35),
		Math.round(color.b * hue + base.b * 0.35),
	);
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
	// The row tint has no theme slot, so the diff colour is mixed into the tool
	// box background: 16% for the row, 32% for the word. Theme.colors has a colour
	// for every token (for one the theme leaves to the terminal, the colour the
	// terminal reported, or Pi's guess), and the tint is written in the terminal's
	// colour mode.
	const colors = theme.colors;
	const base = colorToRgb(colors.toolSuccessBg);
	const mode = theme.getColorMode();
	const tint = (color: Color, hue: number) => backgroundAnsi(tintBackground(base, colorToRgb(color), hue), mode);
	return {
		addedFg: theme.getFgAnsi("toolDiffAdded"),
		removedFg: theme.getFgAnsi("toolDiffRemoved"),
		contextFg: theme.getFgAnsi("toolDiffContext"),
		addedBg: tint(colors.toolDiffAdded, 0.16),
		removedBg: tint(colors.toolDiffRemoved, 0.16),
		addedEmphasis: tint(colors.toolDiffAdded, 0.32),
		removedEmphasis: tint(colors.toolDiffRemoved, 0.32),
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
	for (const match of rendered.matchAll(SGR)) {
		const at = match.index ?? 0;
		text(rendered.slice(index, at));
		out += match[0];
		index = at + match[0].length;
	}
	text(rendered.slice(index));
	return inside ? out + back : out;
}

/** One SGR sequence (colours and attributes): the only escapes in highlighted text. */
const SGR = /\x1b\[[0-9;:]*m/g;

/** One screen line of a cell's code: the coloured text and its width in columns. */
interface Chunk {
	text: string;
	width: number;
}

/** SGR attributes (bold, italic, ...) by the code that turns each off. */
const ATTRIBUTE_OFF: Record<number, number[]> = { 22: [1, 2], 23: [3], 24: [4], 25: [5], 27: [7], 28: [8], 29: [9] };

/**
 * The colours and attributes in effect at a point of coloured text, so that a wrapped
 * line can start in the state the previous one ended in. Only the state is kept, not
 * every code seen, so each line's prefix stays short however long the text is.
 */
class SgrState {
	private fg = "";
	private bg = "";
	private readonly attributes = new Set<number>();

	/** Take in one SGR sequence (`\x1b[...m`). */
	apply(code: string): void {
		const params = code.slice(2, -1).split(/[;:]/).map((param) => (param === "" ? 0 : Number(param)));
		for (let index = 0; index < params.length; index++) {
			const param = params[index]!;
			if (param === 0) {
				this.fg = "";
				this.bg = "";
				this.attributes.clear();
			} else if (param === 38 || param === 48) {
				// 38;5;n or 38;2;r;g;b (48 for the background).
				const length = params[index + 1] === 5 ? 2 : params[index + 1] === 2 ? 4 : 0;
				const colour = `\x1b[${params.slice(index, index + 1 + length).join(";")}m`;
				if (param === 38) this.fg = colour;
				else this.bg = colour;
				index += length;
			} else if (param === 39) this.fg = "";
			else if (param === 49) this.bg = "";
			else if ((param >= 30 && param <= 37) || (param >= 90 && param <= 97)) this.fg = `\x1b[${param}m`;
			else if ((param >= 40 && param <= 47) || (param >= 100 && param <= 107)) this.bg = `\x1b[${param}m`;
			else if (param >= 1 && param <= 9) this.attributes.add(param);
			else for (const off of ATTRIBUTE_OFF[param] ?? []) this.attributes.delete(off);
		}
	}

	/** Codes that set this state from a reset one. */
	prefix(): string {
		let out = "";
		for (const attribute of this.attributes) out += `\x1b[${attribute}m`;
		return out + this.fg + this.bg;
	}
}

/**
 * Cut coloured `body` into lines of at most `content` columns, in one pass. A line after
 * the first starts in the colours and attributes the previous one ended in, so
 * highlighting and emphasis go on across the cut; every line ends with a full reset
 * (paint sets the row's tint again after it, so the padding keeps the tint). A zero-width grapheme stays on the
 * line it follows. A grapheme wider than `content` gets a line of its own and is cut there
 * by the caller. There is always at least one line.
 *
 * Not pi-tui's wrapTextWithAnsi: it breaks at words and drops the spaces at the break,
 * and a diff has to show every space.
 */
function wrapBody(body: string, content: number): Chunk[] {
	const lines: Chunk[] = [];
	const state = new SgrState();
	let text = "";
	let width = 0;
	const add = (part: string) => {
		const ascii = ASCII.test(part);
		for (const segment of splitGraphemes(part)) {
			const cells = ascii ? 1 : visibleWidth(segment);
			if (cells > 0 && width > 0 && width + cells > content) {
				lines.push({ text: `${text}\x1b[0m`, width });
				text = state.prefix();
				width = 0;
			}
			text += segment;
			width += cells;
		}
	};
	let index = 0;
	for (const match of body.matchAll(SGR)) {
		const at = match.index ?? 0;
		add(body.slice(index, at));
		text += match[0];
		state.apply(match[0]);
		index = at + match[0].length;
	}
	add(body.slice(index));
	lines.push({ text: `${text}\x1b[0m`, width });
	return lines;
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

type CellKind = "add" | "remove" | "context";

/**
 * A cell's code, highlighted, with its changed middle emphasised, cut into lines of at
 * most `content` columns (the width of the code).
 */
function cellChunks(
	cell: Cell,
	kind: CellKind,
	content: number,
	palette: Palette,
	highlighted: ReadonlyMap<Cell, string>,
	emphasis: { start: number; end: number } | undefined,
): Chunk[] {
	let body = highlighted.get(cell) ?? cell.text;
	// The emphasis counts graphemes of the whole line, so it goes on before the cut.
	if (cell.changed && emphasis) {
		body = emphasize(body, emphasis.start, emphasis.end, kind === "add" ? palette.addedEmphasis : palette.removedEmphasis, rowFill(kind, palette));
	}
	// Colours do not change the width, so the plain text tells whether the line fits;
	// most lines do, and need no walk through the coloured text.
	const plainWidth = visibleWidth(cell.text);
	return plainWidth <= content ? [{ text: body, width: plainWidth }] : wrapBody(body, content);
}

/** The background of a cell's lines: tinted on a changed line, none on a context line. */
function rowFill(kind: CellKind, palette: Palette): string | undefined {
	return kind === "add" ? palette.addedBg : kind === "remove" ? palette.removedBg : undefined;
}

/**
 * The screen lines of a cell: bar, number and code (the `chunks` from cellChunks),
 * tinted when changed. The lines after the first leave the number blank. Blank lines
 * are added up to `height` (at least chunks.length), so that the two panes of a row end
 * together. Every line is numWidth + 3 + content columns wide.
 */
function renderCellLines(
	cell: Cell,
	kind: CellKind,
	numWidth: number,
	content: number,
	palette: Palette,
	chunks: readonly Chunk[],
	height = chunks.length,
): string[] {
	const changed = cell.changed;
	const fg = !changed ? palette.contextFg : kind === "add" ? palette.addedFg : palette.removedFg;
	const fill = rowFill(kind, palette);
	const bar = changed ? fg : palette.contextFg;
	const lines: string[] = [];
	for (let index = 0; index < height; index++) {
		const chunk = chunks[index] ?? { text: "", width: 0 };
		const code = chunk.width <= content ? chunk.text + " ".repeat(content - chunk.width) : truncateToWidth(chunk.text, content, "", true);
		const label = index === 0 ? String(cell.num).padStart(numWidth) : " ".repeat(numWidth);
		// Bar first, then the number: the marker sits in its own column, so the
		// digits line up down the pane and the bar reads as a margin, wrapped lines included.
		const line = `${bar}${changed ? "▌" : " "}\x1b[39m ${fg}${label}\x1b[39m ${code}`;
		lines.push(fill ? paint(line, fill) : line);
	}
	return lines;
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
 * would be too narrow. Every line is at most `width` columns wide; a long code line
 * takes several.
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
				const leftKind = row.left?.changed ? "remove" : "context";
				const rightKind = row.right?.changed ? "add" : "context";
				const leftChunks = row.left ? cellChunks(row.left, leftKind, lay.content, palette, highlighted, emphasis.left) : [];
				const rightChunks = row.right ? cellChunks(row.right, rightKind, lay.content, palette, highlighted, emphasis.right) : [];
				const height = Math.max(leftChunks.length, rightChunks.length);
				// The other pane has nothing on this row: keep the cell blank so the two columns stay aligned.
				// A cell line is exactly lay.pane wide (bar, space, number, space, code), so the row needs no measuring.
				const blank = Array<string>(height).fill(" ".repeat(lay.pane));
				const left = row.left ? renderCellLines(row.left, leftKind, lay.numWidth, lay.content, palette, leftChunks, height) : blank;
				const right = row.right ? renderCellLines(row.right, rightKind, lay.numWidth, lay.content, palette, rightChunks, height) : blank;
				const end = " ".repeat(width - PAD - 2 * lay.pane - SEPARATOR.length);
				for (let index = 0; index < height; index++) lines.push(`${" ".repeat(PAD)}${left[index]}${separator}${right[index]}${end}`);
			}
		} else {
			// One column, as a unified diff: the lines of a change that are removed, then the
			// ones that are added. Consecutive changed rows are one change: git separates two
			// changes with a context line or a hunk header, and parseSection pairs a change's
			// removed and added lines into its rows.
			const content = Math.max(1, width - PAD * 2 - numWidth - 3);
			const addCell = (cell: Cell, kind: CellKind, emphasis: { start: number; end: number } | undefined) => {
				const chunks = cellChunks(cell, kind, content, palette, highlighted, emphasis);
				for (const line of renderCellLines(cell, kind, numWidth, content, palette, chunks)) lines.push(pad(`${" ".repeat(PAD)}${line}`, width));
			};
			let change: Row[] = [];
			const flush = () => {
				const emphases = change.map(emphasisOf);
				for (const [index, row] of change.entries()) if (row.left) addCell(row.left, "remove", emphases[index]!.left);
				for (const [index, row] of change.entries()) if (row.right) addCell(row.right, "add", emphases[index]!.right);
				change = [];
			};
			for (const row of rows) {
				if (row.kind === "row" && (row.left?.changed || row.right?.changed)) {
					change.push(row);
					continue;
				}
				flush();
				if (row.kind === "skip") lines.push(skip(row));
				else if (row.left) addCell(row.left, "context", undefined);
			}
			flush();
		}
	}
	if (section.omitted) lines.push(truncateToWidth(`${" ".repeat(PAD)}${label(`… ${section.omitted} more diff lines not shown`)}`, width));
	return lines;
}

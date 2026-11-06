/**
 * MAP's TREE and LOCATION panels: the session tree, drawn by pi-crt from
 * sessionManager.getTree(), and a preview of the selected row.
 *
 * A row stands for its first entry: Enter jumps there, the label key labels it and
 * the copy key copies its text, each as /tree does for that entry. In the ALL TALK
 * filter, a user message and the replies, tool calls and results after it make one
 * row, a turn. A turn that ends a branch is followed by a row (╴ END) for the point to
 * continue the branch from: after the turn's last entry that a jump can put pi after
 * (a jump to a user or custom message puts pi before it, see jumpsBefore), with what
 * follows that entry. There is none when that entry is the turn's first one, where
 * Enter on the turn goes already, or when no entry of the turn is one. A fork ends the row; a
 * compaction or a summary gets a row of its own. LABELED and EVERYTHING show one
 * entry per row. A chain of rows stays in one column; a fork indents its branches
 * under ├─ and └─, and its row shows ◆ and the number of branches. The last row of a
 * branch shows ╴ and the number of entries the branch holds. Each row ends with how
 * full the context was after it, and when it was. The path from the root to where pi is now is drawn
 * bright and everything off it dim; the row pi is in says HERE (after a jump to a user
 * message, that message's row, as pi is before it), which blinks while the
 * agent runs. The line at the top sums up the tree; the line at the bottom has the
 * selection's position, the filter and the keys.
 *
 * LOCATION previews the selected row: when and where it is, its labels, then the
 * first entry's text and the last reply in full as Markdown, and each reply between
 * them as one line with the tools it called and what failed.
 *
 * Keys in panel mode: the arrow keys or j/k move, Pi's viewport keys (PageUp/PageDown
 * and the rest, shell/input.ts) scroll, Home/End go to the ends, Enter jumps. [ and ]
 * go to the previous and next fork, . back to HERE.
 * /tree's keys, as the user has them bound: its filter keys switch among ALL TALK,
 * LABELED and EVERYTHING (the filter starts from /tree's treeFilterMode setting, ALL
 * TALK for a filter pi-crt does not have), its label key (shift+l) sets or removes the
 * label in a field on the bottom line, and its copy key (ctrl+x) copies. ? shows these
 * keys under the rows, in the panel, until it is pressed again, so they can be tried
 * with the tree in view.
 * Mouse: the wheel scrolls, a click selects, a double click jumps.
 *
 * The tree is flattened into rows when it or the filter changes. Drawing writes only
 * the rows on screen. What a row shows (its look and labels, see rowShown) is worked out
 * the first time it is drawn after the rows were made, in time that grows with the
 * entries the row holds; drawing it again only colours and measures that, so a redraw
 * (HERE blinking, say) does not grow with the entries of the session or of a turn. It
 * grows with the labels the row shows, which are measured whole, as Pi's /tree measures
 * the label of each of its rows.
 */
import type { AppKeybinding, SessionTreeNode, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, keyText } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getKeybindings,
	Input,
	type Keybinding,
	Markdown,
	matchesKey,
	truncateToWidth,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { contextUsage } from "../features/context.ts";
import { canLabel, copyEntry, initialFilter, jumpedBefore, jumpsBefore, jumpTo, sessionTree, setEntryLabel, TREE_PANEL, type TreeFilterMode } from "../features/tree.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { type CrtState, sanitize } from "../state/core.ts";
import { bar, compactNumber } from "./common.ts";
import { type ListControl, type PanelEnv, registerPanel, VIEWPORT_KEYS } from "./registry.ts";

type Entry = SessionTreeNode["entry"];

/** Rows drawn before the panel has been laid out once. */
const FALLBACK_HEIGHT = 20;
/** The lines around the rows: the summary at the top, the position and keys at the bottom. */
const CHROME_LINES = 2;
/** Rows kept between the selection and the edge when moving with keys. */
const MARGIN = 2;
/** Cells of the context bar at the end of a row. */
const CONTEXT_CELLS = 5;
/** Narrowest panel that still shows the context bar on its rows. */
const CONTEXT_MIN_WIDTH = 70;
/** Entries that record settings and bookkeeping rather than the conversation. */
const BOOKKEEPING = new Set<Entry["type"]>(["label", "context_edit", "custom", "model_change", "thinking_level_change", "session_info", "usage"]);
/** The filters in /tree's cycling order, with the names shown in the footer. */
const FILTERS: ReadonlyArray<readonly [TreeFilterMode, string]> = [
	["default", "ALL TALK"],
	["labeled-only", "LABELED"],
	["all", "EVERYTHING"],
];
/**
 * /tree's filter keys for the filters above: the filter each one switches to (or toggles
 * with the default), and what ? says it does.
 */
const FILTER_KEYS: ReadonlyArray<readonly [AppKeybinding, TreeFilterMode | "next" | "previous", string]> = [
	["app.tree.filter.cycleForward", "next", "next filter"],
	["app.tree.filter.cycleBackward", "previous", "previous filter"],
	["app.tree.filter.default", "default", "ALL TALK"],
	["app.tree.filter.labeledOnly", "labeled-only", "LABELED (again: ALL TALK)"],
	["app.tree.filter.all", "all", "EVERYTHING (again: ALL TALK)"],
];
/** What ? lists: the keys TREE adds to those the editor's border shows, as the user has them bound. */
const KEYS: ReadonlyArray<readonly [() => string, string]> = [
	...VIEWPORT_KEYS.map(({ keys, what }) => [() => keyPair(...keys), what] as const),
	[() => "home/end", "first / last row"],
	[() => "[ ]", "previous / next fork"],
	[() => ".", "back to HERE"],
	...FILTER_KEYS.map(([id, , what]) => [() => keyText(id), what] as const),
	[() => keyText("app.tree.editLabel"), "set or remove the label"],
	[() => keyText("app.message.copy"), "copy the text"],
];

/** `up/down` as the user has the two bound; empty when neither is. */
function keyPair(up: Keybinding, down: Keybinding): string {
	const keys = [keyText(up), keyText(down)];
	return keys.some(Boolean) ? keys.map((key) => key || "-").join("/") : "";
}

/** One row: a chain of entries, and the tree lines drawn before it. */
interface Row {
	/** The entries of the row: the first, then each one that follows the one before. */
	nodes: SessionTreeNode[];
	/**
	 * The row for where a branch that ends in a turn goes on from (╴ END): the turn's last
	 * entry that Pi can be after, then what follows it in the turn.
	 */
	tip?: boolean;
	/** On a turn row whose end has a tip row: the index of the first entry the tip row holds. */
	tipFrom?: number;
	/** One column per fork above: "│ " where that fork goes on below this row, "  " where it has ended. */
	gutter: string;
	/** The branch this row starts, or "" when it continues the row above. */
	connector: "" | "├─" | "└─";
	/** Shown branches that go on from the row's last entry; more than one is a fork. */
	branches: number;
	/** On the last row of a branch, the entries the branch holds. */
	branchSize?: number;
	turn: Turn;
	/** How the row is drawn, worked out when it is first drawn (see rowShown); rows are made again when the tree changes. */
	shown?: { look: Look & { tail: string }; labels: string };
}

/** What the entries of a row add up to. */
interface Turn {
	/** Names of the tools called, in order. */
	calls: string[];
	/** Failed tool calls, commands and replies. */
	errors: number;
	/** The first line of the last text the assistant wrote in the row (see replyLine). */
	replyLine: string;
	/** Context tokens after the row's last reply that reports its usage. */
	tokens?: number;
}

/** How an entry is shown: a four-letter tag, its colour, and one line of text. */
interface Look {
	tag: string;
	color: ThemeColor;
	text: string;
}

/** The selected row, for LOCATION. */
interface Selected {
	row: Row;
	here: boolean;
	/** Tokens a full context bar stands for. */
	scale: number;
	contextWindow?: number;
}

/** Each pi-crt instance's TREE view, by its CrtState, for LOCATION. */
const views = new WeakMap<CrtState, TreeView>();

registerPanel(TREE_PANEL, (env) => {
	const view = new TreeView(env);
	views.set(env.state, view);
	const panel = framed(env.theme, () => "TREE", view, "sized", () => env.focused(TREE_PANEL));
	view.sized = panel.scroll as SizedView;
	return { ...panel, list: view };
});

registerPanel("location", (env) =>
	framed(
		env.theme,
		() => "LOCATION",
		new Lines(
			(width) => locationLines(env, width),
			() => {
				// Bring the rows up to date first, so a change shows on this frame.
				const view = views.get(env.state);
				view?.selection();
				return [view?.version];
			},
		),
		"top",
		() => env.focused("location"),
	));

class TreeView implements Component, ListControl {
	sized?: SizedView;
	/** Changes whenever what LOCATION shows changes: the selection, the rows. */
	version = 0;
	/** ? shows TREE's keys under the rows until it is pressed again. */
	private help = false;
	private rows: Row[] = [];
	/** The label being typed on the bottom line; on submit it goes on the entry openLabel picked. */
	private label?: Input;
	/** Row index of each shown entry. */
	private rowOf = new Map<string, number>();
	/** Every entry by id, shown or not, to find the nearest shown ancestor. */
	private byId = new Map<string, Entry>();
	/** Entries under each entry, itself included. */
	private sizes = new Map<string, number>();
	/** Entries from the root to where pi is now. */
	private path = new Set<string>();
	private leafId: string | null = null;
	/** The row that says HERE: pi's point, or its nearest shown ancestor when the filter hides it. */
	private hereRow = -1;
	/** The line at the top: the session's name, its branches, its deepest fork. */
	private summary = { name: "", branches: 0, depth: 0 };
	/** Tokens a full context bar stands for: the context window, or the most any row used. */
	private scale = 1;
	private contextWindow?: number;
	private filter?: TreeFilterMode;
	private builtVersion = -1;
	private builtFilter?: TreeFilterMode;
	private selected = 0;
	private top = 0;
	/** Rows the list had when last drawn. */
	private listRows = FALLBACK_HEIGHT - CHROME_LINES;

	constructor(private readonly env: PanelEnv) {}

	invalidate(): void {}

	render(width: number): string[] {
		const height = this.sized && this.sized.viewportHeight > 0 ? this.sized.viewportHeight : FALLBACK_HEIGHT;
		if (this.sized) this.sized.drawnFor = this.sized.viewportHeight;
		const t = this.env.theme();
		const keys = this.help ? keyLines(t, width) : [];
		// The keys and the rule above them take what the rows leave, at least one row.
		const shown = keys.slice(0, Math.max(0, height - CHROME_LINES - 2));
		const listRows = Math.max(1, height - CHROME_LINES - (shown.length ? shown.length + 1 : 0));
		const resized = listRows !== this.listRows;
		this.listRows = listRows;
		this.rebuild();
		if (resized) this.keepInView(0);
		const lines: string[] = [this.header(width, t)];
		if (this.rows.length === 0) {
			lines.push(t.fg("dim", this.byId.size === 0 ? " -- no entries --" : " -- nothing in this filter --"));
		}
		for (let index = this.top; index < Math.min(this.rows.length, this.top + listRows); index++) {
			lines.push(this.rowLine(this.rows[index]!, index, width, t));
		}
		while (lines.length < listRows + 1) lines.push("");
		if (shown.length) lines.push(t.fg("borderMuted", "─".repeat(width)), ...shown);
		lines.push(this.label ? this.labelLine(this.label, width, t) : this.footer(width, t));
		return lines;
	}

	/** The selected row and what LOCATION shows with it; undefined when there are no rows. */
	selection(): Selected | undefined {
		this.rebuild();
		const row = this.rows[this.selected];
		if (!row) return undefined;
		return {
			row,
			here: this.selected === this.hereRow,
			scale: this.scale,
			contextWindow: this.contextWindow,
		};
	}

	/* ------------------------------------------------------------ rows */

	/** Flatten the tree again when it or the filter changed, keeping the selection where it can. */
	private rebuild(): void {
		const data = sessionTree(this.env.state);
		if (this.filter === undefined) {
			const initial = initialFilter(this.env.state);
			this.filter = FILTERS.some(([mode]) => mode === initial) ? initial : "default";
		}
		if (data.version === this.builtVersion && this.filter === this.builtFilter && this.rows.length + this.byId.size > 0) return;
		const first = this.builtVersion < 0;
		const previous = this.rows[this.selected]?.nodes[0]!.entry.id;
		const offset = this.selected - this.top;
		// Every entry once, parents before children, counting the forks above each.
		const order: SessionTreeNode[] = [];
		let branches = 0;
		let depth = 0;
		const stack: Array<[SessionTreeNode, number]> = data.tree.map((node) => [node, data.tree.length > 1 ? 1 : 0]);
		while (stack.length) {
			const [node, forks] = stack.pop()!;
			order.push(node);
			if (node.children.length === 0) branches++;
			depth = Math.max(depth, forks);
			const below = forks + (node.children.length > 1 ? 1 : 0);
			for (const child of node.children) stack.push([child, below]);
		}
		this.byId = new Map(order.map((node) => [node.entry.id, node.entry]));
		this.sizes = new Map();
		for (let index = order.length - 1; index >= 0; index--) {
			const node = order[index]!;
			let size = 1;
			for (const child of node.children) size += this.sizes.get(child.entry.id) ?? 0;
			this.sizes.set(node.entry.id, size);
		}
		this.leafId = data.leafId;
		this.path = new Set();
		let name = "";
		for (let id = data.leafId; id !== null; id = this.byId.get(id)?.parentId ?? null) {
			this.path.add(id);
			const entry = this.byId.get(id);
			if (!name && entry?.type === "session_info" && entry.name) name = sanitize(entry.name);
		}
		this.summary = { name, branches, depth };
		const sizeOf = (node: SessionTreeNode) => this.sizes.get(node.entry.id) ?? 1;
		this.rows = flatten(data.tree, filterTest(this.filter), this.filter === "default", sizeOf);
		this.rowOf = new Map();
		this.rows.forEach((row, index) => {
			for (const node of row.nodes) this.rowOf.set(node.entry.id, index);
		});
		this.contextWindow = contextUsage(this.env.state)?.contextWindow || undefined;
		let most = 0;
		for (const row of this.rows) most = Math.max(most, row.turn.tokens ?? 0);
		this.scale = Math.max(1, this.contextWindow ?? 0, most);
		this.builtVersion = data.version;
		this.builtFilter = this.filter;
		// Right after a jump to a user message, pi is before it: HERE goes on its row.
		const before = jumpedBefore(this.env.state);
		const beforeRow = before === undefined ? undefined : this.rowOf.get(before);
		this.hereRow = this.rows.length === 0 ? -1 : (beforeRow ?? this.nearestRow(data.leafId));
		// The selection starts where pi is, then stays on its entry as the tree changes (pi
		// moving on as the agent works too), at the same place in the list.
		this.selected = first ? Math.max(0, this.hereRow) : this.nearestRow(previous ?? data.leafId);
		this.top = this.selected - (first ? Math.floor(this.listRows / 2) : offset);
		this.keepInView(0);
		this.version++;
	}

	/** The row of an entry, or of its nearest shown ancestor; the last row when there is none. */
	private nearestRow(id: string | null | undefined): number {
		for (let at = id ?? null; at !== null; at = this.byId.get(at)?.parentId ?? null) {
			const row = this.rowOf.get(at);
			if (row !== undefined) return row;
		}
		return Math.max(0, this.rows.length - 1);
	}

	private rowLine(row: Row, index: number, width: number, t: Theme): string {
		const head = row.nodes[0]!;
		const last = row.nodes[row.nodes.length - 1]!;
		const { look, labels } = rowShown(row);
		const onPath = this.path.has(head.entry.id);
		const here = index === this.hereRow;
		const selected = index === this.selected;
		const hereLit = !(here && this.env.state.agentRunning && this.env.every(480) % 2 === 1);
		const right = [
			row.branches > 1 ? t.fg(onPath ? "warning" : "dim", `◆${row.branches}`) : "",
			row.branchSize !== undefined ? t.fg("dim", `╴${compactNumber(row.branchSize)}`) : "",
			labels ? t.fg("warning", labels) : "",
			here ? t.fg(hereLit ? "accent" : "dim", t.bold("HERE")) : "",
			width >= CONTEXT_MIN_WIDTH ? this.contextCell(row, t) : "",
			t.fg("dim", ago(last.entry.timestamp).padStart(3)),
		]
			.filter(Boolean)
			.join(" ");
		// Deep forks keep at most a third of the row; the outer columns give way first.
		let lines = row.gutter + row.connector;
		const maxLines = Math.max(2, Math.floor(width / 3));
		if (lines.length > maxLines) lines = `‥${lines.slice(lines.length - maxLines + 1)}`;
		const mark = selected ? t.fg("accent", "▌") : " ";
		const tag = onPath ? t.fg(look.color, here ? t.bold(look.tag) : look.tag) : t.fg("dim", look.tag);
		const text = look.text ? ` ${t.fg(onPath ? "text" : "dim", look.text)}` : "";
		const tail = look.tail ? `${t.fg("dim", " →")} ${t.fg(onPath ? "muted" : "dim", look.tail)}` : "";
		const errors = row.nodes.length > 1 && row.turn.errors ? t.fg(onPath ? "error" : "dim", ` ✗${row.turn.errors}`) : "";
		const left = `${mark}${t.fg(onPath ? "accent" : "borderMuted", lines)}${tag}${errors}${text}${tail}`;
		const room = Math.max(1, width - visibleWidth(right) - 2);
		const line = `${truncateToWidth(left, room, "…", true)} ${right} `;
		return selected ? t.bg("selectedBg", truncateToWidth(line, width, "", true)) : line;
	}

	/** `██▍    62k`: the context after the row, or blank cells when no reply in it says. */
	private contextCell(row: Row, t: Theme): string {
		const tokens = row.turn.tokens;
		if (tokens === undefined) return " ".repeat(CONTEXT_CELLS + 5);
		return `${bar(t, tokens / this.scale, CONTEXT_CELLS)} ${t.fg("muted", compactNumber(tokens).padStart(4))}`;
	}

	private header(width: number, t: Theme): string {
		const { name, branches, depth } = this.summary;
		const parts = [
			name ? t.fg("accent", t.bold(name)) : "",
			`${t.fg("text", String(branches))} ${t.fg("dim", branches === 1 ? "BRANCH" : "BRANCHES")}`,
			`${t.fg("text", compactNumber(this.byId.size))} ${t.fg("dim", "ENTRIES")}`,
			`${t.fg("dim", "DEPTH")} ${t.fg("text", String(depth))}`,
		].filter(Boolean);
		return truncateToWidth(` ${parts.join(t.fg("borderMuted", " · "))}`, width, "…");
	}

	private footer(width: number, t: Theme): string {
		const name = FILTERS.find(([mode]) => mode === this.filter)?.[1] ?? "";
		const position = this.rows.length > 0 ? `${this.selected + 1}/${this.rows.length}` : "0/0";
		const head = `${t.fg("borderMuted", "──")} ${t.fg("accent", position)} ${t.fg("borderMuted", "·")} ${t.fg("accent", t.bold(name))} `;
		// The hints that do not fit go first from the left: the filter key and ? stay longest.
		const hints = this.help ? ["? back"] : ["[ ] fork", ". here", `${keyText("app.tree.filter.cycleForward")} filter`, "? keys"];
		let keys = "";
		while (hints.length) {
			keys = t.fg("dim", ` ${hints.join(" · ")} `);
			if (width - visibleWidth(head) - visibleWidth(keys) >= 2) break;
			hints.shift();
			keys = "";
		}
		const fill = Math.max(0, width - visibleWidth(head) - visibleWidth(keys));
		return truncateToWidth(`${head}${t.fg("borderMuted", "─".repeat(fill))}${keys}`, width);
	}

	/* ------------------------------------------------------------ moving */

	/** Scroll so the selection is `margin` rows inside the list, and keep the list on its rows. */
	private keepInView(margin: number): void {
		const room = Math.min(margin, Math.floor((this.listRows - 1) / 2));
		if (this.selected < this.top + room) this.top = this.selected - room;
		if (this.selected > this.top + this.listRows - 1 - room) this.top = this.selected - this.listRows + 1 + room;
		this.top = Math.max(0, Math.min(this.top, this.rows.length - this.listRows));
	}

	/** The bottom line while a label is typed: the field, as /tree's label input asks for it. */
	private labelLine(input: Input, width: number, t: Theme): string {
		const head = `${t.fg("borderMuted", "──")} ${t.fg("accent", t.bold("LABEL"))} ${t.fg("dim", "(empty to remove)")} `;
		const room = width - visibleWidth(head);
		// Too narrow for the words: the field alone.
		if (room < 10) return input.render(Math.max(1, width))[0] ?? "";
		const field = input.render(room)[0] ?? "";
		return head + field;
	}

	private select(index: number): void {
		if (this.rows.length === 0) return;
		this.selected = Math.max(0, Math.min(this.rows.length - 1, index));
		this.keepInView(MARGIN);
		this.version++;
	}

	move(delta: number): void {
		this.select(this.selected + delta);
	}

	/** Scroll the rows shown (fewer while ? shows the keys) and select the row then at the top, as ListControl does. */
	scroll(by: (height: number) => number): void {
		if (this.rows.length === 0) return;
		const lines = by(this.listRows);
		const top = Math.max(0, Math.min(this.top + lines, this.rows.length - this.listRows));
		// At the end already, the rows do not move: the key goes on to the row at that end.
		if (top === this.top) return lines > 0 ? this.toEnd() : this.toStart();
		this.top = top;
		this.selected = top;
		this.version++;
	}

	toStart(): void {
		this.select(0);
	}

	toEnd(): void {
		this.select(this.rows.length - 1);
	}

	/**
	 * Jump to the row's first entry, as /tree does to that entry. On the tip row that says
	 * HERE, pi is at the branch's end already, maybe past entries the filter hides: it stays.
	 */
	activate(): void {
		const row = this.rows[this.selected];
		if (!row) return;
		const here = row.tip && this.selected === this.hereRow && this.leafId !== null;
		jumpTo(this.env.state, here ? this.leafId! : row.nodes[0]!.entry.id);
	}

	typing(): boolean {
		return this.label !== undefined;
	}

	/**
	 * The label field's keys while it is open; else [ and ] for the previous and next
	 * fork, . for HERE, ? for the keys, and /tree's filter, label and copy keys.
	 */
	key(data: string): boolean {
		if (this.label) {
			// Esc (also what alt+o sends first) and Tab close the field; Enter saves.
			if (matchesKey(data, "escape") || matchesKey(data, "tab")) this.closeLabel();
			else this.label.handleInput(data);
			return true;
		}
		if (matchesKey(data, "?")) {
			this.help = !this.help;
			return true;
		}
		if (matchesKey(data, "[") || matchesKey(data, "]")) {
			const step = matchesKey(data, "]") ? 1 : -1;
			for (let index = this.selected + step; index >= 0 && index < this.rows.length; index += step) {
				if (this.rows[index]!.branches > 1) {
					this.select(index);
					break;
				}
			}
			return true;
		}
		if (matchesKey(data, ".")) {
			this.select(this.hereRow);
			return true;
		}
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "app.tree.editLabel")) {
			this.openLabel();
			return true;
		}
		if (keybindings.matches(data, "app.message.copy")) {
			const row = this.rows[this.selected];
			if (row) copyEntry(this.env.state, copyText(row.nodes[0]!.entry));
			return true;
		}
		const found = FILTER_KEYS.find(([id]) => keybindings.matches(data, id));
		if (!found) return false;
		this.filter = nextFilter(this.filter ?? "default", found[1]);
		return true;
	}

	/** Open the label field for the selected row's first entry. */
	private openLabel(): void {
		const row = this.rows[this.selected];
		if (!row || !canLabel(this.env.state)) return;
		const node = row.nodes[0]!;
		const input = new Input({ prompt: "› " });
		input.setValue(node.label ?? "");
		input.focused = true;
		const entryId = node.entry.id;
		input.onSubmit = (value) => {
			this.closeLabel();
			setEntryLabel(this.env.state, entryId, value);
		};
		input.onEscape = () => this.closeLabel();
		this.label = input;
	}

	private closeLabel(): void {
		if (this.label) this.label.focused = false;
		this.label = undefined;
	}

	/** The wheel scrolls; a click selects the row under it, a double click jumps there. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// While a label is typed the row it goes on stays selected, as /tree hides its list then.
		if (this.label) return event.type === "wheel" ? undefined : { handled: true };
		if (event.type === "wheel") {
			const delta = Math.trunc(event.wheelDelta ?? 0);
			this.top = Math.max(0, Math.min(this.top + delta, this.rows.length - this.listRows));
			return { handled: true };
		}
		// The rows start under the summary line.
		if (event.button !== "left" || event.y < 1 || event.y > this.listRows) return undefined;
		const index = this.top + event.y - 1;
		if (index >= this.rows.length) return undefined;
		if (event.type === "press") {
			this.select(index);
			return { handled: true };
		}
		if (event.type === "click" && (event.clickCount ?? 1) >= 2) {
			this.select(index);
			this.activate();
			return { handled: true };
		}
		return undefined;
	}
}

/* ------------------------------------------------------------ LOCATION */

function locationLines(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const view = views.get(env.state);
	const info = view?.selection();
	if (!info) return [t.fg("dim", " -- nothing selected --")];
	const { row } = info;
	const head = row.nodes[0]!;
	const last = row.nodes[row.nodes.length - 1]!;
	const look = rowLook(row);
	const inner = Math.max(1, width - 2);
	const lines: string[] = [];
	const here = info.here ? ` ${t.fg("accent", t.bold("HERE"))}` : "";
	const span = row.nodes.length > 1 ? `–${localTime(last.entry.timestamp).slice(-5)}` : "";
	const entries = row.nodes.length > 1 ? ` · ${row.nodes.length} entries` : "";
	const when = `${localTime(head.entry.timestamp)}${span} (${ago(last.entry.timestamp)})${entries}`;
	lines.push(` ${t.fg(look.color, t.bold(look.tag))} ${t.fg("dim", when)}${here}`);
	for (const node of rowLabels(row)) {
		const set = node.labelTimestamp ? t.fg("dim", `  labeled ${localTime(node.labelTimestamp)} (${ago(node.labelTimestamp)})`) : "";
		lines.push(` ${t.fg("warning", `#${sanitize(node.label!)}`)}${set}`);
	}
	if (row.turn.tokens !== undefined) {
		const of = info.contextWindow ? t.fg("dim", ` / ${compactNumber(info.contextWindow)}`) : "";
		const cells = Math.max(6, Math.min(24, inner - 20));
		lines.push(` ${t.fg("dim", "CONTEXT")} ${bar(t, row.turn.tokens / info.scale, cells)} ${t.fg("text", compactNumber(row.turn.tokens))}${of}`);
	}
	if (row.branches > 1) lines.push(` ${t.fg("warning", `◆ ${row.branches} branches`)}`);
	else if (row.branchSize !== undefined) lines.push(t.fg("dim", ` ╴ end of branch · ${row.branchSize} entries in this branch`));
	// The first entry's text and the last reply in full; each reply between them in a line.
	const final = [...row.nodes].reverse().find((node) => node !== head && isReply(node.entry));
	const markdown = (text: string) => new Markdown(text, 1, 0, getMarkdownTheme()).render(width);
	const headText = fullText(head.entry);
	lines.push("");
	// Not push(...): a long text renders to more lines than a call takes arguments.
	let shown = lines.concat(headText ? markdown(headText) : [` ${t.fg("muted", describe(head.entry).text)}`]);
	for (const node of row.nodes.slice(1)) {
		if (node === final) shown = shown.concat("", ` ${t.fg("dim", "REPLY")}`, markdown(fullText(node.entry)));
		else shown.push(...stepLine(node.entry, t));
	}
	return shown.map((line) => truncateToWidth(line, width, "…"));
}

/** A reply with text: the last one of a row is shown in full. */
function isReply(entry: Entry): boolean {
	return entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason !== "error" && fullText(entry) !== "";
}

/** One line for an entry between a row's first one and its last reply: what it said or did. */
function stepLine(entry: Entry, t: Theme): string[] {
	if (entry.type === "custom_message") return [` ${t.fg("muted", `· NOTE ${sanitize(entry.customType)}: ${firstLine(contentText(entry.content))}`)}`];
	if (entry.type !== "message") return [];
	const message = entry.message;
	switch (message.role) {
		case "assistant": {
			if (message.stopReason === "error") return [` ${t.fg("error", `✗ ${firstLine(message.errorMessage ?? "error")}`)}`];
			// The line shown is the first one of the first text that has one; the rest is not read.
			const first = message.content.find((block) => block.type === "text" && /\S/.test(block.text));
			const text = first?.type === "text" ? firstLine(first.text) : "";
			const calls = toolNames(message.content.flatMap((block) => (block.type === "toolCall" ? [block.name] : [])));
			const said = text ? t.fg("text", `· ${text}`) : "";
			const did = calls ? t.fg("muted", `${text ? " " : ""}→ ${calls}`) : "";
			return said || did ? [` ${said}${did}`] : [];
		}
		case "toolResult":
			return message.isError ? [` ${t.fg("error", `✗ ${sanitize(message.toolName)} failed`)}`] : [];
		case "bashExecution":
			return [` ${t.fg(message.exitCode ? "error" : "muted", `$ ${firstLine(message.command)}${message.exitCode ? `  ✗ exit ${message.exitCode}` : ""}`)}`];
		case "custom":
			return [` ${t.fg("muted", `· NOTE ${sanitize(message.customType)}: ${firstLine(contentText(message.content))}`)}`];
		default:
			return [];
	}
}

/** An entry's text as /tree's copy key copies it. */
function copyText(entry: Entry): string | undefined {
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "bashExecution") return message.command;
		if ("content" in message) {
			const text = typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
			return text || (message.role === "assistant" ? message.errorMessage : undefined);
		}
		return undefined;
	}
	if (entry.type === "custom_message") return typeof entry.content === "string" ? entry.content : entry.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	if (entry.type === "compaction" || entry.type === "branch_summary") return entry.summary;
	return undefined;
}

/**
 * What ? shows under the rows: TREE's keys as the user has them bound (unbound ones
 * left out), in as many columns as the width takes, row by row.
 */
function keyLines(t: Theme, width: number): string[] {
	const keys = KEYS.map(([key, what]) => [key(), what] as const).filter(([key]) => key);
	const keyWidth = Math.max(...keys.map(([key]) => visibleWidth(key))) + 2;
	const cell = keyWidth + Math.max(...keys.map(([, what]) => visibleWidth(what)));
	const gap = 3;
	const columns = Math.max(1, Math.floor((width - 1 + gap) / (cell + gap)));
	const lines: string[] = [];
	for (let at = 0; at < keys.length; at += columns) {
		const cells = keys.slice(at, at + columns).map(([key, what]) => `${t.fg("accent", key)}${" ".repeat(keyWidth - visibleWidth(key))}${t.fg("text", what)}${" ".repeat(cell - keyWidth - visibleWidth(what))}`);
		lines.push(truncateToWidth(` ${cells.join(" ".repeat(gap))}`, width, "…"));
	}
	return lines;
}

/** The whole text of an entry that has one, without control characters other than line breaks. */
function fullText(entry: Entry): string {
	let text = "";
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user" || message.role === "custom") text = contentText(message.content);
		else if (message.role === "assistant") text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
	} else if (entry.type === "custom_message") text = contentText(entry.content);
	else if (entry.type === "compaction" || entry.type === "branch_summary") text = entry.summary;
	// Blank lines around the text go, but not the first line's indent: in Markdown an
	// indented line is code.
	return text
		.split("\n")
		.map((line) => sanitize(line))
		.join("\n")
		.replace(/^(?:[ \t]*\n)+/, "")
		.trimEnd();
}

/* ------------------------------------------------------------ the tree as rows */

/**
 * The tree as rows, depth first in the session's order. Entries the filter hides are
 * skipped and their children take their place, so a hidden fork still forks. With
 * `turns`, an entry that belongs to the turn on the row above joins that row.
 */
function flatten(
	roots: readonly SessionTreeNode[],
	shows: (node: SessionTreeNode) => boolean,
	turns: boolean,
	sizeOf: (node: SessionTreeNode) => number,
): Row[] {
	const rows: Row[] = [];
	/** `branch` is the entry the branch it is on starts with; a fork starts one per child. */
	type Item = { node: SessionTreeNode; gutter: string; connector: Row["connector"]; branch: SessionTreeNode };
	const stack: Item[] = [];
	const push = (children: SessionTreeNode[], gutter: string, branch?: SessionTreeNode) => {
		if (children.length === 1) stack.push({ node: children[0]!, gutter, connector: "", branch: branch ?? children[0]! });
		else for (let index = children.length - 1; index >= 0; index--) {
			const child = children[index]!;
			stack.push({ node: child, gutter, connector: index < children.length - 1 ? "├─" : "└─", branch: child });
		}
	};
	push(shownChildren(roots, shows), "");
	while (stack.length) {
		const { node, gutter, connector, branch } = stack.pop()!;
		const children = shownChildren(node.children, shows);
		// An item with no connector is the only child of the last row's last entry.
		const above = rows[rows.length - 1];
		let row: Row;
		if (turns && connector === "" && above && !above.tip && joins(above, node)) {
			row = above;
			row.nodes.push(node);
		} else {
			row = { nodes: [node], gutter, connector, branches: 0, turn: { calls: [], errors: 0, replyLine: "" } };
			rows.push(row);
		}
		addToTurn(row.turn, node.entry);
		row.branches = children.length;
		row.branchSize = children.length === 0 ? sizeOf(branch) : undefined;
		const below = gutter + (connector === "├─" ? "│ " : connector === "└─" ? "  " : "");
		// A turn that ends a branch gets a row for where the branch goes on from: after its
		// last entry that Pi can be after (a jump to a user or custom message goes before it).
		// None when that is the turn's first entry, where Enter on the turn already goes.
		const from = turns && children.length === 0 ? row.nodes.findLastIndex((item) => !jumpsBefore(item.entry)) : -1;
		if (from > 0) {
			rows.push({ nodes: row.nodes.slice(from), tip: true, gutter: below, connector: "", branches: 0, branchSize: row.branchSize, turn: { calls: [], errors: 0, replyLine: "", tokens: row.turn.tokens } });
			row.tipFrom = from;
			row.branchSize = undefined;
		}
		push(children, below, branch);
	}
	return rows;
}

/** Whether an entry goes on the row above: a reply, tool result, command or note after a user message. */
function joins(row: Row, node: SessionTreeNode): boolean {
	const head = row.nodes[0]!;
	if (!inTurn(node.entry)) return false;
	return inTurn(head.entry) || (head.entry.type === "message" && head.entry.message.role === "user");
}

/** Entries that belong to the turn of the user message before them. */
function inTurn(entry: Entry): boolean {
	if (entry.type === "custom_message") return true;
	if (entry.type !== "message") return false;
	const role = entry.message.role;
	return role === "assistant" || role === "toolResult" || role === "bashExecution" || role === "custom";
}

function addToTurn(turn: Turn, entry: Entry): void {
	if (entry.type !== "message") return;
	const message = entry.message;
	if (message.role === "assistant") {
		for (const block of message.content) if (block.type === "toolCall") turn.calls.push(block.name);
		if (message.stopReason === "error") turn.errors++;
		const line = replyLine(message);
		if (line) turn.replyLine = line;
		const tokens = usageTokens(message.usage);
		if (tokens !== undefined) turn.tokens = tokens;
	} else if (message.role === "toolResult" && message.isError) turn.errors++;
	else if (message.role === "bashExecution" && message.exitCode) turn.errors++;
}

/** Tokens in the context once a reply was written: what it read and what it wrote. */
function usageTokens(
	usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number } | undefined,
): number | undefined {
	if (!usage) return undefined;
	const total = usage.totalTokens || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	return total > 0 ? total : undefined;
}

/**
 * The first line with text of a reply, as firstLine(fullText(entry)) gives it, read only up
 * to that line: a reply's text blocks are joined with \n, so no line spans two blocks.
 */
function replyLine(message: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
	for (const block of message.content) {
		if (block.type !== "text") continue;
		for (const match of (block.text ?? "").matchAll(/[^\n]+/g)) {
			const line = sanitize(match[0]);
			if (/\S/.test(line)) return sanitize(line.trim());
		}
	}
	return "";
}

/** The look and the labels (`#one #two`) of a row, worked out the first time it is drawn. */
function rowShown(row: Row): NonNullable<Row["shown"]> {
	row.shown ??= { look: rowLook(row), labels: rowLabels(row).map((node) => `#${sanitize(node.label!)}`).join(" ") };
	return row.shown;
}

/** How a row is shown: its first entry, then what the rest of the turn did (`tail`). */
function rowLook(row: Row): Look & { tail: string } {
	if (row.tip) return { tag: "╴END", color: "muted", text: "", tail: "" };
	const head = row.nodes[0]!.entry;
	const look = describe(head);
	if (row.nodes.length === 1) return { ...look, tail: "" };
	const { calls, replyLine } = row.turn;
	const did = calls.length ? `${calls.length} ${calls.length === 1 ? "call" : "calls"} · ${toolNames(calls)}` : replyLine;
	// A row that starts with a reply (after a fork) sums up the whole row instead.
	if (head.type === "message" && head.message.role === "assistant") return { tag: "ASST", color: "text", text: "", tail: did };
	return { ...look, tail: did };
}

/** The labels a row shows: its entries', but those its tip row (tipFrom on) shows. */
function rowLabels(row: Row): SessionTreeNode[] {
	const nodes = row.tipFrom === undefined ? row.nodes : row.nodes.slice(0, row.tipFrom);
	return nodes.filter((node) => node.label !== undefined);
}

/** The nearest shown entries below: shown children, and in place of a hidden one, its own. */
function shownChildren(children: readonly SessionTreeNode[], shows: (node: SessionTreeNode) => boolean): SessionTreeNode[] {
	const shown: SessionTreeNode[] = [];
	const stack = [...children].reverse();
	while (stack.length) {
		const node = stack.pop()!;
		if (shows(node)) shown.push(node);
		else for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]!);
	}
	return shown;
}

/** Which entries a filter shows. */
function filterTest(filter: TreeFilterMode): (node: SessionTreeNode) => boolean {
	const role = (entry: Entry) => (entry.type === "message" ? entry.message.role : undefined);
	const talk = (entry: Entry) => !BOOKKEEPING.has(entry.type) && role(entry) !== "system";
	switch (filter) {
		case "all":
			return () => true;
		case "labeled-only":
			return (node) => node.label !== undefined;
		default:
			return (node) => talk(node.entry);
	}
}

/** The filter a /tree filter key leads to: a direct key toggles with the default, as in /tree. */
function nextFilter(current: TreeFilterMode, key: TreeFilterMode | "next" | "previous"): TreeFilterMode {
	if (key === "next" || key === "previous") {
		const at = FILTERS.findIndex(([mode]) => mode === current);
		const step = key === "next" ? 1 : FILTERS.length - 1;
		return FILTERS[(at + step) % FILTERS.length]![0];
	}
	if (key === "default") return "default";
	return current === key ? "default" : key;
}

/* ------------------------------------------------------------ entries as text */

function describe(entry: Entry): Look {
	switch (entry.type) {
		case "message":
			return describeMessage(entry.message);
		case "compaction":
			return { tag: "COMP", color: "warning", text: `compacted ${compactNumber(entry.tokensBefore)} tokens: ${firstLine(entry.summary)}` };
		case "branch_summary":
			return { tag: "SUMM", color: "warning", text: firstLine(entry.summary) };
		case "custom_message":
			return { tag: "NOTE", color: "muted", text: `${sanitize(entry.customType)}: ${firstLine(contentText(entry.content))}` };
		case "model_change":
			return { tag: "MODL", color: "muted", text: sanitize(`${entry.provider}/${entry.modelId}`) };
		case "thinking_level_change":
			return { tag: "THNK", color: "muted", text: sanitize(entry.thinkingLevel) };
		case "label":
			return { tag: "LABL", color: "muted", text: entry.label === undefined ? "label cleared" : `#${sanitize(entry.label)}` };
		case "session_info":
			return { tag: "NAME", color: "muted", text: sanitize(entry.name ?? "") };
		case "context_edit":
			return { tag: "EDIT", color: "muted", text: "context edited" };
		case "custom":
			return { tag: "DATA", color: "muted", text: sanitize(entry.customType) };
		case "usage":
			return { tag: "USAG", color: "muted", text: sanitize(entry.kind) };
		default:
			return { tag: "????", color: "muted", text: sanitize((entry as { type: string }).type) };
	}
}

function describeMessage(message: Extract<Entry, { type: "message" }>["message"]): Look {
	switch (message.role) {
		case "user":
			return { tag: "USER", color: "accent", text: firstLine(contentText(message.content)) };
		case "assistant": {
			if (message.stopReason === "error") return { tag: "ASST", color: "error", text: firstLine(message.errorMessage ?? "error") };
			const text = firstLine(message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"));
			const tools = toolNames(message.content.flatMap((block) => (block.type === "toolCall" ? [block.name] : [])));
			if (text && tools) return { tag: "ASST", color: "text", text: `${text} · ${tools}` };
			if (tools) return { tag: "ASST", color: "text", text: `→ ${tools}` };
			return { tag: "ASST", color: "text", text: text || "(thinking)" };
		}
		case "toolResult":
			return message.isError
				? { tag: "TOOL", color: "error", text: `${sanitize(message.toolName)} failed` }
				: { tag: "TOOL", color: "muted", text: sanitize(message.toolName) };
		case "bashExecution":
			return { tag: "BASH", color: message.exitCode ? "error" : "muted", text: `$ ${firstLine(message.command)}` };
		case "custom":
			return { tag: "NOTE", color: "muted", text: `${sanitize(message.customType)}: ${firstLine(contentText(message.content))}` };
		case "branchSummary":
			return { tag: "SUMM", color: "warning", text: firstLine(message.summary) };
		case "compactionSummary":
			return { tag: "COMP", color: "warning", text: firstLine(message.summary) };
		case "system":
			return { tag: "SYS ", color: "muted", text: "system prompt" };
		default:
			return { tag: "????", color: "muted", text: sanitize((message as { role: string }).role) };
	}
}

/** `read x3, edit`: the tools called, in order, repeats counted. */
function toolNames(names: string[]): string {
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	return [...counts].map(([name, count]) => sanitize(count > 1 ? `${name} x${count}` : name)).join(", ");
}

/** The text of a message content; images count as `[image]`. */
function contentText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content.map((block) => (block.type === "text" ? (block.text ?? "") : block.type === "image" ? "[image]" : "")).join("\n");
}

/** The first line that has text, without control characters. */
function firstLine(text: string): string {
	// Reads up to the first line that is not blank, however long the text. Lines end at
	// \n only, as in split("\n"); a \r in a line stays in it until sanitize.
	const line = text.match(/^[^\n]*\S[^\n]*/m)?.[0] ?? "";
	return sanitize(line.trim());
}

/** `11-01 16:32` in local time. */
function localTime(timestamp: string): string {
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime())) return "";
	const two = (value: number) => String(value).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** How long ago, in the largest unit that fits. */
function ago(timestamp: string): string {
	const time = Date.parse(timestamp);
	if (!Number.isFinite(time)) return "";
	const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

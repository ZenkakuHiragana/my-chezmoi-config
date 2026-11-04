/**
 * INV's panels: the system prompt by part, the tools (those of one namespace, such
 * as one MCP server's, under its heading) and the skills, each as a list beside the
 * text of the picked item. Enter or a click picks an item; on a namespace's heading,
 * it also lists the namespace's tools under it, or stops listing them.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	folds,
	pickPart,
	pickSkill,
	pickTool,
	pickToolGroup,
	picks,
	prompt,
	skills,
	type ToolGroup,
	type ToolItem,
	toggleToolGroup,
	tools,
	toolListed,
	toolsVersion,
	version,
} from "../features/inv.ts";
import { framed } from "../screen/frame.ts";
import { Lines, type ThemeRef } from "../screen/lines.ts";
import { compactNumber, ListLines, Selection, withCursor } from "./common.ts";
import { type PanelEnv, type PanelHandle, registerPanel } from "./registry.ts";

type Theme = ReturnType<ThemeRef>;

/** A list panel with a one-column cursor gutter; `produce` gets the width left of the gutter. */
function listPanel(
	env: PanelEnv,
	id: string,
	title: () => string,
	selection: Selection,
	produce: (width: number) => string[],
	key: () => unknown[],
): PanelHandle {
	const panel = framed(
		env.theme,
		title,
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, id, produce(Math.max(1, width - 1)));
			},
			() => [...key(), selection.selectedKey, env.focused(id)],
		),
		"top",
		() => env.focused(id),
	);
	selection.view = panel.scroll;
	return { ...panel, list: selection };
}

/** A panel of wrapped text. */
function textPanel(env: PanelEnv, id: string, title: () => string, produce: (width: number) => string[], key: () => unknown[]): PanelHandle {
	return framed(env.theme, title, new Lines(produce, key), "top", () => env.focused(id));
}

/** `left` cut to leave room for `right` at the right edge. */
function row(left: string, right: string, width: number): string {
	const room = Math.max(1, width - visibleWidth(right) - 1);
	const shown = truncateToWidth(left, room);
	return shown + " ".repeat(Math.max(1, width - visibleWidth(shown) - visibleWidth(right))) + right;
}

function wrap(text: string, width: number, color: (line: string) => string): string[] {
	return wrapTextWithAnsi(text, Math.max(1, width - 1)).map((line) => ` ${color(line)}`);
}

function tokens(t: Theme, n: number, color: "muted" | "dim" = "muted"): string {
	return t.fg(color, `≈${compactNumber(n)}`);
}

function picked(t: Theme, on: boolean): string {
	return on ? t.fg("accent", "◆") : " ";
}

function firstLine(text: string): string {
	return text.split("\n", 1)[0]?.trim() ?? "";
}

/* ---------------------------------------------------------------- PROMPT */

registerPanel("promptparts", (env) => {
	const selection = new Selection(
		// The whole prompt, then the parts by label.
		() => [undefined, ...(prompt(env.state)?.parts ?? []).map((part) => part.label)],
		(index) => pickPart(env.state, index === 0 ? undefined : prompt(env.state)?.parts[index - 1]?.label),
		() => picks(env.state).part,
	);
	return listPanel(
		env,
		"promptparts",
		() => {
			const p = prompt(env.state);
			return p ? `PROMPT  ≈${compactNumber(p.tokens)} tok/req` : "PROMPT";
		},
		selection,
		(width) => {
			const t = env.theme();
			const p = prompt(env.state);
			if (!p) return [t.fg("dim", " -- no prompt yet --")];
			const { part } = picks(env.state);
			const lines: string[] = [];
			selection.place(0, lines.length, 1);
			lines.push(row(`${picked(t, part === undefined)}${t.fg("text", t.bold("WHOLE PROMPT"))}`, tokens(t, p.tokens), width));
			p.parts.forEach((item, index) => {
				selection.place(index + 1, lines.length, 1);
				lines.push(row(`${picked(t, part === item.label)}${t.fg("text", item.label)}`, tokens(t, item.tokens), width));
			});
			if (!p.parts.length) lines.push(t.fg("dim", " -- parts after the first request --"));
			else lines.push(row(t.fg("dim", " rest: not in the recorded parts"), tokens(t, p.rest, "dim"), width));
			return lines;
		},
		() => [version(env.state)],
	);
});

registerPanel("prompttext", (env) =>
	textPanel(
		env,
		"prompttext",
		() => {
			return `TEXT  ${picks(env.state).part ?? "WHOLE PROMPT"}`;
		},
		(width) => {
			const t = env.theme();
			const p = prompt(env.state);
			if (!p) return [t.fg("dim", " -- no prompt yet --")];
			const { part } = picks(env.state);
			const text = part === undefined ? p.text : (p.parts.find((item) => item.label === part)?.text ?? "");
			return wrap(text.replace(/\t/g, "    "), width, (line) => t.fg("text", line));
		},
		() => [version(env.state)],
	),
);

/* ---------------------------------------------------------------- TOOLS */

/** A namespace's tools, under one heading. */
interface Heading {
	group: ToolGroup;
	tools: ToolItem[];
}

/** The tools outside namespaces, and the namespaces with their tools. */
interface ToolTree {
	loose: ToolItem[];
	headings: Heading[];
}

/** A row of the tool list: a namespace's heading, or a tool (`nested` under its heading). */
type ToolRow = { heading: Heading; tool?: undefined } | { tool: ToolItem; nested: boolean; heading?: undefined };

/** Trees of the tool lists features/inv.ts returns; a new tree when the tools change. */
const trees = new WeakMap<readonly ToolItem[], ToolTree>();

/** Active tools first, each group in Pi's order. */
function activeFirst(list: readonly ToolItem[]): ToolItem[] {
	return [...list.filter((tool) => tool.active), ...list.filter((tool) => !tool.active)];
}

/** The tools outside namespaces, then each namespace (in the order its first tool comes) with its tools. */
function toolTree(env: PanelEnv): ToolTree {
	const all = tools(env.state);
	let tree = trees.get(all);
	if (!tree) {
		const groups = new Map<ToolGroup, ToolItem[]>();
		for (const tool of all) if (tool.namespace) groups.set(tool.namespace, [...(groups.get(tool.namespace) ?? []), tool]);
		tree = {
			loose: activeFirst(all.filter((tool) => !tool.namespace)),
			headings: [...groups].map(([group, members]) => ({ group, tools: activeFirst(members) })),
		};
		trees.set(all, tree);
	}
	return tree;
}

/** Rows of each tree, with the expanded namespaces they were made for. */
const rowLists = new WeakMap<ToolTree, { expanded: ReadonlySet<string>; rows: ToolRow[] }>();

/** The rows of the tool list: the tools it lists (toolListed), a namespace's under its heading. */
function toolRows(env: PanelEnv): ToolRow[] {
	const tree = toolTree(env);
	const shown = folds(env.state);
	const { expanded } = shown;
	const made = rowLists.get(tree);
	if (made?.expanded === expanded) return made.rows;
	const listed = (tool: ToolItem) => toolListed(shown, tool);
	const rows: ToolRow[] = tree.loose.filter(listed).map((tool) => ({ tool, nested: false }));
	for (const heading of tree.headings) {
		rows.push({ heading });
		rows.push(...heading.tools.filter(listed).map((tool) => ({ tool, nested: true })));
	}
	rowLists.set(tree, { expanded, rows });
	return rows;
}

/** How many tools have each exposure, as `codemode 12 · hidden 2`. */
function exposureCounts(list: readonly ToolItem[]): string {
	const counts = new Map<string, number>();
	for (const tool of list) counts.set(tool.exposure, (counts.get(tool.exposure) ?? 0) + 1);
	return [...counts].map(([exposure, n]) => `${exposure} ${n}`).join(" · ");
}

function activeTokens(list: readonly ToolItem[]): number {
	return list.reduce((total, tool) => total + (tool.active ? tool.tokens : 0), 0);
}

/**
 * The tool list's selection. A tool's row is known by the tool's name, and a
 * heading by its ToolGroup, which stays the same object while the tools do. Enter,
 * or a click, on a heading also expands or collapses it.
 */
class ToolSelection extends Selection {
	constructor(private readonly env: PanelEnv) {
		super(
			() => toolRows(env).map((item) => item.heading?.group ?? item.tool?.name),
			(index) => {
				const item = toolRows(env)[index];
				if (item?.heading) pickToolGroup(env.state, item.heading.group.name);
				else pickTool(env.state, item?.tool.name);
			},
			() => {
				const { tool, toolGroup } = picks(env.state);
				return toolGroup === undefined ? tool : toolTree(env).headings.find((item) => item.group.name === toolGroup)?.group;
			},
		);
	}

	override activate(): void {
		const item = toolRows(this.env)[this.index];
		super.activate();
		if (item?.heading) toggleToolGroup(this.env.state, item.heading.group.name);
	}
}

registerPanel("toollist", (env) => {
	const selection = new ToolSelection(env);
	return listPanel(
		env,
		"toollist",
		() => {
			const all = tools(env.state);
			const active = all.filter((tool) => tool.active).length;
			return `TOOLS  ${active}/${all.length} active  ≈${compactNumber(activeTokens(all))} tok/req`;
		},
		selection,
		(width) => {
			const t = env.theme();
			const rows = toolRows(env);
			if (!rows.length) return [t.fg("dim", " -- no tools --")];
			const { tool, toolGroup } = picks(env.state);
			const { expanded } = folds(env.state);
			return rows.map((item, index) => {
				selection.place(index, index, 1);
				if (item.heading) {
					const { group, tools: members } = item.heading;
					const exposures = new Set(members.map((member) => member.exposure));
					const summary = exposures.size === 1 ? `${members[0]!.exposure} · ${members.length} tools` : exposureCounts(members);
					const mark = t.fg("muted", expanded.has(group.name) ? "▾" : "▸");
					const left = `${picked(t, toolGroup === group.name)}${mark} ${t.fg("text", t.bold(group.label))}  ${t.fg("dim", summary)}`;
					const sum = activeTokens(members);
					return row(left, sum ? tokens(t, sum) : t.fg("dim", "—"), width);
				}
				const member = item.tool;
				const indent = item.nested ? "  " : "";
				const dot = member.active ? t.fg("success", "●") : t.fg("dim", "○");
				const name = member.active ? t.fg("toolTitle", member.name) : t.fg("dim", member.name);
				const left = `${picked(t, tool === member.name)}${indent}${dot} ${name}  ${t.fg("dim", firstLine(member.description))}`;
				return row(left, member.active ? tokens(t, member.tokens) : t.fg("dim", "—"), width);
			});
		},
		() => {
			// tools() reads Pi's tool lists again, and gives a new version when they changed.
			tools(env.state);
			return [toolsVersion(env.state), folds(env.state).version];
		},
	);
});

/** The picked namespace: its name, description, source, exposures and instructions. */
function groupDetail(env: PanelEnv, heading: Heading, width: number): string[] {
	const t = env.theme();
	const { group, tools: members } = heading;
	const sum = activeTokens(members);
	const lines = [
		` ${t.fg("text", t.bold(group.label))}`,
		` ${t.fg("muted", `${group.name}  ·  ${members.length} tools  ·  ${sum ? `≈${compactNumber(sum)} tok per request` : "none active"}`)}`,
		...[...new Set(members.map((member) => member.source).filter(Boolean))].map((source) => ` ${t.fg("dim", source)}`),
		"",
		...(group.description ? [...wrap(group.description, width, (line) => t.fg("text", line)), ""] : []),
		` ${t.fg("muted", "EXPOSURE")}`,
		` ${t.fg("text", exposureCounts(members))}`,
		"",
		` ${t.fg("muted", "INSTRUCTIONS")}`,
	];
	// Not push(...): the instructions can wrap to more lines than a call takes arguments.
	if (group.instructions) return lines.concat(wrap(group.instructions.replace(/\t/g, "    "), width, (line) => t.fg("text", line)));
	lines.push(t.fg("dim", " -- none --"));
	return lines;
}

registerPanel("tooldetail", (env) =>
	textPanel(
		env,
		"tooldetail",
		() => {
			const { tool, toolGroup } = picks(env.state);
			if (toolGroup === undefined) return `TOOL  ${tool ?? ""}`;
			const group = toolTree(env).headings.find((item) => item.group.name === toolGroup)?.group;
			return `NAMESPACE  ${group?.label ?? toolGroup}`;
		},
		(width) => {
			const t = env.theme();
			const { tool: name, toolGroup } = picks(env.state);
			if (toolGroup !== undefined) {
				const heading = toolTree(env).headings.find((item) => item.group.name === toolGroup);
				if (heading) return groupDetail(env, heading, width);
			}
			const item = tools(env.state).find((tool) => tool.name === name);
			if (!item) return [t.fg("dim", " -- pick a tool: Enter or a click --")];
			const state = item.active ? t.fg("success", "active") : t.fg("dim", "not active");
			const cost = item.active ? `≈${compactNumber(item.tokens)} tok per request` : `≈${compactNumber(item.tokens)} tok when active`;
			const lines = [
				` ${t.fg("toolTitle", t.bold(item.name))}`,
				` ${state}${t.fg("muted", `  ·  ${item.exposure}  ·  ${cost}`)}`,
				...(item.source ? [` ${t.fg("dim", item.source)}`] : []),
				"",
				...wrap(item.description, width, (line) => t.fg("text", line)),
				"",
				` ${t.fg("muted", "PARAMETERS")}`,
				...wrap(JSON.stringify(item.parameters ?? {}, null, 2) ?? "", width, (line) => t.fg("muted", line)),
			];
			if (item.guidelines.length) {
				lines.push("", ` ${t.fg("muted", "GUIDELINES")}`);
				for (const line of item.guidelines) lines.push(...wrap(`- ${line}`, width, (text) => t.fg("text", text)));
			}
			return lines;
		},
		() => {
			// tools() reads Pi's tool lists again, and gives a new version when they changed.
			tools(env.state);
			return [toolsVersion(env.state)];
		},
	),
);

/* ---------------------------------------------------------------- SKILLS */

registerPanel("skilllist", (env) => {
	const selection = new Selection(
		() => skills(env.state).items.map((skill) => skill.name),
		(index) => pickSkill(env.state, skills(env.state).items[index]?.name),
		() => picks(env.state).skill,
	);
	return listPanel(
		env,
		"skilllist",
		() => {
			const { known, items } = skills(env.state);
			if (!known) return "SKILLS";
			// Which skills are listed is known only once a request has said it.
			if (items.some((item) => item.listed === undefined)) return `SKILLS  ${items.length}  ≈? tok/req`;
			const sum = items.reduce((total, item) => total + item.tokens, 0);
			return `SKILLS  ${items.length}  ≈${compactNumber(sum)} tok/req`;
		},
		selection,
		(width) => {
			const t = env.theme();
			const { known, items } = skills(env.state);
			if (!known) return [t.fg("dim", " -- skills appear after the first request --")];
			if (!items.length) return [t.fg("dim", " -- no skills --")];
			const { skill } = picks(env.state);
			// Two right-aligned columns under a header: tokens in every request, and when loaded.
			const cells = items.map((item) => ({
				req: item.listed === undefined ? "?" : item.listed ? `≈${compactNumber(item.tokens)}` : "user",
				load: item.bodyTokens !== undefined ? `≈${compactNumber(item.bodyTokens)}` : item.bodyError ? "?" : "…",
			}));
			const reqWidth = Math.max(3, ...cells.map((cell) => cell.req.length));
			const loadWidth = Math.max(4, ...cells.map((cell) => cell.load.length));
			const lines = [row("", t.fg("dim", `${"REQ".padStart(reqWidth)}  ${"LOAD".padStart(loadWidth)}`), width)];
			items.forEach((item, index) => {
				selection.place(index, lines.length, 1);
				const name = item.listed !== false ? t.fg("toolTitle", item.name) : t.fg("dim", item.name);
				const { req, load } = cells[index]!;
				const right = `${t.fg(item.listed ? "muted" : "dim", req.padStart(reqWidth))}  ${t.fg(item.bodyTokens !== undefined ? "muted" : "dim", load.padStart(loadWidth))}`;
				lines.push(row(`${picked(t, skill === item.name)}${name}`, right, width));
			});
			return lines;
		},
		() => [version(env.state)],
	);
});

registerPanel("skilltext", (env) =>
	textPanel(
		env,
		"skilltext",
		() => `SKILL  ${picks(env.state).skill ?? ""}`,
		(width) => {
			const t = env.theme();
			const name = picks(env.state).skill;
			const item = skills(env.state).items.find((skill) => skill.name === name);
			if (!item) return [t.fg("dim", " -- pick a skill: Enter or a click --")];
			const lines = [` ${t.fg("dim", item.filePath)}`, ...wrap(item.description, width, (line) => t.fg("muted", line)), ""];
			if (item.bodyError) lines.push(` ${t.fg("error", item.bodyError)}`);
			else if (item.body === undefined) lines.push(t.fg("dim", " -- reading --"));
			else {
				lines.push(...wrap(item.body, width, (line) => t.fg("text", line)));
				if (item.bodyCut) lines.push(t.fg("warning", " -- the file is longer; the rest is not shown --"));
			}
			return lines;
		},
		() => [version(env.state)],
	),
);

/**
 * INV's panels: the system prompt by part, the tools and the skills, each as a
 * list beside the text of the picked item. Enter or a click picks an item.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { pickPart, pickSkill, pickTool, picks, prompt, skills, type ToolItem, tools, version } from "../features/inv.ts";
import { framed } from "../screen/frame.ts";
import { Lines, type ThemeRef } from "../screen/lines.ts";
import { compactNumber, ListLines, Selection, themeStamp, withCursor } from "./common.ts";
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
			() => [...key(), selection.index, env.focused(id), themeStamp(env.theme())],
		),
		"top",
		() => env.focused(id),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
}

/** A panel of wrapped text. */
function textPanel(env: PanelEnv, id: string, title: () => string, produce: (width: number) => string[], key: () => unknown[]): PanelHandle {
	return framed(env.theme, title, new Lines(produce, () => [...key(), themeStamp(env.theme())]), "top", () => env.focused(id));
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
		() => 1 + (prompt(env.state)?.parts.length ?? 0),
		(index) => pickPart(env.state, index - 1),
		true,
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
			lines.push(row(`${picked(t, part === -1)}${t.fg("text", t.bold("WHOLE PROMPT"))}`, tokens(t, p.tokens), width));
			p.parts.forEach((item, index) => {
				selection.place(index + 1, lines.length, 1);
				lines.push(row(`${picked(t, part === index)}${t.fg("text", item.label)}`, tokens(t, item.tokens), width));
			});
			if (!p.parts.length) lines.push(t.fg("dim", " -- parts after the first request --"));
			else lines.push(row(t.fg("dim", " rest: not in the recorded parts"), tokens(t, p.rest, "dim"), width));
			return lines;
		},
		() => [prompt(env.state), picks(env.state).version],
	);
});

registerPanel("prompttext", (env) =>
	textPanel(
		env,
		"prompttext",
		() => {
			const p = prompt(env.state);
			const { part } = picks(env.state);
			return `TEXT  ${part >= 0 ? (p?.parts[part]?.label ?? "") : "WHOLE PROMPT"}`;
		},
		(width) => {
			const t = env.theme();
			const p = prompt(env.state);
			if (!p) return [t.fg("dim", " -- no prompt yet --")];
			const { part } = picks(env.state);
			const text = part >= 0 ? (p.parts[part]?.text ?? "") : p.text;
			return wrap(text.replace(/\t/g, "    "), width, (line) => t.fg("text", line));
		},
		() => [prompt(env.state), picks(env.state).version],
	),
);

/* ---------------------------------------------------------------- TOOLS */

/** Sorted copies of the tool lists features/inv.ts returns; a new list when the tools change. */
const sortedLists = new WeakMap<readonly ToolItem[], ToolItem[]>();

/** Active tools first, each group in Pi's order. */
function sortedTools(env: PanelEnv): ToolItem[] {
	const all = tools(env.state);
	let sorted = sortedLists.get(all);
	if (!sorted) {
		sorted = [...all.filter((tool) => tool.active), ...all.filter((tool) => !tool.active)];
		sortedLists.set(all, sorted);
	}
	return sorted;
}

registerPanel("toollist", (env) => {
	const selection = new Selection(
		() => sortedTools(env).length,
		(index) => pickTool(env.state, sortedTools(env)[index]?.name),
		true,
	);
	return listPanel(
		env,
		"toollist",
		() => {
			const all = sortedTools(env);
			const active = all.filter((tool) => tool.active);
			const sum = active.reduce((total, tool) => total + tool.tokens, 0);
			return `TOOLS  ${active.length}/${all.length} active  ≈${compactNumber(sum)} tok/req`;
		},
		selection,
		(width) => {
			const t = env.theme();
			const all = sortedTools(env);
			if (!all.length) return [t.fg("dim", " -- no tools --")];
			const { tool } = picks(env.state);
			return all.map((item, index) => {
				selection.place(index, index, 1);
				const dot = item.active ? t.fg("success", "●") : t.fg("dim", "○");
				const name = item.active ? t.fg("toolTitle", item.name) : t.fg("dim", item.name);
				const left = `${picked(t, tool === item.name)}${dot} ${name}  ${t.fg("dim", firstLine(item.description))}`;
				return row(left, item.active ? tokens(t, item.tokens) : t.fg("dim", "—"), width);
			});
		},
		() => [sortedTools(env), picks(env.state).version],
	);
});

registerPanel("tooldetail", (env) =>
	textPanel(
		env,
		"tooldetail",
		() => `TOOL  ${picks(env.state).tool ?? ""}`,
		(width) => {
			const t = env.theme();
			const name = picks(env.state).tool;
			const item = sortedTools(env).find((tool) => tool.name === name);
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
		() => [sortedTools(env), picks(env.state).version],
	),
);

/* ---------------------------------------------------------------- SKILLS */

registerPanel("skilllist", (env) => {
	const selection = new Selection(
		() => skills(env.state).items.length,
		(index) => pickSkill(env.state, skills(env.state).items[index]?.name),
		true,
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
		() => [skills(env.state).items, version(env.state), picks(env.state).version],
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
		() => [skills(env.state).items, version(env.state), picks(env.state).version],
	),
);

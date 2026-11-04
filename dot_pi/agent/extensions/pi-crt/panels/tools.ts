/**
 * TERM's panels: THINKING, the one-line TOOL LOG, and the execution log.
 */
import { type Component, type TuiMouseEvent, type TuiMouseEventResult, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { framed } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { toolData } from "../features/tools.ts";
import { type LogItem, THINKING_TAIL, type ToolEntry, toggleLog } from "../state/tools.ts";
import { Selection, spinner, withCursor } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("thinking", (env) =>
	framed(
		env.theme,
		() => {
			// The panel follows the end, so a note above the text would scroll away; the title says it.
			const data = toolData(env.state);
			const trimmed = data.thinkingTrimmed || data.thinking.length > THINKING_TAIL;
			const title = trimmed ? `THINKING  …last ${THINKING_TAIL} chars` : "THINKING";
			return env.state.agentRunning ? `${title} ${spinner(env.every(120))}` : title;
		},
		new Lines(
			(width) => {
				const t = env.theme();
				const text = toolData(env.state).thinking.slice(-THINKING_TAIL);
				if (!text) return [t.fg("dim", " -- no thinking yet --")];
				return wrapTextWithAnsi(text, Math.max(1, width - 2)).map((line) => ` ${t.fg("thinkingText", line)}`);
			},
			() => [toolData(env.state).toolsVersion],
		),
		"end",
		() => env.focused("thinking"),
	));

registerPanel("tools", (env) =>
	framed(
		env.theme,
		() => {
			const data = toolData(env.state);
			return `TOOL LOG${data.toolsTrimmed ? `  last ${data.tools.length}` : ""}  ✓ ${data.ok} ✗ ${data.failed}`;
		},
		new Lines(
			() => {
				const t = env.theme();
				const tools = toolData(env.state).tools;
				if (!tools.length) return [t.fg("dim", " -- no tool calls yet --")];
				return tools.map((tool) => toolLine(env, tool));
			},
			// Spinners of running tools move only while the agent runs.
			() => [toolData(env.state).toolsVersion, env.state.agentRunning ? env.every(120) : -1],
		),
		"end",
		() => env.focused("tools"),
	));

registerPanel("toollog", (env) => {
	const selection = new Selection(
		// A call keeps its id when the log is built again (a move in the tree).
		() => toolData(env.state).log.map((item) => item.id),
		(index) => {
			const item = toolData(env.state).log[index];
			if (item) toggleLog(item);
		},
	);
	const view = new ToolLogView(env, selection);
	const panel = framed(
		env.theme,
		() => {
			// Counted over the calls in this log (top-level calls only), unlike TOOL LOG.
			let ok = 0;
			let failed = 0;
			for (const item of toolData(env.state).log) {
				if (!item.result || item.partial) continue;
				if (item.result.isError) failed++;
				else ok++;
			}
			const data = toolData(env.state);
			return `EXEC LOG${data.logTrimmed ? `  last ${data.log.length}` : ""}  ✓ ${ok} ✗ ${failed}`;
		},
		view,
		"end",
		() => env.focused("toollog"),
	);
	selection.view = panel.scroll;
	return { ...panel, list: selection };
});

/**
 * The execution log: each top-level tool call drawn by Pi's own
 * ToolExecutionComponent with the renderers the transcript would have used, so
 * the log looks like Pi's transcript. The calls hold clipped arguments and
 * results (state/tools.ts) and draw no images; while the tabs are shown,
 * shell/controller.ts turns them off in the transcript too, unless it cannot find
 * the transcript's tool blocks. Enter, or a click, expands a call.
 */
class ToolLogView implements Component {
	/** Keyed by the log item, so a component goes away with its item. */
	private readonly components = new WeakMap<LogItem, { component: ToolExecutionComponent; version: number; expanded: boolean }>();

	constructor(
		private readonly env: PanelEnv,
		private readonly selection: Selection,
	) {}

	render(width: number): string[] {
		const { env, selection } = this;
		const t = env.theme();
		const items = toolData(env.state).log;
		selection.reset();
		if (!items.length) return withCursor(env, selection, "toollog", [t.fg("dim", " -- no tool calls yet --")]);
		const lines: string[] = [];
		const inner = Math.max(1, width - 1);
		items.forEach((item, index) => {
			const component = this.componentFor(item);
			const rendered = component ? component.render(inner) : [];
			// Pi's component may return its cached lines; add the note to a copy.
			const body = item.cut ? [...rendered, t.fg("dim", " … part of the arguments or details is not kept in this log")] : rendered;
			selection.place(index, lines.length, body.length);
			for (const line of body) lines.push(line);
		});
		return withCursor(env, selection, "toollog", lines);
	}

	/** A click on a call expands or collapses it, as Enter does. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "press" || event.button !== "left") return undefined;
		const { selection, env } = this;
		const index = selection.itemAtLine(event.y);
		const item = index < 0 ? undefined : toolData(env.state).log[index];
		if (!item) return undefined;
		selection.pick(index);
		toggleLog(item);
		return { handled: true };
	}

	invalidate(): void {
		for (const item of toolData(this.env.state).log) this.components.get(item)?.component.invalidate();
	}

	private componentFor(item: LogItem): ToolExecutionComponent | undefined {
		let entry = this.components.get(item);
		if (!entry) {
			const tui = this.env.tui();
			if (!tui) return undefined;
			const renderers = this.env.renderersFor(item.name);
			const component = new ToolExecutionComponent(item.name, item.id, item.args, { showImages: false }, renderers, tui, this.env.cwd());
			// As Pi does: a running call is marked started with its arguments complete
			// (renderers may then preview, e.g. edit reads the file for its diff); a
			// finished call only gets its result, as when Pi rebuilds the transcript.
			if (!item.result || item.partial) {
				component.markExecutionStarted();
				component.setArgsComplete();
			}
			entry = { component, version: -1, expanded: false };
			this.components.set(item, entry);
		}
		if (entry.version !== item.version) {
			if (item.result) entry.component.updateResult(item.result, item.partial);
			if (entry.expanded !== item.expanded) entry.component.setExpanded(item.expanded);
			entry.expanded = item.expanded;
			entry.version = item.version;
		}
		return entry.component;
	}
}

function toolLine(env: PanelEnv, tool: ToolEntry): string {
	const t = env.theme();
	const mark =
		tool.status === "running"
			? t.fg("warning", spinner(env.every(120)))
			: tool.status === "ok"
				? t.fg("success", "✓")
				: t.fg("error", "✗");
	const indent = tool.nested ? "  ↳" : "";
	const time = tool.durationMs === undefined ? "" : t.fg("dim", ` ${(tool.durationMs / 1000).toFixed(1)}s`);
	return ` ${indent}${mark} ${t.fg("toolTitle", tool.name)} ${t.fg("muted", tool.summary)}${time}`;
}

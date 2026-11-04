/**
 * DATA › MODELS: the models as a list beside the picked one. The arrow keys or j/k
 * pick a model, Enter or a click switches the session to it, and `s` shows the
 * scoped models instead of all, or all instead of the scoped ones.
 */
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type ModelItem, modelFilter, models, pickModel, shownModels, switchModel, toggleModelFilter } from "../features/models.ts";
import { framed } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { compactNumber, ListLines, Selection, withCursor } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

/** Enter or a click picks the model and switches to it; `s` switches the list. */
class ModelSelection extends Selection {
	constructor(private readonly env: PanelEnv) {
		super(
			() => shownModels(models(env.state)).map((item) => item.key),
			(index) => pickModel(env.state, shownModels(models(env.state))[index]?.key),
			() => models(env.state).picked,
		);
	}

	override activate(): void {
		const item = shownModels(models(this.env.state))[this.index];
		super.activate();
		if (item) switchModel(this.env.state, item);
	}

	key(data: string): boolean {
		if (!matchesKey(data, "s")) return false;
		toggleModelFilter(this.env.state);
		return true;
	}
}

registerPanel("modellist", (env) => {
	const selection = new ModelSelection(env);
	const panel = framed(
		env.theme,
		() => {
			const data = models(env.state);
			const scoped = modelFilter(data) === "scoped";
			return `MODELS  ${scoped ? "SCOPED" : "ALL"} ${shownModels(data).length}  ·  s: ${scoped ? "all" : "scoped"}`;
		},
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "modellist", modelLines(env, selection, Math.max(1, width - 1)));
			},
			() => [models(env.state).version, selection.selectedKey, env.focused("modellist")],
		),
		"top",
		() => env.focused("modellist"),
	);
	selection.view = panel.scroll;
	return { ...panel, list: selection };
});

/** One line per model: the pick, whether it is in use, `provider/id`, and its context window. */
function modelLines(env: PanelEnv, selection: Selection, width: number): string[] {
	const t = env.theme();
	const data = models(env.state);
	const shown = shownModels(data);
	if (!shown.length) {
		return [t.fg("dim", modelFilter(data) === "scoped" ? " -- no scoped models (/scoped-models sets them) --" : " -- no models with authentication --")];
	}
	return shown.map((item, index) => {
		selection.place(index, index, 1);
		const pick = data.picked === item.key ? t.fg("accent", "◆") : " ";
		const inUse = item.key === data.current;
		const dot = inUse ? t.fg("success", "●") : t.fg("dim", "○");
		const name = `${t.fg("dim", `${item.provider}/`)}${inUse ? t.fg("accent", t.bold(item.id)) : t.fg("text", item.id)}`;
		const right = t.fg("muted", compactNumber(item.contextWindow));
		const room = Math.max(1, width - visibleWidth(right) - 1);
		const left = truncateToWidth(`${pick}${dot} ${name}`, room);
		return left + " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right))) + right;
	});
}

registerPanel("modeldetail", (env) =>
	framed(
		env.theme,
		() => `MODEL  ${detailItem(env)?.key ?? ""}`,
		new Lines(
			(width) => modelDetail(env, width),
			() => [models(env.state).version],
		),
		"top",
		() => env.focused("modeldetail"),
	),
);

/** The picked model, else the one in use. */
function detailItem(env: PanelEnv): ModelItem | undefined {
	const data = models(env.state);
	const key = data.picked ?? data.current;
	return data.available.find((item) => item.key === key) ?? data.scoped.find((item) => item.key === key);
}

function money(value: number): string {
	return `$${Number(value.toFixed(4))}`;
}

function modelDetail(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const data = models(env.state);
	const item = detailItem(env);
	if (!item) return [t.fg("dim", " -- pick a model: the arrow keys or a click --")];
	const inUse = item.key === data.current;
	const field = (label: string, value: string) => ` ${t.fg("muted", label.padEnd(9))}${t.fg("text", value)}`;
	const lines = [
		` ${t.fg("accent", t.bold(item.name))}`,
		` ${t.fg("muted", item.key)}${inUse ? t.fg("success", "  ·  in use") : t.fg("dim", "  ·  Enter to switch")}`,
	];
	if (data.failure?.key === item.key) {
		lines.push(...wrapTextWithAnsi(data.failure.text, Math.max(1, width - 1)).map((line) => ` ${t.fg("error", line)}`));
	}
	const { cost } = item;
	lines.push(
		"",
		field("CONTEXT", `${compactNumber(item.contextWindow)} tokens`),
		field("OUTPUT", `${compactNumber(item.maxTokens)} tokens`),
		field("INPUT", item.images ? "text, image" : "text"),
		field("COST", `${money(cost.input)} in · ${money(cost.output)} out · per 1M tokens`),
		field("CACHE", `${money(cost.cacheRead)} read · ${money(cost.cacheWrite)} write · per 1M tokens`),
		"",
		` ${t.fg("muted", "THINKING")}`,
		// The level in use applies to the model in use only.
		` ${item.thinkingLevels.map((level) => (inUse && level === data.thinkingLevel ? t.fg("accent", t.bold(`[${level}]`)) : t.fg("text", level))).join("  ")}`,
	);
	return lines.map((line) => truncateToWidth(line, width));
}

/**
 * STAT's panels: VITALS, CONTEXT and USAGE.
 */
import { colorToRgb, foregroundAnsi, backgroundAnsi, visibleWidth } from "@earendil-works/pi-tui";
import { contextData, contextUsage } from "../features/context.ts";
import { gitData } from "../features/git.ts";
import { toolData } from "../features/tools.ts";
import { usageData } from "../features/usage.ts";
import { vitals } from "../features/vitals.ts";
import { allowanceWindows, rateLimits, shortHeader } from "../state/usage.ts";
import { framed } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { bar, compactNumber, elapsedText } from "./common.ts";
import { type Paint, PI_LOGO, type Rgb, pixelArtWidth, renderPixelArt, shadePalette } from "./pixel-art.ts";
import { type CardInput, centerLine, gaugeRow, statCards } from "./status-parts.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("vitals", (env) =>
	framed(
		env.theme,
		() => "STATUS",
		new Lines(
			(width) => vitalsLines(env, width),
			() => [
				contextData(env.state).version,
				env.state.version,
				toolData(env.state).toolsVersion,
				gitData(env.state).version,
				usageData(env.state).version,
				vitals(env.state).version,
				// The elapsed time only moves while the agent runs.
				env.state.agentRunning ? env.tick() : 0,
			],
		),
		"top",
		() => env.focused("vitals"),
	));

registerPanel("context", (env) =>
	framed(
		env.theme,
		() => "CONTEXT",
		new Lines(
			(width) => contextLines(env, width),
			() => [contextData(env.state).version],
		),
		"top",
		() => env.focused("context"),
	));

registerPanel("usage", (env) =>
	framed(
		env.theme,
		() => {
			const model = usageData(env.state).usageModel;
			return model ? `USAGE  ${model}` : "USAGE";
		},
		new Lines((width) => usageLines(env, width)),
		"top",
		() => env.focused("usage"),
	));

function contextLines(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const usage = contextUsage(env.state);
	const lines: string[] = [];
	const barWidth = Math.max(6, Math.min(40, width - 4));
	if (usage) {
		const tokens = usage.tokens === null ? "?" : compactNumber(usage.tokens);
		const percent = usage.percent === null ? "--" : `${Math.round(usage.percent)}%`;
		lines.push(` ${t.fg("text", `${tokens} / ${compactNumber(usage.contextWindow)}`)}  ${t.fg("accent", t.bold(percent))}`);
		const ratio = (usage.percent ?? 0) / 100;
		lines.push(` ${bar(t, ratio, barWidth, ratio > 0.85 ? "error" : ratio > 0.6 ? "warning" : "accent")}`);
	} else {
		lines.push(t.fg("dim", " -- no model --"));
	}
	const parts = contextData(env.state).contextParts;
	if (!parts.length) {
		lines.push("", t.fg("dim", " -- breakdown after the next request --"));
		return lines;
	}
	const total = parts.reduce((sum, part) => sum + part.tokens, 0) || 1;
	lines.push("", t.fg("muted", " BREAKDOWN (estimated, chars/4)"));
	const partBar = Math.max(4, Math.min(20, width - 30));
	for (const part of parts) {
		const share = part.tokens / total;
		const label = part.label.padEnd(13);
		lines.push(` ${t.fg("text", label)}${bar(t, share, partBar)} ${t.fg("muted", `${compactNumber(part.tokens).padStart(6)} ${String(Math.round(share * 100)).padStart(3)}%`)}`);
	}
	return lines;
}

function usageLines(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const usage = usageData(env.state);
	const { windows, rest } = allowanceWindows(usage.usageHeaders, usage.usageWindows);
	if (!windows.length && !rest.length) {
		if (usage.usageWindows !== undefined) return [t.fg("dim", " -- no usable rate-limit windows in the last update --")];
		if (usage.usageAt) return [t.fg("dim", " -- the last response had no rate-limit headers --")];
		return [t.fg("dim", " -- no response yet --"), t.fg("dim", " -- updates after the next response --")];
	}
	const lines: string[] = [];
	const labelWidth = Math.max(4, ...windows.map((window) => visibleWidth(window.label)));
	const now = Date.now();
	for (const window of windows) {
		const reset = window.resetAt === undefined ? "" : `resets in ${untilText(window.resetAt - now)}`;
		// Name, bar, "100%", then the reset time when it fits.
		const barWidth = Math.max(4, Math.min(24, width - labelWidth - 9 - (reset ? reset.length + 2 : 0)));
		const color = window.ratio > 0.85 ? "error" : window.ratio > 0.6 ? "warning" : "accent";
		const percent = `${Math.round(window.ratio * 100)}%`.padStart(4);
		const resetText = reset ? `  ${t.fg("muted", reset)}` : "";
		lines.push(` ${t.fg("text", window.label.padEnd(labelWidth))} ${bar(t, window.ratio, barWidth, color)} ${t.fg("accent", percent)}${resetText}`);
	}
	// Keep every other header the provider sent, credits and status included.
	if (rest.length) {
		if (lines.length) lines.push("");
		for (const [name, value] of rest) lines.push(` ${t.fg("muted", shortHeader(name).padEnd(24))}${t.fg("text", value)}`);
	}
	const at = usage.usageAt;
	if (at) lines.push("", t.fg("dim", ` updated ${new Date(at).toLocaleTimeString()}`));
	return lines;
}

/** `45m`, `2h 05m` or `3d 04h` from now. */
function untilText(ms: number): string {
	if (ms <= 0) return "now";
	const minutes = Math.ceil(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
	return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}

/** STATUS: the logo, four gauges around it, the stat cards, and the model. */
function vitalsLines(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const inner = Math.max(10, width - 2);
	// Gauges sit at the edges of the panel rather than filling it, leaving the logo room.
	const GAUGE_COLUMN = 30;
	// The four gauges share their name and value columns, so their bars are the same
	// length. The value column fits "100%", so a bar does not move as its value grows.
	const columns = { labelWidth: visibleWidth("CACHE"), valueWidth: visibleWidth("100%") };
	const v = vitals(env.state);
	const usage = contextUsage(env.state);
	const allowance = usageData(env.state);
	const limits = rateLimits(allowance.usageHeaders, allowance.usageWindows);
	const body: string[] = [];

	body.push(gaugeRow(
		{ ...columns, label: "CTX", ratio: (usage?.percent ?? 0) / 100, value: usage?.percent === null || usage === undefined ? "--" : undefined },
		{ ...columns, label: "5H", ratio: limits.fiveHour ?? 0, value: limits.fiveHour === undefined ? "--" : undefined },
		inner,
		{ gap: 4, maxColumn: GAUGE_COLUMN },
	));
	body.push("");
	body.push(...logoLines(env, inner));
	body.push("");
	body.push(centerLine(stateText(env), inner));
	body.push("");
	body.push(gaugeRow(
		{ ...columns, label: "CACHE", ratio: v.cacheRatio ?? 0, value: v.cacheRatio === undefined ? "--" : undefined },
		{ ...columns, label: "WEEK", ratio: limits.weekly ?? 0, value: limits.weekly === undefined ? "--" : undefined },
		inner,
		{ gap: 4, maxColumn: GAUGE_COLUMN },
	));
	body.push("");

	const lines = body.map((line) => ` ${t.fg("text", line)}`);
	// statCards returns four lines per row: frame, name, value, frame.
	const cards = statCards(cardsOf(env), inner);
	cards.forEach((line, index) => {
		const slot = index % 4 === 1 ? "muted" : index % 4 === 2 ? "accent" : "dim";
		lines.push(` ${t.fg(slot, line)}`);
	});
	lines.push(` ${t.fg("muted", centerLine(allowance.usageModel ?? "-- no model --", inner))}`);
	return lines;
}

/** `WORKING 02:14` while the agent runs, `STANDBY` otherwise. */
function stateText(env: PanelEnv): string {
	if (!env.state.agentRunning) return "STANDBY";
	return `WORKING  ${elapsedText(env.state.agentStartedAt)}`;
}

/** The logo in the theme's accent colour, as large as the panel allows. */
function logoLines(env: PanelEnv, width: number): string[] {
	const theme = env.theme();
	const mode = theme.getColorMode();
	const rgb = colorToRgb(theme.colors.accent);
	const palette = shadePalette([rgb.r, rgb.g, rgb.b] as Rgb);
	const paint: Paint = (glyph, colors) => {
		const fg = colors.fg ? palette[colors.fg] : undefined;
		const bg = colors.bg ? palette[colors.bg] : undefined;
		const prefix =
			(fg ? foregroundAnsi({ kind: "rgb", r: fg[0], g: fg[1], b: fg[2] }, mode) : "") +
			(bg ? backgroundAnsi({ kind: "rgb", r: bg[0], g: bg[1], b: bg[2] }, mode) : "");
		const reset = "\x1b[0m";
		return prefix === "" ? glyph : `${prefix}${glyph}${reset}`;
	};
	// Cells are about twice as tall as they are wide, so both scales stay equal.
	let scale = 4;
	while (scale > 1 && pixelArtWidth(PI_LOGO, scale) > width) scale--;
	const art = renderPixelArt(PI_LOGO, { scaleX: scale, scaleY: scale, paint });
	const pad = " ".repeat(Math.max(0, Math.floor((width - pixelArtWidth(PI_LOGO, scale)) / 2)));
	return art.map((line) => pad + line);
}

/** The five cards under the logo. */
function cardsOf(env: PanelEnv): CardInput[] {
	const v = vitals(env.state);
	const tools = toolData(env.state);
	const lines = gitData(env.state).lines;
	const speed = v.outputTokensPerSecond;
	return [
		{ label: "TOOLS", value: compactNumber(tools.ok + tools.failed) },
		{ label: "FAIL", value: compactNumber(tools.failed) },
		{ label: "DIFF", value: lines ? `+${compactNumber(lines.added)}-${compactNumber(lines.removed)}` : "--" },
		{ label: "COST", value: v.cost > 0 ? `$${v.cost.toFixed(2)}` : "--" },
		{ label: "SPEED", value: speed === undefined ? "--" : `${Math.round(speed)} t/s` },
	];
}


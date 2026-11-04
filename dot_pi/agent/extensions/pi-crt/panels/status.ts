/**
 * STAT's panels: VITALS, CONTEXT and USAGE.
 */
import { colorToRgb, foregroundAnsi, backgroundAnsi, visibleWidth } from "@earendil-works/pi-tui";
import { contextData, contextUsage } from "../features/context.ts";
import { gitData } from "../features/git.ts";
import { logoArt, logoData, logoError, logoFrameTime, logoPicture, type LogoScene } from "../features/logo.ts";
import { toolData } from "../features/tools.ts";
import { usageData } from "../features/usage.ts";
import { vitals } from "../features/vitals.ts";
import { allowanceWindows, rateLimits, shortHeader } from "../state/usage.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { bar, compactNumber, elapsedText } from "./common.ts";
import { type Paint, PI_LOGO, PI_LOGO_SHADES, type Rgb, pixelArtWidth, renderPixelArt, shade, shadePalette } from "./pixel-art.ts";
import { type CardInput, centerLine, gaugeRow, statCards } from "./status-parts.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("vitals", (env) => {
	let view: SizedView | undefined;
	const panel = framed(
		env.theme,
		() => "STATUS",
		new Lines(
			(width) => {
				const height = Math.max(1, view?.viewportHeight ?? 1);
				if (view) view.drawnFor = height;
				// Centred up and down; a panel too short for it all scrolls from the top.
				const lines = vitalsLines(env, width);
				return [...Array.from({ length: Math.max(0, Math.floor((height - lines.length) / 2)) }, () => ""), ...lines];
			},
			(width) => [
				contextData(env.state).version,
				env.state.version,
				toolData(env.state).toolsVersion,
				gitData(env.state).version,
				usageData(env.state).version,
				vitals(env.state).version,
				logoData(env.state).version,
				...logoKey(env, Math.max(10, width - 2)),
				stateText(env),
				view?.viewportHeight,
			],
		),
		"sized",
		() => env.focused("vitals"),
	);
	view = panel.scroll as SizedView;
	return panel;
});

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
	const now = env.now();
	for (const window of windows) {
		if (window.resetAt !== undefined && window.resetAt > now) {
			const minutes = Math.ceil((window.resetAt - now) / 60_000);
			env.redrawAt(window.resetAt - (minutes - 1) * 60_000);
		}
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
	// The line is drawn in "text"; after its bar, the colour is set again for the value.
	const columns = {
		labelWidth: visibleWidth("CACHE"),
		valueWidth: visibleWidth("100%"),
		bar: (ratio: number, width: number) => bar(t, ratio, width, "text") + t.getFgAnsi("text"),
	};
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
	const error = logoError(env.state, sceneTime(env).scene);
	if (error) body.push(centerLine(error, inner));
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
	const now = env.now();
	const startedAt = env.state.agentStartedAt;
	if (startedAt !== undefined) env.redrawAt(startedAt + (Math.floor((now - startedAt) / 1000) + 1) * 1000);
	return `WORKING  ${elapsedText(startedAt, now)}`;
}

/** How long the error scene is shown after a tool fails. */
const ERROR_SCENE_MS = 1000;

/** Scene priority follows the live agent and tool state. */
function logoScene(env: PanelEnv): LogoScene {
	if (env.state.agentRunning) {
		const tools = toolData(env.state);
		if (tools.lastErrorAt !== undefined && env.now() - tools.lastErrorAt < ERROR_SCENE_MS) {
			env.redrawAt(tools.lastErrorAt + ERROR_SCENE_MS);
			return "error";
		}
		return tools.active.size ? "tool" : "thinking";
	}
	return env.state.termAttention ? "done" : "standby";
}

/** How long a scene drawn from an image stays at least, so that quick tool calls do not flicker it. */
const MIN_SCENE_MS = 600;

/** The scene each pi-crt instance shows, and when it started (see sceneTime). */
const sceneStarts = new WeakMap<object, { key: string; scene: LogoScene; since: number }>();

/**
 * The scene and the time into it: a scene's animation plays from its first frame
 * when the scene starts. The error scene starts with the error (again with each new
 * one); another scene starts when it is first shown in place of the one before.
 * A scene drawn from an image is shown for MIN_SCENE_MS at least before another
 * replaces it, except the error scene. Pi's logo does not use the scene's frames, so
 * a scene without an image is replaced at once.
 */
function sceneTime(env: PanelEnv): { scene: LogoScene; at: number; since: number } {
	const scene = logoScene(env);
	const now = env.now();
	const errorAt = toolData(env.state).lastErrorAt;
	const key = scene === "error" ? `error ${errorAt}` : scene;
	let start = sceneStarts.get(env.state);
	if (start?.key !== key) {
		if (start && scene !== "error" && now - start.since < MIN_SCENE_MS && logoFrameTime(env.state, start.scene, 0).key !== undefined) {
			env.redrawAt(start.since + MIN_SCENE_MS);
			return { scene: start.scene, at: now - start.since, since: start.since };
		}
		start = { key, scene, since: scene === "error" && errorAt !== undefined ? errorAt : now };
		sceneStarts.set(env.state, start);
	}
	return { scene, at: now - start.since, since: start.since };
}

/** The visible animation values also schedule their next change, even on a cache hit. */
function logoKey(env: PanelEnv, width: number): unknown[] {
	const now = env.now();
	const { scene, at, since } = sceneTime(env);
	const frame = logoFrameTime(env.state, scene, at);
	if (frame.next !== undefined) env.redrawAt(since + frame.next);
	if (frame.key !== undefined) return [scene, frame.key];
	let scale = 4;
	while (scale > 1 && pixelArtWidth(PI_LOGO, scale) > width) scale--;
	const length = PI_LOGO.length * scale;
	const tick = Math.floor(now / 120);
	let stage = -1;
	if (env.state.agentRunning || tick % 42 < length) stage = env.every(120);
	else env.redrawAt((Math.floor(tick / 42) + 1) * 42 * 120);
	const errorAt = toolData(env.state).lastErrorAt;
	const noisy = env.state.agentRunning && errorAt !== undefined && now < errorAt + 1000;
	if (noisy) env.redrawAt(errorAt + 1000);
	const done = !env.state.agentRunning && env.state.termAttention;
	const breath = done ? 0.9 + 0.1 * Math.cos((2 * Math.PI * now) / 2400) : 1;
	if (done) env.redrawAt(now + 1000 / 60);
	return [scene, frame.key, stage, noisy, breath];
}

/** The logo in the theme's accent colour, as large as the panel allows. */
function logoLines(env: PanelEnv, width: number): string[] {
	const theme = env.theme();
	const mode = theme.getColorMode();
	const rgb = colorToRgb(theme.colors.accent);
	const base: Rgb = [rgb.r, rgb.g, rgb.b];
	// logo.*, when there is one: as a Kitty image where the terminal shows them, else
	// as cells carrying brightness, coloured here so that a change of theme recolours
	// them without reading the picture again.
	const { scene, at } = sceneTime(env);
	const now = env.now();
	const tick = Math.floor(now / 120);
	const picture = logoPicture(env.state, width, base, scene, at);
	if (picture) {
		const pad = " ".repeat(Math.max(0, Math.floor((width - picture.columns) / 2)));
		return [pad + picture.lines[0], ...picture.lines.slice(1)];
	}
	const image = logoArt(env.state, width, scene, at);
	if (image) {
		const pad = " ".repeat(Math.max(0, Math.floor((width - image[0]!.length) / 2)));
		return image.map((row) => pad + row.map(({ glyph, fg, bg }) => {
			if (fg === undefined && bg === undefined) return glyph;
			const f = shade(base, fg ?? 0);
			const b = shade(base, bg ?? 0);
			return (fg !== undefined ? foregroundAnsi({ kind: "rgb", r: f[0], g: f[1], b: f[2] }, mode) : "") +
				(bg !== undefined ? backgroundAnsi({ kind: "rgb", r: b[0], g: b[1], b: b[2] }, mode) : "") + glyph + "\x1b[0m";
		}).join(""));
	}
	// Cells are about twice as tall as they are wide, so both scales stay equal.
	let scale = 4;
	while (scale > 1 && pixelArtWidth(PI_LOGO, scale) > width) scale--;
	// The effects work on the drawn pixels (half a row tall), not on the logo's four
	// rows, so that the scan line is one pixel thin and the noise moves by one pixel.
	const pixels = PI_LOGO.flatMap((row) => Array.from({ length: scale }, () => [...row].map((pixel) => pixel.repeat(scale)).join("")));
	const tools = toolData(env.state);
	const errorAge = tools.lastErrorAt === undefined ? Infinity : now - tools.lastErrorAt;
	const working = env.state.agentRunning;
	const done = !working && env.state.termAttention;
	const scan = working ? tick % pixels.length : tick % 42 < pixels.length ? tick % 42 : -1;
	const rows = pixels.map((row, index) => {
		let next = row;
		if (working && errorAge < 1000) {
			const shift = (tick + index) % 3 - 1;
			next = shift < 0 ? row.slice(1) + "." : shift > 0 ? "." + row.slice(0, -1) : row;
		} else if (index === scan) {
			next = row.replace(/[bcy]/g, "h");
		} else if (working) {
			const shades = "byc";
			next = row.replace(/[bcy]/g, (color) => shades[(shades.indexOf(color) + Math.floor(tick / 4)) % shades.length]!);
		}
		return next;
	});
	// The scan line is the accent halfway to white, so that it shows on the brightest shade too.
	// Done (finished on another page, not yet seen) breathes: the brightness eases down to
	// 80% and back every 2.4 s (20 ticks), without the logo going away.
	const breath = done ? 0.9 + 0.1 * Math.cos((2 * Math.PI * now) / 2400) : 1;
	const palette: Record<string, Rgb> = { ...shadePalette(base, Object.fromEntries(Object.entries(PI_LOGO_SHADES).map(([key, factor]) => [key, factor * breath]))), h: base.map((value) => Math.round(value + (255 - value) / 2)) as Rgb };
	const paint: Paint = (glyph, colors) => {
		const fg = colors.fg ? palette[colors.fg] : undefined;
		const bg = colors.bg ? palette[colors.bg] : undefined;
		const prefix =
			(fg ? foregroundAnsi({ kind: "rgb", r: fg[0], g: fg[1], b: fg[2] }, mode) : "") +
			(bg ? backgroundAnsi({ kind: "rgb", r: bg[0], g: bg[1], b: bg[2] }, mode) : "");
		const reset = "\x1b[0m";
		return prefix === "" ? glyph : `${prefix}${glyph}${reset}`;
	};
	const art = renderPixelArt(rows, { scaleX: 1, scaleY: 1, paint });
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


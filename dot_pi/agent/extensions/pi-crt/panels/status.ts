/**
 * STAT's panels: VITALS, CONTEXT and USAGE.
 */
import { colorToRgb, foregroundAnsi, backgroundAnsi, visibleWidth } from "@earendil-works/pi-tui";
import { CONTEXT_PANEL, contextData, contextUsage } from "../features/context.ts";
import { gitData } from "../features/git.ts";
import { logoArt, logoData, logoError, logoFrameTime, logoPicture, type LogoScene } from "../features/logo.ts";
import { toolData } from "../features/tools.ts";
import { USAGE_PANEL, usageData } from "../features/usage.ts";
import { VITALS_PANEL, vitals } from "../features/vitals.ts";
import { gaugeRatios } from "../state/usage.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { bar, compactNumber, elapsedText, originNote } from "./common.ts";
import { type Paint, PI_LOGO, PI_LOGO_SHADES, type Rgb, pixelArtWidth, renderPixelArt, shade, shadePalette } from "./pixel-art.ts";
import { type CardInput, cardsWidth, centerLine, gaugeRow, statCards } from "./status-parts.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel(VITALS_PANEL, (env) => {
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
				env.cwd(),
				view?.viewportHeight,
			],
		),
		"sized",
		() => env.focused(VITALS_PANEL),
		// Why logo.* could not be shown, on the panel's last row whether or not the rest scrolls.
		new Lines((width) => {
			const error = logoError(env.state, sceneTime(env).scene);
			return error ? [` ${env.theme().fg("text", centerLine(error, Math.max(10, width - 2)))}`] : [];
		}),
	);
	view = panel.scroll as SizedView;
	return panel;
});

registerPanel(CONTEXT_PANEL, (env) =>
	framed(
		env.theme,
		() => "CONTEXT",
		new Lines(
			(width) => contextLines(env, width),
			() => [contextData(env.state).version],
		),
		"top",
		() => env.focused(CONTEXT_PANEL),
	));

registerPanel(USAGE_PANEL, (env) =>
	framed(
		env.theme,
		() => {
			const model = usageData(env.state).model;
			return model ? `USAGE  ${model}` : "USAGE";
		},
		new Lines((width) => usageLines(env, width)),
		"top",
		() => env.focused(USAGE_PANEL),
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
	lines.push("", t.fg("muted", ` BREAKDOWN (estimated, chars/4)${originNote("observed")}`));
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
	const reading = usage.reading;
	const windows = reading?.windows ?? [];
	const lines: string[] = [];
	// Above the windows, what is unusual: no reading, or a state other than fresh
	// (stale, unavailable, auth_required and the rest).
	if (usage.error) lines.push(t.fg("error", ` ${usage.error}`));
	else if (!reading) lines.push(t.fg("dim", " -- reading --"));
	else if (reading.notSetUp) lines.push(t.fg("dim", " -- quota-axi found no sign-in in Pi --"));
	else if (reading.status !== "fresh") lines.push(t.fg("warning", ` ${reading.status}${reading.error ? `: ${reading.error}` : ""}`));
	else if (!windows.length) lines.push(t.fg("dim", " -- no windows reported --"));
	if (lines.length && windows.length) lines.push("");
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
		// A window without a percentage (credits) shows an empty bar and "--".
		const ratio = window.ratio ?? 0;
		const color = ratio > 0.85 ? "error" : ratio > 0.6 ? "warning" : "accent";
		const percent = (window.ratio === undefined ? "--" : `${Math.round(ratio * 100)}%`).padStart(4);
		const resetText = reset ? `  ${t.fg("muted", reset)}` : "";
		lines.push(` ${t.fg("text", window.label.padEnd(labelWidth))} ${bar(t, ratio, barWidth, color)} ${t.fg("accent", percent)}${resetText}`);
	}
	const at = usage.at;
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

/** STATUS: the logo, four gauges around it, the stat cards, the model and the working folder. */
function vitalsLines(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const inner = Math.max(10, width - 2);
	const logo = logoLines(env, inner);
	// Each gauge (name, bar and value) has its middle on an edge of the logo, as far as
	// the panel allows, rather than filling the panel.
	const gauges = { gap: 4, maxColumn: 30, centers: [logo.left, logo.left + logo.columns] as const };
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
	const limits = gaugeRatios(allowance.reading?.windows ?? []);
	const body: string[] = [];

	body.push(gaugeRow(
		{ ...columns, label: "CTX", ratio: (usage?.percent ?? 0) / 100, value: usage?.percent === null || usage === undefined ? "--" : undefined },
		{ ...columns, label: "5H", ratio: limits.fiveHour ?? 0, value: limits.fiveHour === undefined ? "--" : undefined },
		inner,
		gauges,
	));
	body.push("");
	body.push(...logo.lines);
	body.push("");
	body.push(centerLine(stateText(env), inner));
	body.push("");
	body.push(gaugeRow(
		{ ...columns, label: "CACHE", ratio: v.cacheRatio ?? 0, value: v.cacheRatio === undefined ? "--" : undefined },
		{ ...columns, label: "WEEK", ratio: limits.weekly ?? 0, value: limits.weekly === undefined ? "--" : undefined },
		inner,
		gauges,
	));
	body.push("");

	const lines = body.map((line) => ` ${t.fg("text", line)}`);
	// The cards are as wide as their names and values need, up to the panel's width, and centred.
	const cardInputs = cardsOf(env);
	// statCards returns four lines per row: frame, name, value, frame.
	const cards = statCards(cardInputs, Math.min(inner, cardsWidth(cardInputs)));
	cards.forEach((line, index) => {
		const slot = index % 4 === 1 ? "muted" : index % 4 === 2 ? "accent" : "dim";
		lines.push(` ${t.fg(slot, centerLine(line, inner))}`);
	});
	lines.push(` ${t.fg("muted", centerLine(allowance.model ?? "-- no model --", inner))}`);
	lines.push(` ${t.fg("muted", centerLine(env.cwd(), inner))}`);
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
	const { scene, at, since } = sceneTime(env);
	const frame = logoFrameTime(env.state, scene, at);
	if (frame.next !== undefined) env.redrawAt(since + frame.next);
	if (frame.key !== undefined) return [scene, frame.key];
	const { stage, noisy, breath } = piLogoMotion(env, width);
	return [scene, frame.key, stage, noisy, breath];
}

/** A step of Pi's logo's animation, in ms. */
const PI_LOGO_STEP_MS = 120;
/** While the agent does not run, a scan line crosses Pi's logo once every this many steps. */
const PI_LOGO_SCAN_STEPS = 42;

/**
 * How Pi's logo moves now in a panel `width` cells wide, which both the cache key and
 * the drawing read; asks for a redraw when it next changes. `scale` is the logo's size,
 * `stage` the step while the logo moves (-1 while it stands still), `scan` the pixel row
 * of the scan line (-1 when there is none), `noisy` whether it shows the error noise, and
 * `breath` its brightness.
 */
function piLogoMotion(env: PanelEnv, width: number): { scale: number; stage: number; scan: number; noisy: boolean; breath: number } {
	const now = env.now();
	let scale = 4;
	while (scale > 1 && pixelArtWidth(PI_LOGO, scale) > width) scale--;
	const rows = PI_LOGO.length * scale;
	const working = env.state.agentRunning;
	const step = Math.floor(now / PI_LOGO_STEP_MS);
	let stage = -1;
	let scan = -1;
	if (working || step % PI_LOGO_SCAN_STEPS < rows) {
		stage = env.every(PI_LOGO_STEP_MS);
		scan = working ? stage % rows : stage % PI_LOGO_SCAN_STEPS;
	} else env.redrawAt((Math.floor(step / PI_LOGO_SCAN_STEPS) + 1) * PI_LOGO_SCAN_STEPS * PI_LOGO_STEP_MS);
	const errorAt = toolData(env.state).lastErrorAt;
	const noisy = working && errorAt !== undefined && now < errorAt + ERROR_SCENE_MS;
	if (noisy) env.redrawAt(errorAt + ERROR_SCENE_MS);
	// Done (finished on another page, not yet seen) breathes: the brightness eases down to
	// 80% and back every 2.4 s (20 steps), without the logo going away.
	const done = !working && env.state.termAttention;
	const breath = done ? 0.9 + 0.1 * Math.cos((2 * Math.PI * now) / 2400) : 1;
	if (done) env.redrawAt(now + 1000 / 60);
	return { scale, stage, scan, noisy, breath };
}

/**
 * The logo in the theme's accent colour, as large as the panel allows, centred in
 * `width`: its lines, the cell its left edge is at, and its width in cells.
 */
function logoLines(env: PanelEnv, width: number): { lines: string[]; left: number; columns: number } {
	const theme = env.theme();
	const mode = theme.getColorMode();
	const rgb = colorToRgb(theme.colors.accent);
	const base: Rgb = [rgb.r, rgb.g, rgb.b];
	// logo.*, when there is one: as a Kitty image where the terminal shows them, else
	// as cells carrying brightness, coloured here so that a change of theme recolours
	// them without reading the picture again.
	const { scene, at } = sceneTime(env);
	const picture = logoPicture(env.state, width, base, scene, at);
	if (picture) {
		const left = Math.max(0, Math.floor((width - picture.columns) / 2));
		return { lines: [" ".repeat(left) + picture.lines[0], ...picture.lines.slice(1)], left, columns: picture.columns };
	}
	const image = logoArt(env.state, width, scene, at);
	if (image) {
		const columns = image[0]!.length;
		const left = Math.max(0, Math.floor((width - columns) / 2));
		const pad = " ".repeat(left);
		return { left, columns, lines: image.map((row) => pad + row.map(({ glyph, fg, bg }) => {
			if (fg === undefined && bg === undefined) return glyph;
			const f = shade(base, fg ?? 0);
			const b = shade(base, bg ?? 0);
			return (fg !== undefined ? foregroundAnsi({ kind: "rgb", r: f[0], g: f[1], b: f[2] }, mode) : "") +
				(bg !== undefined ? backgroundAnsi({ kind: "rgb", r: b[0], g: b[1], b: b[2] }, mode) : "") + glyph + "\x1b[0m";
		}).join("")) };
	}
	const { scale, stage, scan, noisy, breath } = piLogoMotion(env, width);
	// Cells are about twice as tall as they are wide, so both scales stay equal.
	// The effects work on the drawn pixels (half a row tall), not on the logo's four
	// rows, so that the scan line is one pixel thin and the noise moves by one pixel.
	// The noise and the shades only move while the agent runs, when stage is the step.
	const pixels = PI_LOGO.flatMap((row) => Array.from({ length: scale }, () => [...row].map((pixel) => pixel.repeat(scale)).join("")));
	const rows = pixels.map((row, index) => {
		let next = row;
		if (noisy) {
			const shift = (stage + index) % 3 - 1;
			next = shift < 0 ? row.slice(1) + "." : shift > 0 ? "." + row.slice(0, -1) : row;
		} else if (index === scan) {
			next = row.replace(/[bcy]/g, "h");
		} else if (env.state.agentRunning) {
			const shades = "byc";
			next = row.replace(/[bcy]/g, (color) => shades[(shades.indexOf(color) + Math.floor(stage / 4)) % shades.length]!);
		}
		return next;
	});
	// The scan line is the accent halfway to white, so that it shows on the brightest shade too.
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
	const columns = pixelArtWidth(PI_LOGO, scale);
	const left = Math.max(0, Math.floor((width - columns) / 2));
	return { lines: art.map((line) => " ".repeat(left) + line), left, columns };
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


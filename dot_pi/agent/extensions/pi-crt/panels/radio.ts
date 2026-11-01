/**
 * RADIO's panels: STATIONS (the stations in radio.json), SEARCH (a search box and
 * the songs it found), OUTPUT (the output devices) and NOW PLAYING. Enter on a
 * station or a song plays it, or stops it when it is playing; Enter on a device
 * plays on it. On every RADIO panel `n` skips to the next song and `+` / `-`
 * change the volume.
 *
 * The search box takes every key but ctrl+c while it is being typed into (see
 * ListControl.typing); Enter searches and Esc leaves it.
 */
import { Input, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	changeVolume,
	nextTrack,
	type OutputDevice,
	pickOutput,
	playedSeconds,
	playsOn,
	playsSong,
	playsStation,
	type RadioData,
	radioData,
	searchSongs,
	toggleSong,
	toggleStation,
} from "../features/radio.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { noSignalLines } from "../screen/nosignal.ts";
import { bar, ListLines, Selection, spinner, themeStamp, withCursor } from "./common.ts";
import { type ListControl, type PanelEnv, registerPanel } from "./registry.ts";

/** The keys every RADIO panel shares; returns whether the key was one. */
function radioKey(env: PanelEnv, data: string): boolean {
	if (matchesKey(data, "n")) nextTrack(env.state);
	else if (matchesKey(data, "+") || matchesKey(data, "=")) changeVolume(env.state, 0.1);
	else if (matchesKey(data, "-")) changeVolume(env.state, -0.1);
	else return false;
	return true;
}

/** A list selection that also takes the RADIO keys. */
class RadioSelection extends Selection {
	constructor(
		count: () => number,
		onActivate: (index: number) => void,
		private readonly onKey: (data: string) => boolean,
	) {
		super(count, onActivate);
	}

	key(data: string): boolean {
		return this.onKey(data);
	}
}

/** `m:ss`. */
function clock(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Text at the left, `right` at the right edge of `width`; the left is cut to make room. */
function spread(left: string, right: string, width: number): string {
	const room = width - visibleWidth(right) - 1;
	if (room < 1) return truncateToWidth(left, width);
	const cut = truncateToWidth(left, room);
	return cut + " ".repeat(Math.max(1, width - visibleWidth(cut) - visibleWidth(right))) + right;
}

/* ------------------------------------------------------------ STATIONS */

registerPanel("stations", (env) => {
	const selection = new RadioSelection(
		() => radioData(env.state).stations.length,
		(index) => toggleStation(env.state, index),
		(data) => radioKey(env, data),
	);
	// Enter works on the first station before an arrow key or j/k was pressed.
	selection.index = 0;
	const panel = framed(
		env.theme,
		() => "STATIONS",
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "stations", stationLines(env, selection, width - 1));
			},
			() => [radioData(env.state).version, selection.index, env.focused("stations"), themeStamp(env.theme())],
		),
		"top",
		() => env.focused("stations"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
});

function stationLines(env: PanelEnv, selection: Selection, width: number): string[] {
	const t = env.theme();
	const data = radioData(env.state);
	const lines: string[] = [];
	data.stations.forEach((station, index) => {
		selection.place(index, lines.length, 1);
		const on = playsStation(data, station);
		const name = on ? `${t.fg("accent", "♪")} ${t.fg("accent", t.bold(station.name))}` : `  ${t.fg("text", station.name)}`;
		const place = on && data.position && data.position.index > 0 ? t.fg("muted", `${data.position.index} / ${data.position.total}`) : "";
		lines.push(spread(name, place, width));
	});
	if (!data.stations.length && !data.stationsError) lines.push(t.fg("dim", " -- no stations --"));
	if (data.stationsError) {
		lines.push("");
		const note = data.stations.length ? `${data.stationsError} (showing the last good list)` : data.stationsError;
		for (const line of wrapTextWithAnsi(note, Math.max(1, width - 2))) lines.push(` ${t.fg("error", line)}`);
	}
	return lines;
}

/* ------------------------------------------------------------ SEARCH */

registerPanel("radiosearch", (env) => {
	const input = new Input({ prompt: "› " });
	let typing = false;
	/** Bumped on every key typed, so that the cached lines follow the cursor. */
	let typed = 0;
	const leave = () => {
		typing = false;
		input.focused = false;
	};
	input.onSubmit = (value) => {
		leave();
		searchSongs(env.state, value);
	};
	// Esc leaves the text as typed, so that entering the box again continues it.
	input.onEscape = leave;

	const selection = new RadioSelection(
		() => 1 + radioData(env.state).search.results.length,
		(index) => {
			if (index === 0) {
				typing = true;
				input.focused = true;
				return;
			}
			const track = radioData(env.state).search.results[index - 1];
			if (track) toggleSong(env.state, track);
		},
		(data) => {
			if (!typing) return radioKey(env, data);
			typed++;
			input.handleInput(data);
			return true;
		},
	);
	selection.index = 0;
	const list: ListControl = Object.assign(selection, { typing: () => typing });
	const panel = framed(
		env.theme,
		() => "SEARCH",
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "radiosearch", searchLines(env, selection, input, typing, width - 1));
			},
			() => [radioData(env.state).version, selection.index, env.focused("radiosearch"), typing, typed, themeStamp(env.theme())],
			// The search box's line carries the cursor marker, which clipping must not cut.
			true,
		),
		"top",
		() => env.focused("radiosearch"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list };
});

function searchLines(env: PanelEnv, selection: Selection, input: Input, typing: boolean, width: number): string[] {
	const t = env.theme();
	const data = radioData(env.state);
	const search = data.search;
	const lines: string[] = [];
	if (typing) {
		const inner = Math.max(1, width - 4);
		const [field = ""] = input.render(inner);
		selection.place(0, 0, 4);
		lines.push(` ${t.fg("border", `┌${"─".repeat(inner)}┐`)}`);
		lines.push(` ${t.fg("border", "│")}${field}${" ".repeat(Math.max(0, inner - visibleWidth(field)))}${t.fg("border", "│")}`);
		lines.push(` ${t.fg("border", `└${"─".repeat(inner)}┘`)}`);
		lines.push(truncateToWidth(`   ${t.fg("dim", "ENTER search   ESC cancel")}`, width));
	} else {
		selection.place(0, 0, 1);
		const text = search.query ? t.fg("text", search.query) : t.fg("dim", "search YouTube Music");
		lines.push(truncateToWidth(` ${t.fg("accent", "›")} ${text}`, width));
	}
	lines.push(t.fg("borderMuted", ` ${"─".repeat(Math.max(0, width - 2))}`));
	if (search.loading) lines.push(` ${t.fg("warning", spinner(env.tick()))} ${t.fg("muted", "searching…")}`);
	else if (search.error) for (const line of wrapTextWithAnsi(search.error, Math.max(1, width - 2))) lines.push(` ${t.fg("error", line)}`);
	else if (search.query && !search.results.length) lines.push(t.fg("dim", " -- no songs --"));
	search.results.forEach((track, index) => {
		selection.place(index + 1, lines.length, 2);
		const on = playsSong(data, track);
		const title = on ? `${t.fg("accent", "♪")} ${t.fg("accent", t.bold(track.title))}` : `  ${t.fg("text", track.title)}`;
		lines.push(truncateToWidth(title, width));
		lines.push(spread(`  ${t.fg("muted", track.artist)}`, t.fg("dim", track.seconds === undefined ? "" : clock(track.seconds)), width));
	});
	return lines;
}

/* ------------------------------------------------------------ OUTPUT */

registerPanel("radiooutput", (env) => {
	const selection = new RadioSelection(
		() => radioData(env.state).outputs.devices.length,
		(index) => {
			const device = radioData(env.state).outputs.devices[index];
			if (device) pickOutput(env.state, device);
		},
		(data) => radioKey(env, data),
	);
	selection.index = 0;
	const panel = framed(
		env.theme,
		() => "OUTPUT",
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "radiooutput", outputLines(env, selection, width - 1));
			},
			// The tick only while the spinner turns.
			() => {
				const data = radioData(env.state);
				return [data.version, data.outputs.loading && env.tick(), selection.index, env.focused("radiooutput"), themeStamp(env.theme())];
			},
		),
		"top",
		() => env.focused("radiooutput"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
});

/**
 * A name like "Endpoint (Adapter)" (as WASAPI gives them) shows the adapter on the
 * second line; SYSTEM DEFAULT says there what it is.
 */
function deviceName(device: OutputDevice): [string, string] {
	if (device.name === null) return [device.label, "the device the system uses"];
	const match = /^(.*\S) \((.+)\)$/.exec(device.label);
	return match ? [match[1]!, match[2]!] : [device.label, ""];
}

function outputLines(env: PanelEnv, selection: Selection, width: number): string[] {
	const t = env.theme();
	const outputs = radioData(env.state).outputs;
	const lines: string[] = [];
	outputs.devices.forEach((device, index) => {
		selection.place(index, lines.length, 2);
		const [name, adapter] = deviceName(device);
		const on = playsOn(device);
		const title = on ? `${t.fg("accent", "♪")} ${t.fg("accent", t.bold(name))}` : `  ${t.fg("text", name)}`;
		lines.push(truncateToWidth(title, width));
		lines.push(truncateToWidth(`  ${t.fg("dim", adapter)}`, width));
	});
	if (outputs.loading && !outputs.devices.length) lines.push(` ${t.fg("warning", spinner(env.tick()))} ${t.fg("muted", "listing devices…")}`);
	else if (!outputs.devices.length && !outputs.error) lines.push(t.fg("dim", " -- no output devices --"));
	if (outputs.error) {
		if (lines.length) lines.push("");
		for (const line of wrapTextWithAnsi(outputs.error, Math.max(1, width - 2))) lines.push(` ${t.fg("error", line)}`);
	}
	return lines;
}

/* ------------------------------------------------------------ NOW PLAYING */

registerPanel("nowplaying", (env) => {
	let view: SizedView | undefined;
	const panel = framed(
		env.theme,
		() => "NOW PLAYING",
		new Lines((width) => {
			const height = Math.max(1, view?.viewportHeight ?? 1);
			if (view) view.drawnFor = height;
			return nowPlayingLines(env, width, height);
		}),
		"sized",
		() => env.focused("nowplaying"),
	);
	view = panel.scroll as SizedView;
	// Nothing to select or scroll: the panel is drawn to its height. It takes the RADIO keys.
	const list: ListControl = {
		move: () => {},
		page: () => {},
		toStart: () => {},
		toEnd: () => {},
		activate: () => {},
		key: (data) => radioKey(env, data),
	};
	return { ...panel, list };
});

/** The station or song the music comes from. */
function sourceLabel(data: Readonly<RadioData>): string {
	const source = data.source;
	if (!source) return "";
	if (source.kind === "song") return `RADIO: ${source.seed.title}`;
	return source.station.name;
}

/** Braille dots of one column of a cell, top to bottom. */
const LEFT_DOTS = [0x01, 0x02, 0x04, 0x40];
const RIGHT_DOTS = [0x08, 0x10, 0x20, 0x80];

/**
 * `rows` rows of braille: the levels of the packets played last, newest at the
 * right, drawn above and below a middle line. Each cell holds two levels.
 */
function waveform(levels: readonly number[], cells: number, rows: number): string[] {
	const points = cells * 2;
	const recent = levels.slice(-points);
	const padded = [...Array.from({ length: points - recent.length }, () => 0), ...recent];
	/** Dot rows above (and below) the middle line. */
	const half = rows * 2;
	const out = Array.from({ length: rows }, () => [] as string[]);
	for (let cell = 0; cell < cells; cell++) {
		const bits = Array.from({ length: rows }, () => 0);
		for (const [side, dots] of [
			[0, LEFT_DOTS],
			[1, RIGHT_DOTS],
		] as const) {
			// Music sits around 0.05 to 0.3 RMS; the square root spreads it over the dot rows.
			const reach = Math.min(half, Math.round(Math.sqrt(padded[cell * 2 + side]!) * 1.125 * half));
			// The middle line is dot rows half - 1 and half.
			const from = half - 1 - Math.max(0, reach - 1);
			const to = half + Math.max(0, reach - 1);
			for (let row = from; row <= to; row++) bits[Math.floor(row / 4)]! |= dots[row % 4]!;
		}
		bits.forEach((value, row) => out[row]!.push(String.fromCharCode(0x2800 + value)));
	}
	return out.map((row) => row.join(""));
}

function nowPlayingLines(env: PanelEnv, width: number, height: number): string[] {
	const data = radioData(env.state);
	if (data.status === "error") {
		// Which track failed, when one did: the reason alone often does not say.
		const reason = data.track ? `${data.track.title}: ${data.error ?? ""}` : (data.error ?? "");
		return noSignalLines(env.theme, "NO SIGNAL", width, height, reason);
	}
	const lines = playerLines(env, data, width, height);
	// The RADIO keys on the bottom row, when there is a row to spare.
	const hint = height >= lines.length + 2;
	const room = hint ? height - 1 : height;
	const above = Math.max(0, Math.floor((room - lines.length) / 2));
	const body = [...Array.from({ length: above }, () => ""), ...lines];
	if (hint) body.push(...Array.from({ length: Math.max(0, room - body.length) }, () => ""), keyHints(env));
	return body.map((line) => truncateToWidth(line, width));
}

/**
 * The keys every RADIO panel takes, as the bottom row of NOW PLAYING shows them.
 * Enter is left out: what it does depends on the page (play or stop, pick a device).
 */
function keyHints(env: PanelEnv): string {
	const t = env.theme();
	const key = (keys: string, what: string) => `${t.fg("accent", keys)} ${t.fg("dim", what)}`;
	return `   ${[key("n", "next"), key("+/-", "volume")].join(t.fg("dim", " · "))}`;
}

/** Rows NOW PLAYING has besides the waveform while a track plays, with the key row and the blank row above it. */
const PLAYER_ROWS = 10;

function playerLines(env: PanelEnv, data: Readonly<RadioData>, width: number, height: number): string[] {
	const t = env.theme();
	const indent = "   ";
	const inner = Math.max(10, width - indent.length * 2);
	// About a third of the panel, as far as the other rows leave room; never under two rows.
	const rows = Math.max(2, Math.min(Math.round(height / 3), height - PLAYER_ROWS));
	const wave = waveform(data.status === "playing" ? data.levels : [], inner - 2, rows).map(
		(row) => `${indent}${t.fg("borderMuted", "┊")}${t.fg("accent", row)}${t.fg("borderMuted", "┊")}`,
	);
	const track = data.track;
	if (data.status === "idle" || !data.source) {
		const hint = "ENTER TO TUNE IN";
		return [...wave, "", " ".repeat(Math.max(0, Math.floor((width - hint.length) / 2))) + t.fg("muted", hint)];
	}
	const lines: string[] = [];
	if (data.status === "tuning" || !track) {
		lines.push(`${indent}${t.fg("warning", spinner(env.tick()))} ${t.fg("warning", t.bold("TUNING…"))}`);
		lines.push(`${indent}${t.fg("muted", track ? `${track.title} — ${track.artist}` : sourceLabel(data))}`);
		lines.push("", ...wave);
		return lines;
	}
	lines.push(`${indent}${t.fg("accent", t.bold(track.title))}`);
	lines.push(`${indent}${t.fg("muted", track.artist)}`);
	lines.push("", ...wave, "");
	const elapsed = playedSeconds(data);
	const total = track.seconds;
	const time = total === undefined ? clock(elapsed) : `${clock(elapsed)} / ${clock(total)}`;
	const barWidth = Math.max(4, inner - visibleWidth(time) - 3);
	lines.push(`${indent}${bar(t, total ? elapsed / total : 0, barWidth)}   ${t.fg("muted", time)}`);
	const volume = `${t.fg("muted", "VOL")} ${bar(t, data.volume, 10)} ${t.fg("muted", String(Math.round(data.volume * 100)))}`;
	lines.push(`${indent}${spread(volume, t.fg("accent", sourceLabel(data)), inner)}`);
	const next = data.queue[0];
	if (next) lines.push("", `${indent}${t.fg("dim", "NEXT")}  ${t.fg("muted", `${next.title} — ${next.artist}`)}`);
	return lines;
}

/**
 * RADIO's panels: STATIONS (the stations in radio.json), SEARCH (a search box and
 * the playlists and songs it found), OUTPUT (the output devices) and NOW PLAYING.
 * Enter on a station, a playlist or a song plays it, or stops it when it is
 * playing; Enter on a device plays on it. Delete twice on a station removes it from
 * radio.json, and `a` on a playlist adds it there. On every RADIO panel `n` skips
 * to the next song and `+` / `-` change the volume.
 *
 * The search box takes every key but ctrl+c while it is being typed into (see
 * ListControl.typing); Enter searches, Esc or Tab leaves it, and Alt+O leaves it
 * and gives the keys to the editor (shell/input.ts).
 */
import { Input, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	addPlaylist,
	changeVolume,
	isStation,
	nextTrack,
	type OutputDevice,
	pickOutput,
	playedSeconds,
	playsOn,
	playsPlaylist,
	playsSong,
	playsStation,
	RETRY_MS,
	type RadioData,
	radioData,
	removeStation,
	searchSongs,
	stationKey,
	togglePlaylist,
	toggleSong,
	toggleStation,
} from "../features/radio.ts";
import { framed, type SizedView } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { noSignalLines } from "../screen/nosignal.ts";
import { bar, ListLines, Selection, spinner, withCursor } from "./common.ts";
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
		keys: () => readonly unknown[],
		onActivate: (index: number) => void,
		private readonly onKey: (data: string) => boolean,
	) {
		super(keys, onActivate);
	}

	/** Before an item was selected, select the first, so that Enter works on it before an arrow key or j/k. */
	protected override unselected(): number {
		if (!this.keys().length) return -1;
		this.select(0);
		return 0;
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
	/** The station Delete was pressed on once; a second Delete on it removes it. */
	const armed: { key?: unknown } = {};
	const selection = new RadioSelection(
		// A station is its source; its name may change, and two stations may share one.
		() => radioData(env.state).stations.map(stationKey),
		(index) => toggleStation(env.state, index),
		(data) => {
			if (!matchesKey(data, "delete")) {
				armed.key = undefined;
				return radioKey(env, data);
			}
			const index = selection.index;
			if (index < 0) return true;
			if (armed.key === selection.selectedKey) {
				armed.key = undefined;
				removeStation(env.state, index);
			} else armed.key = selection.selectedKey;
			return true;
		},
	);
	const panel = framed(
		env.theme,
		() => "STATIONS  ·  DEL ×2: remove",
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				// Moving to another station takes back the first Delete.
				if (armed.key !== selection.selectedKey) armed.key = undefined;
				return withCursor(env, selection, "stations", stationLines(env, selection, armed.key, width - 1));
			},
			() => [radioData(env.state).version, selection.selectedKey, env.focused("stations"), armed.key],
		),
		"top",
		() => env.focused("stations"),
	);
	selection.view = panel.scroll;
	return { ...panel, list: selection };
});

/** `armed`: the key of the station Delete was pressed on once, which says so. */
function stationLines(env: PanelEnv, selection: Selection, armed: unknown, width: number): string[] {
	const t = env.theme();
	const data = radioData(env.state);
	const lines: string[] = [];
	data.stations.forEach((station, index) => {
		selection.place(index, lines.length, 1);
		const on = playsStation(data, station);
		const name = on ? `${t.fg("accent", "♪")} ${t.fg("accent", t.bold(station.name))}` : `  ${t.fg("text", station.name)}`;
		const place = on && data.position && data.position.index > 0 ? t.fg("muted", `${data.position.index} / ${data.position.total}`) : "";
		const armedHere = armed !== undefined && index === selection.index;
		if (!armedHere) lines.push(spread(name, place, width));
		else {
			// The note is kept on a narrow panel: the name gives way to it, and then it shortens.
			const note = t.fg("error", "DEL AGAIN TO REMOVE");
			if (visibleWidth(name) + visibleWidth(note) + 1 <= width) lines.push(spread(name, note, width));
			else lines.push(truncateToWidth(` ${t.fg("error", width > visibleWidth(note) ? "DEL AGAIN TO REMOVE" : "DEL AGAIN")}`, width));
		}
	});
	if (!data.stations.length && !data.stationsError) lines.push(t.fg("dim", " -- no stations --"));
	if (data.stationsError) {
		lines.push("");
		const note = data.stations.length ? `${data.stationsError} (showing the last good list)` : data.stationsError;
		for (const line of wrapTextWithAnsi(note, Math.max(1, width - 2))) lines.push(` ${t.fg("error", line)}`);
	}
	saveErrorLines(env, width, lines);
	return lines;
}

/** Why the last station added or removed could not be saved, after a blank line. */
function saveErrorLines(env: PanelEnv, width: number, lines: string[]): void {
	const error = radioData(env.state).saveError;
	if (!error) return;
	lines.push("");
	for (const line of wrapTextWithAnsi(error, Math.max(1, width - 2))) lines.push(` ${env.theme().fg("error", line)}`);
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

	/** The playlist or the song at an index of the list; the search box is 0. */
	const itemAt = (index: number) => {
		const { playlists, results } = radioData(env.state).search;
		const playlist = playlists[index - 1];
		return playlist ? { playlist } : { track: results[index - 1 - playlists.length] };
	};
	const selection = new RadioSelection(
		// The search box, then the playlists, then the songs.
		() => {
			const { playlists, results } = radioData(env.state).search;
			return [undefined, ...playlists.map((playlist) => `playlist:${playlist.id}`), ...results.map((track) => `song:${track.id}`)];
		},
		(index) => {
			if (index === 0) {
				env.focusPanel("radiosearch");
				typing = true;
				input.focused = true;
				return;
			}
			const { playlist, track } = itemAt(index);
			if (playlist) togglePlaylist(env.state, playlist);
			else if (track) toggleSong(env.state, track);
		},
		(data) => {
			if (!typing) {
				if (!matchesKey(data, "a")) return radioKey(env, data);
				const { playlist } = itemAt(selection.index);
				if (playlist) addPlaylist(env.state, playlist);
				return playlist !== undefined;
			}
			typed++;
			if (matchesKey(data, "escape") || matchesKey(data, "tab")) leave();
			else input.handleInput(data);
			return true;
		},
	);
	const list: ListControl = Object.assign(selection, { typing: () => typing });
	const panel = framed(
		env.theme,
		() => "SEARCH  ·  a: add playlist",
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "radiosearch", searchLines(env, selection, input, typing, width - 1));
			},
			() => [radioData(env.state).version, selection.selectedKey, env.focused("radiosearch"), typing, typed, radioData(env.state).search.loading && env.every(120)],
			// The search box's line carries the cursor marker, which clipping must not cut.
			true,
		),
		"top",
		() => env.focused("radiosearch"),
	);
	selection.view = panel.scroll;
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
		const text = search.query ? t.fg("text", search.query) : t.fg("dim", "search YouTube");
		lines.push(truncateToWidth(` ${t.fg("accent", "›")} ${text}`, width));
	}
	saveErrorLines(env, width, lines);
	lines.push(t.fg("borderMuted", ` ${"─".repeat(Math.max(0, width - 2))}`));
	if (search.loading) lines.push(` ${t.fg("warning", spinner(env.every(120)))} ${t.fg("muted", "searching…")}`);
	else if (search.error) for (const line of wrapTextWithAnsi(search.error, Math.max(1, width - 2))) lines.push(` ${t.fg("error", line)}`);
	else if (search.query && !search.results.length && !search.playlists.length) lines.push(t.fg("dim", " -- nothing found --"));
	const heading = (label: string) => lines.push(` ${t.fg("dim", label)}`);
	if (search.playlists.length) heading("PLAYLISTS");
	search.playlists.forEach((playlist, index) => {
		selection.place(index + 1, lines.length, 2);
		const on = playsPlaylist(data, playlist);
		const title = on ? `${t.fg("accent", "♪")} ${t.fg("accent", t.bold(playlist.title))}` : `  ${t.fg("text", playlist.title)}`;
		lines.push(truncateToWidth(title, width));
		const count = playlist.count === undefined ? "" : `${playlist.count} songs`;
		const right = isStation(data, playlist) ? `${t.fg("success", "STATION")}${count && t.fg("dim", `  ${count}`)}` : t.fg("dim", count);
		lines.push(spread(`  ${t.fg("muted", playlist.author)}`, right, width));
	});
	if (search.results.length) heading("SONGS");
	search.results.forEach((track, index) => {
		selection.place(index + 1 + search.playlists.length, lines.length, 2);
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
		() => radioData(env.state).outputs.devices.map((device) => device.name),
		(index) => {
			const device = radioData(env.state).outputs.devices[index];
			if (device) pickOutput(env.state, device);
		},
		(data) => radioKey(env, data),
	);
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
				return [data.version, data.outputs.loading && !data.outputs.devices.length && env.every(120), selection.selectedKey, env.focused("radiooutput")];
			},
		),
		"top",
		() => env.focused("radiooutput"),
	);
	selection.view = panel.scroll;
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
	if (outputs.loading && !outputs.devices.length) lines.push(` ${t.fg("warning", spinner(env.every(120)))} ${t.fg("muted", "listing devices…")}`);
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
		scroll: () => {},
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
	if (source.kind === "playlist") return source.playlist.title;
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
		const error = data.track ? `${data.track.title}: ${data.error ?? ""}` : (data.error ?? "");
		const reason = `${error} (trying again in ${RETRY_MS / 1000} s)`;
		env.every(120);
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
		lines.push(`${indent}${t.fg("warning", spinner(env.every(120)))} ${t.fg("warning", t.bold("TUNING…"))}`);
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

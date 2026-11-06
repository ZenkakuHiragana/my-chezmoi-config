/**
 * RADIO: YouTube Music played inside Pi's process, without yt-dlp or a player
 * program. ytdl-core fetches a track's audio (WebM with Opus), prism-media's
 * WebmDemuxer takes the Opus packets out of it, audify's OpusDecoder turns each
 * packet into PCM, and SDL (@kmamal/sdl) plays the PCM on an output device through
 * the audio driver SDL picks, which mixes and resamples it like any other program.
 *
 * The device is the system's default (SDL follows it when it changes) until one is
 * picked on the OUTPUT page; the pick lasts as long as the radio and is not saved.
 * A source opens the device for its first track and keeps it open for the tracks
 * after it, until it stops or another device is picked. Picking another device, or
 * another volume, while a track plays queues the PCM not yet played again, so the
 * track goes on.
 *
 * Stations come from radio.json next to index.ts and are read again whenever the
 * file changes. A station with `playlist` plays that playlist shuffled, shuffling
 * again after each pass; one with `query` plays the YouTube Music radio of the
 * first song the query finds. On the SEARCH page a song found plays its radio, and
 * a YouTube playlist found plays like a playlist station; RADIO adds a playlist to
 * radio.json and removes a station from it by writing the file.
 *
 * The process has one radio, which the pi-crt instance on screen shows. A session
 * switch (/new, /resume, /fork) hands it to the next session's instance, still
 * playing; /reload and quit end it, so that a reload starts its new code with a new
 * radio. A switch that fails after the shutdown brings no next instance: the radio
 * then plays on, shown by nobody. The next session to come on screen shows it,
 * still playing, unless that session comes from /reload, which ends it; the end of
 * the process ends it too. Playback also stops when it is stopped, and when the
 * station playing is removed from radio.json. An error (a track that cannot be
 * played, the network, the device) shows on NOW PLAYING and is tried again after
 * RETRY_MS: the next track, or what failed to be fetched. Only the PCM queued for
 * the device is kept: the download pauses once QUEUE_HIGH seconds wait and resumes
 * at QUEUE_LOW.
 *
 * The four packages (@distube/ytdl-core, audify, prism-media and @kmamal/sdl) are
 * loaded on first use, so that pi-crt's other tabs still load when they are missing
 * or fail to load (a failed npm install, a Node.js version they do not support);
 * RADIO then shows why.
 */
import { readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Ytdl } from "@distube/ytdl-core";
import type { Sdl } from "@kmamal/sdl";
import { type CrtState, sanitize } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/**
 * The ids of NOW PLAYING (panels/radio.ts draws it and asks for its own redraws),
 * and of OUTPUT, which lists the devices again whenever it comes on screen.
 */
export const NOW_PLAYING_PANEL = "nowplaying";
export const RADIO_OUTPUT_PANEL = "radiooutput";

/** The station list. */
export const STATIONS_FILE = fileURLToPath(new URL("../radio.json", import.meta.url));

/** YouTube's Opus audio: 48 kHz stereo. */
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** Bytes of one frame (one 16-bit sample per channel). */
const FRAME_BYTES = CHANNELS * 2;
/** The largest Opus packet, 120 ms, in frames per channel. */
const MAX_PACKET = 5760;
/** Seconds queued for the device before the download pauses, and when it resumes. */
const QUEUE_HIGH = 10;
const QUEUE_LOW = 5;
/**
 * Levels kept for the waveform of what SDL already took, besides those not taken
 * yet: two per terminal column, as the waveform draws two levels a cell and is no
 * wider than the terminal; and at least 200 (4 s).
 */
function levelHistory(): number {
	return Math.max(200, (process.stdout.columns ?? 0) * 2);
}
/** How often the queue is read while a track plays: the played position, where it is heard, the levels kept, the end. */
const PUMP_MS = 40;
/** Frames of one level of the waveform: 20 ms, whatever the length of the Opus packets. */
const LEVEL_FRAMES = SAMPLE_RATE / 50;
/** Songs a search shows. */
const SEARCH_LIMIT = 20;
/** Playlists a search shows. */
const PLAYLIST_LIMIT = 10;
/** How long an error shows before the radio tries again. */
export const RETRY_MS = 5000;
/** Opus audio in WebM, the format the demuxer reads. */
const OPUS_FILTER = { hasAudio: true, hasVideo: false, container: "webm" } as const;

export type Station = { name: string; query: string } | { name: string; playlist: string };

export interface Track {
	id: string;
	title: string;
	artist: string;
	seconds: number | undefined;
}

/** An output device, as the OUTPUT page lists it. */
export interface OutputDevice {
	/** SDL's name of the device; null for the system's default, whichever device that is. */
	name: string | null;
	/** What the list shows. */
	label: string;
}

/** The first entry of the OUTPUT page. */
export const SYSTEM_DEFAULT: OutputDevice = Object.freeze({ name: null, label: "SYSTEM DEFAULT" });

export interface OutputsData {
	devices: OutputDevice[];
	loading: boolean;
	error?: string;
}

/** A YouTube playlist found on SEARCH. */
export interface Playlist {
	id: string;
	title: string;
	author: string;
	/** Its videos, as the search tells. */
	count: number | undefined;
}

/**
 * What is playing: a station from radio.json, the radio of a song found on SEARCH,
 * or a playlist found there.
 */
export type Source = { kind: "station"; station: Station } | { kind: "song"; seed: Track } | { kind: "playlist"; playlist: Playlist };

export interface SearchData {
	query: string;
	/** The songs found. */
	results: Track[];
	playlists: Playlist[];
	loading: boolean;
	/** Why a search failed; the results of the other search, songs or playlists, still show. */
	error?: string;
}

export interface RadioData {
	/** Bumped on every change but the playing position and levels. */
	version: number;
	stations: Station[];
	/** Why radio.json could not be used; `stations` is then the last list that could. */
	stationsError?: string;
	/** Why the last station added or removed on RADIO could not be written to radio.json. */
	saveError?: string;
	status: "idle" | "tuning" | "playing" | "error";
	error?: string;
	source?: Source;
	/** The track playing, or the one that failed. */
	track?: Track;
	/** The tracks after this one. */
	queue: Track[];
	/** A playlist station's place in the current pass, from 1. */
	position?: { index: number; total: number };
	/** 0 to 1. audify's volume is logarithmic: 0.3 gives about 11% of the amplitude. */
	volume: number;
	/** Frames of the current track's PCM SDL took so far, the time shown; the silences while the queue ran dry are not counted. */
	playedFrames: number;
	/**
	 * RMS levels (0 to 1, at full volume) of what the device plays for the current
	 * track, one per LEVEL_FRAMES, oldest first: the track's PCM and, where the queue
	 * ran dry, silence. Those SDL took lately and those not taken yet.
	 */
	levels: number[];
	/** Where `levels[0]` starts, in frames of what the device plays for the track (its PCM and its silences). */
	levelsFrom: number;
	/**
	 * Where the current track is heard, in the frames of `levelsFrom`: `frames` at
	 * `at` (Date.now()), going on at SAMPLE_RATE; below 0 before the track's first
	 * frame is heard. The radio sets it as it reads the queue, taking SDL to play what
	 * it takes about a device buffer later. Undefined until SDL takes the track's
	 * first PCM.
	 */
	heard?: { frames: number; at: number };
	search: SearchData;
	/** The output devices, listed again whenever the OUTPUT page comes on screen. */
	outputs: OutputsData;
}

interface RadioControl {
	data: RadioData;
	playStation(index: number): void;
	playSong(track: Track): void;
	playPlaylist(playlist: Playlist): void;
	/** Add a playlist to radio.json as a station. */
	addPlaylist(playlist: Playlist): void;
	/** Remove a station from radio.json. */
	removeStation(station: Station): void;
	stop(): void;
	next(): void;
	setVolume(volume: number): void;
	search(query: string): void;
	/** Whether the music plays on `device`, or will. */
	playsOn(device: OutputDevice): boolean;
	/** Play on `device` from now on, moving the track playing to it. */
	pickOutput(device: OutputDevice): void;
	/** List the output devices again; the OUTPUT page does so whenever it comes on screen. */
	listOutputs(): void;
	/**
	 * Draw on `env`'s screen from now on, without the search and the save error of the
	 * screen before; undefined draws nowhere, while one session gives way to the next.
	 */
	show(env: FeatureEnv | undefined): void;
	/** Stop the sound, the search and the watching of radio.json, for good. */
	dispose(): void;
}

/* ------------------------------------------------------------ packages */

interface Packages {
	Ytdl: typeof import("@distube/ytdl-core").Ytdl;
	SearchType: typeof import("@distube/ytdl-core").SearchType;
	audify: typeof import("audify");
	WebmDemuxer: typeof import("prism-media").opus.WebmDemuxer;
	audio: Sdl.Audio.Module;
}

let packages: Promise<Packages> | undefined;

/** The packages RADIO plays with, loaded once; a failed load is tried again next time. */
function loadPackages(): Promise<Packages> {
	packages ??= (async () => {
		const [ytdl, audify, prism, sdl] = await Promise.all([import("@distube/ytdl-core"), import("audify"), import("prism-media"), loadSdl()]);
		// audify and prism-media are CommonJS; their classes are on the default export.
		const opus = (audify as { default?: typeof import("audify") }).default ?? audify;
		const media = (prism as { default?: typeof import("prism-media") }).default ?? prism;
		return { Ytdl: ytdl.Ytdl, SearchType: ytdl.SearchType, audify: opus, WebmDemuxer: media.opus.WebmDemuxer, audio: sdl.audio };
	})().catch((error: unknown) => {
		packages = undefined;
		throw error;
	});
	return packages;
}

/**
 * Load SDL. Its video subsystem starts with it and, unless told otherwise, keeps
 * the display from sleeping (SDL_HINT_VIDEO_ALLOW_SCREENSAVER) for as long as Pi
 * runs; the hint is set only while SDL starts, so that the programs Pi runs do not
 * inherit it.
 */
async function loadSdl(): Promise<typeof import("@kmamal/sdl")> {
	const hint = "SDL_VIDEO_ALLOW_SCREENSAVER";
	const before = process.env[hint];
	process.env[hint] = "1";
	try {
		const sdl = await import("@kmamal/sdl");
		return (sdl as { default?: typeof import("@kmamal/sdl") }).default ?? sdl;
	} finally {
		if (before === undefined) delete process.env[hint];
		else process.env[hint] = before;
	}
}

/** The output devices SDL sees now, after SYSTEM_DEFAULT. */
function outputDevices(audio: Sdl.Audio.Module): OutputDevice[] {
	const named = audio.devices.filter((device) => device.type === "playback" && device.name);
	return [SYSTEM_DEFAULT, ...named.map((device) => ({ name: device.name!, label: sanitize(device.name!) }))];
}

/** PCM at a volume of 0 to 1, on the same logarithmic scale as before: 0.3 gives about 11% of the amplitude. */
function atVolume(pcm: Buffer, volume: number): Buffer {
	const gain = (10 ** volume - 1) / 9;
	if (gain >= 1) return pcm;
	const out = Buffer.allocUnsafe(pcm.length);
	for (let offset = 0; offset + 1 < pcm.length; offset += 2) out.writeInt16LE(Math.round(pcm.readInt16LE(offset) * gain), offset);
	return out;
}

/**
 * The process's radio, from the first session on screen until /reload or quit.
 * Unlike the other features' data (see FeatureEnv), it outlives the pi-crt
 * instance that made it, so that a session switch does not stop the music. It is
 * kept on globalThis, not in a module variable, because the instance after a switch
 * may run these modules evaluated again: Pi evaluates an extension's modules again
 * whenever a session, a subagent's included, is made in another working directory
 * than the last one (core/extensions/loader.js, extensionCache).
 */
const RADIO = Symbol.for("pi-crt.radio");
const shared = globalThis as { [RADIO]?: RadioControl };

/* ------------------------------------------------------------ for the panels */

/** The radio by the CrtState of the pi-crt instance that shows it (see FeatureEnv). */
const radios = new WeakMap<CrtState, RadioControl>();

const NONE: RadioData = Object.freeze({
	version: 0,
	stations: [],
	status: "idle",
	queue: [],
	volume: 1,
	playedFrames: 0,
	levels: [],
	levelsFrom: 0,
	search: { query: "", results: [], playlists: [], loading: false },
	outputs: { devices: [], loading: false },
}) as RadioData;

export function radioData(state: CrtState): Readonly<RadioData> {
	return radios.get(state)?.data ?? NONE;
}

/** What makes two stations the same, whatever their names. */
export function stationKey(station: Station): string {
	return "playlist" in station ? `playlist:${station.playlist}` : `query:${station.query}`;
}

/*
 * A source plays from its start until it is stopped: while it tunes in, plays, and
 * after an error until it tries again. Enter on it stops it.
 */

/** Whether `station` is playing. */
export function playsStation(data: Readonly<RadioData>, station: Station): boolean {
	const source = data.source;
	return source?.kind === "station" && stationKey(source.station) === stationKey(station);
}

/** Whether the radio of `track` is playing. */
export function playsSong(data: Readonly<RadioData>, track: Track): boolean {
	const source = data.source;
	return source?.kind === "song" && source.seed.id === track.id;
}

/** Whether `playlist`, found on SEARCH, is playing. */
export function playsPlaylist(data: Readonly<RadioData>, playlist: Playlist): boolean {
	const source = data.source;
	return source?.kind === "playlist" && source.playlist.id === playlist.id;
}

/** Whether a station in radio.json plays `playlist`. */
export function isStation(data: Readonly<RadioData>, playlist: Playlist): boolean {
	return data.stations.some((station) => "playlist" in station && station.playlist === playlist.id);
}

/** Seconds of the current track played. */
export function playedSeconds(data: Readonly<RadioData>): number {
	return data.playedFrames / SAMPLE_RATE;
}

/** Frames heard by `now` (Date.now()), as `heard` has it. */
function heardFrames(heard: NonNullable<RadioData["heard"]>, now: number): number {
	return heard.frames + ((now - heard.at) * SAMPLE_RATE) / 1000;
}

/**
 * The levels heard by `now` (Date.now()), up to a whole number of `stepLevels`
 * levels from the track's start, so that the waveform moves on by `stepLevels`
 * levels at a time. Past the levels kept (while the queue is dry) they are silent,
 * no more than levelHistory() of silence, as no more fits the waveform. And `nextAt`,
 * when the next step will have been heard (undefined until the track is heard).
 */
export function heardLevels(data: Readonly<RadioData>, now: number, stepLevels: number): { levels: readonly number[]; nextAt: number | undefined } {
	const heard = data.heard;
	if (!heard) return { levels: [], nextAt: undefined };
	const step = stepLevels * LEVEL_FRAMES;
	const shown = Math.floor(heardFrames(heard, now) / step) * step;
	const count = Math.max(0, Math.floor((shown - data.levelsFrom) / LEVEL_FRAMES));
	const kept = data.levels.slice(0, count);
	const silent = Math.min(count - kept.length, levelHistory());
	const levels = silent > 0 ? [...kept, ...Array.from({ length: silent }, () => 0)] : kept;
	return { levels, nextAt: heard.at + ((shown + step - heard.frames) * 1000) / SAMPLE_RATE };
}

/** Play a station, or stop it when it is the one playing. */
export function toggleStation(state: CrtState, index: number): void {
	const radio = radios.get(state);
	const station = radio?.data.stations[index];
	if (!radio || !station) return;
	if (playsStation(radio.data, station)) radio.stop();
	else radio.playStation(index);
}

/** Play the radio of a song, or stop it when it is the one playing. */
export function toggleSong(state: CrtState, track: Track): void {
	const radio = radios.get(state);
	if (!radio) return;
	if (playsSong(radio.data, track)) radio.stop();
	else radio.playSong(track);
}

/** Play a playlist found on SEARCH, or stop it when it is the one playing. */
export function togglePlaylist(state: CrtState, playlist: Playlist): void {
	const radio = radios.get(state);
	if (!radio) return;
	if (playsPlaylist(radio.data, playlist)) radio.stop();
	else radio.playPlaylist(playlist);
}

/** Add a playlist found on SEARCH to radio.json, unless a station plays it already. */
export function addPlaylist(state: CrtState, playlist: Playlist): void {
	radios.get(state)?.addPlaylist(playlist);
}

/** Remove the station at `index` of the list from radio.json. */
export function removeStation(state: CrtState, index: number): void {
	const radio = radios.get(state);
	const station = radio?.data.stations[index];
	if (radio && station) radio.removeStation(station);
}

export function nextTrack(state: CrtState): void {
	radios.get(state)?.next();
}

export function changeVolume(state: CrtState, delta: number): void {
	const radio = radios.get(state);
	if (radio) radio.setVolume(radio.data.volume + delta);
}

export function searchSongs(state: CrtState, query: string): void {
	radios.get(state)?.search(query);
}

/** Whether the music plays on `device`, or will. */
export function playsOn(device: OutputDevice): boolean {
	return shared[RADIO]?.playsOn(device) ?? device.name === null;
}

/** Play on `device` from now on, moving the track playing to it. */
export function pickOutput(state: CrtState, device: OutputDevice): void {
	radios.get(state)?.pickOutput(device);
}

/**
 * The stations in radio.json, or why they cannot be used. Entries with the same source
 * and name are one station: only the first is kept (see firstOfEach).
 */
export function parseStations(text: string): Station[] {
	const entries = parseEntries(text);
	const first = firstOfEach(entries);
	return entries.filter((_, index) => first[index]);
}

/** Whether each station is the first with its source and name; the others are dropped. */
function firstOfEach(stations: readonly Station[]): boolean[] {
	const seen = new Set<string>();
	return stations.map((station) => {
		const id = JSON.stringify([stationKey(station), station.name]);
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

/** The station of each entry of radio.json, in its order, or why one cannot be used. */
function parseEntries(text: string): Station[] {
	const parsed: unknown = JSON.parse(text);
	if (!Array.isArray(parsed)) throw new Error("expected an array of stations");
	return parsed.map((item: unknown, index): Station => {
		const where = `station ${index + 1}`;
		if (typeof item !== "object" || item === null) throw new Error(`${where}: expected an object`);
		const { name, query, playlist } = item as Record<string, unknown>;
		if (typeof name !== "string" || !name.trim()) throw new Error(`${where}: "name" must be a non-empty string`);
		const hasQuery = typeof query === "string" && query.trim() !== "";
		const hasPlaylist = typeof playlist === "string" && playlist.trim() !== "";
		if (hasQuery === hasPlaylist) throw new Error(`${where} (${name}): give either "query" or "playlist"`);
		return hasQuery ? { name, query: query as string } : { name, playlist: playlist as string };
	});
}

/** RMS of 16-bit PCM, 0 to 1. */
function level(pcm: Buffer): number {
	let sum = 0;
	const count = pcm.length >> 1;
	for (let offset = 0; offset < pcm.length; offset += 2) {
		const value = pcm.readInt16LE(offset);
		sum += value * value;
	}
	return count ? Math.sqrt(sum / count) / 32768 : 0;
}

function shuffled<T>(items: readonly T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

/** A track from YouTube's listing; its texts are drawn on the terminal, so control characters are dropped. */
function toTrack(video: { id: string; title: string; author: { name: string | undefined }; lengthSeconds: number | undefined }): Track {
	return { id: video.id, title: sanitize(video.title), artist: sanitize(video.author.name ?? ""), seconds: video.lengthSeconds };
}

/** A playlist from YouTube's listing; its texts are drawn on the terminal, so control characters are dropped. */
function toPlaylist(list: { id: string; title: string; author: { name: string | undefined }; videoCount: number | undefined }): Playlist {
	return { id: list.id, title: sanitize(list.title), author: sanitize(list.author.name ?? ""), count: list.videoCount };
}

function messageOf(error: unknown): string {
	return sanitize(error instanceof Error ? error.message : String(error));
}

/** A new radio, idle, reading radio.json and watching it until it is disposed. */
function createRadio(): RadioControl {
	/** The env of the pi-crt instance that shows the radio; undefined between two sessions and after dispose. */
	let env: FeatureEnv | undefined;
	const data: RadioData = {
		version: 0,
		stations: [],
		status: "idle",
		queue: [],
		volume: 1,
		playedFrames: 0,
		levels: [],
		levelsFrom: 0,
		search: { query: "", results: [], playlists: [], loading: false },
		outputs: { devices: [], loading: false },
	};
	/** `data` changed: a new version, drawn again when the radio is on screen. */
	const changed = () => {
		if (env) env.changed(data);
		else data.version++;
	};
	let client: Ytdl | undefined;
	const ytdl = async () => {
		const loaded = await loadPackages();
		client ??= new loaded.Ytdl();
		return { client, loaded };
	};

	/* ------------------------------------------------------------ playback */

	/** Aborts the current source's track downloads, queue refills and retries; a new one per source. */
	let session = new AbortController();
	/** Track IDs this source played, so that a radio refill does not repeat them. */
	let played = new Set<string>();
	/** A playlist's tracks; each pass plays them shuffled. */
	let pass: Track[] = [];
	/** The track this source started last, which a radio refill goes on from. */
	let last: Track | undefined;
	/** The refill under way, which the next track waits for instead of starting another. */
	let refilling: Promise<void> | undefined;
	/** Ends the current track's download, when another track or source replaces it. */
	let endTrack: (() => void) | undefined;
	/** Queues the current track's unplayed PCM again: on the device now picked, or at the volume now set. */
	let requeueTrack: ((reopen: boolean) => void) | undefined;
	/** The device the source plays on, from its first track until it stops or another device is picked. */
	let output: Sdl.Audio.AudioPlaybackInstance | undefined;
	/** The device picked on the OUTPUT page; null plays on the system's default. */
	let picked: string | null = null;

	/** Open the picked device, or the default when the picked one is gone, for 48 kHz stereo 16-bit PCM. */
	const openOutput = (audio: Sdl.Audio.Module): Sdl.Audio.AudioPlaybackInstance => {
		if (picked !== null && !outputDevices(audio).some((device) => device.name === picked)) picked = null;
		const device: Sdl.Audio.PlaybackDevice = picked === null ? { type: "playback" } : { type: "playback", name: picked };
		const opened = audio.openDevice(device, { channels: CHANNELS, frequency: SAMPLE_RATE, format: "s16" });
		opened.play();
		return opened;
	};
	/** What trying again after an error does: start the source again until its tracks are found, then the next track. */
	let retry: () => void = () => {};
	let retryTimer: ReturnType<typeof setTimeout> | undefined;

	/** Where the track is, as NOW PLAYING shows it (time and waveform): back to before its start. */
	const clearPosition = () => {
		data.playedFrames = 0;
		data.levels = [];
		data.levelsFrom = 0;
		data.heard = undefined;
	};

	/** Stop the current track: its download and its sound. */
	const dropTrack = () => {
		endTrack?.();
		endTrack = undefined;
		requeueTrack = undefined;
	};

	const closeOutput = () => {
		if (output && !output.closed) output.close();
		output = undefined;
	};

	/** Stop the sound and drop the source. */
	const halt = () => {
		session.abort();
		session = new AbortController();
		refilling = undefined;
		clearTimeout(retryTimer);
		retryTimer = undefined;
		dropTrack();
		closeOutput();
		data.status = "idle";
		data.error = undefined;
		data.source = undefined;
		data.track = undefined;
		data.queue = [];
		data.position = undefined;
		clearPosition();
		changed();
	};

	/**
	 * Stop the track and show why, with the track when the error is that track's, so
	 * that NOW PLAYING can say what failed; then try again after RETRY_MS. The source
	 * keeps its queue.
	 */
	const fail = (error: unknown, track?: Track) => {
		dropTrack();
		data.status = "error";
		data.error = messageOf(error);
		data.track = track;
		clearPosition();
		clearTimeout(retryTimer);
		const signal = session.signal;
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			if (!signal.aborted) retry();
		}, RETRY_MS);
		retryTimer.unref?.();
		changed();
	};

	/** Tracks to play after the queue runs out, for the current source. */
	const refill = async (signal: AbortSignal): Promise<Track[]> => {
		const source = data.source;
		if (!source) return [];
		if (source.kind === "playlist" || (source.kind === "station" && "playlist" in source.station)) {
			// Another pass over the same playlist, shuffled again, not starting with the track played last.
			const again = shuffled(pass);
			if (again.length > 1 && again[0]!.id === last?.id) again.push(again.shift()!);
			return again;
		}
		const seed = source.kind === "song" ? source.seed.id : played.values().next().value;
		if (!last || !seed) return [];
		const { client } = await ytdl();
		const related = await client.getRelated(last.id, { music: true, radioSeed: seed, signal });
		return related.map(toTrack).filter((track) => !played.has(track.id));
	};

	/** Add the tracks after the queue to it; a refill under way is shared, not started twice. */
	const fill = (signal: AbortSignal): Promise<void> => {
		refilling ??= refill(signal)
			.then((tracks) => {
				if (signal.aborted) return;
				data.queue.push(...tracks);
				changed();
			})
			.finally(() => {
				if (!signal.aborted) refilling = undefined;
			});
		return refilling;
	};

	/** Play the queue's next track, refilling the queue first when it is empty. */
	const advance = async () => {
		const signal = session.signal;
		// Tuning until the next track's first write played: `n` waits for it.
		data.status = "tuning";
		data.error = undefined;
		changed();
		try {
			if (!data.queue.length) await fill(signal);
			if (signal.aborted) return;
			const track = data.queue.shift();
			if (!track) throw new Error("no more songs on this station");
			if (data.position) data.position = { ...data.position, index: (data.position.index % data.position.total) + 1 };
			try {
				await playTrack(track, signal);
			} catch (error) {
				if (!signal.aborted) fail(error, track);
				return;
			}
			if (signal.aborted) return;
			// Fetch what comes next while this track plays, so that NEXT can show it. A
			// failure here is left to the refill when the track ends.
			if (!data.queue.length) await fill(signal).catch(() => {});
		} catch (error) {
			if (!signal.aborted) fail(error);
		}
	};

	/** Download, decode and queue one track; the next one starts when its last PCM played. */
	const playTrack = async (track: Track, signal: AbortSignal) => {
		played.add(track.id);
		last = track;
		data.track = track;
		data.status = "tuning";
		data.error = undefined;
		clearPosition();
		changed();
		const { client, loaded } = await ytdl();
		if (signal.aborted) return;
		/** The decoded packets not all played yet, oldest first, at full volume. */
		const waiting: Buffer[] = [];
		let waitingBytes = 0;
		/** Frames of silence the device played within this track while the queue was dry. */
		let silentFrames = 0;
		/** What the device plays (PCM or silence, bytes) past the last whole level. */
		let unleveled: Buffer = Buffer.alloc(0);
		/** Add the levels of `pcm` (at full volume), what the device plays next, one per LEVEL_FRAMES. */
		const addLevels = (pcm: Buffer) => {
			let rest = unleveled.length ? Buffer.concat([unleveled, pcm]) : pcm;
			const size = LEVEL_FRAMES * FRAME_BYTES;
			for (; rest.length >= size; rest = rest.subarray(size)) data.levels.push(level(rest.subarray(0, size)));
			unleveled = rest;
		};
		/** Add the levels of `frames` of silence, what the device plays next: whole levels of it are 0. */
		const addSilence = (frames: number) => {
			const size = LEVEL_FRAMES * FRAME_BYTES;
			let bytes = frames * FRAME_BYTES;
			// First what fills the level begun, if any.
			const rest = Math.min(bytes, (size - unleveled.length) % size);
			if (rest) addLevels(Buffer.alloc(rest));
			bytes -= rest;
			if (!bytes) return;
			for (; bytes >= size; bytes -= size) data.levels.push(0);
			unleveled = Buffer.alloc(bytes);
		};
		/** Frames of what the device plays for this track (its PCM and silences) SDL took, with `unplayed` bytes still queued. */
		const takenFrames = (unplayed: number) => data.playedFrames + silentFrames + (waitingBytes - unplayed) / FRAME_BYTES;
		let ended = false;
		const decoder = new loaded.audify.OpusDecoder(SAMPLE_RATE, CHANNELS);
		if (!output || output.closed) output = openOutput(loaded.audio);
		/** The device the track plays on now; one that closed is an error. */
		const device = () => {
			if (!output || output.closed) throw new Error("audio device: closed");
			return output;
		};
		const download = client.download(track.id, { filter: OPUS_FILTER, signal });
		const demuxer = new loaded.WebmDemuxer();
		/** Read how much SDL took: drop the packets it took whole and count their frames; drop old levels; set where it is heard. */
		const pump = () => {
			if (endTrack !== finish) return;
			let unplayed: number;
			try {
				unplayed = device().queued;
			} catch (error) {
				fail(error, track);
				return;
			}
			while (waiting.length && waitingBytes - waiting[0]!.length >= unplayed) {
				const packet = waiting.shift()!;
				waitingBytes -= packet.length;
				data.playedFrames += packet.length / FRAME_BYTES;
			}
			const old = Math.floor((data.playedFrames + silentFrames - data.levelsFrom) / LEVEL_FRAMES) - levelHistory();
			if (old > 0) {
				data.levels.splice(0, old);
				data.levelsFrom += old * LEVEL_FRAMES;
			}
			// Where the track is heard: SDL is taken to play what it took about a device
			// buffer later. It takes a buffer at a time and the queue is read only every
			// PUMP_MS, so the clock goes on at the sample rate and is set again only when it
			// leaves a range that allows for that: two buffers behind, a quarter of one
			// ahead. While the queue is dry nothing is taken, and the clock goes on as the
			// silence plays.
			const taken = takenFrames(unplayed);
			if (taken > 0) {
				const now = Date.now();
				const buffered = device().buffered;
				const heard = data.heard;
				if (!heard) data.heard = { frames: taken - buffered, at: now };
				else if (unplayed > 0) {
					const predicted = heardFrames(heard, now);
					const low = taken - 2 * buffered;
					const high = taken + buffered / 4;
					if (predicted < low || predicted > high) data.heard = { frames: Math.min(high, Math.max(low, predicted)), at: now };
				}
			}
			if (data.status === "tuning" && unplayed < waitingBytes) {
				data.status = "playing";
				changed();
			}
			if (demuxer.isPaused() && unplayed <= QUEUE_LOW * SAMPLE_RATE * FRAME_BYTES) demuxer.resume();
			if (ended && unplayed === 0) skip();
		};
		const timer = setInterval(pump, PUMP_MS);
		timer.unref?.();
		const finish = () => {
			clearInterval(timer);
			download.destroy();
			demuxer.destroy();
			// The device stays open for the next track; what this one left unplayed goes.
			if (output && !output.closed) output.clearQueue();
			signal.removeEventListener("abort", finish);
		};
		endTrack = finish;
		signal.addEventListener("abort", finish);
		requeueTrack = (reopen) => {
			const current = device();
			// What SDL has not played yet is the tail of `waiting`. It is made at the volume
			// now set before the queue is cleared, so that SDL does not run out of PCM
			// meanwhile. SDL's own short buffer past its queue may play again or be
			// skipped around a device switch.
			let tail = atVolume(Buffer.concat(waiting).subarray(waitingBytes - current.queued), data.volume);
			let target = current;
			if (reopen) {
				current.close();
				target = output = openOutput(loaded.audio);
			} else {
				// SDL went on playing while the tail was made: queue only what it has not played.
				tail = tail.subarray(tail.length - current.queued);
				current.clearQueue();
			}
			if (tail.length) target.enqueue(tail);
		};
		const failTrack = (error: unknown) => {
			if (!signal.aborted && endTrack === finish) fail(error, track);
		};
		download.on("error", failTrack);
		demuxer.on("error", failTrack);
		demuxer.on("data", (packet: Buffer) => {
			if (endTrack !== finish) return;
			try {
				const pcm = decoder.decode(packet, MAX_PACKET);
				const heard = data.heard;
				if (heard && device().queued === 0) {
					// The queue ran dry: the device played silence until this PCM, which is
					// heard about a device buffer after SDL takes it; the clock went on.
					const silence = Math.max(0, Math.round(heardFrames(heard, Date.now()) + device().buffered - takenFrames(0)));
					silentFrames += silence;
					addSilence(silence);
				}
				addLevels(pcm);
				waiting.push(pcm);
				waitingBytes += pcm.length;
				device().enqueue(atVolume(pcm, data.volume));
			} catch (error) {
				failTrack(error);
				return;
			}
			if (device().queued >= QUEUE_HIGH * SAMPLE_RATE * FRAME_BYTES) demuxer.pause();
		});
		demuxer.on("end", () => {
			if (endTrack !== finish) return;
			ended = true;
		});
		download.pipe(demuxer);
	};

	/** Start a source: drop what plays, then play the tracks `start` finds. */
	const begin = (source: Source, start: (signal: AbortSignal) => Promise<{ queue: Track[]; pass?: Track[] }>) => {
		halt();
		data.source = source;
		played = new Set();
		pass = [];
		last = undefined;
		const signal = session.signal;
		const run = async () => {
			data.status = "tuning";
			data.error = undefined;
			changed();
			try {
				const found = await start(signal);
				if (signal.aborted) return;
				data.queue = found.queue;
				if (found.pass) {
					pass = found.pass;
					data.position = { index: 0, total: pass.length };
				}
				retry = () => void advance();
				await advance();
			} catch (error) {
				if (!signal.aborted) fail(error);
			}
		};
		retry = () => void run();
		void run();
	};

	/** Find a playlist's tracks: the queue, shuffled, and the pass each later pass shuffles again. */
	const playlistTracks = async (id: string, signal: AbortSignal) => {
		const { client } = await ytdl();
		const list = await client.getPlaylist(id, { signal });
		const tracks = list.videos.map(toTrack);
		if (!tracks.length) throw new Error("the playlist has no playable songs");
		return { queue: shuffled(tracks), pass: tracks };
	};

	const playStation = (index: number) => {
		const station = data.stations[index];
		if (!station) return;
		begin({ kind: "station", station }, async (signal) => {
			if ("playlist" in station) return playlistTracks(station.playlist, signal);
			const { client, loaded } = await ytdl();
			const [song] = await client.search(station.query, { type: loaded.SearchType.Song, limit: 1, signal });
			if (!song) throw new Error(`no song found for "${station.query}"`);
			return { queue: [toTrack(song)] };
		});
	};

	const playSong = (track: Track) => {
		begin({ kind: "song", seed: track }, async () => ({ queue: [track] }));
	};

	const playPlaylist = (playlist: Playlist) => {
		begin({ kind: "playlist", playlist }, (signal) => playlistTracks(playlist.id, signal));
	};

	/** Go on to the queue's next track. */
	const skip = () => {
		dropTrack();
		void advance();
	};

	/** `n`: skip the track playing. Ignored while one is being looked up or loaded (tuning). */
	const next = () => {
		if (data.status === "playing") skip();
	};

	const setVolume = (volume: number) => {
		const next = Math.round(Math.max(0, Math.min(1, volume)) * 10) / 10;
		if (next === data.volume) return;
		data.volume = next;
		requeue(false);
		changed();
	};

	/* ------------------------------------------------------------ search */

	let searchAbort: AbortController | undefined;
	const search = (query: string) => {
		const text = query.trim();
		searchAbort?.abort();
		data.search = { query: text, results: [], playlists: [], loading: text !== "" };
		changed();
		if (!text) return;
		const abort = new AbortController();
		searchAbort = abort;
		const signal = abort.signal;
		void (async () => {
			try {
				const { client, loaded } = await ytdl();
				const [songs, lists] = await Promise.allSettled([
					client.search(text, { type: loaded.SearchType.Song, limit: SEARCH_LIMIT, signal }),
					client.search(text, { type: loaded.SearchType.Playlist, limit: PLAYLIST_LIMIT, signal }),
				]);
				if (signal.aborted) return;
				const failed = songs.status === "rejected" ? songs : lists.status === "rejected" ? lists : undefined;
				data.search = {
					query: text,
					results: songs.status === "fulfilled" ? songs.value.map(toTrack) : [],
					playlists: lists.status === "fulfilled" ? lists.value.map(toPlaylist) : [],
					loading: false,
					error: failed && messageOf(failed.reason),
				};
			} catch (error) {
				if (signal.aborted) return;
				data.search = { query: text, results: [], playlists: [], loading: false, error: messageOf(error) };
			}
			changed();
		})();
	};

	/* ------------------------------------------------------------ output devices */

	/** Queue the unplayed PCM again, on a newly opened device or at the volume now set. */
	const requeue = (reopen: boolean) => {
		const track = data.track;
		try {
			requeueTrack?.(reopen);
		} catch (error) {
			fail(error, track);
		}
	};

	/** Move the track playing to the output device now picked. */
	const moveOutput = () => {
		if (requeueTrack) requeue(true);
		// No track plays: the next one opens the device now picked.
		else closeOutput();
	};

	const pickOutputDevice = (device: OutputDevice) => {
		if (device.name === picked) return;
		picked = device.name;
		moveOutput();
		changed();
	};

	/** List the output devices again; the OUTPUT page does so whenever it comes on screen. */
	const listOutputs = () => {
		data.outputs = { ...data.outputs, loading: true, error: undefined };
		changed();
		void (async () => {
			try {
				data.outputs = { devices: outputDevices((await loadPackages()).audio), loading: false };
			} catch (error) {
				data.outputs = { devices: data.outputs.devices, loading: false, error: messageOf(error) };
			}
			changed();
		})();
	};

	/* ------------------------------------------------------------ stations */

	const readStations = () => {
		let text: string;
		try {
			text = readFileSync(STATIONS_FILE, "utf8");
		} catch (error) {
			data.stationsError = `radio.json: ${messageOf(error)}`;
			changed();
			return;
		}
		try {
			data.stations = parseStations(text);
			data.stationsError = undefined;
		} catch (error) {
			// Keep the last list that could be used, so that saving a half-edited file
			// does not stop the music.
			data.stationsError = `radio.json: ${messageOf(error)}`;
			changed();
			return;
		}
		const source = data.source;
		if (source?.kind === "station") {
			const station = data.stations.find((item) => stationKey(item) === stationKey(source.station));
			if (!station) {
				halt();
				return;
			}
			// A renamed station keeps playing under its new name.
			source.station = station;
		}
		changed();
	};

	/**
	 * Change radio.json. `edit` gets the stations as the file has them now, not as
	 * last read, both as parsed and as written (other fields kept), and changes the
	 * written ones; it returns whether it changed them. A file that cannot be used is
	 * left alone. The file is read again at once, without waiting for its watcher.
	 * Returns whether the file is as `edit` wants it.
	 */
	const editStations = (edit: (stations: Station[], items: unknown[]) => boolean): boolean => {
		try {
			const text = readFileSync(STATIONS_FILE, "utf8");
			// The entries as parseStations keeps them: a file written goes without the others.
			const entries = parseEntries(text);
			const first = firstOfEach(entries);
			const stations = entries.filter((_, index) => first[index]);
			const items = (JSON.parse(text) as unknown[]).filter((_, index) => first[index]);
			if (edit(stations, items)) writeFileSync(STATIONS_FILE, `${JSON.stringify(items, null, 2)}\n`);
			data.saveError = undefined;
		} catch (error) {
			data.saveError = `radio.json: ${messageOf(error)}`;
			changed();
			return false;
		}
		readStations();
		return true;
	};

	const addPlaylistStation = (playlist: Playlist) => {
		const station: Station = { name: playlist.title.trim() || playlist.id, playlist: playlist.id };
		const saved = editStations((stations, items) => {
			if (stations.some((item) => stationKey(item) === stationKey(station))) return false;
			items.push(station);
			return true;
		});
		// The playlist playing is now a station: STATIONS shows it playing, and removing it stops it.
		const source = data.source;
		const added = data.stations.find((item) => stationKey(item) === stationKey(station));
		if (saved && added && source?.kind === "playlist" && source.playlist.id === playlist.id) {
			data.source = { kind: "station", station: added };
			changed();
		}
	};

	const removeStationFromFile = (station: Station) => {
		editStations((stations, items) => {
			// The station by its source; of two with the same source, the one with its name.
			// It may have been renamed since the list was read.
			const same = (item: Station) => stationKey(item) === stationKey(station);
			let at = stations.findIndex((item) => same(item) && item.name === station.name);
			if (at < 0) at = stations.findIndex(same);
			if (at < 0) return false;
			items.splice(at, 1);
			return true;
		});
	};

	const onFileChange = () => readStations();
	readStations();
	watchFile(STATIONS_FILE, { interval: 1000, persistent: false }, onFileChange);

	return {
		data,
		playStation,
		playSong,
		playPlaylist,
		addPlaylist: addPlaylistStation,
		removeStation: removeStationFromFile,
		stop: () => halt(),
		next,
		setVolume,
		search,
		playsOn: (device) => device.name === picked,
		pickOutput: pickOutputDevice,
		listOutputs,
		show: (shownOn) => {
			env = shownOn;
			// The search box belongs to the screen (panels/radio.ts); what it searched for
			// goes with it, and so does why the last station added or removed could not be
			// saved: a new screen starts without them.
			searchAbort?.abort();
			data.search = { query: "", results: [], playlists: [], loading: false };
			data.saveError = undefined;
			changed();
		},
		dispose: () => {
			// The screen first, so that stopping does not draw on a screen that is gone.
			env = undefined;
			unwatchFile(STATIONS_FILE, onFileChange);
			searchAbort?.abort();
			halt();
		},
	};
}

/**
 * RADIO for one pi-crt instance. The instance on screen shows the process's radio
 * (see RADIO) from its session_start, making it when there is none. At its shutdown
 * a session switch hands the radio on, still playing, to the next session's
 * instance; /reload and quit dispose of it. A subagent's session never shows it, so
 * it never stops it either.
 */
export function setupRadio(pi: ExtensionAPI, env: FeatureEnv): void {
	/** The radio this instance shows, from its session_start until its shutdown. */
	let radio: RadioControl | undefined;
	let outputShown = false;
	env.onShownChange(() => {
		const shown = env.shows(RADIO_OUTPUT_PANEL);
		if (shown && !outputShown) radio?.listOutputs();
		outputShown = shown;
	});

	pi.on("session_start", (event, ctx) => {
		// Only a session on screen has the RADIO tab.
		if (ctx.mode !== "tui" || !ctx.hasUI || radio) return;
		// A reload starts its new code with a new radio, even when a session switch that
		// failed after its shutdown left one behind, shown by nobody.
		if (event.reason === "reload") {
			shared[RADIO]?.dispose();
			delete shared[RADIO];
		}
		radio = shared[RADIO] ??= createRadio();
		radios.set(env.state, radio);
		radio.show(env);
	});

	pi.on("session_shutdown", (event) => {
		if (!radio) return;
		radios.delete(env.state);
		if (event.reason === "new" || event.reason === "resume" || event.reason === "fork") radio.show(undefined);
		else {
			radio.dispose();
			delete shared[RADIO];
		}
		radio = undefined;
	});
}

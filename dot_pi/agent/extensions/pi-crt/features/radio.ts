/**
 * RADIO: YouTube Music played inside Pi's process, without yt-dlp or a player
 * program. ytdl-core fetches a track's audio (WebM with Opus), prism-media's
 * WebmDemuxer takes the Opus packets out of it, audify's OpusDecoder turns each
 * packet into PCM, and SDL (@kmamal/sdl) plays the PCM on an output device through
 * the audio driver SDL picks, which mixes and resamples it like any other program.
 *
 * The device is the system's default (SDL follows it when it changes) until one is
 * picked on the OUTPUT page; the pick lasts until pi-crt is loaded again and is not
 * saved. Picking another device, or another volume, while a track plays queues the
 * PCM not yet played again, so the track goes on.
 *
 * Stations come from radio.json next to index.ts and are read again whenever the
 * file changes. A station with `playlist` plays that playlist shuffled, shuffling
 * again after each pass; one with `query` plays the YouTube Music radio of the
 * first song the query finds. A song picked on the SEARCH page plays its radio too.
 *
 * One radio plays per process: starting one stops any other pi-crt instance's.
 * Playback stops when its pi-crt instance shuts down (/reload, quit, a session
 * switch), when the station playing is removed from radio.json, and on an error,
 * which NOW PLAYING shows. Only the PCM queued for the device is kept: the
 * download pauses once QUEUE_HIGH seconds wait and resumes at QUEUE_LOW.
 *
 * The three packages are loaded on first use, so that pi-crt's other tabs still
 * load when they are missing or fail to load (a failed npm install, a Node.js
 * version they do not support); RADIO then shows why.
 */
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Ytdl } from "@distube/ytdl-core";
import type { Sdl } from "@kmamal/sdl";
import { type CrtState, sanitize } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

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
 * Levels kept of the packets played last, for the waveform. It draws two per cell
 * and is never wider than the terminal, so two per terminal column fill it at any
 * width; at least 4 s of 20 ms packets when the width is not known.
 */
function levelHistory(): number {
	return Math.max(200, (process.stdout.columns ?? 0) * 2);
}
/** How often the queue is read while a track plays: the played position, the levels, the end. */
const PUMP_MS = 40;
/** How often NOW PLAYING is drawn again while it moves. */
const DRAW_MS = 120;
/** Songs a search shows. */
const SEARCH_LIMIT = 20;
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

/** What is playing: a station from radio.json, or the radio of a song found on SEARCH. */
export type Source = { kind: "station"; station: Station } | { kind: "song"; seed: Track };

export interface SearchData {
	query: string;
	results: Track[];
	loading: boolean;
	error?: string;
}

export interface RadioData {
	/** Bumped on every change but the playing position and levels. */
	version: number;
	stations: Station[];
	/** Why radio.json could not be used; `stations` is then the last list that could. */
	stationsError?: string;
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
	/** Frames of the current track played so far. */
	playedFrames: number;
	/** RMS levels (0 to 1) of the writes played last, oldest first. */
	levels: number[];
	search: SearchData;
	/** The output devices, listed again whenever the OUTPUT page comes on screen. */
	outputs: OutputsData;
}

interface RadioControl {
	data: RadioData;
	playStation(index: number): void;
	playSong(track: Track): void;
	stop(): void;
	next(): void;
	setVolume(volume: number): void;
	search(query: string): void;
	/** Move the track playing to the output device now picked. */
	moveOutput(): void;
	/** Draw the panels again. */
	refresh(): void;
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

/** The device picked on the OUTPUT page; null plays on the system's default. */
let pickedDevice: string | null = null;

/** The output devices SDL sees now, after SYSTEM_DEFAULT. */
function outputDevices(audio: Sdl.Audio.Module): OutputDevice[] {
	const named = audio.devices.filter((device) => device.type === "playback" && device.name);
	return [SYSTEM_DEFAULT, ...named.map((device) => ({ name: device.name!, label: sanitize(device.name!) }))];
}

/** Open the picked device, or the default when the picked one is gone, for 48 kHz stereo 16-bit PCM. */
function openOutput(audio: Sdl.Audio.Module): Sdl.Audio.AudioPlaybackInstance {
	if (pickedDevice !== null && !outputDevices(audio).some((device) => device.name === pickedDevice)) pickedDevice = null;
	const device: Sdl.Audio.PlaybackDevice = pickedDevice === null ? { type: "playback" } : { type: "playback", name: pickedDevice };
	const output = audio.openDevice(device, { channels: CHANNELS, frequency: SAMPLE_RATE, format: "s16" });
	output.play();
	return output;
}

/** PCM at a volume of 0 to 1, on the same logarithmic scale as before: 0.3 gives about 11% of the amplitude. */
function atVolume(pcm: Buffer, volume: number): Buffer {
	const gain = (10 ** volume - 1) / 9;
	if (gain >= 1) return pcm;
	const out = Buffer.allocUnsafe(pcm.length);
	for (let offset = 0; offset + 1 < pcm.length; offset += 2) out.writeInt16LE(Math.round(pcm.readInt16LE(offset) * gain), offset);
	return out;
}

/** The radio that plays now, of any pi-crt instance in this process. */
let playing: RadioControl | undefined;

/* ------------------------------------------------------------ for the panels */

/** Each pi-crt instance's radio, by its CrtState (see FeatureEnv). */
const radios = new WeakMap<CrtState, RadioControl>();

const NONE: RadioData = Object.freeze({
	version: 0,
	stations: [],
	status: "idle",
	queue: [],
	volume: 1,
	playedFrames: 0,
	levels: [],
	search: { query: "", results: [], loading: false },
	outputs: { devices: [], loading: false },
}) as RadioData;

export function radioData(state: CrtState): Readonly<RadioData> {
	return radios.get(state)?.data ?? NONE;
}

/** What makes two stations the same, whatever their names. */
export function stationKey(station: Station): string {
	return "playlist" in station ? `playlist:${station.playlist}` : `query:${station.query}`;
}

/** Whether `station` is playing (or tuning in); a station that failed is not. */
export function playsStation(data: Readonly<RadioData>, station: Station): boolean {
	const source = data.source;
	return source?.kind === "station" && stationKey(source.station) === stationKey(station) && data.status !== "error";
}

/** Whether the radio of `track` is playing (or tuning in); one that failed is not. */
export function playsSong(data: Readonly<RadioData>, track: Track): boolean {
	const source = data.source;
	return source?.kind === "song" && source.seed.id === track.id && data.status !== "error";
}

/** Seconds of the current track played. */
export function playedSeconds(data: Readonly<RadioData>): number {
	return data.playedFrames / SAMPLE_RATE;
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
	return device.name === pickedDevice;
}

/** Play on `device` from now on, moving the track playing to it. */
export function pickOutput(state: CrtState, device: OutputDevice): void {
	const radio = radios.get(state);
	if (!radio || playsOn(device)) return;
	pickedDevice = device.name;
	playing?.moveOutput();
	radio.refresh();
}

/** The stations in radio.json, or why they cannot be used. */
export function parseStations(text: string): Station[] {
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

function messageOf(error: unknown): string {
	return sanitize(error instanceof Error ? error.message : String(error));
}

export function setupRadio(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: RadioData = {
		version: 0,
		stations: [],
		status: "idle",
		queue: [],
		volume: 1,
		playedFrames: 0,
		levels: [],
		search: { query: "", results: [], loading: false },
		outputs: { devices: [], loading: false },
	};
	let client: Ytdl | undefined;
	const ytdl = async () => {
		const loaded = await loadPackages();
		client ??= new loaded.Ytdl();
		return { client, loaded };
	};

	const changed = () => {
		data.version++;
		env.requestRender();
	};

	/* ------------------------------------------------------------ playback */

	/** Aborts the current source's track downloads and queue refills; a new one per source. */
	let session = new AbortController();
	let drawTimer: ReturnType<typeof setInterval> | undefined;
	/** Track IDs this source played, so that a radio refill does not repeat them. */
	let played = new Set<string>();
	/** A playlist station's tracks; each pass plays them shuffled. */
	let pass: Track[] = [];
	/** The refill under way, which the next track waits for instead of starting another. */
	let refilling: Promise<void> | undefined;
	/** Ends the current track's download, when another track or source replaces it. */
	let endTrack: (() => void) | undefined;
	/** Queues the current track's unplayed PCM again: on the device now picked, or at the volume now set. */
	let requeueTrack: ((reopen: boolean) => void) | undefined;

	const startDrawing = () => {
		if (drawTimer) return;
		drawTimer = setInterval(() => {
			if (env.shows("nowplaying")) env.requestRender();
		}, DRAW_MS);
		drawTimer.unref?.();
	};

	const stopDrawing = () => {
		if (drawTimer) clearInterval(drawTimer);
		drawTimer = undefined;
	};

	/** Stop the current track: its download and its sound. */
	const dropTrack = () => {
		endTrack?.();
		endTrack = undefined;
		requeueTrack = undefined;
	};

	/**
	 * Stop the sound and drop what plays. With an error, keep the source, and the
	 * track when the error is that track's, so that NOW PLAYING can say what failed.
	 */
	const halt = (error?: string, failed?: Track) => {
		session.abort();
		session = new AbortController();
		refilling = undefined;
		dropTrack();
		if (playing === control) playing = undefined;
		stopDrawing();
		data.status = error === undefined ? "idle" : "error";
		data.error = error;
		if (error === undefined) data.source = undefined;
		data.track = failed;
		data.queue = [];
		data.position = undefined;
		data.playedFrames = 0;
		data.levels = [];
		changed();
	};

	const fail = (error: unknown, track?: Track) => halt(messageOf(error), track);

	/** Tracks to play after the queue runs out, for the current source. */
	const refill = async (signal: AbortSignal): Promise<Track[]> => {
		const source = data.source;
		if (!source) return [];
		if (source.kind === "station" && "playlist" in source.station) {
			// Another pass over the same playlist, shuffled again, not starting with the track playing.
			const again = shuffled(pass);
			if (again.length > 1 && again[0]!.id === data.track?.id) again.push(again.shift()!);
			return again;
		}
		const last = data.track;
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
		data.track = track;
		data.status = "tuning";
		data.error = undefined;
		data.playedFrames = 0;
		changed();
		startDrawing();
		const { client, loaded } = await ytdl();
		if (signal.aborted) return;
		/** The decoded packets not all played yet, oldest first, at full volume; and their levels. */
		const waiting: Buffer[] = [];
		const levels: number[] = [];
		let waitingBytes = 0;
		let ended = false;
		const decoder = new loaded.audify.OpusDecoder(SAMPLE_RATE, CHANNELS);
		const download = client.download(track.id, { filter: OPUS_FILTER, signal });
		const demuxer = new loaded.WebmDemuxer();
		let output = openOutput(loaded.audio);
		/** Read how much SDL played: drop the packets it finished, count their frames, keep their levels. */
		const pump = () => {
			if (endTrack !== finish) return;
			if (output.closed) {
				fail(new Error("audio device: closed"), track);
				return;
			}
			const unplayed = output.queued;
			while (waiting.length && waitingBytes - waiting[0]!.length >= unplayed) {
				const packet = waiting.shift()!;
				waitingBytes -= packet.length;
				data.playedFrames += packet.length / FRAME_BYTES;
				data.levels.push(levels.shift() ?? 0);
				const keep = levelHistory();
				if (data.levels.length > keep) data.levels.splice(0, data.levels.length - keep);
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
			if (!output.closed) output.close();
			signal.removeEventListener("abort", finish);
		};
		endTrack = finish;
		signal.addEventListener("abort", finish);
		requeueTrack = (reopen) => {
			// What SDL has not played yet is the tail of `waiting`. SDL's own short buffer
			// past its queue may play again or be skipped around the switch.
			const unplayed = output.queued;
			const tail = Buffer.concat(waiting).subarray(waitingBytes - unplayed);
			if (reopen) {
				if (!output.closed) output.close();
				output = openOutput(loaded.audio);
			} else output.clearQueue();
			output.enqueue(atVolume(tail, data.volume));
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
				waiting.push(pcm);
				levels.push(level(pcm));
				waitingBytes += pcm.length;
				output.enqueue(atVolume(pcm, data.volume));
			} catch (error) {
				failTrack(error);
				return;
			}
			if (output.queued >= QUEUE_HIGH * SAMPLE_RATE * FRAME_BYTES) demuxer.pause();
		});
		demuxer.on("end", () => {
			if (endTrack !== finish) return;
			ended = true;
		});
		download.pipe(demuxer);
	};

	/** Start a source: drop what plays, then play the tracks `start` finds. */
	const begin = (source: Source, start: (signal: AbortSignal) => Promise<{ queue: Track[]; pass?: Track[] }>) => {
		if (playing && playing !== control) playing.stop();
		halt();
		playing = control;
		data.source = source;
		data.status = "tuning";
		played = new Set();
		pass = [];
		changed();
		startDrawing();
		const signal = session.signal;
		void (async () => {
			try {
				const found = await start(signal);
				if (signal.aborted) return;
				data.queue = found.queue;
				if (found.pass) {
					pass = found.pass;
					data.position = { index: 0, total: pass.length };
				}
				await advance();
			} catch (error) {
				if (!signal.aborted) fail(error);
			}
		})();
	};

	const playStation = (index: number) => {
		const station = data.stations[index];
		if (!station) return;
		begin({ kind: "station", station }, async (signal) => {
			const { client, loaded } = await ytdl();
			if ("playlist" in station) {
				const list = await client.getPlaylist(station.playlist, { signal });
				const tracks = list.videos.map(toTrack);
				if (!tracks.length) throw new Error("the playlist has no playable songs");
				return { queue: shuffled(tracks), pass: tracks };
			}
			const [song] = await client.search(station.query, { type: loaded.SearchType.Song, limit: 1, signal });
			if (!song) throw new Error(`no song found for "${station.query}"`);
			return { queue: [toTrack(song)] };
		});
	};

	const playSong = (track: Track) => {
		begin({ kind: "song", seed: track }, async () => ({ queue: [track] }));
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
		data.search = { query: text, results: [], loading: text !== "" };
		changed();
		if (!text) return;
		const abort = new AbortController();
		searchAbort = abort;
		void (async () => {
			try {
				const { client, loaded } = await ytdl();
				const songs = await client.search(text, { type: loaded.SearchType.Song, limit: SEARCH_LIMIT, signal: abort.signal });
				if (abort.signal.aborted) return;
				data.search = { query: text, results: songs.map(toTrack), loading: false };
			} catch (error) {
				if (abort.signal.aborted) return;
				data.search = { query: text, results: [], loading: false, error: messageOf(error) };
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

	const moveOutput = () => requeue(true);

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

	let outputShown = false;
	env.onShownChange(() => {
		const shown = env.shows("radiooutput");
		if (shown && !outputShown) listOutputs();
		outputShown = shown;
	});

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

	let watching = false;
	const onFileChange = () => readStations();

	const control: RadioControl = { data, playStation, playSong, stop: () => halt(), next, setVolume, search, moveOutput, refresh: changed };
	radios.set(env.state, control);

	pi.on("session_start", (_event, ctx) => {
		// Only a session on screen has the RADIO tab.
		if (ctx.mode !== "tui" || !ctx.hasUI || watching) return;
		watching = true;
		readStations();
		watchFile(STATIONS_FILE, { interval: 1000, persistent: false }, onFileChange);
	});

	pi.on("session_shutdown", () => {
		if (watching) unwatchFile(STATIONS_FILE, onFileChange);
		watching = false;
		searchAbort?.abort();
		if (data.source || data.status !== "idle") halt();
	});
}

/**
 * RADIO: YouTube Music played inside Pi's process, without yt-dlp or a player
 * program. ytdl-core fetches a track's audio (WebM with Opus), prism-media's
 * WebmDemuxer takes the Opus packets out of it, audify's OpusDecoder turns each
 * packet into PCM, and audify's RtAudio plays the PCM on the default output device
 * (WASAPI on Windows).
 *
 * Stations come from radio.json next to index.ts and are read again whenever the
 * file changes. A station with `playlist` plays that playlist shuffled, shuffling
 * again after each pass; one with `query` plays the YouTube Music radio of the
 * first song the query finds. A song picked on the SEARCH page plays its radio too.
 *
 * One radio plays per process: starting one stops any other pi-crt instance's.
 * Playback stops when its pi-crt instance shuts down (/reload, quit, a session
 * switch), when the station playing is removed from radio.json, and on an error,
 * which NOW PLAYING shows. Only the frames queued for the device are kept: the
 * download pauses once QUEUE_HIGH writes wait and resumes at QUEUE_LOW.
 *
 * The three packages are loaded on first use, so that pi-crt's other tabs still
 * load when they are missing or fail to load (a failed npm install, a Node.js
 * version they do not support); RADIO then shows why.
 */
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Ytdl } from "@distube/ytdl-core";
import type { RtAudio } from "audify";
import { type CrtState, sanitize } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** The station list. */
export const STATIONS_FILE = fileURLToPath(new URL("../radio.json", import.meta.url));

/** YouTube's Opus audio: 48 kHz stereo. */
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** Frames (one sample per channel) per write asked of the device: one 20 ms Opus packet. */
const FRAME = 960;
/** The largest Opus packet, 120 ms, in frames per channel. */
const MAX_PACKET = 5760;
/** Writes waiting for the device before the download pauses, and when it resumes (10 s and 5 s of 20 ms writes). */
const QUEUE_HIGH = 500;
const QUEUE_LOW = 250;
/** Levels kept of the writes played last, for the waveform: 4 s of 20 ms writes. */
const LEVEL_HISTORY = 200;
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
}

interface RadioControl {
	data: RadioData;
	playStation(index: number): void;
	playSong(track: Track): void;
	stop(): void;
	next(): void;
	setVolume(volume: number): void;
	search(query: string): void;
}

/* ------------------------------------------------------------ packages */

interface Packages {
	Ytdl: typeof import("@distube/ytdl-core").Ytdl;
	SearchType: typeof import("@distube/ytdl-core").SearchType;
	audify: typeof import("audify");
	WebmDemuxer: typeof import("prism-media").opus.WebmDemuxer;
}

let packages: Promise<Packages> | undefined;

/** The packages RADIO plays with, loaded once; a failed load is tried again next time. */
function loadPackages(): Promise<Packages> {
	packages ??= (async () => {
		const [ytdl, audify, prism] = await Promise.all([import("@distube/ytdl-core"), import("audify"), import("prism-media")]);
		// audify and prism-media are CommonJS; their classes are on the default export.
		const audio = (audify as { default?: typeof import("audify") }).default ?? audify;
		const media = (prism as { default?: typeof import("prism-media") }).default ?? prism;
		return { Ytdl: ytdl.Ytdl, SearchType: ytdl.SearchType, audify: audio, WebmDemuxer: media.opus.WebmDemuxer };
	})().catch((error: unknown) => {
		packages = undefined;
		throw error;
	});
	return packages;
}

/* ------------------------------------------------------------ device */

/**
 * The output device, one per loaded module. audify releases the callbacks a
 * stream was opened with only when the same RtAudio opens another stream, not
 * when it closes one, so one RtAudio is kept and opened again for each track.
 */
let rtAudio: RtAudio | undefined;
/** Bumped whenever a stream opens or closes; callbacks of an older stream are ignored. */
let streamGeneration = 0;

interface Stream {
	/** Frames per write. */
	frame: number;
	write(pcm: Buffer): void;
}

/**
 * Open the default output device for one track. `played` runs for each write the
 * device played, `failed` on a device error, both only while this stream is the
 * open one: audify reports from the audio thread later, after a newer stream may
 * have opened.
 */
function openStream(audio: Packages["audify"], volume: number, played: () => void, failed: (message: string) => void): Stream {
	closeStream();
	const generation = ++streamGeneration;
	const api = process.platform === "win32" ? audio.RtAudioApi.WINDOWS_WASAPI : undefined;
	const rt = (rtAudio ??= new audio.RtAudio(api));
	const frame = rt.openStream(
		{ deviceId: rt.getDefaultOutputDevice(), nChannels: CHANNELS, firstChannel: 0 },
		null,
		audio.RtAudioFormat.RTAUDIO_SINT16,
		SAMPLE_RATE,
		FRAME,
		"pi-crt radio",
		null,
		() => {
			if (generation === streamGeneration) played();
		},
		0,
		(_type, message) => {
			if (generation === streamGeneration) failed(message);
		},
	);
	rt.outputVolume = volume;
	rt.start();
	return { frame, write: (pcm) => rt.write(pcm) };
}

function closeStream(): void {
	streamGeneration++;
	const rt = rtAudio;
	if (!rt) return;
	try {
		rt.clearOutputQueue();
		if (rt.isStreamRunning()) rt.stop();
		if (rt.isStreamOpen()) rt.closeStream();
	} catch {
		// The stream is let go either way.
	}
}

function setDeviceVolume(volume: number): void {
	if (rtAudio?.isStreamOpen()) rtAudio.outputVolume = volume;
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

	/** Stop the current track: its download and, while this radio has the device, the sound. */
	const dropTrack = () => {
		endTrack?.();
		endTrack = undefined;
		if (playing === control) closeStream();
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

	/** Download, decode and queue one track; the next one starts when its last write played. */
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
		/** Writes waiting for the device, and their levels in order. */
		let queued = 0;
		const levels: number[] = [];
		let ended = false;
		const decoder = new loaded.audify.OpusDecoder(SAMPLE_RATE, CHANNELS);
		const download = client.download(track.id, { filter: OPUS_FILTER, signal });
		const demuxer = new loaded.WebmDemuxer();
		const finish = () => {
			download.destroy();
			demuxer.destroy();
			signal.removeEventListener("abort", finish);
		};
		endTrack = finish;
		signal.addEventListener("abort", finish);
		const stream = openStream(
			loaded.audify,
			data.volume,
			() => {
				queued = Math.max(0, queued - 1);
				data.playedFrames += stream.frame;
				const value = levels.shift();
				if (value !== undefined) {
					data.levels.push(value);
					if (data.levels.length > LEVEL_HISTORY) data.levels.splice(0, data.levels.length - LEVEL_HISTORY);
				}
				if (data.status === "tuning") {
					data.status = "playing";
					changed();
				}
				if (demuxer.isPaused() && queued <= QUEUE_LOW) demuxer.resume();
				if (ended && queued === 0) skip();
			},
			(message) => fail(new Error(`audio device: ${message}`), track),
		);
		const bytes = stream.frame * CHANNELS * 2;
		let pending: Buffer = Buffer.alloc(0);
		const failTrack = (error: unknown) => {
			if (!signal.aborted && endTrack === finish) fail(error, track);
		};
		download.on("error", failTrack);
		demuxer.on("error", failTrack);
		demuxer.on("data", (packet: Buffer) => {
			if (endTrack !== finish) return;
			try {
				const pcm = decoder.decode(packet, MAX_PACKET);
				pending = pending.length ? Buffer.concat([pending, pcm]) : pcm;
				while (pending.length >= bytes) {
					const frame = pending.subarray(0, bytes);
					levels.push(level(frame));
					stream.write(frame);
					queued++;
					pending = pending.subarray(bytes);
				}
			} catch (error) {
				failTrack(error);
				return;
			}
			if (queued >= QUEUE_HIGH) demuxer.pause();
		});
		demuxer.on("end", () => {
			if (endTrack !== finish) return;
			ended = true;
			// A track too short to fill one write, or one whose writes already played.
			if (queued === 0) skip();
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
		data.volume = Math.round(Math.max(0, Math.min(1, volume)) * 10) / 10;
		if (playing === control) setDeviceVolume(data.volume);
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

	const control: RadioControl = { data, playStation, playSong, stop: () => halt(), next, setVolume, search };
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

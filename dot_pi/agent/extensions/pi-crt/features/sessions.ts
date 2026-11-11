/**
 * MAP › SESSIONS: the sessions of this project.
 *
 * The list is read from the session files themselves, not through
 * SessionManager.list(), which parses every line of every file to count the messages
 * (seconds for a few hundred megabytes). A file is still read through, a megabyte at a
 * time, but few lines are parsed: those up to the first user message (the header is
 * the first), and after it only lines that hold the type of a /name entry, found by
 * searching the bytes, since only the latest name can change the title then. The time
 * and size come from stat, and a file whose size and time did not change is not read
 * again. The format is Pi's docs/session-format.md.
 *
 * The folder is the one /resume lists as the current folder: the session manager's,
 * and only the sessions of this directory when it is not the directory's own folder.
 *
 * A read starts only when the SESSIONS panel is drawn and the list is stale: once when
 * first shown, and again after the session changes, it is named, or the agent finishes
 * a run; once started, it runs to its end. Files are read several at a time in the
 * order of the list, and once MAX_SESSIONS are listed the rest are not read (those
 * already being read are read to their end). While nothing is listed yet,
 * a read shows the list after each file it reads; otherwise it changes the shown list
 * only at its end.
 *
 * Opening a session switches pi to it. switchSession() is only on the context a
 * command receives, not on the one a panel or shortcut gets, so the panel sends the
 * command `/crt-session <path>` through sendUserMessage(); pi runs an extension command
 * before anything reaches the model.
 */

import type { Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TextContent, UserMessage } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type SessionHeader,
	type SessionInfoEntry,
	type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** One session as the panel shows it. */
export interface SessionItem {
	path: string;
	/** The session's name (from /name, --name or an extension), else the start of the first message. */
	title: string;
	/** When the file was last written. */
	modified: Date;
	/** The file's size in bytes. */
	size: number;
	/** The session was forked from another one. */
	forked: boolean;
	/** The session pi is in now. */
	active: boolean;
}

/** Name of the command that switches to a session. */
const COMMAND = "crt-session";
/** Sessions listed at most. */
const MAX_SESSIONS = 200;
/** Files read at the same time. */
const PARALLEL_READS = 10;
/** Bytes read from a file at a time. */
const READ_CHUNK = 1024 * 1024;
/** The type of the header, the first line of a session file. */
const HEADER_ENTRY: SessionHeader["type"] = "session";
/** The type of a message entry. */
const MESSAGE_ENTRY: SessionMessageEntry["type"] = "message";
/** The type of a /name entry. */
const NAME_ENTRY: SessionInfoEntry["type"] = "session_info";
/**
 * NAME_ENTRY as a JSON string, as the file holds it. The same characters inside a
 * message text are written with escaped quotes, so they do not match; a text that is
 * exactly this word does, and readLines parses such a line and passes it over.
 */
const NAME_BYTES = Buffer.from(JSON.stringify(NAME_ENTRY));
const NEWLINE = 0x0a;

interface SessionList {
	sessions: SessionItem[];
	/**
	 * Changes whenever `sessions`, `loading` or `error` changes, except when a read
	 * starts: the panel starts it while it draws, and draws that state itself.
	 */
	version: number;
	loading: boolean;
	/** The list no longer matches the sessions on disk. */
	stale: boolean;
	error?: string;
}

/** What the header of a session file tells. */
interface Header {
	cwd: string;
	forked: boolean;
}

/** What the lines of a session file read so far tell. */
interface LineState {
	/**
	 * From the first valid line: undefined while there is none, null when it is not a
	 * session header (the file is not a session).
	 */
	header?: Header | null;
	/**
	 * The first line that is not blank of the first user message that has text (a
	 * space when it has only blank lines); empty until there is one.
	 */
	firstLine: string;
	/** The latest session name; undefined when none or cleared. */
	name?: string;
}

/** A session file as read at a size and time. */
interface ScannedFile {
	size: number;
	mtimeMs: number;
	/** Undefined or null when the file is not a session. */
	header: Header | null | undefined;
	title: string;
}

interface SessionFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: SessionList;
	/** The files the last finished read found, by path. */
	files: Map<string, ScannedFile>;
}

/** Each pi-crt instance's sessions, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, SessionFeature>();

/** Before setupSessions: nothing read. Never changed. */
const NONE: Readonly<SessionList> = Object.freeze({ sessions: [], version: 0, loading: false, stale: false });

/** The sessions read so far. */
export function sessions(state: CrtState): Readonly<SessionList> {
	return features.get(state)?.data ?? NONE;
}

/**
 * Read the list again when it is stale. Called while the panel is drawn, so the sessions
 * are only read while someone looks at them.
 */
export function refreshSessions(state: CrtState): void {
	const feature = features.get(state);
	if (!feature) return;
	const { data, env } = feature;
	if (!data.stale || data.loading) return;
	const ctx = env.context();
	if (!ctx) return;
	// No version change here: the panel calling this is drawing already and shows the
	// loading state itself. The changes as files are read draw the result.
	data.loading = true;
	data.stale = false;
	data.error = undefined;
	readSessions(feature, ctx.sessionManager)
		.catch((error: unknown) => {
			// The message may hold the folder's path, which can hold any character.
			data.error = sanitize(error instanceof Error ? error.message : String(error));
		})
		.finally(() => {
			data.loading = false;
			env.changed(data);
		});
}

/**
 * Read the session folder into `data.sessions`. A read that starts with nothing listed
 * shows the list after each file; one that starts with a list changes it only at its
 * end, so that a session that stays listed does not drop out of the first MAX_SESSIONS
 * for a while, and lose its selection, because others were read before it.
 */
async function readSessions(feature: SessionFeature, manager: ExtensionContext["sessionManager"]): Promise<void> {
	const { data, env } = feature;
	const cwd = manager.getCwd();
	// As /resume lists the current folder (SessionManager.list): with no folder
	// (--no-session) the default one, and in a folder other than the directory's own,
	// only the sessions of this directory.
	const dir = resolve(manager.getSessionDir() || defaultSessionDir(cwd));
	const onlyCwd = samePath(dir, defaultSessionDir(cwd)) ? undefined : cwd;
	const current = manager.getSessionFile();

	let names: string[];
	try {
		names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		names = [];
	}
	const found = await Promise.all(
		names.map((name) => {
			const path = join(dir, name);
			return stat(path).then(
				(stats) => ({ path, stats }),
				() => undefined,
			);
		}),
	);
	const isCurrent = (path: string): boolean => current !== undefined && samePath(path, current);
	const wanted = (header: Header): boolean => onlyCwd === undefined || (header.cwd !== "" && samePath(header.cwd, onlyCwd));
	const files = found.filter((file) => file !== undefined);
	// The order of the list, and the order the files are read in: the session in
	// progress first, then the most recently touched. So once the list is full, no file
	// after can get into it.
	const rank = (path: string): number => (isCurrent(path) ? Number.POSITIVE_INFINITY : 0);
	files.sort((a, b) => rank(b.path) - rank(a.path) || b.stats.mtimeMs - a.stats.mtimeMs);

	const fromEmpty = data.sessions.length === 0;
	/** The files read so far, by path. A file that could not be read is left out. */
	const results = new Map<string, ScannedFile>();
	/** How many of them the list can show. */
	let listed = 0;
	const itemOf = (path: string, file: ScannedFile): SessionItem | undefined =>
		file.header && wanted(file.header)
			? {
					path,
					title: file.title,
					modified: new Date(file.mtimeMs),
					size: file.size,
					forked: file.header.forked,
					// getSessionFile() may be relative, or differ in case on Windows.
					active: isCurrent(path),
				}
			: undefined;
	const publish = (): void => {
		const items: SessionItem[] = [];
		for (const { path } of files) {
			const file = results.get(path);
			const item = file && itemOf(path, file);
			if (item) items.push(item);
			if (items.length === MAX_SESSIONS) break;
		}
		data.sessions = items;
	};

	let next = 0;
	const reader = async (): Promise<void> => {
		// Files already being read when the list fills up are read to their end.
		while (next < files.length && listed < MAX_SESSIONS) {
			const { path, stats } = files[next++];
			const old = feature.files.get(path);
			const file =
				old && old.size === stats.size && old.mtimeMs === stats.mtimeMs
					? old
					: await scanFile(path, stats, wanted).catch(() => undefined);
			if (!file) continue;
			results.set(path, file);
			if (!itemOf(path, file)) continue;
			listed++;
			if (!fromEmpty) continue;
			publish();
			env.changed(data);
		}
	};
	await Promise.all(Array.from({ length: PARALLEL_READS }, reader));

	feature.files = results;
	publish();
}

/**
 * Read a session file up to its size in `stats`, READ_CHUNK bytes at a time; the
 * complete lines of each piece are handled before the next is read, so only a piece
 * and a line not yet complete are held. Reading stops once the header shows that the
 * file is not a session, or not one `wanted`.
 */
async function scanFile(path: string, stats: Stats, wanted: (header: Header) => boolean): Promise<ScannedFile> {
	const state: LineState = { firstLine: "" };
	const unlisted = (): boolean => state.header === null || (state.header !== undefined && !wanted(state.header));
	let position = 0;
	/** The bytes read after the last newline: a line not yet complete. */
	let pending: Buffer[] = [];
	const handle = await open(path, "r");
	try {
		const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK, Math.max(1, stats.size)));
		while (position < stats.size && !unlisted()) {
			const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, stats.size - position), position);
			if (bytesRead === 0) break;
			position += bytesRead;
			const piece = chunk.subarray(0, bytesRead);
			const newline = piece.lastIndexOf(NEWLINE);
			// Copied, since `chunk` is read into again.
			if (newline < 0) {
				pending.push(Buffer.from(piece));
				continue;
			}
			const complete = piece.subarray(0, newline + 1);
			readLines(state, pending.length ? Buffer.concat([...pending, complete]) : complete);
			pending = [Buffer.from(piece.subarray(newline + 1))];
		}
	} finally {
		await handle.close();
	}
	// A last line without its newline is still being written: Pi ends each line with one.
	// "(no messages)" is what SessionManager.list gave as the first message of such a session.
	const title = titleOf(state.name, state.firstLine || "(no messages)");
	return { size: stats.size, mtimeMs: stats.mtimeMs, header: state.header, title };
}

/**
 * Add what lines tell to `state`: invalid lines are skipped, and the first valid one
 * must be the header. Lines are parsed one by one
 * only until the first user message; after it only the latest /name can change, so
 * the rest is searched from the end for lines holding NAME_BYTES (see there for what
 * this misses).
 */
function readLines(state: LineState, bytes: Buffer): void {
	let position = 0;
	while (position < bytes.length && (state.header === undefined || (state.header && !state.firstLine))) {
		const lineEnd = endOfLine(bytes, position);
		const entry = parseLine(bytes.subarray(position, lineEnd));
		position = lineEnd + 1;
		if (!entry) continue;
		// The fields are read as Pi's types name them, but checked: the file may hold anything.
		if (state.header === undefined) {
			const header = entry as Partial<SessionHeader>;
			state.header =
				header.type === HEADER_ENTRY
					? { cwd: typeof header.cwd === "string" ? header.cwd : "", forked: Boolean(header.parentSession) }
					: null;
		} else if (entry.type === NAME_ENTRY) {
			state.name = nameOf(entry);
		} else if (entry.type === MESSAGE_ENTRY) {
			state.firstLine = firstLineOf(userText((entry as Partial<SessionMessageEntry>).message));
		}
	}
	if (!state.header) return;
	const rest = bytes.subarray(position);
	let from = rest.length;
	while (from > 0) {
		const at = rest.lastIndexOf(NAME_BYTES, from - 1);
		if (at < 0) return;
		const lineStart = rest.lastIndexOf(NEWLINE, at) + 1;
		const entry = parseLine(rest.subarray(lineStart, endOfLine(rest, at)));
		if (entry?.type === NAME_ENTRY) {
			state.name = nameOf(entry);
			return;
		}
		from = lineStart;
	}
}

/** Where the line that holds `position` ends: at its newline, or at the end of `bytes`. */
function endOfLine(bytes: Buffer, position: number): number {
	const end = bytes.indexOf(NEWLINE, position);
	return end < 0 ? bytes.length : end;
}

/** One JSONL line as an object; undefined when it is blank or not a JSON object. */
function parseLine(line: Buffer): Record<string, unknown> | undefined {
	const text = line.toString("utf8");
	if (!text.trim()) return undefined;
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** The name a session_info entry sets; a blank one clears it. */
function nameOf(entry: Record<string, unknown>): string | undefined {
	const { name } = entry as Partial<SessionInfoEntry>;
	return typeof name === "string" ? name.trim() || undefined : undefined;
}

/** LineState.firstLine of a message's text: empty for no text. */
function firstLineOf(text: string): string {
	if (!text) return "";
	return text.split("\n").find((line) => line.trim()) ?? " ";
}

/** The text of a user message, its text blocks joined by spaces; empty for any other message. */
function userText(message: unknown): string {
	// Read as Pi's types name the fields, but checked: the file may hold anything.
	const { role, content } = (message ?? {}) as Partial<UserMessage>;
	if (role !== "user") return "";
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is TextContent => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join(" ");
}

/** The folder Pi keeps a directory's sessions in by default (docs/session-format.md, File Location). */
function defaultSessionDir(cwd: string): string {
	const safePath = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(getAgentDir(), "sessions", safePath);
}

/**
 * Whether two paths name the same place; on Windows, case does not count.
 */
function samePath(a: string, b: string): boolean {
	const key = (path: string): string => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
	return key(a) === key(b);
}

/** Switch to a session. Does nothing for the session already in progress. */
export function openSession(state: CrtState, session: SessionItem): void {
	const pi = features.get(state)?.pi;
	if (!pi || session.active) return;
	// Without the command, the text would go to the model as a message.
	if (!pi.getCommands().some((command) => command.name === COMMAND)) return;
	void pi.sendUserMessage(`/${COMMAND} ${session.path}`, { expandPromptTemplates: true });
}

export function setupSessions(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: SessionList = { sessions: [], version: 0, loading: false, stale: true };
	features.set(env.state, { pi, env, data, files: new Map() });

	const markStale = (): void => {
		data.stale = true;
		env.changed(data);
	};
	pi.on("session_start", markStale);
	// Pi writes the name to the session file, if there is one yet, before it tells.
	pi.on("session_info_changed", markStale);
	pi.on("agent_end", markStale);

	pi.registerCommand(COMMAND, {
		description: "Switch to a session listed in MAP › SESSIONS",
		handler: async (args, ctx) => {
			const path = args.trim();
			if (!path) return;
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the agent to finish before switching sessions.", "warning");
				return;
			}
			// Only sessions the list showed can be opened this way.
			if (!data.sessions.some((session) => session.path === path)) {
				ctx.ui.notify("That session is not in the session list.", "warning");
				return;
			}
			await ctx.switchSession(path);
		},
	});
}

/** A one-line title: the session's name, or the first line of the first message. */
function titleOf(name: string | undefined, firstLine: string): string {
	const text = (name || firstLine).trim();
	// Control characters would break the line; tabs and the like become spaces.
	return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ") || "(empty session)";
}

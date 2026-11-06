/**
 * The git snapshot the git panels show, read through Pi's exec.
 *
 * readGit reads the whole output of `git diff` (pi.exec gathers all of it) and
 * keeps the first MAX_FILE_DIFF_LINES lines of each file, its lines after the first
 * hunk header cut at MAX_DIFF_LINE_BYTES. It runs while a git panel is shown, every
 * few seconds and after edits. Untracked files are read up to UNTRACKED_BYTES each
 * (which bounds their lines as well), and only when their size or time changed.
 *
 * readLineCounts reads only the line counts, for STATUS's DIFF card.
 */
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sanitize, type Versioned } from "./core.ts";

export interface GitFile {
	/** Two-letter porcelain status, e.g. " M", "A ", "??". */
	status: string;
	/** The path as a panel shows it (see pathText). */
	path: string;
	/** The path as git gave it, which tells files apart; never drawn. */
	gitPath: string;
	added?: number;
	removed?: number;
}

/**
 * The part of a unified diff that belongs to one file, header included. An
 * untracked file gets one made from its contents, every line added.
 */
export interface GitDiffFile {
	/** The path as a panel shows it. */
	path: string;
	/** The path as git gave it, as GitFile.gitPath; never drawn. */
	gitPath: string;
	lines: string[];
	/** Lines of the file's diff left out after MAX_FILE_DIFF_LINES. */
	omitted?: number;
	/** Size and modification time of an untracked file when it was read. */
	stamp?: string;
	/** Lines of an untracked text file that was read whole and is shown whole. */
	added?: number;
}

export interface GitSnapshot {
	branch?: string;
	files: GitFile[];
	/**
	 * Diff against HEAD (the empty tree before the first commit), split by file,
	 * then the untracked files. A file whose diff did not change keeps the same
	 * object from one snapshot to the next, so its rendering can be reused.
	 */
	diff: GitDiffFile[];
	/** Commit of HEAD; none before the first commit. */
	head?: string;
	/** `git log --graph` of the last LOG_COMMITS commits. */
	log?: string[];
	logError?: string;
	/** Why line counts or the diff could not be read, when `git status` itself worked. */
	diffError?: string;
	error?: string;
	updatedAt?: number;
}

/** Changed files the file list shows at most. */
const MAX_LISTED_FILES = 500;
/** Lines of one file's diff kept at most. */
const MAX_FILE_DIFF_LINES = 2000;
/**
 * UTF-8 bytes of one line of `git diff` output kept at most (64 KiB, where lazygit cuts
 * too); a longer line (minified code, data) keeps what fits and gets "…" after it.
 * Such a line is too long to read on screen anyway, and wrapping and drawing all of it
 * would take long. Tabs are counted as one byte here and drawn as four columns later.
 */
const MAX_DIFF_LINE_BYTES = 64 * 1024;
/** Untracked files read at most, and bytes read of each. */
const MAX_UNTRACKED = 100;
const UNTRACKED_BYTES = 64 * 1024;
/** Commits read for the history. */
const LOG_COMMITS = 40;
const GIT_TIMEOUT_MS = 5000;

/** Lines added and removed. */
export interface GitLines {
	added: number;
	removed: number;
}

/** What the git panels show: the last snapshot and the file picked in the list; and STATUS's line counts. */
export interface GitData extends Versioned {
	git: GitSnapshot;
	/** The gitPath of the file whose diff the git panels show; none shows every file. */
	gitPick?: string;
	/** The last readLineCounts; none before it, or when git could not tell. */
	lines?: GitLines;
}

/**
 * Store a git snapshot. A picked file that the file list no longer shows (it is no
 * longer changed, or past MAX_LISTED_FILES) is unpicked, since the list no longer
 * offers it.
 */
export function setGit(data: GitData, snapshot: GitSnapshot): void {
	data.git = snapshot;
	if (snapshot.error || data.gitPick === undefined) return;
	if (listedFiles(snapshot).some((file) => file.gitPath === data.gitPick)) return;
	pickGitFile(data, undefined);
}

/** The files the file list shows: the first MAX_LISTED_FILES. A file is picked among these. */
export function listedFiles(snapshot: GitSnapshot): readonly GitFile[] {
	return snapshot.files.slice(0, MAX_LISTED_FILES);
}

/** Show the diff of one file (by its gitPath), or of every file (`undefined`). */
export function pickGitFile(data: GitData, gitPath: string | undefined): void {
	if (data.gitPick === gitPath) return;
	data.gitPick = gitPath;
	data.version++;
}

type ExecResult = Awaited<ReturnType<ExtensionAPI["exec"]>>;

/** Pi's exec reports a timed-out or aborted command as killed, possibly with code 0. */
function failed(result: ExecResult): boolean {
	return result.killed || result.code !== 0;
}

function failure(result: ExecResult, what: string): string {
	if (result.killed) return `${what} did not finish within ${GIT_TIMEOUT_MS / 1000}s`;
	return sanitize(result.stderr.trim().split(/\r?\n/, 1)[0] || `${what} exited with ${result.code}`);
}

/**
 * Read the branch, the changed files with their line counts, the diff against
 * HEAD (the empty tree before the first commit), the untracked files and the
 * history, through Pi's exec. `previous` is the snapshot shown now: files whose
 * diff did not change keep its objects, untracked files are read again only
 * when their size or time changed, and the history is read again only when
 * `freshLog` is set or HEAD or the branch line changed.
 * `--no-optional-locks` keeps the periodic refresh from taking the index lock
 * that the user's own git commands may need.
 */
export async function readGit(
	pi: ExtensionAPI,
	cwd: string,
	signal: AbortSignal,
	previous?: GitSnapshot,
	freshLog = false,
): Promise<GitSnapshot> {
	const git = gitIn(pi, cwd, signal);
	// -z gives paths without C-style quoting (a path with a space is quoted otherwise).
	const status = await git(["status", "--porcelain=v1", "-b", "-z"]);
	if (failed(status)) return { files: [], diff: [], error: failure(status, "git status"), updatedAt: Date.now() };
	const records = status.stdout.split("\0");
	const files: GitFile[] = [];
	const untracked: GitFile[] = [];
	let branch: string | undefined;
	for (let index = 0; index < records.length; index++) {
		const record = records[index]!;
		if (!record) continue;
		if (record.startsWith("## ")) {
			branch = sanitize(record.slice(3));
			continue;
		}
		const code = record.slice(0, 2);
		const gitPath = record.slice(3);
		const file: GitFile = { status: code, path: pathText(gitPath), gitPath };
		files.push(file);
		if (code === "??") untracked.push(file);
		// A rename or copy is followed by a record holding the original path.
		if (code[0] === "R" || code[0] === "C") index++;
	}
	const snapshot: GitSnapshot = { branch, files, diff: [], updatedAt: Date.now() };

	const found = await diffBase(git);
	if ("error" in found) {
		snapshot.diffError = found.error;
		return snapshot;
	}
	const { base } = found;
	if (found.head) snapshot.head = found.head;
	await readLog(snapshot, git, previous, freshLog);

	const numstat = await git(["diff", "--numstat", "-z", base]);
	if (failed(numstat)) {
		snapshot.diffError = failure(numstat, "git diff --numstat");
		return snapshot;
	}
	const counts = parseNumstat(numstat.stdout);
	for (const file of files) {
		const count = counts.get(file.gitPath);
		if (count) [file.added, file.removed] = count;
	}
	const patch = await git(["diff", "--no-color", "--no-ext-diff", base]);
	if (failed(patch)) {
		snapshot.diffError = failure(patch, "git diff");
		return snapshot;
	}
	const kept = new Map((previous?.diff ?? []).map((file) => [file.gitPath, file]));
	snapshot.diff = splitByFile(patch.stdout).map((file) => {
		const old = kept.get(file.gitPath);
		return old && !old.stamp && old.omitted === file.omitted && sameLines(old.lines, file.lines) ? old : file;
	});
	if (untracked.length) await readUntracked(snapshot, untracked, git, kept);
	return snapshot;
}

type Git = (args: string[]) => Promise<ExecResult>;

function gitIn(pi: ExtensionAPI, cwd: string, signal: AbortSignal): Git {
	return (args) => pi.exec("git", ["--no-optional-locks", "-c", "core.quotePath=false", ...args], { cwd, timeout: GIT_TIMEOUT_MS, signal });
}

/**
 * What to diff against: HEAD, with its commit. A repository without commits has no
 * HEAD; the empty tree is used then, so that staged files show (pi.exec gives git an
 * empty stdin to hash).
 */
async function diffBase(git: Git): Promise<{ base: string; head?: string } | { error: string }> {
	const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
	if (head.killed) return { error: failure(head, "git rev-parse") };
	if (head.code === 0) return { base: "HEAD", head: head.stdout.trim() };
	const empty = await git(["hash-object", "-t", "tree", "--stdin"]);
	if (failed(empty)) return { error: failure(empty, "git hash-object") };
	return { base: empty.stdout.trim() };
}

/**
 * The lines added and removed against what readGit diffs against, as `git diff
 * --numstat` counts them: untracked files are not in them, and a binary file adds
 * none. Undefined when git could not tell.
 */
export async function readLineCounts(pi: ExtensionAPI, cwd: string, signal: AbortSignal): Promise<GitLines | undefined> {
	const git = gitIn(pi, cwd, signal);
	const found = await diffBase(git);
	if ("error" in found) return undefined;
	const numstat = await git(["diff", "--numstat", found.base]);
	if (failed(numstat)) return undefined;
	const lines: GitLines = { added: 0, removed: 0 };
	// One line per file: "added<TAB>removed<TAB>path", "-" for a binary file.
	for (const line of numstat.stdout.split("\n")) {
		const [added = "", removed = ""] = line.split("\t");
		lines.added += toCount(added) ?? 0;
		lines.removed += toCount(removed) ?? 0;
	}
	return lines;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** The history: read again when asked, or when HEAD or the branch line changed; otherwise kept. */
async function readLog(snapshot: GitSnapshot, git: Git, previous: GitSnapshot | undefined, fresh: boolean): Promise<void> {
	if (!snapshot.head) return;
	if (!fresh && previous?.log && previous.head === snapshot.head && previous.branch === snapshot.branch) {
		snapshot.log = previous.log;
		return;
	}
	const log = await git(["log", "--graph", "--oneline", "--decorate", "--no-color", "-n", String(LOG_COMMITS)]);
	if (failed(log)) {
		snapshot.logError = failure(log, "git log");
		return;
	}
	snapshot.log = sanitize(log.stdout).split("\n").filter(Boolean);
}

/**
 * Diffs made from the contents of untracked files (git diff does not show
 * them): every line added. Reads at most MAX_UNTRACKED files and UNTRACKED_BYTES
 * of each, and keeps the previous diff of a file whose size and time did not
 * change. An untracked directory (git lists it, not its files) gets a note.
 */
async function readUntracked(
	snapshot: GitSnapshot,
	untracked: readonly GitFile[],
	git: Git,
	kept: ReadonlyMap<string, GitDiffFile>,
): Promise<void> {
	const top = await git(["rev-parse", "--show-toplevel"]);
	// Without the root the files cannot be read; each one's diff says why.
	const unreadable = failed(top) ? failure(top, "git rev-parse") : undefined;
	const root = top.stdout.trim();
	for (const file of untracked.slice(0, MAX_UNTRACKED)) {
		const { path, gitPath } = file;
		const header = `diff --git a/${path} b/${path}`;
		if (gitPath.endsWith("/")) {
			snapshot.diff.push({ path, gitPath, lines: [header, "untracked directory"], stamp: "dir" });
			continue;
		}
		if (unreadable !== undefined) {
			snapshot.diff.push({ path, gitPath, lines: [header, `untracked file: ${unreadable}`] });
			continue;
		}
		try {
			const full = join(root, gitPath);
			const info = await stat(full);
			const stamp = `${info.size}:${info.mtimeMs}`;
			const old = kept.get(gitPath);
			const section = old?.stamp === stamp ? old : await untrackedDiff(full, { path, gitPath }, header, info.size, stamp);
			if (section.added !== undefined) file.added = section.added;
			snapshot.diff.push(section);
		} catch (error) {
			snapshot.diff.push({ path, gitPath, lines: [header, `untracked file: ${sanitize(String((error as Error)?.message ?? error))}`] });
		}
	}
}

const PARTIAL_NOTE = `untracked file, first ${UNTRACKED_BYTES / 1024} KiB shown`;

async function untrackedDiff(full: string, paths: Pick<GitDiffFile, "path" | "gitPath">, header: string, size: number, stamp: string): Promise<GitDiffFile> {
	const handle = await open(full, "r");
	let bytes: Buffer;
	try {
		const buffer = Buffer.alloc(Math.min(size, UNTRACKED_BYTES));
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		bytes = buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
	// Git calls a file binary when its first 8000 bytes hold a NUL.
	if (bytes.subarray(0, 8000).includes(0)) return { ...paths, lines: [header, "untracked binary file"], stamp };
	const partial = size > bytes.length;
	const text = sanitize(bytes.toString("utf8"));
	const body = text.split("\n");
	if (body.at(-1) === "") body.pop();
	// A file cut at UNTRACKED_BYTES may end in the middle of a line; drop that line.
	if (partial && body.length > 1) body.pop();
	const lines = [header, partial ? PARTIAL_NOTE : "untracked file", `@@ -0,0 +1,${body.length} @@`, ...body.map((line) => `+${line}`)];
	const omitted = Math.max(0, lines.length - MAX_FILE_DIFF_LINES);
	if (omitted) lines.length = MAX_FILE_DIFF_LINES;
	if (omitted) return { ...paths, lines, stamp, omitted };
	// The line count needs every line: none when the file was cut at UNTRACKED_BYTES.
	return { ...paths, lines, stamp, ...(partial ? {} : { added: body.length }) };
}

/**
 * A path from git output, for one line of a panel: without control characters,
 * and with newlines and tabs written as \n and \t (git allows both in file names).
 */
function pathText(path: string): string {
	return sanitize(path).replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

/** Path of the file a `diff --git` section is about, from its `+++ b/` or `--- a/` header. */
function headerPath(line: string, prefix: "+++ b/" | "--- a/"): string | undefined {
	// Git ends the header with a tab when the path contains a space.
	return line.startsWith(prefix) ? line.slice(prefix.length).replace(/\t$/, "") : undefined;
}

/**
 * Path of "diff --git a/P b/P", the header of a file whose path did not change.
 * The +++ / --- lines, when present, override it (they also cover renames);
 * binary files have none.
 */
function samePathOf(header: string): string {
	const rest = header.slice("diff --git ".length);
	const half = (rest.length - 1) / 2;
	if (!Number.isInteger(half) || half < 3) return "";
	const path = rest.slice(2, half);
	return rest === `a/${path} b/${path}` ? path : "";
}

/**
 * Split a unified diff into per-file sections of at most MAX_FILE_DIFF_LINES lines,
 * without control characters, each line after a file's first hunk header shortened
 * by cutLine. Only the lines kept are sliced out of the output and cleaned; the lines
 * after them in a file's hunks are only counted, so a large diff costs a scan for its
 * line breaks.
 */
function splitByFile(output: string): GitDiffFile[] {
	const files: GitDiffFile[] = [];
	let current: GitDiffFile | undefined;
	let inHunk = false;
	let oldPath: string | undefined;
	let oldGitPath: string | undefined;
	// The text after the output's last line break is a line only when something is left of it once cleaned.
	for (let start = 0; start < output.length; ) {
		const found = output.indexOf("\n", start);
		const stop = found < 0 ? output.length : found;
		const from = start;
		start = stop + 1;
		if (found < 0 && sanitize(output.slice(from)) === "") break;
		const starts = output.startsWith("diff --git ", from);
		if (!starts && (!current || (inHunk && current.lines.length >= MAX_FILE_DIFF_LINES))) {
			if (current) current.omitted = (current.omitted ?? 0) + 1;
			continue;
		}
		// The paths in the headers: shown from the cleaned line, told apart by the line as git
		// gave it, so the lines before a file's first hunk header (and that header) are never
		// shortened; later lines, hunk headers included, are. `inHunk` still holds the
		// previous file's state on a `diff --git` line, hence `!starts`.
		const raw = inHunk && !starts ? cutLine(output, from, stop) : output.slice(from, stop);
		const line = sanitize(raw);
		if (starts) {
			current = { path: samePathOf(line), gitPath: samePathOf(raw), lines: [] };
			files.push(current);
			inHunk = false;
			oldPath = undefined;
			oldGitPath = undefined;
		} else if (current && !inHunk && line.startsWith("--- ")) {
			oldPath = headerPath(line, "--- a/");
			oldGitPath = headerPath(raw, "--- a/");
		} else if (current && !inHunk && line.startsWith("+++ ")) {
			current.path = headerPath(line, "+++ b/") ?? oldPath ?? current.path;
			current.gitPath = headerPath(raw, "+++ b/") ?? oldGitPath ?? current.gitPath;
		} else if (current && !inHunk && (line.startsWith("rename to ") || line.startsWith("copy to "))) {
			// A rename or copy without content changes has no +++ / --- lines.
			current.path = line.slice(line.indexOf(" to ") + 4);
			current.gitPath = raw.slice(raw.indexOf(" to ") + 4);
		} else if (line.startsWith("@@")) {
			inHunk = true;
		}
		if (!current) continue;
		if (current.lines.length < MAX_FILE_DIFF_LINES) current.lines.push(line);
		else current.omitted = (current.omitted ?? 0) + 1;
	}
	return files;
}

/**
 * The line from `from` to `stop`; when it is longer than MAX_DIFF_LINE_BYTES in UTF-8,
 * its first characters that fit, then "…". The bytes are counted only up to the cut,
 * so the rest of a line of megabytes is never read (Buffer.byteLength would read it
 * all). A character is never split (pi's truncateLine cuts UTF-16 units, so it can
 * leave half of a surrogate pair).
 */
function cutLine(output: string, from: number, stop: number): string {
	// A UTF-16 unit is at most 3 bytes in UTF-8, so a short line needs no counting.
	if ((stop - from) * 3 <= MAX_DIFF_LINE_BYTES) return output.slice(from, stop);
	let bytes = 0;
	for (let end = from; end < stop; ) {
		const code = output.codePointAt(end)!;
		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
		if (bytes > MAX_DIFF_LINE_BYTES) return `${output.slice(from, end)}…`;
		end += code >= 0x10000 ? 2 : 1;
	}
	return output.slice(from, stop);
}

/**
 * Parse `git diff --numstat -z`: "added\tremoved\tpath\0", or for a rename
 * "added\tremoved\t\0old path\0new path\0". Binary files report "-".
 */
function parseNumstat(output: string): Map<string, [number | undefined, number | undefined]> {
	const counts = new Map<string, [number | undefined, number | undefined]>();
	const fields = output.split("\0");
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]!;
		if (!field) continue;
		const first = field.indexOf("\t");
		const second = field.indexOf("\t", first + 1);
		if (first < 0 || second < 0) continue;
		const count: [number | undefined, number | undefined] = [toCount(field.slice(0, first)), toCount(field.slice(first + 1, second))];
		let path = field.slice(second + 1);
		if (!path) {
			path = fields[index + 2] ?? "";
			index += 2;
		}
		if (path) counts.set(path, count);
	}
	return counts;
}

function toCount(text: string): number | undefined {
	const value = Number(text);
	return text !== "" && Number.isFinite(value) ? value : undefined;
}

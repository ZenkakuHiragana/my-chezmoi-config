/**
 * DATA › GIT: the working tree's changes, their diff and the recent history, read
 * from git while a git panel is on screen; and the line counts of STATUS's DIFF
 * card, read alone while STATUS is on screen.
 *
 * A shown git panel or STATUS re-reads git every GIT_REFRESH_MS, so that edits made
 * outside Pi show up, and right away when the agent finishes, after a tool that may
 * edit files, and when a page with one of them is opened. Opening a git page also
 * reads the history again; the other reads keep it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize } from "../state/core.ts";
import { type GitData, pickGitFile as pick, readGit, readLineCounts, setGit } from "../state/git.ts";
import type { FeatureEnv } from "./env.ts";

/** Panels that show git. */
const GIT_PANELS = ["git", "gitfiles", "gitdiff", "gitlog"];
/** STATUS: its DIFF card shows the line counts. */
const COUNTS_PANEL = "vitals";
/** Tools that may change the working tree. */
const EDIT_TOOLS = new Set(["edit", "write", "bash"]);
/** How often a shown git panel re-reads git, so that edits made outside Pi show up. */
const GIT_REFRESH_MS = 5000;

/** Each pi-crt instance's git data, by its CrtState (see FeatureEnv). */
const collected = new WeakMap<CrtState, GitData>();

/** Before setupGit: nothing read. Never changed. */
const NONE: Readonly<GitData> = Object.freeze({ git: { files: [], diff: [] }, version: 0 });

/** The last snapshot, the picked file and the line counts. */
export function gitData(state: CrtState): Readonly<GitData> {
	return collected.get(state) ?? NONE;
}

/** Show the diff of one file, or of every file (`undefined`). */
export function pickGitFile(state: CrtState, path: string | undefined): void {
	const data = collected.get(state);
	if (data) pick(data, path);
}

export function setupGit(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: GitData = { git: { files: [], diff: [] }, version: 0 };
	collected.set(env.state, data);
	const abort = new AbortController();
	let timer: ReturnType<typeof setInterval> | undefined;
	let busy = false;
	let again = false;
	/** The next read also reads the history (a git page was just opened). */
	let freshLog = true;

	const showsGit = () => GIT_PANELS.some((id) => env.shows(id));
	const showsCounts = () => env.shows(COUNTS_PANEL);

	/** Re-read git while a git panel or STATUS is shown: what each of them shows. */
	const refresh = async () => {
		const ctx = env.context();
		if (!ctx || !(showsGit() || showsCounts())) return;
		if (busy) {
			again = true;
			return;
		}
		busy = true;
		try {
			do {
				again = false;
				if (showsGit()) {
					const fresh = freshLog;
					freshLog = false;
					const snapshot = await readGit(pi, ctx.cwd, abort.signal, data.git, fresh);
					if (abort.signal.aborted) return;
					setGit(data, snapshot);
				}
				if (showsCounts()) {
					const lines = await readLineCounts(pi, ctx.cwd, abort.signal);
					if (abort.signal.aborted) return;
					data.lines = lines;
				}
				// A refresh asked for while this one ran is dropped once neither is shown.
			} while (again && (showsGit() || showsCounts()));
		} catch (error) {
			if (abort.signal.aborted) return;
			const message = sanitize(error instanceof Error ? error.message : String(error));
			setGit(data, { files: [], diff: [], error: message, updatedAt: Date.now() });
		} finally {
			busy = false;
			env.changed(data);
		}
	};

	env.onShownChange(() => {
		// Opening a git page reads the history again.
		freshLog = true;
		void refresh();
	});

	pi.on("session_start", (_event, ctx) => {
		// The timer runs only for a session on screen; it reads git only while a git
		// panel or STATUS is shown at the current width, which the width alone can change.
		if (ctx.mode !== "tui" || !ctx.hasUI || timer) return;
		timer = setInterval(() => void refresh(), GIT_REFRESH_MS);
		timer.unref?.();
	});

	pi.on("agent_end", () => void refresh());

	pi.on("tool_execution_end", (event) => {
		if (EDIT_TOOLS.has(event.toolName)) void refresh();
	});

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		abort.abort();
	});
}

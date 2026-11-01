/**
 * DATA's GIT panels: the file list, the diff, both in one panel, and the history.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import { framed } from "../screen/frame.ts";
import { Lines, type ThemeRef } from "../screen/lines.ts";
import { renderDiffSection } from "../split-diff.ts";
import { gitData, pickGitFile } from "../features/git.ts";
import type { GitDiffFile, GitFile } from "../state/git.ts";
import { ListLines, Selection, themeStamp, withCursor } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

/** Changed files listed in the git panels at most. */
const MAX_FILE_LINES = 500;
/** Diff lines drawn at most when every file is shown; a picked file shows its whole kept diff. */
const MAX_ALL_LINES = 4000;

registerPanel("git", (env) => {
	const selection = gitSelection(env);
	const panel = framed(
		env.theme,
		() => gitTitle(env),
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				// withCursor takes the first column; the diff lines already fit the rest.
				const inner = Math.max(1, width - 1);
				const lines = gitFileLines(env, selection).map((line) => truncateToWidth(line, inner));
				// gitFileLines already reports a failed diff.
				const git = gitData(env.state).git;
				if (!git.error && git.updatedAt && !git.diffError) lines.push("", ...gitDiffLines(env, inner));
				return withCursor(env, selection, "git", lines);
			},
			() => gitKey(env, selection, "git"),
			true,
		),
		"top",
		() => env.focused("git"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
});

registerPanel("gitfiles", (env) => {
	const selection = gitSelection(env, true);
	const panel = framed(
		env.theme,
		() => gitTitle(env),
		new ListLines(
			selection,
			() => {
				selection.reset();
				return withCursor(env, selection, "gitfiles", gitFileLines(env, selection));
			},
			() => gitKey(env, selection, "gitfiles"),
		),
		"top",
		() => env.focused("gitfiles"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
});

registerPanel("gitdiff", (env) =>
	framed(
		env.theme,
		() => `DIFF  ${gitData(env.state).gitPick ?? "ALL"}`,
		new Lines(
			(width) => {
				const t = env.theme();
				const git = gitData(env.state).git;
				if (git.error) return [truncateToWidth(t.fg("error", ` ${git.error}`), width)];
				if (!git.updatedAt) return [t.fg("dim", " -- scanning --")];
				if (git.diffError) return [truncateToWidth(t.fg("error", ` diff unavailable: ${git.diffError}`), width)];
				return gitDiffLines(env, width);
			},
			() => {
				const data = gitData(env.state);
				return [data.git, data.gitPickVersion, diffStamp(env.theme())];
			},
			true,
		),
		"top",
		() => env.focused("gitdiff"),
	));

registerPanel("gitlog", (env) =>
	framed(
		env.theme,
		() => "HISTORY",
		new Lines(
			() => gitLogLines(env),
			() => {
				const git = gitData(env.state).git;
				return [git.log, git.logError, git.updatedAt !== undefined, themeStamp(env.theme())];
			},
		),
		"top",
		() => env.focused("gitlog"),
	));

/**
 * Selection over the file list: ALL, then the changed files. Enter shows the
 * diff of the selected file, or of every file on ALL; `pickOnMove` shows it as the
 * selection moves (the file list beside the diff panel).
 */
function gitSelection(env: PanelEnv, pickOnMove = false): Selection {
	return new Selection(
		() => 1 + Math.min(gitData(env.state).git.files.length, MAX_FILE_LINES),
		(index) => pickGitFile(env.state, index === 0 ? undefined : gitData(env.state).git.files[index - 1]?.path),
		pickOnMove,
	);
}

function gitTitle(env: PanelEnv): string {
	const git = gitData(env.state).git;
	const branch = git.branch?.split("...")[0];
	return branch ? `GIT  ${branch}  ±${git.files.length}` : "GIT";
}

function gitKey(env: PanelEnv, selection: Selection, id: string): unknown[] {
	const data = gitData(env.state);
	return [data.git, data.gitPickVersion, selection.index, env.focused(id), diffStamp(env.theme())];
}

/** themeStamp plus the backgrounds the split diff tints its rows with. */
function diffStamp(theme: ReturnType<ThemeRef>): string {
	return themeStamp(theme) + theme.getBgAnsi("toolSuccessBg") + theme.getBgAnsi("toolPendingBg");
}

function gitFileLines(env: PanelEnv, selection: Selection): string[] {
	const t = env.theme();
	const git = gitData(env.state).git;
	if (git.error) return [t.fg("error", ` ${git.error}`)];
	if (!git.updatedAt) return [t.fg("dim", " -- scanning --")];
	const lines: string[] = [];
	if (git.branch) lines.push(t.fg("muted", ` ## ${git.branch}`));
	selection.place(0, lines.length, 1);
	const all = gitData(env.state).gitPick === undefined ? t.fg("accent", "◆") : " ";
	lines.push(`${all}${t.fg("text", t.bold("ALL"))} ${t.fg("muted", `${git.files.length} file(s)`)}`);
	if (!git.files.length) lines.push(t.fg("dim", " -- working tree clean --"));
	git.files.slice(0, MAX_FILE_LINES).forEach((file, index) => {
		selection.place(index + 1, lines.length, 1);
		lines.push(gitFileLine(env, file));
	});
	const hidden = git.files.length - MAX_FILE_LINES;
	if (hidden > 0) lines.push(t.fg("warning", ` -- ${hidden} more files --`));
	if (git.diffError) lines.push(t.fg("error", ` diff unavailable: ${git.diffError}`));
	return lines;
}

function gitFileLine(env: PanelEnv, file: GitFile): string {
	const t = env.theme();
	const code = file.status;
	const color = code.includes("D") ? "error" : code === "??" || code.includes("A") ? "success" : "warning";
	const counts =
		file.added === undefined && file.removed === undefined
			? ""
			: ` ${t.fg("success", `+${file.added ?? "-"}`)} ${t.fg("error", `-${file.removed ?? "-"}`)}`;
	const picked = gitData(env.state).gitPick === file.path ? t.fg("accent", "◆") : " ";
	return `${picked}${t.fg(color, code.replace(/ /g, "·"))} ${t.fg("text", file.path)}${counts}`;
}

/** Rendered diff of one file, kept while the file's diff, the width and the theme stay the same. */
const rendered = new WeakMap<GitDiffFile, { width: number; stamp: string; lines: string[] }>();

function fileDiffLines(env: PanelEnv, file: GitDiffFile, width: number): string[] {
	const theme = env.theme();
	const stamp = diffStamp(theme);
	const cached = rendered.get(file);
	if (cached && cached.width === width && cached.stamp === stamp) return cached.lines;
	const lines = renderDiffSection(file, width, theme);
	rendered.set(file, { width, stamp, lines });
	return lines;
}

/**
 * The diff of the picked file, or of every file one after another (at most
 * MAX_ALL_LINES lines; the rest of the files are named, to be picked). Every
 * line fits `width` (the panels do not clip them again).
 */
function gitDiffLines(env: PanelEnv, width: number): string[] {
	const t = env.theme();
	const { git, gitPick: pick } = gitData(env.state);
	if (pick !== undefined) {
		const file = git.diff.find((section) => section.path === pick);
		return file ? fileDiffLines(env, file, width) : [truncateToWidth(t.fg("dim", " -- no diff for this file --"), width)];
	}
	if (!git.diff.length) return [truncateToWidth(t.fg("dim", " -- no diff --"), width)];
	const lines: string[] = [];
	for (let index = 0; index < git.diff.length; index++) {
		if (lines.length >= MAX_ALL_LINES) {
			lines.push(truncateToWidth(t.fg("warning", ` -- ${git.diff.length - index} more files; pick one in the file list to see its diff --`), width));
			break;
		}
		if (index > 0) lines.push("");
		lines.push(...fileDiffLines(env, git.diff[index]!, width));
	}
	return lines;
}

/** One line of `git log --graph --oneline --decorate`: the graph, the hash, the refs, the subject. */
const LOG_LINE = /^([^0-9a-f]*?)([0-9a-f]{7,40})( \([^)]*\))?(.*)$/;

/** `git log --graph` with the graph dim and the hash and the refs coloured. */
function gitLogLines(env: PanelEnv): string[] {
	const t = env.theme();
	const git = gitData(env.state).git;
	if (git.logError) return [t.fg("error", ` ${git.logError}`)];
	if (!git.updatedAt) return [t.fg("dim", " -- scanning --")];
	if (!git.log?.length) return [t.fg("dim", " -- no commits --")];
	return git.log.map((line) => {
		const match = LOG_LINE.exec(line);
		if (!match) return ` ${t.fg("borderMuted", line)}`;
		const [, graph, hash, refs, subject] = match;
		return ` ${t.fg("borderMuted", graph ?? "")}${t.fg("warning", hash!)}${refs ? t.fg("success", refs) : ""}${t.fg("text", subject ?? "")}`;
	});
}

/**
 * MAP › SESSIONS: the sessions of this project, one quest per session.
 *
 * The list comes from SessionManager.list(), which reads every session file of the
 * project. That is too slow to do on every render, so it is read only while the SESSIONS
 * panel is drawn and the list is stale: once when first shown, and again after the
 * session changes or the agent finishes a run.
 *
 * Opening a quest switches pi to that session. switchSession() is only on the context a
 * command receives, not on the one a panel or shortcut gets, so the panel sends the
 * command `/crt-session <path>` through sendUserMessage(); pi runs an extension command
 * before anything reaches the model.
 */

import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** One quest as the panel shows it. */
export interface Quest {
	path: string;
	/** The name given with /name, else the start of the first message. */
	title: string;
	modified: Date;
	messageCount: number;
	/** The session was forked from another one. */
	forked: boolean;
	/** The session pi is in now. */
	active: boolean;
}

/** Name of the command that switches to a quest. */
const COMMAND = "crt-session";
/** Quests listed at most. */
const MAX_QUESTS = 200;

interface QuestState {
	quests: Quest[];
	/** Changes whenever `quests`, `loading` or `error` changes. */
	version: number;
	loading: boolean;
	/** The list no longer matches the sessions on disk. */
	stale: boolean;
	error?: string;
}

interface QuestFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: QuestState;
}

/** Each pi-crt instance's quests, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, QuestFeature>();

/** Before setupQuests: nothing read. Never changed. */
const NONE: Readonly<QuestState> = Object.freeze({ quests: [], version: 0, loading: false, stale: false });

/** The quests read so far. */
export function quests(state: CrtState): Readonly<QuestState> {
	return features.get(state)?.data ?? NONE;
}

/**
 * Read the list again when it is stale. Called while the panel is drawn, so the sessions
 * are only read while someone looks at them.
 */
export function refreshQuests(state: CrtState): void {
	const feature = features.get(state);
	if (!feature) return;
	const { data, env } = feature;
	if (!data.stale || data.loading) return;
	const ctx = env.context();
	if (!ctx) return;
	// No version change here: the panel calling this is drawing already and shows the
	// loading state itself. The change at the end draws the result.
	data.loading = true;
	data.stale = false;
	const current = ctx.sessionManager.getSessionFile();
	SessionManager.list(ctx.cwd)
		.then((infos) => {
			const list = infos.map<Quest>((info) => ({
				path: info.path,
				title: titleOf(info.name, info.firstMessage),
				modified: info.modified,
				messageCount: info.messageCount,
				forked: Boolean(info.parentSessionPath),
				active: info.path === current,
			}));
			// The quest in progress first, then the most recently touched.
			list.sort((a, b) => Number(b.active) - Number(a.active) || b.modified.getTime() - a.modified.getTime());
			data.quests = list.slice(0, MAX_QUESTS);
			data.error = undefined;
		})
		.catch((error: unknown) => {
			data.error = error instanceof Error ? error.message : String(error);
		})
		.finally(() => {
			data.loading = false;
			env.changed(data);
		});
}

/** Switch to a quest's session. Does nothing for the quest already in progress. */
export function openQuest(state: CrtState, quest: Quest): void {
	const pi = features.get(state)?.pi;
	if (!pi || quest.active) return;
	// Without the command, the text would go to the model as a message.
	if (!pi.getCommands().some((command) => command.name === COMMAND)) return;
	void pi.sendUserMessage(`/${COMMAND} ${quest.path}`, { expandPromptTemplates: true });
}

export function setupQuests(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: QuestState = { quests: [], version: 0, loading: false, stale: true };
	features.set(env.state, { pi, env, data });

	const markStale = (): void => {
		data.stale = true;
		env.changed(data);
	};
	pi.on("session_start", markStale);
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
			if (!data.quests.some((quest) => quest.path === path)) {
				ctx.ui.notify("That session is not in the session list.", "warning");
				return;
			}
			await ctx.switchSession(path);
		},
	});
}

/** A one-line title: the session name, or the first line of the first message. */
function titleOf(name: string | undefined, firstMessage: string): string {
	const text = (name?.trim() || firstMessage.split("\n").find((line) => line.trim()) || "").trim();
	// Control characters would break the line; tabs and the like become spaces.
	return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ") || "(empty session)";
}

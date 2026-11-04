/**
 * MAP › SESSIONS: the sessions of this project.
 *
 * The list comes from SessionManager.list(), which reads every session file of the
 * project. That is too slow to do on every render, so it is read only while the SESSIONS
 * panel is drawn and the list is stale: once when first shown, and again after the
 * session changes or the agent finishes a run.
 *
 * Opening a session switches pi to it. switchSession() is only on the context a
 * command receives, not on the one a panel or shortcut gets, so the panel sends the
 * command `/crt-session <path>` through sendUserMessage(); pi runs an extension command
 * before anything reaches the model.
 */

import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** One session as the panel shows it. */
export interface SessionItem {
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

/** Name of the command that switches to a session. */
const COMMAND = "crt-session";
/** Sessions listed at most. */
const MAX_SESSIONS = 200;

interface SessionList {
	sessions: SessionItem[];
	/** Changes whenever `sessions`, `loading` or `error` changes. */
	version: number;
	loading: boolean;
	/** The list no longer matches the sessions on disk. */
	stale: boolean;
	error?: string;
}

interface SessionFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: SessionList;
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
	// loading state itself. The change at the end draws the result.
	data.loading = true;
	data.stale = false;
	const current = ctx.sessionManager.getSessionFile();
	SessionManager.list(ctx.cwd)
		.then((infos) => {
			const list = infos.map<SessionItem>((info) => ({
				path: info.path,
				title: titleOf(info.name, info.firstMessage),
				modified: info.modified,
				messageCount: info.messageCount,
				forked: Boolean(info.parentSessionPath),
				active: info.path === current,
			}));
			// The session in progress first, then the most recently touched.
			list.sort((a, b) => Number(b.active) - Number(a.active) || b.modified.getTime() - a.modified.getTime());
			data.sessions = list.slice(0, MAX_SESSIONS);
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
			if (!data.sessions.some((session) => session.path === path)) {
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

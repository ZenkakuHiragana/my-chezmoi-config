/**
 * MAP's SESSIONS panel: the project's sessions, the one in progress first.
 * The arrow keys or j/k select a session and Enter switches to it.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import { openSession, refreshSessions, type SessionItem, sessions } from "../features/sessions.ts";
import { framed } from "../screen/frame.ts";
import { ListLines, Selection, withCursor } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("sessions", (env) => {
	const selection = new Selection(
		() => sessions(env.state).sessions.map((session) => session.path),
		(index) => {
			const session = sessions(env.state).sessions[index];
			if (session) openSession(env.state, session);
		},
	);
	const panel = framed(
		env.theme,
		() => sessionTitle(env),
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "sessions", sessionLines(env, selection, width - 1));
			},
			() => [sessions(env.state).version, selection.selectedKey, env.focused("sessions")],
		),
		"top",
		() => env.focused("sessions"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
});

function sessionTitle(env: PanelEnv): string {
	const list = sessions(env.state).sessions;
	return list.length ? `SESSIONS  ${list.length}` : "SESSIONS";
}

/** Two lines per session: its title, then when it was last touched and how long it is. */
function sessionLines(env: PanelEnv, selection: Selection, width: number): string[] {
	refreshSessions(env.state);
	const t = env.theme();
	const data = sessions(env.state);
	if (data.error) return [truncateToWidth(t.fg("error", ` ${data.error}`), width)];
	if (!data.sessions.length) return [t.fg("dim", data.loading ? " -- scanning --" : " -- no sessions --")];
	const lines: string[] = [];
	const now = Date.now();
	data.sessions.forEach((session, index) => {
		selection.place(index, lines.length, 2);
		lines.push(truncateToWidth(titleLine(env, session), width));
		lines.push(truncateToWidth(metaLine(env, session, now), width));
	});
	if (data.loading) lines.push(t.fg("dim", " -- updating --"));
	return lines;
}

function titleLine(env: PanelEnv, session: SessionItem): string {
	const t = env.theme();
	if (session.active) return `${t.fg("accent", "◆")}${t.fg("accent", t.bold(session.title))}`;
	return ` ${t.fg("text", session.title)}`;
}

function metaLine(env: PanelEnv, session: SessionItem, now: number): string {
	const t = env.theme();
	const parts = [
		session.active ? "ACTIVE" : ago(now, session.modified),
		`${session.messageCount} msgs`,
		...(session.forked ? ["forked"] : []),
	];
	return `   ${t.fg(session.active ? "muted" : "dim", parts.join(" · "))}`;
}

/** How long ago, in the largest unit that fits; a date past a month. */
function ago(now: number, when: Date): string {
	const minutes = Math.max(0, Math.floor((now - when.getTime()) / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return when.toISOString().slice(0, 10);
}

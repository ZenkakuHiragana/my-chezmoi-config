/**
 * DATA's QUESTS panel: the project's sessions, the one in progress first.
 * The arrow keys or j/k select a quest and Enter switches to its session.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import { openQuest, type Quest, quests, refreshQuests } from "../features/quests.ts";
import { framed } from "../screen/frame.ts";
import { ListLines, Selection, themeStamp, withCursor } from "./common.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("quests", (env) => {
	const selection = new Selection(
		() => quests(env.state).quests.length,
		(index) => {
			const quest = quests(env.state).quests[index];
			if (quest) openQuest(env.state, quest);
		},
	);
	const panel = framed(
		env.theme,
		() => questTitle(env),
		new ListLines(
			selection,
			(width) => {
				selection.reset();
				return withCursor(env, selection, "quests", questLines(env, selection, width - 1));
			},
			() => [quests(env.state).version, selection.index, env.focused("quests"), themeStamp(env.theme())],
		),
		"top",
		() => env.focused("quests"),
	);
	selection.scroll = panel.scroll;
	return { ...panel, list: selection };
});

function questTitle(env: PanelEnv): string {
	const list = quests(env.state).quests;
	return list.length ? `QUESTS  ${list.length}` : "QUESTS";
}

/** Two lines per quest: its title, then when it was last touched and how long it is. */
function questLines(env: PanelEnv, selection: Selection, width: number): string[] {
	refreshQuests(env.state);
	const t = env.theme();
	const data = quests(env.state);
	if (data.error) return [truncateToWidth(t.fg("error", ` ${data.error}`), width)];
	if (!data.quests.length) return [t.fg("dim", data.loading ? " -- scanning --" : " -- no sessions --")];
	const lines: string[] = [];
	const now = Date.now();
	data.quests.forEach((quest, index) => {
		selection.place(index, lines.length, 2);
		lines.push(truncateToWidth(titleLine(env, quest), width));
		lines.push(truncateToWidth(metaLine(env, quest, now), width));
	});
	if (data.loading) lines.push(t.fg("dim", " -- updating --"));
	return lines;
}

function titleLine(env: PanelEnv, quest: Quest): string {
	const t = env.theme();
	if (quest.active) return `${t.fg("accent", "◆")}${t.fg("accent", t.bold(quest.title))}`;
	return ` ${t.fg("text", quest.title)}`;
}

function metaLine(env: PanelEnv, quest: Quest, now: number): string {
	const t = env.theme();
	const parts = [
		quest.active ? "ACTIVE" : ago(now, quest.modified),
		`${quest.messageCount} msgs`,
		...(quest.forked ? ["forked"] : []),
	];
	return `   ${t.fg(quest.active ? "muted" : "dim", parts.join(" · "))}`;
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

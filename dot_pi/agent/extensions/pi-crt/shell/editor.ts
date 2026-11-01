/**
 * The editor's top border as pi-crt's status line: WORKING with a spinner and the
 * elapsed time while the agent runs, STANDBY otherwise, and in panel mode the
 * selected panel and the key hints after it.
 *
 * The editor is Pi's CustomEditor, set with setEditorComponent; it draws the label
 * in renderTopBorder, the border hook Editor leaves to subclasses (as in Pi's
 * border-status-editor example). Pi's own working indicator is hidden
 * (setWorkingVisible) so that WORKING is not shown twice; this editor does not
 * embed status, so Pi shows its other indicators (retry, compaction, branch
 * summary) in the line above the editor. Another extension that sets an editor
 * replaces this one, and pi-crt then leaves the keys to Pi.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CustomEditor, keyHint } from "@earendil-works/pi-coding-agent";
import { elapsedText, SPINNER } from "../panels/common.ts";
import type { Shell } from "./controller.ts";
import { panelHints, typingList } from "./input.ts";

type EditorArgs = ConstructorParameters<typeof CustomEditor>;

/** The status label, cut to `width` cells. */
function borderLabel(shell: Shell, width: number): string {
	const t = shell.theme();
	const state = shell.state;
	const status = state.agentRunning
		? `${t.fg("warning", SPINNER[shell.tick() % SPINNER.length]!)} ${t.fg("warning", t.bold("WORKING"))} ${t.fg("muted", elapsedText(state.agentStartedAt))}  ${keyHint("app.interrupt", "to interrupt")}`
		: t.fg("accent", t.bold("■ STANDBY"));
	if (!(shell.panelMode() && shell.tabsShown())) return truncateToWidth(status, width);
	// What fits, in this order: the status, the panel-mode mark, the panel name,
	// then the key hints (cut from the end).
	const mark = ` ${t.fg("borderMuted", "─")} ${t.fg("accent", t.bold("◆"))}`;
	const name = t.fg("accent", t.bold(` ${(shell.focusedId() ?? "").toUpperCase()}`));
	if (visibleWidth(status) + visibleWidth(mark) > width) return truncateToWidth(status, width);
	let label = status + mark;
	if (visibleWidth(label) + visibleWidth(name) > width) return label;
	label += name;
	const left = width - visibleWidth(label);
	return left > 8 ? label + truncateToWidth(`  ${panelHints(shell.theme)}`, left) : label;
}

/**
 * Pi's editor with pi-crt's border. `onRender` runs on every frame (the shell keeps
 * its screen mounted across mode switches from there).
 */
export function crtEditor(shell: Shell, onRender: () => void, ...args: EditorArgs): CustomEditor {
	class CrtEditor extends CustomEditor {
		override render(width: number): string[] {
			onRender();
			// While a panel's text field is typed into, the field places the terminal
			// cursor (and with it the IME's candidates); Pi takes the lowest marker on
			// screen, which would otherwise be the editor's.
			if (!typingList(shell)) return super.render(width);
			const focused = this.focused;
			this.focused = false;
			try {
				return super.render(width);
			} finally {
				this.focused = focused;
			}
		}

		/** `── label ───── ↑ N more ──`: the label, and how many lines the editor scrolled away. */
		protected override renderTopBorder(width: number, hiddenLineCount: number): string {
			const more = hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : "";
			const tail = more ? 2 : 0;
			// "── " before the label and a space after it.
			const room = width - 4 - visibleWidth(more) - tail;
			if (room < 1) return super.renderTopBorder(width, hiddenLineCount);
			const label = borderLabel(shell, room);
			const fill = width - 4 - visibleWidth(label) - visibleWidth(more) - tail;
			return `${this.borderColor("── ")}${label}${this.borderColor(` ${"─".repeat(Math.max(0, fill))}${more}${"─".repeat(tail)}`)}`;
		}
	}
	return new CrtEditor(...args);
}

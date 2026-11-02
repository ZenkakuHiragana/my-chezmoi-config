/**
 * The editor's top border as pi-crt's status line: WORKING with a spinner and the
 * elapsed time while the agent runs, STANDBY otherwise, and in panel mode the
 * selected panel and the key hints after it. For a second after typed text was
 * ignored, `ALT+O TO TYPE` takes the place of the panel's name and blinks, as a tab
 * blinks to ask for attention (screen/tabbar.ts).
 *
 * The editor is Pi's CustomEditor, set with setEditorComponent; it draws the label
 * in renderTopBorder, the border hook Editor leaves to subclasses (as in Pi's
 * border-status-editor example). Pi's own working indicator is hidden
 * (setWorkingVisible) so that WORKING is not shown twice; this editor does not
 * embed status, so Pi shows its other indicators (retry, compaction, branch
 * summary) in the line above the editor. Another extension that sets an editor
 * replaces this one, and pi-crt then leaves the keys to Pi.
 */
import { renderFakeCursor, truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
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
	// then the key hints (cut from the end). ALT+O TO TYPE, in the name's place, is
	// cut to what is left rather than left out, without its spaces when they do not fit.
	const mark = ` ${t.fg("borderMuted", "─")} ${t.fg("accent", t.bold("◆"))}`;
	if (visibleWidth(status) + visibleWidth(mark) > width) return truncateToWidth(status, width);
	let label = status + mark;
	if (shell.typingIgnored()) {
		const left = width - visibleWidth(label);
		const text = left >= 14 ? " ALT+O TO TYPE" : truncateToWidth("ALT+O TO TYPE", left, "");
		label += t.fg(shell.tick() % 8 < 4 ? "warning" : "accent", t.bold(text));
	} else {
		// The panel's name, as its title rule shows it (without what the title adds after two spaces).
		const id = shell.focusedId();
		const title = id ? (shell.handleFor(id).title?.() ?? "") : "";
		const name = t.fg("accent", t.bold(` ${title.split("  ")[0]}`));
		if (visibleWidth(label) + visibleWidth(name) > width) return label;
		label += name;
	}
	const left = width - visibleWidth(label);
	return left > 8 ? label + truncateToWidth(`  ${panelHints(shell.theme)}`, left) : label;
}

/**
 * Marks the line renderBottomBorder draws, for render to find and remove: an APC
 * sequence, which takes no cell and which typed text cannot contain.
 */
const BOTTOM_MARK = "\x1b_pi-crt:bottom\x07";

/**
 * The line of an empty editor while a panel has the keys: the cursor, then hatching
 * with how to type in its middle, as a field that does not take keys.
 */
function emptyLine(paddingX: number, width: number): string {
	// The editor's padding, as much of it as leaves room for the cursor; the line is
	// cut to the width below. On a screen narrower than the padding, the cursor may sit
	// apart from where the editor draws it once it has the keys.
	const padding = Math.min(paddingX, Math.max(0, width - 1));
	const inner = width - padding * 2;
	const hint = " alt+o to type ";
	// The hint is centred in the field, the cursor's cell included.
	const before = Math.max(0, Math.floor((inner - hint.length) / 2) - 1);
	const after = Math.max(0, inner - 1 - before - hint.length);
	const line = `${" ".repeat(padding)}${renderFakeCursor(" ")}${"╱".repeat(before)}${hint}${"╱".repeat(after)}${" ".repeat(padding)}`;
	return truncateToWidth(line, width, "");
}

/**
 * Pi's editor with pi-crt's border. `onRender` runs on every frame (the shell keeps
 * its screen mounted across mode switches from there).
 */
export function crtEditor(shell: Shell, onRender: () => void, ...args: EditorArgs): CustomEditor {
	class CrtEditor extends CustomEditor {
		override handleInput(data: string): void {
			const before = this.getText();
			super.handleInput(data);
			if (shell.tabsShown() && shell.panelMode() && this.getText() !== before) {
				shell.setPanelMode(false);
				shell.requestRender();
			}
		}

		override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			const result = super.handleMouse(event);
			if (event.type === "click" && event.button === "left" && result?.handled && shell.tabsShown()) {
				typingList(shell)?.key?.("\x1b");
				shell.setPanelMode(false);
				shell.requestRender();
			}
			return result;
		}

		override render(width: number): string[] {
			onRender();
			if (!(shell.tabsShown() && shell.panelMode())) return super.render(width);
			// While a panel has the keys, the editor shows that the keys are not here: no
			// terminal cursor (a panel's text field places it, and with it the IME's
			// candidates), and its text and cursor drawn faint; an empty editor is hatched
			// and says how to type into it. The borders are not drawn faint: their colour
			// shows the thinking level, and the top border's label names the panel that
			// has the keys.
			const focused = this.focused;
			this.focused = false;
			try {
				const [top = "", ...rest] = super.render(width);
				if (this.getText() === "" && rest.length > 1) rest[0] = emptyLine(this.getPaddingX(), width);
				return [
					top,
					...rest.map((line) => (line.startsWith(BOTTOM_MARK) ? line.slice(BOTTOM_MARK.length) : `\x1b[2m${line}\x1b[22m`)),
				];
			} finally {
				this.focused = focused;
			}
		}

		/** The bottom border, marked while a panel has the keys so that render can tell it from the text. */
		protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
			const border = super.renderBottomBorder(width, hiddenLineCount);
			return shell.tabsShown() && shell.panelMode() ? `${BOTTOM_MARK}${border}` : border;
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

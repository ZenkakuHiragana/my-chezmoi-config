/** The tab shortcuts and the keys routed to the selected panel. */
import { decodeKittyPrintable, isKeyRelease, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { type ExtensionAPI, rawKeyHint } from "@earendil-works/pi-coding-agent";
import tabs from "../layout.ts";
import type { ListControl, PanelHandle } from "../panels/registry.ts";
import type { ThemeRef } from "../screen/lines.ts";
import type { Shell } from "./controller.ts";

const PASS_THROUGH: KeyId[] = ["escape", "ctrl+c", "alt+o", "alt+h", "alt+j", "alt+k", "alt+l", ...Array.from({ length: 9 }, (_, i): KeyId => `alt+${i + 1}` as KeyId)];

/** The panel-mode keys, as the editor border shows them. */
export function panelHints(theme: ThemeRef): string {
	return [
		rawKeyHint("↑↓/jk", "move"),
		rawKeyHint("tab", "panel"),
		rawKeyHint("enter", "open"),
		rawKeyHint("z", "max"),
		rawKeyHint("alt+o", "editor"),
	].join(theme().fg("dim", " · "));
}

/**
 * The text a key types, when it types any: a character, IME-committed text, or a
 * paste. Keys with Ctrl or Alt type nothing; they are Pi's shortcuts. A character
 * comes as itself, or in the form of the keyboard protocol Pi turned on: Kitty's
 * (CSI u), or xterm's modifyOtherKeys (`CSI 27 ; modifier ; code ~`), which Pi uses
 * when the terminal has no Kitty protocol.
 */
function typedText(data: string): string | undefined {
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	const other = /^\x1b\[27;(\d+);(\d+)~$/.exec(data);
	if (other) {
		// The modifier is 1 + a bit mask: shift 1, alt 2, ctrl 4, …, caps lock 64, num lock 128.
		const modifiers = (Number(other[1]) - 1) & ~(64 | 128);
		const code = Number(other[2]);
		return (modifiers & ~1) === 0 && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
	}
	if (data.startsWith("\x1b[200~")) return data;
	return [...data].every((ch) => {
		const code = ch.charCodeAt(0);
		return code >= 32 && code !== 0x7f && (code < 0x80 || code > 0x9f);
	})
		? data
		: undefined;
}

/** The focused panel's list while one of its text fields is typed into (see ListControl.typing). */
export function typingList(shell: Shell): ListControl | undefined {
	if (!shell.panelMode() || !shell.tabsShown()) return undefined;
	const id = shell.focusedId();
	const list = id ? shell.handleFor(id).list : undefined;
	return list?.typing?.() ? list : undefined;
}

export function setupInput(pi: ExtensionAPI, shell: Shell): void {
	let unsubscribe: (() => void) | undefined;

	const focusedHandle = () => {
		const id = shell.focusedId();
		return id ? shell.handleFor(id) : undefined;
	};

	const pageSize = (handle: PanelHandle) => Math.max(1, (handle.scroll?.viewportHeight ?? 2) - 1);

	const panelAction = (data: string): boolean => {
		const handle = focusedHandle();
		if (matchesKey(data, "down") || matchesKey(data, "j")) handle?.list ? handle.list.move(1) : handle?.scroll?.scrollBy(1);
		else if (matchesKey(data, "up") || matchesKey(data, "k")) handle?.list ? handle.list.move(-1) : handle?.scroll?.scrollBy(-1);
		else if (matchesKey(data, "home")) handle?.list ? handle.list.toStart() : handle?.scroll?.scrollToStart();
		else if (matchesKey(data, "end")) handle?.list ? handle.list.toEnd() : handle?.scroll?.scrollToEnd();
		else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			const ids = shell.visiblePanels();
			if (ids.length) {
				const step = matchesKey(data, "tab") ? 1 : -1;
				const at = Math.max(0, ids.indexOf(shell.focusedId() ?? ""));
				shell.focusPanel(ids[(at + step + ids.length) % ids.length]!);
			}
		} else if (matchesKey(data, "enter")) handle?.list?.activate();
		else if (matchesKey(data, "z")) shell.toggleMaximized();
		else if (!handle?.list?.key?.(data)) return false;
		return true;
	};

	/**
	 * PageUp / PageDown page the page's primary panel, whether the editor or the
	 * panels have the keys. A list goes on to select the item at the top, so that the
	 * arrow keys continue from what is on screen. Returns false when the keys are left
	 * to Pi: the transcript, which Pi itself scrolls, or nothing to page.
	 */
	const pagePrimary = (data: string): boolean => {
		const up = matchesKey(data, "pageUp");
		if (!up && !matchesKey(data, "pageDown")) return false;
		const id = shell.primaryPanel();
		if (!id || id === "transcript") return false;
		const handle = shell.handleFor(id);
		if (handle.list) handle.list.page(up ? -1 : 1);
		else if (handle.scroll) handle.scroll.scrollBy((up ? -1 : 1) * pageSize(handle));
		else return false;
		shell.requestRender();
		return true;
	};

	/**
	 * Raw input ahead of Pi. Takes PageUp / PageDown for the page's primary panel
	 * (pagePrimary); every key but ctrl+c while a panel's text field is typed into;
	 * and, while the panels have the keys, the keys the selected panel uses and the
	 * text it has no use for (but `/` and `!` in an empty editor). The rest goes on to
	 * Pi. `editorEmpty` tells whether Pi's editor holds no text.
	 */
	const onInput = (data: string, editorEmpty: () => boolean): { consume?: boolean } | undefined => {
		// Keys belong to Pi when the tabs are not on screen or something other than the
		// editor (a selector, a dialog) has the focus.
		if (!shell.tabsShown() || !shell.editorFocused()) return undefined;
		// Pi asks the terminal to report key releases (Kitty keyboard protocol), and raw
		// listeners get them too; acting on them would run every key twice.
		if (isKeyRelease(data)) return undefined;
		const typing = typingList(shell);
		if (typing) {
			if (matchesKey(data, "ctrl+c")) return undefined;
			// Alt+O gives the keys to the editor wherever it is pressed; closing the
			// field first, as a click on the editor does.
			if (matchesKey(data, "alt+o")) {
				typing.key?.("\x1b");
				shell.setPanelMode(false);
			} else typing.key?.(data);
			shell.requestRender();
			return { consume: true };
		}
		if (pagePrimary(data)) return { consume: true };
		if (!shell.panelMode()) return undefined;
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) return undefined;
		if (PASS_THROUGH.some((key) => matchesKey(data, key))) return undefined;
		if (!panelAction(data)) {
			// Text a panel has no use for is not typed into the editor, so that a stray
			// key and Enter cannot send a prompt. In an empty editor, `/` (a command) and
			// `!` (a shell command) start one and give the editor the keys; after other
			// text they start nothing. Other keys (Pi's shortcuts) go on to Pi.
			const text = typedText(data);
			if (text === undefined) return undefined;
			if ((text === "/" || text === "!") && editorEmpty()) {
				shell.setPanelMode(false);
				shell.requestRender();
				return undefined;
			}
			shell.ignoreTyping();
		}
		shell.requestRender();
		return { consume: true };
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		unsubscribe?.();
		const ui = ctx.ui;
		unsubscribe = ui.onTerminalInput((data) => onInput(data, () => ui.getEditorText() === ""));
	});

	pi.on("session_shutdown", () => {
		unsubscribe?.();
		unsubscribe = undefined;
	});

	tabs.slice(0, 9).forEach((tab, index) => {
		pi.registerShortcut(`alt+${index + 1}` as "alt+1", {
			description: `pi-crt: show the ${tab.label} tab`,
			handler: () => shell.selectTab(index),
		});
	});
	pi.registerShortcut("alt+j", {
		description: "pi-crt: next tab",
		handler: () => shell.stepTab(1),
	});
	pi.registerShortcut("alt+k", {
		description: "pi-crt: previous tab",
		handler: () => shell.stepTab(-1),
	});
	pi.registerShortcut("alt+h", {
		description: "pi-crt: previous inner tab",
		handler: () => shell.stepPage(-1),
	});
	pi.registerShortcut("alt+l", {
		description: "pi-crt: next inner tab",
		handler: () => shell.stepPage(1),
	});
	pi.registerShortcut("alt+o", {
		description: "pi-crt: switch the keys between editor and panels",
		handler: () => {
			if (!shell.tabsShown()) return;
			shell.setPanelMode(!shell.panelMode());
			shell.requestRender();
		},
	});
}

/**
 * The keys of the tabbed screen: the tab shortcuts, and panel mode, in which the
 * panels have the keys (alt+o to enter, esc to leave).
 */
import { isKeyRelease, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { type ExtensionAPI, rawKeyHint } from "@earendil-works/pi-coding-agent";
import tabs from "../layout.ts";
import type { ListControl, PanelHandle } from "../panels/registry.ts";
import type { ThemeRef } from "../screen/lines.ts";
import type { Shell } from "./controller.ts";

/** Keys that keep their usual meaning while the panels have the keys. */
const PASS_THROUGH: KeyId[] = ["ctrl+c", "alt+h", "alt+j", "alt+k", "alt+l", ...Array.from({ length: 9 }, (_, i): KeyId => `alt+${i + 1}` as KeyId)];

/** The panel-mode keys, as the editor border shows them. */
export function panelHints(theme: ThemeRef): string {
	return [
		rawKeyHint("↑↓/jk", "move"),
		rawKeyHint("tab", "panel"),
		rawKeyHint("enter", "open"),
		rawKeyHint("z", "max"),
		rawKeyHint("esc", "back"),
	].join(theme().fg("dim", " · "));
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
		if (matchesKey(data, "escape") || matchesKey(data, "alt+o")) shell.setPanelMode(false);
		else if (matchesKey(data, "down") || matchesKey(data, "j")) handle?.list ? handle.list.move(1) : handle?.scroll?.scrollBy(1);
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
	 * Raw input, ahead of the editor and Pi's keys. While the panels have the keys,
	 * every key is taken (so nothing is typed into the editor) except the tab
	 * shortcuts, ctrl+c, and PageUp / PageDown on the transcript; while a panel's
	 * text field is typed into, every key but ctrl+c goes to that field (see
	 * ListControl.typing). While the editor has them, only PageUp / PageDown are
	 * taken (see pagePrimary).
	 */
	const onInput = (data: string): { consume?: boolean } | undefined => {
		// Keys belong to Pi when the tabs are not on screen or something other than the
		// editor (a selector, a dialog) has the focus.
		if (!shell.tabsShown() || !shell.editorFocused()) {
			if (shell.panelMode()) {
				shell.setPanelMode(false);
				shell.requestRender();
			}
			return undefined;
		}
		// Pi asks the terminal to report key releases (Kitty keyboard protocol), and raw
		// listeners get them too; acting on them would run every key twice.
		if (isKeyRelease(data)) return shell.panelMode() ? { consume: true } : undefined;
		const typing = typingList(shell);
		if (typing) {
			if (matchesKey(data, "ctrl+c")) return undefined;
			typing.key?.(data);
			shell.requestRender();
			return { consume: true };
		}
		if (pagePrimary(data)) return { consume: true };
		if (!shell.panelMode()) return undefined;
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) return undefined;
		if (PASS_THROUGH.some((key) => matchesKey(data, key))) return undefined;
		panelAction(data);
		shell.requestRender();
		return { consume: true };
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		unsubscribe?.();
		unsubscribe = ctx.ui.onTerminalInput(onInput);
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
		description: "pi-crt: move the keys to the panels (esc returns them to the editor)",
		handler: () => {
			if (!shell.tabsShown()) return;
			shell.setPanelMode(true);
			shell.requestRender();
		},
	});
}

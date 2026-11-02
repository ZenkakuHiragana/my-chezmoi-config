/**
 * The tabbed screen itself: which tab, inner tab and panel are shown, and how the
 * screen is mounted into Pi's fullscreen TUI.
 *
 * Pi's fullscreen root is VStack([transcript ScrollView, dock]), where the dock
 * holds the pending messages, the working row, widgets, editor and footer
 * (chat-viewport.js in pi-coding-agent). The shell keeps the dock as is, so the
 * editor and Pi's footer stay on every tab, and swaps what sits above it:
 *
 *   VStack([tab bar, inner tab bar, body of the shown page, dock])
 *
 * The transcript ScrollView is one of the panels a page can place, so Pi keeps
 * drawing the conversation itself (Mermaid, images, other extensions' views).
 * Tool calls are drawn in the execution log panel instead of the transcript.
 *
 * Depends on two Pi internals that have no public API: the private
 * `layoutRoot` field of the fullscreen TUI (read only in `piRoot`) and the
 * two-child shape of the root. ViewportTUI offers setLayoutRoot but no getter;
 * extensions that rearrange the fullscreen screen (pi-split-view, pi-magi-theme)
 * read the same field, and a public getter was asked for in earendil-works/pi#9238
 * (closed unanswered). When either does not match, the extension leaves Pi's
 * screen alone, including the tool calls in the transcript.
 *
 * Cost: each redraw of the screen also redraws the panels shown, so the screen
 * is redrawn on a timer only while something moves (the agent works, a tab
 * blinks, a NO SIGNAL page is shown) and otherwise once a minute for the clock.
 */
import {
	type Component,
	isViewportTUI,
	type OverlayHandle,
	Text,
	type TUI,
	TuiAltScreen,
	TuiMainScreen,
	type ViewportTUI,
	VStack,
} from "@earendil-works/pi-tui";
import type { CustomEditor, ExtensionAPI, ExtensionContext, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import tabs from "../layout.ts";
import type { FeatureEnv } from "../features/env.ts";
import { PANELS, type PanelEnv, type PanelHandle } from "../panels/registry.ts";
import { framed } from "../screen/frame.ts";
import { buildArrangement, type BuiltArrangement, type Guide, type PageDef, type ScreenHost, type TabDef } from "../screen/layout.ts";
import { noSignal } from "../screen/nosignal.ts";
import { TabBar } from "../screen/tabbar.ts";
import { type CrtState, createState, type Versioned } from "../state/core.ts";
import { crtEditor } from "./editor.ts";

const BASE = Symbol.for("pi-crt.base-root");
/**
 * Set by an instance that shuts down while its tabs are on screen, for /reload
 * or a session switch (/new, /resume, /fork). Pi then draws the transcript with
 * the next instance's renderers before that instance gets session_start
 * (agent-session.js reload() calls beforeSessionStart first; on a switch,
 * interactive-mode.js rebindCurrentSession renders before it binds), so the next
 * instance needs this to hide the tool calls drawn then.
 *
 * The value is process-wide, and every session in the process runs index.ts,
 * subagent sessions included. Only the interactive session draws tool calls or
 * starts in the TUI, so only that instance takes it (takeCarry), when it first
 * does either; a subagent session started in between leaves it alone.
 */
const CARRY_TABS_SHOWN = Symbol.for("pi-crt.carry-tabs-shown");
const carried = globalThis as { [CARRY_TABS_SHOWN]?: boolean };
const FRAME_MS = 120;

/**
 * Renderers that draw nothing. With an empty "self" shell, Pi's
 * ToolExecutionComponent renders no lines, so the call leaves the transcript.
 * Images in a tool result are drawn by the component itself and stay.
 */
const HIDDEN: ToolRenderers = {
	renderShell: "self",
	renderCall: () => new Text("", 0, 0),
	renderResult: () => new Text("", 0, 0),
};

type RootWithBase = Component & { [BASE]?: Component };

/** The root the fullscreen TUI shows now: its private `layoutRoot` field, the one place pi-crt reads it. */
function piRoot(tui: ViewportTUI): RootWithBase | undefined {
	return (tui as unknown as { layoutRoot?: RootWithBase }).layoutRoot;
}

const pagesOf = (tab: TabDef): PageDef[] =>
	"pages" in tab ? tab.pages : [{ label: tab.label, layout: tab.layout, primary: tab.primary }];

/** What the keys (shell/input.ts) and the editor border (shell/editor.ts) use of the shell. */
export interface Shell {
	readonly state: CrtState;
	/** What the features in features/ get. */
	readonly features: FeatureEnv;
	theme(): Theme;
	/** Animation frame number derived from the clock. */
	tick(): number;
	requestRender(): void;
	/** The tabs are on screen (fullscreen, root mounted). */
	tabsShown(): boolean;
	/** Pi's editor has the keys (not a selector or a dialog). */
	editorFocused(): boolean;
	/** The panels have the keys. */
	panelMode(): boolean;
	setPanelMode(on: boolean): void;
	/** Panels of the shown page, in layout order. */
	visiblePanels(): string[];
	/** The selected panel of the shown page. */
	focusedId(): string | undefined;
	/** The panel PageUp / PageDown scroll while the editor has the keys. */
	primaryPanel(): string | undefined;
	handleFor(id: string): PanelHandle;
	/** Select a panel of the shown page. */
	focusPanel(id: string): void;
	/** Maximize the selected panel, or put the page back. */
	toggleMaximized(): void;
	selectTab(index: number): void;
	/** Show the next (step 1) or previous (step -1) tab, wrapping around. */
	stepTab(step: number): void;
	/** Show the next (step 1) or previous (step -1) inner tab of the shown tab, wrapping around. */
	stepPage(step: number): void;
}

export function createShell(pi: ExtensionAPI): Shell {
	const state = createState();
	const pages = tabs.map(pagesOf);
	let ctxRef: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let editor: CustomEditor | undefined;
	let baseRoot: Component | undefined;
	let transcript: Component | undefined;
	let transcriptHandle: PanelHandle | undefined;
	let dock: Component | undefined;
	let activeTab = 0;
	const activePage = tabs.map(() => 0);
	let panelMode = false;
	/** Selected panel and maximized panel, per page. */
	const focus = new Map<string, string>();
	const maximized = new Map<string, string>();
	/**
	 * The tabs are on screen (fullscreen, root mounted). While they are, tool calls
	 * are hidden from the transcript and the panels take keys. Pi asks for a call's
	 * renderers when it creates the call's block, so blocks made in one mode keep
	 * that mode's look until Pi rebuilds the transcript (/reload, a session switch).
	 */
	let tabsShown = false;
	let carryTaken = false;
	/** Take what the previous instance carried over (see CARRY_TABS_SHOWN), once. */
	const takeCarry = () => {
		if (carryTaken) return;
		carryTaken = true;
		if (carried[CARRY_TABS_SHOWN] === true) tabsShown = true;
		delete carried[CARRY_TABS_SHOWN];
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	let animating = false;
	let warnedShape = false;
	const roots = new Map<string, Component>();
	const arrangements = new Map<string, BuiltArrangement>();
	const shownListeners: Array<() => void> = [];
	/** Pi's overlay showing where a dragged boundary would go. */
	let guideOverlay: OverlayHandle | undefined;
	/**
	 * The layout's view of the screen: the terminal size that the shares in layout.ts
	 * are taken of, and a guide line drawn as a non-capturing overlay while a
	 * boundary is dragged, so the panels are not laid out again on every step.
	 */
	const screenHost: ScreenHost = {
		size: () => ({ width: tui?.terminal.columns ?? 0, height: tui?.terminal.rows ?? 0 }),
		preview: (guide: Guide | undefined) => {
			guideOverlay?.hide();
			guideOverlay = undefined;
			if (!guide || !tui) return;
			const line = guide.axis === "row" ? "\u2503" : "\u2501".repeat(guide.length);
			const rows = guide.axis === "row" ? guide.length : 1;
			const component: Component = {
				render: () => Array.from({ length: rows }, () => theme().fg("borderAccent", line)),
				invalidate: () => {},
			};
			guideOverlay = tui.showOverlay(component, {
				row: guide.y,
				col: guide.x,
				width: guide.axis === "row" ? 1 : guide.length,
				maxHeight: rows,
				nonCapturing: true,
			});
		},
	};
	const panelCache = new Map<string, PanelHandle>();
	/** Pi's renderer lookup for each tool, past pi-crt's own resolver. */
	const nextRenderers = new Map<string, () => ToolRenderers | undefined>();

	const theme = () => ctxRef!.ui.theme;
	const tick = () => Math.floor(Date.now() / FRAME_MS);
	const pageKey = (tab: number, page: number) => `${tab}:${page}`;
	const currentKey = () => pageKey(activeTab, activePage[activeTab]!);
	const currentPage = () => pages[activeTab]![activePage[activeTab]!];
	const requestRender = () => tui?.requestRender();
	const changed = (data: Versioned) => {
		data.version++;
		requestRender();
	};
	const notifyShown = () => {
		for (const listener of shownListeners) listener();
	};

	const env: PanelEnv = {
		theme,
		state,
		tick,
		focused: (id) => panelMode && focusedId() === id,
		tui: () => tui,
		renderersFor: (name) => nextRenderers.get(name)?.(),
		cwd: () => ctxRef?.cwd ?? process.cwd(),
	};

	const handleFor = (id: string): PanelHandle => {
		if (id === "transcript") {
			if (!transcript) throw new Error("transcript is not available");
			// Pi's own transcript under the same title rule as the other panels. It stays
			// at the left edge and full width when it spans the screen, which Pi needs to
			// draw images whose top has scrolled out of view.
			transcriptHandle ??= {
				...framed(theme, () => "TRANSCRIPT", transcript, "none", () => env.focused("transcript")),
				scroll: transcript as PanelHandle["scroll"],
			};
			return transcriptHandle;
		}
		let handle = panelCache.get(id);
		if (!handle) {
			const factory = PANELS.get(id);
			if (!factory) throw new Error(`unknown panel "${id}"`);
			handle = factory(env);
			panelCache.set(id, handle);
		}
		return handle;
	};

	const arrangementFor = (key: string, page: PageDef): BuiltArrangement => {
		let built = arrangements.get(key);
		if (!built) {
			try {
				built = buildArrangement(page.layout, (id) => handleFor(id).component, theme, screenHost);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				built = { component: noSignal(theme, () => `LAYOUT ERROR: ${message}`), panelsAt: () => [] };
			}
			arrangements.set(key, built);
		}
		return built;
	};

	const screenWidth = () => tabBar.lastWidth || tui?.terminal.columns || 80;

	/** Panels a page shows at the current width (or its maximized panel), in layout order. */
	const panelsOf = (tab: number, page: number): string[] => {
		const key = pageKey(tab, page);
		const max = maximized.get(key);
		if (max) return [max];
		return arrangementFor(key, pages[tab]![page]!).panelsAt(screenWidth());
	};

	/** Panels of the shown page. */
	const visiblePanels = (): string[] => panelsOf(activeTab, activePage[activeTab]!);

	/** Pages that would show the conversation now; the agent finishing elsewhere makes them blink. */
	const showsTranscript = (tab: number, page: number) => panelsOf(tab, page).includes("transcript");

	/**
	 * Whether Pi's editor has the keys (not a selector or a dialog). The TUI interface
	 * Pi passes has no focus query; pi-tui's two screens (both exported) have one.
	 */
	const editorFocused = () =>
		editor !== undefined && (tui instanceof TuiAltScreen || tui instanceof TuiMainScreen) && tui.getFocusedComponent() === editor;

	/** The page's `primary` panel present now, else the transcript, else the first scrollable panel. */
	const primaryPanel = (): string | undefined => {
		const ids = visiblePanels();
		const wanted = currentPage()?.primary;
		for (const id of wanted === undefined ? [] : Array.isArray(wanted) ? wanted : [wanted]) if (ids.includes(id)) return id;
		if (ids.includes("transcript")) return "transcript";
		return ids.find((id) => handleFor(id).scroll) ?? ids[0];
	};

	/**
	 * The panel the panel-mode keys act on: the one picked with tab, else the first
	 * list (the arrow keys select in it while PageUp / PageDown page the primary
	 * panel), else the primary panel.
	 */
	const focusedId = (): string | undefined => {
		const ids = visiblePanels();
		const chosen = focus.get(currentKey());
		if (chosen && ids.includes(chosen)) return chosen;
		return ids.find((id) => id !== "transcript" && handleFor(id).list) ?? primaryPanel();
	};

	const blinkOn = () => state.termAttention && tick() % 8 < 4;

	const clock = () => {
		const t = theme();
		const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		const rad = state.agentRunning ? t.fg(tick() % 6 < 3 ? "warning" : "muted", "☢") : t.fg("dim", "☢");
		return `${rad} ${t.fg("muted", time)}`;
	};

	// Every tab has the same two bars; a tab with one layout shows it as its only inner tab.
	const tabBar = new TabBar({
		theme,
		labels: () => tabs.map((tab) => tab.label),
		active: () => activeTab,
		blinking: (index) => blinkOn() && pages[index]!.some((_page, p) => showsTranscript(index, p)),
		right: clock,
		onSelect: (index) => selectTab(index),
	});

	const pageBar = new TabBar({
		theme,
		inner: true,
		anchor: (width) => tabBar.activeMiddle(width),
		labels: () => pages[activeTab]!.map((page) => page.label),
		active: () => activePage[activeTab]!,
		blinking: (index) => blinkOn() && showsTranscript(activeTab, index),
		onSelect: (index) => selectPage(index),
	});

	const rootFor = (): Component => {
		const key = currentKey();
		const max = maximized.get(key);
		const rootKey = `${key}|${max ?? ""}`;
		let root = roots.get(rootKey);
		if (!root) {
			const body = max ? handleFor(max).component : arrangementFor(key, currentPage()!).component;
			root = new VStack([
				{ component: tabBar, basis: 1, grow: 0, shrink: 0, minSize: 1 },
				{ component: pageBar, basis: 1, grow: 0, shrink: 0, minSize: 1 },
				{ component: body, basis: 0, grow: 1, shrink: 1, minSize: 1 },
				{ component: dock!, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
			]);
			(root as RootWithBase)[BASE] = baseRoot;
			roots.set(rootKey, root);
		}
		return root;
	};

	const setTabsShown = (shown: boolean) => {
		if (shown === tabsShown) return;
		tabsShown = shown;
		updateTimer();
		notifyShown();
	};

	/** Capture Pi's fullscreen root (unwrapping ours after /reload) and mount the shown page. */
	const attach = () => {
		if (!tui) return;
		if (!isViewportTUI(tui)) {
			setTabsShown(false);
			return;
		}
		const current = piRoot(tui);
		const base = current?.[BASE] ?? current;
		const children = (base as { children?: Component[] } | undefined)?.children;
		const first = children?.[0] as { scrollTo?: unknown } | undefined;
		if (!base || children?.length !== 2 || typeof first?.scrollTo !== "function") {
			setTabsShown(false);
			if (!warnedShape) {
				warnedShape = true;
				ctxRef?.ui.notify("pi-crt: Pi's fullscreen layout has an unexpected shape; tabs are disabled", "warning");
			}
			return;
		}
		setTabsShown(true);
		if (base !== baseRoot) {
			baseRoot = base;
			transcript = children[0];
			transcriptHandle = undefined;
			dock = children[1];
			roots.clear();
			arrangements.clear();
		}
		mount();
	};

	const mount = () => {
		if (!tui || !isViewportTUI(tui) || !baseRoot) return;
		setTabsShown(true);
		const root = rootFor();
		// Pi invalidates only the components it shows (on a theme change, for one), so
		// a page coming on screen draws from scratch.
		root.invalidate();
		tui.setLayoutRoot(root);
		tui.requestRender(true);
	};

	/** Called on every frame from the editor: keep the tabs mounted across mode switches. */
	const watchRoot = () => {
		// `tui` follows Pi's current renderer. Switching to fullscreen mounts Pi's own
		// root again; put the tabs back, or attach for the first time when the
		// session started in regular mode.
		if (tui && isViewportTUI(tui)) {
			const live = piRoot(tui);
			if (!baseRoot) queueMicrotask(attach);
			else if (live === baseRoot) queueMicrotask(mount);
		} else {
			// Regular mode has no execution log; leave new tool calls in the transcript.
			setTabsShown(false);
		}
	};

	const onPageChange = () => {
		if (visiblePanels().includes("transcript") && state.termAttention) {
			state.termAttention = false;
			changed(state);
		}
		mount();
		updateTimer();
		notifyShown();
	};

	const selectTab = (index: number) => {
		if (index < 0 || index >= tabs.length) return;
		activeTab = index;
		onPageChange();
	};

	const selectPage = (index: number) => {
		const count = pages[activeTab]!.length;
		if (index < 0 || index >= count) return;
		activePage[activeTab] = index;
		onPageChange();
	};

	/* ------------------------------------------------------------ timer */

	/**
	 * Redraw every FRAME_MS while something moves; otherwise only when the minute
	 * on the clock changes. Animation frames come from the clock (`tick`), so they
	 * stay right whichever redraw shows them. Without the tabs on screen, only the
	 * editor border moves (WORKING), and only while the agent runs.
	 */
	const updateTimer = () => {
		const moving = state.agentRunning || (tabsShown && (state.termAttention || visiblePanels().includes("nosignal")));
		if (!tabsShown && !moving) {
			stopTimer();
			return;
		}
		if (timer && moving === animating) return;
		stopTimer();
		animating = moving;
		const delay = moving ? FRAME_MS : 60_000 - (Date.now() % 60_000) + 50;
		timer = setTimeout(() => {
			timer = undefined;
			requestRender();
			updateTimer();
		}, delay);
		timer.unref?.();
	};

	const stopTimer = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
	};

	const shell: Shell = {
		state,
		features: {
			state,
			context: () => ctxRef,
			requestRender,
			changed,
			shows: (panel) => tabsShown && visiblePanels().includes(panel),
			onShownChange: (listener) => {
				shownListeners.push(listener);
			},
		},
		theme,
		tick,
		requestRender,
		tabsShown: () => tabsShown,
		editorFocused,
		panelMode: () => panelMode,
		setPanelMode: (on) => {
			panelMode = on;
		},
		visiblePanels,
		focusedId,
		primaryPanel,
		handleFor,
		focusPanel: (id) => {
			focus.set(currentKey(), id);
		},
		toggleMaximized: () => {
			const key = currentKey();
			const id = focusedId();
			if (maximized.has(key)) maximized.delete(key);
			else if (id) maximized.set(key, id);
			onPageChange();
		},
		selectTab,
		stepTab: (step) => selectTab((activeTab + step + tabs.length) % tabs.length),
		stepPage: (step) => {
			const count = pages[activeTab]!.length;
			selectPage((activePage[activeTab]! + step + count) % count);
		},
	};

	/* ------------------------------------------------------------ events */

	pi.registerToolRenderer((toolName, next) => {
		nextRenderers.set(toolName, next);
		takeCarry();
		return tabsShown ? HIDDEN : next();
	});

	pi.on("session_start", (_event, ctx) => {
		ctxRef = ctx;
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			setTabsShown(false);
			return;
		}
		takeCarry();
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setEditorComponent((tuiArg, editorTheme, keybindings) => {
			tui = tuiArg;
			editor = crtEditor(shell, watchRoot, tuiArg, editorTheme, keybindings);
			attach();
			return editor;
		});
		updateTimer();
	});

	pi.on("session_shutdown", (event) => {
		if (event.reason !== "quit" && tabsShown) carried[CARRY_TABS_SHOWN] = true;
		screenHost.preview(undefined);
		stopTimer();
		if (ctxRef?.mode === "tui" && ctxRef.hasUI && editor) {
			ctxRef.ui.setEditorComponent(undefined);
			ctxRef.ui.setWorkingVisible(true);
		}
		editor = undefined;
		if (tui && isViewportTUI(tui) && baseRoot) {
			tui.setLayoutRoot(baseRoot);
			tui.requestRender(true);
		}
		roots.clear();
		arrangements.clear();
		panelCache.clear();
	});

	pi.on("agent_start", () => {
		state.agentRunning = true;
		state.agentStartedAt = Date.now();
		changed(state);
		updateTimer();
	});

	pi.on("agent_end", () => {
		state.agentRunning = false;
		const somewhere = pages.some((list, t) => list.some((_page, p) => showsTranscript(t, p)));
		if (somewhere && !visiblePanels().includes("transcript")) state.termAttention = true;
		changed(state);
		updateTimer();
	});

	return shell;
}

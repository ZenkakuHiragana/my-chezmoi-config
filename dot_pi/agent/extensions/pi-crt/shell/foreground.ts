/**
 * The terminal's default foreground, set to the theme's text colour while pi-crt
 * runs (OSC 10), and given back when it stops (OSC 110).
 *
 * Pi draws some text with no colour of its own: the assistant's answers (its
 * Markdown has no default text style) and whatever follows a colour reset. That
 * text takes the terminal's default foreground, so without this the screen's
 * colours would depend on the terminal's theme. Only the foreground is set: the
 * default background is left to the terminal, so that a translucent window stays
 * translucent.
 *
 * herdr keeps a colour set this way for its own pane only, and gives the pane its
 * own colour back on OSC 110.
 *
 * Pi hands the terminal to another program for a while (Ctrl+Z, an external
 * editor), which may reset the colour; when it takes the terminal back it draws
 * the whole screen again, and the colour is sent again then.
 *
 * A theme whose text colour is the terminal's default ("" in its JSON, as the
 * system theme has on most terminals) leaves the terminal its own colour. Pi
 * learns the terminal's colours by asking it, after a theme change too; were the
 * colour set, such a theme would take it for the terminal's own and keep it.
 *
 * Not followed: a theme previewed in Pi's settings (see followTheme in
 * shell/controller.ts); the terminal's own palette for a theme whose text colour is
 * an ANSI index (pi-tui's fixed palette is used).
 */
import { writeSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Color, colorToRgb, type Terminal } from "@earendil-works/pi-tui";

const RESET = "\x1b]110\x07";

export interface TerminalForeground {
	/**
	 * Set the default foreground to `color`, unless it was set to that already and Pi
	 * has not drawn the whole screen again since (`redraws`: TUI.fullRedraws).
	 */
	follow(terminal: Terminal, color: Color, redraws: number): void;
	/**
	 * Give the terminal its default foreground back, if it was set. `sync` writes
	 * straight to stdout: needed when Pi is about to exit, because a write to a
	 * Windows TTY is asynchronous and would not get out.
	 */
	release(sync: boolean): void;
}

/** The theme's text colour, or undefined when the theme leaves it to the terminal. */
export function themeText(theme: Theme): Color | undefined {
	// Pi draws a token set to "" with the default foreground; getFgAnsi adds SGR 2 after it for a faint one.
	return theme.getFgAnsi("text").startsWith("\x1b[39m") ? undefined : theme.colors.text;
}

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

export function terminalForeground(): TerminalForeground {
	/** The colour spec last sent, where, and Pi's count of full redraws then. */
	let sent: string | undefined;
	let target: Terminal | undefined;
	let sentAt = 0;
	// Pi may exit without a session_shutdown (process.exit from elsewhere); the colour
	// goes back then too. A hard kill or a native abort runs no JavaScript.
	const onExit = () => release(true);

	const release = (sync: boolean) => {
		if (sent === undefined) return;
		const terminal = target;
		sent = undefined;
		target = undefined;
		process.off("exit", onExit);
		if (!sync) {
			terminal?.write(RESET);
			return;
		}
		try {
			writeSync(process.stdout.fd, RESET);
		} catch {
			// The terminal may already be gone.
		}
	};

	return {
		follow(terminal, color, redraws) {
			const { r, g, b } = colorToRgb(color);
			const spec = `rgb:${hex(r)}/${hex(g)}/${hex(b)}`;
			if (spec === sent && terminal === target && redraws === sentAt) return;
			if (sent === undefined) process.on("exit", onExit);
			sent = spec;
			target = terminal;
			sentAt = redraws;
			terminal.write(`\x1b]10;${spec}\x07`);
		},
		release,
	};
}

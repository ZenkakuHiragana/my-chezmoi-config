/**
 * Static noise around a centred message, for pages that have nothing to show.
 */
import {
	type Component,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { SizedView } from "./frame.ts";
import { Lines, type ThemeRef } from "./lines.ts";

const NOISE = [" ", " ", " ", "░", "░", "▒", "·", "˙", "."];

const noise = (theme: ThemeRef, width: number) => {
	let text = "";
	for (let col = 0; col < width; col++) text += NOISE[Math.floor(Math.random() * NOISE.length)];
	return theme().fg("borderMuted", text);
};

/**
 * `height` lines of random static around a box in the middle holding `message`
 * and, under it, `detail` wrapped to the box. A panel that draws itself to its
 * height (a "sized" panel) uses this to show why it has nothing to show. When the
 * box does not fit the height, only the text is drawn, wrapped to the full width
 * and without the box or static; text that still does not fit is cut at the
 * bottom (maximizing the panel gives it the height).
 */
export function noSignalLines(theme: ThemeRef, message: string, width: number, height: number, detail?: string): string[] {
	const t = theme();
	// The detail is wrapped rather than cut, so that a long reason can be read whole.
	const details = detail ? wrapTextWithAnsi(detail, Math.max(1, width - 8)) : [];
	const widest = Math.max(visibleWidth(message), ...details.map((line) => visibleWidth(line)));
	const inner = Math.max(0, Math.min(width - 2, widest + 6));
	const pad = Math.max(0, Math.floor((width - inner - 2) / 2));
	const center = (s: string) => {
		const left = Math.floor((inner - visibleWidth(s)) / 2);
		return " ".repeat(Math.max(0, left)) + s + " ".repeat(Math.max(0, inner - left - visibleWidth(s)));
	};
	const indent = " ".repeat(pad);
	const side = t.fg("border", "│");
	const box = [
		indent + t.fg("border", `┌${"─".repeat(inner)}┐`),
		indent + side + t.fg("accent", t.bold(center(message))) + side,
		...details.map((line) => indent + side + t.fg("error", center(line)) + side),
		indent + t.fg("border", `└${"─".repeat(inner)}┘`),
	];
	if (box.length > height) {
		const text = detail ? wrapTextWithAnsi(detail, Math.max(1, width)) : [];
		return [t.fg("accent", t.bold(message)), ...text.map((line) => t.fg("error", line))].slice(0, Math.max(1, height));
	}
	const above = Math.max(0, Math.floor((height - box.length) / 2));
	const below = Math.max(0, height - above - box.length);
	return [...Array.from({ length: above }, () => noise(theme, width)), ...box, ...Array.from({ length: below }, () => noise(theme, width))];
}

/** Static noise with a centred message, for tabs that have nothing to show yet. */
export function noSignal(theme: ThemeRef, message: () => string): Component {
	// Random static, redrawn on every frame, around a box in the middle of the panel.
	const field = new Lines((width) => {
		const height = view.viewportHeight;
		view.drawnFor = height;
		return noSignalLines(theme, message(), width, height);
	});
	const view = new SizedView(field, { primary: false, overscroll: "contain", scrollbar: "hidden" });
	return view;
}

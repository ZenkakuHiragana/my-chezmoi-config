/**
 * A panel's frame: its title rule above its body, and how the body scrolls.
 */
import {
	type Component,
	ScrollView,
	type ScrollViewOptions,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { setTopTitle, TitleLine } from "./layout.ts";
import type { ThemeRef } from "./lines.ts";

export interface Framed {
	component: Component;
	scroll?: ScrollView;
	/** The title the rule shows: the panel's name, then two spaces before what it shows now. */
	title?: () => string;
}

/**
 * A panel: one title rule above its body. Scrollable bodies get a ScrollView.
 * A "sized" body draws itself for the height it is given: it reads the height from
 * the returned SizedView and records it in `drawnFor`. A sized body taller than
 * that height scrolls, with the scrollbar shown while it moves.
 * The focused panel's rule is drawn in the accent colour.
 * A `footer` stays on the panel's last rows, under the body and outside its scrolling,
 * as tall as the lines it draws.
 */
export function framed(
	theme: ThemeRef,
	title: () => string,
	body: Component,
	scroll: "none" | "top" | "end" | "sized",
	focused: () => boolean,
	footer?: Component,
): Framed {
	const titleLine = new TitleLine((width) => {
		const t = theme();
		const on = focused();
		const label = on ? ` ◆ ${title()} ` : ` ${title()} `;
		const rest = Math.max(0, width - 2 - visibleWidth(label));
		const rule = on ? "borderAccent" : "borderMuted";
		return [t.fg(rule, on ? "━━" : "──") + t.fg("accent", t.bold(label)) + t.fg(rule, (on ? "━" : "─").repeat(rest))];
	});
	const options: ScrollViewOptions = {
		primary: false,
		follow: scroll === "end" ? "end" : "none",
		overscroll: "contain",
		scrollbar: "auto",
		scrollbarTrackStyle: (text) => theme().fg("scrollbarTrack", text),
		scrollbarThumbStyle: (text) => theme().fg("scrollbarThumb", text),
	};
	const scrollView =
		scroll === "none"
			? undefined
			: scroll === "sized"
				? new SizedView(body, options)
				: new ScrollView(body, options);
	const component = new VStack([
		{ component: titleLine, basis: 1, grow: 0, shrink: 0, minSize: 1 },
		{ component: scrollView ?? body, basis: 0, grow: 1, shrink: 1, minSize: 0 },
		...(footer ? [{ component: footer, basis: "auto" as const, grow: 0, shrink: 0 }] : []),
	]);
	setTopTitle(component, titleLine);
	return { component, scroll: scrollView, title };
}

/**
 * A ScrollView whose content is drawn for its height. Pi's stacks hand spare rows
 * to earlier entries first, so two equal halves around a box do not come out
 * equal; a ScrollView is Pi's way to learn the height. The content is drawn
 * before the layout tells the height, so a change of height draws once more.
 */
export class SizedView extends ScrollView {
	/** The height the content was last drawn for. */
	drawnFor = -1;

	override updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
		super.updateLayout(contentHeight, viewportHeight, requestRender);
		if (this.viewportHeight !== this.drawnFor) requestRender();
	}
}

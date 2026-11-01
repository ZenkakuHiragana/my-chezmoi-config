/**
 * Drawing parts for the STATUS panel: gauges and stat cards.
 *
 * These return plain text lines; the panel colours them. Widths are measured, cut and
 * padded with pi-tui's visibleWidth and truncateToWidth.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Filled and empty parts of a gauge bar. */
const GAUGE_FULL = "▓";
const GAUGE_EMPTY = "░";
/** A bar shorter than this is not worth drawing. */
const MIN_BAR = 4;

/** Rounded card frame. */
const CARD_EDGES = { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" };
/** Columns a card holds besides its frame and inner padding. */
const MIN_CARD_CONTENT = 7;

/** Text cut or padded to exactly `width` cells. */
function fit(text: string, width: number): string {
	return truncateToWidth(text, width, "", true);
}

/** Text padded on the left to `width` cells. */
function padLeft(text: string, width: number): string {
	return " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
}

/** Text centred in `width` cells, one cell short on the left when the rest is odd. */
export function centerLine(text: string, width: number): string {
	return " ".repeat(Math.max(0, Math.floor((width - visibleWidth(text)) / 2))) + text;
}

export interface GaugeInput {
	/** Short name at the left, e.g. `CTX`. */
	label: string;
	/** Clamped to 0..1. */
	ratio: number;
	/** Value at the right. A percentage of `ratio` when left out. */
	value?: string;
	/** Name column shared by a group of gauges. */
	labelWidth?: number;
	/** Value column shared by a group of gauges. */
	valueWidth?: number;
}

/** The value a gauge shows: the given one, or the ratio as a percentage. */
function gaugeValue(input: GaugeInput): string {
	return input.value ?? `${Math.round(clampRatio(input.ratio) * 100)}%`;
}

/**
 * One gauge: `CTX   ▓▓▓▓▓▓░░░░░░  42%`. Falls back to name and value alone when the
 * width leaves no room for a bar.
 */
export function gauge(input: GaugeInput, width: number): string {
	const value = gaugeValue(input);
	const labelWidth = input.labelWidth ?? visibleWidth(input.label);
	const valueWidth = input.valueWidth ?? visibleWidth(value);
	const label = fit(input.label, labelWidth);
	const tail = padLeft(value, valueWidth);
	// One blank cell on each side of the bar.
	const barWidth = width - labelWidth - valueWidth - 2;
	if (barWidth < MIN_BAR) {
		const plain = `${label} ${tail}`;
		return visibleWidth(plain) <= width ? plain : `${input.label} ${value}`;
	}
	const filled = Math.round(clampRatio(input.ratio) * barWidth);
	return `${label} ${GAUGE_FULL.repeat(filled)}${GAUGE_EMPTY.repeat(barWidth - filled)} ${tail}`;
}

/** Ratio clamped to 0..1; anything that is not a number counts as 0. */
function clampRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return 0;
	return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

/**
 * Two gauges side by side, their name and value columns aligned with each other.
 * A single gauge, or a width too small for two, uses the whole line.
 */
export function gaugeRow(
	left: GaugeInput,
	right: GaugeInput | undefined,
	width: number,
	options: { gap?: number; maxColumn?: number } = {},
): string {
	const gap = options.gap ?? 4;
	const half = Math.floor((width - gap) / 2);
	// Each gauge keeps to its own column, so the two sit at the edges with the
	// middle free. A column wider than maxColumn only makes the bar longer.
	// Without a second gauge there is nothing to leave room for, so one gauge keeps the
	// whole line unless maxColumn asks for a narrower one.
	if (!right) return gauge(left, Math.max(1, Math.min(width, options.maxColumn ?? width)));
	const column = Math.max(1, Math.min(half, options.maxColumn ?? half));
	if (half < MIN_CARD_CONTENT) return gauge(left, width);
	// Columns given by the caller are kept, so gauges on different rows can share them.
	const labelWidth = Math.max(left.labelWidth ?? 0, right.labelWidth ?? 0, visibleWidth(left.label), visibleWidth(right.label));
	const valueWidth = Math.max(left.valueWidth ?? 0, right.valueWidth ?? 0, visibleWidth(gaugeValue(left)), visibleWidth(gaugeValue(right)));
	const leftText = gauge({ ...left, labelWidth, valueWidth }, column);
	const rightText = gauge({ ...right, labelWidth, valueWidth }, column);
	return fit(leftText, width - column) + rightText;
}

export interface CardInput {
	/** Name on the upper line, e.g. `TOOLS`. */
	label: string;
	/** Value on the lower line, e.g. `128`. */
	value: string;
}

/**
 * Rounded cards in a row, wrapping onto further rows when they do not fit. Each row is
 * four lines: top frame, name, value, bottom frame. Card width is shared by every row, so
 * a short last row leaves space rather than growing its cards.
 */
export function statCards(cards: readonly CardInput[], width: number, options: { gap?: number } = {}): string[] {
	const gap = options.gap ?? 1;
	if (cards.length === 0) return [];
	const minCard = MIN_CARD_CONTENT + 4; // Frame and inner padding.
	if (width < minCard) return [];
	const perRow = Math.max(1, Math.min(cards.length, Math.floor((width + gap) / (minCard + gap))));
	const cardWidth = Math.floor((width - gap * (perRow - 1)) / perRow);
	const content = cardWidth - 4;
	const bar = CARD_EDGES.horizontal.repeat(cardWidth - 2);
	const cardLine = (text: string) => `${CARD_EDGES.vertical} ${fit(text, content)} ${CARD_EDGES.vertical}`;
	const joiner = " ".repeat(gap);
	const lines: string[] = [];
	for (let start = 0; start < cards.length; start += perRow) {
		const row = cards.slice(start, start + perRow);
		lines.push(
			row.map(() => CARD_EDGES.topLeft + bar + CARD_EDGES.topRight).join(joiner),
			row.map((card) => cardLine(card.label)).join(joiner),
			row.map((card) => cardLine(card.value)).join(joiner),
			row.map(() => CARD_EDGES.bottomLeft + bar + CARD_EDGES.bottomRight).join(joiner),
		);
	}
	return lines;
}

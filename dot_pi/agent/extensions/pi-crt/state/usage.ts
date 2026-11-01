/** Codex reports percentages (0–100) and rolling window durations in minutes. */
export interface RateLimitWindow {
	name: "primary" | "secondary";
	usedPercent: number;
	minutes?: number;
	resetAt?: number;
}

const WINDOW_NAMES = ["primary", "secondary"] as const;

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Undefined means another event/bucket; an empty array means no usable windows. */
export function codexEventWindows(data: unknown): RateLimitWindow[] | undefined {
	const event = record(data);
	if (event?.type !== "codex.rate_limits") return undefined;
	// Other metered buckets must not replace the Codex conversation allowance.
	const limit = event.metered_limit_name ?? event.limit_name;
	if (limit !== undefined && limit !== null && (typeof limit !== "string" || limit.trim().toLowerCase() !== "codex")) return undefined;
	const limits = record(event.rate_limits);
	return WINDOW_NAMES.flatMap((name) => {
		const window = record(limits?.[name]);
		if (!window || !finite(window.used_percent)) return [];
		return [{
			name,
			usedPercent: window.used_percent,
			minutes: finite(window.window_minutes) && window.window_minutes > 0 ? window.window_minutes : undefined,
			resetAt: finite(window.reset_at) ? window.reset_at : undefined,
		}];
	});
}

/** Read the Codex window fields carried by SSE response headers. */
export function codexHeaderWindows(headers: ReadonlyArray<[string, string]>): RateLimitWindow[] | undefined {
	const values = new Map(headers.map(([key, value]) => [key.toLowerCase(), value]));
	if (!WINDOW_NAMES.some((name) => values.has(`x-codex-${name}-used-percent`))) return undefined;
	const numeric = (key: string): number | undefined => {
		const value = values.get(key);
		if (value === undefined || value.trim() === "") return undefined;
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	};
	return WINDOW_NAMES.flatMap((name) => {
		const prefix = `x-codex-${name}-`;
		const usedPercent = numeric(`${prefix}used-percent`);
		if (usedPercent === undefined) return [];
		const minutes = numeric(`${prefix}window-minutes`);
		return [{ name, usedPercent, minutes: minutes !== undefined && minutes > 0 ? minutes : undefined, resetAt: numeric(`${prefix}reset-at`) }];
	});
}

/** Classify the duration independently of the text used to display it. */
export function windowPeriod(window: RateLimitWindow): "fiveHour" | "weekly" | undefined {
	if (window.minutes === 300) return "fiveHour";
	if (window.minutes === 10080) return "weekly";
	return undefined;
}

export function windowLabel(window: RateLimitWindow): string {
	const period = windowPeriod(window);
	if (period === "fiveHour") return "5h";
	if (period === "weekly") return "7d";
	return window.minutes ? `${window.minutes}m` : window.name;
}

/**
 * A rate-limit header as a share of the limit (0..1), or undefined when the header is
 * not a usage share. `used-percent` is a percentage; `utilization` is a fraction, or a
 * percentage when it is above 1.
 */
export function headerRatio(name: string, value: string): number | undefined {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return undefined;
	if (/used.?percent/i.test(name)) return numeric / 100;
	if (/utili[sz]ation/i.test(name)) return numeric > 1 ? numeric / 100 : numeric;
	return undefined;
}

/** A rate-limit window as STAT shows it. */
export interface AllowanceWindow {
	/** "5H", "WEEK", or the window's own name. */
	label: string;
	period?: "fiveHour" | "weekly";
	/** Share of the limit used, 0..1. */
	ratio: number;
	/** When the window resets, in milliseconds since the epoch. */
	resetAt?: number;
}

/** A header name without the provider's common prefix. */
export function shortHeader(name: string): string {
	return name.replace(/^anthropic-ratelimit-unified-/, "").replace(/^x-codex-/, "codex ").replace(/^x-ratelimit-/, "");
}

/**
 * The windows the last response reported, and the headers that are not part of one
 * (credits, status and other details). With Codex windows (from its headers or its
 * stream event), those are the windows; otherwise each `utilization` header is one,
 * with its `-reset` header. A window's period is matched on its actual duration,
 * never on the primary/secondary position.
 */
export function allowanceWindows(
	headers: ReadonlyArray<[string, string]>,
	windows?: readonly RateLimitWindow[],
): { windows: AllowanceWindow[]; rest: Array<[string, string]> } {
	const label = (period: AllowanceWindow["period"], name: string) => (period === "fiveHour" ? "5H" : period === "weekly" ? "WEEK" : name);
	if (windows !== undefined) {
		return {
			windows: windows.map((window) => {
				const period = windowPeriod(window);
				return {
					label: label(period, `codex ${windowLabel(window)}`),
					period,
					ratio: window.usedPercent / 100,
					resetAt: window.resetAt === undefined ? undefined : window.resetAt * 1000,
				};
			}),
			rest: headers.filter(([name]) => !/^x-codex-(primary|secondary)-/i.test(name)),
		};
	}
	const values = new Map(headers.map(([name, value]) => [name.toLowerCase(), value]));
	const used = new Set<string>();
	const found: AllowanceWindow[] = [];
	for (const [name, value] of headers) {
		if (!/utili[sz]ation/i.test(name)) continue;
		const ratio = headerRatio(name, value);
		if (ratio === undefined) continue;
		const prefix = name.replace(/-?utili[sz]ation$/i, "");
		const period = /5h|5-hour/i.test(name) ? "fiveHour" : /week|7d/i.test(name) ? "weekly" : undefined;
		const resetName = `${prefix}-reset`.toLowerCase();
		const reset = Number(values.get(resetName));
		used.add(name.toLowerCase());
		if (values.has(resetName)) used.add(resetName);
		found.push({
			label: label(period, shortHeader(prefix)),
			period,
			ratio,
			resetAt: Number.isFinite(reset) && reset > 1e9 ? (reset > 1e12 ? reset : reset * 1000) : undefined,
		});
	}
	return { windows: found, rest: headers.filter(([name]) => !used.has(name.toLowerCase())) };
}

/** The 5-hour and weekly shares, for STATUS's gauges. */
export function rateLimits(headers: ReadonlyArray<[string, string]>, windows?: readonly RateLimitWindow[]): { fiveHour?: number; weekly?: number } {
	const out: { fiveHour?: number; weekly?: number } = {};
	for (const window of allowanceWindows(headers, windows).windows) {
		if (window.period) out[window.period] ??= window.ratio;
	}
	return out;
}

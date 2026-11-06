/**
 * STAT's allowance: the current model's provider's windows, read with quota-axi
 * (state/usage.ts). The reading is the account's, other sessions' use included.
 *
 * It is read only while STAT is on screen: when STAT comes on screen, then every
 * USAGE_REFRESH_MS while it stays, and again when the model changes. A provider Pi
 * has no sign-in for is not asked about. Asking Pi for the sign-in may renew an
 * expiring OAuth token, which Pi saves as it does for a request.
 */
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import { quotaProvider, type QuotaReading, readQuota } from "../state/usage.ts";
import type { FeatureEnv } from "./env.ts";
import { VITALS_PANEL } from "./vitals.ts";

/** The id of the panel that lists every window. */
export const USAGE_PANEL = "usage";
/** How often STAT, while on screen, asks again. */
const USAGE_REFRESH_MS = 5 * 60_000;

export interface UsageData extends Versioned {
	/** The model (`provider/id`) the reading is for. */
	model?: string;
	/** quota-axi's report; a provider's failure is in its status. */
	reading?: QuotaReading;
	/** Why there is no report: no model, an unsupported provider, no Pi sign-in, or quota-axi not running. */
	error?: string;
	/** When the reading or the error came. */
	at?: number;
}

/** Each pi-crt instance's usage data, by its CrtState (see FeatureEnv). */
const collected = new WeakMap<CrtState, UsageData>();

/** Before setupUsage: nothing read. Never changed. */
const NONE: Readonly<UsageData> = Object.freeze({ version: 0 });

/** The allowance last read for the current model's provider. */
export function usageData(state: CrtState): Readonly<UsageData> {
	return collected.get(state) ?? NONE;
}

const modelName = (ctx: ExtensionContext) => (ctx.model ? sanitize(`${ctx.model.provider}/${ctx.model.id}`) : undefined);

export function setupUsage(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: UsageData = { version: 0 };
	collected.set(env.state, data);
	const abort = new AbortController();
	let timer: ReturnType<typeof setInterval> | undefined;
	let busy = false;
	let again = false;
	/** Whether STAT was on screen at the last change of what is shown. */
	let wasShown = false;

	// STATUS's 5H and WEEK gauges and DETAIL's USAGE list both show the reading.
	const shown = () => env.shows(VITALS_PANEL) || env.shows(USAGE_PANEL);
	const startTimer = () => {
		timer = setInterval(() => void query(), USAGE_REFRESH_MS);
		timer.unref?.();
	};

	const settle = (fields: Pick<UsageData, "reading" | "error">) => {
		data.reading = fields.reading;
		data.error = fields.error;
		data.at = Date.now();
		env.changed(data);
	};

	/** One reading for the current model's provider, while STAT is on screen; asks while one runs make one more after it. */
	const query = async () => {
		const ctx = env.context();
		if (!ctx || !shown()) return;
		if (busy) {
			again = true;
			return;
		}
		busy = true;
		try {
			do {
				again = false;
				await readOnce(ctx);
			} while (again && shown() && !abort.signal.aborted);
		} finally {
			busy = false;
		}
	};

	const readOnce = async (ctx: ExtensionContext) => {
		const piProvider = ctx.model?.provider;
		data.model = modelName(ctx);
		const provider = piProvider ? quotaProvider(piProvider) : undefined;
		if (!piProvider || !provider) {
			settle({ error: piProvider ? `${sanitize(piProvider)}: allowance not supported` : "no model selected" });
			return;
		}
		// A reading for a provider the session has since left is dropped.
		const left = () => abort.signal.aborted || env.context()?.model?.provider !== piProvider;
		let auth: { apiKey?: string; headers?: Record<string, string> } | undefined;
		try {
			auth = (await ctx.modelRegistry.getProviderAuth(piProvider))?.auth;
		} catch (error) {
			if (!left()) settle({ error: `Pi sign-in: ${sanitize(String(error instanceof Error ? error.message : error)).slice(0, 200)}` });
			return;
		}
		if (left()) return;
		// Signed in: a key, or a header (Kimi's OAuth, an ANTHROPIC_AUTH_TOKEN). Without either, quota-axi would find nothing.
		const bearer = Object.entries(auth?.headers ?? {}).find(([name]) => name.toLowerCase() === "authorization")?.[1];
		const key = auth?.apiKey ?? bearer?.replace(/^Bearer\s+/i, "");
		if (!key && !Object.keys(auth?.headers ?? {}).length) {
			settle({ error: `${sanitize(piProvider)}: not signed in to Pi` });
			return;
		}
		const outcome = await readQuota(provider, key, getAgentDir(), abort.signal);
		if (!left()) settle(outcome);
	};

	env.onShownChange(() => {
		const now = shown();
		if (now && !wasShown) {
			// The interval starts again from this reading, so that the two do not follow each other closely.
			if (timer) {
				clearInterval(timer);
				startTimer();
			}
			void query();
		}
		wasShown = now;
	});

	pi.on("session_start", (_event, ctx) => {
		// The timer runs only for a session on screen; it reads only while STAT is shown.
		if (ctx.mode !== "tui" || !ctx.hasUI || timer) return;
		startTimer();
	});

	pi.on("model_select", (_event, ctx) => {
		const model = modelName(ctx);
		if (model === data.model) return;
		const sameProvider = data.model !== undefined && data.model.split("/", 1)[0] === ctx.model?.provider;
		data.model = model;
		if (sameProvider) {
			// The reading is the provider's account, whichever of its models is used.
			env.changed(data);
			return;
		}
		// Another provider: the last reading is not its own; read it now if STAT is shown.
		data.reading = undefined;
		data.error = undefined;
		data.at = undefined;
		env.changed(data);
		void query();
	});

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		abort.abort();
	});
}

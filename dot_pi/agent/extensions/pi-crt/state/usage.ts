/**
 * The allowance windows STAT shows, read with quota-axi (a pinned dependency; it
 * needs Node 22.19 or later, as Pi does). quota-axi asks the vendor for the account's
 * usage and reports each window's length and kind; the gauges take a window by what
 * quota-axi reports for it, never by its name.
 *
 * readQuota runs `quota-axi --provider <id> --json --full` as a child process (node
 * with its bin script) and reads its report. --full is what keeps each window's
 * length: the default --json redacts `windowSeconds`, which leaves a window quota-axi
 * could not identify (OpenCode Go's five-hour cap, which the vendor calls "rolling")
 * with no evidence of what it is. The reading is for the account Pi signed in with
 * and no other. quota-axi would otherwise also read other tools' sign-ins (Claude
 * Code's, Codex's, OpenCode's, the Grok and MiniMax CLIs', API keys in environment
 * variables) and may prefer them, so it runs with only the environment a process
 * needs (QUOTA_ENV) and its home, data, config and cache folders in QUOTA_HOME, where
 * no sign-in is. Pi's agent folder is named for it, so it reads Pi's auth.json; a
 * provider whose key Pi resolves from elsewhere gets the key in the variable
 * quota-axi reads first (QuotaProvider.keyEnv). When the Codex reading fails,
 * quota-axi may start the codex CLI, which finds no sign-in file there either (one
 * the CLI kept in an OS keyring is not looked at here). A provider without a keyEnv is
 * read from Pi's auth.json only: a key Pi takes from an environment variable is not
 * seen, and quota-axi reports no sign-in.
 *
 * Not pi.exec, as state/git.ts uses: pi.exec runs the child in Pi's whole environment.
 * --no-credential-refresh keeps quota-axi from renewing a sign-in through a vendor CLI.
 */
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitize } from "./core.ts";

/** How quota-axi is asked about one of Pi's providers. */
export interface QuotaProvider {
	/** quota-axi's id (`--provider`). */
	id: string;
	/** The variable quota-axi reads the key from before Pi's auth.json, if any; it gets Pi's key. */
	keyEnv?: string;
}

/**
 * Pi's provider id → quota-axi's, for quota-axi 0.1.69. Left out: Copilot (quota-axi
 * does not read it from Pi) and minimax-cn (quota-axi reads MiniMax's global endpoint
 * only). A provider not listed is not asked about.
 */
const QUOTA_PROVIDERS: Readonly<Record<string, QuotaProvider>> = {
	anthropic: { id: "claude", keyEnv: "CLAUDE_CODE_OAUTH_TOKEN" },
	"openai-codex": { id: "codex" },
	"kimi-coding": { id: "kimi" },
	zai: { id: "zai" },
	"opencode-go": { id: "opencode-go" },
	xai: { id: "grok" },
	minimax: { id: "minimax", keyEnv: "MINIMAX_API_KEY" },
	deepseek: { id: "deepseek", keyEnv: "DEEPSEEK_API_KEY" },
	openrouter: { id: "openrouter", keyEnv: "OPENROUTER_API_KEY" },
};

/** The quota-axi id for one of Pi's providers, or undefined when it is not asked about. */
export function quotaProvider(piProvider: string): QuotaProvider | undefined {
	return Object.hasOwn(QUOTA_PROVIDERS, piProvider) ? QUOTA_PROVIDERS[piProvider] : undefined;
}

/** One window of a provider's allowance. */
export interface QuotaWindow {
	label: string;
	/** quota-axi's kind: session, weekly, monthly, model, credits or unknown. */
	kind: string;
	/** Share of the limit used, 0..1; undefined when the window has no percentage (credits). */
	ratio?: number;
	/** The window's length in seconds, when quota-axi reports one. */
	windowSeconds?: number;
	/** When the window resets, in milliseconds since the epoch. */
	resetAt?: number;
	/** Set when `ratio` is a share of that window, not an allowance of its own. */
	shareOf?: string;
}

/** What quota-axi reported for one provider. */
export interface QuotaReading {
	windows: QuotaWindow[];
	/** quota-axi's state.status: fresh, stale, unavailable, auth_required, rate_limited or error. */
	status: string;
	/** quota-axi's reason when the status is not fresh. */
	error?: string;
	/** quota-axi found no sign-in for the provider. */
	notSetUp: boolean;
}

const QUOTA_BIN = fileURLToPath(new URL("../node_modules/quota-axi/dist/bin/quota-axi.js", import.meta.url));
/**
 * quota-axi's home: no sign-in is kept there, only quota-axi's own cache. The
 * temporary folder is the user's own on Windows and macOS; on Linux it is the shared
 * /tmp, where another user could make this folder first.
 */
const QUOTA_HOME = join(tmpdir(), "pi-crt-quota-axi");
/** A reading that takes longer is given up. */
const QUOTA_TIMEOUT_MS = 60_000;
/**
 * The variables passed on from Pi's environment: what Node and Windows need to run and
 * reach the network (proxies, certificates), and nothing that names a sign-in.
 */
const QUOTA_ENV = new Set([
	"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "TZ",
	"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
]);

/**
 * quota-axi's reading for one provider, or why there is none. `key` is the key or
 * token Pi resolved, given to quota-axi when the provider has a keyEnv; `agentDir`
 * is Pi's agent folder.
 */
export function readQuota(
	provider: QuotaProvider,
	key: string | undefined,
	agentDir: string,
	signal: AbortSignal,
): Promise<{ reading?: QuotaReading; error?: string }> {
	const env: NodeJS.ProcessEnv = {
		...Object.fromEntries(Object.entries(process.env).filter(([name]) => QUOTA_ENV.has(name.toUpperCase()))),
		HOME: QUOTA_HOME,
		USERPROFILE: QUOTA_HOME,
		APPDATA: join(QUOTA_HOME, "AppData", "Roaming"),
		LOCALAPPDATA: join(QUOTA_HOME, "AppData", "Local"),
		XDG_CONFIG_HOME: join(QUOTA_HOME, ".config"),
		XDG_DATA_HOME: join(QUOTA_HOME, ".local", "share"),
		XDG_CACHE_HOME: join(QUOTA_HOME, ".cache"),
		PI_CODING_AGENT_DIR: agentDir,
		// OpenCode Go is read from Pi's auth.json only when asked to.
		QUOTA_AXI_OPENCODE_GO_PI_AUTH: "1",
		...(provider.keyEnv && key ? { [provider.keyEnv]: key } : {}),
	};
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[QUOTA_BIN, "--provider", provider.id, "--json", "--full", "--no-credential-refresh"],
			{ env, signal, timeout: QUOTA_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
			(error, stdout, stderr) => {
				// quota-axi exits with 1 when the provider failed, and still prints its report.
				try {
					resolve({ reading: parseQuota(stdout) });
				} catch {
					const reason = firstLine(String(stderr)) || firstLine(String(stdout)) || (error ? firstLine(error.message) : "no output");
					resolve({ error: `quota-axi: ${reason}` });
				}
			},
		);
	});
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** A string from the report on one line: no control characters, line breaks and tabs as spaces. */
const text = (value: unknown): string | undefined => (typeof value === "string" ? sanitize(value.replace(/[\r\n\t]+/g, " ")) : undefined);
/** The first line of an error output, without control characters. */
const firstLine = (value: string): string => sanitize(value.trim().split(/\r?\n/, 1)[0] ?? "").slice(0, 200);

/**
 * The first provider of `quota-axi --json` output (one provider is asked for, and it
 * reports one account); throws when the output is not that report. quota-axi 0.1.69
 * writes schema 5, or 6 when it reports account keys; both have this shape.
 */
export function parseQuota(stdout: string): QuotaReading {
	const report = record(JSON.parse(stdout));
	if (report?.schemaVersion !== 5 && report?.schemaVersion !== 6) throw new Error("not a quota-axi report this version knows");
	const provider = record(Array.isArray(report.providers) ? report.providers[0] : undefined);
	if (!provider) throw new Error("quota-axi reported no provider");
	const state = record(provider.state);
	const windows = (Array.isArray(provider.windows) ? provider.windows : []).flatMap((value): QuotaWindow[] => {
		const window = record(value);
		const label = text(window?.label) || text(window?.id);
		if (!window || !label) return [];
		// --full reports percentUsed too; either one gives the same share.
		const used = finite(window.percentUsed) ? window.percentUsed : finite(window.percentRemaining) ? 100 - window.percentRemaining : undefined;
		const resetAt = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : Number.NaN;
		return [{
			label,
			kind: text(window.kind) ?? "unknown",
			ratio: used === undefined ? undefined : Math.max(0, Math.min(1, used / 100)),
			windowSeconds: finite(window.windowSeconds) && window.windowSeconds > 0 ? window.windowSeconds : undefined,
			resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
			shareOf: text(window.shareOf),
		}];
	});
	return {
		windows,
		status: text(state?.status) ?? "unknown",
		error: text(state?.error),
		notSetUp: provider.notSetUp === true,
	};
}

/** The length quota-axi measures a five-hour allowance at. */
const FIVE_HOURS_SECONDS = 18_000;

/**
 * STATUS's 5H and WEEK gauges: the five-hour and weekly windows that are allowances of
 * their own. The five-hour one is taken by its length first, so that a window quota-axi
 * cannot identify is still the 5H gauge's: OpenCode Go caps five hours with a window the
 * vendor calls "rolling", which comes as kind "unknown" and is measured at 18,000 s.
 */
export function gaugeRatios(windows: readonly QuotaWindow[]): { fiveHour?: number; weekly?: number } {
	const own = (window: QuotaWindow) => window.shareOf === undefined;
	const byLength = windows.find((window) => own(window) && window.windowSeconds === FIVE_HOURS_SECONDS);
	const byKind = (kind: string) => windows.find((window) => own(window) && window.kind === kind)?.ratio;
	return { fiveHour: byLength?.ratio ?? byKind("session"), weekly: byKind("weekly") };
}

/**
 * DATA › EXTENSIONS: the extensions Pi finds, by package, as Pi lists them under
 * [Extensions] when it starts.
 *
 * Pi does not give an extension the list it loaded, so the list is made the way Pi
 * makes it: Pi's own DefaultPackageManager resolves the settings and the extension
 * folders. It then differs from what Pi loaded in that it leaves out extensions given
 * with `-e`, keeps extensions that failed to load, and reads the settings as they are
 * now. A package that is not installed is skipped, not installed.
 *
 * The list is read while the panel is drawn and the list is stale: when first shown,
 * and again after each session_start (a new session or /reload).
 */
import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

export interface ExtensionItem {
	/** The entry file. */
	path: string;
	/** Disabled by the settings (such as a `-` filter of a package). */
	enabled: boolean;
	/** The package source (`npm:…`, `git:…`), `local`, or `auto` for the extension folders. */
	source: string;
	scope: string;
	/** Where `path` is relative to: the package's folder or Pi's agent folder; none for a path in the settings. */
	baseDir?: string;
}

export interface ExtensionData extends Versioned {
	items: ExtensionItem[];
	loading: boolean;
	stale: boolean;
	error?: string;
}

interface ExtensionFeature {
	env: FeatureEnv;
	data: ExtensionData;
}

/** Each pi-crt instance's extensions, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, ExtensionFeature>();

/** Before setupExtensions: nothing read. Never changed. */
const NONE: Readonly<ExtensionData> = Object.freeze({ version: 0, items: [], loading: false, stale: false });

export function extensions(state: CrtState): Readonly<ExtensionData> {
	return features.get(state)?.data ?? NONE;
}

/** Read the list again when it is stale. Called while the panel is drawn. */
export function refreshExtensions(state: CrtState): void {
	const feature = features.get(state);
	if (!feature) return;
	const { data, env } = feature;
	if (!data.stale || data.loading) return;
	const ctx = env.context();
	if (!ctx) return;
	// No version change here: the panel calling this is drawing already and shows the
	// loading state itself. The change at the end draws the result.
	data.loading = true;
	data.stale = false;
	const { cwd } = ctx;
	const projectTrusted = ctx.isProjectTrusted();
	Promise.resolve()
		.then(() => {
			const agentDir = getAgentDir();
			const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
			return new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(async () => "skip");
		})
		.then((resolved) => {
			data.items = resolved.extensions.map((resource) => ({
				path: sanitize(resource.path),
				enabled: resource.enabled,
				source: sanitize(resource.metadata.source),
				scope: resource.metadata.scope,
				baseDir: resource.metadata.baseDir && sanitize(resource.metadata.baseDir),
			}));
			data.error = undefined;
		})
		.catch((error: unknown) => {
			data.error = sanitize(error instanceof Error ? error.message : String(error));
		})
		.finally(() => {
			data.loading = false;
			env.changed(data);
		});
}

export function setupExtensions(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: ExtensionData = { version: 0, items: [], loading: false, stale: true };
	features.set(env.state, { env, data });
	pi.on("session_start", () => {
		data.stale = true;
		env.changed(data);
	});
}

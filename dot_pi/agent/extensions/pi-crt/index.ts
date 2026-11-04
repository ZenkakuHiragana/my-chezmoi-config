/**
 * pi-crt: a tabbed, CRT-style screen for Pi's fullscreen TUI.
 *
 * Where things are:
 *
 *   shell/      the tabbed screen: tabs and pages (controller.ts), keys (input.ts),
 *               the editor border (editor.ts)
 *   screen/     drawing pieces: page layouts and their draggable boundaries,
 *               panel frames, tab bars
 *   features/   one file per feature: it subscribes to Pi's events and keeps its
 *               own data (see features/env.ts)
 *   panels/     one file per group of panels; each registers its panels by id
 *   state/      data shapes and the work on them that does not need Pi's events
 *   layout.ts   the tabs, their pages and the layout of each page
 *
 * Adding a feature touches its own files, a setup line here, an import line in
 * panels/index.ts and, for a new page, layout.ts.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupContext } from "./features/context.ts";
import { setupExtensions } from "./features/extensions.ts";
import { setupGit } from "./features/git.ts";
import { setupImages } from "./features/image.ts";
import { setupInventory } from "./features/inv.ts";
import { setupLogo } from "./features/logo.ts";
import { setupModels } from "./features/models.ts";
import { setupQuests } from "./features/quests.ts";
import { setupRadio } from "./features/radio.ts";
import { setupTools } from "./features/tools.ts";
import { setupTree } from "./features/tree.ts";
import { setupUsage } from "./features/usage.ts";
import { setupVitals } from "./features/vitals.ts";
import "./panels/index.ts";
import { createShell } from "./shell/controller.ts";
import { setupInput } from "./shell/input.ts";

export default function (pi: ExtensionAPI) {
	const shell = createShell(pi);
	setupInput(pi, shell);
	const env = shell.features;
	setupTools(pi, env);
	setupGit(pi, env);
	setupContext(pi, env);
	setupUsage(pi, env);
	setupVitals(pi, env);
	setupLogo(pi, env);
	setupImages(pi, env);
	setupQuests(pi, env);
	setupModels(pi, env);
	setupExtensions(pi, env);
	setupTree(pi, env);
	setupInventory(pi, env);
	setupRadio(pi, env);
}

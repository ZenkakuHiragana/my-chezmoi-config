import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCatalog } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const configuredPath = process.env.SKILL_KB_CONFIG;
  const catalog = await loadCatalog(
    configuredPath === undefined ? {} : { globalConfigPath: configuredPath },
  );
  if (catalog.sources.size === 0) {
    console.error(
      `[skill-kb] No knowledge source is configured, so get_source is not published. Checked ${catalog.globalConfigPath} and ${catalog.projectConfigPath}`,
    );
  }
  const server = createServer(catalog);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[skill-kb] ${message}`);
  process.exitCode = 1;
});

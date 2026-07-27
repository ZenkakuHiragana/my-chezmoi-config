import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCatalog } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const configuredPath = process.env.SKILL_KB_CONFIG;
  const catalog = await loadCatalog(
    configuredPath === undefined ? {} : { globalConfigPath: configuredPath },
  );
  const server = createServer(catalog);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[skill-kb] ${message}`);
  process.exitCode = 1;
});

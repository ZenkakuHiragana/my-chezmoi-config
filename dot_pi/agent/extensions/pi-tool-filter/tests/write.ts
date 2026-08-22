import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { allowed, blocked, call, configPath, handlerFor, readConfig } from "./support.ts";

export function registerWriteTests(): void {
  test("write 明示 deny は作業ディレクトリ内でも拒否する", async () => {
    const originalConfig = readFileSync(configPath, "utf8");
    try {
      const baseConfig = readConfig();
      const denyConfig = structuredClone(baseConfig);
      denyConfig.write.deny = [...(denyConfig.write.deny ?? []), "dot_pi/**"];
      const handler = await handlerFor(denyConfig);
      blocked(await call(handler, "write", { path: "dot_pi/agent/reject.txt" }), "作業ディレクトリ内 write の明示 deny");
      blocked(await call(handler, "edit", { path: "dot_pi/agent/reject.txt" }), "作業ディレクトリ内 edit の明示 deny");
      allowed(await call(handler, "write", { path: "pi-tool-filter-deny-allow.txt" }), "deny と一致しない内部 write");
    } finally {
      writeFileSync(configPath, originalConfig);
    }
  });

}

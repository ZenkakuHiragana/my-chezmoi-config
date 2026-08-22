import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { call, configPath, handlerFor, readConfig } from "./support.ts";

export function registerReasonTests(): void {
  test("bash 拒否 reason は一致 Glob と作用禁止の意味論を含む", async () => {
    const originalConfig = readFileSync(configPath, "utf8");
    try {
      const handler = await handlerFor(readConfig());
      const result = await call(handler, "bash", { command: "git push" });
      assert.equal(result?.block, true, "bash git push は拒否される");
      assert.ok(result?.reason?.includes("git push *"), "拒否理由に一致した Glob を含む");
      assert.ok(result?.reason?.includes("認可判断"), "拒否理由に認可判断の意味論を含む");
      assert.ok(result?.reason?.includes("代替経路"), "拒否理由に代替経路の禁止を含む");
    } finally {
      writeFileSync(configPath, originalConfig);
    }
  });

}

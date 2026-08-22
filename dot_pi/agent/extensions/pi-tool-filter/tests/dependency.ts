import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  allowed,
  blocked,
  call,
  configPath,
  copyProductionSources,
  extensionDir,
  handlerFor,
  lockPath,
  packagePath,
  productionSourceNames,
  readConfig,
} from "./support.ts";

export function registerDependencyTests(): void {
  test("Piフィルターの解析依存は拡張自身から解決される", () => {
    const managedPackage = JSON.parse(readFileSync("dot_pi/agent/extensions/pi-tool-filter/package.json", "utf8"));
    const runtimePackage = JSON.parse(readFileSync(packagePath, "utf8"));
    const managedLock = readFileSync("dot_pi/agent/extensions/pi-tool-filter/package-lock.json", "utf8");
    const runtimeLock = readFileSync(lockPath, "utf8");
    assert.deepEqual(runtimePackage, managedPackage, "展開後package.jsonが管理ソースと一致する");
    assert.equal(runtimeLock, managedLock, "展開後package-lock.jsonが管理ソースと一致する");
    const managedSourceNames = productionSourceNames();
    const runtimeSourceNames = readdirSync(extensionDir)
      .filter((name) => name.endsWith(".ts") && name !== "index.test.ts")
      .sort();
    assert.deepEqual(runtimeSourceNames, managedSourceNames, "展開後の実装ファイル群が管理ソースと一致する");
    for (const name of managedSourceNames) {
      assert.equal(
        readFileSync(join(extensionDir, name), "utf8"),
        readFileSync(join("dot_pi/agent/extensions/pi-tool-filter", name), "utf8"),
        `${name}が管理ソースと一致する`,
      );
    }
    assert.equal(managedPackage.dependencies["tree-sitter-bash"], "0.25.1", "tree-sitter-bashを拡張自身が宣言する");
    assert.equal(managedPackage.dependencies["tree-sitter-python"], "0.25.0", "tree-sitter-pythonを拡張自身が宣言する");
    assert.equal(managedPackage.dependencies["tree-sitter-javascript"], "0.25.0", "tree-sitter-javascriptを拡張自身が宣言する");
    assert.equal(managedPackage.dependencies["web-tree-sitter"], "0.26.12", "web-tree-sitterを拡張自身が宣言する");
    assert.ok(existsSync(join(extensionDir, "node_modules", "web-tree-sitter")), "拡張自身のweb-tree-sitter依存が存在する");
    assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-bash")), "拡張自身のtree-sitter-bash依存が存在する");
    assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-python")), "拡張自身のtree-sitter-python依存が存在する");
    assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-javascript")), "拡張自身のtree-sitter-javascript依存が存在する");
    assert.equal(readFileSync("dot_pi/agent/extensions/pi-tool-filter/index.ts", "utf8").includes("@gotgenes/pi-permission-system"), false, "別拡張を依存解決の起点にしない");
  });

  test("Piフィルターの解析依存なし縮退経路", async () => {
    const originalConfig = readFileSync(configPath, "utf8");
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-tool-filter-degraded-"));
    const temporaryExtensionPath = join(temporaryDirectory, "index.ts");
    const outside = join(homedir(), "pi-tool-filter-degraded-never-created.txt");
    const outsideShell = outside.replaceAll("\\", "/");
    copyProductionSources(temporaryDirectory);

    try {
      const handler = await handlerFor(readConfig(), temporaryExtensionPath);
      assert.equal(
        existsSync(join(temporaryDirectory, "node_modules")),
        false,
        "依存なしの一時拡張へnode_modulesを作成しない",
      );
      blocked(await call(handler, "bash", { command: "git push" }), "解析依存なしの既存bash拒否Glob");
      allowed(await call(handler, "bash", { command: "printf safe" }), "解析依存なしの安全なbash");
      blocked(
        await call(handler, "bash", { command: `printf safe > ${outsideShell}` }),
        "解析依存なしの固定リダイレクトwrite",
      );
      allowed(
        await call(handler, "bash", { command: `cp README.md ${outsideShell}` }),
        "解析依存なしでは追加パス層を飛ばす",
      );
      assert.equal(existsSync(outside), false, "縮退判定中に外部試験対象を作成しない");
    } finally {
      writeFileSync(configPath, originalConfig);
      rmSync(temporaryDirectory, { recursive: true, force: true });
      assert.equal(readFileSync(configPath, "utf8"), originalConfig, "縮退試験の設定を復元できる");
    }
  });

}

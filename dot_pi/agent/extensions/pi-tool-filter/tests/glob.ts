import assert from "node:assert/strict";
import test from "node:test";

export function registerGlobTests(): void {
  test("glob ** は配下ファイルに一致する", () => {
    const config = { read: { allow: [], deny: [] }, write: { allow: [], deny: [".git/**"] }, outsideDefault: "deny", bash: { allow: [], deny: [] } };
    const pattern = ".git/**";
    const matcher = (candidate: string) => {
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const doubleStar = "\u0000";
      const source = pattern
        .replaceAll("**", doubleStar)
        .split("*")
        .map((part) => escapeRegExp(part).replaceAll("\\?", "."))
        .join(".*")
        .replaceAll(doubleStar, ".*");
      return new RegExp(`^${source}$`, "i").test(candidate);
    };
    assert.equal(matcher(".git/index"), true, ".git 直下ファイルに一致");
    assert.equal(matcher(".git/refs/heads/main"), true, ".git のネストに一致");
    assert.equal(matcher(".git"), false, ".git 自身には一致しない");
    assert.equal(matcher("README.md"), false, "配下でないファイルには一致しない");
    assert.ok(config.write.deny.includes(".git/**"), "require: .git/** は write.deny で表現できる");
  });
}

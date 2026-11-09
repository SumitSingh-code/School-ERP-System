import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

test("every Next route handler uses the common authenticated school wrapper", () => {
  const app = join(process.cwd(), "src", "app");
  const routes = routeFiles(app);
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /with(?:School|Public)Route\s*\(/, `${path} must declare handlers through the common route wrapper`);
    assert.doesNotMatch(source, /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/, `${path} must not export an unwrapped handler function`);
    if (/export\s+(?:const|function)\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source)) {
      assert.match(source, /auditedMutation\s*\(|auditLog\.create\s*\(/, `${path} mutation must write an audit event`);
    }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
      const directAudit = /auditedMutation\s*\(|auditLog\.create\s*\(/.test(source);
      const auditedService = [...source.matchAll(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)].some(([, namedImports, specifier]) => {
        const modulePath = specifier?.startsWith("@/") ? resolve(process.cwd(), "src", `${specifier.slice(2)}.ts`) : "";
        if (!modulePath || !namedImports) return false;
        const service = readFileSync(modulePath, "utf8");
        return /auditedMutation\s*\(|auditLog\.create\s*\(/.test(service)
          && namedImports.split(",").some((entry) => source.includes(entry.trim().split(/\s+as\s+/)[0] ?? ""));
      });
      assert.ok(directAudit || auditedService, `${path} mutation must write an audit event directly or through an imported audited service`);
    }
  }
});

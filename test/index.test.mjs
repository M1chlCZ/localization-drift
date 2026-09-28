import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeSource, scanRepository } from "../src/index.mjs";

test("reports customer-visible JSX text and translated attributes", () => {
  const findings = analyzeSource(
    "src/components/example.tsx",
    `<button aria-label="Close preview">Save changes</button>`,
  );
  assert.deepEqual(findings.map((finding) => finding.kind), [
    "localized-attribute",
    "localized-jsx-text",
  ]);
});

test("accepts key-based customer copy", () => {
  const findings = analyzeSource(
    "src/components/example.tsx",
    `<button aria-label={translate("ui.preview.close")}>
      {translate("ui.preview.save")}
    </button>`,
  );
  assert.deepEqual(findings, []);
});

test("reports configured forbidden patterns", () => {
  const forbidden = [{
    pattern: "widget_type\\s*===\\s*[\"'][^\"']+[\"']",
    message: "use stored capabilities instead of a widget value",
  }];
  const findings = analyzeSource(
    "src/components/widget.tsx",
    `const size = widget_type === "variant" ? 1 : 0;`,
    { forbidden },
  );
  assert.deepEqual(findings.map((finding) => finding.kind), ["forbidden-pattern"]);
});

test("reports forbidden patterns in non-JSX sources", () => {
  const forbidden = [{ pattern: "kind\\s*=\\s*[\"'][^\"']+[\"']", message: "registry value" }];
  const findings = analyzeSource(
    "src/registry.go",
    `const kind = "variant"
     const query = "WHERE kind='variant'";`,
    { checkJSX: false, forbidden },
  );
  assert.deepEqual(findings.map((finding) => finding.kind), [
    "forbidden-pattern",
    "forbidden-pattern",
  ]);
});

test("supports a narrow reviewed exception on the following line", () => {
  const findings = analyzeSource(
    "src/components/example.tsx",
    `// localization-drift: allow-next-line -- registered brand name
    <strong>WhatsApp</strong>`,
  );
  assert.deepEqual(findings, []);
});

test("scans configured roots and skips excluded paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "localization-drift-"));
  await mkdir(join(root, "src", "generated"), { recursive: true });
  await writeFile(join(root, "src", "page.tsx"), `<h1>Welcome</h1>`);
  await writeFile(join(root, "src", "generated", "copy.tsx"), `<h1>Welcome</h1>`);
  await writeFile(join(root, "src", "component.test.tsx"), `<h1>Welcome</h1>`);
  const findings = await scanRepository(root, { roots: ["src"] });
  assert.deepEqual(findings.map((finding) => `${finding.path}:${finding.line}`), ["src/page.tsx:1"]);
});

test("cli reports findings and exits with status one", async () => {
  const root = await mkdtemp(join(tmpdir(), "localization-drift-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "page.tsx"), `<h1>Welcome</h1>`);
  const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /page\.tsx:1: localized-jsx-text/);
});

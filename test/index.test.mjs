import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeSource, scanRepository } from "../src/index.mjs";

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "localization-drift-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

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

test("accepts the sibling localization-audit marker", () => {
  const findings = analyzeSource(
    "src/components/example.tsx",
    `// localization-audit: allow-next-line -- registered brand name
    <strong>WhatsApp</strong>`,
  );
  assert.deepEqual(findings, []);
});

test("accepts the JSX comment marker form", () => {
  const findings = analyzeSource(
    "src/components/example.tsx",
    `{/* localization-audit: allow-next-line -- registered brand name */}
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
  const result = runCli(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /page\.tsx:1: localized-jsx-text/);
});

test("cli prints findings as JSON", async () => {
  const root = await fixture({ "src/page.tsx": `<h1>Welcome</h1>\n` });
  const result = runCli(root, ["--json"]);
  assert.equal(result.status, 1);
  const findings = JSON.parse(result.stdout);
  assert.deepEqual(
    findings.map((item) => `${item.path}:${item.line}:${item.kind}`),
    ["src/page.tsx:1:localized-jsx-text"],
  );
});

test("cli fix annotates findings and passes on the next run", async () => {
  const root = await fixture({
    "localization-drift.json": JSON.stringify({
      roots: ["src"],
      forbidden: [{ pattern: "kind\\s*=", message: "registry value" }],
    }),
    "src/page.tsx": [
      "export function App() {",
      "  return (",
      "    <div>",
      "      <strong>WhatsApp</strong>",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n"),
    "src/registry.ts": `const kind = "variant";\n`,
  });

  const first = runCli(root, ["--fix"]);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /Localization audit passed\./);
  assert.equal(first.stderr, [
    "annotated src/page.tsx: 1 marker(s)",
    "annotated src/registry.ts: 1 marker(s)",
    "2 file(s) annotated, 2 marker(s) with TODO: localize.",
    "",
  ].join("\n"));

  const page = await readFile(join(root, "src", "page.tsx"), "utf8");
  assert.equal(page, [
    "export function App() {",
    "  return (",
    "    <div>",
    "      {/* localization-drift: allow-next-line -- TODO: localize */}",
    "      <strong>WhatsApp</strong>",
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n"));

  const registry = await readFile(join(root, "src", "registry.ts"), "utf8");
  assert.equal(registry, [
    "// localization-drift: allow-next-line -- TODO: localize",
    `const kind = "variant";`,
    "",
  ].join("\n"));

  const second = runCli(root, ["--fix"]);
  assert.equal(second.status, 0);
  assert.equal(second.stderr, "");
  assert.equal(await readFile(join(root, "src", "page.tsx"), "utf8"), page);
  assert.equal(await readFile(join(root, "src", "registry.ts"), "utf8"), registry);
});

test("cli fix preserves CRLF endings and the missing trailing newline", async () => {
  const root = await fixture({
    "src/page.tsx": "export function App() {\r\n  return (\r\n    <h1>Welcome</h1>\r\n  );\r\n}\r\n",
    "src/plain.tsx": `<h1>Welcome</h1>`,
  });
  const result = runCli(root, ["--fix"]);
  assert.equal(result.status, 0);
  assert.equal(
    await readFile(join(root, "src", "page.tsx"), "utf8"),
    "export function App() {\r\n  return (\r\n    // localization-drift: allow-next-line -- TODO: localize\r\n    <h1>Welcome</h1>\r\n  );\r\n}\r\n",
  );
  assert.equal(
    await readFile(join(root, "src", "plain.tsx"), "utf8"),
    "// localization-drift: allow-next-line -- TODO: localize\n<h1>Welcome</h1>",
  );
});

test("cli fix leaves already marked lines untouched", async () => {
  const root = await fixture({
    "src/brand.tsx": [
      "// localization-audit: allow-next-line -- registered brand name",
      "<strong>WhatsApp</strong>",
      "<h1>Welcome</h1>",
      "",
    ].join("\n"),
  });
  const result = runCli(root, ["--fix"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, [
    "annotated src/brand.tsx: 1 marker(s)",
    "1 file(s) annotated, 1 marker(s) with TODO: localize.",
    "",
  ].join("\n"));
  const fixed = await readFile(join(root, "src", "brand.tsx"), "utf8");
  assert.equal(fixed, [
    "// localization-audit: allow-next-line -- registered brand name",
    "<strong>WhatsApp</strong>",
    "// localization-drift: allow-next-line -- TODO: localize",
    "<h1>Welcome</h1>",
    "",
  ].join("\n"));

  const second = runCli(root, ["--fix"]);
  assert.equal(second.status, 0);
  assert.equal(await readFile(join(root, "src", "brand.tsx"), "utf8"), fixed);
});

test("cli fix never edits a line that already has a marker", async () => {
  const root = await fixture({
    "src/legacy.tsx": [
      "<div>",
      "  // localization-audit: allow-next-line -- legacy marker",
      "  <strong>WhatsApp</strong>",
      "</div>",
      "",
    ].join("\n"),
  });
  const before = await readFile(join(root, "src", "legacy.tsx"), "utf8");
  const result = runCli(root, ["--fix"]);
  assert.equal(result.status, 1);
  assert.equal(await readFile(join(root, "src", "legacy.tsx"), "utf8"), before);
  assert.match(result.stderr, /legacy\.tsx:2: localized-jsx-text/);
});

test("config allowlist suppresses matching findings", async () => {
  const root = await fixture({
    "localization-drift.json": JSON.stringify({
      allowlist: [{ pattern: "WhatsApp", reason: "registered brand name" }],
    }),
    "src/brand.tsx": `<h1>WhatsApp</h1>\n<p>Welcome</p>\n`,
  });
  const audit = runCli(root);
  assert.equal(audit.status, 1);
  assert.doesNotMatch(audit.stderr, /WhatsApp/);
  assert.match(audit.stderr, /brand\.tsx:2: localized-jsx-text/);
});

test("cli fix does not annotate allowlisted findings", async () => {
  const root = await fixture({
    "localization-drift.json": JSON.stringify({
      allowlist: [{ pattern: "WhatsApp", reason: "registered brand name" }],
    }),
    "src/brand.tsx": `<h1>WhatsApp</h1>\n`,
  });
  const before = await readFile(join(root, "src", "brand.tsx"), "utf8");
  const result = runCli(root, ["--fix"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(await readFile(join(root, "src", "brand.tsx"), "utf8"), before);
});

test("invalid allowlist patterns and reasons exit with status two", async () => {
  const invalidPattern = await fixture({
    "localization-drift.json": JSON.stringify({ allowlist: [{ pattern: "(", reason: "broken" }] }),
    "src/page.tsx": `<h1>Welcome</h1>\n`,
  });
  const patternResult = runCli(invalidPattern);
  assert.equal(patternResult.status, 2);
  assert.match(patternResult.stderr, /allowlist\[0\]\.pattern is not a valid regular expression/);

  const missingReason = await fixture({
    "localization-drift.json": JSON.stringify({ allowlist: [{ pattern: "Welcome" }] }),
    "src/page.tsx": `<h1>Welcome</h1>\n`,
  });
  const reasonResult = runCli(missingReason);
  assert.equal(reasonResult.status, 2);
  assert.match(reasonResult.stderr, /allowlist\[0\]\.reason must be a non-empty string/);
});

test("cli sarif prints one SARIF 2.1.0 document", async () => {
  const root = await fixture({
    "src/page.tsx": `<button aria-label="Close">Save</button>\n`,
  });
  const result = runCli(root, ["--sarif"]);
  assert.equal(result.status, 1);
  const document = JSON.parse(result.stdout);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(document.$schema, "https://json.schemastore.org/sarif-2.1.0.json");
  assert.equal(document.version, "2.1.0");
  assert.equal(document.runs.length, 1);
  const driver = document.runs[0].tool.driver;
  assert.equal(driver.name, "localization-drift");
  assert.equal(driver.version, manifest.version);
  assert.equal(driver.informationUri, "https://github.com/M1chlCZ/localization-drift");
  assert.deepEqual(driver.rules.map((rule) => rule.id), [
    "localized-attribute",
    "localized-jsx-text",
  ]);

  const [attribute, text] = document.runs[0].results;
  assert.equal(attribute.ruleId, "localized-attribute");
  assert.equal(attribute.level, "error");
  assert.equal(attribute.message.text, "customer-visible aria-label must come from a translation key");
  assert.deepEqual(attribute.locations, [{
    physicalLocation: {
      artifactLocation: { uri: "src/page.tsx" },
      region: { startLine: 1 },
    },
  }]);
  assert.equal(text.ruleId, "localized-jsx-text");
  assert.equal(text.level, "error");
  assert.equal(text.locations[0].physicalLocation.artifactLocation.uri, "src/page.tsx");
  assert.equal(text.locations[0].physicalLocation.region.startLine, 1);
});

test("cli sarif prints an empty document when the audit passes", async () => {
  const root = await fixture({ "src/page.tsx": `<h1>{translate("ui.welcome")}</h1>\n` });
  const result = runCli(root, ["--sarif"]);
  assert.equal(result.status, 0);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.runs[0].tool.driver.rules, []);
  assert.deepEqual(document.runs[0].results, []);
});

test("json and sarif output flags are mutually exclusive", async () => {
  const root = await fixture({ "src/page.tsx": `<h1>Welcome</h1>\n` });
  const result = runCli(root, ["--json", "--sarif"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--json and --sarif are mutually exclusive/);
});

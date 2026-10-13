#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { fixRepository, scanRepository } from "./index.mjs";
import { buildSarif } from "./sarif.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = manifest.version;

const usage = `Usage: localization-drift [options]

Options:
  --config FILE    read a JSON configuration file
  --root DIR       scan DIR (repeatable; overrides the configured roots)
  --fix            annotate findings with a TODO: localize marker
  --json           print the findings as JSON
  --sarif          print the findings as one SARIF 2.1.0 document
  -h, --help       show this help
  -v, --version    show the version`;

function readConfig(path, required) {
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && !required) return {};
    if (error.code === "ENOENT") throw new Error(`configuration file not found: ${path}`);
    throw new Error(`invalid configuration file: ${path}`);
  }
}

function printFindings(findings) {
  for (const item of findings) {
    process.stderr.write(`${item.path}:${item.line}: ${item.kind}: ${item.message}\n`);
  }
  process.stderr.write(`${findings.length} localization finding(s).\n`);
}

function printFixSummary(files) {
  let markers = 0;
  for (const file of files) {
    markers += file.annotated;
    process.stderr.write(`annotated ${file.path}: ${file.annotated} marker(s)\n`);
  }
  process.stderr.write(`${files.length} file(s) annotated, ${markers} marker(s) with TODO: localize.\n`);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string" },
      root: { type: "string", multiple: true },
      fix: { type: "boolean" },
      json: { type: "boolean" },
      sarif: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
  });
  if (values.version) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (values.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (values.json && values.sarif) {
    throw new Error("--json and --sarif are mutually exclusive");
  }

  const root = process.cwd();
  const config = values.config
    ? readConfig(resolve(root, values.config), true)
    : readConfig(resolve(root, "localization-drift.json"), false);
  if (values.root?.length) config.roots = values.root;

  const result = values.fix
    ? await fixRepository(root, config)
    : { files: [], findings: await scanRepository(root, config) };
  if (result.files.length > 0) printFixSummary(result.files);

  const { findings } = result;
  if (values.sarif) {
    const document = buildSarif(findings, { version, repository: manifest.repository });
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  } else if (values.json) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write("Localization audit passed.\n");
  } else {
    printFindings(findings);
  }
  if (findings.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});

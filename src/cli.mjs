#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { scanRepository } from "./index.mjs";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const usage = `Usage: localization-drift [options]

Options:
  --config FILE    read a JSON configuration file
  --root DIR       scan DIR (repeatable; overrides the configured roots)
  --json           print the findings as JSON
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

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string" },
      root: { type: "string", multiple: true },
      json: { type: "boolean" },
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

  const root = process.cwd();
  const config = values.config
    ? readConfig(resolve(root, values.config), true)
    : readConfig(resolve(root, "localization-drift.json"), false);
  if (values.root?.length) config.roots = values.root;

  const findings = await scanRepository(root, config);
  if (values.json) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write("Localization audit passed.\n");
  } else {
    for (const item of findings) {
      process.stderr.write(`${item.path}:${item.line}: ${item.kind}: ${item.message}\n`);
    }
    process.stderr.write(`${findings.length} localization finding(s).\n`);
  }
  if (findings.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});

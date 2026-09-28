import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import ts from "typescript";

export const ALLOW_COMMENT = "// localization-drift: allow-next-line -- ";

export const DEFAULT_CONFIG = Object.freeze({
  roots: ["src"],
  extensions: [".tsx", ".ts"],
  attributes: ["alt", "aria-label", "placeholder", "title"],
  exclude: ["\\.test\\.", "/test/", "/generated/", "node_modules", "\\.d\\.ts$"],
  forbidden: [],
});

function lineDetails(source, index) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const lines = source.split("\n");
  return {
    line,
    text: lines[line - 1]?.trim() ?? "",
    previous: lines[line - 2]?.trim() ?? "",
  };
}

function reviewedException(source, index, allowComment) {
  return lineDetails(source, index).previous.startsWith(allowComment);
}

function finding(path, source, index, kind, message) {
  const details = lineDetails(source, index);
  return { path, line: details.line, kind, message, text: details.text };
}

/**
 * analyzeSource reports customer-visible JSX text, localized attributes, and
 * configured forbidden patterns in one source file.
 */
export function analyzeSource(path, source, options = {}) {
  const {
    checkJSX = path.endsWith(".tsx"),
    attributes = DEFAULT_CONFIG.attributes,
    forbidden = [],
    allowComment = ALLOW_COMMENT,
  } = options;
  const localizedAttributes = new Set(attributes);
  const indexed = [];

  if (checkJSX) {
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxAttribute(node) &&
          localizedAttributes.has(node.name.text) &&
          node.initializer && ts.isStringLiteral(node.initializer) &&
          /\p{L}/u.test(node.initializer.text)) {
        const index = node.getStart(sourceFile);
        if (!reviewedException(source, index, allowComment)) {
          indexed.push({
            index,
            finding: finding(
              path,
              source,
              index,
              "localized-attribute",
              `customer-visible ${node.name.text} must come from a translation key`,
            ),
          });
        }
      }
      if (ts.isJsxText(node)) {
        const value = node.getText(sourceFile).replace(/\s+/g, " ").trim();
        const index = node.getStart(sourceFile);
        if (value && /\p{L}/u.test(value) && !reviewedException(source, index, allowComment)) {
          indexed.push({
            index,
            finding: finding(
              path,
              source,
              index,
              "localized-jsx-text",
              `customer-visible JSX text must come from a translation key: ${JSON.stringify(value)}`,
            ),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  for (const rule of forbidden) {
    if (!rule || typeof rule.pattern !== "string" || typeof rule.message !== "string") continue;
    const pattern = new RegExp(rule.pattern, "g");
    for (const match of source.matchAll(pattern)) {
      if (reviewedException(source, match.index, allowComment)) continue;
      indexed.push({
        index: match.index,
        finding: finding(path, source, match.index, "forbidden-pattern", rule.message),
      });
    }
  }

  return indexed
    .sort((left, right) => left.index - right.index)
    .map(({ finding: result }) => result);
}

function excludedPath(path, exclude) {
  return exclude.some((pattern) => new RegExp(pattern).test(path));
}

async function* walk(directory, config) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if ([".git", ".next", ".tmp", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path, config);
      continue;
    }
    if (!config.extensions.includes(extname(entry.name))) continue;
    yield path;
  }
}

/**
 * scanRepository walks the configured roots and returns every finding, sorted
 * by path and line.
 */
export async function scanRepository(root, config = {}) {
  const settings = {
    roots: config.roots ?? DEFAULT_CONFIG.roots,
    extensions: config.extensions ?? DEFAULT_CONFIG.extensions,
    attributes: config.attributes ?? DEFAULT_CONFIG.attributes,
    exclude: config.exclude ?? DEFAULT_CONFIG.exclude,
    forbidden: config.forbidden ?? DEFAULT_CONFIG.forbidden,
    allowComment: config.allowComment ?? ALLOW_COMMENT,
  };
  const findings = [];
  for (const directory of settings.roots) {
    for await (const absolute of walk(join(root, directory), settings)) {
      const path = relative(root, absolute).split(sep).join("/");
      if (excludedPath(path, settings.exclude)) continue;
      const source = await readFile(absolute, "utf8");
      findings.push(...analyzeSource(path, source, {
        checkJSX: settings.extensions.includes(extname(path)) && path.endsWith(".tsx"),
        attributes: settings.attributes,
        forbidden: settings.forbidden,
        allowComment: settings.allowComment,
      }));
    }
  }
  return findings.sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line
  );
}

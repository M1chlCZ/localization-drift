import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import ts from "typescript";

export const ALLOW_COMMENT = "// localization-drift: allow-next-line -- ";
export const SIBLING_ALLOW_COMMENT = "// localization-audit: allow-next-line -- ";
export const FIX_REASON = "TODO: localize";

export const DEFAULT_CONFIG = Object.freeze({
  roots: ["src"],
  extensions: [".tsx", ".ts"],
  attributes: ["alt", "aria-label", "placeholder", "title"],
  exclude: ["\\.test\\.", "/test/", "/generated/", "node_modules", "\\.d\\.ts$"],
  forbidden: [],
  allowlist: [],
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

function commentBody(line) {
  if (line.startsWith("//")) return line.slice(2).trimStart();
  if (line.startsWith("{/*") && line.endsWith("*/}")) return line.slice(3, -3).trim();
  if (line.startsWith("/*") && line.endsWith("*/")) return line.slice(2, -2).trim();
  return null;
}

function markerPrefixMatches(line, prefix) {
  if (line.startsWith(prefix)) return true;
  if (!prefix.startsWith("// ")) return false;
  const body = commentBody(line);
  return body !== null && body.startsWith(prefix.slice(3));
}

function reviewedException(source, index, allowComments) {
  const previous = lineDetails(source, index).previous;
  return allowComments.some((prefix) => markerPrefixMatches(previous, prefix));
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
  const allowComments = [allowComment, SIBLING_ALLOW_COMMENT];
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
        if (!reviewedException(source, index, allowComments)) {
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
        if (value && /\p{L}/u.test(value) && !reviewedException(source, index, allowComments)) {
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
      if (reviewedException(source, match.index, allowComments)) continue;
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

function compileAllowlist(allowlist) {
  if (!Array.isArray(allowlist)) {
    throw new Error("allowlist must be an array of { pattern, reason } entries");
  }
  return allowlist.map((entry, index) => {
    if (!entry || typeof entry.pattern !== "string") {
      throw new Error(`allowlist[${index}].pattern must be a string`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      throw new Error(`allowlist[${index}].reason must be a non-empty string`);
    }
    try {
      return { pattern: new RegExp(entry.pattern), reason: entry.reason };
    } catch {
      throw new Error(`allowlist[${index}].pattern is not a valid regular expression: ${entry.pattern}`);
    }
  });
}

function allowlisted(item, allowlist) {
  return allowlist.some((rule) => rule.pattern.test(item.message));
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

function compileSettings(config = {}) {
  return {
    roots: config.roots ?? DEFAULT_CONFIG.roots,
    extensions: config.extensions ?? DEFAULT_CONFIG.extensions,
    attributes: config.attributes ?? DEFAULT_CONFIG.attributes,
    exclude: config.exclude ?? DEFAULT_CONFIG.exclude,
    forbidden: config.forbidden ?? DEFAULT_CONFIG.forbidden,
    allowComment: config.allowComment ?? ALLOW_COMMENT,
    allowlist: compileAllowlist(config.allowlist ?? DEFAULT_CONFIG.allowlist),
  };
}

function analysisOptions(settings) {
  return {
    attributes: settings.attributes,
    forbidden: settings.forbidden,
    allowComment: settings.allowComment,
  };
}

async function* repositorySources(root, settings) {
  for (const directory of settings.roots) {
    for await (const absolute of walk(join(root, directory), settings)) {
      const path = relative(root, absolute).split(sep).join("/");
      if (excludedPath(path, settings.exclude)) continue;
      yield { path, absolute, source: await readFile(absolute, "utf8") };
    }
  }
}

function sortFindings(findings) {
  return findings.sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line
  );
}

/**
 * scanRepository walks the configured roots and returns every finding, sorted
 * by path and line. Allowlisted messages are removed.
 */
export async function scanRepository(root, config = {}) {
  const settings = compileSettings(config);
  const options = analysisOptions(settings);
  const findings = [];
  for await (const file of repositorySources(root, settings)) {
    findings.push(...analyzeSource(file.path, file.source, options)
      .filter((item) => !allowlisted(item, settings.allowlist)));
  }
  return sortFindings(findings);
}

function splitLines(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const endsWithEol = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  if (endsWithEol) lines.pop();
  return { eol, endsWithEol, lines };
}

function isMarkerLine(line, allowComments) {
  const trimmed = line.trim();
  return allowComments.some((prefix) => markerPrefixMatches(trimmed, prefix));
}

function applyMarkers(source, markers) {
  const { eol, endsWithEol, lines } = splitLines(source);
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = markers.get(index + 1);
    if (marker !== undefined) result.push(marker);
    result.push(lines[index]);
  }
  return result.join(eol) + (endsWithEol ? eol : "");
}

function markerForms(allowComment) {
  const forms = [`${allowComment}${FIX_REASON}`];
  if (allowComment.startsWith("// ")) {
    forms.push(`{/* ${allowComment.slice(3)}${FIX_REASON} */}`);
  }
  return forms;
}

function chooseMarker(path, source, options, allowComments, item, total) {
  const { lines } = splitLines(source);
  const target = lines[item.line - 1] ?? "";
  if (isMarkerLine(target, allowComments)) return null;
  if (isMarkerLine(lines[item.line - 2] ?? "", allowComments)) return null;
  const indentation = /^[ \t]*/.exec(target)[0];
  for (const form of markerForms(options.allowComment)) {
    const marker = `${indentation}${form}`;
    const candidate = applyMarkers(source, new Map([[item.line, marker]]));
    const introduced = analyzeSource(path, candidate, options);
    const markerIsFinding = introduced.some((candidateFinding) => candidateFinding.text === marker.trim());
    if (!markerIsFinding && introduced.length < total) return marker;
  }
  return null;
}

function fixSource(path, source, options, allowlist) {
  const allowComments = [options.allowComment, SIBLING_ALLOW_COMMENT];
  let current = source;
  let annotated = 0;
  while (true) {
    const findings = analyzeSource(path, current, options)
      .filter((item) => !allowlisted(item, allowlist));
    if (findings.length === 0) break;
    const markers = new Map();
    for (const item of findings) {
      if (markers.has(item.line)) continue;
      const marker = chooseMarker(path, current, options, allowComments, item, findings.length);
      if (marker !== null) markers.set(item.line, marker);
    }
    if (markers.size === 0) break;
    current = applyMarkers(current, markers);
    annotated += markers.size;
  }
  return { source: current, annotated };
}

/**
 * fixRepository annotates every reported finding with an exception marker and
 * writes the edited files. Every edit is computed before the first write.
 * Returns the edited files and the findings that remain.
 */
export async function fixRepository(root, config = {}) {
  const settings = compileSettings(config);
  const options = analysisOptions(settings);
  const edits = [];
  const remaining = [];
  for await (const file of repositorySources(root, settings)) {
    const fixed = fixSource(file.path, file.source, options, settings.allowlist);
    if (fixed.annotated > 0) {
      edits.push({
        path: file.path,
        absolute: file.absolute,
        source: fixed.source,
        annotated: fixed.annotated,
      });
    }
    remaining.push(...analyzeSource(file.path, fixed.source, options)
      .filter((item) => !allowlisted(item, settings.allowlist)));
  }
  edits.sort((left, right) => left.path.localeCompare(right.path));
  for (const edit of edits) {
    await writeFile(edit.absolute, edit.source, "utf8");
  }
  return {
    files: edits.map(({ path, annotated }) => ({ path, annotated })),
    findings: sortFindings(remaining),
  };
}

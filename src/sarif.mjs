const SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

const KIND_DESCRIPTIONS = {
  "localized-jsx-text": "Customer-visible JSX text must come from a translation key.",
  "localized-attribute": "Customer-visible JSX attributes must come from a translation key.",
  "forbidden-pattern": "A configured forbidden pattern is present in the source.",
};

function normalizeRepository(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (typeof url !== "string") return undefined;
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

/**
 * buildSarif renders findings as one SARIF 2.1.0 document.
 */
export function buildSarif(findings, meta = {}) {
  const rules = [];
  const results = [];
  for (const item of findings) {
    if (!rules.some((rule) => rule.id === item.kind)) {
      rules.push({
        id: item.kind,
        name: item.kind,
        shortDescription: { text: KIND_DESCRIPTIONS[item.kind] ?? item.kind },
      });
    }
    results.push({
      ruleId: item.kind,
      level: "error",
      message: { text: item.message },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: item.path },
          region: { startLine: item.line },
        },
      }],
    });
  }
  const driver = {
    name: "localization-drift",
    version: meta.version,
    informationUri: normalizeRepository(meta.repository),
    rules,
  };
  return {
    $schema: SCHEMA,
    version: "2.1.0",
    runs: [{ tool: { driver }, results }],
  };
}

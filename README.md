# localization-drift

Fail a build when customer-visible text bypasses translation keys.

## Features

- Flags hardcoded JSX text and localized attributes in `.tsx` files.
- Flags configured forbidden patterns in the scanned source files.
- Honors a reviewed exception comment on the line before a finding.
- Annotates findings with `--fix` so an adopted codebase can go green and
  triage the annotated debt.
- Suppresses reviewed message text through an allowlist.
- Prints text lines, JSON, or one SARIF 2.1.0 document.
- Runs as a CLI, an npm package, or a GitHub Action.
- Pairs with [localize](https://github.com/m1chlcz/localize) for the workbook and ARB side.

## Install

```
npm install --save-dev localization-drift
```

Node.js 22 or later is required.

## Usage

```
npx localization-drift
npx localization-drift --root app --root components
npx localization-drift --fix
npx localization-drift --json
npx localization-drift --sarif > localization-drift.sarif
```

The output is one line per finding: `path:line: kind: message`. The exit code
is 1 for findings and 2 for a usage or configuration error. `--json` and
`--sarif` are mutually exclusive. Combined with `--fix`, they print the
findings that remain after the fix.

## Fix

`--fix` adds the exception marker with a `TODO: localize` reason on the line
before every reported finding. The audit passes at once and the annotated debt
stays visible for triage.

- Every edit is computed before the first write. A failure leaves the tree
  untouched.
- The file line endings and the indentation of the annotated line are
  preserved.
- A line that already carries a marker is never touched.
- A second run changes nothing.
- Inside JSX children the marker is a JSX comment (`{/* ... */}`) so the file
  stays valid.
- The summary goes to stderr, one line per edited file plus a total.
  `Localization audit passed.` goes to stdout when no finding remains.
- The exit code is 0 when no finding remains and 1 when a finding cannot be
  annotated.

## SARIF

`--sarif` prints one SARIF 2.1.0 document to stdout instead of text lines. The
document has one run, the driver name is `localization-drift`, the version
comes from `package.json`, and the information URI comes from the `repository`
field. Every finding becomes one `error` result with a rule id, the message
text, and the file and line. The exit codes do not change.

## Configuration

Create `localization-drift.json` in the repository root:

```json
{
  "roots": ["app", "components"],
  "extensions": [".tsx", ".ts"],
  "attributes": ["alt", "aria-label", "placeholder", "title"],
  "exclude": ["\\.test\\.", "/generated/", "node_modules"],
  "forbidden": [
    {
      "pattern": "widget_type\\s*===\\s*[\"'][^\"']+[\"']",
      "message": "use stored capabilities instead of a widget value"
    }
  ],
  "allowlist": [
    {
      "pattern": "customer-visible title must come from a translation key",
      "reason": "page titles are rendered from stored content"
    }
  ]
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `roots` | `["src"]` | The directories to scan. |
| `extensions` | `[".tsx", ".ts"]` | The file extensions to scan. |
| `attributes` | `["alt", "aria-label", "placeholder", "title"]` | The JSX attributes that must use a key. |
| `exclude` | tests, `/generated/`, `node_modules` | Regular expressions for paths to skip. |
| `forbidden` | `[]` | Regular expression rules with a message. |
| `allowlist` | `[]` | Suppresses findings whose message matches `pattern`. Every entry needs a non-empty `reason`. An invalid pattern is a configuration error. |
| `allowComment` | the marker below | The exception marker prefix. The sibling `localization-audit` marker is always accepted on top. |

## Exception

Put the marker and a reason on the line before the finding:

```tsx
// localization-drift: allow-next-line -- registered brand name
<strong>WhatsApp</strong>
```

Inside JSX children use a JSX comment:

```tsx
{/* localization-drift: allow-next-line -- registered brand name */}
<strong>WhatsApp</strong>
```

The audit also accepts the sibling marker
`// localization-audit: allow-next-line -- <reason>` in both forms, so a shop
that already carries those comments adopts this tool with a configuration-only
change.

The inline exception comment wins first. The allowlist suppresses the findings
that remain: an allowlisted finding is not reported and `--fix` does not
annotate it.

## GitHub Action

```yaml
- uses: actions/checkout@v7
- uses: m1chlcz/localization-drift@v0.1.0
  with:
    args: --root app
```

Combine it with `localize` to catch generated-file drift as well:

```yaml
- run: go run github.com/m1chlcz/localize/cmd/localize@latest generate --input translations.xlsx --output-dir arb
- run: git diff --exit-code -- arb
```

## Development

```
npm ci
npm test
```

## License

MIT. See `LICENSE`.

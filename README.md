# localization-drift

Fail a build when customer-visible text bypasses translation keys.

## Features

- Flags hardcoded JSX text and localized attributes in `.tsx` files.
- Flags configured forbidden patterns in the scanned source files.
- Honors a reviewed exception comment on the line before a finding.
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
npx localization-drift --json
```

The output is one line per finding: `path:line: kind: message`. The exit code is 1 for findings and 2 for a usage or configuration error.

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
| `allowComment` | the marker below | The exception marker prefix. |

## Exception

Put the marker and a reason on the line before the finding:

```tsx
// localization-drift: allow-next-line -- registered brand name
<strong>WhatsApp</strong>
```

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

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-13

### Added

- `--fix` annotates every reported finding with the exception marker and a
  `TODO: localize` reason. All edits are computed before the first write, line
  endings and indentation are preserved, a second run changes nothing, and the
  edited files are summarized on stderr. Inside JSX children the marker is
  written as a JSX comment.
- Configuration field `allowlist` suppresses findings whose message text
  matches a `pattern` entry that carries a non-empty `reason`. An invalid
  regular expression or a missing reason is a configuration error and exits
  with status 2.
- `--sarif` prints one SARIF 2.1.0 document instead of text lines.
- The sibling exception marker
  `// localization-audit: allow-next-line -- <reason>` is accepted in addition
  to the configured `localization-drift` marker.
- The JSX comment marker form (`{/* localization-drift: allow-next-line -- <reason> */}`)
  is accepted and used by `--fix` inside JSX children.

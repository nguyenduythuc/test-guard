# test-guard

AI-assisted **test-after** framework, packaged as a Claude Code plugin. Bundles skills, a subagent, a hook, and an MCP server so that new code ships with tests and coverage gaps stay visible.

Built around the conventions of a Yarn-workspaces monorepo with a `packages/shared` package tested by **Vitest** (pure logic: utils + Redux Toolkit slices).

## What's inside

| Component | Type | Purpose |
|-----------|------|---------|
| `write-tests` | skill | Author colocated Vitest tests with the repo's exact conventions (RTK reducers, native-module mocking, env/timer/global stubbing). Auto-triggers when you touch pure-logic files. |
| `bug-repro` | skill | Fix bugs test-first: write a failing repro test, confirm red, fix, confirm green. |
| `test-writer` | agent | Batch-retrofit tests for untested files; runs the suite and iterates to green. |
| PostToolUse hook | hook | After editing a `shared` source file with no colocated test, reminds Claude to add one. Never blocks. |
| `test-guard` MCP | mcp | `list_untested_files`, `run_tests`, `coverage_report` — each also writes a JSON result to `<project>/.test-guard/`. |

## Install (from your GitHub fork)

```bash
claude plugin marketplace add <github-user>/test-guard
claude plugin install test-guard@test-guard
```

After install, configure for your repo:
```bash
claude plugin config test-guard workspace_name "@myorg/shared"
claude plugin config test-guard shared_dir "packages/shared"
claude plugin config test-guard scan_dirs "utils,redux,hooks"   # optional, default: utils,redux
claude plugin config test-guard test_runner "vitest run"        # optional default
```

### Local development
```bash
claude --plugin-dir /path/to/test-guard
claude plugin validate /path/to/test-guard
```

## MCP dependencies

The MCP server needs `@modelcontextprotocol/sdk` + `zod`. A `SessionStart` hook runs
`npm install` in the plugin dir once if `node_modules` is missing. To install manually:

```bash
cd /path/to/test-guard && npm install
```

## MCP tools

- **`list_untested_files`** — scans `packages/shared/{utils,redux}` for `.ts/.tsx` source files lacking a colocated `*.test.ts`. → `.test-guard/untested.json`
- **`run_tests`** (optional `pattern`) — runs `yarn workspace @myorg/shared vitest run` and returns a pass/fail summary. → `.test-guard/results.json`
- **`coverage_report`** — runs Vitest v8 coverage and returns per-file/total %. → `.test-guard/coverage.json`

Add `.test-guard/` to your project's `.gitignore`.

## Tuning for another repo

The shared-package path (`packages/shared`), workspace name (`@myorg/shared`),
and scanned dirs (`utils`, `redux`) are referenced in `mcp/server.mjs` and the skills.
Adjust those constants/paths to retarget the plugin.

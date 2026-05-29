#!/usr/bin/env node
/**
 * test-guard MCP server (stdio).
 *
 * Tools:
 *   list_untested_files  — source files with no colocated test
 *   run_tests            — run Vitest (optional pattern), return pass/fail summary
 *   coverage_report      — run Vitest coverage, return per-file/folder %
 *
 * Each tool also writes a result file to <projectDir>/.test-guard/.
 *
 * Config via env (injected from userConfig in .mcp.json):
 *   TG_WORKSPACE    yarn workspace package name  (e.g. @myorg/shared)  [required]
 *   TG_SHARED_DIR   relative path from project root to shared package  (e.g. packages/shared)  [required]
 *   TG_SCAN_DIRS    comma-separated subdirs to scan  (default: utils,redux)
 *   TG_TEST_RUNNER  test runner cmd inside workspace  (default: vitest run)
 *
 * Project root: env CLAUDE_PROJECT_DIR → process.cwd()
 */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
} from 'node:fs';
import {join, basename, extname, relative} from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const WORKSPACE  = process.env.TG_WORKSPACE  || '';
const SHARED_DIR = process.env.TG_SHARED_DIR || 'packages/shared';
const SCAN_DIRS  = (process.env.TG_SCAN_DIRS || 'utils,redux')
  .split(',').map(s => s.trim()).filter(Boolean);
const TEST_RUNNER = (process.env.TG_TEST_RUNNER || 'vitest run')
  .split(' ').filter(Boolean); // e.g. ['vitest', 'run']

const SHARED     = join(PROJECT_DIR, SHARED_DIR);
const OUT_DIR    = join(PROJECT_DIR, '.test-guard');

// ── Helpers ───────────────────────────────────────────────────────────────────
function writeResult(name, data) {
  try {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, {recursive: true});
    writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isSourceFile(file) {
  const base = basename(file);
  const ext  = extname(file);
  if (ext !== '.ts' && ext !== '.tsx') return false;
  if (/\.(test|spec)\.tsx?$/.test(base)) return false;
  if (/\.web\.tsx?$/.test(base)) return false;
  if (base === 'index.ts' || base === 'index.tsx') return false;
  return true;
}

function hasColocatedTest(file) {
  const dir  = file.slice(0, file.length - basename(file).length);
  const stem = basename(file).replace(/\.tsx?$/, '');
  return (
    existsSync(join(dir, `${stem}.test.ts`))   ||
    existsSync(join(dir, `${stem}.test.tsx`))  ||
    existsSync(join(dir, `${stem}.spec.ts`))   ||
    existsSync(join(dir, `${stem}.spec.tsx`))
  );
}

function findUntested() {
  const untested = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(SHARED, dir))) {
      if (isSourceFile(file) && !hasColocatedTest(file)) {
        untested.push(relative(PROJECT_DIR, file));
      }
    }
  }
  return untested.sort();
}

function runWorkspace(extraArgs) {
  const args = WORKSPACE
    ? ['workspace', WORKSPACE, ...extraArgs]
    : ['run', ...extraArgs]; // fallback: yarn run (no workspace)
  return spawnSync('yarn', args, {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function configErrors() {
  const errs = [];
  if (!WORKSPACE)  errs.push('TG_WORKSPACE not set — configure workspace_name in plugin userConfig.');
  if (!SHARED_DIR) errs.push('TG_SHARED_DIR not set — configure shared_dir in plugin userConfig.');
  return errs;
}

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new McpServer({name: 'test-guard', version: '0.2.0'});

server.registerTool(
  'list_untested_files',
  {
    title: 'List untested files',
    description:
      `Scan ${SHARED_DIR}/{${SCAN_DIRS.join(',')}} for .ts/.tsx source files ` +
      'that have no colocated *.test.ts. Writes .test-guard/untested.json.',
    inputSchema: {},
  },
  async () => {
    const errs = configErrors();
    if (errs.length) {
      return {content: [{type: 'text', text: errs.join('\n')}], isError: true};
    }
    const untested = findUntested();
    const result = {
      generatedAt: new Date().toISOString(),
      config: {workspace: WORKSPACE, sharedDir: SHARED_DIR, scanDirs: SCAN_DIRS},
      count: untested.length,
      untested,
    };
    writeResult('untested.json', result);
    return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
  },
);

server.registerTool(
  'run_tests',
  {
    title: 'Run tests',
    description:
      `Run ${TEST_RUNNER.join(' ')} in the ${WORKSPACE || 'project'} workspace. ` +
      'Optional pattern filters test files. Writes .test-guard/results.json.',
    inputSchema: {
      pattern: z.string().optional().describe(
        'Optional Vitest filename filter, e.g. "authSlice" or "utils/".',
      ),
    },
  },
  async ({pattern}) => {
    const errs = configErrors();
    if (errs.length) {
      return {content: [{type: 'text', text: errs.join('\n')}], isError: true};
    }
    const args = [...TEST_RUNNER, '--reporter=json'];
    if (pattern) args.push(pattern);
    const res = runWorkspace(args);
    const stdout = res.stdout || '';

    let report = null;
    const start = stdout.indexOf('{');
    if (start >= 0) {
      try { report = JSON.parse(stdout.slice(start)); } catch { /* ignore */ }
    }

    const summary = report
      ? {
          numTotalTests:      report.numTotalTests,
          numPassedTests:     report.numPassedTests,
          numFailedTests:     report.numFailedTests,
          numTotalTestSuites: report.numTotalTestSuites,
          numFailedTestSuites:report.numFailedTestSuites,
          success:            report.success,
        }
      : {
          parsed: false,
          exitCode: res.status,
          note: 'Could not parse JSON output; see rawTail.',
          rawTail: stdout.slice(-2000) + (res.stderr ? '\nSTDERR:\n' + res.stderr.slice(-1000) : ''),
        };

    const result = {
      generatedAt: new Date().toISOString(),
      config: {workspace: WORKSPACE, runner: TEST_RUNNER},
      pattern: pattern || null,
      exitCode: res.status,
      summary,
    };
    writeResult('results.json', result);
    return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
  },
);

server.registerTool(
  'coverage_report',
  {
    title: 'Coverage report',
    description:
      `Run ${TEST_RUNNER.join(' ')} with v8 coverage and return per-file/total %. ` +
      'Writes .test-guard/coverage.json.',
    inputSchema: {},
  },
  async () => {
    const errs = configErrors();
    if (errs.length) {
      return {content: [{type: 'text', text: errs.join('\n')}], isError: true};
    }
    const res = runWorkspace([
      ...TEST_RUNNER,
      '--coverage',
      '--coverage.reporter=json-summary',
    ]);

    const summaryPath = join(SHARED, 'coverage', 'coverage-summary.json');
    let coverage = null;
    if (existsSync(summaryPath)) {
      try { coverage = JSON.parse(readFileSync(summaryPath, 'utf8')); } catch { /* ignore */ }
    }

    const result = coverage
      ? {
          generatedAt: new Date().toISOString(),
          config: {workspace: WORKSPACE, sharedDir: SHARED_DIR},
          total: coverage.total,
          files: Object.fromEntries(
            Object.entries(coverage)
              .filter(([k]) => k !== 'total')
              .map(([k, v]) => [
                relative(PROJECT_DIR, k),
                {
                  lines:      v.lines?.pct,
                  statements: v.statements?.pct,
                  functions:  v.functions?.pct,
                  branches:   v.branches?.pct,
                },
              ]),
          ),
        }
      : {
          generatedAt: new Date().toISOString(),
          parsed: false,
          exitCode: res.status,
          note: `coverage-summary.json not found at ${relative(PROJECT_DIR, summaryPath)}. Ensure @vitest/coverage-v8 is installed.`,
          rawTail: (res.stdout || '').slice(-1500),
        };

    writeResult('coverage.json', result);
    return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

#!/usr/bin/env node
/**
 * test-guard PostToolUse hook.
 *
 * Reads the PostToolUse event JSON from stdin. If the edited/written file is a
 * pure-logic source file under the configured shared package (not a test/web/index),
 * and has NO colocated *.test.ts(x), surfaces a reminder to Claude via
 * `additionalContext`. Never blocks. Silent when a test exists or path is N/A.
 *
 * Config (via env — injected from userConfig by the plugin runtime):
 *   TG_SHARED_DIR  relative path segment(s) to match in file path, e.g. "packages/shared"
 *                  Defaults to "shared" if not set.
 */
import {existsSync} from 'node:fs';
import {dirname, basename, join, extname} from 'node:path';

// Config — read from env, fall back to sensible defaults.
const SHARED_DIR = process.env.TG_SHARED_DIR || 'shared';

// Escape for use in a RegExp.
const sharedSegment = SHARED_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sharedRe = new RegExp(`(^|/)${sharedSegment}(/|$)`);

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => (data += c));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 50);
  });
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext,
      },
    }),
  );
}

const raw = await readStdin();
let filePath;
try {
  const evt = JSON.parse(raw || '{}');
  filePath = evt?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!filePath || typeof filePath !== 'string') process.exit(0);

const ext = extname(filePath);
if (ext !== '.ts' && ext !== '.tsx') process.exit(0);
if (!sharedRe.test(filePath)) process.exit(0);

const base = basename(filePath);
if (/\.(test|spec)\.tsx?$/.test(base)) process.exit(0);
if (/\.web\.tsx?$/.test(base)) process.exit(0);
if (base === 'index.ts' || base === 'index.tsx') process.exit(0);

const stem = base.replace(/\.tsx?$/, '');
const dir = dirname(filePath);
const hasTest =
  existsSync(join(dir, `${stem}.test.ts`)) ||
  existsSync(join(dir, `${stem}.test.tsx`)) ||
  existsSync(join(dir, `${stem}.spec.ts`)) ||
  existsSync(join(dir, `${stem}.spec.tsx`));

if (hasTest) process.exit(0);

emit(
  `⚠️ test-guard: \`${base}\` has no colocated test. ` +
    `Create \`${stem}.test.ts\` next to it (use the test-guard:write-tests skill).`,
);
process.exit(0);

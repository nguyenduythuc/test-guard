---
name: write-tests
description: >
  Author Vitest unit tests alongside source code (test-after) for JS/TS monorepos,
  especially pure logic in a shared package — utils, Redux Toolkit slices, validation,
  formatting, calculation. Encodes the project's exact conventions: colocated test files,
  RTK reducer testing, mocking native modules at the boundary, env/timer/global stubbing.
  Use whenever generating or modifying a util, redux slice, hook, or any pure-logic file,
  or when the user asks to write/add tests. Always pair new logic with a colocated test.
---

# write-tests — Vitest test authoring (test-after)

When you generate or change a source file with logic, **write its colocated test in the same change**. Code + test ship together; the user reviews both.

## Workflow

1. Read the source file fully. Identify every exported function/reducer/action and its branches.
2. Create the test file **colocated** next to source: `foo.ts` → `foo.test.ts` (NOT in `__tests__/`).
3. Cover: happy path, each branch, edge cases (null/undefined/empty/NaN), and guard clauses.
4. **Document actual behavior, even when it looks like a bug** — write the test to the real output and add a comment flagging it. Don't assume intended behavior.
5. Run the suite. Fix until green AND `tsc --noEmit` clean.

## Conventions (match the existing suite exactly)

### File + structure
- Colocated `*.test.ts` (or `.tsx`).
- Vitest with **globals on** — `describe`/`it`/`expect` need NO import. Import `vi` only when mocking: `import {vi} from 'vitest'` (or `{describe, it, expect, vi}` explicitly if preferred).
- Group with `describe` per function/action; one behavior per `it`.

### Redux Toolkit slices (pure reducers — highest ROI)
- Import the default reducer + named actions.
- `initialState`: `reducer(undefined, {type: '@@INIT'})`.
- Each action: `reducer(prevState, action(payload))` → assert next state.
- No store needed — reducers are pure functions.
- Test guards/optimizations explicitly (e.g. dedup-before-push, no-update-when-same-id, null-guard before mutating nested state).

```ts
import reducer, {setToken, clearToken} from './index';

describe('authSlice', () => {
  it('initialState', () => {
    expect(reducer(undefined, {type: '@@INIT'}).token).toBeNull();
  });
  it('setToken stores token', () => {
    expect(reducer(undefined, setToken('abc')).token).toBe('abc');
  });
});
```

### Mocking native modules — at the boundary
- `react-native` → `react-native-web` and native modules (e.g. `react-native-mmkv`) are stubbed via `resolve.alias` in `vitest.config.ts`. Reuse that; don't re-stub per test.
- For files reading env/Platform (e.g. `handleEnvByPlatform`), mock the module:
  ```ts
  vi.mock('./handleEnvByPlatform', () => ({
    handleEnvByPlatform: vi.fn(),
    isNonProductionEnvironment: () => false,
  }));
  ```
  Place `vi.mock(...)` **before** importing the unit under test (hoisted, but keep it top-of-file for clarity).

### Mock data — favor behavior over type-perfection
- Use `as any` for partial mock objects when full type construction adds no test value. Focus the assertion on behavior.

### Env / timers / globals / console
- **Env**: `vi.stubEnv('NODE_ENV', 'production')` + `vi.unstubAllEnvs()`. NEVER `Object.defineProperty(process.env, ...)` — throws `'process.env' only accepts a configurable, writable, and enumerable data descriptor`.
- **Timers**: `vi.useFakeTimers()`; advance with `await vi.runAllTimersAsync()` / `await vi.advanceTimersByTimeAsync(ms)` for code that `await`s a `setTimeout`. Plain `vi.runAllTimers()` fires before an async-scheduled timer exists → test times out.
- **Globals**: `vi.stubGlobal('window', {sessionStorage: mock})`.
- **Console noise**: when code intentionally `console.error`s in a catch, suppress + assert: `const spy = vi.spyOn(console,'error').mockImplementation(()=>{}); ...; expect(spy).toHaveBeenCalled(); spy.mockRestore();`.

## Verify (mandatory before done)
```
yarn workspace <workspace_name> test   # or: yarn test / npm test inside shared package
```
And type-check the test files:
```
cd <shared_dir> && npx tsc --noEmit
```
All green + 0 TS errors. A failing-then-fixed test that catches a real bug is a success, not a problem.

## Reference files (real examples in this repo)
- RTK + module mock + fake timers env: `packages/shared/redux/slices/debugSlice/debugSlice.test.ts`
- env stubbing + Platform mock: `packages/shared/utils/handleEnvByPlatform.test.ts`
- async fake timers + console spy: `packages/shared/utils/modalManager.test.ts`
- Vitest config / aliases: `packages/shared/vitest.config.ts`

## Out of scope (this skill)
React/RN component render tests and hooks needing a DOM/renderer — those use a different setup (jsdom + Testing Library, or Jest for RN). This skill is pure logic.

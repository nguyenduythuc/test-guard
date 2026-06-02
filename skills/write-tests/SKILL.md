---
name: write-tests
description: >
  Author Vitest unit tests alongside source code (test-after) for JS/TS monorepos,
  especially a shared package — utils, Redux Toolkit slices, validation, formatting,
  calculation, AND custom React hooks. Encodes exact conventions: colocated test files,
  RTK reducer testing, hook testing with renderHook+jsdom, mocking native modules at
  the boundary, env/timer/global stubbing. Use whenever generating or modifying a util,
  redux slice, hook, or any pure-logic file, or when the user asks to write/add tests.
  Always pair new logic with a colocated test.
---

# write-tests — Vitest test authoring (test-after)

When you generate or change a source file with logic, **write its colocated test in the same change**. Code + test ship together; the user reviews both.

## Workflow

1. Read the source file fully. Identify every exported function/reducer/hook and its branches.
2. Create the test file **colocated** next to source: `foo.ts` → `foo.test.ts` (NOT in `__tests__/`).
3. Cover: happy path, each branch, edge cases (null/undefined/empty/NaN), and guard clauses.
4. **Document actual behavior, even when it looks like a bug** — write the test to the real output and add a comment flagging it. Don't assume intended behavior.
5. Run the suite. Fix until green AND `tsc --noEmit` clean.

---

## Conventions (match the existing suite exactly)

### File + structure
- Colocated `*.test.ts` (or `.tsx`).
- Vitest with **globals on** — `describe`/`it`/`expect` need NO import. **Always explicitly import `vi`**: `import {vi} from 'vitest'` (or `{describe, it, expect, vi}`).
- Group with `describe` per function/action; one behavior per `it`.

---

## A — Pure logic (utils, redux slices)

### Redux Toolkit slices (pure reducers — highest ROI)
- Import the default reducer + named actions.
- `initialState`: `reducer(undefined, {type: '@@INIT'})`.
- Each action: `reducer(prevState, action(payload))` → assert next state.
- No store needed — reducers are pure functions.
- Test guards/optimizations explicitly (dedup-before-push, no-update-when-same-id, null-guard before mutating nested state).

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

---

## B — React hook tests

### Required deps (install once per package)
```bash
yarn workspace <workspace_name> add -D @testing-library/react @testing-library/dom react-dom jsdom
```
All four are required — `@testing-library/react` won't pull them transitively in Yarn workspaces.

### jsdom environment — per-file, NOT global
Keep `environment: 'node'` in `vitest.config.ts` (faster for pure-logic tests).
Hook tests opt-in via **docblock at top of file**:
```ts
// @vitest-environment jsdom
import {renderHook, act} from '@testing-library/react';
```

### Basic renderHook pattern
```ts
// @vitest-environment jsdom
import {describe, it, expect, vi} from 'vitest';
import {renderHook, act} from '@testing-library/react';
import useMyHook from './useMyHook';

it('returns initial value', () => {
  const {result} = renderHook(() => useMyHook());
  expect(result.current.value).toBe(false);
});
```

### Async hooks + fake timers
`vi.runAllTimers()` fires BEFORE an async-scheduled setTimeout exists (async gap = test timeout).
Always use the async variant inside `act`:
```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('fires callback after delay', async () => {
  const cb = vi.fn();
  renderHook(() => useAutoTimeout(cb, 1, true));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000); // ✅ handles async gaps
  });
  expect(cb).toHaveBeenCalledOnce();
});
```

### ❌ ANTI-PATTERN: require() inside test body
**Never** use `require()` inside `it()` or `describe()` to get mocked module references.
Node can't `require()` a Vitest-intercepted module → `Cannot find module` error.

```ts
// ❌ WRONG — fails at runtime
it('test', () => {
  const {useSomeMutation} = require('../redux/slices/apiSlices');
  useSomeMutation.mockReturnValue(...);
});

// ✅ CORRECT — top-level import after vi.mock (vi.mock is hoisted, so import gets mocked version)
vi.mock('../redux/slices/apiSlices', () => ({
  useSomeMutation: vi.fn(() => [vi.fn(), {isLoading: false}]),
}));
import {useSomeMutation} from '../redux/slices/apiSlices';
const mockMutation = useSomeMutation as ReturnType<typeof vi.fn>;

it('test', () => {
  mockMutation.mockReturnValue([vi.fn(), {isLoading: true}]);
  // ...
});
```

### Mocking hooks that import from index (`'.'`)
When a hook imports `useConfigRouting` from `'.'` (the hooks index), mock `'.'`:
```ts
vi.mock('.', () => ({
  useConfigRouting: vi.fn(() => ({ appNavigate: vi.fn(), appGoBack: vi.fn() })),
  // add other index exports the hook uses
}));

// Import from '.' to get the mock reference (same path as the hook uses)
import {useConfigRouting} from '.';
const mockUseConfigRouting = useConfigRouting as ReturnType<typeof vi.fn>;
```
**Never** mock `'./routing'` when the hook imports from `'.'` — different modules.

### Screen names — always check actual enum values
`ScreenParamEnum` uses **kebab-case**, not PascalCase:
```ts
// ❌ 'Home', 'UpdateAccount', 'VerifyCustomerInfo'
// ✅ 'home', 'update-account', 'verify-customer-info'
```
Check `types/paramtypes.ts` for actual values before writing assertions.

### Common mock patterns for hooks
```ts
// Redux
vi.mock('../redux/store', () => ({
  useAppSelector: vi.fn(),
  useAppDispatch: vi.fn(() => vi.fn()),
}));
vi.mock('react-redux', () => ({
  useDispatch: vi.fn(() => vi.fn()),
  useSelector: vi.fn(),
}));

// RTK Query — mock ONLY the hooks the file under test uses
vi.mock('../redux/slices/apiSlices', () => ({
  useLoginMutation: vi.fn(() => [vi.fn(), {isLoading: false, error: undefined}]),
  useGetSomethingQuery: vi.fn(() => ({data: undefined, isLoading: false, refetch: vi.fn()})),
}));

// Navigation
vi.mock('@react-navigation/native', () => ({
  useNavigation: vi.fn(() => ({navigate: vi.fn(), goBack: vi.fn(), reset: vi.fn(), dispatch: vi.fn()})),
  useRoute: vi.fn(() => ({params: {}, name: 'Screen'})),
}));

// react-native (already aliased to react-native-web, but override Platform/Linking)
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {...actual, Platform: {OS: 'web'}, Linking: {openURL: vi.fn()}, Alert: {alert: vi.fn()}};
});

// i18n
vi.mock('use-intl', () => ({useTranslations: vi.fn(() => (key: string) => key)}));
vi.mock('next-intl', () => ({useTranslations: vi.fn(() => (key: string) => key)}));

// handleEnvByPlatform (required when mocking debugSlice or any env-reading module)
vi.mock('../utils/handleEnvByPlatform', () => ({
  handleEnvByPlatform: vi.fn(() => 'http://api.test.com'),
  isNonProductionEnvironment: () => false,
  getAuthorizationHeadersByPlatform: vi.fn(() => ({})),
  getCurrentEnvironment: () => 'production',
}));

// Safe area
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: vi.fn(() => ({top: 0, bottom: 0, left: 0, right: 0})),
}));
```

### Singleton cleanup between tests
`vi.clearAllMocks()` resets call counts but NOT mock implementations.
For singletons (modalManager, eventEmitter), reset in `beforeEach`:
```ts
mockRegisterModal.mockReturnValue(vi.fn()); // reset implementation each test
```

---

## C — Mocking native modules at the boundary

- `react-native` → `react-native-web`: aliased in `vitest.config.ts`. Don't re-stub per file unless overriding `Platform.OS` or `Linking`.
- `react-native-mmkv`: aliased to `test/mocks/react-native-mmkv.ts`.
- `react-native-config`: `vi.mock('react-native-config', () => ({default: {BASE_API_URL: 'http://api.test.com'}}))`
- `react-native-fs`: `vi.mock('react-native-fs', () => ({default: {DocumentDirectoryPath: '/tmp', writeFile: vi.fn(), readFile: vi.fn()}}))`
- For `debugSlice` (calls `isNonProductionEnvironment()` at module load): always include it in `handleEnvByPlatform` mock.

---

## D — Package self-reference alias (monorepo)

If the package mocks itself via absolute imports like `@myorg/shared/redux/...`, add to `vitest.config.ts`:
```ts
resolve: {
  alias: [
    {
      find: /^@myorg\/shared(\/.*)?$/,
      replacement: `${path.resolve(__dirname)}$1`,
    },
    // ... other aliases
  ],
},
```
**Note**: Array form required (not object form) for regex aliases.

---

## E — Env / timers / globals / console

- **Env**: `vi.stubEnv('KEY', 'val')` + `vi.unstubAllEnvs()`.
  NEVER `Object.defineProperty(process.env, 'NODE_ENV', ...)` → throws `'process.env' only accepts a configurable, writable, and enumerable data descriptor`.
- **Timers**: `vi.useFakeTimers()` in `beforeEach`. Use `await vi.runAllTimersAsync()` or `await vi.advanceTimersByTimeAsync(ms)` inside `act()`. Plain `vi.runAllTimers()` → test timeout on async hooks.
- **Globals**: `vi.stubGlobal('window', {sessionStorage: mock})` + `vi.unstubAllGlobals()` in `afterEach`.
- **Console noise**: `const spy = vi.spyOn(console, 'error').mockImplementation(() => {}); ...; expect(spy).toHaveBeenCalled(); spy.mockRestore();`
- **Mock data**: `as any` for partial mock objects — focus on behavior, not type construction.

---

## F — Verify (mandatory before done)
```bash
yarn workspace <workspace_name> test
cd <shared_dir> && npx tsc --noEmit
```
All green + 0 TS errors. Fix both before moving on.

---

## Reference files (real examples)
- RTK slice + module mock: `packages/shared/redux/slices/debugSlice/debugSlice.test.ts`
- Env stubbing + Platform mock: `packages/shared/utils/handleEnvByPlatform.test.ts`
- Async fake timers + console spy: `packages/shared/utils/modalManager.test.ts`
- Hook + fake timers: `packages/shared/hooks/useAutoTimeout.test.ts`
- Hook + singleton mock: `packages/shared/hooks/useModalManager.test.ts`
- Hook + Platform + Linking: `packages/shared/hooks/useHandleLinkStoreApp.test.ts`
- Hook + useConfigRouting from index: `packages/shared/hooks/useAPLManagement.test.ts`
- Vitest config with regex alias: `packages/shared/vitest.config.ts`

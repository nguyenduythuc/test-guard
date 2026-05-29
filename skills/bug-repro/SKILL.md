---
name: bug-repro
description: >
  Fix bugs test-first (local TDD): write a failing test that reproduces the bug BEFORE
  changing any code, confirm it fails for the right reason, then fix, then confirm green.
  The test stays as a regression guard. Use whenever fixing a bug, correcting wrong
  behavior, or when the user reports something broken / "sửa lỗi" / "fix bug".
---

# bug-repro — reproduce-then-fix (test-first bugfix)

A bug means existing tests didn't catch a case. Close that gap permanently: the fix is only "done" when a test proves the bug is gone and would catch its return.

## Workflow (do NOT skip the red step)

1. **Reproduce in a test FIRST.** Before touching source, write a colocated test asserting the *correct* behavior for the buggy input. Follow `test-guard:write-tests` conventions.
2. **Run it → confirm RED.** It must fail, and fail for the *right reason* (the actual bug, not a typo in the test). Read the failure message to verify.
3. **Fix the source.** Minimal change to make the behavior correct.
4. **Run again → confirm GREEN.** The new test passes; the full suite still passes.
5. **Leave the test in.** It's now a regression guard.

## Why red-first matters
- Proves the test actually exercises the bug. A test written after the fix can pass trivially and guard nothing.
- Pins the exact failure mode in the test name/comment for future readers.

## Verify
```
yarn workspace <workspace_name> test
```
Confirm: the new test was red before the fix, green after; no other test regressed.

## Example shape
```ts
// Bug: maskPhone('') threw instead of returning ''
it('maskPhone returns empty string for empty input (was: threw)', () => {
  expect(maskPhone('')).toBe(''); // RED before fix → GREEN after
});
```

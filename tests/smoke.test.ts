import { test } from 'node:test';
import assert from 'node:assert/strict';

// Part 0.0 "done when": an empty test passes locally and in CI.
test('smoke: the test runner runs', () => {
  assert.ok(true);
});

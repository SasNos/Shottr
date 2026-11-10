// The few Vitest-style matchers the shared test of tools/tokens.mjs uses, on top of node:assert, so that test file
// stays the same as in the tools that run Vitest (only its import lines differ).
import assert from 'node:assert/strict';

export function expect(actual) {
  return {
    toBe: (expected) => assert.equal(actual, expected),
    toEqual: (expected) => assert.deepEqual(actual, expected),
    toBeNull: () => assert.equal(actual, null),
    toBeUndefined: () => assert.equal(actual, undefined),
    toHaveLength: (length) => assert.equal(actual.length, length),
    toMatch: (pattern) => assert.match(actual, pattern),
    toContain: (part) =>
      assert.ok(actual.includes(part), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(part)}`),
    toThrow: (message) => assert.throws(actual, (error) => error.message.includes(message)),
  };
}

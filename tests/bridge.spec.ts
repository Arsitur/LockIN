import { test, expect } from '@playwright/test';
import {
  bridgeCompatibilityError,
  compareVersions,
  updateCompatibilityError,
} from '../extension/bridge-health.js';

test('an old bridge cannot report a category-timer connection as healthy', () => {
  expect(
    bridgeCompatibilityError({
      protocolVersion: 2,
      extensionVersion: '1.2.0',
      state: { session: null },
    }),
  ).toContain('old desktop bridge');
  expect(
    bridgeCompatibilityError({
      protocolVersion: 2,
      extensionVersion: '1.3.0',
      state: { sessions: [] },
    }),
  ).toBe('');
  expect(
    bridgeCompatibilityError({
      protocolVersion: 2,
      extensionVersion: '1.3.1',
      state: { session: null },
    }),
  ).not.toBe('');
});
test('companion update guards compare versions numerically and reject downgrades', () => {
  expect(updateCompatibilityError('1.2.0', '1.3.1')).toContain(
    'will not be downgraded',
  );
  expect(updateCompatibilityError('1.3.0', '1.3.1')).not.toBe('');
  expect(updateCompatibilityError('1.3.1', '1.3.1')).toBe('');
  expect(updateCompatibilityError('1.10.0', '1.3.1')).toBe('');
  expect(compareVersions('1.10.0', '1.3.1')).toBe(1);
  expect(compareVersions('', '1.3.1')).toBeNull();
});

import { test, expect } from '@playwright/test';
import {
  getBlockedDomains,
  makeRules,
  nextBoundary,
  scheduleActive,
} from '../extension/rules.js';
import { defaultState } from '../src/lib/model';
import { appearance } from '../extension/appearance.js';

test('overnight schedule uses the starting weekday, includes subdomain rules and expires at end', () => {
  const schedule = {
    id: 'night',
    name: 'Night',
    categoryIds: ['social'],
    days: [1],
    start: '22:00',
    end: '06:00',
    enabled: true,
  };
  const mondayNight = new Date(2026, 10, 9, 23, 0),
    tuesdayMorning = new Date(2026, 10, 10, 5, 59),
    tuesdayEnd = new Date(2026, 10, 10, 6, 0);
  expect(scheduleActive(schedule, mondayNight)).toBeTruthy();
  expect(scheduleActive(schedule, tuesdayMorning)).toBeTruthy();
  expect(scheduleActive(schedule, tuesdayEnd)).toBeFalsy();
  expect(scheduleActive(schedule, new Date(2026, 10, 9, 5, 0))).toBeFalsy();
  const state = { ...structuredClone(defaultState), schedules: [schedule] };
  expect(getBlockedDomains(state, tuesdayMorning)).toHaveLength(4);
  expect(getBlockedDomains(state, tuesdayEnd)).toEqual([]);
  expect(nextBoundary(state, tuesdayMorning)).toBe(tuesdayEnd.getTime());
  const rules = makeRules(['youtube.com']);
  expect(rules).toHaveLength(2);
  expect(rules[0].condition.requestDomains).toEqual(['youtube.com']);
  expect(rules[1].condition.initiatorDomains).toEqual(['youtube.com']);
  expect(rules[0].condition.resourceTypes).toContain('websocket');
});
test('schedules ignore selection switches and skip only the current occurrence', () => {
  const state = structuredClone(defaultState);
  state.sites.forEach((s) => (s.enabled = false));
  const now = new Date(2026, 10, 9, 10, 0);
  state.schedules = [
    {
      id: 's',
      name: 'Social',
      categoryIds: ['social'],
      days: [1],
      start: '09:00',
      end: '12:00',
      enabled: true,
    },
  ];
  expect(getBlockedDomains(state, now)).toHaveLength(4);
  state.schedules[0].skipUntil = new Date(2026, 10, 9, 12, 0).getTime();
  expect(getBlockedDomains(state, now)).toHaveLength(0);
  expect(getBlockedDomains(state, new Date(2026, 10, 16, 10, 0))).toHaveLength(
    4,
  );
});
test('extension appearance follows the app and selects readable foreground colors', () => {
  expect(appearance({ theme: 'light', accent: '#7845ef' }).light).toBe(true);
  expect(appearance({ theme: 'system', accent: '#7845ef' }, false).light).toBe(
    true,
  );
  expect(appearance({ theme: 'dark', accent: '#000000' }).contrast).toBe(
    '#ffffff',
  );
  expect(appearance({ theme: 'dark', accent: '#ffffff' }).contrast).toBe(
    '#162012',
  );
});

test('overlapping session and schedule keep a domain blocked until both finish', () => {
  const state = structuredClone(defaultState),
    now = new Date(2026, 10, 9, 10, 0);
  state.session = {
    id: 's',
    siteIds: ['instagram'],
    domains: ['instagram.com'],
    startedAt: now.getTime() - 60000,
    endsAt: now.getTime() + 60000,
    testMode: false,
    protection: state.settings.protection,
  };
  state.schedules = [
    {
      id: 'a',
      name: 'Morning',
      categoryIds: ['social'],
      days: [1],
      start: '09:00',
      end: '12:00',
      enabled: true,
    },
  ];
  expect(getBlockedDomains(state, now)).toHaveLength(4);
  expect(getBlockedDomains(state, new Date(now.getTime() + 61000))).toContain(
    'instagram.com',
  );
  expect(getBlockedDomains(state, new Date(2026, 10, 9, 12, 0))).toEqual([]);
});

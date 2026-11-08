export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
  policy?: CategoryPolicy;
  durationMinutes?: number;
};
export type Site = {
  id: string;
  name: string;
  domain: string;
  categoryId: string;
  enabled: boolean;
  customIcon?: string;
  durationMinutes?: number;
  paths?: string[];
  exceptions?: string[];
};
export type RuleOptions = { keywordMatch: 'substring' | 'word'; keywordScope: 'url' | 'search' };
export type SiteRule = { domain: string; paths: string[]; exceptions: string[] };
export type KeywordPolicy = RuleOptions & { words: string[] };
export type FocusProfile = { id: string; name: string; icon: string; color: string; entries: { categoryId: string; durationMinutes: number }[] };
export type Application = {
  id: string;
  name: string;
  path: string;
  categoryId: string;
  enabled: boolean;
};
export type Protection = {
  phraseEnabled: boolean;
  phrase: string;
  steps: number;
  waitMinutes: number;
};
export type CategoryPolicy = {
  protection: Protection;
  keywordFilterEnabled: boolean;
  blockedKeywords: string[];
  strictNetworkGuard: boolean;
  ruleOptions?: RuleOptions | null;
};
export type Session = {
  id: string;
  siteIds: string[];
  domains: string[];
  startedAt: number;
  endsAt: number;
  testMode: boolean;
  protection: Protection;
  appIds?: string[];
  appPaths?: string[];
  categoryIds?: string[];
  policyCategoryId?: string;
  label?: string;
  blockedKeywords?: string[];
  strictNetworkGuard?: boolean;
  unlock?: UnlockProgress | null;
  siteRules?: SiteRule[];
  keywordPolicies?: KeywordPolicy[];
};
export type Schedule = {
  id: string;
  name: string;
  categoryIds: string[];
  days: number[];
  start: string;
  end: string;
  enabled: boolean;
  skipUntil?: number;
};
export type SessionLog = {
  id: string;
  startedAt: number;
  endedAt: number;
  plannedEnd: number;
  siteCount: number;
  completed: boolean;
  testMode: boolean;
  categoryIds?: string[];
  label?: string;
};
export type Settings = {
  theme: 'dark' | 'light' | 'system';
  accent: string;
  protection: Protection;
  testMode: boolean;
  savedAccents: string[];
  durationPresets: number[];
  durationUsage: Record<string, number>;
  websiteIcons: 'svg' | 'custom';
  keywordFilterEnabled: boolean;
  blockedKeywords: string[];
  strictNetworkGuard: boolean;
  ruleDefaults: RuleOptions;
};
export type AppState = {
  version: number;
  revision?: number;
  categories: Category[];
  sites: Site[];
  apps: Application[];
  schedules: Schedule[];
  session: Session | null; // Legacy migration only.
  sessions: Session[];
  history: SessionLog[];
  settings: Settings;
  profiles: FocusProfile[];
};
export type UnlockProgress = { step: number; readyAt: number; total: number };
export const uid = () => crypto.randomUUID();
export const accents = ['#d8edab', '#c6b7f5', '#a6d9ed', '#f0b5a1', '#f2d58c'];
export const categoryColors = [
  ...accents,
  '#f472b6',
  '#fb7185',
  '#ef4444',
  '#f97316',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#14b8a6',
  '#22d3ee',
  '#38bdf8',
  '#60a5fa',
  '#818cf8',
  '#a78bfa',
  '#c084fc',
  '#e879f9',
  '#e2e8f0',
  '#94a3b8',
  '#a8a29e',
];
export const categoryIcons = [
  'social',
  'play',
  'bag',
  'layers',
  'coffee',
  'sparkles',
  'grid',
  'clock',
  'globe',
  'game',
  'book',
  'news',
  'work',
  'heart',
  'music',
  'code',
  'learn',
  'fitness',
  'camera',
  'palette',
  'flame',
  'leaf',
  'message',
  'film',
  'trophy',
  'cloud',
  'bot',
  'compass',
  'shield',
  'moon',
  'zap',
  'monitor',
];
export const defaultState: AppState = {
  version: 1,
  revision: 0,
  categories: [
    { id: 'social', name: 'Social media', color: '#c6b7f5', icon: 'social' },
    {
      id: 'entertainment',
      name: 'Entertainment',
      color: '#e7b896',
      icon: 'play',
    },
    { id: 'shopping', name: 'Shopping', color: '#a7cfbf', icon: 'bag' },
  ],
  sites: [
    {
      id: 'instagram',
      name: 'Instagram',
      domain: 'instagram.com',
      categoryId: 'social',
      enabled: true,
    },
    {
      id: 'x',
      name: 'X / Twitter',
      domain: 'x.com',
      categoryId: 'social',
      enabled: true,
    },
    {
      id: 'reddit',
      name: 'Reddit',
      domain: 'reddit.com',
      categoryId: 'social',
      enabled: true,
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      domain: 'tiktok.com',
      categoryId: 'social',
      enabled: true,
    },
    {
      id: 'youtube',
      name: 'YouTube',
      domain: 'youtube.com',
      categoryId: 'entertainment',
      enabled: true,
    },
    {
      id: 'netflix',
      name: 'Netflix',
      domain: 'netflix.com',
      categoryId: 'entertainment',
      enabled: false,
    },
    {
      id: 'twitch',
      name: 'Twitch',
      domain: 'twitch.tv',
      categoryId: 'entertainment',
      enabled: true,
    },
    {
      id: 'amazon',
      name: 'Amazon',
      domain: 'amazon.com',
      categoryId: 'shopping',
      enabled: false,
    },
  ],
  schedules: [],
  apps: [],
  session: null,
  sessions: [],
  history: [],
  profiles: [],
  settings: {
    theme: 'dark',
    accent: accents[0],
    testMode: false,
    savedAccents: [],
    durationPresets: [25, 45, 60],
    durationUsage: {},
    websiteIcons: 'svg',
    keywordFilterEnabled: false,
    blockedKeywords: ['porn', 'sex', 'hentai', 'fuck'],
    strictNetworkGuard: false,
    ruleDefaults: {keywordMatch: 'substring', keywordScope: 'url'},
    protection: {
      phraseEnabled: true,
      phrase: 'I am choosing distraction over my goals.',
      steps: 2,
      waitMinutes: 1,
    },
  },
};

export function normalizeDomain(value: string): string {
  const input = value.trim();
  if (!input || input.length > 2048)
    throw new Error('Enter a website, like youtube.com.');
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
  } catch {
    throw new Error('That website does not look right. Try example.com.');
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(
      host,
    )
  )
    throw new Error('Enter a valid public domain, like example.com.');
  return host;
}
export function scheduleActive(schedule: Schedule, now = new Date()): boolean {
  if (
    !schedule.enabled ||
    schedule.start === schedule.end ||
    (schedule.skipUntil || 0) > now.getTime()
  )
    return false;
  const time = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = schedule.start.split(':').map(Number);
  const [eh, em] = schedule.end.split(':').map(Number);
  const start = sh * 60 + sm,
    end = eh * 60 + em;
  if (start < end)
    return schedule.days.includes(now.getDay()) && time >= start && time < end;
  return (
    (schedule.days.includes(now.getDay()) && time >= start) ||
    (schedule.days.includes((now.getDay() + 6) % 7) && time < end)
  );
}
export function blockedDomains(state: AppState, now = Date.now()): Set<string> {
  const result = new Set(activeSessions(state, now).flatMap((s) => s.domains));
  for (const schedule of state.schedules)
    if (scheduleActive(schedule, new Date(now))) {
      state.sites
        .filter((s) => schedule.categoryIds.includes(s.categoryId))
        .forEach((s) => result.add(s.domain));
    }
  return result;
}
export function scheduleOccurrenceEnd(
  schedule: Schedule,
  now = new Date(),
): number {
  const end = new Date(now);
  const [h, m] = schedule.end.split(':').map(Number);
  const minute = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = schedule.start.split(':').map(Number);
  if (schedule.start > schedule.end && minute >= sh * 60 + sm)
    end.setDate(end.getDate() + 1);
  end.setHours(h, m, 0, 0);
  return end.getTime();
}
export function blockedAppPaths(
  state: AppState,
  now = Date.now(),
): Set<string> {
  const paths = new Set(
    activeSessions(state, now).flatMap((s) => s.appPaths || []),
  );
  for (const schedule of state.schedules)
    if (scheduleActive(schedule, new Date(now))) {
      state.apps
        .filter((a) => schedule.categoryIds.includes(a.categoryId))
        .forEach((a) => paths.add(a.path));
    }
  return paths;
}
export function frequentDurations(state: AppState): number[] {
  return [...state.settings.durationPresets].sort(
    (a, b) =>
      (state.settings.durationUsage[String(b)] || 0) -
      (state.settings.durationUsage[String(a)] || 0),
  );
}
export function hydrateState(raw: AppState): AppState {
  const settings = { ...defaultState.settings, ...raw.settings };
  const legacy = raw.session
    ? {
        ...raw.session,
        label: raw.session.label || 'Existing focus session',
        strictNetworkGuard:
          raw.session.strictNetworkGuard ?? settings.strictNetworkGuard,
        blockedKeywords:
          raw.session.blockedKeywords ||
          (settings.keywordFilterEnabled ? settings.blockedKeywords : []),
      }
    : null;
  return {
    ...raw,
    revision: raw.revision || 0,
    apps: raw.apps || [],
    profiles: raw.profiles || [],
    sessions: [
      ...(raw.sessions || []),
      ...(raw.session &&
      !(raw.sessions || []).some((s) => s.id === raw.session!.id)
        ? [legacy!]
        : []),
    ],
    session: null,
    categories: raw.categories.map((c) => ({
      ...c,
      policy: c.policy || categoryPolicy({ ...raw, settings }, c.id),
    })),
    settings: {
      ...defaultState.settings,
      ...raw.settings,
      savedAccents: raw.settings.savedAccents || [],
      durationPresets: raw.settings.durationPresets || [25, 45, 60],
      durationUsage: raw.settings.durationUsage || {},
    },
  };
}
export function activeSessions(state: AppState, now = Date.now()): Session[] {
  return [
    ...(state.sessions || []),
    ...(state.session &&
    !(state.sessions || []).some((s) => s.id === state.session!.id)
      ? [state.session]
      : []),
  ].filter((s) => s.endsAt > now);
}
export function categoryPolicy(state: AppState, id: string): CategoryPolicy {
  return (
    state.categories.find((c) => c.id === id)?.policy || {
      protection: structuredClone(state.settings.protection),
      keywordFilterEnabled: state.settings.keywordFilterEnabled,
      blockedKeywords: [...state.settings.blockedKeywords],
      strictNetworkGuard: state.settings.strictNetworkGuard,
    }
  );
}
export function sessionCategoryIds(
  state: AppState,
  session?: Session,
): string[] {
  const s = session || state.session;
  return s
    ? s.categoryIds || [
        ...new Set([
          ...state.sites
            .filter((x) => s.siteIds.includes(x.id))
            .map((x) => x.categoryId),
          ...state.apps
            .filter((x) => s.appIds?.includes(x.id))
            .map((x) => x.categoryId),
        ]),
      ]
    : [];
}
export function inheritActiveCategories(
  before: AppState,
  next: AppState,
  now = Date.now(),
) {
  for (const prior of activeSessions(before, now)) {
    const s =
      next.sessions?.find((s) => s.id === prior.id) ||
      (next.session?.id === prior.id ? next.session : null);
    if (!s) continue;
    const ids = sessionCategoryIds(before, prior);
    s.categoryIds = ids;
    for (const site of next.sites)
      if (
        ids.includes(site.categoryId) &&
        !before.sites.some(
          (old) =>
            old.id === site.id &&
            old.domain === site.domain &&
            old.categoryId === site.categoryId,
        )
      ) {
        s.domains = [...new Set([...s.domains, site.domain])];
        s.siteIds = [...new Set([...s.siteIds, site.id])];
      }
    for (const app of next.apps)
      if (
        ids.includes(app.categoryId) &&
        !before.apps.some(
          (old) =>
            old.id === app.id &&
            old.path === app.path &&
            old.categoryId === app.categoryId,
        )
      ) {
        s.appPaths = [...new Set([...(s.appPaths || []), app.path])];
        s.appIds = [...new Set([...(s.appIds || []), app.id])];
      }
  }
}
export function categoryLockedUntil(
  state: AppState,
  id: string,
  now = Date.now(),
): number | null {
  const ends = activeSessions(state, now)
    .filter((s) => sessionCategoryIds(state, s).includes(id))
    .map((s) => s.endsAt);
  for (const schedule of state.schedules)
    if (
      schedule.categoryIds.includes(id) &&
      scheduleActive(schedule, new Date(now))
    )
      ends.push(scheduleOccurrenceEnd(schedule, new Date(now)));
  return ends.length ? Math.max(...ends) : null;
}
export function categoryPolicyLocked(
  state: AppState,
  id: string,
  now = Date.now(),
): boolean {
  return (
    activeSessions(state, now).some(
      (s) =>
        !s.testMode &&
        (s.policyCategoryId === id ||
          sessionCategoryIds(state, s).includes(id)),
    ) ||
    (!state.settings.testMode &&
      state.schedules.some(
        (s) => s.categoryIds.includes(id) && scheduleActive(s, new Date(now)),
      ))
  );
}
export function accentContrast(hex: string): string {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.32
    ? '#162012'
    : '#ffffff';
}
export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function nextScheduleLabel(schedules: Schedule[], now = new Date()) {
  const active = schedules.find((s) => scheduleActive(s, now));
  if (active) return `${active.name} is active until ${active.end}`;
  let closest: { schedule: Schedule; date: Date } | null = null;
  for (const schedule of schedules.filter((s) => s.enabled))
    for (let offset = 0; offset < 8; offset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      const [h, m] = schedule.start.split(':').map(Number);
      date.setHours(h, m, 0, 0);
      if (
        date > now &&
        schedule.days.includes(date.getDay()) &&
        (!closest || date < closest.date)
      )
        closest = { schedule, date };
    }
  if (!closest) return 'Give your best hours a little protection.';
  return `${closest.schedule.name} · ${closest.date.toLocaleDateString('en', { weekday: 'short' })}, ${closest.schedule.start}`;
}

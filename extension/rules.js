export function scheduleActive(schedule, now = new Date()) {
  if (
    !schedule.enabled ||
    schedule.start === schedule.end ||
    (schedule.skipUntil || 0) > now.getTime()
  )
    return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = schedule.start.split(':').map(Number),
    [eh, em] = schedule.end.split(':').map(Number);
  const start = sh * 60 + sm,
    end = eh * 60 + em;
  return start < end
    ? schedule.days.includes(now.getDay()) && minute >= start && minute < end
    : (schedule.days.includes(now.getDay()) && minute >= start) ||
        (schedule.days.includes((now.getDay() + 6) % 7) && minute < end);
}
export function getBlockedDomains(state, now = new Date()) {
  if (!state) return [];
  const domains = new Set(
    activeSessions(state, now.getTime()).flatMap((s) => s.domains),
  );
  for (const schedule of state.schedules || [])
    if (scheduleActive(schedule, now)) {
      for (const site of state.sites)
        if (schedule.categoryIds.includes(site.categoryId))
          domains.add(site.domain);
    }
  return [...domains].filter((d) => /^[a-z0-9.-]+$/.test(d)).sort();
}
export function makeRules(domains) {
  const types = [
    'main_frame',
    'sub_frame',
    'stylesheet',
    'script',
    'image',
    'font',
    'object',
    'xmlhttprequest',
    'ping',
    'csp_report',
    'media',
    'websocket',
    'other',
  ];
  return domains.flatMap((domain, i) => [
    {
      id: i * 2 + 1,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: [domain], resourceTypes: types },
    },
    {
      id: i * 2 + 2,
      priority: 1,
      action: { type: 'block' },
      condition: { initiatorDomains: [domain], resourceTypes: types },
    },
  ]);
}
export function keywordPattern(word) {
  const escape = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...word.toLowerCase()]
    .map((char) => {
      const bytes = [...new TextEncoder().encode(char)];
      if (bytes.length > 1)
        return bytes
          .map((b) => `%(?:25)*${b.toString(16).padStart(2, '0')}`)
          .join('');
      if (char === ' ') return '(?:%20|\\+| )';
      const code = bytes[0].toString(16).padStart(2, '0'),
        upper = char.toUpperCase().charCodeAt(0).toString(16).padStart(2, '0');
      return `(?:${escape(char)}|%(?:25)*${code === upper ? code : `(?:${code}|${upper})`})`;
    })
    .join('');
}
export function activeSessions(state, now = Date.now()) {
  return [
    ...(state?.sessions || []),
    ...(state?.session &&
    !(state.sessions || []).some((s) => s.id === state.session.id)
      ? [state.session]
      : []),
  ].filter((s) => s.endsAt > now);
}
export function activeKeywords(state, now = Date.now()) {
  if (!state) return [];
  const words = activeSessions(state, now).flatMap(
    (s) =>
      s.blockedKeywords ||
      (state.settings?.keywordFilterEnabled && !s.label
        ? state.settings.blockedKeywords
        : []) ||
      [],
  );
  for (const schedule of state.schedules || [])
    if (scheduleActive(schedule, new Date(now)))
      for (const id of schedule.categoryIds) {
        const policy =
          state.categories?.find((c) => c.id === id)?.policy || state.settings;
        if (policy?.keywordFilterEnabled)
          words.push(...(policy.blockedKeywords || []));
      }
  return [
    ...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean)),
  ].sort();
}
export function keywordRules(state) {
  return activeKeywords(state)
    .filter((w) => w.trim())
    .map((word, i) => ({
      id: 100000 + i,
      priority: 2,
      action: { type: 'block' },
      condition: {
        regexFilter: keywordPattern(word),
        isUrlFilterCaseSensitive: false,
        resourceTypes: [
          'main_frame',
          'sub_frame',
          'xmlhttprequest',
          'script',
          'image',
          'media',
          'websocket',
          'other',
        ],
      },
    }));
}
export async function supportedKeywordRules(state, checkRegex) {
  const words = activeKeywords(state),
    candidates = keywordRules(state);
  const warnings = [],
    rules = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let supported = false;
    try {
      supported = await checkRegex(candidate.condition.regexFilter);
    } catch {}
    if (supported) {
      rules.push(candidate);
      continue;
    }
    // Keep literal network matching and decoded navigation filtering when
    // Chrome rejects the encoded form; never discard the domain rules.
    const literal = words[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let literalSupported = false;
    try {
      literalSupported = await checkRegex(literal);
    } catch {}
    if (literalSupported)
      rules.push({
        ...candidate,
        condition: { ...candidate.condition, regexFilter: literal },
      });
    warnings.push(words[i]);
  }
  return { rules, warnings };
}
export function matchedKeyword(url, state) {
  let decoded = String(url);
  for (let n = 0; n < 4; n++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      decoded = decoded.replace(/%([a-f\d]{2})/gi, (_, b) =>
        String.fromCharCode(parseInt(b, 16)),
      );
    }
  }
  decoded = decoded.replace(/\+/g, ' ').toLowerCase();
  return (
    activeKeywords(state).find((w) => decoded.includes(w.toLowerCase())) || null
  );
}
export function nextBoundary(state, now = new Date()) {
  if (!state) return null;
  const times = [];
  times.push(...activeSessions(state, now.getTime()).map((s) => s.endsAt));
  for (const schedule of state.schedules || [])
    if (schedule.enabled && schedule.skipUntil > now.getTime())
      times.push(schedule.skipUntil);
  for (const schedule of state.schedules || [])
    if (schedule.enabled)
      for (let offset = -1; offset <= 8; offset++) {
        const start = new Date(now);
        start.setDate(start.getDate() + offset);
        if (!schedule.days.includes(start.getDay())) continue;
        const [sh, sm] = schedule.start.split(':').map(Number),
          [eh, em] = schedule.end.split(':').map(Number);
        start.setHours(sh, sm, 0, 0);
        const end = new Date(start);
        if (schedule.end < schedule.start) end.setDate(end.getDate() + 1);
        end.setHours(eh, em, 0, 0);
        if (start > now) times.push(start.getTime());
        if (end > now) times.push(end.getTime());
      }
  return times.length ? Math.min(...times) : null;
}

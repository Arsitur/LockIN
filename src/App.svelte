<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import Icon from './lib/Icon.svelte';
  import SiteIcon from './lib/SiteIcon.svelte';
  import FilteringSettings from './lib/FilteringSettings.svelte';
  import {
    accents,
    defaultState,
    uid,
    normalizeDomain,
    scheduleActive,
    blockedDomains,
    formatTime,
    nextScheduleLabel,
    scheduleOccurrenceEnd,
    blockedAppPaths,
    frequentDurations,
    accentContrast,
    categoryColors,
    categoryIcons,
    inheritActiveCategories,
    categoryLockedUntil,
    activeSessions,
    categoryPolicy,
    categoryPolicyLocked,
    type Application,
    type AppState,
    type Site,
    type Category,
    type Schedule,
    type UnlockProgress,
  } from './lib/model';
  import * as storage from './lib/storage';

  let state: AppState = structuredClone(defaultState);
  let loaded = false,
    busy = false,
    now = Date.now();
  let route = 'dashboard',
    categoryFilter = 'all',
    search = '',
    settingsTab = 'appearance';
  let duration = 25,
    customDuration = '25',
    selectedSite: string | null = null;
  let modal:
    | 'timer'
    | 'site'
    | 'category'
    | 'schedule'
    | 'schedule-start'
    | 'application'
    | 'start-apps'
    | 'unlock'
    | 'extension'
    | 'help'
    | 'guard-setup'
    | 'strict-lock'
    | null = null;
  let toast = '',
    toastTimer: ReturnType<typeof setTimeout>;
  let undoStack: AppState[] = [],
    redoStack: AppState[] = [];
  let clipboard: { site: Site; cut: boolean } | null = null,
    draggedId = '',
    dragOver = '';
  let siteName = '',
    siteDomain = '',
    siteCategory = 'social',
    editingId = '',
    formError = '';
  let categoryName = '',
    categoryColor = '#c6b7f5',
    categoryIcon = 'social';
  let scheduleName = '',
    scheduleStart = '09:00',
    scheduleEnd = '12:00',
    scheduleDays = [1, 2, 3, 4, 5],
    scheduleCategories: string[] = ['social'];
  let unlockProgress: UnlockProgress | null = null,
    unlockPhrase = '',
    extensionId = '',
    bridgeConnected = false;
  let bridgeError = '';
  let unlockSessionId = '';
  let policyCategoryId = 'social';
  let pendingApps: Application[] = [];
  let timerTarget: {
    kind: 'category' | 'site' | 'app';
    id: string;
    label: string;
  } | null = null;
  let rowMenu: string | null = null,
    systemDark = true;
  let customAccent: string | null = null;
  let pendingSchedule: Schedule | null = null;
  let appName = '',
    appPath = '',
    appCategory = 'social';
  let runtime: storage.RuntimeStatus = {
    tray: false,
    tooltip: '',
    blockedApps: 0,
    guardErrors: [],
  };
  let presetInput = '90';
  let siteCustomIcon = 'globe',
    iconSearch = '';
  let backendDirty = false;
  let extensionBundle: storage.ExtensionBundle | null = null;
  let guard: storage.NetworkGuardStatus = {
    installed: false,
    running: false,
    blocked: false,
    lockedUntil: 0,
    updatedAt: 0,
    error: '',
    dataPath: '',
  };
  $: filteredCategoryIcons = categoryIcons.filter((icon) =>
    icon.includes(iconSearch.toLowerCase()),
  );
  $: effectiveAccent =
    route === 'settings' &&
    settingsTab === 'appearance' &&
    customAccent &&
    /^#[\da-f]{6}$/i.test(customAccent)
      ? customAccent
      : state.settings.accent;
  $: savedColors = [...new Set([...accents, ...state.settings.savedAccents])];
  $: durationTags = frequentDurations(state);
  $: enabledApps = state.apps.filter(
    (a) =>
      a.enabled &&
      (categoryFilter === 'all' || a.categoryId === categoryFilter),
  );
  $: filteredApps = state.apps.filter(
    (a) =>
      (categoryFilter === 'all' || a.categoryId === categoryFilter) &&
      `${a.name} ${a.path}`.toLowerCase().includes(search.toLowerCase()),
  );
  $: blockedApps = blockedAppPaths(state, now);

  $: sessions = activeSessions(state, now);
  $: session = sessions.find((s) => s.id === unlockSessionId) || null;
  $: selectedPolicy = categoryPolicy(state, policyCategoryId);
  $: policyLocked = categoryPolicyLocked(state, policyCategoryId, now);
  $: if (loaded && !state.categories.some((c) => c.id === policyCategoryId))
    policyCategoryId = state.categories[0]?.id || '';
  $: startCategories = state.categories.filter(
    (c) =>
      (categoryFilter === 'all'
        ? state.sites.some((s) => s.categoryId === c.id && s.enabled) ||
          state.apps.some((a) => a.categoryId === c.id && a.enabled)
        : c.id === categoryFilter) &&
      !sessions.some((s) => s.categoryIds?.includes(c.id)),
  );
  $: blocked = blockedDomains(state, now);
  $: enabledSites = state.sites.filter(
    (s) =>
      s.enabled &&
      (categoryFilter === 'all' || s.categoryId === categoryFilter),
  );
  $: filteredSites = state.sites.filter(
    (s) =>
      (categoryFilter === 'all' || s.categoryId === categoryFilter) &&
      `${s.name} ${s.domain}`.toLowerCase().includes(search.toLowerCase()),
  );
  $: activeSchedules = state.schedules.filter((s) =>
    scheduleActive(s, new Date(now)),
  );
  $: currentCategory = state.categories.find((c) => c.id === categoryFilter);
  $: remaining = session ? Math.max(0, session.endsAt - now) : duration * 60000;
  $: dark =
    state.settings.theme === 'dark' ||
    (state.settings.theme === 'system' && systemDark);
  $: focusMinutes = Math.floor(
    state.history
      .filter((s) => !s.testMode)
      .reduce((sum, s) => sum + (s.endedAt - s.startedAt), 0) / 60000,
  );
  $: completedSessions = state.history.filter(
    (s) => s.completed && !s.testMode,
  ).length;
  $: protectedNow =
    sessions.some((s) => !s.testMode) ||
    (activeSchedules.length > 0 && !state.settings.testMode);
  $: if (loaded) updateFavicon(effectiveAccent);

  onMount(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    systemDark = query.matches;
    const themeChange = () => (systemDark = query.matches);
    query.addEventListener('change', themeChange);
    storage
      .loadState()
      .then((s) => {
        state = s;
        loaded = true;
      })
      .catch((e) => {
        notify(String(e));
        loaded = true;
      });
    const interval = setInterval(async () => {
      now = Date.now();
      if (backendDirty && !busy) {
        backendDirty = false;
        try {
          state = await storage.loadState();
        } catch (e) {
          notify(String(e));
        }
      }
      if (state.sessions.some((s) => s.endsAt <= now)) {
        try {
          state = await storage.loadState();
          notify('Session complete. A little more room for what matters.');
        } catch (e) {
          notify(String(e));
        }
      }
    }, 1000);
    const checkBridge = async () => {
      try {
        const bridge = await storage.bridgeStatus();
        bridgeConnected = bridge.connected;
        bridgeError = bridge.error || '';
        if (storage.desktop) runtime = await storage.runtimeStatus();
        if (storage.desktop) guard = await storage.networkGuardStatus();
      } catch {
        bridgeConnected = false;
      }
    };
    checkBridge();
    const bridgeInterval = setInterval(checkBridge, 4000);
    const unlockListener = storage.desktop
      ? listen('show-unlock', () => {
          if (sessions.length) {
            route = 'dashboard';
            if (sessions.length === 1) openUnlock(sessions[0].id);
          } else route = 'schedules';
        })
      : Promise.resolve(() => {});
    const stateListener = storage.desktop
      ? listen('state-updated', () => (backendDirty = true))
      : Promise.resolve(() => {});
    return () => {
      clearInterval(interval);
      clearInterval(bridgeInterval);
      clearTimeout(toastTimer);
      query.removeEventListener('change', themeChange);
      unlockListener.then((unlisten) => unlisten());
      stateListener.then((unlisten) => unlisten());
    };
  });

  function notify(message: string) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 4500);
  }
  async function change(
    fn: (next: AppState) => void,
    message = '',
    record = true,
  ) {
    if (busy) return false;
    const before = structuredClone(state),
      next = structuredClone(state);
    try {
      fn(next);
      inheritActiveCategories(before, next);
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
    const protectionError = checkProtection(next);
    if (protectionError) {
      notify(protectionError);
      return false;
    }
    const afterBlocked = blockedDomains(next);
    for (const domain of state.settings.testMode
      ? sessions.flatMap((s) => s.domains)
      : blocked)
      if (!afterBlocked.has(domain)) {
        notify(
          'This website is protected. Finish Lights Out before changing it.',
        );
        return false;
      }
    for (const path of state.settings.testMode
      ? sessions.flatMap((s) => s.appPaths || [])
      : blockedApps)
      if (!blockedAppPaths(next).has(path)) {
        notify('This application is protected until Lights Out ends.');
        return false;
      }
    busy = true;
    state = next;
    try {
      state = await storage.saveState(next);
      if (record) {
        undoStack = [...undoStack.slice(-39), before];
        redoStack = [];
      }
      if (message) notify(message);
      return true;
    } catch (e) {
      state = before;
      if (String(e).includes('companion')) {
        try {
          state = await storage.loadState();
        } catch {}
      }
      notify(String(e));
      return false;
    } finally {
      busy = false;
    }
  }
  function checkProtection(next: AppState): string | null {
    for (const c of state.categories) {
      if (
        categoryPolicyLocked(state, c.id, now) &&
        (!next.categories.some((x) => x.id === c.id) ||
          JSON.stringify(categoryPolicy(next, c.id)) !==
            JSON.stringify(categoryPolicy(state, c.id)))
      )
        return "This category's filtering and protection stay locked until its timers and schedules end.";
    }
    if (
      (sessions.some((s) => !s.testMode) ||
        (!state.settings.testMode &&
          activeSchedules.some((s) =>
            s.categoryIds.some(
              (id) => categoryPolicy(state, id).strictNetworkGuard,
            ),
          ))) &&
      next.settings.testMode !== state.settings.testMode
    )
      return 'Test mode stays locked during active Lights Out.';
    for (const schedule of state.settings.testMode ? [] : activeSchedules)
      if (
        !next.schedules.some(
          (s) => JSON.stringify(s) === JSON.stringify(schedule),
        )
      )
        return 'An active schedule stays locked until its end time.';
    return null;
  }
  async function undo(redo = false) {
    const stack = redo ? redoStack : undoStack;
    if (!stack.length || busy) return;
    const target = structuredClone(stack[stack.length - 1]);
    const current = structuredClone(state);
    target.session = null;
    target.sessions = state.sessions;
    target.history = state.history;
    target.revision = state.revision;
    target.settings = {
      ...target.settings,
      theme: state.settings.theme,
      accent: state.settings.accent,
      savedAccents: state.settings.savedAccents,
      durationPresets: state.settings.durationPresets,
      durationUsage: state.settings.durationUsage,
      websiteIcons: state.settings.websiteIcons,
    };
    const protectionError = checkProtection(target);
    if (protectionError) {
      notify(protectionError);
      return;
    }
    for (const domain of state.settings.testMode
      ? sessions.flatMap((s) => s.domains)
      : blocked)
      if (!blockedDomains(target).has(domain)) {
        notify('That change is protected until Lights Out ends.');
        return;
      }
    busy = true;
    try {
      state = await storage.saveState(target);
      if (redo) {
        redoStack = redoStack.slice(0, -1);
        undoStack = [...undoStack, current];
      } else {
        undoStack = undoStack.slice(0, -1);
        redoStack = [...redoStack, current];
      }
      if (!state.categories.some((c) => c.id === categoryFilter))
        categoryFilter = 'all';
      notify(redo ? 'Change redone' : 'Change undone');
    } catch (e) {
      notify(String(e));
    } finally {
      busy = false;
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeModal();
      rowMenu = null;
      selectedSite = null;
      return;
    }
    const target = event.target as HTMLElement;
    if (
      target.closest('input, textarea, select, [contenteditable="true"]') ||
      modal
    )
      return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === '1') {
        event.preventDefault();
        showDashboard();
      }
      if (key === 'z') {
        event.preventDefault();
        undo(event.shiftKey);
      }
      if (key === 'y') {
        event.preventDefault();
        undo(true);
      }
      if (key === 'c' || key === 'x') {
        if (selectedSite) {
          event.preventDefault();
          copySite(selectedSite, key === 'x');
        }
      }
      if (key === 'v' && clipboard) {
        event.preventDefault();
        pasteSite();
      }
      if (key === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#site-search')?.focus();
      }
    }
    if (event.key === 'Delete' && selectedSite) removeSite(selectedSite);
  }
  function copySite(id: string, cut = false) {
    const site = state.sites.find((s) => s.id === id);
    if (!site) return;
    clipboard = { site: structuredClone(site), cut };
    rowMenu = null;
    notify(
      `${site.name} ${cut ? 'cut' : 'copied'}. Choose a category and press Ctrl+V.`,
    );
  }
  async function pasteSite(targetCategory = categoryFilter) {
    if (!clipboard) return;
    if (targetCategory === 'all') {
      notify('Choose a category in the sidebar to paste here.');
      return;
    }
    const { site, cut } = clipboard;
    if (
      state.sites.some(
        (s) =>
          s.categoryId === targetCategory &&
          s.domain === site.domain &&
          (!cut || s.id !== site.id),
      )
    ) {
      notify('This website is already in that category.');
      return;
    }
    const saved = await change(
      (s) => {
        const existing = s.sites.find((x) => x.id === site.id);
        if (cut && existing) existing.categoryId = targetCategory;
        else s.sites.push({ ...site, id: uid(), categoryId: targetCategory });
      },
      `${site.name} ${cut ? 'moved' : 'pasted'}`,
    );
    if (cut && saved) clipboard = null;
  }
  function removeSite(id: string) {
    change(
      (s) => (s.sites = s.sites.filter((x) => x.id !== id)),
      'Website removed. Ctrl+Z to undo.',
    );
    rowMenu = null;
  }
  function toggleSite(site: Site) {
    change((s) => {
      const x = s.sites.find((x) => x.id === site.id)!;
      x.enabled = !x.enabled;
    });
  }
  function toggleCategory(id: string) {
    const sites = state.sites.filter((s) => s.categoryId === id),
      allEnabled = sites.length > 0 && sites.every((s) => s.enabled);
    change((s) =>
      s.sites
        .filter((x) => x.categoryId === id)
        .forEach((x) => (x.enabled = !allEnabled)),
    );
  }
  function dropSite(
    event: DragEvent,
    targetCategory: string,
    beforeId?: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    dragOver = '';
    const id = event.dataTransfer?.getData('text/plain') || draggedId;
    if (!state.sites.some((s) => s.id === id) || id === beforeId) return;
    const copy = event.ctrlKey || event.metaKey;
    change(
      (s) => {
        const index = s.sites.findIndex((x) => x.id === id);
        const moving = copy
          ? { ...s.sites[index], id: uid() }
          : s.sites.splice(index, 1)[0];
        if (targetCategory !== 'all') moving.categoryId = targetCategory;
        if (
          s.sites.some(
            (x) =>
              x.id !== moving.id &&
              x.domain === moving.domain &&
              x.categoryId === moving.categoryId,
          )
        )
          throw new Error('This website is already in that category.');
        const target = beforeId
          ? s.sites.findIndex((x) => x.id === beforeId)
          : s.sites.length;
        const rect = (
          event.currentTarget as HTMLElement
        ).getBoundingClientRect();
        const after = !!beforeId && event.clientY >= rect.top + rect.height / 2;
        s.sites.splice(
          target < 0 ? s.sites.length : target + (after ? 1 : 0),
          0,
          moving,
        );
      },
      copy ? 'Website copied' : 'Website moved',
    );
    draggedId = '';
  }
  function openSite(site?: Site) {
    siteCustomIcon = site?.customIcon || 'globe';
    editingId = site?.id || '';
    siteName = site?.name || '';
    siteDomain = site?.domain || '';
    siteCategory =
      site?.categoryId ||
      (categoryFilter !== 'all'
        ? categoryFilter
        : state.categories[0]?.id || '');
    formError = '';
    rowMenu = null;
    modal = 'site';
  }
  async function submitSite(event: SubmitEvent) {
    event.preventDefault();
    formError = '';
    try {
      const domain = normalizeDomain(siteDomain);
      if (!siteCategory) throw new Error('Create a category first.');
      if (
        state.sites.some(
          (s) =>
            s.domain === domain &&
            s.categoryId === siteCategory &&
            s.id !== editingId,
        )
      )
        throw new Error('This website is already in that category.');
      const site: Site = {
        ...state.sites.find((s) => s.id === editingId),
        customIcon: siteCustomIcon,
        id: editingId || uid(),
        name:
          siteName.trim() ||
          domain.split('.')[0].replace(/^./, (c) => c.toUpperCase()),
        domain,
        categoryId: siteCategory,
        enabled: editingId
          ? state.sites.find((s) => s.id === editingId)!.enabled
          : true,
      };
      const saved = await change(
        (s) => {
          if (editingId)
            s.sites = s.sites.map((x) => (x.id === editingId ? site : x));
          else s.sites.push(site);
        },
        editingId ? 'Website updated' : `${site.name} added to your space`,
      );
      if (saved) closeModal();
    } catch (e) {
      formError = (e as Error).message;
    }
  }
  function openCategory(category?: Category) {
    iconSearch = '';
    editingId = category?.id || '';
    categoryName = category?.name || '';
    categoryColor = category?.color || accents[1];
    categoryIcon = category?.icon || 'social';
    formError = '';
    modal = 'category';
  }
  async function submitCategory(event: SubmitEvent) {
    event.preventDefault();
    if (!/^#[\da-f]{6}$/i.test(categoryColor)) {
      formError = 'Choose a six-digit hex color, like #a78bfa.';
      return;
    }
    const name = categoryName.trim();
    if (!name) {
      formError = 'Give your category a name.';
      return;
    }
    if (
      state.categories.some(
        (c) =>
          c.name.toLowerCase() === name.toLowerCase() && c.id !== editingId,
      )
    ) {
      formError = 'There is already a category with that name.';
      return;
    }
    const category: Category = {
      ...(state.categories.find((c) => c.id === editingId) || {
        policy: structuredClone(categoryPolicy(state, '')),
      }),
      id: editingId || uid(),
      name,
      color: categoryColor,
      icon: categoryIcon,
    };
    const saved = await change((s) => {
      if (editingId)
        s.categories = s.categories.map((c) =>
          c.id === editingId ? category : c,
        );
      else s.categories.push(category);
    }, 'Category saved');
    if (saved) closeModal();
  }
  async function deleteCategory() {
    const id = editingId;
    if (
      state.sites.some((s) => s.categoryId === id) ||
      state.apps.some((a) => a.categoryId === id)
    ) {
      formError =
        'Move or remove the websites and applications in this category first.';
      return;
    }
    const saved = await change((s) => {
      s.categories = s.categories.filter((c) => c.id !== id);
      s.schedules = s.schedules
        .map((x) => ({
          ...x,
          categoryIds: x.categoryIds.filter((c) => c !== id),
        }))
        .filter((x) => x.categoryIds.length);
    }, 'Category removed');
    if (!saved) return;
    categoryFilter = 'all';
    closeModal();
  }
  function openSchedule(schedule?: Schedule) {
    editingId = schedule?.id || '';
    scheduleName = schedule?.name || '';
    scheduleStart = schedule?.start || '09:00';
    scheduleEnd = schedule?.end || '12:00';
    scheduleDays = [...(schedule?.days || [1, 2, 3, 4, 5])];
    scheduleCategories = [
      ...(schedule?.categoryIds || state.categories.map((c) => c.id)),
    ];
    formError = '';
    modal = 'schedule';
  }
  async function submitSchedule(event: SubmitEvent) {
    event.preventDefault();
    if (
      !scheduleDays.length ||
      !scheduleCategories.length ||
      scheduleStart === scheduleEnd
    ) {
      formError =
        'Choose at least one day, one category, and different start and end times.';
      return;
    }
    const schedule: Schedule = {
      id: editingId || uid(),
      name: scheduleName.trim() || 'Focus hours',
      start: scheduleStart,
      end: scheduleEnd,
      days: scheduleDays,
      categoryIds: scheduleCategories,
      enabled: true,
    };
    await proposeSchedule(schedule);
  }
  function openTimer(
    kind: 'category' | 'site' | 'app',
    id: string,
    label: string,
  ) {
    timerTarget = { kind, id, label };
    duration =
      (kind === 'category'
        ? state.categories.find((c) => c.id === id)?.durationMinutes
        : state.sites.find((s) => s.id === id)?.durationMinutes) || 25;
    customDuration = String(duration);
    rowMenu = null;
    formError = '';
    modal = 'timer';
  }
  async function startFocus(confirmed = false) {
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      notify('Choose between 1 and 1,440 whole minutes.');
      return;
    }
    const categories = timerTarget
      ? timerTarget.kind === 'category'
        ? [timerTarget.id]
        : []
      : startCategories.map((c) => c.id);
    const sites = timerTarget?.kind === 'site' ? [timerTarget.id] : [];
    const apps = timerTarget?.kind === 'app' ? [timerTarget.id] : [];
    const affectedApps = state.apps.filter(
      (a) => apps.includes(a.id) || categories.includes(a.categoryId),
    );
    if (!categories.length && !sites.length && !apps.length) {
      notify('Choose another category or website to start a timer.');
      return;
    }
    pendingApps = affectedApps;
    if (affectedApps.length && confirmed !== true) {
      modal = 'start-apps';
      return;
    }
    busy = true;
    try {
      state = await storage.startSession(
        sites,
        duration,
        state.settings.testMode,
        apps,
        categories,
      );
      now = Date.now();
      customDuration = String(duration);
      modal = null;
      timerTarget = null;
      notify(
        storage.desktop
          ? 'Your timers are running. Each boundary has its own time.'
          : 'Preview timers started. Connect the desktop app and extension to block websites.',
      );
    } catch (e) {
      notify(String(e));
    } finally {
      busy = false;
    }
  }
  async function openUnlock(id: string) {
    unlockSessionId = id;
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    if (target.strictNetworkGuard && !target.testMode) {
      modal = 'strict-lock';
      return;
    }
    try {
      unlockProgress = await storage.beginUnlock(id);
      unlockPhrase = '';
      formError = '';
      modal = 'unlock';
    } catch (e) {
      notify(String(e));
    }
  }
  async function nextUnlockStep() {
    busy = true;
    try {
      unlockProgress = await storage.advanceUnlock(unlockSessionId);
    } catch (e) {
      formError = String(e);
    } finally {
      busy = false;
    }
  }
  async function endFocus() {
    busy = true;
    try {
      state = await storage.finishUnlock(unlockPhrase, unlockSessionId);
      closeModal();
      notify('Lights are back on. Come back when you are ready.');
    } catch (e) {
      formError = String(e);
    } finally {
      busy = false;
    }
  }
  async function proposeSchedule(schedule: Schedule) {
    const proposed = { ...schedule, skipUntil: 0 };
    if (scheduleActive(proposed)) {
      pendingSchedule = proposed;
      modal = 'schedule-start';
      return;
    }
    await saveSchedule(proposed);
  }
  async function saveSchedule(schedule: Schedule) {
    const saved = await change(
      (s) => {
        const index = s.schedules.findIndex((x) => x.id === schedule.id);
        if (index >= 0) s.schedules[index] = schedule;
        else s.schedules.push(schedule);
      },
      schedule.skipUntil
        ? 'Saved. This occurrence is skipped; your schedule starts next time.'
        : 'Your focus hours are scheduled',
    );
    if (saved) {
      pendingSchedule = null;
      closeModal();
    }
  }
  async function decideSchedule(nextTime: boolean) {
    if (!pendingSchedule) return;
    await saveSchedule({
      ...pendingSchedule,
      skipUntil: nextTime ? scheduleOccurrenceEnd(pendingSchedule) : 0,
    });
  }
  async function toggleSchedule(schedule: Schedule) {
    if (schedule.enabled)
      await change(
        (s) => (s.schedules.find((x) => x.id === schedule.id)!.enabled = false),
        'Schedule paused',
      );
    else await proposeSchedule({ ...schedule, enabled: true, skipUntil: 0 });
  }
  async function saveCustomAccent() {
    if (!customAccent || !/^#[\da-f]{6}$/i.test(customAccent)) {
      notify('Enter a six-digit hex color, like #a78bfa.');
      return;
    }
    const color = customAccent.toLowerCase();
    if (
      await change(
        (s) => {
          s.settings.savedAccents = [
            ...new Set([...s.settings.savedAccents, color]),
          ].slice(-20);
          s.settings.accent = color;
        },
        'Custom accent saved',
        false,
      )
    )
      customAccent = null;
  }
  async function saveDuration(value = Number(customDuration)) {
    if (!Number.isInteger(value) || value < 1 || value > 1440) {
      notify('Choose a whole number from 1 to 1,440 minutes.');
      return;
    }
    if (state.settings.durationPresets.includes(value)) {
      duration = value;
      customDuration = String(value);
      notify('That duration is already saved.');
      return;
    }
    if (state.settings.durationPresets.length >= 12) {
      notify(
        'You can save 12 durations. Remove one in Settings → General first.',
      );
      return;
    }
    if (
      await change(
        (s) => s.settings.durationPresets.push(value),
        'Duration saved',
        false,
      )
    ) {
      duration = value;
      customDuration = String(value);
    }
  }
  function openApplication(app?: Application) {
    editingId = app?.id || '';
    appName = app?.name || '';
    appPath = app?.path || '';
    appCategory =
      app?.categoryId ||
      (categoryFilter !== 'all'
        ? categoryFilter
        : state.categories[0]?.id || '');
    formError = '';
    modal = 'application';
  }
  async function browseApplication() {
    try {
      const path = await storage.pickApplication();
      if (path) {
        appPath = path;
        if (!appName)
          appName = path
            .split(/[\\/]/)
            .pop()!
            .replace(/\.exe$/i, '');
      }
    } catch (e) {
      formError = String(e);
    }
  }
  async function submitApplication(event: SubmitEvent) {
    event.preventDefault();
    const path = appPath.trim();
    if (!/^(?:[a-z]:[\\/]|\\\\).+\.exe$/i.test(path)) {
      formError = 'Choose a Windows application with an absolute .exe path.';
      return;
    }
    if (!appCategory) {
      formError = 'Create a category first.';
      return;
    }
    if (
      state.apps.some(
        (a) =>
          a.id !== editingId && a.path.toLowerCase() === path.toLowerCase(),
      )
    ) {
      formError = 'This application is already in your space.';
      return;
    }
    const app: Application = {
      id: editingId || uid(),
      name:
        appName.trim() ||
        path
          .split(/[\\/]/)
          .pop()!
          .replace(/\.exe$/i, ''),
      path,
      categoryId: appCategory,
      enabled: editingId
        ? state.apps.find((a) => a.id === editingId)!.enabled
        : true,
    };
    if (
      await change((s) => {
        if (editingId)
          s.apps = s.apps.map((a) => (a.id === editingId ? app : a));
        else s.apps.push(app);
      }, 'Application saved')
    )
      closeModal();
  }
  function updateFavicon(accent: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="${accent}"/><path d="M23 16v24h20v8H15V16zm10 0h16v16h-8v-8h-8z" fill="${accentContrast(accent)}"/></svg>`;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  function closeModal() {
    modal = null;
    pendingSchedule = null;
    timerTarget = null;
    formError = '';
  }
  async function updateCompanion() {
    try {
      extensionBundle = await storage.prepareExtension();
      notify(
        'Extension files updated. Your loaded managed companion reloads automatically.',
      );
    } catch (e) {
      notify(String(e));
    }
  }
  async function setupGuard() {
    try {
      await storage.installNetworkGuard();
      closeModal();
      notify(
        'Approve the Windows administrator prompt to install the network guard. Enable strict protection after its status is ready.',
      );
    } catch (e) {
      formError = String(e);
    }
  }
  function lockLabel(end: number) {
    return new Date(end).toLocaleString('en', {
      weekday:
        new Date(end).getDate() !== new Date(now).getDate()
          ? 'short'
          : undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  function focusDialog(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() =>
      (
        node.querySelector<HTMLElement>('input, textarea, select') || node
      ).focus(),
    );
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const controls = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]',
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === node)
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
    node.addEventListener('keydown', trap);
    return {
      destroy() {
        document.body.style.overflow = overflow;
        node.removeEventListener('keydown', trap);
        previous?.focus();
      },
    };
  }
  function brandColor(domain: string) {
    return (
      (
        {
          'instagram.com': '#dc87bb',
          'x.com': '#d4d5d4',
          'reddit.com': '#ee9471',
          'tiktok.com': '#9bd6cf',
          'youtube.com': '#ee8f8c',
          'netflix.com': '#e07b86',
          'twitch.tv': '#c0a5ef',
          'amazon.com': '#e9c48b',
        } as Record<string, string>
      )[domain] || state.settings.accent
    );
  }
  function brandLetter(site: Site) {
    return (
      (
        {
          'instagram.com': '◎',
          'x.com': '𝕏',
          'reddit.com': 'r',
          'tiktok.com': '♪',
          'youtube.com': '▶',
          'netflix.com': 'N',
          'twitch.tv': '▣',
          'amazon.com': 'a',
        } as Record<string, string>
      )[site.domain] || site.name[0].toUpperCase()
    );
  }
  function showDashboard(category = 'all') {
    categoryFilter = category;
    route = 'dashboard';
    search = '';
  }
  async function connectExtension() {
    formError = '';
    if (!/^[a-p]{32}$/.test(extensionId.trim())) {
      formError = 'Paste the 32-letter extension ID from chrome://extensions.';
      return;
    }
    busy = true;
    try {
      const message = await storage.installBridge(extensionId.trim());
      notify(message);
      closeModal();
    } catch (e) {
      formError = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window on:keydown={handleKey} on:click={() => (rowMenu = null)} />

<div
  class="app-shell"
  class:light={!dark}
  style={`--accent: ${effectiveAccent}; --on-accent:${accentContrast(effectiveAccent)}`}
>
  <aside class="sidebar" inert={!!modal}>
    <a
      class="brand"
      href="/"
      on:click|preventDefault={() => showDashboard()}
      aria-label="LockIN home"
      ><span class="brand-mark"><span></span><i></i></span><span
        >lock<span class="brand-in">in</span><span class="brand-period">.</span
        ></span
      ></a
    >
    <div class="workspace-label">
      <span class="tiny-dot"></span> YOUR PERSONAL SPACE
    </div>
    <nav class="main-nav" aria-label="Main navigation">
      <button
        class:active={route === 'dashboard'}
        on:click={() => showDashboard()}
        ><Icon name="grid" size={19} /><span>Overview</span><span
          class="nav-shortcut">Ctrl 1</span
        ></button
      >
      <button
        class:active={route === 'apps'}
        on:click={() => {
          route = 'apps';
          search = '';
        }}
        ><Icon name="monitor" size={19} /><span>Applications</span
        >{#if state.apps.length}<span class="nav-count"
            >{state.apps.length}</span
          >{/if}</button
      >
      <button
        class:active={route === 'schedules'}
        on:click={() => (route = 'schedules')}
        ><Icon name="clock" size={19} /><span>Auto Lights Out</span
        >{#if state.schedules.length}<span class="nav-count"
            >{state.schedules.length}</span
          >{/if}</button
      >
      <button
        class:active={route === 'protection'}
        on:click={() => (route = 'protection')}
        ><Icon name="shield" size={19} /><span>Unlock protection</span></button
      >
    </nav>
    <div class="nav-section-title">
      <span>YOUR CATEGORIES</span><button
        class="icon-button small"
        aria-label="Add category"
        on:click={() => openCategory()}><Icon name="plus" size={16} /></button
      >
    </div>
    <div class="category-nav">
      {#each state.categories as category (category.id)}
        <button
          class:selected={route === 'dashboard' &&
            categoryFilter === category.id}
          class:drop-target={dragOver === category.id}
          on:click={() => showDashboard(category.id)}
          on:dragover={(e) => {
            e.preventDefault();
            dragOver = category.id;
          }}
          on:dragleave={() => (dragOver = '')}
          on:drop={(e) => dropSite(e, category.id)}
          ><span class="category-dot" style={`background:${category.color}`}
          ></span><span>{category.name}</span><span class="category-count"
            >{state.sites.filter((s) => s.categoryId === category.id)
              .length}</span
          ></button
        >
      {/each}
      <button class="new-category" on:click={() => openCategory()}
        ><Icon name="plus" size={16} /><span>New category</span></button
      >
    </div>
    <div class="sidebar-spacer"></div>
    <button
      class="extension-card"
      on:click={() => {
        modal = 'extension';
        formError = '';
      }}
      ><span class="extension-card-icon"><Icon name="link" size={18} /></span
      ><span
        ><strong>Chrome extension</strong><small
          ><span class:connected={bridgeConnected} class="status-dot"
          ></span>{bridgeConnected
            ? 'Connected & ready'
            : 'Connect your browser'}</small
        ></span
      ><Icon name="up" size={15} /></button
    >
    <nav class="bottom-nav" aria-label="Preferences">
      <button
        class:active={route === 'settings'}
        on:click={() => (route = 'settings')}
        ><Icon name="settings" size={19} /><span>Settings</span></button
      ><button on:click={() => (modal = 'help')}
        ><Icon name="help" size={19} /><span>A little help</span><span
          class="help-shortcut">?</span
        ></button
      >
    </nav>
    <div class="sidebar-footer">
      <span class="avatar">A</span>
      <div>
        <strong>A space to focus</strong><small
          >Made for your peace of mind</small
        >
      </div>
      <span class="version">v1.3.1</span>
    </div>
  </aside>

  <div class="main-shell" inert={!!modal}>
    <header class="topbar">
      <div class="breadcrumbs">
        <span>Your space</span><Icon name="right" size={13} /><strong
          >{route === 'dashboard'
            ? currentCategory?.name || 'Overview'
            : route === 'schedules'
              ? 'Auto Lights Out'
              : route === 'protection'
                ? 'Unlock protection'
                : route === 'apps'
                  ? 'Applications'
                  : 'Settings'}</strong
        >
      </div>
      <div class="topbar-right">
        {#if storage.desktop}<button
            class="icon-button"
            aria-label="Minimize to tray"
            title="Minimize to tray"
            on:click={() =>
              storage.hideToTray().catch((e) => notify(String(e)))}
            ><Icon name="down" size={18} /></button
          >{/if}
        {#if state.settings.testMode}<span class="test-badge"
            ><Icon name="coffee" size={13} /> Test mode</span
          >{/if}<span class="local-label"
          ><span class="tiny-dot"></span>Local. Private. Yours.</span
        ><button
          class="icon-button"
          aria-label="Toggle color theme"
          on:click={() =>
            change(
              (s) => (s.settings.theme = dark ? 'light' : 'dark'),
              '',
              false,
            )}><Icon name={dark ? 'sun' : 'moon'} size={18} /></button
        >
      </div>
    </header>
    <main>
      {#if route === 'dashboard'}
        <div class="page-heading">
          <div>
            <div class="eyebrow">A LITTLE INTENTION GOES A LONG WAY</div>
            <h1>Make room for focus<span class="accent-text">.</span></h1>
            <p>Your attention is yours. Let’s keep it that way.</p>
          </div>
          <div class="date-label">
            <Icon name="calendar" size={16} />{new Date(now).toLocaleDateString(
              'en',
              { month: 'short', day: 'numeric', weekday: 'short' },
            )}
          </div>
        </div>

        <section
          class="focus-hero"
          class:session-active={sessions.length > 0}
          aria-label="Focus session"
        >
          <div class="hero-copy">
            <div class="hero-pill">
              <span class="pulse-dot"></span>YOUR TIME. YOUR BOUNDARIES.
            </div>
            <h2>One less distraction.<br /><span>A little more you.</span></h2>
            <p>
              Give every category and website its own quiet time. Start another
              timer whenever you need one.
            </p>
            <div class="hero-bottom">
              <Icon name="layers" size={15} /><span
                >{sessions.length
                  ? `${sessions.length} independent timers running`
                  : 'Choose a category below, or start your selected categories.'}</span
              >
            </div>
          </div>
          <div class="orb-art" aria-hidden="true">
            <div class="orbit orbit-one"></div>
            <div class="orbit orbit-two"></div>
            <div class="orb">
              <div class="orb-shine"></div>
              <span class="orb-logo"><span></span><i></i></span>
            </div>
            <span class="star star-one">✦</span>
          </div>
          <div class="focus-controls">
            <div class="focus-control-header">
              <span><Icon name="timer" size={16} />START CATEGORY TIMERS</span>
            </div>
            <div class="timer">
              {formatTime(duration * 60000)}<span
                >minutes for each category</span
              >
            </div>
            <div class="duration-options" aria-label="Session duration">
              {#each durationTags as minutes}<button
                  class:chosen={duration === minutes}
                  on:click={() => {
                    duration = minutes;
                    customDuration = String(minutes);
                  }}>{minutes} min</button
                >{/each}
              <label class="custom-duration"
                ><input
                  type="number"
                  min="1"
                  max="1440"
                  aria-label="Custom duration in minutes"
                  bind:value={customDuration}
                  on:input={() => (duration = Number(customDuration))}
                /><span>min</span><button
                  type="button"
                  class="save-time-button"
                  aria-label="Save custom duration"
                  on:click={() => saveDuration()}
                  ><Icon name="plus" size={12} /></button
                ></label
              >
            </div>
            <button
              class="lights-out-button"
              disabled={busy || !startCategories.length}
              on:click={() => {
                timerTarget = null;
                startFocus();
              }}
              ><Icon name="power" size={19} />Lights Out<Icon
                name="right"
                size={17}
              /></button
            >
            <div class="focus-footnote">
              <Icon name="layers" size={12} />{startCategories.length}
              {startCategories.length === 1 ? 'category' : 'categories'}
              · all their websites & apps
            </div>
          </div>
        </section>
        {#if sessions.length}
          <div class="section-heading">
            <h3>Active timers <span>{sessions.length}</span></h3>
            <span class="field-hint">Each timer ends independently</span>
          </div>
          <div class="active-timers">
            {#each sessions as timer (timer.id)}
              <article
                class="active-timer"
                data-testid="active-timer"
                data-session-id={timer.id}
              >
                <span class="setting-icon"
                  ><Icon
                    name={timer.categoryIds?.length
                      ? 'layers'
                      : timer.appPaths?.length
                        ? 'monitor'
                        : 'globe'}
                    size={20}
                  /></span
                >
                <div class="active-timer-info">
                  <strong>{timer.label || 'Focus timer'}</strong><small
                    >{timer.categoryIds?.length
                      ? 'Whole category'
                      : 'Individual target'}{timer.testMode
                      ? ' · Test mode'
                      : ''}{timer.strictNetworkGuard ? ' · Strict' : ''}</small
                  >
                </div>
                <div class="active-timer-clock">
                  <strong>{formatTime(timer.endsAt - now)}</strong><small
                    >until {lockLabel(timer.endsAt)}</small
                  >
                </div>
                <button
                  class="secondary-button compact"
                  aria-label={`End ${timer.label || 'focus'} timer`}
                  on:click={() => openUnlock(timer.id)}
                  ><Icon name="lock" size={14} />{timer.testMode
                    ? 'End test session'
                    : 'End early'}</button
                >
                <div class="active-timer-progress">
                  <span
                    style={`width:${Math.max(0, Math.min(100, ((timer.endsAt - now) / (timer.endsAt - timer.startedAt)) * 100))}%`}
                  ></span>
                </div>
              </article>
            {/each}
          </div>
        {/if}

        <div class="section-heading">
          <h3>Your categories <span>{state.categories.length}</span></h3>
          <button class="text-button" on:click={() => openCategory()}
            ><Icon name="plus" size={15} />New category</button
          >
        </div>
        <div class="category-cards">
          {#each state.categories as category (category.id)}{@const sites =
              state.sites.filter((s) => s.categoryId === category.id)}
            {@const lockedUntil = categoryLockedUntil(state, category.id, now)}
            <div
              class="category-card"
              class:category-selected={categoryFilter === category.id}
              class:category-locked={!!lockedUntil}
              style={`--category-color:color-mix(in srgb,${category.color} 25%,var(--accent))`}
              role="presentation"
              on:dragover={(e) => {
                e.preventDefault();
                dragOver = category.id;
              }}
              on:dragleave={() => (dragOver = '')}
              on:drop={(e) => dropSite(e, category.id)}
              class:drop-target={dragOver === category.id}
            >
              <div class="category-card-top">
                <button
                  class="category-icon"
                  aria-label={`View ${category.name}`}
                  on:click={() => showDashboard(category.id)}
                  ><Icon name={category.icon} size={21} /></button
                ><button
                  class="toggle"
                  class:on={sites.length > 0 && sites.every((s) => s.enabled)}
                  role="switch"
                  aria-checked={sites.length > 0 &&
                    sites.every((s) => s.enabled)}
                  aria-label={`Toggle ${category.name}`}
                  on:click={() => toggleCategory(category.id)}
                  ><span></span></button
                >
              </div>
              <button
                class="category-title-button"
                on:click={() => showDashboard(category.id)}
                ><strong>{category.name}</strong><Icon
                  name={lockedUntil ? 'lock' : 'up'}
                  size={16}
                /></button
              >
              <div class="category-card-bottom">
                <span
                  >{sites.length} websites <span class="middot">·</span>
                  {sites.filter((s) => s.enabled).length} selected</span
                ><button
                  class="icon-button small"
                  aria-label={`Edit ${category.name}`}
                  on:click={() => openCategory(category)}
                  ><Icon name="more" size={17} /></button
                >
              </div>
              <div class="category-timer-actions">
                <button
                  class="text-button"
                  aria-label={`Timer for ${category.name}`}
                  on:click={() =>
                    openTimer('category', category.id, category.name)}
                  ><Icon name="timer" size={14} />{sessions.some((s) =>
                    s.categoryIds?.includes(category.id),
                  )
                    ? 'Timer running'
                    : `${category.durationMinutes || 25} min · Start`}</button
                ><button
                  class="icon-button small"
                  aria-label={`Protection for ${category.name}`}
                  on:click={() => {
                    policyCategoryId = category.id;
                    route = 'protection';
                  }}><Icon name="shield" size={14} /></button
                >
              </div>
              {#if lockedUntil}<div class="category-lock-status">
                  <Icon name="lock" size={11} /><span
                    >Locked until {lockLabel(lockedUntil)}</span
                  >
                </div>{/if}
            </div>{/each}
        </div>

        <div class="content-columns">
          <section class="websites-panel">
            <div class="section-heading website-heading">
              <div>
                <h3>
                  {currentCategory?.name || 'Your websites'}
                  <span>{filteredSites.length}</span>
                </h3>
                <p>Choose what gets a little quiet time.</p>
              </div>
              <button
                class="secondary-button compact"
                on:click={() => openSite()}
                ><Icon name="plus" size={16} />Add website</button
              >
            </div>
            <div class="table-toolbar">
              <div class="table-tabs">
                <button
                  class:active={categoryFilter === 'all'}
                  on:click={() => (categoryFilter = 'all')}>All websites</button
                >{#if currentCategory}<button
                    class="active"
                    on:click={() => (categoryFilter = currentCategory!.id)}
                    >{currentCategory.name}</button
                  >{:else}<span class="selected-count"
                    >{state.sites.filter((s) => s.enabled).length} selected</span
                  >{/if}
              </div>
              <div class="search-box">
                <Icon name="search" size={15} /><input
                  id="site-search"
                  aria-label="Search websites"
                  placeholder="Find a website..."
                  bind:value={search}
                /><kbd>Ctrl K</kbd>
              </div>
            </div>
            <div
              class="website-table"
              role="presentation"
              on:dragover|preventDefault
              on:drop={(e) => dropSite(e, categoryFilter)}
            >
              <div class="table-header">
                <span>WEBSITE</span><span>CATEGORY</span><span>INCLUDE</span>
              </div>
              {#each filteredSites as site (site.id)}{@const category =
                  state.categories.find((c) => c.id === site.categoryId)}
                <div
                  class="website-row"
                  class:row-selected={selectedSite === site.id}
                  class:is-cut={clipboard?.cut && clipboard.site.id === site.id}
                  class:blocked-row={blocked.has(site.domain)}
                  draggable="true"
                  role="presentation"
                  on:dragstart={(e) => {
                    draggedId = site.id;
                    e.dataTransfer?.setData('text/plain', site.id);
                    if (e.dataTransfer)
                      e.dataTransfer.effectAllowed = 'copyMove';
                  }}
                  on:dragend={() => {
                    draggedId = '';
                    dragOver = '';
                  }}
                  on:dragover={(e) => e.preventDefault()}
                  on:drop={(e) => dropSite(e, site.categoryId, site.id)}
                  animate:flip={{ duration: 220 }}
                >
                  <div class="website-main">
                    <span class="drag-handle"
                      ><Icon name="grip" size={15} /></span
                    ><button
                      class="website-select"
                      on:click={() =>
                        (selectedSite =
                          selectedSite === site.id ? null : site.id)}
                      aria-label={`Select ${site.name}`}
                      ><span
                        class="site-avatar"
                        style={`--site-color:color-mix(in srgb,${brandColor(site.domain)} 30%,var(--accent))`}
                        ><SiteIcon
                          {site}
                          style={state.settings.websiteIcons}
                        /></span
                      ><span class="website-name"
                        ><strong
                          >{site.name}{#if blocked.has(site.domain)}<Icon
                              name="lock"
                              size={11}
                            />{/if}</strong
                        ><small>{site.domain}</small></span
                      ></button
                    >
                  </div>
                  <button
                    class="category-tag"
                    style={`--tag-color:color-mix(in srgb,${category?.color || '#999'} 25%,var(--accent))`}
                    on:click={() => showDashboard(site.categoryId)}
                    ><span></span>{category?.name}</button
                  >
                  <div class="website-actions">
                    <button
                      class="site-timer-button"
                      aria-label={`Timer for ${site.name}`}
                      on:click={() => openTimer('site', site.id, site.name)}
                      ><Icon name="timer" size={14} /><span
                        >{sessions.some((s) => s.siteIds.includes(site.id))
                          ? formatTime(
                              Math.max(
                                ...sessions
                                  .filter((s) => s.siteIds.includes(site.id))
                                  .map((s) => s.endsAt),
                              ) - now,
                            )
                          : `${site.durationMinutes || 25}m`}</span
                      ></button
                    >

                    <button
                      class="toggle small-toggle"
                      class:on={site.enabled}
                      role="switch"
                      aria-checked={site.enabled}
                      aria-label={`Include ${site.name}`}
                      on:click={() => toggleSite(site)}><span></span></button
                    >
                    <div class="row-menu-wrapper">
                      <button
                        class="icon-button row-menu-button"
                        aria-label={`Actions for ${site.name}`}
                        on:click|stopPropagation={() =>
                          (rowMenu = rowMenu === site.id ? null : site.id)}
                        ><Icon name="more" size={17} /></button
                      >{#if rowMenu === site.id}<div
                          class="context-menu"
                          role="presentation"
                          on:click|stopPropagation
                        >
                          <button on:click={() => openSite(site)}
                            ><Icon name="edit" size={14} />Edit website</button
                          ><button on:click={() => copySite(site.id)}
                            ><Icon name="copy" size={14} />Copy<span
                              >Ctrl C</span
                            ></button
                          ><button on:click={() => copySite(site.id, true)}
                            ><Icon name="cut" size={14} />Cut<span>Ctrl X</span
                            ></button
                          >
                          <div class="menu-divider"></div>
                          {#each state.categories.filter((c) => c.id !== site.categoryId) as c}<button
                              on:click={() => {
                                change(
                                  (s) =>
                                    (s.sites.find(
                                      (x) => x.id === site.id,
                                    )!.categoryId = c.id),
                                  `Moved to ${c.name}`,
                                );
                                rowMenu = null;
                              }}
                              ><span
                                class="category-dot"
                                style={`background:${c.color}`}
                              ></span>Move to {c.name}</button
                            >{/each}
                          <div class="menu-divider"></div>
                          <button
                            class="danger-text"
                            on:click={() => removeSite(site.id)}
                            ><Icon name="trash" size={14} />Remove</button
                          >
                        </div>{/if}
                    </div>
                  </div>
                </div>{:else}<div class="empty-list">
                  <Icon name="search" size={25} /><strong
                    >{search
                      ? 'No websites found'
                      : 'A little quiet in here'}</strong
                  >
                  <p>
                    {search
                      ? 'Try a different name or domain.'
                      : 'Add a website to start building your focus space.'}
                  </p>
                  <button
                    class="text-button"
                    on:click={() => (search ? (search = '') : openSite())}
                    >{search ? 'Clear search' : 'Add your first website'}<Icon
                      name="right"
                      size={14}
                    /></button
                  >
                </div>{/each}
            </div>
            <div class="table-footer">
              <span
                ><Icon name="grip" size={13} />Drag to reorder or move to a
                category</span
              >
              <div>
                {#if clipboard}<button
                    class="text-button"
                    on:click={() => pasteSite()}
                    ><Icon name="copy" size={13} />Paste</button
                  >{/if}<button
                  class="icon-button small"
                  disabled={!undoStack.length}
                  aria-label="Undo last change"
                  on:click={() => undo()}><Icon name="undo" size={15} /></button
                ><kbd>Ctrl Z</kbd>
              </div>
            </div>
          </section>
          <aside class="right-column">
            <section class="rhythm-card">
              <div class="card-eyebrow">
                <Icon name="clock" size={17} /><span>ON YOUR TERMS</span><span
                  class="mini-badge">AUTO</span
                >
              </div>
              <h3>Find your rhythm.</h3>
              <p>
                Let focus become part of your day.<br />Set it once. Show up for
                yourself.
              </p>
              <div class="week-visual" aria-hidden="true">
                {#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as day, i}<div
                    class:weekend={i > 4}
                  >
                    <div
                      class="day-bar"
                      style={`--bar-height:${[66, 83, 58, 92, 74, 27, 35][i]}%`}
                    >
                      <span></span>
                    </div>
                    <span>{day}</span>
                  </div>{/each}
              </div>
              <div class="rhythm-caption">
                <span class="tiny-dot"></span>{nextScheduleLabel(
                  state.schedules,
                  new Date(now),
                )}
              </div>
              <button
                class="secondary-button full-width"
                on:click={() => {
                  route = 'schedules';
                  if (!state.schedules.length) openSchedule();
                }}
                ><Icon name="plus" size={16} />{state.schedules.length
                  ? 'Manage schedules'
                  : 'Create a schedule'}<Icon name="right" size={15} /></button
              >
            </section>
            <section class="thought-card">
              <span class="thought-icon">✳</span>
              <div>
                <span>A GENTLE REMINDER</span>
                <p>
                  You don’t need more time.<br />Just a little less distraction.
                </p>
              </div>
              <span class="thought-line"></span>
            </section>
            <div class="mini-stats">
              <div>
                <span class="stat-icon"><Icon name="timer" size={15} /></span
                ><strong>{focusMinutes}<small>min</small></strong><span
                  >time reclaimed</span
                >
              </div>
              <div>
                <span class="stat-icon"><Icon name="checks" size={15} /></span
                ><strong>{completedSessions}</strong><span
                  >sessions completed</span
                >
              </div>
            </div>
          </aside>
        </div>
        <footer class="page-footer">
          <span
            ><Icon name="shield" size={13} />Your data stays on your device.
            Always.</span
          ><span
            >A little less noise. A lot more you.<span class="footer-star"
              >✦</span
            ></span
          >
        </footer>
      {:else if route === 'apps'}
        <div class="page-heading">
          <div>
            <div class="eyebrow">LESS APP HOPPING. MORE DOING.</div>
            <h1>Give your apps a pause<span class="accent-text">.</span></h1>
            <p>Keep the things that pull you away out of reach.</p>
          </div>
          <button class="primary-button" on:click={() => openApplication()}
            ><Icon name="plus" size={17} />Add application</button
          >
        </div>
        <div class="info-banner">
          <Icon name="monitor" size={22} />
          <div>
            <strong
              >{storage.desktop
                ? 'Your desktop guard is on duty.'
                : 'Application blocking runs in the desktop app.'}</strong
            >
            <p>
              During Lights Out, selected apps are automatically closed,
              including new launch attempts. Save your work first. Close the
              window to keep LockIN running in the tray.
            </p>
          </div>
          <span class="subtle-badge"
            >{storage.desktop
              ? `${runtime.blockedApps} apps protected`
              : 'Preview mode'}</span
          >
        </div>
        {#if runtime.guardErrors.length}<div class="guard-errors" role="alert">
            {#each runtime.guardErrors as error}<p>{error}</p>{/each}
          </div>{/if}
        <section class="app-session-strip">
          <div>
            <span class="eyebrow">INDEPENDENT FOCUS TIMERS</span><strong
              >{sessions.length} running</strong
            ><small
              >Start a timer beside any app, or start its entire category from
              Overview.</small
            >
          </div>
          <button
            class="secondary-button"
            on:click={() => (route = 'dashboard')}
            ><Icon name="timer" size={17} />View all timers</button
          >
        </section>
        <div class="apps-toolbar">
          <select
            class="select-input"
            aria-label="Filter applications by category"
            bind:value={categoryFilter}
            ><option value="all">All categories</option
            >{#each state.categories as c}<option value={c.id}>{c.name}</option
              >{/each}</select
          >
          <div class="search-box">
            <Icon name="search" size={16} /><input
              aria-label="Search applications"
              placeholder="Find an application..."
              bind:value={search}
            />
          </div>
        </div>
        <div class="applications-list">
          {#each filteredApps as app (app.id)}{@const category =
              state.categories.find((c) => c.id === app.categoryId)}
            <article
              class="application-row"
              class:blocked-row={blockedApps.has(app.path)}
            >
              <div class="application-avatar">
                <Icon name="monitor" size={24} />
              </div>
              <div class="application-info">
                <strong
                  >{app.name}{#if blockedApps.has(app.path)}<Icon
                      name="lock"
                      size={12}
                    />{/if}</strong
                ><small title={app.path}>{app.path}</small>
              </div>
              <span
                class="category-tag"
                style={`--tag-color:color-mix(in srgb,${category?.color || effectiveAccent} 25%,var(--accent))`}
                ><span></span>{category?.name}</span
              ><button
                class="toggle"
                class:on={app.enabled}
                role="switch"
                aria-checked={app.enabled}
                aria-label={`Include ${app.name}`}
                on:click={() =>
                  change(
                    (s) =>
                      (s.apps.find((a) => a.id === app.id)!.enabled =
                        !app.enabled),
                  )}><span></span></button
              ><button
                class="icon-button"
                aria-label={`Timer for ${app.name}`}
                on:click={() => openTimer('app', app.id, app.name)}
                ><Icon name="timer" size={17} /></button
              ><button
                class="icon-button"
                aria-label={`Edit ${app.name}`}
                on:click={() => openApplication(app)}
                ><Icon name="edit" size={17} /></button
              ><button
                class="icon-button"
                aria-label={`Remove ${app.name}`}
                on:click={() =>
                  change(
                    (s) => (s.apps = s.apps.filter((a) => a.id !== app.id)),
                    'Application removed. Ctrl+Z to undo.',
                  )}><Icon name="trash" size={17} /></button
              >
            </article>{:else}<div class="large-empty-state">
              <div class="empty-illustration">
                <Icon name="monitor" size={43} /><span>✦</span>
              </div>
              <span class="eyebrow">ONE LESS REASON TO SWITCH TABS</span>
              <h2>A quieter desktop starts here.</h2>
              <p>
                Add a game, a social app, or another distraction.<br />Your
                focus session and category schedules can include them.
              </p>
              <button class="primary-button" on:click={() => openApplication()}
                ><Icon name="plus" size={17} />Add your first application</button
              >
            </div>{/each}
        </div>
      {:else if route === 'schedules'}
        <div class="page-heading">
          <div>
            <div class="eyebrow">BUILD A LITTLE CONSISTENCY</div>
            <h1>Focus, on autopilot<span class="accent-text">.</span></h1>
            <p>Your best hours deserve a place in your calendar.</p>
          </div>
          <button class="primary-button" on:click={() => openSchedule()}
            ><Icon name="plus" size={17} />New schedule</button
          >
        </div>
        <div class="info-banner">
          <Icon name="shield" size={22} />
          <div>
            <strong>Set the boundary. Let LockIN keep it.</strong>
            <p>
              Schedules run in your local time, even when the desktop window is
              hidden in the tray. All items in a category are included,
              regardless of Overview toggles. {state.settings.testMode
                ? 'Test mode: active schedules can be edited, paused, and deleted.'
                : 'Active schedules stay locked until their end time.'}
            </p>
          </div>
          <span class="timezone-label"
            >{Intl.DateTimeFormat().resolvedOptions().timeZone}</span
          >
        </div>
        <div class="schedules-list">
          {#each state.schedules as schedule (schedule.id)}{@const active =
              scheduleActive(schedule, new Date(now))}
            <article class="schedule-card">
              <div class="schedule-card-icon">
                <Icon name="clock" size={25} />
              </div>
              <div class="schedule-info">
                <div class="schedule-title">
                  <h3>{schedule.name}</h3>
                  {#if active}<span class="active-badge">Active now</span>{/if}
                  {#if schedule.skipUntil && schedule.skipUntil > now}<span
                      class="subtle-badge">This occurrence skipped</span
                    >{/if}
                </div>
                <p class="schedule-time">
                  {schedule.start}<span>—</span
                  >{schedule.end}{#if schedule.start > schedule.end}<small
                      >next day</small
                    >{/if}
                </p>
                <div class="schedule-category-tags">
                  {#each state.categories.filter( (c) => schedule.categoryIds.includes(c.id) ) as c}<span
                      class="category-tag"
                      style={`--tag-color:color-mix(in srgb,${c.color} 25%,var(--accent))`}
                      ><span></span>{c.name}</span
                    >{/each}
                </div>
                <div class="day-chips">
                  {#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as day, i}<span
                      class:chosen={schedule.days.includes(i)}>{day}</span
                    >{/each}
                </div>
              </div>
              <div class="schedule-actions">
                <button
                  class="toggle"
                  class:on={schedule.enabled}
                  disabled={active && !state.settings.testMode}
                  role="switch"
                  aria-checked={schedule.enabled}
                  aria-label={`Enable ${schedule.name}`}
                  on:click={() => toggleSchedule(schedule)}
                  ><span></span></button
                ><button
                  class="icon-button"
                  aria-label={`Edit ${schedule.name}`}
                  disabled={active && !state.settings.testMode}
                  on:click={() => openSchedule(schedule)}
                  ><Icon name="edit" size={18} /></button
                ><button
                  class="icon-button"
                  aria-label={`Delete ${schedule.name}`}
                  disabled={active && !state.settings.testMode}
                  on:click={() =>
                    change(
                      (s) =>
                        (s.schedules = s.schedules.filter(
                          (x) => x.id !== schedule.id,
                        )),
                      'Schedule removed. Ctrl+Z to undo.',
                    )}><Icon name="trash" size={18} /></button
                >
              </div>
            </article>{:else}<div class="large-empty-state">
              <div class="empty-illustration">
                <Icon name="clock" size={45} /><span>✦</span>
              </div>
              <span class="eyebrow">A HABIT STARTS HERE</span>
              <h2>Make space. Every day.</h2>
              <p>
                A quiet morning. A distraction-free afternoon.<br />Choose when
                the noise fades into the background.
              </p>
              <button class="primary-button" on:click={() => openSchedule()}
                ><Icon name="plus" size={17} />Create your first schedule</button
              ><span class="empty-note"
                >Daily or weekly · Multiple categories · Overnight support</span
              >
            </div>{/each}
        </div>
      {:else if route === 'protection'}
        <div class="page-heading">
          <div>
            <div class="eyebrow">A PROMISE TO YOUR FUTURE SELF</div>
            <h1>A pause before the scroll<span class="accent-text">.</span></h1>
            <p>Give your intentions a little backup.</p>
          </div>
          <span class="subtle-badge"
            ><Icon name="shield" size={15} />Unlock protection</span
          >
        </div>
        <div class="category-policy-picker">
          <label class="field-label" for="protection-category">Category</label
          ><select
            id="protection-category"
            class="select-input"
            bind:value={policyCategoryId}
            >{#each state.categories as c}<option value={c.id}>{c.name}</option
              >{/each}</select
          ><span class="field-hint"
            >Used only by this category’s timers, individual websites, and
            schedules.</span
          >
        </div>
        {#if policyLocked}<div class="info-banner">
            <Icon name="lock" size={21} />
            <div>
              <strong>This category’s boundaries are protected.</strong>
              <p>
                This category’s protection can be changed after its active
                timers and schedules finish.
              </p>
            </div>
          </div>{/if}
        <div class="settings-layout">
          <div class="settings-panels">
            <section class="settings-card">
              <div class="settings-card-heading">
                <span class="setting-icon"><Icon name="edit" size={21} /></span>
                <div>
                  <h3>Type with intention</h3>
                  <p>A reminder of why you started.</p>
                </div>
                <button
                  class="toggle"
                  class:on={selectedPolicy.protection.phraseEnabled}
                  disabled={policyLocked}
                  role="switch"
                  aria-checked={selectedPolicy.protection.phraseEnabled}
                  aria-label="Require an unlock phrase"
                  on:click={() =>
                    change(
                      (s) =>
                        (s.categories.find(
                          (c) => c.id === policyCategoryId,
                        )!.policy!.protection.phraseEnabled =
                          !s.categories.find((c) => c.id === policyCategoryId)!
                            .policy!.protection.phraseEnabled),
                    )}><span></span></button
                >
              </div>
              <label class="field-label" for="unlock-phrase-setting"
                >Your unlock phrase</label
              ><input
                id="unlock-phrase-setting"
                class="text-input"
                value={selectedPolicy.protection.phrase}
                maxlength="250"
                disabled={policyLocked ||
                  !selectedPolicy.protection.phraseEnabled}
                on:change={(e) => {
                  const phrase = e.currentTarget.value.trim();
                  if (phrase)
                    change(
                      (s) =>
                        (s.categories.find(
                          (c) => c.id === policyCategoryId,
                        )!.policy!.protection.phrase = phrase),
                    );
                  else {
                    e.currentTarget.value = selectedPolicy.protection.phrase;
                    notify('The unlock phrase cannot be empty.');
                  }
                }}
              />
              <p class="field-hint">
                You’ll need to type this exactly before ending a session early.
              </p>
            </section>
            <section class="settings-card">
              <div class="settings-card-heading">
                <span class="setting-icon"
                  ><Icon name="layers" size={21} /></span
                >
                <div>
                  <h3>A few moments to reflect</h3>
                  <p>Small steps that interrupt the impulse.</p>
                </div>
              </div>
              <div class="setting-inline">
                <div>
                  <strong>Reflection steps</strong>
                  <p>How many confirmations before you can unlock?</p>
                </div>
                <div class="stepper">
                  <button
                    disabled={policyLocked ||
                      selectedPolicy.protection.steps <= 0}
                    on:click={() =>
                      change(
                        (s) =>
                          s.categories.find((c) => c.id === policyCategoryId)!
                            .policy!.protection.steps--,
                      )}
                    aria-label="Fewer unlock steps">−</button
                  ><span>{selectedPolicy.protection.steps}</span><button
                    disabled={policyLocked ||
                      selectedPolicy.protection.steps >= 10}
                    on:click={() =>
                      change(
                        (s) =>
                          s.categories.find((c) => c.id === policyCategoryId)!
                            .policy!.protection.steps++,
                      )}
                    aria-label="More unlock steps">+</button
                  >
                </div>
              </div>
            </section>
            <section class="settings-card">
              <div class="settings-card-heading">
                <span class="setting-icon"><Icon name="timer" size={21} /></span
                >
                <div>
                  <h3>Let the impulse pass</h3>
                  <p>Sometimes a little waiting changes everything.</p>
                </div>
              </div>
              <div class="setting-inline">
                <div>
                  <strong>Waiting period</strong>
                  <p>A mandatory pause before unlock steps begin.</p>
                </div>
                <select
                  class="select-input"
                  aria-label="Unlock waiting period"
                  value={selectedPolicy.protection.waitMinutes}
                  disabled={policyLocked}
                  on:change={(e) =>
                    change(
                      (s) =>
                        (s.categories.find(
                          (c) => c.id === policyCategoryId,
                        )!.policy!.protection.waitMinutes = Number(
                          e.currentTarget.value,
                        )),
                    )}
                  >{#each [0, 1, 2, 5, 10, 15, 30] as minutes}<option
                      value={minutes}
                      >{minutes === 0
                        ? 'No waiting'
                        : `${minutes} minute${minutes > 1 ? 's' : ''}`}</option
                    >{/each}</select
                >
              </div>
            </section>
          </div>
          <aside class="protection-preview">
            <div class="protection-orb"><Icon name="shield" size={37} /></div>
            <span class="eyebrow">YOUR UNLOCK JOURNEY</span>
            <h3>Intentional by design.</h3>
            <div class="journey-step">
              <span>1</span>
              <div>
                <strong>A little breathing room</strong><small
                  >{selectedPolicy.protection.waitMinutes
                    ? `${selectedPolicy.protection.waitMinutes} minute waiting period`
                    : 'No waiting period'}</small
                >
              </div>
            </div>
            <div class="journey-step">
              <span>2</span>
              <div>
                <strong>A moment to reconsider</strong><small
                  >{selectedPolicy.protection.steps} reflection steps</small
                >
              </div>
            </div>
            <div class="journey-step">
              <span>3</span>
              <div>
                <strong>A conscious choice</strong><small
                  >{selectedPolicy.protection.phraseEnabled
                    ? 'Type your personal unlock phrase'
                    : 'Confirm you want to end the session'}</small
                >
              </div>
            </div>
            <p>
              You can always wait for a session to finish naturally. No steps
              needed.
            </p>
          </aside>
        </div>
      {:else if route === 'settings'}
        <div class="page-heading">
          <div>
            <div class="eyebrow">MAKE YOURSELF AT HOME</div>
            <h1>Your space, your way<span class="accent-text">.</span></h1>
            <p>A few little things that make LockIN feel like you.</p>
          </div>
        </div>
        <div class="settings-tabs">
          <button
            class:active={settingsTab === 'appearance'}
            on:click={() => (settingsTab = 'appearance')}
            ><Icon name="sun" size={17} />Appearance</button
          ><button
            class:active={settingsTab === 'general'}
            on:click={() => (settingsTab = 'general')}
            ><Icon name="settings" size={17} />General & connection</button
          ><button
            class:active={settingsTab === 'filters'}
            on:click={() => (settingsTab = 'filters')}
            ><Icon name="shield" size={17} />Filtering & protection</button
          >
        </div>
        {#if settingsTab === 'appearance'}<div
            class="settings-card appearance-card"
          >
            <h3>A change of atmosphere</h3>
            <p class="muted">Choose the light that feels right.</p>
            <div class="theme-options">
              {#each [{ id: 'light', name: 'Daylight', icon: 'sun' }, { id: 'dark', name: 'After hours', icon: 'moon' }, { id: 'system', name: 'With your system', icon: 'monitor' }] as theme}<button
                  class:chosen={state.settings.theme === theme.id}
                  on:click={() =>
                    change(
                      (s) =>
                        (s.settings.theme = theme.id as
                          'light' | 'dark' | 'system'),
                      'Appearance updated',
                      false,
                    )}
                  ><div
                    class="theme-preview"
                    class:preview-light={theme.id === 'light'}
                    class:preview-system={theme.id === 'system'}
                  >
                    <div class="preview-sidebar"><i></i><i></i><i></i></div>
                    <div class="preview-content">
                      <i></i><b></b>
                      <div><i></i><i></i><i></i></div>
                    </div>
                  </div>
                  <div class="theme-label">
                    <Icon name={theme.icon} size={17} /><span>{theme.name}</span
                    ><span class="radio-dot"
                      >{#if state.settings.theme === theme.id}<Icon
                          name="check"
                          size={10}
                        />{/if}</span
                    >
                  </div></button
                >{/each}
            </div>
            <div class="settings-divider"></div>
            <div class="setting-inline">
              <div>
                <h3>Your signature color</h3>
                <p class="muted">A small splash of personality.</p>
              </div>
              <div class="accent-options">
                {#each savedColors as accent}<button
                    style={`--swatch:${accent}`}
                    class:chosen={state.settings.accent === accent}
                    aria-label={`Accent color ${accent}`}
                    on:click={() => {
                      customAccent = null;
                      change(
                        (s) => (s.settings.accent = accent),
                        'A fresh little touch',
                        false,
                      );
                    }}
                    >{#if state.settings.accent === accent}<Icon
                        name="check"
                        size={19}
                      />{/if}</button
                  >{/each}<label
                  class="custom-color"
                  title="Choose a custom accent"
                  ><Icon name="plus" size={19} /><input
                    type="color"
                    aria-label="Custom accent color"
                    value={customAccent || state.settings.accent}
                    on:input={(e) => (customAccent = e.currentTarget.value)}
                    on:change={(e) => (customAccent = e.currentTarget.value)}
                  /></label
                >
              </div>
            </div>
            {#if customAccent !== null}<div class="custom-accent-editor">
                <div>
                  <strong>Preview your color</strong>
                  <p>Save it to keep this accent in your palette.</p>
                </div>
                <input
                  class="text-input mono"
                  aria-label="Custom accent hex"
                  maxlength="7"
                  bind:value={customAccent}
                /><button
                  class="secondary-button"
                  on:click={() => (customAccent = null)}>Cancel</button
                ><button class="primary-button" on:click={saveCustomAccent}
                  >Save accent<Icon name="check" size={15} /></button
                >
              </div>{/if}
            <div class="settings-divider"></div>
            <div class="setting-inline">
              <div>
                <h3>Website icons</h3>
                <p class="muted">
                  Choose brand SVG logos or a custom icon for each website.
                </p>
              </div>
              <select
                class="select-input"
                aria-label="Website icon style"
                value={state.settings.websiteIcons}
                on:change={(e) =>
                  change(
                    (s) =>
                      (s.settings.websiteIcons = e.currentTarget.value as
                        'svg' | 'custom'),
                    'Website icons updated',
                    false,
                  )}
                ><option value="svg">Brand SVG logos</option><option
                  value="custom">Custom icons</option
                ></select
              >
            </div>
          </div>{:else if settingsTab === 'filters'}<FilteringSettings
            {state}
            {protectedNow}
            desktop={storage.desktop}
            {guard}
            {now}
            {change}
            setup={() => {
              formError = '';
              modal = 'guard-setup';
            }}
          />{:else}<div class="settings-panels">
            <section class="settings-card">
              <div class="settings-card-heading">
                <span class="setting-icon"><Icon name="timer" size={21} /></span
                >
                <div>
                  <h3>Your go-to durations</h3>
                  <p>Most-used times move to the front automatically.</p>
                </div>
              </div>
              <div class="saved-duration-tags">
                {#each durationTags as min}<span
                    ><button
                      on:click={() => {
                        duration = min;
                        customDuration = String(min);
                        showDashboard(categoryFilter);
                      }}>{min} min</button
                    ><button
                      class="remove-duration"
                      aria-label={`Remove ${min} minute preset`}
                      disabled={durationTags.length === 1}
                      on:click={() =>
                        change(
                          (s) =>
                            (s.settings.durationPresets =
                              s.settings.durationPresets.filter(
                                (n) => n !== min,
                              )),
                          'Duration removed',
                          false,
                        )}><Icon name="x" size={12} /></button
                    ><small
                      >{state.settings.durationUsage[String(min)] || 0} uses</small
                    ></span
                  >{/each}
              </div>
              <div class="add-duration-field">
                <input
                  class="text-input"
                  type="number"
                  min="1"
                  max="1440"
                  aria-label="New duration in minutes"
                  bind:value={presetInput}
                /><span>minutes</span><button
                  class="secondary-button"
                  on:click={() => saveDuration(Number(presetInput))}
                  ><Icon name="plus" size={15} />Save time</button
                >
              </div>
            </section>
            <section class="settings-card">
              <div class="setting-inline">
                <div>
                  <h3>Focus in your system tray</h3>
                  <p class="muted">
                    Close the window to keep LockIN running. Click its tray icon
                    to return.
                  </p>
                </div>
                <Icon name="timer" size={23} />
              </div>
              <p class="field-hint">
                {storage.desktop
                  ? runtime.tooltip ||
                    'The tray shows a live countdown in its icon, tooltip, and menu.'
                  : 'Open the Windows desktop app to use the tray and application guard.'}
              </p>
            </section>
            <section class="settings-card">
              <div class="settings-card-heading">
                <span class="setting-icon"
                  ><Icon name="coffee" size={21} /></span
                >
                <div>
                  <h3>A little test drive</h3>
                  <p>Try your setup without the unlock routine.</p>
                </div>
                <button
                  class="toggle"
                  class:on={state.settings.testMode}
                  disabled={sessions.some((s) => !s.testMode) ||
                    (!state.settings.testMode &&
                      activeSchedules.some((s) =>
                        s.categoryIds.some(
                          (id) => categoryPolicy(state, id).strictNetworkGuard,
                        ),
                      ))}
                  role="switch"
                  aria-checked={state.settings.testMode}
                  aria-label="Enable test mode"
                  on:click={() =>
                    change(
                      (s) => (s.settings.testMode = !s.settings.testMode),
                      'Test mode updated',
                    )}><span></span></button
                >
              </div>
              <p class="field-hint">
                Test sessions block websites normally, but can be ended
                immediately. Active schedules can also be edited, paused, or
                deleted while test mode is on.
              </p>
            </section>
            <section class="settings-card">
              <div class="settings-card-heading">
                <span class="setting-icon"><Icon name="link" size={21} /></span>
                <div>
                  <h3>Your browser, connected</h3>
                  <p>
                    {bridgeConnected
                      ? 'The extension is listening to your desktop app.'
                      : 'The desktop app decides. The extension follows.'}
                  </p>
                </div>
                <span class="connection-label" class:connected={bridgeConnected}
                  ><span class="status-dot" class:connected={bridgeConnected}
                  ></span>{bridgeConnected
                    ? 'Connected'
                    : 'Not connected'}</span
                >
              </div>
              <button
                class="secondary-button"
                on:click={() => {
                  modal = 'extension';
                  formError = '';
                }}>Connect Chrome<Icon name="up" size={16} /></button
              >
            </section>
            <section class="settings-card">
              <div class="setting-inline">
                <div>
                  <h3>Language</h3>
                  <p class="muted">A familiar experience, wherever you are.</p>
                </div>
                <span class="subtle-badge">English</span>
              </div>
            </section>
            <section class="settings-card">
              <div class="setting-inline">
                <div>
                  <h3>Built for your peace of mind</h3>
                  <p class="muted">LockIN 1.3.1 · Svelte + Tauri + Rust</p>
                </div>
                <Icon name="shield" size={23} />
              </div>
              <p class="field-hint">
                Everything is stored locally. No accounts, analytics, or cloud
                sync.
              </p>
            </section>
          </div>{/if}
      {/if}
    </main>
  </div>
  {#if toast}<div
      class="toast"
      role="status"
      transition:fly={{ y: 12, duration: 180 }}
    >
      <span class="toast-icon"><Icon name="check" size={16} /></span
      >{toast}<button
        class="icon-button small"
        aria-label="Dismiss notification"
        on:click={() => (toast = '')}><Icon name="x" size={15} /></button
      >
    </div>{/if}

  {#if modal}<div
      class="modal-backdrop"
      role="presentation"
      on:click={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
      transition:fade={{ duration: 130 }}
    >
      <div
        class="modal"
        use:focusDialog
        class:wide-modal={modal === 'extension' || modal === 'help'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabindex="-1"
        transition:fly={{ y: 15, duration: 180 }}
      >
        <button
          class="modal-close icon-button"
          aria-label="Close dialog"
          on:click={closeModal}><Icon name="x" size={20} /></button
        >
        {#if modal === 'timer' && timerTarget}
          <div class="modal-heading-icon"><Icon name="timer" size={25} /></div>
          <h2 id="modal-title">Quiet time for {timerTarget.label}.</h2>
          <p class="modal-description">
            {timerTarget.kind === 'category'
              ? 'All websites and applications in this category will be blocked, including anything added while its timer is running.'
              : 'Only this target will be blocked. Other timers keep their own deadlines.'}
          </p>
          <div class="duration-options">
            {#each durationTags as minutes}<button
                class:chosen={duration === minutes}
                on:click={() => {
                  duration = minutes;
                  customDuration = String(minutes);
                }}>{minutes} min</button
              >{/each}
          </div>
          <label class="field-label" for="target-duration"
            >Duration in minutes</label
          ><input
            id="target-duration"
            class="text-input"
            type="number"
            min="1"
            max="1440"
            step="1"
            bind:value={duration}
          />
          <p class="field-hint">
            This duration is remembered for this target. Its category’s
            filtering and protection apply only while locked.
          </p>
          {#if sessions.some( (s) => (timerTarget!.kind === 'category' ? s.categoryIds?.includes(timerTarget!.id) : !s.categoryIds?.length && (s.siteIds.includes(timerTarget!.id) || s.appIds?.includes(timerTarget!.id))) )}<div
              class="info-banner"
            >
              <Icon name="lock" size={18} /><span
                >This target already has a timer. Manage it in Active timers.</span
              >
            </div>{:else}<button
              class="primary-button full-width"
              disabled={busy}
              on:click={() => startFocus()}
              ><Icon name="power" size={17} />Start timer</button
            >{/if}
        {:else if modal === 'schedule-start' && pendingSchedule}
          <div class="modal-heading-icon"><Icon name="clock" size={25} /></div>
          <h2 id="modal-title">Your focus hours are already here.</h2>
          <p class="modal-description">
            <strong>{pendingSchedule.name}</strong> includes the current time. Start
            this occurrence now, or let it begin next time?
          </p>
          <div class="schedule-activation-summary">
            <strong>{pendingSchedule.start} — {pendingSchedule.end}</strong>
            <p>
              {state.categories
                .filter((c) => pendingSchedule!.categoryIds.includes(c.id))
                .map((c) => c.name)
                .join(' · ')}
            </p>
            <span
              >All websites and applications in these categories are included.</span
            >{#if state.apps.some( (a) => pendingSchedule!.categoryIds.includes(a.categoryId) )}<p
                class="activation-warning"
              >
                Apps in these categories will be closed. Save your work before
                accepting.
              </p>{/if}
          </div>
          <div class="activation-actions">
            <button class="secondary-button" on:click={closeModal}>Close</button
            ><button
              class="secondary-button"
              disabled={busy}
              on:click={() => decideSchedule(true)}>Next time</button
            ><button
              class="primary-button"
              disabled={busy}
              on:click={() => decideSchedule(false)}
              >Accept<Icon name="check" size={15} /></button
            >
          </div>
          <p class="field-hint">
            Close discards these changes. Next time saves the schedule and skips
            only the current occurrence.
          </p>
        {:else if modal === 'start-apps'}
          <div class="modal-heading-icon">
            <Icon name="monitor" size={25} />
          </div>
          <h2 id="modal-title">Ready to give these apps a pause?</h2>
          <p class="modal-description">
            These apps will be closed for the next {duration} minutes, including new
            launch attempts. Save any work in them before continuing.
          </p>
          <div class="apps-confirm-list">
            {#each pendingApps as app}<span
                ><Icon name="monitor" size={16} />{app.name}</span
              >{/each}
          </div>
          <p class="field-hint">
            All websites in the chosen category are included too. LockIN keeps
            running in your tray.
          </p>
          <div class="modal-actions">
            <button class="secondary-button" on:click={closeModal}
              >Cancel</button
            ><button
              class="primary-button"
              disabled={busy}
              on:click={() => startFocus(true)}
              >Start Lights Out<Icon name="power" size={16} /></button
            >
          </div>
        {:else if modal === 'application'}
          <div class="modal-heading-icon">
            <Icon name="monitor" size={24} />
          </div>
          <h2 id="modal-title">
            {editingId
              ? 'Fine-tune this application.'
              : 'One less app to reach for.'}
          </h2>
          <p class="modal-description">
            Choose a Windows application to include in Lights Out.
          </p>
          <form on:submit={submitApplication}>
            <label class="field-label" for="application-path"
              >Application executable</label
            >
            <div class="application-path-input">
              <input
                id="application-path"
                class="text-input mono"
                placeholder="C:\Apps\MyApp\MyApp.exe"
                bind:value={appPath}
                required
              /><button
                type="button"
                class="secondary-button"
                disabled={!storage.desktop}
                on:click={browseApplication}
                >Browse<Icon name="folder" size={16} /></button
              >
            </div>
            <p class="field-hint">
              Select the app’s actual .exe file. Windows system executables and
              LockIN are excluded.
            </p>
            <label class="field-label" for="application-name"
              >Display name</label
            ><input
              id="application-name"
              class="text-input"
              placeholder="e.g. Discord"
              bind:value={appName}
              maxlength="60"
            /><label class="field-label" for="application-category"
              >Make it part of</label
            ><select
              id="application-category"
              class="text-input"
              bind:value={appCategory}
              >{#each state.categories as c}<option value={c.id}
                  >{c.name}</option
                >{/each}</select
            >{#if !storage.desktop}<p class="field-hint">
                Browser preview saves your list. Launch the desktop app to
                enforce application blocking.
              </p>{/if}{#if formError}<p class="form-error" role="alert">
                {formError}
              </p>{/if}
            <div class="modal-actions">
              <button
                type="button"
                class="secondary-button"
                on:click={closeModal}>Cancel</button
              ><button type="submit" class="primary-button" disabled={busy}
                >Save application<Icon name="check" size={16} /></button
              >
            </div>
          </form>
        {:else if modal === 'site'}<div class="modal-heading-icon">
            <Icon name="plus" size={24} />
          </div>
          <h2 id="modal-title">
            {editingId ? 'A little adjustment.' : 'One less distraction.'}
          </h2>
          <p class="modal-description">
            {editingId
              ? 'Make this website feel at home.'
              : 'Add a website you’d like a little space from.'}
          </p>
          <form on:submit={submitSite}>
            <label class="field-label" for="site-domain"
              >Website address <span>*</span></label
            ><input
              class="text-input"
              id="site-domain"
              placeholder="e.g. youtube.com"
              bind:value={siteDomain}
              required
              maxlength="2048"
            />
            <p class="field-hint">
              The domain and all its subdomains will be included.
            </p>
            <label class="field-label" for="site-name"
              >Display name <span class="optional">optional</span></label
            ><input
              class="text-input"
              id="site-name"
              placeholder="e.g. YouTube"
              bind:value={siteName}
              maxlength="60"
            /><label class="field-label" for="site-category"
              >Make it part of</label
            ><select
              class="text-input"
              id="site-category"
              bind:value={siteCategory}
              >{#each state.categories as c}<option value={c.id}
                  >{c.name}</option
                >{/each}</select
            ><label class="field-label" for="site-custom-icon"
              >Custom website icon</label
            ><select
              class="text-input"
              id="site-custom-icon"
              bind:value={siteCustomIcon}
              >{#each categoryIcons as icon}<option value={icon}
                  >{icon[0].toUpperCase() + icon.slice(1)}</option
                >{/each}</select
            >
            <p class="field-hint">
              Used when Appearance → Website icons is set to Custom icons.
            </p>
            {#if formError}<p class="form-error" role="alert">
                {formError}
              </p>{/if}
            <div class="modal-actions">
              <button
                class="secondary-button"
                type="button"
                on:click={closeModal}>Cancel</button
              ><button class="primary-button" type="submit" disabled={busy}
                ><Icon
                  name={editingId ? 'check' : 'plus'}
                  size={17}
                />{editingId ? 'Save changes' : 'Add website'}</button
              >
            </div>
          </form>
        {:else if modal === 'category'}<div
            class="modal-heading-icon"
            style={`color:${categoryColor}`}
          >
            <Icon name={categoryIcon} size={24} />
          </div>
          <h2 id="modal-title">
            {editingId
              ? 'Fine-tune your category.'
              : 'Everything in its place.'}
          </h2>
          <p class="modal-description">
            Group your distractions. Find your calm.
          </p>
          <form on:submit={submitCategory}>
            <label class="field-label" for="category-name">Category name</label
            ><input
              class="text-input"
              id="category-name"
              placeholder="e.g. News & rabbit holes"
              bind:value={categoryName}
              maxlength="40"
              required
            />
            <div class="field-label">Pick a color</div>
            <div class="accent-options modal-swatches">
              {#each [...new Set( [...categoryColors, ...state.settings.savedAccents] )] as color}<button
                  type="button"
                  style={`--swatch:${color}`}
                  class:chosen={categoryColor === color}
                  aria-label={`Category color ${color}`}
                  on:click={() => (categoryColor = color)}
                  >{#if categoryColor === color}<Icon
                      name="check"
                      size={18}
                    />{/if}</button
                >{/each}
            </div>
            <div class="field-label">And a little personality</div>
            <div class="category-custom-color">
              <label class="custom-color" title="Custom category color"
                ><Icon name="plus" size={17} /><input
                  type="color"
                  aria-label="Custom category color"
                  bind:value={categoryColor}
                /></label
              ><input
                class="text-input mono"
                aria-label="Category color hex"
                maxlength="7"
                bind:value={categoryColor}
              /><span>Any color you like.</span>
            </div>
            <input
              class="text-input icon-search-input"
              aria-label="Search category icons"
              placeholder="Find an icon..."
              bind:value={iconSearch}
            />
            <div class="icon-options">
              {#each filteredCategoryIcons as icon}<button
                  type="button"
                  class:chosen={categoryIcon === icon}
                  aria-label={`${icon} category icon`}
                  on:click={() => (categoryIcon = icon)}
                  ><Icon name={icon} size={21} /></button
                >{/each}
            </div>
            {#if formError}<p class="form-error" role="alert">
                {formError}
              </p>{/if}
            <div class="modal-actions">
              {#if editingId}<button
                  class="text-button danger-text"
                  type="button"
                  on:click={deleteCategory}
                  ><Icon name="trash" size={16} />Delete</button
                >{:else}<button
                  class="secondary-button"
                  type="button"
                  on:click={closeModal}>Cancel</button
                >{/if}<button
                class="primary-button"
                type="submit"
                disabled={busy}
                >{editingId ? 'Save category' : 'Create category'}<Icon
                  name="right"
                  size={16}
                /></button
              >
            </div>
          </form>
        {:else if modal === 'schedule'}<div class="modal-heading-icon">
            <Icon name="clock" size={24} />
          </div>
          <h2 id="modal-title">Give focus a time slot.</h2>
          <p class="modal-description">
            A small appointment with what matters.
          </p>
          <form on:submit={submitSchedule}>
            <label class="field-label" for="schedule-name">Schedule name</label
            ><input
              class="text-input"
              id="schedule-name"
              placeholder="e.g. Morning deep work"
              bind:value={scheduleName}
              maxlength="60"
            />
            <div class="form-columns">
              <div>
                <label class="field-label" for="schedule-start"
                  >Lights out at</label
                ><input
                  class="text-input"
                  id="schedule-start"
                  type="time"
                  bind:value={scheduleStart}
                  required
                />
              </div>
              <div>
                <label class="field-label" for="schedule-end"
                  >Lights back at</label
                ><input
                  class="text-input"
                  id="schedule-end"
                  type="time"
                  bind:value={scheduleEnd}
                  required
                />
              </div>
            </div>
            {#if scheduleStart > scheduleEnd}<p class="field-hint">
                The end time falls on the following day.
              </p>{/if}
            <div class="field-label">Make it a habit</div>
            <div class="day-picker">
              {#each [{ l: 'M', d: 1 }, { l: 'T', d: 2 }, { l: 'W', d: 3 }, { l: 'T', d: 4 }, { l: 'F', d: 5 }, { l: 'S', d: 6 }, { l: 'S', d: 0 }] as day}<button
                  class:chosen={scheduleDays.includes(day.d)}
                  aria-label={[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ][day.d]}
                  aria-pressed={scheduleDays.includes(day.d)}
                  type="button"
                  on:click={() =>
                    (scheduleDays = scheduleDays.includes(day.d)
                      ? scheduleDays.filter((d) => d !== day.d)
                      : [...scheduleDays, day.d])}>{day.l}</button
                >{/each}
            </div>
            <div class="field-label">Put these categories on pause</div>
            <div class="schedule-category-picker">
              {#each state.categories as category}<button
                  type="button"
                  class:chosen={scheduleCategories.includes(category.id)}
                  on:click={() =>
                    (scheduleCategories = scheduleCategories.includes(
                      category.id,
                    )
                      ? scheduleCategories.filter((id) => id !== category.id)
                      : [...scheduleCategories, category.id])}
                  ><span
                    class="category-dot"
                    style={`background:${category.color}`}
                  ></span>{category.name}<span class="checkbox"
                    >{#if scheduleCategories.includes(category.id)}<Icon
                        name="check"
                        size={13}
                      />{/if}</span
                  ></button
                >{/each}
            </div>
            <p class="field-hint">
              <Icon name="lock" size={12} />Once active, a schedule cannot be
              ended early. Times follow this device’s local timezone.
            </p>
            {#if formError}<p class="form-error" role="alert">
                {formError}
              </p>{/if}
            <div class="modal-actions">
              <button
                class="secondary-button"
                type="button"
                on:click={closeModal}>Cancel</button
              ><button class="primary-button" disabled={busy} type="submit"
                >{editingId ? 'Save changes' : 'Create schedule'}<Icon
                  name="right"
                  size={16}
                /></button
              >
            </div>
          </form>
        {:else if modal === 'unlock'}<div class="modal-heading-icon">
            <Icon name="shield" size={25} />
          </div>
          <h2 id="modal-title">A moment of intention.</h2>
          <p class="modal-description">
            Unlock {session?.label || 'this timer'}. Other timers and schedules
            remain active.
          </p>
          {#if !session}<p class="modal-description">
              Your session has finished. You’re all set.
            </p>
            <button class="primary-button full-width" on:click={closeModal}
              >Back to my space</button
            >{:else if session.testMode}<p class="modal-description">
              This is a test session. Skip the steps and bring the lights back
              on.
            </p>
            <button
              class="primary-button full-width"
              on:click={endFocus}
              disabled={busy}
              >End test session<Icon name="power" size={17} /></button
            >{:else if unlockProgress && now < unlockProgress.readyAt}<p
              class="modal-description"
            >
              The urge can wait. Give yourself a little breathing room before
              deciding.
            </p>
            <div class="unlock-wait">
              <div class="waiting-ring"><Icon name="coffee" size={34} /></div>
              <strong>{formatTime(unlockProgress.readyAt - now)}</strong><span
                >A little patience. A clearer choice.</span
              >
            </div>
            <button class="secondary-button full-width" on:click={closeModal}
              >Actually, I’ll keep focusing<Icon
                name="right"
                size={17}
              /></button
            >{:else if unlockProgress && unlockProgress.step < unlockProgress.total}<p
              class="modal-description"
            >
              Step {unlockProgress.step + 1} of {unlockProgress.total}. Take a
              breath and ask yourself:
            </p>
            <div class="reflection-card">
              <Icon name="sparkles" size={26} />
              <h3>
                {[
                  'Is this what I want to spend my time on?',
                  'Can this wait until my focus time is over?',
                  'What was I hoping to finish today?',
                  'Will this choice bring me closer to my goals?',
                  'Am I acting with intention, or on impulse?',
                ][unlockProgress.step % 5]}
              </h3>
              <p>There’s no rush. Your focus is still protected.</p>
            </div>
            <div class="modal-actions">
              <button class="secondary-button" on:click={closeModal}
                >Keep focusing</button
              ><button
                class="primary-button"
                disabled={busy}
                on:click={nextUnlockStep}
                >I’ve thought about it<Icon name="right" size={16} /></button
              >
            </div>{:else}<p class="modal-description">
              {session.protection.phraseEnabled
                ? 'One last conscious choice. Type the phrase below exactly.'
                : 'Your focus time is still running. Are you ready to end it?'}
            </p>
            {#if session.protection.phraseEnabled}<div class="phrase-to-type">
                {session.protection.phrase}
              </div>
              <textarea
                class="text-input"
                aria-label="Type your unlock phrase"
                placeholder="Type your phrase here..."
                rows="3"
                bind:value={unlockPhrase}
                on:paste|preventDefault
                on:drop|preventDefault></textarea>{/if}
            <div class="modal-actions">
              <button class="secondary-button" on:click={closeModal}
                >Keep focusing</button
              ><button
                class="primary-button"
                disabled={busy ||
                  (session.protection.phraseEnabled &&
                    unlockPhrase !== session.protection.phrase)}
                on:click={endFocus}
                >End session<Icon name="power" size={16} /></button
              >
            </div>{/if}{#if formError}<p class="form-error" role="alert">
              {formError}
            </p>{/if}
        {:else if modal === 'extension'}<div class="modal-heading-icon">
            <Icon name="link" size={25} />
          </div>
          <h2 id="modal-title">Meet your quiet companion.</h2>
          <p class="modal-description">
            LockIN is the control room. The Chrome extension puts your
            boundaries into action.
          </p>
          <div class="connection-callout">
            <span class="status-dot" class:connected={bridgeConnected}
            ></span><strong
              >{bridgeConnected
                ? 'Your browser is connected'
                : 'Let’s connect your browser'}</strong
            ><span>{storage.desktop ? 'Desktop app' : 'Browser preview'}</span>
          </div>
          <ol class="setup-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Load the Chrome extension</strong>
                <p>
                  Open <code>chrome://extensions</code>, enable
                  <b>Developer mode</b>, choose <b>Load unpacked</b>, and select
                  this project’s <code>extension</code> folder.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Copy the extension ID</strong>
                <p>
                  Find the 32-letter ID beneath LockIN in your extensions list.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Pair with the desktop app</strong>
                <p>
                  Paste that ID below. Pairing registers a local native
                  messaging connection for Chrome and Edge.
                </p>
              </div>
            </li>
          </ol>
          <div class="managed-extension">
            {#if bridgeError}<div class="info-banner" role="status">
                <Icon name="link" size={18} /><span>{bridgeError}</span>
              </div>{/if}
            <strong>One setup. Easier updates.</strong>
            <p>
              Prepare the companion below, then load this managed folder once
              through Chrome’s “Load unpacked”. Future versions update from here
              and reload automatically.
            </p>
            <div>
              <button
                class="secondary-button"
                disabled={!storage.desktop ||
                  sessions.some((s) => s.strictNetworkGuard && !s.testMode) ||
                  (!state.settings.testMode &&
                    activeSchedules.some((s) =>
                      s.categoryIds.some(
                        (id) => categoryPolicy(state, id).strictNetworkGuard,
                      ),
                    ))}
                on:click={updateCompanion}
                ><Icon name="download" size={15} />Prepare / update companion</button
              ><button
                class="text-button"
                disabled={!storage.desktop}
                on:click={() =>
                  storage.openExtensionFolder().catch((e) => notify(String(e)))}
                >Open folder<Icon name="up" size={14} /></button
              >
            </div>
            {#if extensionBundle}<code>{extensionBundle.path}</code>{/if}<small
              >Quick add: Alt + Shift + L in Chrome, then choose a category.</small
            >
          </div>
          <label class="field-label" for="extension-id"
            >Chrome extension ID</label
          ><input
            class="text-input mono"
            id="extension-id"
            placeholder="abcdefghijklmnopqrstuvwxyzabcdef"
            bind:value={extensionId}
            maxlength="32"
          />{#if !storage.desktop}<div class="preview-notice">
              <Icon name="monitor" size={17} /><span
                >You’re viewing the browser preview. Launch the desktop app with <code
                  >npm run tauri dev</code
                > to pair your extension and enable real network blocking.</span
              >
            </div>{/if}{#if formError}<p class="form-error" role="alert">
              {formError}
            </p>{/if}
          <div class="modal-actions">
            <button class="secondary-button" on:click={closeModal}
              >Maybe later</button
            ><button
              class="primary-button"
              disabled={!storage.desktop || busy}
              on:click={connectExtension}
              ><Icon name="link" size={17} />Connect extension</button
            >
          </div>
          <p class="field-hint">
            Blocks network requests in connected Chrome profiles, including
            subdomains. Other browsers and apps keep their connection.
          </p>
        {:else if modal === 'strict-lock'}<div class="modal-heading-icon">
            <Icon name="shield" size={25} />
          </div>
          <h2 id="modal-title">This time is already yours.</h2>
          <p class="modal-description">
            Strict network protection keeps this session running until its timer
            ends. Early unlock is unavailable.
          </p>
          <div class="unlock-wait">
            <strong>{formatTime(remaining)}</strong><span
              >Your strict session’s remaining time</span
            >
          </div>
          <button class="primary-button full-width" on:click={closeModal}
            >Keep focusing<Icon name="right" size={16} /></button
          >
        {:else if modal === 'guard-setup'}<div class="modal-heading-icon">
            <Icon name="shield" size={25} />
          </div>
          <h2 id="modal-title">A boundary that survives the browser.</h2>
          <p class="modal-description">
            Install a separate Windows service with administrator permission. It
            can block all outgoing network traffic if your extension stops
            responding during strict Lights Out.
          </p>
          <div class="schedule-activation-summary">
            <strong>Until your timer ends.</strong>
            <p>
              Once a strict network block is triggered, reconnecting the
              extension or closing LockIN does not end it. Strict sessions
              cannot be ended early. Save your work before using it.
            </p>
            <span
              >Setup alone does not block traffic. Turn on Strict network
              protection after the service reports ready.</span
            >
          </div>
          {#if formError}<p class="form-error">{formError}</p>{/if}
          <div class="modal-actions">
            <button class="secondary-button" on:click={closeModal}
              >Cancel</button
            ><button class="primary-button" on:click={setupGuard}
              ><Icon name="shield" size={16} />Install with administrator
              permission</button
            >
          </div>
        {:else if modal === 'help'}<div class="modal-heading-icon">
            <Icon name="sparkles" size={25} />
          </div>
          <h2 id="modal-title">A little less noise.</h2>
          <p class="modal-description">
            Your quick guide to a quieter corner of the internet.
          </p>
          <div class="help-items">
            <div>
              <Icon name="power" size={22} />
              <div>
                <strong>Pick. Pause. Focus.</strong>
                <p>
                  Add your websites, switch on the ones to include, choose your
                  duration, and press Lights Out. Choose a category to focus on
                  just that group.
                </p>
              </div>
            </div>
            <div>
              <Icon name="pointer" size={22} />
              <div>
                <strong>Everything has its place.</strong>
                <p>
                  Drag websites to reorder them or drop them on a category. Hold
                  Ctrl while dragging to copy. Click a website to select it.
                </p>
              </div>
            </div>
            <div>
              <Icon name="keyboard" size={22} />
              <div>
                <strong>A few familiar shortcuts.</strong>
                <p>
                  <kbd>Ctrl C</kbd> copy · <kbd>Ctrl X</kbd> cut ·
                  <kbd>Ctrl V</kbd>
                  paste into the selected category · <kbd>Ctrl Z</kbd> undo ·
                  <kbd>Ctrl Shift Z</kbd> redo.
                </p>
              </div>
            </div>
            <div>
              <Icon name="coffee" size={22} />
              <div>
                <strong>Try it without the ritual.</strong>
                <p>
                  Enable Test mode in Settings → General. New manual sessions
                  can be stopped immediately. Active schedules can also be
                  edited, paused, or removed in test mode.
                </p>
              </div>
            </div>
            <div>
              <Icon name="shield" size={22} />
              <div>
                <strong>Real requests. Real boundaries.</strong>
                <p>
                  The extension blocks requests to your domains and requests
                  made by their pages. Chrome will show its own blocked
                  connection page. Install and pair the extension to enable
                  this.
                </p>
              </div>
            </div>
          </div>
          <button class="primary-button full-width" on:click={closeModal}
            >A little more focus. Let’s go.<Icon
              name="right"
              size={17}
            /></button
          >{/if}
      </div>
    </div>{/if}
</div>

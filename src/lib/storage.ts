import { invoke } from '@tauri-apps/api/core';
import {
  defaultState,
  uid,
  hydrateState,
  categoryPolicy,
  inheritActiveCategories,
  type AppState,
  type UnlockProgress,
} from './model';

export const desktop = '__TAURI_INTERNALS__' in window;
const key = 'lockin-state-v1';
let previewState: AppState = hydrateState(structuredClone(defaultState));
let saveQueue: Promise<unknown> = Promise.resolve();
export async function loadState(): Promise<AppState> {
  if (desktop) return hydrateState(await invoke<AppState>('load_state'));
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed.version === 1 &&
        Array.isArray(parsed.sites) &&
        Array.isArray(parsed.categories) &&
        parsed.settings?.protection
      )
        previewState = hydrateState(parsed);
    } catch {
      /* Keep usable defaults if local storage is corrupt. */
    }
  }
  return expirePreview();
}
function persistPreview(state: AppState) {
  localStorage.setItem(key, JSON.stringify(state));
  previewState = structuredClone(state);
  return structuredClone(state);
}
function expirePreview() {
  const expired = previewState.sessions.filter((s) => s.endsAt <= Date.now());
  for (const s of expired) logSession(s.id, true);
  if (expired.length) persistPreview(previewState);
  return structuredClone(previewState);
}
function logSession(id: string, completed: boolean) {
  const s = previewState.sessions.find((s) => s.id === id);
  if (!s) return;
  previewState.history.unshift({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: completed ? s.endsAt : Date.now(),
    plannedEnd: s.endsAt,
    siteCount: s.domains.length,
    completed,
    testMode: s.testMode,
  });
  previewState.history = previewState.history.slice(0, 1000);
  previewState.sessions = previewState.sessions.filter((s) => s.id !== id);
}
export function saveState(state: AppState): Promise<AppState> {
  const snapshot = structuredClone(state);
  const next = saveQueue
    .catch(() => {})
    .then(async () => {
      if (desktop) return invoke<AppState>('save_state', { state: snapshot });
      snapshot.sessions = structuredClone(previewState.sessions);
      snapshot.history = structuredClone(previewState.history);
      inheritActiveCategories(previewState, snapshot);
      snapshot.revision = (previewState.revision || 0) + 1;
      return persistPreview(snapshot);
    });
  saveQueue = next;
  return next;
}
export async function startSession(
  siteIds: string[],
  durationMinutes: number,
  testMode: boolean,
  appIds: string[] = [],
  categoryIds: string[] = [],
): Promise<AppState> {
  await saveQueue;
  if (desktop)
    return invoke('start_session', {
      siteIds,
      durationMinutes,
      testMode,
      appIds,
      categoryIds,
    });
  expirePreview();
  const groups = categoryIds.length
    ? categoryIds.map((id) => ({ id, category: true }))
    : [
        ...siteIds.map((id) => ({ id, category: false })),
        ...appIds.map((id) => ({ id, category: false })),
      ];
  const additions = groups.map((target) => {
    const sites = previewState.sites.filter((s) =>
      target.category ? s.categoryId === target.id : s.id === target.id,
    );
    const apps = previewState.apps.filter((a) =>
      target.category ? a.categoryId === target.id : a.id === target.id,
    );
    const categoryId = target.category
      ? target.id
      : sites[0]?.categoryId || apps[0]?.categoryId;
    if (!categoryId || (!sites.length && !apps.length))
      throw new Error('This target has no websites or applications.');
    if (
      previewState.sessions.some((s) =>
        target.category
          ? s.categoryIds?.includes(target.id)
          : !s.categoryIds?.length &&
            (s.siteIds.includes(target.id) || s.appIds?.includes(target.id)),
      )
    )
      throw new Error('This target already has a timer.');
    const policy = categoryPolicy(previewState, categoryId);
    return {
      id: uid(),
      siteIds: sites.map((s) => s.id),
      domains: [...new Set(sites.map((s) => s.domain))],
      appIds: apps.map((a) => a.id),
      appPaths: apps.map((a) => a.path),
      categoryIds: target.category ? [target.id] : [],
      policyCategoryId: categoryId,
      label: target.category
        ? previewState.categories.find((c) => c.id === target.id)!.name
        : sites[0]?.name || apps[0]?.name,
      startedAt: Date.now(),
      endsAt: Date.now() + durationMinutes * 60000,
      testMode,
      protection: structuredClone(policy.protection),
      blockedKeywords: policy.keywordFilterEnabled
        ? [...policy.blockedKeywords]
        : [],
      strictNetworkGuard: policy.strictNetworkGuard,
      unlock: null,
    };
  });
  previewState.sessions.push(...additions);
  previewState.revision = (previewState.revision || 0) + 1;
  for (const id of categoryIds)
    previewState.categories.find((c) => c.id === id)!.durationMinutes =
      durationMinutes;
  for (const id of siteIds)
    previewState.sites.find((s) => s.id === id)!.durationMinutes =
      durationMinutes;
  previewState.settings.durationUsage[String(durationMinutes)] =
    (previewState.settings.durationUsage[String(durationMinutes)] || 0) + 1;
  return persistPreview(previewState);
}
export async function beginUnlock(sessionId: string): Promise<UnlockProgress> {
  if (desktop) return invoke('begin_unlock', { sessionId });
  const s = previewState.sessions.find((s) => s.id === sessionId);
  if (!s) throw new Error('This timer has finished.');
  s.unlock ??= {
    step: 0,
    total: s.testMode ? 0 : s.protection.steps,
    readyAt: Date.now() + (s.testMode ? 0 : s.protection.waitMinutes * 60000),
  };
  persistPreview(previewState);
  return { ...s.unlock };
}
export async function advanceUnlock(
  sessionId: string,
): Promise<UnlockProgress> {
  if (desktop) return invoke('advance_unlock', { sessionId });
  const p = previewState.sessions.find((s) => s.id === sessionId)?.unlock;
  if (!p || Date.now() < p.readyAt)
    throw new Error('Let the waiting timer finish first.');
  p.step = Math.min(p.total, p.step + 1);
  persistPreview(previewState);
  return { ...p };
}
export async function finishUnlock(
  phrase: string,
  sessionId: string,
): Promise<AppState> {
  if (desktop) return invoke('finish_unlock', { phrase, sessionId });
  expirePreview();
  const s = previewState.sessions.find((s) => s.id === sessionId);
  if (!s) return structuredClone(previewState);
  const p = s.unlock;
  if (!s.testMode && s.strictNetworkGuard)
    throw new Error('Strict timers cannot end early.');
  if (
    !s.testMode &&
    (!p ||
      Date.now() < p.readyAt ||
      p.step < p.total ||
      (s.protection.phraseEnabled && phrase !== s.protection.phrase))
  )
    throw new Error('Complete the unlock steps first.');
  logSession(sessionId, false);
  return persistPreview(previewState);
}
export async function bridgeStatus(): Promise<{
  connected: boolean;
  lastSeen: number;
  error?: string;
  hostVersion?: string;
  extensionVersion?: string;
}> {
  return desktop ? invoke('bridge_status') : { connected: false, lastSeen: 0 };
}
export async function installBridge(extensionId: string): Promise<string> {
  return invoke('install_bridge', { extensionId });
}
export async function pickApplication(): Promise<string | null> {
  return desktop ? invoke('pick_application') : null;
}
export async function hideToTray() {
  if (desktop) await invoke('hide_to_tray');
}
export type RuntimeStatus = {
  tray: boolean;
  tooltip: string;
  blockedApps: number;
  guardErrors: string[];
};
export async function runtimeStatus(): Promise<RuntimeStatus> {
  return desktop
    ? invoke('runtime_status')
    : { tray: false, tooltip: 'Desktop only', blockedApps: 0, guardErrors: [] };
}
export type ExtensionBundle = { path: string; version: string };
export async function prepareExtension(): Promise<ExtensionBundle> {
  if (!desktop)
    throw new Error('Open the desktop app to prepare the extension.');
  return invoke('prepare_extension');
}
export async function openExtensionFolder() {
  return invoke('open_extension_folder');
}
export type NetworkGuardStatus = {
  installed: boolean;
  running: boolean;
  blocked: boolean;
  lockedUntil: number;
  updatedAt: number;
  error: string;
  dataPath: string;
};
export async function networkGuardStatus(): Promise<NetworkGuardStatus> {
  return desktop
    ? invoke('network_guard_status')
    : {
        installed: false,
        running: false,
        blocked: false,
        lockedUntil: 0,
        updatedAt: 0,
        error: '',
        dataPath: '',
      };
}
export async function installNetworkGuard(): Promise<void> {
  return invoke('install_network_guard');
}

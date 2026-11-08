import {
  getBlockedDomains,
  makeRules,
  nextBoundary,
  supportedKeywordRules,
  matchedKeyword,
} from './rules.js';
import { appearance } from './appearance.js';
import {
  compareVersions,
  bridgeCompatibilityError,
  updateCompatibilityError,
} from './bridge-health.js';

let port = null,
  snapshot = null,
  reconnectTimer,
  heartbeatTimer,
  applied = false;
let queue = Promise.resolve();
let connectionEpoch = 0;
let lastAppearance = '';
const pendingAdds = new Map();
let updateCheckAt = 0;
let desktopVersion = '';
function signature(rules) {
  return rules
    .map((r) =>
      JSON.stringify([
        r.condition.requestDomains || [],
        r.condition.initiatorDomains || [],
        r.condition.regexFilter || '',
      ]),
    )
    .sort()
    .join('|');
}

async function applyState(state, connected) {
  snapshot = state;
  const domains = getBlockedDomains(state);
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const keywords = await supportedKeywordRules(
    state,
    async (regex) =>
      (
        await chrome.declarativeNetRequest.isRegexSupported({
          regex,
          isCaseSensitive: false,
        })
      ).isSupported,
  );
  const nextRules = [...makeRules(domains), ...keywords.rules];
  const changed = signature(rules) !== signature(nextRules);
  if (changed) {
    const previous = new Set(
      rules.flatMap((r) => r.condition.requestDomains || []),
    );
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: nextRules,
    });
    // Reload newly blocked tabs to terminate existing media and live connections.
    const newlyBlocked = domains.filter((d) => !previous.has(d));
    if (newlyBlocked.length) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          const host = new URL(tab.url || '').hostname;
          if (
            tab.id &&
            newlyBlocked.some((d) => host === d || host.endsWith(`.${d}`))
          )
            await chrome.tabs.reload(tab.id, { bypassCache: true });
        } catch {
          /* A tab can disappear during a reload. */
        }
      }
    }
  }
  const next = nextBoundary(state);
  await chrome.alarms.clear('boundary');
  if (next)
    await chrome.alarms.create('boundary', {
      when: Math.max(Date.now() + 100, next),
    });
  await chrome.action.setBadgeText({
    text: domains.length ? String(domains.length) : '',
  });
  const colors = appearance(state.settings);
  await chrome.action.setBadgeBackgroundColor({ color: colors.accent });
  await chrome.action.setBadgeTextColor({ color: colors.contrast });
  if (lastAppearance !== colors.accent) {
    const canvas = new OffscreenCanvas(32, 32),
      context = canvas.getContext('2d');
    context.fillStyle = colors.accent;
    context.beginPath();
    context.roundRect(0, 0, 32, 32, 8);
    context.fill();
    context.fillStyle = colors.contrast;
    context.fillRect(8, 8, 4, 16);
    context.fillRect(8, 20, 15, 4);
    context.fillRect(18, 8, 7, 4);
    context.fillRect(21, 8, 4, 8);
    await chrome.action.setIcon({
      imageData: context.getImageData(0, 0, 32, 32),
    });
    lastAppearance = colors.accent;
  }
  await chrome.storage.local.set({
    snapshot: state,
    blockedDomains: domains,
    connected,
    lastSync: connected
      ? Date.now()
      : (await chrome.storage.local.get('lastSync')).lastSync || 0,
    error: '',
    ruleWarnings: keywords.warnings.length
      ? 'Some longer keywords exceed Chrome’s encoded-rule limit. Basic URL matching and decoded navigation filtering remain active. Website blocking is fully applied.'
      : '',
  });
  applied = true;
  if (changed) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs)
      if (tab.id && matchedKeyword(tab.url, state))
        await blockKeywordTab(tab.id);
  }
}
async function blockKeywordTab(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [900000 + tabId],
    addRules: [
      {
        id: 900000 + tabId,
        priority: 3,
        action: { type: 'block' },
        condition: {
          tabIds: [tabId],
          urlFilter: '|http',
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
      },
    ],
  });
  try {
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL('blocked.html'),
    });
  } catch {}
  setTimeout(
    () =>
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [900000 + tabId],
      }),
    150,
  );
}
async function inspectNavigation(details) {
  if (
    details.frameId !== 0 ||
    details.url.startsWith(chrome.runtime.getURL(''))
  )
    return;
  if (matchedKeyword(details.url, snapshot))
    await blockKeywordTab(details.tabId);
  else
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [900000 + details.tabId],
    });
}
chrome.webNavigation.onHistoryStateUpdated.addListener(inspectNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(inspectNavigation);
chrome.webNavigation.onBeforeNavigate.addListener(inspectNavigation);
chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [900000 + tabId],
  }),
);
async function checkUpdate() {
  if (Date.now() - updateCheckAt < 10000) return;
  updateCheckAt = Date.now();
  try {
    const manifest = await (
      await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })
    ).json();
    const comparison = compareVersions(
      manifest.version,
      chrome.runtime.getManifest().version,
    );
    if (comparison === null || comparison < 0) {
      await chrome.storage.local.set({
        updateError:
          'An older desktop overwrote the managed companion files. Open the latest LockIN app and prepare the companion again. Automatic downgrade was blocked.',
      });
    } else if (comparison > 0) {
      await chrome.storage.local.set({ lastReload: Date.now() });
      chrome.runtime.reload();
    }
  } catch {}
}
function enqueue(state, connected) {
  queue = queue
    .catch(() => {})
    .then(() => applyState(state, connected))
    .catch(async (error) => {
      applied = false;
      await chrome.storage.local.set({
        error: String(error),
        connected: false,
      });
    });
  return queue;
}
function requestSync() {
  try {
    port?.postMessage({
      type: 'sync',
      applied,
      supportsSessions: true,
      extensionVersion: chrome.runtime.getManifest().version,
    });
  } catch {
    disconnect();
  }
}
function disconnect() {
  port = null;
  desktopVersion = '';
  applied = false;
  clearInterval(heartbeatTimer);
  chrome.storage.local.set({ connected: false });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 5000);
}
function connect() {
  clearTimeout(reconnectTimer);
  if (port) {
    requestSync();
    return;
  }
  const epoch = ++connectionEpoch;
  try {
    const current = chrome.runtime.connectNative('com.lockin.bridge');
    port = current;
    current.onMessage.addListener((message) => {
      if (message.type === 'state' && message.state?.version === 1) {
        desktopVersion = message.extensionVersion || '';
        const compatibilityError = bridgeCompatibilityError(message);
        if (compatibilityError) {
          applied = false;
          chrome.storage.local.set({
            connected: false,
            desktopExtensionVersion: desktopVersion,
            error: compatibilityError,
          });
          current.disconnect();
          return;
        }
        enqueue(message.state, true);
        checkUpdate();
        chrome.storage.local.set({
          desktopExtensionVersion: message.extensionVersion || '',
        });
      } else if (message.type === 'reconnect_required') {
        applied = false;
        chrome.storage.local.set({ connected: false, error: message.error });
        current.disconnect();
      } else if (message.type === 'quick_add_result') {
        requestSync();
        const resolve = pendingAdds.get(message.requestId);
        if (resolve) {
          pendingAdds.delete(message.requestId);
          resolve(message.result);
        }
      } else if (message.type === 'extension_updated') {
        const downgradeError = updateCompatibilityError(
          message.bundle.version,
          chrome.runtime.getManifest().version,
        );
        if (downgradeError) {
          chrome.storage.local.set({ updateError: downgradeError });
          return;
        }
        fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })
          .then((r) => r.json())
          .then((manifest) => {
            if (manifest.version === message.bundle.version) {
              chrome.storage.local
                .set({ updateError: '' })
                .then(() => chrome.runtime.reload());
            } else
              chrome.storage.local.set({
                updateError: `Load the managed folder once: ${message.bundle.path}. Then pair its ID in the desktop app.`,
              });
          });
      } else if (message.type === 'extension_update_error') {
        chrome.storage.local.set({ updateError: message.error });
      } else if (message.type === 'error') {
        applied = false;
        chrome.storage.local.set({ error: message.error, connected: false });
      }
    });
    current.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message;
      if (epoch === connectionEpoch) {
        disconnect();
        if (reason)
          chrome.storage.local.set({
            error: `Native bridge unavailable: ${reason} Open the latest LockIN desktop app and reconnect.`,
          });
      }
    });
    requestSync();
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(requestSync, 2000);
  } catch {
    disconnect();
  }
}
async function initialize() {
  const saved = await chrome.storage.local.get('snapshot');
  snapshot = saved.snapshot || null;
  if (snapshot) await enqueue(snapshot, false);
  await chrome.alarms.create('reconcile', { periodInMinutes: 0.5 });
  connect();
}
chrome.alarms.onAlarm.addListener(async () => {
  if (snapshot) await enqueue(snapshot, !!port);
  if (!port) connect();
  else requestSync();
});
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'quick_add') {
    if (!port) {
      respond({ ok: false, error: 'Connect the LockIN desktop app first.' });
      return;
    }
    const requestId = crypto.randomUUID();
    let finished = false;
    pendingAdds.set(requestId, (result) => {
      if (!finished) {
        finished = true;
        respond(result);
      }
    });
    try {
      port.postMessage({
        type: 'quick_add',
        requestId,
        domain: message.domain,
        name: message.name,
        categoryId: message.categoryId,
      });
    } catch {
      pendingAdds.delete(requestId);
      respond({ ok: false, error: 'The desktop connection is unavailable.' });
      return;
    }
    setTimeout(() => {
      pendingAdds.delete(requestId);
      if (!finished) {
        finished = true;
        respond({ ok: false, error: 'Open LockIN and try again.' });
      }
    }, 7000);
    return true;
  }
  if (message.type === 'update_extension') {
    if (port) {
      const updateError = updateCompatibilityError(
        desktopVersion,
        chrome.runtime.getManifest().version,
      );
      if (updateError) {
        chrome.storage.local.set({ updateError });
        respond({ ok: false, error: updateError });
        return;
      }
      port.postMessage({ type: 'update_extension' });
      respond({ ok: true });
    } else respond({ ok: false, error: 'Connect the desktop app to update.' });
    return;
  }
  if (message.type === 'reconnect') {
    connectionEpoch++;
    port?.disconnect();
    port = null;
    applied = false;
    clearInterval(heartbeatTimer);
    clearTimeout(reconnectTimer);
    chrome.storage.local.set({ connected: false });
    connect();
    respond({ ok: true });
  }
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({
      id: 'lockin-add',
      title: 'Add this website to LockIN',
      contexts: ['page'],
    }),
  );
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lockin-add' && tab?.id) {
    await chrome.action.openPopup();
  }
});
initialize().catch((error) =>
  chrome.storage.local.set({ connected: false, error: String(error) }),
);

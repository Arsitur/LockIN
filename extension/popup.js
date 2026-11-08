import { activeSessions } from './rules.js';
import { appearance } from './appearance.js';
import { scheduleActive } from './rules.js';
let currentDomain = '',
  currentName = '',
  categoriesKey = '';
const tabReady = chrome.tabs
  .query({ active: true, lastFocusedWindow: true })
  .then((tabs) => {
    const tab = tabs[0];
    try {
      const url = new URL(tab?.url || '');
      if (!['http:', 'https:'].includes(url.protocol)) return;
      currentDomain = url.hostname.toLowerCase().replace(/^www\./, '');
      currentName = (tab.title || currentDomain).slice(0, 60);
      document.getElementById('current-domain').textContent = currentDomain;
    } catch {}
  });
function render(data) {
  const theme = appearance(
    data.snapshot?.settings,
    matchMedia('(prefers-color-scheme: dark)').matches,
  );
  document.documentElement.style.setProperty('--accent', theme.accent);
  document.documentElement.style.setProperty('--on-accent', theme.contrast);
  document.documentElement.classList.toggle('light', theme.light);
  const connected =
    !!data.connected && Date.now() - (data.lastSync || 0) < 12000;
  const status = document.getElementById('status');
  status.classList.toggle('connected', connected);
  status.querySelector('b').textContent = connected
    ? 'Connected to your desktop'
    : 'Waiting for your desktop connection';
  const domains = data.blockedDomains || [];
  document.getElementById('count').textContent = domains.length;
  const list = document.getElementById('domains');
  list.replaceChildren();
  for (const domain of domains.slice(0, 8)) {
    const tag = document.createElement('span');
    tag.textContent = domain;
    list.appendChild(tag);
  }
  if (domains.length > 8) {
    const tag = document.createElement('span');
    tag.textContent = `+${domains.length - 8} more`;
    list.appendChild(tag);
  }
  const sessions = activeSessions(data.snapshot);
  const session = sessions.sort((a, b) => a.endsAt - b.endsAt)[0];
  const seconds = session
    ? Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000))
    : 0;
  document.getElementById('timer').textContent = session
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining${sessions.length > 1 ? ` · ${sessions.length} timers` : ''}${session.testMode ? ' · test mode' : ''}`
    : '';
  const error = document.getElementById('error');
  error.hidden = !data.error && !data.ruleWarnings;
  error.textContent = data.error || data.ruleWarnings || '';
  const categories = data.snapshot?.categories || [];
  const key = JSON.stringify([currentDomain, categories]);
  if (key !== categoriesKey) {
    categoriesKey = key;
    const container = document.getElementById('quick-categories');
    container.replaceChildren();
    for (const category of categories) {
      const button = document.createElement('button');
      button.textContent = category.name;
      button.disabled = !currentDomain || !connected;
      button.addEventListener('click', async () => {
        button.disabled = true;
        const resultNode = document.getElementById('quick-result');
        resultNode.textContent = 'Adding to your space…';
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'quick_add',
            domain: currentDomain,
            name: currentName,
            categoryId: category.id,
          });
          resultNode.textContent = result.ok
            ? `Added to ${category.name}. Active category locks apply immediately.`
            : result.error;
        } catch (error) {
          resultNode.textContent = String(error);
        } finally {
          button.disabled = false;
        }
      });
      container.appendChild(button);
    }
  }
  for (const button of document.getElementById('quick-categories').children)
    button.disabled = !currentDomain || !connected;
  document.getElementById('companion-version').textContent =
    `Companion ${chrome.runtime.getManifest().version} · Bridge ${data.desktopExtensionVersion || 'not connected'}`;
  document.getElementById('update-status').textContent = data.updateError || '';
  document.getElementById('update-companion').disabled =
    !connected ||
    !!(
      activeSessions(data.snapshot).some(
        (s) => s.strictNetworkGuard && !s.testMode,
      ) ||
      (!data.snapshot?.settings?.testMode &&
        data.snapshot?.schedules?.some(
          (s) =>
            scheduleActive(s) &&
            s.categoryIds.some(
              (id) =>
                (
                  data.snapshot.categories.find((c) => c.id === id)?.policy ||
                  data.snapshot.settings
                )?.strictNetworkGuard,
            ),
        ))
    );
}
const update = async () =>
  render(
    await chrome.storage.local.get([
      'connected',
      'lastSync',
      'blockedDomains',
      'snapshot',
      'error',
      'ruleWarnings',
      'updateError',
      'desktopExtensionVersion',
    ]),
  );
chrome.storage.onChanged.addListener(update);
tabReady.then(update);
setInterval(update, 1000);
document.getElementById('reconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reconnect' });
  await update();
});
document
  .getElementById('update-companion')
  .addEventListener('click', async () => {
    document.getElementById('update-status').textContent =
      'Preparing the latest companion…';
    const result = await chrome.runtime.sendMessage({
      type: 'update_extension',
    });
    if (!result.ok)
      document.getElementById('update-status').textContent = result.error;
  });

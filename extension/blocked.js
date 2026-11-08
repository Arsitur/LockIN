import { appearance } from './appearance.js';
const data = await chrome.storage.local.get('snapshot');
const theme = appearance(
  data.snapshot?.settings,
  matchMedia('(prefers-color-scheme: dark)').matches,
);
document.documentElement.style.setProperty('--accent', theme.accent);
document.documentElement.style.setProperty('--on-accent', theme.contrast);
document.documentElement.classList.toggle('light', theme.light);
document
  .getElementById('back')
  .addEventListener('click', () =>
    history.length > 1
      ? history.back()
      : chrome.tabs.update({ url: 'chrome://newtab/' }),
  );

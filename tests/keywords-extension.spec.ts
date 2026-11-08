import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { defaultState } from '../src/lib/model';

test('Chrome blocks keyword requests only during active category timers, including encoded searches and fragments', async () => {
  test.setTimeout(60000);
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url || '');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>A safe page</title><p>Safe content</p>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const root = await mkdtemp(join(tmpdir(), 'lockin-keywords-test-')),
    ext = join(root, 'extension');
  await cp(resolve('extension'), ext, { recursive: true });
  const state = structuredClone(defaultState);
  state.sessions = [
    {
      id: 'category-filter',
      siteIds: [],
      domains: [],
      categoryIds: ['social'],
      policyCategoryId: 'social',
      label: 'Social media',
      blockedKeywords: state.settings.blockedKeywords,
      startedAt: Date.now(),
      endsAt: Date.now() + 120000,
      testMode: true,
      protection: state.settings.protection,
    },
  ];
  state.settings.accent = '#a78bfa';
  const file = join(ext, 'background.js');
  const original = await readFile(file, 'utf8');
  await writeFile(
    file,
    original.replace(
      'async function initialize() {',
      `async function initialize() { globalThis.applyTestSnapshot = (state) => enqueue(state, false); await chrome.storage.local.set({snapshot:${JSON.stringify(state)}});`,
    ),
  );
  const context = await chromium.launchPersistentContext(
    join(root, 'profile'),
    {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        '--no-proxy-server',
      ],
    },
  );
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    await expect
      .poll(() =>
        worker.evaluate(async () =>
          (globalThis as any).chrome.declarativeNetRequest
            .getDynamicRules()
            .then(
              (r: any[]) => r.filter((x) => x.condition.regexFilter).length,
            ),
        ),
      )
      .toBe(4);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/safe`);
    const requests = [
      '/search?q=porn',
      '/search?q=%50%4f%52%4e',
      '/search?q=%2570%256f%2572%256e',
      '/search?q=HENTAI',
    ];
    for (const path of requests) {
      const ok = await page.evaluate(async (path) => {
        try {
          await fetch(path);
          return true;
        } catch {
          return false;
        }
      }, path);
      expect(ok).toBe(false);
    }
    expect(hits.filter((path) => path.startsWith('/search'))).toEqual([]);
    await page.evaluate(() => (location.hash = 'hentai'));
    await expect.poll(() => page.url()).toContain('blocked.html');
    await expect(
      page.getByRole('heading', { name: 'A little space from this.' }),
    ).toBeVisible();
    const shortcuts = await worker.evaluate(async () =>
      (globalThis as any).chrome.commands.getAll(),
    );
    expect(
      shortcuts.some(
        (s: any) =>
          s.name === '_execute_action' && s.shortcut === 'Alt+Shift+L',
      ),
    ).toBe(true);
    state.sessions = [];
    await worker.evaluate(
      async (state) => (globalThis as any).applyTestSnapshot(state),
      state,
    );
    await expect
      .poll(() =>
        worker.evaluate(async () =>
          (globalThis as any).chrome.declarativeNetRequest
            .getDynamicRules()
            .then(
              (r: any[]) => r.filter((x) => x.condition.regexFilter).length,
            ),
        ),
      )
      .toBe(0);
    const unlocked = await context.newPage();
    await unlocked.goto(`http://127.0.0.1:${port}/search?q=porn`);
    await expect(unlocked).toHaveTitle('A safe page');
    expect(hits).toContain('/search?q=porn');
  } finally {
    await context.close();
    await new Promise<void>((done, reject) =>
      server.close((e) => (e ? reject(e) : done())),
    );
    const path = relative(resolve(tmpdir()), resolve(root));
    if (!path.startsWith('..') && path.startsWith('lockin-keywords-test-'))
      await rm(root, { recursive: true, force: true });
  }
});

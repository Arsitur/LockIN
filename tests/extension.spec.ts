import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { defaultState } from '../src/lib/model';

test('Chrome enforces concurrent timers and releases each domain at its own deadline', async () => {
  test.setTimeout(60000);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<title>Connection restored</title><p>Your network request reached the server.</p>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const serverPort = (server.address() as { port: number }).port;
  const root = await mkdtemp(join(tmpdir(), 'lockin-extension-test-'));
  const extensionPath = join(root, 'extension');
  await cp(resolve('extension'), extensionPath, { recursive: true });
  const state = structuredClone(defaultState);
  state.settings.theme = 'light';
  state.settings.accent = '#7845ef';
  state.sessions = [
    {
      id: 'network-test',
      siteIds: [],
      domains: ['lockin.test'],
      startedAt: Date.now(),
      endsAt: Date.now() + 8000,
      testMode: true,
      protection: state.settings.protection,
    },
    {
      id: 'second-network-test',
      siteIds: [],
      domains: ['other.test'],
      startedAt: Date.now(),
      endsAt: Date.now() + 16000,
      testMode: true,
      protection: state.settings.protection,
    },
  ];
  const backgroundPath = join(extensionPath, 'background.js');
  const original = await readFile(backgroundPath, 'utf8');
  await writeFile(
    backgroundPath,
    original.replace(
      'async function initialize() {',
      `async function initialize() {\n await chrome.storage.local.set({ snapshot: ${JSON.stringify(state)} });`,
    ),
  );
  const context = await chromium.launchPersistentContext(
    join(root, 'profile'),
    {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP *.lockin.test 127.0.0.1, MAP lockin.test 127.0.0.1, MAP other.test 127.0.0.1',
        '--no-proxy-server',
      ],
    },
  );
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const rules = () =>
      worker.evaluate(async () => {
        const api = (globalThis as any).chrome;
        return api.declarativeNetRequest.getDynamicRules();
      });
    await expect.poll(async () => (await rules()).length).toBe(4);
    const page = await context.newPage();
    await expect(
      page.goto(`http://lockin.test:${serverPort}/`),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    const subdomainPage = await context.newPage();
    await expect(
      subdomainPage.goto(`http://subdomain.lockin.test:${serverPort}/`),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    const allowedPage = await context.newPage();
    await allowedPage.goto(`http://127.0.0.1:${serverPort}/`);
    await expect(allowedPage).toHaveTitle('Connection restored');
    await expect
      .poll(
        async () =>
          (await rules()).filter((r: any) =>
            r.condition.requestDomains?.includes('lockin.test'),
          ).length,
        { timeout: 15000 },
      )
      .toBe(0);
    const independentlyRestored = await context.newPage();
    await independentlyRestored.goto(`http://lockin.test:${serverPort}/`);
    await expect(independentlyRestored).toHaveTitle('Connection restored');
    const stillBlocked = await context.newPage();
    await expect(
      stillBlocked.goto(`http://other.test:${serverPort}/`),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    await expect
      .poll(async () => (await rules()).length, { timeout: 22000 })
      .toBe(0);
    const status = await worker.evaluate(async () =>
      (globalThis as any).chrome.storage.local.get('blockedDomains'),
    );
    expect(status.blockedDomains).toEqual([]);
    const restoredPage = await context.newPage();
    await restoredPage.goto(`http://lockin.test:${serverPort}/`);
    await expect(restoredPage).toHaveTitle('Connection restored');
    const popup = await context.newPage();
    await popup.goto(new URL('popup.html', worker.url()).href);
    await expect(popup.locator('#count')).toHaveText('0');
    await expect(popup.locator('html')).toHaveClass(/light/);
    await expect(popup.locator('html')).toHaveCSS('--accent', '#7845ef');
    expect(
      await worker.evaluate(async () =>
        (globalThis as any).chrome.action.getBadgeBackgroundColor({}),
      ),
    ).toEqual([120, 69, 239, 255]);
  } finally {
    await context.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    const path = relative(resolve(tmpdir()), resolve(root));
    if (!path.startsWith('..') && path.startsWith('lockin-extension-test-'))
      await rm(root, { recursive: true, force: true });
  }
});

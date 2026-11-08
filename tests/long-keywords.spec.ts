import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { defaultState, hydrateState } from '../src/lib/model';

test('an unsupported encoded keyword cannot disable domain blocking or literal filtering', async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), 'lockin-long-keyword-'));
  const ext = join(root, 'extension');
  const word = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv';
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url || '');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Allowed page</title>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  let context;
  try {
    await cp(resolve('extension'), ext, { recursive: true });
    const state = hydrateState(structuredClone(defaultState));
    state.sessions = [
      {
        id: 'long-filter',
        categoryIds: ['social'],
        siteIds: [],
        domains: ['lockin-filter.test'],
        startedAt: Date.now(),
        endsAt: Date.now() + 300000,
        testMode: true,
        protection: state.settings.protection,
        blockedKeywords: [word],
      },
    ];
    const background = join(ext, 'background.js');
    await writeFile(
      background,
      (await readFile(background, 'utf8'))
        .replace('function connect() {', 'function connect() { return;')
        .replace(
          'async function initialize() {',
          `async function initialize() {await chrome.storage.local.set({snapshot:${JSON.stringify(state)}});`,
        ),
    );
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        '--no-proxy-server',
        '--host-resolver-rules=MAP lockin-filter.test 127.0.0.1',
      ],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const rules = () =>
      worker.evaluate(async () =>
        (globalThis as any).chrome.declarativeNetRequest.getDynamicRules(),
      );
    await expect.poll(async () => (await rules()).length).toBe(3);
    const status = await worker.evaluate(async () =>
      (globalThis as any).chrome.storage.local.get([
        'error',
        'ruleWarnings',
        'blockedDomains',
      ]),
    );
    expect(status.error).toBe('');
    expect(status.ruleWarnings).toContain('Website blocking is fully applied');
    expect(status.blockedDomains).toEqual(['lockin-filter.test']);
    const blocked = await context.newPage();
    await expect(
      blocked.goto(`http://lockin-filter.test:${port}/`),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(hits).toEqual([]);
    const allowed = await context.newPage();
    await allowed.goto(`http://127.0.0.1:${port}/safe`);
    const reached = await allowed.evaluate(async (word) => {
      try {
        await fetch('/' + word);
        return true;
      } catch {
        return false;
      }
    }, word);
    expect(reached).toBe(false);
    const encoded = [...word]
      .map((c) => '%' + c.charCodeAt(0).toString(16))
      .join('');
    await allowed.goto(`http://127.0.0.1:${port}/${encoded}`).catch(() => {});
    await expect.poll(() => allowed.url()).toContain('blocked.html');
  } finally {
    await context?.close();
    await new Promise<void>((done, reject) =>
      server.close((e) => (e ? reject(e) : done())),
    );
    const within = relative(resolve(tmpdir()), resolve(root));
    if (!within.startsWith('..') && within.startsWith('lockin-long-keyword-'))
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 300,
      });
  }
});

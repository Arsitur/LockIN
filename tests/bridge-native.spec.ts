import { test, expect, chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  cp,
  copyFile,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { defaultState, hydrateState } from '../src/lib/model';

test('real Chrome rejects a 1.2 native bridge and applies category timers after reconnecting to the current executable', async () => {
  test.skip(
    process.platform !== 'win32' || !process.env.LOCKIN_TEST_NATIVE_EXE,
    'Set LOCKIN_TEST_NATIVE_EXE to the verification build on Windows.',
  );
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'lockin-bridge-integration-'));
  const name = `com.lockin.verification.${randomUUID().replaceAll('-', '')}`;
  const manifestPath = join(root, 'host.json');
  const latest = join(root, 'host-current.exe'),
    old = join(root, 'host-old.exe'),
    ext = join(root, 'extension');
  const registryScript = String.raw`import winreg,sys
name=sys.argv[1]
assert name.startswith('com.lockin.verification.') and name.replace('.','').isalnum()
for parts in [['Software','Google','Chrome','NativeMessagingHosts',name],['Software','Chromium','NativeMessagingHosts',name]]:
 path=chr(92).join(parts)
 if len(sys.argv)>2:
  with winreg.CreateKey(winreg.HKEY_CURRENT_USER,path) as key: winreg.SetValueEx(key,'',0,winreg.REG_SZ,sys.argv[2])
 else:
  try: winreg.DeleteKey(winreg.HKEY_CURRENT_USER,path)
  except FileNotFoundError: pass
`;
  let context;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Request reached server</title>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  try {
    await copyFile(resolve(process.env.LOCKIN_TEST_NATIVE_EXE!), latest);
    await copyFile(resolve('artifacts/LockIN-1.2.0.exe'), old);
    await cp(resolve('extension'), ext, { recursive: true });
    const background = join(ext, 'background.js');
    await writeFile(
      background,
      (await readFile(background, 'utf8')).replaceAll(
        "'com.lockin.bridge'",
        JSON.stringify(name),
      ),
    );
    const state = hydrateState(structuredClone(defaultState));
    state.sessions = [
      {
        id: 'active-category',
        label: 'Social media',
        categoryIds: ['social'],
        policyCategoryId: 'social',
        siteIds: ['instagram'],
        domains: ['lockin-native.test'],
        startedAt: Date.now(),
        endsAt: Date.now() + 300000,
        protection: state.settings.protection,
        testMode: true,
      },
    ];
    await mkdir(join(root, 'LockIN'));
    await writeFile(join(root, 'LockIN', 'state.json'), JSON.stringify(state));
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      env: { ...process.env, LOCALAPPDATA: root },
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        '--no-proxy-server',
        '--host-resolver-rules=MAP lockin-native.test 127.0.0.1',
      ],
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const manifest = {
      name,
      description: 'Isolated LockIN verification',
      type: 'stdio',
      path: old,
      allowed_origins: [`chrome-extension://${id}/`],
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    execFileSync('python', ['-c', registryScript, name, manifestPath], {
      windowsHide: true,
    });
    const status = () =>
      worker.evaluate(async () =>
        (globalThis as any).chrome.storage.local.get([
          'connected',
          'error',
          'desktopExtensionVersion',
          'blockedDomains',
        ]),
      );
    await expect
      .poll(async () => (await status()).error || '', { timeout: 20000 })
      .toContain('old desktop bridge (1.2.0)');
    expect((await status()).connected).toBe(false);
    const popup = await context.newPage();
    await popup.goto(new URL('popup.html', worker.url()).href);
    const updateAttempt = await popup.evaluate(async () =>
      (globalThis as any).chrome.runtime.sendMessage({
        type: 'update_extension',
      }),
    );
    expect(updateAttempt.ok).toBe(false);
    expect(
      JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8')).version,
    ).toBe('1.3.1');
    const initiallyAllowed = await context.newPage();
    await initiallyAllowed.goto(`http://lockin-native.test:${port}/`);
    await expect(initiallyAllowed).toHaveTitle('Request reached server');
    // Repair the test registration exactly as the desktop repair does; do not touch the real bridge key.
    manifest.path = latest;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect
      .poll(async () => (await status()).connected, { timeout: 20000 })
      .toBe(true);
    expect((await status()).desktopExtensionVersion).toBe('1.3.1');
    expect((await status()).blockedDomains).toContain('lockin-native.test');
    const page = await context.newPage();
    await expect(
      page.goto(`http://lockin-native.test:${port}/`),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    await expect
      .poll(async () => {
        try {
          return JSON.parse(
            await readFile(
              join(root, 'LockIN', 'bridge-verified.json'),
              'utf8',
            ),
          ).hostVersion;
        } catch {
          return '';
        }
      })
      .toBe('1.3.1');
    const receipt = JSON.parse(
      await readFile(join(root, 'LockIN', 'bridge-verified.json'), 'utf8'),
    );
    expect(receipt.extensionVersion).toBe('1.3.1');
  } finally {
    await context?.close();
    execFileSync('python', ['-c', registryScript, name], { windowsHide: true });
    await new Promise<void>((done, reject) =>
      server.close((e) => (e ? reject(e) : done())),
    );
    const within = relative(resolve(tmpdir()), resolve(root));
    if (
      !within.startsWith('..') &&
      within.startsWith('lockin-bridge-integration-')
    )
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 300,
      });
  }
});

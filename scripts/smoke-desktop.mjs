import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  copyFile,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'lockin-desktop-test-'));
const reserve = createServer();
await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
const port = reserve.address().port;
await new Promise((done) => reserve.close(done));
const executable = join(root, 'lockin.exe');
await copyFile(
  resolve(process.argv[2] || 'src-tauri/target/release/lockin.exe'),
  executable,
);
const child = spawn(executable, [], {
  windowsHide: true,
  env: {
    ...process.env,
    LOCALAPPDATA: root,
    WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: 'ignore',
});
let browser;
const fixtures = [];
try {
  const deadline = Date.now() + 25000;
  while (true) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error('Desktop WebView2 did not become available.');
    await new Promise((done) => setTimeout(done, 250));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Lights Out', exact: true }).waitFor();
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  await page
    .locator('.website-row')
    .first()
    .dragTo(page.locator('.website-row').nth(1), {
      targetPosition: { x: 90, y: 50 },
    });
  assert.match(
    await page.locator('.website-row').first().innerText(),
    /X \/ Twitter/,
    'HTML drag-and-drop must work in the native WebView',
  );
  await page.getByRole('button', { name: /Overview/ }).click();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  const rawCall = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  const call = async (command, args = {}) => {
    if (
      ['begin_unlock', 'advance_unlock', 'finish_unlock'].includes(command) &&
      !args.sessionId
    ) {
      const latest = await rawCall('load_state');
      args = { ...args, sessionId: latest.sessions[0]?.id };
    }
    return rawCall(command, args);
  };
  let state = await call('load_state');
  await writeFile(join(root, 'LockIN', 'bridge-heartbeat'), String(Date.now()));
  assert.equal(
    (await call('bridge_status')).connected,
    false,
    'A legacy unversioned heartbeat must not claim the current bridge is connected',
  );
  assert.equal(state.sites.length, 8);
  state.categories[0].policy.protection.waitMinutes = 0;
  state = await call('save_state', { state });
  state = await call('start_session', {
    siteIds: [],
    categoryIds: ['social'],
    durationMinutes: 25,
    testMode: false,
  });
  assert.equal(state.sessions[0].domains[0], 'instagram.com');
  const beforeQuickAdd = structuredClone(state);
  const host = spawn(
    executable,
    ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
    {
      env: { ...process.env, LOCALAPPDATA: root },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  fixtures.push(host);
  const quickResult = await new Promise((done, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(
      () => reject(new Error('Quick add native request timed out')),
      7000,
    );
    host.on('error', reject);
    host.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        clearTimeout(timer);
        done(JSON.parse(buffer.subarray(4, buffer.readUInt32LE(0) + 4)));
      }
    });
    const message = Buffer.from(
      JSON.stringify({
        type: 'quick_add',
        requestId: 'smoke',
        domain: 'quick.example',
        name: 'Quick added',
        categoryId: 'social',
      }),
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(message.length);
    host.stdin.write(Buffer.concat([header, message]));
  });
  assert.equal(quickResult.result.ok, true);
  host.stdin.end();
  await new Promise((done) => host.once('exit', done));
  await assert.rejects(
    call('save_state', { state: beforeQuickAdd }),
    /companion/,
  );
  state = await call('load_state');
  assert.ok(
    state.sessions[0].domains.includes('quick.example'),
    'Quick add must inherit the active category lock',
  );
  const bundle = await call('prepare_extension');
  const manifest = JSON.parse(
    await readFile(join(bundle.path, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.version, '1.3.1');
  assert.ok(manifest.commands._execute_action);
  await page
    .getByRole('button', { name: 'Select Quick added', exact: true })
    .waitFor();
  const forged = structuredClone(state);
  forged.sessions = [];
  forged.session = null;
  state = await call('save_state', { state: forged });
  assert.ok(
    (await call('load_state')).sessions.length,
    'Saving configuration must not remove a session',
  );
  const changedProtection = structuredClone(state);
  changedProtection.settings.testMode = true;
  await assert.rejects(
    call('save_state', { state: changedProtection }),
    /Test mode cannot change/,
  );
  await call('begin_unlock');
  await assert.rejects(
    call('finish_unlock', { phrase: state.sessions[0].protection.phrase }),
    /reflection steps/,
  );
  await call('advance_unlock');
  await call('advance_unlock');
  await assert.rejects(
    call('finish_unlock', { phrase: 'wrong phrase' }),
    /exact unlock phrase/,
  );
  state = await call('finish_unlock', {
    phrase: state.sessions[0].protection.phrase,
  });
  assert.equal(state.sessions.length, 0);
  assert.equal(state.history.length, 1);
  const fixtureExe = join(root, 'guard-fixture.exe');
  execFileSync(
    'rustc',
    [resolve('scripts/guard-fixture.rs'), '-o', fixtureExe],
    { windowsHide: true },
  );
  state.apps = [
    {
      id: 'guard-fixture',
      name: 'Guard fixture',
      path: fixtureExe,
      categoryId: 'entertainment',
      enabled: true,
    },
  ];
  state.settings.testMode = true;
  state = await call('save_state', { state });
  await call('start_session', {
    siteIds: [],
    appIds: ['guard-fixture'],
    durationMinutes: 25,
    testMode: true,
  });
  const launchFixture = () => {
    const child = spawn(fixtureExe, [], { windowsHide: true, stdio: 'ignore' });
    fixtures.push(child);
    return child;
  };
  const expectClosed = async (fixture) => {
    const deadline = Date.now() + 4000;
    while (fixture.exitCode === null && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 50));
    assert.notEqual(
      fixture.exitCode,
      null,
      'The selected application must be closed by the desktop guard',
    );
  };
  await expectClosed(launchFixture());
  await call('hide_to_tray');
  await expectClosed(launchFixture());
  state = await call('finish_unlock', { phrase: '' });
  const allowed = launchFixture();
  await new Promise((done) => setTimeout(done, 600));
  assert.equal(
    allowed.exitCode,
    null,
    'Application should be available again after Lights Out',
  );
  allowed.kill();
  await new Promise((done) => allowed.once('exit', done));
  state.apps[0].enabled = false;
  state.schedules = [
    {
      id: 'fixture-schedule',
      name: 'Scheduled apps',
      categoryIds: ['entertainment'],
      days: [0, 1, 2, 3, 4, 5, 6],
      start: '00:00',
      end: '23:59',
      enabled: true,
    },
  ];
  state = await call('save_state', { state });
  await expectClosed(launchFixture());
  state.schedules[0].enabled = false;
  state = await call('save_state', { state });
  state.schedules = [];
  state.apps = [];
  state.settings.testMode = false;
  state.categories[1].policy.protection.waitMinutes = 5;
  state = await call('save_state', { state });
  await call('start_session', {
    siteIds: ['youtube'],
    durationMinutes: 25,
    testMode: false,
  });
  const progress = await call('begin_unlock');
  assert.ok(progress.readyAt - Date.now() > 290000);
  await assert.rejects(call('advance_unlock'), /waiting timer/);
  await assert.rejects(
    call('finish_unlock', {
      phrase: state.categories[1].policy.protection.phrase,
    }),
    /waiting period/,
  );
  const saved = JSON.parse(
    await readFile(join(root, 'LockIN', 'state.json'), 'utf8'),
  );
  assert.equal(saved.sessions[0].unlock.readyAt, progress.readyAt);
  assert.equal(saved.sessions[0].domains[0], 'youtube.com');
  const runtimeDeadline = Date.now() + 5000;
  let runtime;
  do {
    runtime = await call('runtime_status');
    if (runtime.tray && /Lights Out/.test(runtime.tooltip)) break;
    await new Promise((done) => setTimeout(done, 200));
  } while (Date.now() < runtimeDeadline);
  assert.equal(runtime.tray, true);
  assert.match(runtime.tooltip, /Lights Out/);
  const firstTooltip = runtime.tooltip;
  await new Promise((done) => setTimeout(done, 1200));
  assert.notEqual(
    (await call('runtime_status')).tooltip,
    firstTooltip,
    'Tray countdown should tick',
  );
  await call('hide_to_tray');
  assert.equal(
    (await call('runtime_status')).tray,
    true,
    'Native tray survives hiding the main window',
  );
  state = await call('load_state');
  state.categories[0].policy.protection = {
    phraseEnabled: false,
    phrase: 'Social phrase',
    steps: 0,
    waitMinutes: 0,
  };
  state = await call('save_state', { state });
  state = await call('start_session', {
    siteIds: [],
    categoryIds: ['social'],
    durationMinutes: 40,
    testMode: false,
  });
  assert.equal(
    state.sessions.length,
    2,
    'Rust must allow independent concurrent timers',
  );
  const social = state.sessions.find((s) => s.categoryIds.includes('social'));
  const youtube = state.sessions.find((s) => s.siteIds.includes('youtube'));
  assert.notEqual(social.endsAt, youtube.endsAt);
  assert.equal(social.protection.waitMinutes, 0);
  assert.equal(youtube.protection.waitMinutes, 5);
  const tampered = structuredClone(state);
  tampered.sessions = [];
  state = await call('save_state', { state: tampered });
  assert.equal(
    state.sessions.length,
    2,
    'Configuration saves cannot erase timers',
  );
  const illegal = structuredClone(state);
  illegal.categories[0].policy.protection.waitMinutes = 0;
  illegal.categories[0].policy.blockedKeywords.push('changed-during-focus');
  await assert.rejects(
    call('save_state', { state: illegal }),
    /category.*filtering/,
  );
  state.categories[2].policy.protection.waitMinutes = 2;
  state = await call('save_state', { state });
  await call('begin_unlock', { sessionId: social.id });
  state = await call('finish_unlock', { sessionId: social.id, phrase: '' });
  assert.equal(state.sessions.length, 1);
  assert.equal(
    state.sessions[0].id,
    youtube.id,
    'Ending social must leave YouTube protected',
  );
  assert.equal(
    state.sessions[0].unlock.readyAt,
    progress.readyAt,
    'Other unlock progress must remain intact',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Desktop passed: native quick add, inherited category locks, concurrent edit protection, managed extension bundle, drag-and-drop, Rust unlock protection, app termination/restoration, independent concurrent timers, per-category policy isolation, and the live tray countdown.',
  );
} finally {
  for (const fixture of fixtures)
    if (fixture.exitCode === null && fixture.signalCode === null) {
      fixture.kill();
      await new Promise((done) => fixture.once('exit', done));
    }
  await browser?.close();
  child.kill();
  await new Promise((done) => {
    if (child.exitCode !== null) done();
    else child.once('exit', done);
  });
  const path = relative(resolve(tmpdir()), resolve(root));
  if (!path.startsWith('..') && path.startsWith('lockin-desktop-test-'))
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
}

import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'lockin-native-test-'));
const executable = resolve(
  process.argv[2] || 'src-tauri/target/release/lockin.exe',
);
const child = spawn(
  executable,
  ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
  {
    env: { ...process.env, LOCALAPPDATA: root },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
let buffer = Buffer.alloc(0),
  error = '';
child.stderr.on('data', (data) => (error += data));
function request(message) {
  return new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Native host timeout: ${error}`)),
      10000,
    );
    const read = (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const length = buffer.readUInt32LE(0),
          payload = JSON.parse(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4);
        clearTimeout(timer);
        child.stdout.off('data', read);
        done(payload);
      }
    };
    child.stdout.on('data', read);
    const bytes = Buffer.from(JSON.stringify(message)),
      header = Buffer.alloc(4);
    header.writeUInt32LE(bytes.length);
    child.stdin.write(Buffer.concat([header, bytes]));
  });
}
try {
  const initial = await request({
    type: 'sync',
    applied: false,
    supportsSessions: true,
  });
  assert.equal(initial.type, 'state');
  assert.equal(initial.state.version, 1);
  assert.equal(initial.state.sites.length, 8);
  assert.equal(initial.protocolVersion, 2);
  assert.deepEqual(initial.state.sessions, []);
  assert.equal(initial.state.session, null);
  const synced = await request({
    type: 'sync',
    applied: true,
    supportsSessions: true,
    extensionVersion: initial.extensionVersion,
  });
  assert.equal(synced.type, 'state');
  // The host flushes its response before writing the heartbeat; wait for that I/O.
  let heartbeat = 0;
  const heartbeatDeadline = Date.now() + 3000;
  while (Date.now() < heartbeatDeadline) {
    try {
      heartbeat = Number(
        await readFile(join(root, 'LockIN', 'bridge-heartbeat'), 'utf8'),
      );
      if (heartbeat) break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.ok(Math.abs(Date.now() - heartbeat) < 5000);
  const receipt = JSON.parse(
    await readFile(join(root, 'LockIN', 'bridge-verified.json'), 'utf8'),
  );
  assert.equal(receipt.hostVersion, initial.extensionVersion);
  assert.equal(receipt.extensionVersion, initial.extensionVersion);
  assert.equal(receipt.hostPath.toLowerCase(), executable.toLowerCase());
  const update = await request({ type: 'update_extension' });
  assert.equal(update.type, 'extension_updated');
  assert.match(
    await readFile(join(update.bundle.path, 'background.js'), 'utf8'),
    /supportedKeywordRules/,
    'The packaged companion must include the long-keyword fix',
  );
  assert.match(
    await readFile(join(update.bundle.path, 'bridge-health.js'), 'utf8'),
    /will not be downgraded/,
  );
  const manifestPath = join(update.bundle.path, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = '9.0.0';
  await writeFile(manifestPath, JSON.stringify(manifest));
  const downgrade = await request({ type: 'update_extension' });
  assert.equal(downgrade.type, 'extension_update_error');
  assert.match(downgrade.error, /downgrade/i);
  assert.equal(
    JSON.parse(await readFile(manifestPath, 'utf8')).version,
    '9.0.0',
  );
  console.log(
    'Native host passed: framed JSON, versioned applied-rule receipt, companion update and downgrade rejection.',
  );
} finally {
  child.stdin.end();
  await new Promise((done) => {
    if (child.exitCode !== null) done();
    else child.once('exit', done);
  });
  const path = relative(resolve(tmpdir()), resolve(root));
  if (!path.startsWith('..') && path.startsWith('lockin-native-test-'))
    await rm(root, { recursive: true, force: true });
}

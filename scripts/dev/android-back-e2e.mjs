/**
 * Drives the debug APK on a running emulator and records what the hardware
 * back key does. Needs a homeserver the emulator can reach.
 *
 *   node scripts/dev/android-back-e2e.mjs <apk>
 *
 * ANDROID_HOME, ADB_SERIAL, HOMESERVER (host side, default http://localhost:28008),
 * HOMESERVER_FROM_DEVICE (default http://10.0.2.2:28008) and REGISTRATION_TOKEN
 * (default sable-e2e) are read from the environment.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PACKAGE = 'moe.sable.client.debug';
const ACTIVITY = `${PACKAGE}/moe.sable.client.MainActivity`;
const HOMESERVER = process.env.HOMESERVER ?? 'http://localhost:28008';
const DEVICE_HOMESERVER = process.env.HOMESERVER_FROM_DEVICE ?? 'http://10.0.2.2:28008';
const TOKEN = process.env.REGISTRATION_TOKEN ?? 'sable-e2e';
const USERNAME = 'backuser';
const PASSWORD = 'test-passw0rd';
const CDP_PORT = 9222;
const ADB = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb`;

function adb(...args) {
  const serial = process.env.ADB_SERIAL ? ['-s', process.env.ADB_SERIAL] : [];
  return execFileSync(ADB, [...serial, ...args], { encoding: 'utf8' }).trim();
}

async function matrix(path, body, { token, allow = [] } = {}) {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(`${path} failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  }
  return { status: response.status, json };
}

async function ensureAccount() {
  const probe = await matrix(
    'register?kind=user',
    { username: USERNAME, password: PASSWORD },
    { allow: [400, 401] }
  );
  if (probe.status === 400 && probe.json.errcode === 'M_USER_IN_USE') return;
  const registered = await matrix('register?kind=user', {
    username: USERNAME,
    password: PASSWORD,
    auth: { type: 'm.login.registration_token', token: TOKEN, session: probe.json.session },
  });
  for (const name of ['Alpha', 'Beta']) {
    await matrix(
      'createRoom',
      { name, preset: 'private_chat' },
      { token: registered.json.access_token }
    );
  }
}

function webviewSocket() {
  const pid = adb('shell', 'pidof', PACKAGE).split(/\s+/)[0];
  if (!pid) return null;
  adb('forward', `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  return pid;
}

async function evaluate(expression) {
  if (!webviewSocket()) throw new Error('app is not running');
  const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
  const socket = new WebSocket(
    targets.find((target) => target.type === 'page').webSocketDebuggerUrl
  );
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const result = await new Promise((resolve) => {
    socket.onmessage = (event) => resolve(JSON.parse(event.data));
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      })
    );
  });
  socket.close();
  return result.result?.result?.value;
}

function appIsResumed() {
  return adb('shell', 'dumpsys', 'activity', 'activities')
    .split('\n')
    .some((line) => line.trim().startsWith('ResumedActivity') && line.includes(PACKAGE));
}

/** Where the app is, as a short label: "home", "room", the path, or "left". */
async function where() {
  if (!appIsResumed()) return 'left';
  const path = await evaluate('location.pathname');
  if (path === '/rooms') return 'home';
  return path.startsWith('/rooms/') ? 'room' : path;
}

async function settled() {
  let last = '';
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i += 1) {
    await sleep(1000);
    const path = await evaluate('location.pathname').catch(() => '');
    stable = path === last && path !== '/' && path !== '' ? stable + 1 : 0;
    last = path;
  }
  return last;
}

async function launch(...intentArgs) {
  adb('shell', 'am', 'force-stop', PACKAGE);
  adb('shell', 'am', 'start', ...(intentArgs.length ? intentArgs : ['-n', ACTIVITY]));
  await settled();
  await sleep(1500);
}

const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

async function pressBack(presses) {
  const trace = [];
  for (let i = 0; i < presses; i += 1) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await sleep(2000);
    const at = await where();
    trace.push(at);
    if (at === 'left') break;
  }
  return trace.join(' > ');
}

async function setup() {
  await ensureAccount();
  adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS');
  await launch();
  if ((await evaluate('location.pathname')) !== '/login') return;
  await evaluate(`(async () => {
    const set = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('input'), ${JSON.stringify(DEVICE_HOMESERVER)});
    await new Promise((resolve) => setTimeout(resolve, 1500));
    [...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('More ways')).click();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const inputs = [...document.querySelectorAll('input')];
    set(inputs[1], ${JSON.stringify(USERNAME)});
    set(inputs[2], ${JSON.stringify(PASSWORD)});
    await new Promise((resolve) => setTimeout(resolve, 300));
    [...document.querySelectorAll('button')].find((b) => b.innerText === 'Sign in with password').click();
  })()`);
  await sleep(12000);
  const skip = `(async () => {
    for (let i = 0; i < 10 && !location.pathname.startsWith('/rooms'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const visible = [...document.querySelectorAll('button')].filter((b) => {
        const box = b.getBoundingClientRect();
        return box.width > 0 && box.left >= 0 && box.right <= innerWidth &&
          ['Skip for now', 'Not now', 'Go to your chats'].includes(b.innerText.trim());
      });
      visible[0]?.click();
    }
    return location.pathname;
  })()`;
  const finished = await evaluate(skip);
  if (!finished.startsWith('/rooms')) throw new Error(`onboarding stopped at ${finished}`);
  await click('a[href^="/rooms/!"]');
  await sleep(2000);
}

const SCENARIOS = {
  'cold start on the restored room': {
    expect: 'home > left',
    async run() {
      await launch();
      return pressBack(3);
    },
  },
  'cold start from a VIEW intent': {
    expect: 'home > left',
    async run() {
      await launch('-a', 'android.intent.action.VIEW', '-d', 'moe.sable.next://open', ACTIVITY);
      return pressBack(3);
    },
  },
  'room opened from the list': {
    expect: 'home > room > home > left',
    async run() {
      await launch();
      await click('nav a[href="/rooms"], a[href="/rooms"]');
      await sleep(1500);
      await click('a[href^="/rooms/!"]');
      await sleep(2000);
      return pressBack(5);
    },
  },
};

async function run() {
  await setup();
  const failures = [];
  console.log('| scenario | back presses | expected | result |');
  console.log('| --- | --- | --- | --- |');
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const trace = await scenario.run();
    const ok = trace === scenario.expect;
    if (!ok) failures.push(name);
    console.log(`| ${name} | ${trace} | ${scenario.expect} | ${ok ? 'pass' : 'FAIL'} |`);
  }
  if (failures.length) process.exitCode = 1;
}

const [apk] = process.argv.slice(2);
if (!apk) {
  console.error('usage: android-back-e2e.mjs <apk>');
  process.exit(1);
}
adb('install', '-r', apk);
await run();

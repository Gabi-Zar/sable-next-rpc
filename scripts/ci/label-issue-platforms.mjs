import { readFile } from 'node:fs/promises';
import { forgejo } from '../lib/forgejo.mjs';

const platformOptions = new Map([
  ['Web', ['web']],
  ['Desktop', ['windows', 'macos', 'linux']],
  ['Windows', ['windows']],
  ['macOS', ['macos']],
  ['Linux', ['linux']],
  ['Mobile', ['ios', 'android']],
  ['iOS', ['ios']],
  ['Android', ['android']],
  ['All', ['web', 'windows', 'macos', 'linux', 'ios', 'android']],
]);
const desktopLabels = ['windows', 'macos', 'linux'];
const mobileLabels = ['ios', 'android'];
const scopeLabels = new Map([
  ['web', 'platform/web'],
  ['desktop', 'platform/desktop'],
  ['mobile', 'platform/mobile'],
  ['web+desktop', 'platform/web-desktop'],
  ['web+mobile', 'platform/web-mobile'],
  ['desktop+mobile', 'platform/native'],
  ['web+desktop+mobile', 'platform/all'],
]);

function selectedPlatformLabels(body) {
  const heading = /^(?:Platforms|What platforms have you experienced this issue on\?)\r?\n/;
  const section = body.split(/^### /m).find((part) => heading.test(part));
  if (!section) return [];

  const choices = section
    .replace(heading, '')
    .split(/[,\r\n]/)
    .map((choice) => choice.trim().replace(/^[-*]\s*/, ''));
  const selected = new Set(choices.flatMap((choice) => platformOptions.get(choice) ?? []));
  if (selected.size === 0) return [];

  const categories = [
    selected.has('web') && 'web',
    desktopLabels.some((label) => selected.has(label)) && 'desktop',
    mobileLabels.some((label) => selected.has(label)) && 'mobile',
  ].filter(Boolean);
  const scope = scopeLabels.get(categories.join('+'));
  return scope ? [scope] : [];
}

const eventPath = process.env.FORGEJO_EVENT_PATH;
if (!eventPath) throw new Error('FORGEJO_EVENT_PATH is required');

const event = JSON.parse(await readFile(eventPath, 'utf8'));
const issueNumber = event.issue?.number ?? event.number;
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  throw new Error('Issue event does not contain an issue number');
}

const wanted = selectedPlatformLabels(event.issue?.body ?? '');
if (wanted.length === 0) {
  console.log('No platform selected');
  process.exit(0);
}

const existing = new Map();
for (let page = 1; ; page += 1) {
  const labels = await forgejo('GET', `/labels?limit=100&page=${page}`);
  for (const label of labels) existing.set(label.name, label);
  if (labels.length < 100) break;
}

const missing = wanted.filter((label) => !existing.has(label));
if (missing.length > 0) {
  throw new Error(
    `Create these Forgejo labels before using the platform picker: ${missing.join(', ')}`
  );
}

const scope = wanted.find((label) => label.startsWith('platform/'));
if (scope && existing.get(scope).exclusive !== true) {
  throw new Error(`Configure Forgejo label ${scope} as exclusive`);
}

const ids = wanted.map((label) => existing.get(label).id);
await forgejo('POST', `/issues/${issueNumber}/labels`, { json: { labels: ids } });
console.log(`Applied ${wanted.join(', ')} to issue #${issueNumber}`);

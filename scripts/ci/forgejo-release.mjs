import { createWriteStream, openAsBlob } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { forgejo as request } from '../lib/forgejo.mjs';

const getRelease = (tag) =>
  request('GET', `/releases/tags/${encodeURIComponent(tag)}`, { allow404: true });

async function requireRelease(tag) {
  const release = await getRelease(tag);
  if (!release) throw new Error(`Release ${tag} does not exist`);
  return release;
}

async function ensureRelease(tag, { sha, title, notes, prerelease }) {
  const existing = await getRelease(tag);
  if (existing) {
    console.log(`Reusing the existing ${tag} release.`);
    return existing;
  }
  try {
    const created = await request('POST', '/releases', {
      json: {
        tag_name: tag,
        target_commitish: sha,
        name: title ?? tag,
        body: notes ?? '',
        draft: false,
        prerelease: Boolean(prerelease),
      },
    });
    console.log(`Created release ${tag}.`);
    return created;
  } catch (error) {
    const raced = await getRelease(tag);
    if (!raced) throw error;
    console.log(`Reusing the ${tag} release another run created.`);
    return raced;
  }
}

async function waitForRelease(tag, attempts, intervalMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const release = await getRelease(tag);
    if (release) {
      console.log(`Release ${tag} found.`);
      return release;
    }
    console.log(`Waiting for release ${tag} to be published (${attempt}/${attempts})…`);
    await sleep(intervalMs);
  }
  throw new Error(`Release ${tag} was not found.`);
}

async function uploadAssets(tag, files) {
  const release = await requireRelease(tag);
  for (const file of files) {
    const name = basename(file);
    const stale = release.assets?.find((asset) => asset.name === name);
    if (stale) await request('DELETE', `/releases/${release.id}/assets/${stale.id}`);

    const form = new FormData();
    form.append('attachment', await openAsBlob(file), name);
    await request('POST', `/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      body: form,
    });
    console.log(`Uploaded ${name}`);
  }
}

async function listAssets(tag) {
  const release = await getRelease(tag);
  return release?.assets ?? [];
}

async function downloadAssets(tag, pattern, directory) {
  const matcher = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
  );
  const assets = (await listAssets(tag)).filter((asset) => matcher.test(asset.name));
  for (const asset of assets) {
    const response = await fetch(asset.browser_download_url, {
      headers: { Authorization: `token ${process.env.FORGEJO_TOKEN}` },
    });
    if (!response.ok) throw new Error(`Downloading ${asset.name} failed: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(join(directory, asset.name)));
    console.log(`Downloaded ${asset.name}`);
  }
}

async function findPrevious(assetName, excludeTag) {
  const releases = await request('GET', '/releases?limit=100');
  for (const release of releases ?? []) {
    if (release.draft || release.prerelease) continue;
    if (release.tag_name === excludeTag) continue;
    if (release.assets?.some((asset) => asset.name === assetName)) return release.tag_name;
  }
  return '';
}

async function listReleases() {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = await request('GET', `/releases?limit=50&page=${page}`);
    if (!batch?.length) return releases;
    releases.push(...batch);
  }
}

// Deleting a release drops its attachments but leaves a tag-only entry behind,
// which then has to go through the tags endpoint.
async function pruneNightlies(keep, currentTag, protectedTags) {
  const nightlies = (await listReleases())
    .filter((release) => release.prerelease && release.tag_name.startsWith('nightly-'))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const release of nightlies.slice(keep)) {
    if (release.tag_name === currentTag || protectedTags.includes(release.tag_name)) continue;
    await request('DELETE', `/releases/${release.id}`);
    await request('DELETE', `/tags/${encodeURIComponent(release.tag_name)}`, { allow404: true });
    console.log(`Pruned ${release.tag_name}`);
  }
}

async function editRelease(tag, { title, notes, prerelease }) {
  const release = await requireRelease(tag);
  await request('PATCH', `/releases/${release.id}`, {
    json: {
      ...(title !== undefined && { name: title }),
      ...(notes !== undefined && { body: notes }),
      ...(prerelease !== undefined && { prerelease }),
    },
  });
  console.log(`Updated release ${tag}.`);
}

async function waitForAssets(tag, names, attempts, intervalMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const present = new Set((await listAssets(tag)).map((asset) => asset.name));
    const missing = names.filter((name) => !present.has(name));
    if (missing.length === 0) {
      console.log(`All ${names.length} expected asset(s) are present.`);
      return;
    }
    console.log(`Waiting for ${missing.join(', ')} (${attempt}/${attempts})…`);
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${names.join(', ')}`);
}

const { values: flags, positionals } = parseArgs({
  options: Object.fromEntries(
    [
      'tag',
      'sha',
      'title',
      'notes',
      'prerelease',
      'attempts',
      'interval',
      'names',
      'pattern',
      'dir',
      'asset',
      'keep',
      'protect',
    ].map((name) => [name, { type: 'string' }])
  ),
  allowPositionals: true,
});
const [command, ...files] = positionals;
const tag = flags.tag ?? process.env.TAG;
const attempts = Number(flags.attempts ?? 60);
const interval = Number(flags.interval ?? 15) * 1000;

switch (command) {
  case 'ensure':
    await ensureRelease(tag, {
      sha: flags.sha,
      title: flags.title,
      notes: flags.notes,
      prerelease: flags.prerelease === 'true',
    });
    break;
  case 'wait':
    await waitForRelease(tag, attempts, interval);
    break;
  case 'wait-assets':
    await waitForAssets(tag, flags.names.split(',').filter(Boolean), attempts, interval);
    break;
  case 'upload':
    await uploadAssets(tag, files);
    break;
  case 'download':
    await downloadAssets(tag, flags.pattern, flags.dir ?? '.');
    break;
  case 'edit':
    await editRelease(tag, {
      title: flags.title,
      notes: flags.notes,
      ...(flags.prerelease !== undefined && { prerelease: flags.prerelease === 'true' }),
    });
    break;
  case 'find-previous':
    console.log(await findPrevious(flags.asset, tag));
    break;
  case 'prune': {
    const keep = Number(flags.keep);
    if (!Number.isInteger(keep) || keep <= 0) {
      console.error(`--keep must be a positive integer (got: ${flags.keep})`);
      process.exit(1);
    }
    await pruneNightlies(keep, tag, (flags.protect ?? '').split(',').filter(Boolean));
    break;
  }
  case 'body':
    console.log((await requireRelease(tag)).body ?? '');
    break;
  default:
    console.error(
      'Usage: forgejo-release.mjs <ensure|wait|wait-assets|upload|download|find-previous|prune|edit|body> [flags]'
    );
    process.exit(1);
}

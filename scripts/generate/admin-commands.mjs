import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'smol-toml';

const tag = process.argv[2] ?? 'v26.9.0';
const repository = 'https://forgejo.ellis.link/continuwuation/continuwuity.git';
const output = join(import.meta.dirname, '../../src/lib/features/composer/admin-commands.json');
const dump = join(import.meta.dirname, 'admin-commands-dump.rs');
const restrictions = join(import.meta.dirname, 'sable_admin_commands/restrictions.rs');
const checkout = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
  'sable',
  `continuwuity-${tag}`
);

if (!existsSync(checkout)) {
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', tag, repository, checkout], {
    stdio: 'inherit',
  });
}
const manifest = join(checkout, 'xtask/Cargo.toml');
const xtask = parse(await readFile(manifest, 'utf8'));
xtask.dependencies ??= {};
Object.assign(xtask.dependencies, {
  ruma: { workspace: true },
  serde: { workspace: true },
  serde_json: { workspace: true },
  syn: { version: '2', features: ['full', 'visit'] },
});
await writeFile(manifest, stringify(xtask));
await mkdir(join(checkout, 'xtask/examples'), { recursive: true });
await copyFile(dump, join(checkout, 'xtask/examples/sable_admin_commands.rs'));
await mkdir(join(checkout, 'xtask/examples/sable_admin_commands'), { recursive: true });
await copyFile(restrictions, join(checkout, 'xtask/examples/sable_admin_commands/restrictions.rs'));

execFileSync(
  'cargo',
  ['build', '--quiet', '-p', 'conduwuit', '-p', 'xtask', '--example', 'sable_admin_commands'],
  { cwd: checkout, stdio: 'inherit' }
);
const generated = JSON.parse(
  execFileSync(join(checkout, 'target/debug/examples/sable_admin_commands'), [checkout], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
);

function findAll(node, name) {
  const matches = [];
  for (const child of node.children ?? []) {
    if (child.name === name && !child.children) matches.push(child);
    matches.push(...findAll(child, name));
  }
  return matches;
}

function markRestricted(node) {
  node.restricted = true;
  for (const child of node.children ?? []) markRestricted(child);
}

const root = { name: 'admin', children: generated.commands };
for (const group of generated.restrictions) {
  const node = root.children.find((child) => child.name === group.name);
  if (!node) throw new Error(`no command group ${group.name}`);
  if (group.restricted) {
    markRestricted(node);
    continue;
  }

  for (const handler of group.handlers) {
    const matches = findAll(node, handler.replaceAll('_', '-'));
    if (matches.length > 1) {
      throw new Error(`${group.module}: ${handler} matches ${matches.length} commands`);
    }
    if (matches.length === 0) {
      console.warn(`${group.module}: ${handler} is not a visible command, skipped`);
      continue;
    }
    matches[0].restricted = true;
  }
}

function serialize(node) {
  return {
    name: node.name,
    description: node.description,
    ...(node.restricted ? { restricted: true } : {}),
    ...(node.aliases?.length ? { aliases: node.aliases } : {}),
    ...(node.parameters ? { parameters: node.parameters } : {}),
    ...(node.children ? { children: node.children.map(serialize) } : {}),
  };
}

await writeFile(
  output,
  `${JSON.stringify({ version: tag, commands: root.children.map(serialize) }, null, 2)}\n`
);

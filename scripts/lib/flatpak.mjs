function usageError(message) {
  console.error(message);
  process.exit(1);
}

export function parseArches(x86_64, aarch64, { sized }) {
  const arches = {};
  for (const [arch, value] of Object.entries({ x86_64, aarch64 })) {
    if (value === '-') {
      arches[arch] = null;
      continue;
    }
    const [sha, sizeText] = sized ? value.split(':') : [value];
    if (!/^[0-9a-f]{64}$/.test(sha ?? '')) {
      usageError(`${arch}: expected a 64-character sha256 (got: ${sha})`);
    }
    const size = Number(sizeText);
    if (sized && (!Number.isInteger(size) || size <= 0)) {
      usageError(`${arch}: expected a positive integer size (got: ${sizeText})`);
    }
    arches[arch] = { sha, size };
  }
  if (!arches.x86_64 && !arches.aarch64) usageError('At least one architecture must be published.');
  return arches;
}

export function assertSubstituted(manifest) {
  const leftover = manifest.match(/@[A-Z0-9_]+@/);
  if (leftover) throw new Error(`Unsubstituted placeholder left in the manifest: ${leftover[0]}`);
}

const flavors = {
  tauri: {
    stable: ['packaging/flatpak', 'moe.sable.client'],
    nightly: ['packaging/flatpak/nightly', 'moe.sable.next.Nightly'],
  },
  electron: {
    stable: ['packaging/flatpak/electron', 'moe.sable.next.electron'],
    nightly: ['packaging/flatpak/electron/nightly', 'moe.sable.next.electron.Nightly'],
  },
};

export function flatpakFlavor(argv, channel) {
  const electron = argv.includes('--electron');
  const [dir, id] = flavors[electron ? 'electron' : 'tauri'][channel];
  return { args: argv.filter((arg) => arg !== '--electron'), dir, id };
}

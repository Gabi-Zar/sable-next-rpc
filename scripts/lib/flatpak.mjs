import { isScalar, isSeq, parseDocument, visit } from 'yaml';

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

export function renderSources(template, arches, sourceType) {
  for (const [arch, values] of Object.entries(arches)) {
    const suffix = arch.toUpperCase();
    template = template
      .replaceAll(`@SHA256_${suffix}@`, values?.sha ?? '')
      .replaceAll(`@SIZE_${suffix}@`, String(values?.size ?? 0));
  }
  const document = parseDocument(template);
  if (document.errors.length) throw document.errors[0];
  const removed = new Set();
  visit(document, {
    Map(_, source) {
      if (source.get('type') !== sourceType) return;
      const onlyArches = source.get('only-arches');
      if (!isSeq(onlyArches) || !onlyArches.items.length) return;
      onlyArches.items = onlyArches.items.filter((item) => {
        if (!isScalar(item) || arches[item.value] !== null) return true;
        removed.add(item.value);
        return false;
      });
      if (!onlyArches.items.length) return visit.REMOVE;
    },
  });
  for (const [arch, values] of Object.entries(arches)) {
    if (!values && !removed.has(arch)) {
      throw new Error(`Could not find the ${arch} ${sourceType} source to drop.`);
    }
  }
  const manifest = document.toString({ lineWidth: 0 });
  assertSubstituted(manifest);
  return manifest;
}

const flavors = {
  stable: ['packaging/flatpak', 'moe.sable.client'],
  nightly: ['packaging/flatpak/electron/nightly', 'moe.sable.next.electron.Nightly'],
};

export function flatpakTarget(channel) {
  const [dir, id] = flavors[channel];
  return { dir, id };
}

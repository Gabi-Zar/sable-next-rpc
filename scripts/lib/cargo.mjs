import { parse } from 'smol-toml';

export function cargoRustFlags(config, target) {
  const flags = parse(config).target?.[target]?.rustflags ?? [];
  if (!Array.isArray(flags) || flags.some((flag) => typeof flag !== 'string')) {
    throw new Error(`target.${target}.rustflags must be an array of strings`);
  }
  return flags;
}

export function cargoPackageVersion(lockfile, name) {
  return parse(lockfile).package?.find((entry) => entry.name === name)?.version;
}

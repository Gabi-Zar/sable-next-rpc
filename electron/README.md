# Electron packaging and update metadata

Build the web assets with `pnpm build`, then run
`pnpm --dir electron package --linux` or `pnpm --dir electron package --mac`.
Set `VERSION` to override the root package version. macOS builds include a DMG and an update ZIP.

Update feeds:

- Stable: `https://git.sable.moe/SableClient/sable-next/releases/download/latest/`
- Nightly: `https://git.sable.moe/SableClient/sable-next/releases/download/nightly/`

Packaging generates `latest-mac.yml` and `latest-linux.yml`; versions containing
`-nightly.` use `nightly` instead of `latest`. `--publish never` disables
electron-builder uploads but still generates these manifests.

CI runs `node electron/publish-updates.mjs` with `TAG`, `VERSION`, `SHA` and
`FORGEJO_TOKEN`. The tagged release must exist. `FORGEJO_URL` and
`FORGEJO_REPOSITORY` default to this repository.

The script uploads installers and blockmaps to the tagged release, then publishes
channel manifests with versioned download URLs. Failed uploads leave the channel
manifest unchanged. Nightly pruning preserves releases referenced by those manifests.

The Electron main process does not yet check for or install updates.

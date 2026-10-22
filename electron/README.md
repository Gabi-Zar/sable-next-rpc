# Electron packaging and update metadata

Build the web assets with `pnpm build`, then run
`pnpm --dir electron package --linux`, `--mac` or `--win`.
Set `VERSION` to override the root package version. macOS builds include a DMG and an update ZIP.
For a stable package, build the web assets and package with `SABLE_BUILD_FLAVOR=stable`.

`package.mjs` picks `electron-builder.stable.yml` or `electron-builder.nightly.yml`, both
extending `electron-builder.yml`, from `SABLE_BUILD_FLAVOR`: only `stable` builds the stable
package. Stable builds keep the Tauri identity (`moe.sable.client`) and its data directory;
nightlies keep the Tauri nightly identity (`moe.sable.next.nightly`) and install alongside
stable as `Sable Nightly`.
On first launch the app copies the Tauri app's permission grants, telemetry consent and
smooth-scrolling choice (`src/tauri-import.ts`).

Update feeds:

- Stable: `https://git.sable.moe/SableClient/sable-next/releases/download/latest/`
- Nightly: `https://git.sable.moe/SableClient/sable-next/releases/download/nightly/`

Packaging generates `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` and `latest.yml` (Windows); versions containing
`-nightly.` use `nightly` instead of `latest`. `--publish never` disables
electron-builder uploads but still generates these manifests.

CI runs `node electron/publish-updates.mjs` with `TAG`, `VERSION`, `SHA` and
`FORGEJO_TOKEN`. The tagged release must exist. `FORGEJO_URL` and
`FORGEJO_REPOSITORY` default to this repository.

The script uploads installers and blockmaps to the tagged release, then publishes
channel manifests with versioned download URLs. Failed uploads leave the channel
manifest unchanged. Nightly pruning preserves releases referenced by those manifests.

The main process uses `electron-updater` with the feed for the channel chosen in
Settings → About. Stable macOS releases are signed and notarized, so they can install updates. Nightlies built without the signing secrets are unsigned and cannot.

{
  lib,
  stdenv,
  src,
  rustPlatform,
  fetchPnpmDeps,
  pnpm_12,
  pnpmConfigHook,
  nodejs_26,
  wasm-bindgen-cli_0_2_129,
  binaryen,
  lld,
  sable-deepfilternet-assets,
}:

let
  pnpm = pnpm_12;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "sable-unwrapped";
  inherit (lib.importJSON ../../package.json) version;
  inherit src;

  __structuredAttrs = true;
  strictDeps = true;

  cargoDeps = rustPlatform.fetchCargoVendor {
    inherit (finalAttrs) src;
    hash = "sha256-VjcxMUm8JGLEbGDWqddpG6QKhM7KTcWR8T1nogb53gw=";
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-eQE4n/RzXM2p0oFB6P3P/eA8CG/eiTku7mmZRAKctrU=";
  };

  postPatch = ''
    cp --no-preserve all -r ${sable-deepfilternet-assets} static/deepfilternet3
  '';

  nativeBuildInputs = [
    pnpm
    (pnpmConfigHook.override { inherit pnpm; })
    nodejs_26
    wasm-bindgen-cli_0_2_129
    binaryen
    lld
    rustPlatform.rust.rustc
    rustPlatform.rust.cargo
    rustPlatform.cargoSetupHook
  ];

  env.VITE_BUILD_HASH = src.shortRev or src.dirtyShortRev or "";

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';

  meta = {
    description = "Sable rewrite in Rust and Svelte. An almost stable Matrix client";
    homepage = "https://git.sable.moe/SableClient/sable-next";
    license = lib.licenses.agpl3Plus;
    maintainers = with lib.maintainers; [ quadradical ];
    platforms = lib.platforms.all;
  };
})

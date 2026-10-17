{
  lib,
  stdenv,
  sable-unwrapped,
  nodejs_26,
  cacert,
}:

stdenv.mkDerivation {
  pname = "sable-deepfilternet-assets";
  inherit (sable-unwrapped) version src;

  __structuredAttrs = true;
  strictDeps = true;

  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  outputHash = "sha256-Qq209UVT88O064TorOgv3a6Id1EAS+owVFRpG85fLH0=";

  nativeBuildInputs = [
    nodejs_26
    cacert
  ];

  installPhase = ''
    node scripts/build/fetch-deepfilternet.mjs
    mv static/deepfilternet3 $out
  '';

  meta = {
    description = "Noise suppression using deep filtering for Sable";
    homepage = "https://github.com/Rikorose/DeepFilterNet";
    license = with lib.licenses; [
      mit
      asl20
    ];
    maintainers = with lib.maintainers; [ quadradical ];
    sourceProvenance = with lib.sourceTypes; [ binaryBytecode ];
  };
}

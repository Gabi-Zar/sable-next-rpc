import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { downloadVerified, sha256 } from '../lib/download.mjs';

const assetsDir = join(import.meta.dirname, '../../static/deepfilternet3');

const assets = [
  {
    path: 'v3/pkg/df_bg.wasm',
    url: 'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3/pkg/df_bg.wasm',
    sha256: '440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432',
  },
  {
    path: 'v3/models/DeepFilterNet3_onnx.tar.gz',
    url: 'https://github.com/Rikorose/DeepFilterNet/raw/84d57ec2c08fe08e68a13fb32a58cd7092060a0f/models/DeepFilterNet3_onnx.tar.gz',
    sha256: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616',
  },
];

/** @param {{ path: string; url: string; sha256: string }} asset */
async function provision({ path, url, sha256: expected }) {
  const target = join(assetsDir, path);
  const existing = await readFile(target).catch(() => undefined);
  if (existing && sha256(existing) === expected) return;

  const bytes = await downloadVerified(url, expected);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, bytes);
  await rename(`${target}.tmp`, target);
}

export async function fetchDeepFilterNet() {
  for (const asset of assets) await provision(asset);
}

if (import.meta.main) await fetchDeepFilterNet();

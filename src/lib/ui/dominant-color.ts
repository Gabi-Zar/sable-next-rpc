import { convertHslToRgb, convertRgbToHsl } from 'culori/fn';

const SAMPLE_SIZE = 32;
const BUCKETS = 4096;
const MIN_ALPHA = 16;
const DARKEN = 0.8;

function bucketPixels(data: Uint8ClampedArray): {
  counts: Uint16Array;
  totals: Uint32Array;
} {
  const counts = new Uint16Array(BUCKETS);
  const totals = new Uint32Array(BUCKETS * 3);

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < MIN_ALPHA) continue;
    const key =
      Math.trunc(data[index] / 16) * 256 +
      Math.trunc(data[index + 1] / 16) * 16 +
      Math.trunc(data[index + 2] / 16);
    const slot = key * 3;
    counts[key] += 1;
    totals[slot] += data[index];
    totals[slot + 1] += data[index + 1];
    totals[slot + 2] += data[index + 2];
  }

  return { counts, totals };
}

function bestBucket(counts: Uint16Array, totals: Uint32Array): number | null {
  let bestScore = -1;
  let best: number | null = null;

  for (let key = 0; key < BUCKETS; key += 1) {
    const count = counts[key];
    if (count === 0) continue;
    const slot = key * 3;
    const red = totals[slot] / count;
    const green = totals[slot + 1] / count;
    const blue = totals[slot + 2] / count;

    const chroma = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
    const luma = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    const midtone = Math.max(0.2, 1 - Math.abs(luma - 0.5) * 1.2);
    const score = count * (1 + chroma * 2) * midtone;

    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }

  return best;
}

function darken(red: number, green: number, blue: number): string {
  const color = convertRgbToHsl({ r: red / 255, g: green / 255, b: blue / 255 });
  const { r, g, b } = convertHslToRgb({
    h: Math.round(color.h ?? 0),
    s: color.s,
    l: color.l * DARKEN,
  });
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function plateColor(data: Uint8ClampedArray): string | null {
  const { counts, totals } = bucketPixels(data);
  const key = bestBucket(counts, totals);
  if (key === null) return null;

  return darken(
    Math.trunc(key / 256) * 16 + 8,
    (Math.trunc(key / 16) % 16) * 16 + 8,
    (key % 16) * 16 + 8
  );
}

export function dominantColor(image: HTMLImageElement): string | null {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return plateColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  }
}

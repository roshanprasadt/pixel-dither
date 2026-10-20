/**
 * Pixel Dither: the image pipeline, with no DOM in it, so it runs the same
 * in a browser, a worker or Node, and can be used as a library.
 *
 *   shrink (done by the caller, onto a small canvas)
 *   → palette: the image's own colours (k-means) or a preset
 *   → ordered dither: each pixel nudged by a Bayer matrix, then snapped to
 *     its nearest palette colour
 *
 * Ordered dithering is what gives the look: smooth gradients become
 * checkerboards and evenly spaced dot fields. Error diffusion
 * (Floyd–Steinberg) is the usual alternative, and reads as noise.
 *
 * @typedef {[number, number, number]} RGB
 * @typedef {{ data: Uint8ClampedArray, width: number, height: number }} Pixels
 */

/** Builds an n by n Bayer matrix (n a power of two), as -0.5 to 0.5. */
export function bayer(n) {
  let matrix = [[0]];
  while (matrix.length < n) {
    const size = matrix.length;
    const next = Array.from({ length: size * 2 }, () => new Array(size * 2));
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const v = matrix[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    }
    matrix = next;
  }
  const cells = n * n;
  return matrix.map((row) => row.map((v) => (v + 0.5) / cells - 0.5));
}

const distance = (a, b) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * The image's own palette of `count` colours: k-means, seeded k-means++
 * from a fixed generator, so the same image and count always give the
 * same palette. Fully transparent pixels are ignored.
 *
 * @param {Pixels} pixels
 * @param {number} count
 * @returns {RGB[]}
 */
export function findPalette(pixels, count, rounds = 10) {
  const { data } = pixels;
  /** @type {RGB[]} */
  const points = [];
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] > 0) points.push([data[i], data[i + 1], data[i + 2]]);
  if (points.length === 0) return [[0, 0, 0]];
  count = Math.max(1, Math.min(count, points.length));

  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const centres = [points[Math.floor(random() * points.length)].slice()];
  const nearest = points.map((p) => distance(p, centres[0]));
  while (centres.length < count) {
    const total = nearest.reduce((sum, d) => sum + d, 0);
    if (total === 0) break; // fewer distinct colours than asked for
    let pick = random() * total;
    let index = 0;
    while (index < points.length - 1 && pick > nearest[index]) {
      pick -= nearest[index];
      index += 1;
    }
    centres.push(points[index].slice());
    for (let i = 0; i < points.length; i += 1)
      nearest[i] = Math.min(nearest[i], distance(points[i], points[index]));
  }

  for (let round = 0; round < rounds; round += 1) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < centres.length; i += 1) {
        const d = distance(p, centres[i]);
        if (d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
      const sum = sums[best];
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      sum[3] += 1;
    }
    sums.forEach((sum, i) => {
      if (sum[3]) centres[i] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    });
  }
  return /** @type {RGB[]} */ (centres.map((c) => c.map(Math.round)));
}

/** The average gap from each palette colour to its nearest neighbour. */
function typicalGap(palette) {
  if (palette.length < 2) return 0;
  let total = 0;
  for (const a of palette) {
    let closest = Infinity;
    for (const b of palette) if (a !== b) closest = Math.min(closest, distance(a, b));
    total += Math.sqrt(closest);
  }
  return total / palette.length;
}

/**
 * Dithers `pixels` to `palette`, in place, and returns them.
 *
 * @param {Pixels} pixels
 * @param {RGB[]} palette
 * @param {{ strength?: number, matrix?: number }} [options]
 *   strength: 0 (flat bands) to 1 (strong patterning); matrix: 2, 4 or 8,
 *   or 0 for none.
 */
export function dither(pixels, palette, { strength = 0.6, matrix = 8 } = {}) {
  const { data, width, height } = pixels;
  const thresholds = matrix ? bayer(matrix) : [[0]];
  const size = thresholds.length;
  // How far a pixel may be nudged: the palette's own spacing, so the
  // setting feels the same with 4 colours or 16.
  const spread = matrix ? typicalGap(palette) * strength * 1.6 : 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const nudge = thresholds[y % size][x % size] * spread;
      const r = data[i] + nudge;
      const g = data[i + 1] + nudge;
      const b = data[i + 2] + nudge;
      let best = palette[0];
      let bestDistance = Infinity;
      for (const c of palette) {
        const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (d < bestDistance) {
          best = c;
          bestDistance = d;
        }
      }
      data[i] = best[0];
      data[i + 1] = best[1];
      data[i + 2] = best[2];
      data[i + 3] = data[i + 3] < 128 ? 0 : 255;
    }
  }
  return pixels;
}

/** Preset palettes, as hex. Their own names; no attribution needed. */
export const PRESETS = {
  "1-bit": ["#000000", "#ffffff"],
  "Game Boy": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  "PICO-8": [
    "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f",
    "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436",
    "#29adff", "#83769c", "#ff77a8", "#ffccaa",
  ],
  Dusk: ["#0d0b14", "#2a2140", "#4f3a63", "#8c5a7a", "#d98b78", "#f4c48f", "#f9ead0"],
};

/** "#rrggbb" → [r, g, b] */
export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return /** @type {RGB} */ ([(value >> 16) & 255, (value >> 8) & 255, value & 255]);
}

/** [r, g, b] → "#rrggbb" */
export function rgbToHex([r, g, b]) {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

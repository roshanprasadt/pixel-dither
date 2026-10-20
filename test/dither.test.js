import assert from "node:assert/strict";
import test from "node:test";

import { bayer, dither, findPalette, hexToRgb, rgbToHex } from "../src/dither.js";

const pixels = (rgbs, width) => {
  const data = new Uint8ClampedArray(rgbs.length * 4);
  rgbs.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  return { data, width, height: rgbs.length / width };
};

test("bayer matrices hold every threshold once, centred on zero", () => {
  for (const n of [2, 4, 8]) {
    const flat = bayer(n).flat();
    assert.equal(new Set(flat).size, n * n);
    assert.ok(Math.abs(flat.reduce((a, b) => a + b, 0)) < 1e-9);
  }
});

test("the palette is the image's own colours", () => {
  const image = pixels([[255, 0, 0], [250, 5, 5], [0, 0, 255], [5, 5, 250]], 2);
  const palette = findPalette(image, 2).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(palette, [[3, 3, 253], [253, 3, 3]]);
});

test("the palette is repeatable", () => {
  const rgbs = Array.from({ length: 64 }, (_, i) => [i * 4, 255 - i * 4, (i * 37) % 256]);
  assert.deepEqual(findPalette(pixels(rgbs, 8), 5), findPalette(pixels(rgbs, 8), 5));
});

test("every dithered pixel is a palette colour", () => {
  const rgbs = Array.from({ length: 256 }, (_, i) => [i, i, i]);
  const palette = [[0, 0, 0], [128, 128, 128], [255, 255, 255]];
  const { data } = dither(pixels(rgbs, 16), palette, { strength: 1, matrix: 8 });
  const allowed = new Set(palette.map(rgbToHex));
  for (let i = 0; i < data.length; i += 4)
    assert.ok(allowed.has(rgbToHex([data[i], data[i + 1], data[i + 2]])));
});

test("a mid grey dithers to an even mix of black and white", () => {
  const rgbs = Array.from({ length: 64 }, () => [128, 128, 128]);
  const { data } = dither(pixels(rgbs, 8), [[0, 0, 0], [255, 255, 255]], { strength: 1, matrix: 8 });
  let white = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] === 255) white += 1;
  assert.ok(white >= 28 && white <= 36, `white cells: ${white}`);
});

test("hex round-trips", () => {
  assert.deepEqual(hexToRgb("#1d2b53"), [29, 43, 83]);
  assert.equal(rgbToHex([29, 43, 83]), "#1d2b53");
});

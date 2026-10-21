/**
 * The sample pictures: four images generated for this project by Roshan
 * Prasad with Google Gemini (see the README), each a different colour story
 * so the examples show different palettes. The tool opens on the jellyfish,
 * an iridescent glass one on indigo (it replaced a tower in fog, 21 Oct
 * 2026: flat mid-tones dithered to a grey texture; a glow on a dark
 * gradient shows the patterns off). All four are portrait, 4:5. One drawing
 * is kept in code, the mountains, as the fallback when the jellyfish
 * cannot be fetched (offline before it was ever cached).
 */

/** Loads a sample picture from `samples/`. */
function photo(file) {
  return () =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `samples/${file}`;
    });
}

export const jellyfish = photo("jellyfish.jpg");

/** A small fixed random generator, so a sample is the same on every visit. */
function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function canvas(width, height) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return [element, element.getContext("2d")];
}

/** Dusk over mountains: a sky of soft clouds and two ridges. */
export function landscape() {
  const [element, ctx] = canvas(900, 1400);
  const sky = ctx.createLinearGradient(0, 0, 0, 1400);
  sky.addColorStop(0, "#1f4a68");
  sky.addColorStop(0.5, "#9cc3d2");
  sky.addColorStop(0.62, "#d6e3e2");
  sky.addColorStop(0.75, "#5f8fa5");
  sky.addColorStop(1, "#28485a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 900, 1400);
  const random = seeded(3);
  for (let i = 0; i < 70; i += 1) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = i % 3 ? "#efe3d2" : "#9aa4b5";
    ctx.beginPath();
    ctx.ellipse(120 + random() * 660, 60 + random() * 260, 70 + random() * 90, 18 + random() * 22, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const ridge = (color, base, peaks) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 1400);
    peaks.forEach(([x, y]) => ctx.lineTo(x, base + y));
    ctx.lineTo(900, 1400);
    ctx.fill();
  };
  ridge("#4d7f97", 900, [[0, 120], [160, 40], [300, 90], [470, 10], [620, 80], [780, 30], [900, 70]]);
  ridge("#120d08", 1000, [[0, 20], [220, 180], [430, 330], [560, 260], [720, 170], [900, 120]]);
  return element;
}

/** The settings every sample opens with, unless it has its own. */
export const DEFAULT_SETTINGS = {
  cells: 144, strength: 60, matrix: 8, mode: "auto", colours: 10, scale: "auto",
};

/**
 * `settings`: a sample's own look, applied whenever it is picked (Roshan
 * chose the dunes': finer pixels, more dither, 15 colours, exported at 8×).
 *
 * `crop`: how much of a sample may be cut away to fill the frame. All four
 * are framed tight, so they fill only when the frame is nearly their own
 * shape and are otherwise shown whole.
 */
export const SAMPLES = [
  {
    id: "jellyfish", name: "Jellyfish", file: "samples/jellyfish.jpg", load: jellyfish, crop: 0.25,
    // Finer, so the tentacles stay threads rather than a blob.
    settings: { cells: 180, strength: 70, matrix: 8, mode: "auto", colours: 14, scale: "auto" },
  },
  { id: "bust", name: "Marble bust", file: "samples/bust.jpg", load: photo("bust.jpg"), crop: 0.25 },
  { id: "chrome", name: "Chrome knot", file: "samples/chrome.jpg", load: photo("chrome.jpg"), crop: 0.25 },
  {
    id: "dunes", name: "Dunes at dusk", file: "samples/dunes.jpg", load: photo("dunes.jpg"), crop: 0.25,
    settings: { cells: 180, strength: 70, matrix: 8, mode: "auto", colours: 15, scale: "8" },
  },
];

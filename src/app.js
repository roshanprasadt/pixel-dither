import { dither, findPalette, hexToRgb, PRESETS, rgbToHex } from "./dither.js";

/*
 * Pixel Dither: the page. Reads an image (file, drop or paste), shrinks it
 * to the grid, hands the pixels to dither.js, and draws the result at the
 * grid's own size, scaled up with `image-rendering: pixelated` so every
 * cell is a crisp square. Nothing is uploaded: the image only ever lives
 * in this page's canvases.
 */

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"),
  output: $("output"),
  original: $("original"),
  empty: $("empty"),
  badge: $("badge"),
  file: $("file"),
  sample: $("sample"),
  swatches: $("swatches"),
  cells: $("cells"),
  mode: $("mode"),
  colours: $("colours"),
  coloursField: $("colours-field"),
  strength: $("strength"),
  matrix: $("matrix"),
  scale: $("scale"),
  download: $("download"),
  copy: $("copy"),
  compare: $("compare"),
  status: $("status"),
  install: $("install"),
};

const SETTINGS_KEY = "pixel-dither:settings";
const CONTROLS = ["cells", "mode", "colours", "strength", "matrix", "scale"];

/** @type {HTMLImageElement | HTMLCanvasElement | null} */
let source = null;
let sourceName = "image";
let frame = 0;

// Settings are remembered per browser; a convenience, so failures are fine.
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  for (const key of CONTROLS) if (key in saved) els[key].value = saved[key];
} catch {}
const save = () => {
  try {
    const values = Object.fromEntries(CONTROLS.map((key) => [key, els[key].value]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(values));
  } catch {}
};

const say = (text) => {
  els.status.textContent = text;
};

/**
 * Shrinks the source to `cols` across. Big reductions are done by halving
 * first, since one large downscale on a canvas skips pixels and aliases.
 */
function shrink(image, cols) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const rows = Math.max(1, Math.round((cols * height) / width));
  let current = image;
  let w = width;
  let h = height;
  while (w / 2 > cols * 2) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = document.createElement("canvas");
    step.width = w;
    step.height = h;
    const ctx = step.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, w, h);
    current = step;
  }
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, cols, rows);
  return ctx.getImageData(0, 0, cols, rows);
}

function render() {
  frame = 0;
  updateLabels();
  if (!source) return;
  const pixels = shrink(source, Number(els.cells.value));
  const mode = els.mode.value;
  const palette =
    mode === "auto"
      ? findPalette(pixels, Number(els.colours.value))
      : PRESETS[mode].map(hexToRgb);
  dither(pixels, palette, {
    strength: Number(els.strength.value) / 100,
    matrix: Number(els.matrix.value),
  });
  els.output.width = pixels.width;
  els.output.height = pixels.height;
  els.output.getContext("2d").putImageData(pixels, 0, 0);
  els.output.setAttribute(
    "aria-label",
    `${sourceName} as pixel art, ${pixels.width} by ${pixels.height} pixels, ${palette.length} colours.`,
  );
  els.swatches.replaceChildren(
    ...palette.map((colour) => {
      const swatch = document.createElement("span");
      swatch.style.background = rgbToHex(colour);
      return swatch;
    }),
  );
}

/** At most one render a frame, however fast a slider is dragged. */
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(render);
};

function updateLabels() {
  $("cells-out").textContent = `${els.cells.value} across`;
  $("colours-out").textContent = els.colours.value;
  $("strength-out").textContent = `${els.strength.value}%`;
  els.coloursField.hidden = els.mode.value !== "auto";
}

function use(image, name) {
  source = image;
  sourceName = name;
  els.empty.hidden = true;
  for (const button of [els.download, els.copy, els.compare]) button.disabled = false;
  // The original, kept for Compare, drawn no larger than the stage needs.
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const fit = Math.min(1, 1600 / Math.max(width, height));
  els.original.width = Math.round(width * fit);
  els.original.height = Math.round(height * fit);
  els.original.getContext("2d").drawImage(image, 0, 0, els.original.width, els.original.height);
  say("");
  schedule();
}

function open(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    say("That is not an image. Try a JPG, PNG, WebP or GIF.");
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    use(image, file.name.replace(/\.[^.]+$/, "") || "image");
    URL.revokeObjectURL(url);
  };
  image.onerror = () => say("That file could not be read as an image.");
  image.src = url;
}

/**
 * The sample is drawn, not downloaded: a dusk sky with clouds over two
 * ridges, so the repository carries no photograph and no licence question.
 */
function drawSample() {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1400;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 1400);
  sky.addColorStop(0, "#1f4a68");
  sky.addColorStop(0.5, "#9cc3d2");
  sky.addColorStop(0.62, "#d6e3e2");
  sky.addColorStop(0.75, "#5f8fa5");
  sky.addColorStop(1, "#28485a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 900, 1400);
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
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
  return canvas;
}

function exportCanvas() {
  const small = els.output;
  const scale =
    els.scale.value === "auto"
      ? Math.max(1, Math.round(1600 / Math.max(small.width, small.height)))
      : Number(els.scale.value);
  const big = document.createElement("canvas");
  big.width = small.width * scale;
  big.height = small.height * scale;
  const ctx = big.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

const toBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

// Inputs
els.file.addEventListener("change", () => {
  open(els.file.files?.[0]);
  els.file.value = "";
});
els.sample.addEventListener("click", () => use(drawSample(), "sample"));
for (const key of CONTROLS)
  els[key].addEventListener("input", () => {
    save();
    schedule();
  });

// Drop anywhere on the stage, or paste from the clipboard.
els.stage.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.stage.classList.add("dragging");
});
els.stage.addEventListener("dragleave", () => els.stage.classList.remove("dragging"));
els.stage.addEventListener("drop", (event) => {
  event.preventDefault();
  els.stage.classList.remove("dragging");
  open(event.dataTransfer?.files?.[0]);
});
document.addEventListener("paste", (event) => {
  const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) open(item.getAsFile());
});

// Output
els.download.addEventListener("click", async () => {
  const blob = await toBlob(exportCanvas());
  if (!blob) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${sourceName}-pixel.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  say("Downloaded.");
});
els.copy.addEventListener("click", async () => {
  try {
    const blob = await toBlob(exportCanvas());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    say("Copied to the clipboard.");
  } catch {
    say("This browser would not copy the image; use Download instead.");
  }
});
els.compare.addEventListener("click", () => {
  const on = els.compare.getAttribute("aria-pressed") !== "true";
  els.compare.setAttribute("aria-pressed", String(on));
  els.original.hidden = !on;
  els.output.hidden = on;
  els.badge.hidden = !on;
});

// Install, where the browser offers it; and offline, through the worker.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  els.install.hidden = false;
});
els.install.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  els.install.hidden = true;
});
if ("serviceWorker" in navigator && location.protocol !== "file:")
  navigator.serviceWorker.register("sw.js").catch(() => {});

updateLabels();

import { dither, findPalette, hexToRgb, PRESETS, rgbToHex } from "./dither.js";
import { DEFAULT_SETTINGS, jellyfish, landscape, SAMPLES } from "./samples.js";

/*
 * Pixel Dither: the page. Reads an image (file, drop or paste), shrinks it
 * to the grid, hands the pixels to dither.js, and paints the result.
 * Nothing is uploaded: the image only ever lives in this page's canvases.
 *
 * Painted, not scaled by CSS. Stretching the grid with `image-rendering:
 * pixelated` lands at a fractional ratio (8.9 screen pixels a cell, say),
 * so some cells came out a pixel wider than others and the picture looked
 * soft. Instead the stage canvas is the screen's own resolution and every
 * cell is drawn a whole number of device pixels, all identical, centred.
 */

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"),
  output: $("output"),
  original: $("original"),
  empty: $("empty"),
  file: $("file"),
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
  views: [...document.querySelectorAll("[data-view]")],
  toast: $("toast"),
  install: $("install"),
};

const SETTINGS_KEY = "pixel-dither:settings";
const CONTROLS = ["cells", "mode", "colours", "strength", "matrix", "scale"];

/** @type {HTMLImageElement | HTMLCanvasElement | null} */
let source = null;
let sourceName = "image";
let frame = 0;
/** The dithered grid at one pixel a cell: painted from, and exported. */
const grid = document.createElement("canvas");
/** Which view the stage shows: the pixel art or the original. */
let view = "pixel";

// Settings are remembered per browser; a convenience, so failures are fine.
// Whether this browser has settings of its own from an earlier visit.
let hasSaved = false;
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  hasSaved = Object.keys(saved).length > 0;
  for (const key of CONTROLS) if (key in saved) els[key].value = saved[key];
} catch {}
const save = () => {
  try {
    const values = Object.fromEntries(CONTROLS.map((key) => [key, els[key].value]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(values));
  } catch {}
};

/**
 * A toast at the foot of the screen: what happened, and a detail. It rises
 * in, holds about three seconds, and fades; a new one replaces it. Paused
 * while the pointer is on it, so it can be read.
 */
let toastTimer = 0;
function toast(title, detail = "", kind = "done") {
  clearTimeout(toastTimer);
  $("toast-title").textContent = title;
  $("toast-detail").textContent = detail;
  els.toast.dataset.kind = kind;
  els.toast.dataset.state = "shown";
  toastTimer = setTimeout(hideToast, kind === "error" ? 4500 : 3000);
}
function hideToast() {
  els.toast.dataset.state = "hidden";
}
els.toast.addEventListener("pointerenter", () => clearTimeout(toastTimer));
els.toast.addEventListener("pointerleave", () => {
  if (els.toast.dataset.state === "shown") toastTimer = setTimeout(hideToast, 1500);
});

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
  grid.width = pixels.width;
  grid.height = pixels.height;
  grid.getContext("2d").putImageData(pixels, 0, 0);
  paint();
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

/**
 * Paints the grid onto the stage at whole device pixels a cell: filling the
 * frame (cropped) for a sample, fitting it whole for a visitor's picture.
 * The original is painted on the same geometry, so Compare lines up.
 */
function paint() {
  if (!grid.width || !source) return;
  const ratio = window.devicePixelRatio || 1;
  const box = els.stage.getBoundingClientRect();
  const fill = els.stage.classList.contains("fill");
  const inset = fill ? 0 : 16;
  const width = Math.round((box.width - inset * 2) * ratio);
  const height = Math.round((box.height - inset * 2) * ratio);
  if (width <= 0 || height <= 0) return;
  // A sample fills the frame only while that crops no more than it allows
  // (`crop` in samples.js): a tall bust in a wide window would lose half of
  // itself, so it is shown whole instead, with the stage's margin round it,
  // like a visitor's own picture.
  const shape = grid.width / grid.height;
  const frame = width / height;
  const allowed = SAMPLES.find((s) => s.id === sampleId)?.crop ?? 0;
  const cover = fill && 1 - Math.min(shape, frame) / Math.max(shape, frame) <= allowed;
  // Shown whole, the picture also stays clear of the bar along the stage's
  // foot (the samples and the view switch), rather than ending under it.
  const pad = fill && !cover ? Math.round(16 * ratio) : 0;
  const foot = cover ? 0 : Math.round((fill ? 56 : 48) * ratio);
  const roomW = width - pad * 2;
  const roomH = height - pad * 2 - foot;
  const exact = cover
    ? Math.max(width / grid.width, height / grid.height)
    : Math.min(roomW / grid.width, roomH / grid.height);
  // Whole device pixels a cell; below one, the grid is simply larger than
  // the frame, and is drawn smaller as it is.
  const cell = exact >= 1 ? (cover ? Math.ceil(exact) : Math.floor(exact)) : exact;
  const drawW = Math.round(grid.width * cell);
  const drawH = Math.round(grid.height * cell);
  const x = Math.round((width - drawW) / 2);
  const top = cover ? 0 : pad;
  const room = cover ? height : roomH;
  // A tall picture cropped to a wide frame keeps more of its top, where a
  // head or a horizon usually is; everything else is centred.
  const y = top + Math.round((room - drawH) * (drawH > room ? 0.3 : 0.5));
  for (const canvas of [els.output, els.original]) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width / ratio}px`;
    canvas.style.height = `${height / ratio}px`;
    const ctx = canvas.getContext("2d");
    const smooth = canvas === els.original || cell < 1;
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas === els.output ? grid : source, x, y, drawW, drawH);
  }
}

function show(next) {
  view = next;
  els.output.hidden = view !== "pixel";
  els.original.hidden = view !== "original";
  for (const button of els.views)
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
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

/** Which sample is showing, if one is; and the last one shown. */
let sampleId = null;
let lastSample = "jellyfish";

function use(image, name, sample = null) {
  source = image;
  sourceName = name;
  sampleId = name === "sample" ? sample : null;
  if (sampleId) lastSample = sampleId;
  // Their picture takes the drop zone's prompt line: its name and Clear.
  $("own").hidden = name === "sample";
  $("drop-title").hidden = name !== "sample";
  $("own-name").textContent = name;
  for (const button of $("picker").children)
    button.setAttribute("aria-pressed", String(button.dataset.sample === sampleId));
  els.empty.hidden = true;
  // While the sample shows, a chip on the picture says so and offers the
  // next step; it goes once someone uses their own picture.
  $("chip").hidden = name !== "sample";
  // A sample fills the frame edge to edge, cropped to fit; a visitor's own
  // picture is always shown whole.
  els.stage.classList.toggle("fill", name === "sample");
  for (const button of [els.download, els.copy, ...els.views]) button.disabled = false;
  schedule();
}

function open(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("That is not an image", "Try a JPG, PNG, WebP or GIF.", "error");
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    use(image, file.name.replace(/\.[^.]+$/, "") || "image");
    URL.revokeObjectURL(url);
  };
  image.onerror = () =>
    toast("That file could not be read", "It may be damaged, or a format this browser cannot open.", "error");
  image.src = url;
}

function exportCanvas() {
  const small = grid;
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

const formatBytes = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const toBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

// Inputs
for (const input of [els.file, $("chip-file")])
  input.addEventListener("change", () => {
    open(input.files?.[0]);
    input.value = "";
  });
/**
 * Each sample is fetched once and kept, so switching between them is
 * instant. The jellyfish falls back to the drawn mountains offline.
 */
const loaded = new Map();
/** Sets the controls to a sample's look (its own, or the defaults). */
function applySettings(sample) {
  const settings = { ...DEFAULT_SETTINGS, ...sample.settings };
  for (const key of CONTROLS) if (key in settings) els[key].value = String(settings[key]);
}

/**
 * Opens a sample. Picking one sets the controls to its look; the first
 * open of a visit leaves a returning visitor's own settings alone.
 */
function openSample(id = "jellyfish", { keepSettings = false } = {}) {
  const sample = SAMPLES.find((s) => s.id === id) ?? SAMPLES[0];
  if (!keepSettings) applySettings(sample);
  if (!loaded.has(sample.id))
    loaded.set(
      sample.id,
      sample.load().catch(() => (sample.id === "jellyfish" ? landscape() : Promise.reject())),
    );
  return loaded.get(sample.id).then(
    (picture) => use(picture, "sample", sample.id),
    () => toast("That sample could not load", "Check your connection and try again.", "error"),
  );
}

// Clearing a visitor's picture goes back to the sample they last saw.
$("clear").addEventListener("click", () => {
  openSample(lastSample);
  toast("Image cleared", "Drop or choose another any time.");
});

// The sample picker on the picture: a thumbnail per sample, the one showing
// pressed. Thumbnails are the sample files themselves, loaded lazily.
for (const sample of SAMPLES) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.sample = sample.id;
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", sample.name);
  button.title = sample.name;
  const thumb = document.createElement("img");
  thumb.src = sample.file;
  thumb.alt = "";
  thumb.loading = "lazy";
  thumb.decoding = "async";
  button.append(thumb);
  button.addEventListener("click", () => openSample(sample.id));
  $("picker").append(button);
}
for (const key of CONTROLS)
  els[key].addEventListener("input", () => {
    save();
    schedule();
  });

// Drop anywhere on the page (the stage lights up), or paste.
document.addEventListener("dragover", (event) => {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
  els.stage.classList.add("dragging");
  $("dropzone").classList.add("dragging");
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) {
    els.stage.classList.remove("dragging");
    $("dropzone").classList.remove("dragging");
  }
});
document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  els.stage.classList.remove("dragging");
  $("dropzone").classList.remove("dragging");
  open(event.dataTransfer.files[0]);
  window.scrollTo({ top: 0 });
});
document.addEventListener("paste", (event) => {
  const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) open(item.getAsFile());
});

// Output
els.download.addEventListener("click", async () => {
  const canvas = exportCanvas();
  const blob = await toBlob(canvas);
  if (!blob) {
    toast("Could not make the PNG", "Try a smaller export size.", "error");
    return;
  }
  const name = `${sourceName}-pixel.png`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Saved ${name}`, `${canvas.width} × ${canvas.height} px · ${formatBytes(blob.size)}`);
});
els.copy.addEventListener("click", async () => {
  try {
    const blob = await toBlob(exportCanvas());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("Copied to the clipboard", "Paste it into Figma, Slack or anywhere.");
  } catch {
    toast("This browser would not copy it", "Use Download PNG instead.", "error");
  }
});
for (const button of els.views)
  button.addEventListener("click", () => show(button.dataset.view));
// The frame changes size with the window; repaint at the new resolution.
new ResizeObserver(() => paint()).observe(els.stage);
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", () => paint());

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
// The worker script itself is never taken from the HTTP cache, so a new
// version is picked up on the next visit rather than whenever the cache
// expires.
if ("serviceWorker" in navigator && location.protocol !== "file:")
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});

updateLabels();

// First visit: open on the sample, already converted, so the first thing a
// visitor sees is the result and every control answers at once. The chip
// on the picture says it is a sample and how to use their own.
openSample("jellyfish", { keepSettings: hasSaved });

/*
 * The section below the tool: examples and how it works, drawn by the same
 * pipeline as the tool, so what it shows is exactly what the tool does.
 * Drawn only when the section nears the screen, so the tool loads first.
 */

/** Draws `pixels` into a new canvas at their own size. */
function toCanvas(pixels) {
  const element = document.createElement("canvas");
  element.width = pixels.width;
  element.height = pixels.height;
  element.getContext("2d").putImageData(pixels, 0, 0);
  return element;
}

function renderExamples() {
  const list = $("examples");
  for (const sample of SAMPLES) {
    const item = document.createElement("li");
    list.append(item);
    sample.load().then((picture) => fillExample(item, sample, picture), () => item.remove());
  }
}

function fillExample(item, sample, picture) {
  const before = toCanvas(shrink(picture, 240));
  // About 72 cells across what the 4:5 card shows, so every card has the
  // same pixel size: a wide picture is cropped, so it needs more in all.
  const shape = (picture.naturalWidth || picture.width) / (picture.naturalHeight || picture.height);
  const after = shrink(picture, Math.round(72 / Math.min(1, 0.8 / shape)));
  const look = { ...DEFAULT_SETTINGS, ...sample.settings };
  dither(after, findPalette(after, Number(look.colours)), {
    strength: Number(look.strength) / 100,
    matrix: Number(look.matrix),
  });

  item.className = "example";
  const pair = document.createElement("div");
  pair.className = "pair";
  before.className = "smooth";
  before.setAttribute("aria-hidden", "true");
  const result = toCanvas(after);
  result.setAttribute("role", "img");
  result.setAttribute("aria-label", `${sample.name}: the smooth picture beside it as pixel art.`);
  pair.append(before, result);
  const caption = document.createElement("div");
  caption.className = "example-caption";
  const name = document.createElement("span");
  name.textContent = sample.name;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "try";
  button.textContent = "Try it";
  button.setAttribute("aria-label", `Open ${sample.name} in the tool`);
  button.addEventListener("click", () => {
    loaded.set(sample.id, Promise.resolve(picture));
    applySettings(sample);
    use(picture, "sample", sample.id);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  });
  caption.append(name, button);
  item.append(pair, caption);
}

async function renderSteps() {
  // The steps follow the picture the tool opens on, the jellyfish.
  const picture = await jellyfish().catch(() => landscape());
  // 1. Shrink: the picture as a coarse grid, before any colour is lost.
  const grid = shrink(picture, 36);
  $("step-shrink").append(toCanvas(grid));
  // 2. Palette: the colours the picture is made of.
  const palette = findPalette(grid, 8);
  $("step-palette").replaceChildren(
    ...palette.map((colour) => {
      const swatch = document.createElement("span");
      swatch.style.background = rgbToHex(colour);
      return swatch;
    }),
  );
  // 3. Dither: a grey ramp in two colours, where the pattern shows plainest.
  const ramp = new ImageData(48, 16);
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 48; x += 1) {
      const v = Math.round((x / 47) * 255);
      ramp.data.set([v, v, v, 255], (y * 48 + x) * 4);
    }
  dither(ramp, [[11, 11, 13], [244, 244, 245]], { strength: 1, matrix: 8 });
  $("step-dither").append(toCanvas(ramp));
}

const about = $("about");
if (about) {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      renderExamples();
      renderSteps();
    },
    { rootMargin: "300px" },
  );
  observer.observe(about);
}

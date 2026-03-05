/* ================================================================
   Wi-Fi Ghost Detection Filter v3 — Application Logic
   ================================================================
   Pipeline: Upload → Edge Map + Luminance Map → Noise (multi-seed)
   → Geometry Shaping (incl. Ghost/Presence) → Activity Zones
   → Color Mapping → Chromatic Aberration → Displacement
   → Blend Mode Compositing → Display
   ================================================================ */

// ─── 1. SIMPLEX NOISE ──────────────────────────────────────────

const SimplexNoise = (() => {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const grad3 = [
        [1, 1], [-1, 1], [1, -1], [-1, -1],
        [1, 0], [-1, 0], [0, 1], [0, -1]
    ];

    class Simplex {
        constructor(seed = 0) {
            this.perm = new Uint8Array(512);
            this.permMod8 = new Uint8Array(512);
            this.seed(seed);
        }

        seed(s) {
            const rng = (seed) => {
                let t = seed + 0x6D2B79F5;
                return () => {
                    t = Math.imul(t ^ (t >>> 15), t | 1);
                    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
            };
            const rand = rng(s);
            const p = new Uint8Array(256);
            for (let i = 0; i < 256; i++) p[i] = i;
            for (let i = 255; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                [p[i], p[j]] = [p[j], p[i]];
            }
            for (let i = 0; i < 512; i++) {
                this.perm[i] = p[i & 255];
                this.permMod8[i] = this.perm[i] % 8;
            }
        }

        noise2D(x, y) {
            const s = (x + y) * F2;
            const i = Math.floor(x + s);
            const j = Math.floor(y + s);
            const t = (i + j) * G2;
            const X0 = i - t, Y0 = j - t;
            const x0 = x - X0, y0 = y - Y0;
            let i1, j1;
            if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
            const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
            const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
            const ii = i & 255, jj = j & 255;
            const gi0 = this.permMod8[ii + this.perm[jj]];
            const gi1 = this.permMod8[ii + i1 + this.perm[jj + j1]];
            const gi2 = this.permMod8[ii + 1 + this.perm[jj + 1]];
            let n0 = 0, n1 = 0, n2 = 0;
            let t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0); }
            let t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1); }
            let t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2); }
            return 70 * (n0 + n1 + n2);
        }

        fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
            let sum = 0, amp = 1, freq = 1, maxAmp = 0;
            for (let i = 0; i < octaves; i++) {
                sum += this.noise2D(x * freq, y * freq) * amp;
                maxAmp += amp;
                amp *= gain;
                freq *= lacunarity;
            }
            return sum / maxAmp;
        }
    }

    return Simplex;
})();


// ─── 2. COLOR PALETTES ─────────────────────────────────────────
// Photographic / medical-imaging inspired palettes.
// Multiple color stops for richer, more translucent-feeling hues.

const PALETTES = {
    spectral: {
        name: 'Spectral Neon',
        // richer: violet fog → electric cyan → warm amber
        stops: [
            [0.00, [30, 10, 60]],       // deep indigo shadow
            [0.20, [0, 120, 180]],      // blue-cyan body
            [0.40, [0, 220, 200]],      // cyan midtone
            [0.60, [180, 40, 220]],     // violet pressure
            [0.80, [255, 80, 160]],     // magenta bloom
            [1.00, [255, 200, 80]],     // warm amber hotspot
        ],
    },
    cold: {
        name: 'Cold Surveillance',
        // silver halide / X-ray: deep navy → silver-white → mint
        stops: [
            [0.00, [5, 15, 35]],        // near-black blue
            [0.20, [0, 60, 120]],       // deep navy
            [0.40, [20, 140, 180]],     // cyan blue
            [0.60, [100, 200, 210]],    // silver-cyan
            [0.80, [200, 240, 240]],    // near-white silver
            [1.00, [160, 255, 200]],    // mint hotspot
        ],
    },
    infrared: {
        name: 'Infrared Haunt',
        // darkroom chemistry: bruised purple → amber yellow → hot red
        stops: [
            [0.00, [20, 0, 40]],        // dark violet
            [0.20, [80, 0, 100]],       // bruise purple
            [0.40, [0, 120, 160]],      // cool teal (unexpected midtone)
            [0.55, [180, 100, 20]],     // amber transition
            [0.75, [240, 60, 20]],      // orange-red bloom
            [1.00, [255, 220, 80]],     // sodium yellow peak
        ],
    },
    presence: {
        name: 'Ghost / Presence',
        // photographic fog, silver gelatin, light leak:
        // dim blue-gray → warm fog → washed yellow → barely pink
        stops: [
            [0.00, [8, 8, 18]],         // photographic black
            [0.15, [20, 30, 50]],       // shadow blue-gray
            [0.35, [60, 55, 80]],       // fog violet-gray
            [0.55, [140, 120, 100]],    // warm silver
            [0.75, [200, 180, 140]],    // faded warm yellow
            [0.90, [220, 200, 170]],    // washed highlight
            [1.00, [255, 240, 220]],    // chemical bloom peak
        ],
    },
};

// Sample a multi-stop gradient palette at a given value [0..1]
function samplePalette(palette, value) {
    const stops = palette.stops;
    value = Math.max(0, Math.min(1, value));
    if (value <= stops[0][0]) return stops[0][1].slice();
    if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1].slice();
    for (let i = 1; i < stops.length; i++) {
        const [ta, ca] = stops[i - 1];
        const [tb, cb] = stops[i];
        if (value <= tb) {
            const t = (value - ta) / (tb - ta);
            const st = t * t * (3 - 2 * t); // smoothstep
            return [
                ca[0] + (cb[0] - ca[0]) * st,
                ca[1] + (cb[1] - ca[1]) * st,
                ca[2] + (cb[2] - ca[2]) * st,
            ];
        }
    }
    return stops[stops.length - 1][1].slice();
}


// ─── 3. DETECTION MODE PRESETS ─────────────────────────────────

const MODE_PRESETS = {
    cold: {
        palette: 'cold',
        geometry: 'contours',
        opacity: 0.65, density: 0.45, contrast: 0.55, noiseScale: 0.35,
        threshold: 0.48, intensity: 0.60, chromatic: 0.25, distortion: 0.18,
        contourSteps: 10, bandSoftness: 0.30,
        hint: 'Contour field — clinical topographic isolines',
    },
    spectral: {
        palette: 'spectral',
        geometry: 'flow',
        opacity: 0.65, density: 0.50, contrast: 0.52, noiseScale: 0.40,
        threshold: 0.42, intensity: 0.70, chromatic: 0.40, distortion: 0.28,
        flowDirection: 45, flowStretch: 0.50,
        hint: 'Flow/veins — streaky directional currents',
    },
    infrared: {
        palette: 'infrared',
        geometry: 'cells',
        opacity: 0.68, density: 0.55, contrast: 0.55, noiseScale: 0.45,
        threshold: 0.38, intensity: 0.72, chromatic: 0.35, distortion: 0.22,
        hotspotSize: 0.55, hotspotCluster: 0.52,
        hint: 'Cells/hotspots — node clusters and thermal blobs',
    },
    presence: {
        palette: 'presence',
        geometry: 'ghost',
        opacity: 0.72, density: 0.42, contrast: 0.45, noiseScale: 0.28,
        threshold: 0.35, intensity: 0.80, chromatic: 0.20, distortion: 0.35,
        presenceCoherence: 0.65, spatialGravity: 0.55,
        hint: 'Ghost / Presence — volumetric density field',
    },
};


// ─── 4. APP STATE ───────────────────────────────────────────────

const state = {
    originalImage: null,
    originalData: null,
    edgeMap: null,          // Float32Array [0..1] per pixel
    lumMap: null,           // Float32Array [0..1] per pixel
    attractors: null,       // Array of {nx,ny} in [0..1] normalized image space
    viewMode: 'filtered',
    splitPosition: 0.5,
    scanlines: false,
    isDraggingSplit: false,

    params: {
        mode: 'spectral',
        opacity: 0.65,
        density: 0.50,
        contrast: 0.52,
        noiseScale: 0.40,
        threshold: 0.42,
        intensity: 0.70,
        chromatic: 0.40,
        distortion: 0.28,
        seed: 42,
        blendMode: 'screen',
        seedMode: 'stable',
        geometry: 'auto',
        contourSteps: 8,
        bandSoftness: 0.30,
        flowDirection: 45,
        flowStretch: 0.50,
        hotspotSize: 0.50,
        hotspotCluster: 0.50,
        edgeAffinity: 0.0,
        // Ghost / Presence
        presenceCoherence: 0.65,
        spatialGravity: 0.55,
    },

    defaults: null,
};

state.defaults = { ...state.params };


// ─── 5. DOM REFERENCES ─────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    uploadZone: $('#upload-zone'),
    fileInput: $('#file-input'),
    canvasContainer: $('#canvas-container'),
    displayCanvas: $('#display-canvas'),
    viewControls: $('#view-controls'),
    controlsPanel: $('#controls-panel'),
    splitDivider: $('#split-divider'),
    scanlineOverlay: $('#scanline-overlay'),
    btnDownload: $('#btn-download'),
    btnScanline: $('#btn-scanline'),
    btnNewImage: $('#btn-new-image'),
    btnRandomize: $('#btn-randomize'),
    btnReset: $('#btn-reset'),
    detectionMode: $('#select-detection-mode'),
    blendMode: $('#select-blend-mode'),
    seedMode: $('#select-seed-mode'),
    geometrySelect: $('#select-geometry'),
    modeHint: $('#mode-hint'),
    contourControls: $('#contour-controls'),
    flowControls: $('#flow-controls'),
    cellControls: $('#cell-controls'),
    ghostControls: $('#ghost-controls'),
    readoutDensity: $('#readout-density'),
    readoutInterference: $('#readout-interference'),
    readoutDrift: $('#readout-drift'),
    readoutStatus: $('#readout-status'),
};

// Offscreen canvases
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const filteredCanvas = document.createElement('canvas');
const filteredCtx = filteredCanvas.getContext('2d');

// Noise instances
let noiseCoarse, noiseMedium, noiseFine, noisePresence;

function rebuildNoise() {
    const s = state.params.seed;
    if (state.params.seedMode === 'wild') {
        noiseCoarse = new SimplexNoise(s);
        noiseMedium = new SimplexNoise(s * 7 + 137);
        noiseFine = new SimplexNoise(s * 13 + 311);
        noisePresence = new SimplexNoise(s * 19 + 521);
    } else {
        noiseCoarse = new SimplexNoise(s);
        noiseMedium = noiseCoarse;
        noiseFine = noiseCoarse;
        noisePresence = new SimplexNoise(s * 3 + 97); // presence always gets its own seed
    }
    // Rebuild attractor positions from seed
    buildAttractors(s);
}
rebuildNoise();


// ─── 6. IMAGE UPLOAD ────────────────────────────────────────────

function initUpload() {
    const zone = dom.uploadZone;
    const input = dom.fileInput;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadImage(file);
    });
    input.addEventListener('change', (e) => { const file = e.target.files[0]; if (file) loadImage(file); });
    dom.btnNewImage.addEventListener('click', () => { input.value = ''; input.click(); });
}

function loadImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            state.originalImage = img;
            const w = img.naturalWidth, h = img.naturalHeight;
            dom.displayCanvas.width = w; dom.displayCanvas.height = h;
            offCanvas.width = w; offCanvas.height = h;
            filteredCanvas.width = w; filteredCanvas.height = h;
            offCtx.drawImage(img, 0, 0);
            state.originalData = offCtx.getImageData(0, 0, w, h);
            computeEdgeAndLumMap(w, h, state.originalData.data);
            dom.uploadZone.classList.add('hidden');
            dom.canvasContainer.classList.remove('hidden');
            dom.viewControls.classList.remove('hidden');
            dom.controlsPanel.classList.remove('hidden');
            requestRender();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}


// ─── 7. EDGE MAP + LUMINANCE MAP ───────────────────────────────
// Sobel edge detection + per-pixel luminance.
// Both used: edge for Edge Affinity, lum for Ghost Presence.

function computeEdgeAndLumMap(w, h, pixels) {
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        lum[i] = (pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114) / 255;
    }
    state.lumMap = lum;

    const edge = new Float32Array(w * h);
    let maxE = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const tl = lum[(y - 1) * w + (x - 1)], tc = lum[(y - 1) * w + x], tr = lum[(y - 1) * w + (x + 1)];
            const ml = lum[y * w + (x - 1)], mr = lum[y * w + (x + 1)];
            const bl = lum[(y + 1) * w + (x - 1)], bc = lum[(y + 1) * w + x], br = lum[(y + 1) * w + (x + 1)];
            const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            const mag = Math.sqrt(gx * gx + gy * gy);
            edge[y * w + x] = mag;
            if (mag > maxE) maxE = mag;
        }
    }
    if (maxE > 0) for (let i = 0; i < edge.length; i++) edge[i] /= maxE;
    state.edgeMap = edge;
}


// ─── 8. GHOST PRESENCE SYSTEM ──────────────────────────────────
// The ghost is a volumetric density field built from:
//   • 2–4 spatial attractors (soft Gaussian blobs in image space)
//   • Low-frequency noise warped toward attractors
//   • Luminance bias (presence lives in mid-tone zones, avoids extremes)
//   • Coherence: how strongly the field collapses toward attractors
//   • Gravity: how tightly attractors focus (narrow vs. wide Gaussian)

// Build attractor positions deterministically from seed.
// Returns normalized [0..1] coords with slight vertical weighting
// (ghosts prefer the upper-centre of a frame).
function buildAttractors(seed) {
    const rng = (() => {
        let t = seed * 1973 + 0x6D2B79F5;
        return () => {
            t = Math.imul(t ^ (t >>> 15), t | 1) + 0x9e3779b9;
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    })();

    // 2–3 attractors, biased toward centre-x and upper-mid y
    const count = 2 + Math.floor(rng() * 2); // 2 or 3
    const attractors = [];
    for (let i = 0; i < count; i++) {
        // x: 0.2–0.8 (avoid extreme edges)
        const nx = 0.2 + rng() * 0.6;
        // y: 0.15–0.75 (upper/mid frame, never foot of image)
        const ny = 0.15 + rng() * 0.60;
        attractors.push({ nx, ny });
    }
    state.attractors = attractors;
}

// Compute the ghost mass field at normalised position (px, py) in [0,1]
// Returns a value in [0, 1] representing field density.
function ghostMassField(px, py, p, w, h) {
    const coherence = p.presenceCoherence; // 0=fog, 1=collapsed mass
    const gravity = p.spatialGravity;     // 0=wide, 1=tight

    // Gaussian width: tight attractors concentrate density more
    const sigma = 0.05 + (1 - gravity) * 0.35;

    // Sum Gaussian contributions from each attractor
    let mass = 0;
    for (const att of state.attractors) {
        const dx = px - att.nx;
        const dy = py - att.ny;
        // Slightly taller than wide (vertical bias: ghostly figures are tall)
        const dist2 = dx * dx * 1.0 + dy * dy * 0.7;
        mass += Math.exp(-dist2 / (2 * sigma * sigma));
    }
    // Normalize by attractor count so single attractor doesn't dwarf multiple
    mass = Math.min(1, mass / state.attractors.length);

    // Low-frequency noise acts as the "breath" of the presence — it wobbles
    // the boundary of the mass field, making it feel organic and unstable.
    const baseScale = 0.001 + p.noiseScale * 0.008;
    const densityScale = 0.3 + p.density * 0.8;

    // Large warp noise — displaces sample point before reading fine noise
    const warpX = noisePresence.fbm(px * densityScale * 0.5, py * densityScale * 0.5, 3, 2.1, 0.55) * 0.4;
    const warpY = noisePresence.fbm(px * densityScale * 0.5 + 3.7, py * densityScale * 0.5, 3, 2.1, 0.55) * 0.4;

    // Medium body noise — organic internal structure of the mass
    const bodyNoise = noiseCoarse.fbm(
        (px + warpX * 0.5) * densityScale,
        (py + warpY * 0.5) * densityScale,
        4, 2.0, 0.50
    );
    const bodyMapped = (bodyNoise + 1) * 0.5;

    // Fine grain — rides on top as texture/grain (photographic)
    const grainNoise = noiseFine.noise2D(
        px * densityScale * 5,
        py * densityScale * 5
    );
    const grain = (grainNoise + 1) * 0.5;

    // Combine: attractor mass gates the body noise, coherence controls the blend
    // At coherence=0: pure body noise (diffuse fog)
    // At coherence=1: body noise strongly multiplied by mass (dense presence)
    const modulated = bodyMapped * (1 + mass * coherence * 2.5);
    const clamped = Math.min(1, Math.max(0, modulated));

    // Add subtle grain riding on top
    const withGrain = clamped * 0.88 + grain * 0.12;

    return Math.min(1, Math.max(0, withGrain));
}


// ─── 9. GEOMETRY FUNCTIONS (existing) ──────────────────────────

function getEffectiveGeometry() {
    if (state.params.geometry !== 'auto') return state.params.geometry;
    return MODE_PRESETS[state.params.mode]?.geometry || 'flow';
}

function shapeContours(value, steps, softness) {
    const scaled = value * steps;
    const band = Math.floor(scaled);
    const frac = scaled - band;
    const edge = 1 - softness;
    let bandVal;
    if (edge >= 0.99) {
        bandVal = (band % 2 === 0) ? 0.3 : 0.8;
    } else {
        const smooth = frac < edge ? 0 : (frac - edge) / (1 - edge);
        const s = smooth * smooth * (3 - 2 * smooth);
        bandVal = (band % 2 === 0) ? 0.3 + s * 0.5 : 0.8 - s * 0.5;
    }
    return bandVal * value + (1 - bandVal) * 0.15;
}

function sampleFlow(noiseInst, nx, ny, densityScale, direction, stretch, octaves) {
    const rad = direction * Math.PI / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const rx = nx * cosA - ny * sinA;
    const ry = nx * sinA + ny * cosA;
    const stretchFactor = 1 + stretch * 3;
    return noiseInst.fbm(rx * densityScale, ry * densityScale * stretchFactor, octaves, 2.2, 0.45);
}

function shapeCells(value, hotspotSize, clustering) {
    const thresh = 0.4 + (1 - hotspotSize) * 0.3;
    const spread = 0.1 + clustering * 0.3;
    if (value > thresh) {
        const t = Math.min(1, (value - thresh) / spread);
        return t * t;
    }
    return value * 0.15;
}

function shapeStatic(coarse, medium, fine) {
    return coarse * 0.1 + medium * 0.25 + Math.abs(fine) * 0.65;
}


// ─── 10. RENDER PIPELINE ────────────────────────────────────────

let renderPending = false;

function requestRender() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(render);
    }
}

function render() {
    renderPending = false;
    if (!state.originalImage) return;
    const w = offCanvas.width, h = offCanvas.height;
    generateFilteredImage(w, h, state.params);
    const ctx = dom.displayCanvas.getContext('2d');
    if (state.viewMode === 'original') {
        ctx.drawImage(state.originalImage, 0, 0);
    } else if (state.viewMode === 'filtered') {
        ctx.drawImage(filteredCanvas, 0, 0);
    } else if (state.viewMode === 'split') {
        const splitX = Math.floor(state.splitPosition * w);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, splitX, h); ctx.clip();
        ctx.drawImage(state.originalImage, 0, 0); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(splitX, 0, w - splitX, h); ctx.clip();
        ctx.drawImage(filteredCanvas, 0, 0); ctx.restore();
        ctx.strokeStyle = '#64ffda'; ctx.lineWidth = 2;
        ctx.shadowColor = '#64ffda'; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(splitX, 0); ctx.lineTo(splitX, h); ctx.stroke();
        ctx.shadowBlur = 0;
    }
    updateReadout(state.params);
}

function generateFilteredImage(w, h, p) {
    filteredCtx.drawImage(state.originalImage, 0, 0);
    const origPixels = state.originalData.data;
    const overlayData = filteredCtx.createImageData(w, h);
    const overlay = overlayData.data;

    const baseScale = 0.001 + p.noiseScale * 0.01;
    const densityScale = 0.5 + p.density * 1.5;
    const contrastPow = 0.5 + p.contrast * 2.0;
    const thresholdVal = p.threshold;
    const intensityMul = 0.4 + p.intensity * 1.4;   // boosted range
    const chromaticMax = p.chromatic * 12;
    const distortMax = p.distortion * 18;
    const opacityVal = p.opacity;
    const edgeAff = p.edgeAffinity;

    const palette = PALETTES[p.mode] || PALETTES.spectral;
    const geo = getEffectiveGeometry();

    const cSteps = p.contourSteps;
    const bSoft = p.bandSoftness;
    const fDir = p.flowDirection;
    const fStr = p.flowStretch;
    const hSize = p.hotspotSize;
    const hClust = p.hotspotCluster;

    const hasEdgeMap = state.edgeMap && edgeAff > 0;
    const hasLumMap = state.lumMap != null;
    const isGhost = geo === 'ghost';

    // ── Per-pixel overlay pass ──
    for (let y = 0; y < h; y++) {
        const ny = y / h;  // normalised [0..1]
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const nx = x / w;
            const px = x * baseScale;
            const py = y * baseScale;

            let normalized;

            if (isGhost) {
                // ── Ghost / Presence geometry ──
                // Build the full mass field at this pixel.
                normalized = ghostMassField(nx, ny, p, w, h);

                // Luminance bias: ghost prefers mid-luminance zones
                // (avoids pure whites/blacks — feels embedded in the space)
                if (hasLumMap) {
                    const photolum = state.lumMap[y * w + x];
                    // Bell curve centred on 0.45 (slightly below pure midtone)
                    const lumPref = 1 - Math.pow((photolum - 0.45) / 0.55, 2);
                    const lumBias = Math.max(0, lumPref);
                    // Blend: presence always visible somewhat, but boosted in ideal zones
                    const lumMix = 0.35 + p.presenceCoherence * 0.45;
                    normalized = normalized * (1 - lumMix) + normalized * lumBias * 1.2 * lumMix;
                    normalized = Math.min(1, Math.max(0, normalized));
                }

                // Contrast curve (milder for ghost to keep soft edges)
                const softContrast = 0.4 + p.contrast * 1.2;
                normalized = Math.pow(normalized, softContrast);

            } else if (geo === 'flow') {
                const coarse = sampleFlow(noiseCoarse, px * 0.3, py * 0.3, densityScale, fDir, fStr, 3);
                const medium = sampleFlow(noiseMedium, px, py, densityScale, fDir, fStr * 0.7, 3);
                const fine = noiseFine.noise2D(px * densityScale * 4, py * densityScale * 4);
                let combined = coarse * 0.5 + medium * 0.35 + fine * 0.15;
                normalized = (combined + 1) * 0.5;
                normalized = Math.pow(Math.max(0, Math.min(1, normalized)), contrastPow);

            } else if (geo === 'cells') {
                const coarse = noiseCoarse.fbm(px * densityScale * 0.3, py * densityScale * 0.3, 3, 2.0, 0.5);
                const medium = noiseMedium.fbm(px * densityScale * 0.8, py * densityScale * 0.8, 3, 2.2, 0.45);
                const fine = noiseFine.noise2D(px * densityScale * 4, py * densityScale * 4);
                let raw = ((coarse * 0.55 + medium * 0.3 + fine * 0.15) + 1) * 0.5;
                raw = Math.pow(Math.max(0, Math.min(1, raw)), contrastPow);
                normalized = shapeCells(raw, hSize, hClust);

            } else if (geo === 'contours') {
                const coarse = noiseCoarse.fbm(px * densityScale * 0.3, py * densityScale * 0.3, 3, 2.0, 0.5);
                const medium = noiseMedium.fbm(px * densityScale, py * densityScale, 3, 2.2, 0.45);
                const fine = noiseFine.noise2D(px * densityScale * 4, py * densityScale * 4);
                let raw = ((coarse * 0.5 + medium * 0.35 + fine * 0.15) + 1) * 0.5;
                raw = Math.pow(Math.max(0, Math.min(1, raw)), contrastPow);
                normalized = shapeContours(raw, cSteps, bSoft);

            } else if (geo === 'static') {
                const coarse = noiseCoarse.fbm(px * densityScale * 0.3, py * densityScale * 0.3, 2, 2.0, 0.5);
                const medium = noiseMedium.fbm(px * densityScale, py * densityScale, 3, 2.2, 0.45);
                const fine = noiseFine.noise2D(px * densityScale * 6, py * densityScale * 6);
                let raw = shapeStatic((coarse + 1) * 0.5, (medium + 1) * 0.5, fine);
                normalized = Math.pow(Math.max(0, Math.min(1, raw)), contrastPow);

            } else {
                const coarse = noiseCoarse.fbm(px * densityScale * 0.3, py * densityScale * 0.3, 3, 2.0, 0.5);
                const medium = noiseMedium.fbm(px * densityScale, py * densityScale, 3, 2.2, 0.45);
                const fine = noiseFine.noise2D(px * densityScale * 4, py * densityScale * 4);
                let combined = coarse * 0.5 + medium * 0.35 + fine * 0.15;
                normalized = (combined + 1) * 0.5;
                normalized = Math.pow(Math.max(0, Math.min(1, normalized)), contrastPow);
            }

            // Activity zone detection
            const isActive = normalized > thresholdVal;
            let activityFactor = isActive
                ? Math.min(1, (normalized - thresholdVal) / (1 - thresholdVal + 0.01)) * intensityMul
                : normalized * (isGhost ? 0.22 : 0.3); // ghost has softer background signal

            // Edge Affinity modulation
            if (hasEdgeMap) {
                const edgeVal = state.edgeMap[y * w + x] || 0;
                // Ghost mode: can also be REPELLED by edges (floating in space)
                // Other modes: attracted
                if (isGhost && p.edgeAffinity < 0.5) {
                    // Blend toward inverse of edge (presence floats in open space)
                    const repel = 1 - edgeVal;
                    activityFactor = activityFactor * (1 - edgeAff * 2) + activityFactor * repel * edgeAff * 2;
                } else {
                    activityFactor = activityFactor * (1 - edgeAff) + activityFactor * edgeVal * 2.5 * edgeAff;
                }
                activityFactor = Math.min(1.3, Math.max(0, activityFactor));
            }

            // Color mapping — use multi-stop palette
            const rgb = samplePalette(palette, normalized);
            let r = rgb[0], g = rgb[1], b = rgb[2];

            // Ghost mode: desaturate slightly and add warmth at peaks
            if (isGhost) {
                const grey = (r + g + b) / 3;
                const desat = 0.25;
                r = r * (1 - desat) + grey * desat;
                g = g * (1 - desat) + grey * desat;
                b = b * (1 - desat) + grey * desat;
            }

            // Tone boost for visibility: gamma lift on alpha
            const gammaAlpha = isGhost
                ? activityFactor * 255 * opacityVal * 1.15
                : activityFactor * 255 * opacityVal;
            const alpha = Math.min(255, Math.max(0, gammaAlpha));

            overlay[idx] = Math.min(255, Math.max(0, r));
            overlay[idx + 1] = Math.min(255, Math.max(0, g));
            overlay[idx + 2] = Math.min(255, Math.max(0, b));
            overlay[idx + 3] = alpha;
        }
    }

    // ── Chromatic aberration + displacement + blend ──
    const finalData = filteredCtx.createImageData(w, h);
    const final = finalData.data;
    const blendFn = getBlendFunction(p.blendMode);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const activity = overlay[idx + 3] / 255;
            const chrOffset = Math.round(chromaticMax * activity);

            // Ghost: displacement uses the presence noise for organic warping
            const dispNoiseN = isGhost
                ? noisePresence.noise2D(x * baseScale * 2.5, y * baseScale * 2.5)
                : noiseCoarse.noise2D(x * baseScale * 3, y * baseScale * 3);
            const dispAmount = Math.round(distortMax * activity * dispNoiseN);

            const srcX_r = Math.min(w - 1, Math.max(0, x + chrOffset + dispAmount));
            const srcX_g = Math.min(w - 1, Math.max(0, x + dispAmount));
            const srcX_b = Math.min(w - 1, Math.max(0, x - chrOffset + dispAmount));
            const srcY = Math.min(h - 1, Math.max(0, y + Math.round(dispAmount * 0.3)));

            const baseR = origPixels[(srcY * w + srcX_r) * 4] / 255;
            const baseG = origPixels[(srcY * w + srcX_g) * 4 + 1] / 255;
            const baseB = origPixels[(srcY * w + srcX_b) * 4 + 2] / 255;

            final[idx + 3] = 255;

            const oa = overlay[idx + 3] / 255;
            if (oa > 0) {
                const ovR = overlay[idx] / 255 * oa;
                const ovG = overlay[idx + 1] / 255 * oa;
                const ovB = overlay[idx + 2] / 255 * oa;
                final[idx] = Math.round(Math.min(1, Math.max(0, blendFn(baseR, ovR))) * 255);
                final[idx + 1] = Math.round(Math.min(1, Math.max(0, blendFn(baseG, ovG))) * 255);
                final[idx + 2] = Math.round(Math.min(1, Math.max(0, blendFn(baseB, ovB))) * 255);
            } else {
                final[idx] = Math.round(baseR * 255);
                final[idx + 1] = Math.round(baseG * 255);
                final[idx + 2] = Math.round(baseB * 255);
            }
        }
    }

    filteredCtx.putImageData(finalData, 0, 0);

    // Subtle vignette
    const vGrad = filteredCtx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.8);
    vGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
    filteredCtx.fillStyle = vGrad;
    filteredCtx.fillRect(0, 0, w, h);
}


// ─── 11. BLEND MODE FUNCTIONS ───────────────────────────────────

function getBlendFunction(mode) {
    switch (mode) {
        case 'screen': return (b, o) => 1 - (1 - b) * (1 - o);
        case 'overlay': return (b, o) => b < 0.5 ? 2 * b * o : 1 - 2 * (1 - b) * (1 - o);
        case 'difference': return (b, o) => Math.abs(b - o);
        case 'add': return (b, o) => b + o;
        default: return (b, o) => 1 - (1 - b) * (1 - o);
    }
}


// ─── 12. CONTROLS WIRING ────────────────────────────────────────

function initControls() {
    const sliderMap = {
        'slider-opacity': { key: 'opacity', div: 100 },
        'slider-density': { key: 'density', div: 100 },
        'slider-contrast': { key: 'contrast', div: 100 },
        'slider-noise-scale': { key: 'noiseScale', div: 100 },
        'slider-threshold': { key: 'threshold', div: 100 },
        'slider-intensity': { key: 'intensity', div: 100 },
        'slider-chromatic': { key: 'chromatic', div: 100 },
        'slider-distortion': { key: 'distortion', div: 100 },
        'slider-seed': { key: 'seed', div: 1 },
        'slider-contour-steps': { key: 'contourSteps', div: 1 },
        'slider-band-softness': { key: 'bandSoftness', div: 100 },
        'slider-flow-direction': { key: 'flowDirection', div: 1 },
        'slider-flow-stretch': { key: 'flowStretch', div: 100 },
        'slider-hotspot-size': { key: 'hotspotSize', div: 100 },
        'slider-hotspot-cluster': { key: 'hotspotCluster', div: 100 },
        'slider-edge-affinity': { key: 'edgeAffinity', div: 100 },
        'slider-presence-coherence': { key: 'presenceCoherence', div: 100 },
        'slider-spatial-gravity': { key: 'spatialGravity', div: 100 },
    };

    Object.entries(sliderMap).forEach(([id, cfg]) => {
        const slider = document.getElementById(id);
        if (!slider) return;
        const valueSpan = document.querySelector(`.control-value[data-for="${id}"]`);
        slider.addEventListener('input', () => {
            const raw = parseInt(slider.value, 10);
            state.params[cfg.key] = raw / cfg.div;
            if (valueSpan) {
                if (cfg.key === 'opacity') valueSpan.textContent = `${raw}%`;
                else if (cfg.key === 'flowDirection') valueSpan.textContent = `${raw}°`;
                else valueSpan.textContent = raw;
            }
            if (cfg.key === 'seed') {
                rebuildNoise();
                if (state.originalImage) {
                    offCtx.drawImage(state.originalImage, 0, 0);
                    state.originalData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
                }
            }
            if (cfg.key === 'spatialGravity' || cfg.key === 'presenceCoherence') {
                // Rebuild attractors too if seed-derived params change
                // (they don't change positions, but gravity affects radii shape)
            }
            requestRender();
        });
    });

    dom.detectionMode.addEventListener('change', () => {
        const mode = dom.detectionMode.value;
        state.params.mode = mode;
        applyModePreset(mode);
        requestRender();
    });

    dom.blendMode.addEventListener('change', () => {
        state.params.blendMode = dom.blendMode.value;
        requestRender();
    });

    dom.seedMode.addEventListener('change', () => {
        state.params.seedMode = dom.seedMode.value;
        rebuildNoise();
        requestRender();
    });

    dom.geometrySelect.addEventListener('change', () => {
        state.params.geometry = dom.geometrySelect.value;
        updateGeometryVisibility();
        requestRender();
    });

    $$('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.viewMode = btn.dataset.mode;
            if (state.viewMode === 'split') {
                dom.splitDivider.classList.remove('hidden');
                positionSplitDivider();
            } else {
                dom.splitDivider.classList.add('hidden');
            }
            requestRender();
        });
    });

    dom.btnScanline.addEventListener('click', () => {
        state.scanlines = !state.scanlines;
        dom.scanlineOverlay.classList.toggle('hidden', !state.scanlines);
        dom.btnScanline.classList.toggle('active', state.scanlines);
    });

    dom.btnDownload.addEventListener('click', downloadFilteredImage);
    dom.btnRandomize.addEventListener('click', randomize);
    dom.btnReset.addEventListener('click', resetToDefaults);

    updateGeometryVisibility();
}

function applyModePreset(mode) {
    const preset = MODE_PRESETS[mode];
    if (!preset) return;
    Object.assign(state.params, {
        opacity: preset.opacity,
        density: preset.density,
        contrast: preset.contrast,
        noiseScale: preset.noiseScale,
        threshold: preset.threshold,
        intensity: preset.intensity,
        chromatic: preset.chromatic,
        distortion: preset.distortion,
    });
    if (preset.contourSteps !== undefined) state.params.contourSteps = preset.contourSteps;
    if (preset.bandSoftness !== undefined) state.params.bandSoftness = preset.bandSoftness;
    if (preset.flowDirection !== undefined) state.params.flowDirection = preset.flowDirection;
    if (preset.flowStretch !== undefined) state.params.flowStretch = preset.flowStretch;
    if (preset.hotspotSize !== undefined) state.params.hotspotSize = preset.hotspotSize;
    if (preset.hotspotCluster !== undefined) state.params.hotspotCluster = preset.hotspotCluster;
    if (preset.presenceCoherence !== undefined) state.params.presenceCoherence = preset.presenceCoherence;
    if (preset.spatialGravity !== undefined) state.params.spatialGravity = preset.spatialGravity;

    dom.modeHint.textContent = preset.hint;
    syncAllSliders();
    updateGeometryVisibility();
}

function syncAllSliders() {
    const p = state.params;
    const map = {
        'slider-opacity': Math.round(p.opacity * 100),
        'slider-density': Math.round(p.density * 100),
        'slider-contrast': Math.round(p.contrast * 100),
        'slider-noise-scale': Math.round(p.noiseScale * 100),
        'slider-threshold': Math.round(p.threshold * 100),
        'slider-intensity': Math.round(p.intensity * 100),
        'slider-chromatic': Math.round(p.chromatic * 100),
        'slider-distortion': Math.round(p.distortion * 100),
        'slider-seed': p.seed,
        'slider-contour-steps': p.contourSteps,
        'slider-band-softness': Math.round(p.bandSoftness * 100),
        'slider-flow-direction': p.flowDirection,
        'slider-flow-stretch': Math.round(p.flowStretch * 100),
        'slider-hotspot-size': Math.round(p.hotspotSize * 100),
        'slider-hotspot-cluster': Math.round(p.hotspotCluster * 100),
        'slider-edge-affinity': Math.round(p.edgeAffinity * 100),
        'slider-presence-coherence': Math.round(p.presenceCoherence * 100),
        'slider-spatial-gravity': Math.round(p.spatialGravity * 100),
    };
    Object.entries(map).forEach(([id, val]) => {
        const slider = document.getElementById(id);
        if (slider) slider.value = val;
        const span = document.querySelector(`.control-value[data-for="${id}"]`);
        if (span) {
            if (id === 'slider-opacity') span.textContent = `${val}%`;
            else if (id === 'slider-flow-direction') span.textContent = `${val}°`;
            else span.textContent = val;
        }
    });
    dom.detectionMode.value = p.mode;
    dom.blendMode.value = p.blendMode;
    dom.seedMode.value = p.seedMode;
    dom.geometrySelect.value = p.geometry;
}

function updateGeometryVisibility() {
    const geo = getEffectiveGeometry();
    dom.contourControls?.classList.toggle('visible', geo === 'contours');
    dom.flowControls?.classList.toggle('visible', geo === 'flow');
    dom.cellControls?.classList.toggle('visible', geo === 'cells');
    dom.ghostControls?.classList.toggle('visible', geo === 'ghost');
}

function randomize() {
    const newSeed = Math.floor(Math.random() * 1000);
    state.params.seed = newSeed;
    const slider = document.getElementById('slider-seed');
    if (slider) slider.value = newSeed;
    const span = document.querySelector('.control-value[data-for="slider-seed"]');
    if (span) span.textContent = newSeed;
    rebuildNoise();
    requestRender();
}

function resetToDefaults() {
    Object.assign(state.params, { ...state.defaults });
    rebuildNoise();
    syncAllSliders();
    updateGeometryVisibility();
    dom.modeHint.textContent = MODE_PRESETS[state.params.mode]?.hint || '';
    requestRender();
}


// ─── 13. SPLIT VIEW DIVIDER ─────────────────────────────────────

function initSplitDivider() {
    const divider = dom.splitDivider;
    const onMove = (clientX) => {
        if (!state.isDraggingSplit) return;
        const rect = dom.displayCanvas.getBoundingClientRect();
        const x = clientX - rect.left;
        state.splitPosition = Math.max(0.05, Math.min(0.95, x / rect.width));
        positionSplitDivider(); requestRender();
    };
    divider.addEventListener('mousedown', (e) => { e.preventDefault(); state.isDraggingSplit = true; });
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', () => { state.isDraggingSplit = false; });
    divider.addEventListener('touchstart', (e) => { e.preventDefault(); state.isDraggingSplit = true; });
    window.addEventListener('touchmove', (e) => { if (state.isDraggingSplit) onMove(e.touches[0].clientX); });
    window.addEventListener('touchend', () => { state.isDraggingSplit = false; });
}

function positionSplitDivider() {
    const rect = dom.displayCanvas.getBoundingClientRect();
    const containerRect = dom.canvasContainer.getBoundingClientRect();
    const x = (rect.left - containerRect.left) + state.splitPosition * rect.width;
    dom.splitDivider.style.left = `${x}px`;
}


// ─── 14. DOWNLOAD ───────────────────────────────────────────────

function downloadFilteredImage() {
    if (!state.originalImage) return;
    generateFilteredImage(filteredCanvas.width, filteredCanvas.height, state.params);
    try {
        filteredCanvas.toBlob((blob) => {
            if (blob) triggerDownload(blob);
            else downloadViaDataURL();
        }, 'image/png');
    } catch (e) { downloadViaDataURL(); }
}

function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'wifi-ghost.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadViaDataURL() {
    try {
        const a = document.createElement('a');
        a.href = filteredCanvas.toDataURL('image/png');
        a.download = 'wifi-ghost.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
        alert('Download failed. Try right-clicking the image and selecting "Save image as..."');
    }
}


// ─── 15. READOUT PANEL ──────────────────────────────────────────

function updateReadout(p) {
    const densityVal = (p.density * 100 * (0.8 + Math.sin(p.seed * 0.7) * 0.2)).toFixed(1);
    const intfVal = (p.chromatic * 60 + p.distortion * 40 + Math.cos(p.seed * 1.3) * 5).toFixed(1);
    const driftVal = (p.noiseScale * 30 + Math.sin(p.seed * 2.1) * 8).toFixed(2);
    dom.readoutDensity.textContent = `${densityVal} mW/m²`;
    dom.readoutInterference.textContent = `${intfVal} dBi`;
    dom.readoutDrift.textContent = `${driftVal} Hz`;
    const geo = getEffectiveGeometry();
    const anomalyScore = p.density * p.intensity * p.opacity;
    if (geo === 'ghost') {
        const coh = p.presenceCoherence;
        if (coh > 0.6) {
            dom.readoutStatus.textContent = 'PRESENCE DETECTED';
            dom.readoutStatus.classList.add('detected');
        } else {
            dom.readoutStatus.textContent = 'RESIDUE TRACE...';
            dom.readoutStatus.classList.remove('detected');
        }
    } else if (anomalyScore > 0.2) {
        dom.readoutStatus.textContent = 'ANOMALY DETECTED';
        dom.readoutStatus.classList.add('detected');
    } else {
        dom.readoutStatus.textContent = 'SCANNING...';
        dom.readoutStatus.classList.remove('detected');
    }
}


// ─── 16. RESIZE ─────────────────────────────────────────────────

function initResize() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (state.viewMode === 'split') positionSplitDivider();
        }, 100);
    });
}


// ─── 17. INIT ───────────────────────────────────────────────────

function init() {
    initUpload();
    initControls();
    initSplitDivider();
    initResize();
}

document.addEventListener('DOMContentLoaded', init);

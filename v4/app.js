/* Ghost Signal Instrument v6 — simplified Signal Field, hotspot field injection, slider fixes */

// ── SIMPLEX NOISE ────────────────────────────────────────────────
const SimplexNoise = (() => {
    const F2 = .5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    const gr = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    class S {
        constructor(s = 0) { this.p = new Uint8Array(512); this.m = new Uint8Array(512); this._s(s); }
        _s(s) { const rng = (() => { let t = s + 0x6D2B79F5; return () => { t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(); const p = new Uint8Array(256); for (let i = 0; i < 256; i++)p[i] = i; for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) { this.p[i] = p[i & 255]; this.m[i] = this.p[i] % 8; } }
        n2(x, y) { const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t); const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1]; const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2; const ii = i & 255, jj = j & 255, gi0 = this.m[ii + this.p[jj]], gi1 = this.m[ii + i1 + this.p[jj + j1]], gi2 = this.m[ii + 1 + this.p[jj + 1]]; let n0 = 0, n1 = 0, n2 = 0, t0 = .5 - x0 * x0 - y0 * y0, t1, t2; if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (gr[gi0][0] * x0 + gr[gi0][1] * y0); } t1 = .5 - x1 * x1 - y1 * y1; if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (gr[gi1][0] * x1 + gr[gi1][1] * y1); } t2 = .5 - x2 * x2 - y2 * y2; if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (gr[gi2][0] * x2 + gr[gi2][1] * y2); } return 70 * (n0 + n1 + n2); }
        fbm(x, y, o = 4, l = 2, g = .5) { let s = 0, a = 1, f = 1, m = 0; for (let i = 0; i < o; i++) { s += this.n2(x * f, y * f) * a; m += a; a *= g; f *= l; } return s / m; }
    }
    return S;
})();

// ── v3 PALETTES ──────────────────────────────────────────────────
const PALETTES = {
    spectral: {
        name: 'Spectral Neon', stops: [
            [0.00, [30, 10, 60]], [0.20, [0, 120, 180]], [0.40, [0, 220, 200]],
            [0.60, [180, 40, 220]], [0.80, [255, 80, 160]], [1.00, [255, 200, 80]]
        ]
    },
    cold: {
        name: 'Cold Surveillance', stops: [
            [0.00, [5, 15, 35]], [0.20, [0, 60, 120]], [0.40, [20, 140, 180]],
            [0.60, [100, 200, 210]], [0.80, [200, 240, 240]], [1.00, [160, 255, 200]]
        ]
    },
    infrared: {
        name: 'Infrared Haunt', stops: [
            [0.00, [20, 0, 40]], [0.20, [80, 0, 100]], [0.40, [0, 120, 160]],
            [0.55, [180, 100, 20]], [0.75, [240, 60, 20]], [1.00, [255, 220, 80]]
        ]
    },
    presence: {
        name: 'Ghost / Presence', stops: [
            [0.00, [8, 8, 18]], [0.15, [20, 30, 50]], [0.35, [60, 55, 80]],
            [0.55, [140, 120, 100]], [0.75, [200, 180, 140]], [0.90, [220, 200, 170]], [1.00, [255, 240, 220]]
        ]
    },
};
function samplePalette(pal, v) {
    const s = pal.stops; v = Math.max(0, Math.min(1, v));
    if (v <= s[0][0]) return s[0][1].slice();
    if (v >= s[s.length - 1][0]) return s[s.length - 1][1].slice();
    for (let i = 1; i < s.length; i++) {
        const [ta, ca] = s[i - 1], [tb, cb] = s[i];
        if (v <= tb) { const t = (v - ta) / (tb - ta), st = t * t * (3 - 2 * t); return [ca[0] + (cb[0] - ca[0]) * st, ca[1] + (cb[1] - ca[1]) * st, ca[2] + (cb[2] - ca[2]) * st]; }
    }
    return s[s.length - 1][1].slice();
}
// Legacy alias (used by hotspot overlay)
function sampleP(pal, v) { return samplePalette(pal, v); }

// ── UTILS ────────────────────────────────────────────────────────
function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function raisedCos(rel, softness) {
    const nr = rel / Math.max(0.01, softness);
    if (nr >= Math.PI) return 0;
    const c = Math.cos(nr * 0.5); return c * c; // 1 at center → 0 at edge
}
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
    return [h, s, l];
}
function hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}
// Gradient: gradT=0 → colorA (center/core), gradT=1 → colorB (edge/falloff)
function nos(v) { return v; }

// ── LAYER TYPES ──────────────────────────────────────────────────
const LAYER_TYPES = {
    waves: {
        label: 'Waves Detection', defaultParams: {
            opacity: .72, blendMode: 'screen',
            globalFog: .15,
        }
    },
    scanner: { label: 'Scanner', defaultParams: { scanMode: 'horizontal', lineThickness: .08, lineSpacing: .05, lineJitter: .15, lineWarp: .25, lineSoftness: .55, scanIntensity: .50, lineColor: '#4dcfb0', dropouts: .08, seed: 7 } },
    grain: { label: 'Grain / Glitch', defaultParams: { grainDensity: .55, grainSize: .38, chromatic: .18, seed: 17 } },
};

// ── STATE ────────────────────────────────────────────────────────
const state = {
    originalImage: null, originalData: null, lumMap: null, edgeMap: null,
    layers: [], nextId: 1, selectedStainId: null,
    hotspotMask: null, hotspotActive: false, hotspotErase: false, hotspotBrush: 40, hotspotStr: .6,
    viewMode: 'filtered', splitPos: .5, isDraggingSplit: false,
    placingStainLayerId: null,
};

const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const dom = {
    uploadZone: $('#upload-zone'), fileInput: $('#file-input'), canvasContainer: $('#canvas-container'),
    displayCanvas: $('#display-canvas'), hotspotCanvas: $('#hotspot-canvas'),
    viewControls: $('#view-controls'), splitDivider: $('#split-divider'), scanlineOverlay: $('#scanline-overlay'),
    layerList: $('#layer-list'), layerListEmpty: $('#layer-list-empty'),
    btnAddLayer: $('#btn-add-layer'), addLayerMenu: $('#add-layer-menu'),
    btnHotspotToggle: $('#btn-hotspot-toggle'), hotspotControls: $('#hotspot-controls'),
    hotspotBrushSize: $('#hotspot-brush-size'), hotspotStrength: $('#hotspot-strength'),
    btnHotspotErase: $('#btn-hotspot-erase'), btnHotspotClear: $('#btn-hotspot-clear'),
    btnDownload: $('#btn-download'), btnScanline: $('#btn-scanline'), btnNewImage: $('#btn-new-image'),
    brushCursor: $('#brush-cursor'),
};
const offCanvas = document.createElement('canvas'), offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const filteredCanvas = document.createElement('canvas'), filteredCtx = filteredCanvas.getContext('2d');

// ── LAYER MANAGEMENT ─────────────────────────────────────────────
function mkLayer(type, ov = {}) {
    const def = LAYER_TYPES[type] || LAYER_TYPES.waves;
    const layer = {
        id: state.nextId++, type, name: def.label, enabled: true, opacity: .75, blendMode: 'screen',
        params: { ...def.defaultParams, ...ov }, expanded: false,
        _attractors: null, _noises: null, _dirty: true, _cache: null
    };
    if (type === 'waves') { layer.stains = []; layer.stainNextId = 1; layer.selectedStainId = null; }
    return layer;
}
function mkStain(layer) {
    return {
        id: layer.stainNextId++, enabled: true,
        nx: 0.5, ny: 0.5,
        size: 0.26, density: 0.5, softness: 0.52,
        intensity: 0.92, opacity: 1.0, distortion: 0.18, edgeAffinity: 0.10,
        seed: Math.floor(Math.random() * 900) + 1,
        colorA: '#ff6030', colorB: '#8030ff',
        _expanded: true,
    };
}
function addLayer(type) { state.layers.unshift(mkLayer(type)); renderLayerList(); requestRender(); }
function deleteLayer(id) { state.layers = state.layers.filter(l => l.id !== id); renderLayerList(); requestRender(); }
function duplicateLayer(id) { const i = state.layers.findIndex(l => l.id === id); if (i < 0) return; const c = { ...state.layers[i], id: state.nextId++, name: state.layers[i].name + ' copy', params: { ...state.layers[i].params }, stains: (state.layers[i].stains || []).map(s => ({ ...s })), expanded: false, _attractors: null, _noises: null }; state.layers.splice(i, 0, c); renderLayerList(); requestRender(); }
function moveLayer(id, dir) { const i = state.layers.findIndex(l => l.id === id), ni = i + dir; if (ni < 0 || ni >= state.layers.length) return;[state.layers[i], state.layers[ni]] = [state.layers[ni], state.layers[i]]; renderLayerList(); requestRender(); }
function getLayer(id) { return state.layers.find(l => l.id === id); }

// ── IMAGE LOADING ────────────────────────────────────────────────
function initUpload() {
    const z = dom.uploadZone, inp = dom.fileInput;
    z.addEventListener('click', () => inp.click());
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drag-over'); });
    z.addEventListener('dragleave', () => z.classList.remove('drag-over'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) loadImg(f); });
    inp.addEventListener('change', e => { if (e.target.files[0]) loadImg(e.target.files[0]); });
    dom.btnNewImage.addEventListener('click', () => { inp.value = ''; inp.click(); });
}
function loadImg(file) {
    if (!(file instanceof Blob)) { console.error("loadImg: argument is not a Blob", file); return; }
    const r = new FileReader();
    r.onload = e => {
        const img = new Image(); img.onload = () => {
            state.originalImage = img;
            const w = img.naturalWidth, h = img.naturalHeight;
            [dom.displayCanvas, offCanvas, filteredCanvas].forEach(c => { c.width = w; c.height = h; });
            offCtx.drawImage(img, 0, 0); state.originalData = offCtx.getImageData(0, 0, w, h);
            buildLumMap(w, h, state.originalData.data);
            state.hotspotMask = new Float32Array(w * h);
            dom.hotspotCanvas.width = w; dom.hotspotCanvas.height = h;
            dom.uploadZone.classList.add('hidden'); dom.canvasContainer.classList.remove('hidden'); dom.viewControls.classList.remove('hidden');
            state.layers.forEach(l => { l._attractors = null; l._noises = null; });
            requestAnimationFrame(() => { syncHotspotCanvas(); markDirty(null); requestRender(); });
        }; img.src = e.target.result;
    }; r.readAsDataURL(file);
}
function buildLumMap(w, h, px) {
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const o = i * 4; lum[i] = (px[o] * .299 + px[o + 1] * .587 + px[o + 2] * .114) / 255; }
    state.lumMap = lum;
    // Sobel edge map
    const edge = new Float32Array(w * h); let maxE = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const tl = lum[(y - 1) * w + (x - 1)], tc = lum[(y - 1) * w + x], tr = lum[(y - 1) * w + (x + 1)];
        const ml = lum[y * w + (x - 1)], mr = lum[y * w + (x + 1)];
        const bl = lum[(y + 1) * w + (x - 1)], bc = lum[(y + 1) * w + x], br = lum[(y + 1) * w + (x + 1)];
        const gx = -tl - 2 * ml - bl + tr + 2 * mr + br, gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        const mag = Math.sqrt(gx * gx + gy * gy); edge[y * w + x] = mag; if (mag > maxE) maxE = mag;
    }
    if (maxE > 0) for (let i = 0; i < edge.length; i++) edge[i] /= maxE;
    state.edgeMap = edge;
}

// ── NOISE CACHE ──────────────────────────────────────────────────
function getNoises(layer) {
    const p = layer.params;
    if (layer._noises && layer._noises.seed === p.seed && layer._noises.mode === p.seedMode) return layer._noises;
    let C, M, F, P;
    if (p.seedMode === 'wild') { C = new SimplexNoise(p.seed); M = new SimplexNoise(p.seed * 7 + 137); F = new SimplexNoise(p.seed * 13 + 311); P = new SimplexNoise(p.seed * 19 + 521); }
    else { C = new SimplexNoise(p.seed); M = C; F = C; P = new SimplexNoise(p.seed * 3 + 97); }
    layer._noises = { seed: p.seed, mode: p.seedMode, C, M, F, P }; return layer._noises;
}

// ── GHOST ATTRACTORS (v3: 1-3 attractors, upper-centre bias) ────
function buildAttractors(seed) {
    let t = seed * 1973 + 0x6D2B79F5;
    const rng = () => { t = Math.imul(t ^ (t >>> 15), t | 1) + 0x9e3779b9; t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // 1-3 attractors for fewer, larger "soul" blobs
    const count = 1 + Math.floor(rng() * 3);
    return Array.from({ length: count }, () => ({ nx: 0.2 + rng() * 0.6, ny: 0.15 + rng() * 0.60 }));
}

// ── WAVES DETECTION RENDER (v5.0 – stain system) ──────────────────
function stainInfluenceAt(nx, ny, stain, noises, pixIdx) {
    const sz = Math.max(0.01, stain.size || 0.24);
    const rawDx = nx - stain.nx, rawDy = ny - stain.ny;
    if (Math.abs(rawDx) > sz * 3.5 || Math.abs(rawDy) > sz * 3.5) return 0;

    const { C: NC, P: NP } = noises;
    const warpAmt = stain.distortion || 0.18;
    const softness = 0.35 + (stain.softness || 0.5) * 0.55;
    const density = stain.density || 0.5;

    let wx = nx, wy = ny;
    if (warpAmt > 0.01) {
        const ws = 1.6 + warpAmt * 2.5;
        wx += NP.fbm(nx * ws, ny * ws, 3, 2.0, 0.5) * warpAmt * sz * 0.75;
        wy += NP.fbm(nx * ws + 5.3, ny * ws + 2.7, 3, 2.0, 0.5) * warpAmt * sz * 0.75;
    }
    const dx = wx - stain.nx, dy = wy - stain.ny;
    const rel = Math.sqrt(dx * dx + dy * dy) / sz;
    if (rel > 3.0) return 0;

    const subCount = 3 + Math.round(density * 9);
    let acc = 0;
    for (let i = 0; i < subCount; i++) {
        const offSeed = (stain.seed || 42) + i * 13;
        const ang = (i / subCount) * Math.PI * 2 + (stain.seed || 0) * 0.23;
        const rad = sz * 0.40 * Math.abs(NC.n2(i * 0.75, offSeed * 0.1));
        const sdx = dx - Math.cos(ang) * rad, sdy = dy - Math.sin(ang) * rad;
        acc += raisedCos(Math.sqrt(sdx * sdx + sdy * sdy) / (sz * 0.62), softness);
    }
    let inf = Math.min(1.2, acc / (subCount * 0.45)) * raisedCos(rel * 0.85, 1.0);
    if ((stain.edgeAffinity || 0) > 0 && state.edgeMap && pixIdx !== undefined) {
        const ev = state.edgeMap[pixIdx] || 0;
        inf = inf * (1 - (stain.edgeAffinity || 0)) + inf * ev * (stain.edgeAffinity || 0) * 2.8;
    }
    return Math.min(1.2, Math.max(0, inf));
}

function getStainColor(stain, inf) {
    const cA = hexToRgb(stain.colorA || '#ff6030');
    const cB = hexToRgb(stain.colorB || '#8030ff');
    const t = Math.min(1, inf * 0.9);
    return [cA[0] * (1 - t) + cB[0] * t, cA[1] * (1 - t) + cB[1] * t, cA[2] * (1 - t) + cB[2] * t];
}

function renderWavesDetection(layer, w, h) {
    const p = layer.params || {};
    const noises = getNoises(layer);
    const stains = (layer.stains || []).filter(s => s.enabled !== false);
    const globalFog = p.globalFog !== undefined ? p.globalFog : 0.15;
    const out = new Uint8ClampedArray(w * h * 4);
    const { M: NM } = noises;

    for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
            const nx = x / w, pixIdx = y * w + x, idx = pixIdx * 4;
            let totalInf = 0, totalR = 0, totalG = 0, totalB = 0, weightSum = 0;

            if (globalFog > 0.005) {
                const fv = (NM.fbm(nx * 0.55, ny * 0.55, 2, 2.0, 0.52) + 1) * 0.5;
                const fi = fv * globalFog * 0.32;
                const fc = samplePalette(PALETTES.presence, fv);
                totalR = fc[0] * fi; totalG = fc[1] * fi; totalB = fc[2] * fi;
                weightSum = fi; totalInf = fi;
            }

            for (const s of stains) {
                const inf = stainInfluenceAt(nx, ny, s, noises, pixIdx);
                if (inf < 0.005) continue;
                const act = inf * (s.opacity !== undefined ? s.opacity : 1.0) * (s.intensity || 0.85);
                const [sr, sg, sb] = getStainColor(s, inf);
                const w2 = act * act;
                totalR += sr * w2; totalG += sg * w2; totalB += sb * w2;
                weightSum += w2; totalInf = Math.max(totalInf, act);
            }

            if (weightSum > 0.001) {
                out[idx] = Math.min(255, totalR / weightSum);
                out[idx + 1] = Math.min(255, totalG / weightSum);
                out[idx + 2] = Math.min(255, totalB / weightSum);
                out[idx + 3] = Math.min(255, totalInf * 255);
            }
        }
    }
    return out;
}

// ── SCANNER RENDER ── UNCHANGED ──────────────────────────────────
function renderScanner(layer, w, h) {
    const p = layer.params, N = new SimplexNoise(p.seed), NW = new SimplexNoise(p.seed * 5 + 63);
    const horiz = p.scanMode === 'horizontal', dim = horiz ? h : w;
    const spacing = Math.max(4, Math.round(dim * p.lineSpacing));
    const thickPx = Math.max(.3, p.lineThickness * spacing * .5), sofPx = Math.max(.2, p.lineSoftness * thickPx * 3);
    const [cr, cg, cb] = hexToRgb(p.lineColor || '#4dcfb0');
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)for (let x = 0; x < w; x++) {
        const primary = horiz ? y : x, secondary = horiz ? x : y;
        const lineIdx = Math.floor(primary / spacing);
        const warpN = NW.n2(secondary * .003 + p.seed * .01, lineIdx * .4) * p.lineWarp * spacing * .4;
        const jitN = N.n2(secondary * .08, primary * .08) * p.lineJitter * 2;
        const ep = ((primary + warpN + jitN) % spacing + spacing) % spacing;
        const distFromLine = Math.min(ep, spacing - ep);
        const intensity = Math.exp(-(distFromLine * distFromLine) / (sofPx * sofPx + thickPx * thickPx));
        if (intensity < .01) continue;
        if (p.dropouts > 0 && N.n2(secondary * .04 + lineIdx * .7, lineIdx * .9 + secondary * .02) > 1 - p.dropouts * 1.5) continue;
        const a = Math.min(255, intensity * (N.n2(secondary * .015, lineIdx * .6) * .25 + .75) * p.scanIntensity * 255);
        const idx = (y * w + x) * 4; out[idx] = cr; out[idx + 1] = cg; out[idx + 2] = cb; out[idx + 3] = a;
    }
    return out;
}

// ── GRAIN RENDER ── UNCHANGED ────────────────────────────────────
// ── FILM GRAIN / SENSOR NOISE ─────────────────────────────────────
// No waves, tears, or scan patterns – pure luminance disturbance + subtle chroma jitter
// ─ FAST FILM GRAIN – LCG seeded PRNG, no SimplexNoise per pixel ─
// Film grain is authentically white noise; LCG is 15-20x faster than SimplexNoise.
function renderGrain(layer, w, h) {
    const p = layer.params;
    const den = Math.max(0, p.grainDensity || 0.55) * 160;
    const chrom = Math.max(0, p.chromatic || 0.18) * 55;
    const coarse = Math.max(1, Math.round((p.grainSize || 0.38) * 6)); // 1..6px blocks
    const seed = ((p.seed || 17) * 6364136223846793005 + 1442695040888963407) >>> 0;
    const out = new Uint8ClampedArray(w * h * 4);
    // LCG helpers (Knuth)
    let s1 = (seed ^ 0xDEADBEEF) >>> 0;
    let s2 = (seed ^ 0xCAFEBABE) >>> 0;
    let s3 = (seed ^ 0x12345678) >>> 0;
    const lcg1 = () => { s1 = (Math.imul(1664525, s1) + 1013904223) >>> 0; return (s1 >>> 0) / 0xFFFFFFFF; };
    const lcg2 = () => { s2 = (Math.imul(22695477, s2) + 1) >>> 0; return (s2 >>> 0) / 0xFFFFFFFF; };
    const lcg3 = () => { s3 = (Math.imul(214013, s3) + 2531011) >>> 0; return (s3 >>> 0) / 0xFFFFFFFF; };
    for (let yb = 0; yb < h; yb += coarse) {
        for (let xb = 0; xb < w; xb += coarse) {
            const luma = (lcg1() - 0.5) * 2 * den;
            const cr = (lcg2() - 0.5) * 2 * chrom;
            const cb = (lcg3() - 0.5) * 2 * chrom;
            const alpha = Math.min(255, (Math.abs(luma) + Math.abs(cr) + Math.abs(cb)) * 2.0);
            if (alpha < 2) continue;
            const R = Math.round(128 + luma + cr);
            const G = Math.round(128 + luma);
            const B = Math.round(128 + luma + cb);
            // Fill the coarse block
            for (let dy = 0; dy < coarse && yb + dy < h; dy++) {
                for (let dx = 0; dx < coarse && xb + dx < w; dx++) {
                    const i = ((yb + dy) * w + (xb + dx)) * 4;
                    out[i] = Math.max(0, Math.min(255, R));
                    out[i + 1] = Math.max(0, Math.min(255, G));
                    out[i + 2] = Math.max(0, Math.min(255, B));
                    out[i + 3] = alpha;
                }
            }
        }
    }
    return out;
}

// ── BLEND + COMPOSITE ────────────────────────────────────────────
function blendFn(mode) { switch (mode) { case 'screen': return (b, o) => 1 - (1 - b) * (1 - o); case 'overlay': return (b, o) => b < .5 ? 2 * b * o : 1 - 2 * (1 - b) * (1 - o); case 'difference': return (b, o) => Math.abs(b - o); case 'add': return (b, o) => Math.min(1, b + o); case 'multiply': return (b, o) => b * o; default: return (b, o) => 1 - (1 - b) * (1 - o); } }

let _rPending = false;
function requestRender() { if (!_rPending) { _rPending = true; requestAnimationFrame(doRender); } }

function doRender() {
    _rPending = false; if (!state.originalImage) return;
    const w = offCanvas.width, h = offCanvas.height, res = compositeLayers(w, h);
    filteredCtx.putImageData(new ImageData(res, w, h), 0, 0);
    const vg = filteredCtx.createRadialGradient(w / 2, h / 2, w * .3, w / 2, h / 2, w * .8); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.15)'); filteredCtx.fillStyle = vg; filteredCtx.fillRect(0, 0, w, h);
    const ctx = dom.displayCanvas.getContext('2d');
    if (state.viewMode === 'original') ctx.drawImage(state.originalImage, 0, 0);
    else if (state.viewMode === 'filtered') ctx.drawImage(filteredCanvas, 0, 0);
    else if (state.viewMode === 'split') {
        const sx = Math.floor(state.splitPos * w);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, sx, h); ctx.clip(); ctx.drawImage(state.originalImage, 0, 0); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(sx, 0, w - sx, h); ctx.clip(); ctx.drawImage(filteredCanvas, 0, 0); ctx.restore();
        ctx.strokeStyle = '#64ffda'; ctx.lineWidth = 2; ctx.shadowColor = '#64ffda'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (state.hotspotActive) drawHotspotOverlay();
    updateSelectionIndicator();
}

function markDirty(layer) { if (layer) layer._dirty = true; else state.layers.forEach(l => l._dirty = true); }

function compositeLayers(w, h) {
    const orig = state.originalData.data, final = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { final[i * 4] = orig[i * 4]; final[i * 4 + 1] = orig[i * 4 + 1]; final[i * 4 + 2] = orig[i * 4 + 2]; final[i * 4 + 3] = 255; }
    for (let li = state.layers.length - 1; li >= 0; li--) {
        const layer = state.layers[li]; if (!layer.enabled) continue;
        let ld;
        // Use cached result if layer is not dirty
        if (!layer._dirty && layer._cache) {
            ld = layer._cache;
        } else {
            if (layer.type === 'waves') ld = renderWavesDetection(layer, w, h);
            else if (layer.type === 'scanner') ld = renderScanner(layer, w, h);
            else if (layer.type === 'grain') ld = renderGrain(layer, w, h);
            else continue;
            layer._cache = ld;
            layer._dirty = false;
        }
        // Scanner/Grain: optional hotspot alpha gate
        if (layer.type !== 'waves' && (layer.maskMode === 'hotspot' || layer.maskMode === 'hybrid') && state.hotspotMask)
            for (let i = 0; i < w * h; i++)ld[i * 4 + 3] = Math.round(ld[i * 4 + 3] * state.hotspotMask[i]);
        const bf = blendFn(layer.blendMode), op = layer.opacity;
        const isWaves = layer.type === 'waves';
        const chrMax = isWaves ? (layer.params.chromatic || 0) * 12 : 0, distMax = isWaves ? (layer.params.distortion || 0) * 14 : 0;
        const ND = (chrMax > 0 || distMax > 0) ? getNoises(layer).C : null;
        const bs = .001 + (layer.params.noiseScale || .04) * .01;
        for (let y = 0; y < h; y++)for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4, la = (ld[idx + 3] / 255) * op; if (la < .003) continue;
            let bR = final[idx] / 255, bG = final[idx + 1] / 255, bB = final[idx + 2] / 255;
            if (ND) {
                const dn = ND.n2(x * bs * 3, y * bs * 3), da = Math.round(distMax * la * dn), ch = Math.round(chrMax * la);
                const rx = Math.min(w - 1, Math.max(0, x + ch + da)), gx = Math.min(w - 1, Math.max(0, x + da)), bx = Math.min(w - 1, Math.max(0, x - ch + da)), sy = Math.min(h - 1, Math.max(0, y + Math.round(da * .3)));
                bR = final[(sy * w + rx) * 4] / 255; bG = final[(sy * w + gx) * 4 + 1] / 255; bB = final[(sy * w + bx) * 4 + 2] / 255;
            }
            final[idx] = Math.min(255, Math.max(0, Math.round(bf(bR, ld[idx] / 255 * la) * 255)));
            final[idx + 1] = Math.min(255, Math.max(0, Math.round(bf(bG, ld[idx + 1] / 255 * la) * 255)));
            final[idx + 2] = Math.min(255, Math.max(0, Math.round(bf(bB, ld[idx + 2] / 255 * la) * 255)));
        }
        if (layer.type === 'grain' && layer.params.vignetteAmount > 0) {
            const va = layer.params.vignetteAmount * .4 * op;
            for (let y = 0; y < h; y++)for (let x = 0; x < w; x++) { const nx = (x / w - .5) * 2, ny = (y / h - .5) * 2, d = Math.min(1, nx * nx + ny * ny), dim = Math.round(d * va * 255); if (dim < 1) continue; const idx = (y * w + x) * 4; final[idx] = Math.max(0, final[idx] - dim); final[idx + 1] = Math.max(0, final[idx + 1] - dim); final[idx + 2] = Math.max(0, final[idx + 2] - dim); }
        }
    }
    return final;
}

// ── HOTSPOT PAINT ────────────────────────────────────────────────
function syncHotspotCanvas() {
    const dc = dom.displayCanvas, hc = dom.hotspotCanvas;
    const r = dc.getBoundingClientRect(), cr = dom.canvasContainer.getBoundingClientRect();
    hc.style.left = (r.left - cr.left) + 'px'; hc.style.top = (r.top - cr.top) + 'px';
    hc.style.width = r.width + 'px'; hc.style.height = r.height + 'px';
}
function drawHotspotOverlay() {
    if (!state.hotspotMask) return;
    const c = dom.hotspotCanvas, ctx = c.getContext('2d'), w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const id = ctx.createImageData(w, h);
    // Use active waves layer's palette for visual consistency
    const wavLayer = state.layers.find(l => l.type === 'waves' && l.enabled);
    const pal = (wavLayer && PALETTES[wavLayer.params.palette]) || PALETTES.presence;
    for (let i = 0; i < w * h; i++) {
        const v = state.hotspotMask[i]; if (v < .01) continue;
        const rgb = samplePalette(pal, Math.min(1, .4 + v * .55));
        id.data[i * 4] = rgb[0]; id.data[i * 4 + 1] = rgb[1]; id.data[i * 4 + 2] = rgb[2]; id.data[i * 4 + 3] = Math.round(v * 150);
    }
    ctx.putImageData(id, 0, 0);
}
function updateBrushCursor(cx, cy) {
    const cur = dom.brushCursor; if (!cur) return;
    const dc = dom.displayCanvas, rect = dc.getBoundingClientRect();
    const px = state.hotspotBrush * (rect.width / dc.width) * 2;
    cur.style.left = cx + 'px'; cur.style.top = cy + 'px'; cur.style.width = px + 'px'; cur.style.height = px + 'px';
    cur.classList.toggle('erase', state.hotspotErase);
}
function paintHotspot(cx, cy) {
    if (!state.hotspotMask || !state.originalImage) return;
    const dc = dom.displayCanvas, rect = dc.getBoundingClientRect();
    const sx = dc.width / rect.width, sy = dc.height / rect.height;
    const px = Math.round((cx - rect.left) * sx), py = Math.round((cy - rect.top) * sy);
    const w = dc.width, h = dc.height, br = state.hotspotBrush, str = state.hotspotStr;
    const x0 = Math.max(0, px - br), x1 = Math.min(w - 1, px + br), y0 = Math.max(0, py - br), y1 = Math.min(h - 1, py + br);
    for (let y = y0; y <= y1; y++)for (let x = x0; x <= x1; x++) {
        const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2); if (d > br) continue;
        const fall = (1 - d / br) ** 1.5, i = y * w + x;
        state.hotspotMask[i] = state.hotspotErase ? Math.max(0, state.hotspotMask[i] - fall * str * .12) : Math.min(1, state.hotspotMask[i] + fall * str * .12);
    }
    drawHotspotOverlay(); requestRender();
}

// ── LAYER LIST UI ─────────────────────────────────────────────────
function renderLayerList() {
    const list = dom.layerList;
    Array.from(list.querySelectorAll('.layer-item')).forEach(el => el.remove());
    if (dom.layerListEmpty) dom.layerListEmpty.style.display = state.layers.length ? 'none' : 'block';
    state.layers.forEach(layer => {
        const item = document.createElement('div');
        item.className = 'layer-item' + (layer.enabled ? '' : ' disabled'); item.dataset.id = layer.id;
        const badge = layer.type === 'grain' ? 'GRN' : layer.type === 'scanner' ? 'SCN' : 'WAV';
        item.innerHTML = `<div class="layer-header">
<button class="layer-toggle${layer.enabled ? ' on' : ''}" data-action="toggle"></button>
<input class="layer-name-input" type="text" value="${layer.name}" data-action="rename">
<span class="layer-type-badge badge-${layer.type}">${badge}</span>
<div class="layer-btns">
<button class="layer-btn" data-action="up">▲</button><button class="layer-btn" data-action="down">▼</button>
<button class="layer-btn" data-action="dup">⧉</button>
<button class="layer-btn expand${layer.expanded ? ' open' : ''}" data-action="expand">${layer.expanded ? '▾' : '▸'}</button>
<button class="layer-btn delete" data-action="del">✕</button></div></div>
<div class="layer-quick"><label>Opacity</label>
<input type="range" data-action="opacity" min="0" max="100" value="${Math.round(layer.opacity * 100)}">
<span class="lq-val">${Math.round(layer.opacity * 100)}%</span>
<select data-action="blend" style="margin-left:4px">${['screen', 'overlay', 'add', 'difference', 'multiply'].map(m => `<option value="${m}"${layer.blendMode === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
<div class="layer-params${layer.expanded ? ' open' : ''}">
${buildTypeParams(layer)}</div>`;
        list.appendChild(item);
    });
}

function buildTypeParams(l) { if (l.type === 'scanner') return buildScannerParams(l); if (l.type === 'grain') return buildGrainParams(l); return buildWavesParams(l); }

// ── WAVES DETECTION UI ───────────────────────────────────────────
function buildWavesParams(layer) {
    const p = layer.params || {};
    const opVal = Math.round(layer.opacity * 100);
    const fogVal = Math.round((p.globalFog !== undefined ? p.globalFog : 0.15) * 100);

    return `
<div class="params-section">Global Detection</div>
<div class="control-row"><label>Layer Opacity</label><input type="range" data-action="opacity" min="0" max="100" value="${opVal}"><span class="control-value">${opVal}%</span></div>
<div class="control-row"><label>Global Field Base</label><input type="range" data-param="globalFog" min="0" max="100" value="${fogVal}"><span class="control-value">${fogVal}%</span></div>
<button class="ctrl-btn accent" data-layer-action="randomizeAll" style="width:100%;margin-top:4px">Global Randomize</button>

<div class="params-section">Detected Wave Stains</div>
<button class="ctrl-btn accent add-stain-btn" data-layer-action="addStain" style="width:100%;margin-bottom:8px">+ Add Stain</button>
<div class="stain-list">${buildStainList(layer)}</div>
    `;
}

function buildStainList(layer) {
    const stains = layer.stains || [];
    if (stains.length === 0) return '<div class="layer-list-empty" style="padding:10px;font-style:italic;color:var(--text-3)">No stains detected. Click + Add to place one.</div>';
    return stains.map((stain, i) => {
        const sel = stain.id === layer.selectedStainId;
        return `
<div class="stain-item${sel ? ' selected' : ''}" data-stain-id="${stain.id}">
    <div class="stain-item-header" data-stain-action="select" data-stain-id="${stain.id}">
        <button class="layer-toggle${stain.enabled === false ? '' : ' on'}" data-stain-action="toggle" data-stain-id="${stain.id}"></button>
        <span class="stain-item-name">Stain #${i + 1}</span>
        <div class="stain-item-btns">
            <button class="layer-btn" data-stain-action="dup" data-stain-id="${stain.id}" title="Duplicate">⧉</button>
            <button class="layer-btn" data-stain-action="expand" data-stain-id="${stain.id}">${stain._expanded ? '▾' : '▸'}</button>
            <button class="layer-btn delete" data-stain-action="del" data-stain-id="${stain.id}">✕</button>
        </div>
    </div>
    ${stain._expanded ? `<div class="stain-params">${buildStainParams(stain)}</div>` : ''}
</div>
        `;
    }).join('');
}

function buildStainParams(stain) {
    const cA = stain.colorA || '#ff6030', cB = stain.colorB || '#8030ff';
    return `
<div class="params-section" style="font-size:9px;margin:2px 0 4px">Morphology</div>
${stl(stain.id, 'size', 'Shape Size', stain.size, 100, 2, 95)}
${stl(stain.id, 'density', 'Density', stain.density, 100)}
${stl(stain.id, 'softness', 'Softness', stain.softness, 100)}
${stl(stain.id, 'seed', 'Shape Seed', stain.seed, 1, 0, 999)}

<div class="params-section" style="font-size:9px;margin:8px 0 4px">Color & Strength</div>
<div class="control-row"><label>Color A</label><input type="color" data-stain-id="${stain.id}" data-stain-param="colorA" value="${cA}"></div>
<div class="control-row"><label>Color B</label><input type="color" data-stain-id="${stain.id}" data-stain-param="colorB" value="${cB}"></div>
${stl(stain.id, 'intensity', 'Intensity', stain.intensity, 100)}
${stl(stain.id, 'opacity', 'Opacity (Alpha)', stain.opacity, 100)}
${stl(stain.id, 'distortion', 'Distortion', stain.distortion, 100)}

<div class="params-section" style="font-size:9px;margin:8px 0 4px">Position & Edge</div>
${stl(stain.id, 'nx', 'Position X', stain.nx, 100)}
${stl(stain.id, 'ny', 'Position Y', stain.ny, 100)}
${stl(stain.id, 'edgeAffinity', 'Edge Affinity', stain.edgeAffinity, 100)}
    `;
}

function stl(stainId, key, label, val, div, min = 0, max = 100) {
    const raw = div === 1 ? val : Math.round(val * div);
    return `<div class="control-row"><label title="${label}">${label}</label><input type="range" data-stain-id="${stainId}" data-stain-param="${key}" min="${min}" max="${max}" value="${raw}"><span class="control-value">${raw}${div === 100 ? '%' : ''}</span></div>`;
}



function buildScannerParams(layer) {
    const p = layer.params;
    return `<div class="params-section">Scan</div>
<div class="control-row"><label>Orientation</label><select data-param="scanMode">${['horizontal', 'vertical'].map(m => `<option value="${m}"${p.scanMode === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
${sl('lineThickness', 'Line Thickness', p.lineThickness, 100)}
${sl('lineSpacing', 'Line Spacing', p.lineSpacing, 1000, 5, 200, '‰')}
${sl('lineSoftness', 'Line Softness', p.lineSoftness, 100)}
${sl('scanIntensity', 'Scan Intensity', p.scanIntensity, 100)}
<div class="params-section">Analog Character</div>
${sl('lineJitter', 'Line Jitter', p.lineJitter, 100)}
${sl('lineWarp', 'Line Warp', p.lineWarp, 100)}
${sl('dropouts', 'Dropouts', p.dropouts, 100)}
<div class="params-section">Color / Seed</div>
<div class="control-row"><label>Line Color</label><input type="color" data-param="lineColor" value="${p.lineColor || '#4dcfb0'}"></div>
${sl('seed', 'Seed', p.seed, 1, 0, 999)}`;
}

function buildGrainParams(layer) {
    const p = layer.params;
    return `<div class="params-section">Film Grain</div>
${sl('grainDensity', 'Grain Density', p.grainDensity || .55, 100)}
${sl('grainSize', 'Grain Size', p.grainSize || .38, 100)}
<div class="params-section">Aberration</div>
${sl('chromatic', 'Chromatic Aberration', p.chromatic || .18, 100)}
${sl('seed', 'Grain Seed', p.seed, 1, 0, 999)}`;
}

function sl(key, label, val, div, min = 0, max = 100, unit = '') {
    const raw = div === 1 ? val : Math.round(val * (div === 1000 ? 1000 : 100));
    return `<div class="control-row"><label title="${label}">${label}</label><input type="range" data-param="${key}" min="${min}" max="${max}" value="${raw}"><span class="control-value">${raw}${unit}</span></div>`;
}

// ── SLIDER UPDATE (shared logic) ─────────────────────────────────
function applyRangeInput(layer, item, e) {
    const par = e.target.dataset.param; if (!par) return;
    markDirty(layer);
    if (e.target.type === 'color') { layer.params[par] = e.target.value; requestRender(); return; }
    const raw = +e.target.value, cfg = paramCfg(par);
    layer.params[par] = raw / cfg.div;
    const sp = e.target.nextElementSibling; if (sp && sp.classList.contains('control-value')) sp.textContent = raw + (cfg.unit || '');
    if (par === 'seed' || par === 'seedMode') { layer._noises = null; layer._attractors = null; }
    requestRender();
}

// ── EVENT DELEGATION ─────────────────────────────────────────────
function initLayerEvents() {
    dom.layerList.addEventListener('click', e => {
        const item = e.target.closest('.layer-item'); if (!item) return;
        const id = +item.dataset.id, layer = getLayer(id); if (!layer) return;
        const act = e.target.dataset.action;
        if (act === 'toggle') { layer.enabled = !layer.enabled; renderLayerList(); requestRender(); }
        else if (act === 'del') deleteLayer(id);
        else if (act === 'dup') duplicateLayer(id);
        else if (act === 'up') moveLayer(id, -1);
        else if (act === 'down') moveLayer(id, 1);
        else if (act === 'expand') { layer.expanded = !layer.expanded; renderLayerList(); }
        // ── Stain list actions (data-stain-action) ──
        const stainAction = e.target.dataset.stainAction || e.target.closest('[data-stain-action]')?.dataset.stainAction;
        const stainId = e.target.dataset.stainId || e.target.closest('[data-stain-id]')?.dataset.stainId;
        const sid = stainId ? +stainId : null;

        // Also catch data-layer-action buttons (addStain, randomizeAll)
        const layerAction = e.target.dataset.layerAction;
        if (layerAction === 'addStain' && layer.type === 'waves') {
            startStainPlacement(id); return;
        }
        if (layerAction === 'randomizeAll' && layer.type === 'waves') {
            markDirty(layer);
            layer.params.seed = Math.floor(Math.random() * 999);
            (layer.stains || []).forEach(s => s.seed = Math.floor(Math.random() * 999));
            renderLayerList(); requestRender(); return;
        }

        if (stainAction && layer.type === 'waves') {
            markDirty(layer);
            if (stainAction === 'select' && sid !== null) {
                layer.selectedStainId = (layer.selectedStainId === sid) ? null : sid; renderLayerList(); requestRender();
            } else if (stainAction === 'toggle' && sid !== null) {
                const s = (layer.stains || []).find(x => x.id === sid); if (s) { s.enabled = !s.enabled; renderLayerList(); requestRender(); }
            } else if (stainAction === 'del' && sid !== null) {
                layer.stains = (layer.stains || []).filter(x => x.id !== sid); if (layer.selectedStainId === sid) layer.selectedStainId = null; renderLayerList(); requestRender();
            } else if (stainAction === 'dup' && sid !== null) {
                const s = (layer.stains || []).find(x => x.id === sid); if (s) { const ns = { ...s, id: layer.stainNextId++, nx: s.nx + 0.03, ny: s.ny + 0.03, _expanded: false }; layer.stains.push(ns); renderLayerList(); requestRender(); }
            } else if (stainAction === 'expand' && sid !== null) {
                const s = (layer.stains || []).find(x => x.id === sid); if (s) { s._expanded = !s._expanded; renderLayerList(); }
            }
        }
    });


    // ── SLIDER FIX: listen to BOTH input (continuous drag) AND change (track clicks, keyboard)
    const handleParamEvent = e => {
        const item = e.target.closest('.layer-item'); if (!item) return;
        const id = +item.dataset.id, layer = getLayer(id); if (!layer) return;
        const act = e.target.dataset.action, par = e.target.dataset.param;
        // Opacity slider
        if (act === 'opacity') { layer.opacity = +e.target.value / 100; const sp = item.querySelector('.lq-val'); if (sp) sp.textContent = e.target.value + '%'; requestRender(); return; }
        // Rename
        if (act === 'rename') { layer.name = e.target.value; return; }
        // Blend / maskMode selects
        if (act === 'blend') { layer.blendMode = e.target.value; requestRender(); return; }
        if (act === 'maskMode') { layer.maskMode = e.target.value; requestRender(); return; }
        // Range params (input + change both use same path)
        if (par && e.target.type === 'range') { applyRangeInput(layer, item, e); return; }
        // ── Stain param inputs (data-stain-param) ──
        const spar = e.target.dataset.stainParam;
        const sid2 = e.target.dataset.stainId ? +e.target.dataset.stainId : null;
        if (spar && sid2 !== null) {
            const stain = (layer.stains || []).find(s => s.id === sid2);
            if (stain) {
                markDirty(layer);
                if (e.target.type === 'range') {
                    const isRaw = ['seed'].includes(spar);
                    const val = +e.target.value;
                    stain[spar] = isRaw ? val : val / 100;
                    const sp = e.target.nextElementSibling; if (sp && sp.classList.contains('control-value')) sp.textContent = val + (isRaw ? '' : '%');
                } else {
                    stain[spar] = e.target.value;
                }
                requestRender();
            }
            return;
        }

        // ── Layer-level action selects (data-layer-action) ──
        const la = e.target.dataset.layerAction;
        // (None currently for Waves except buttons handled above)

        // Select params
        if (par) {
            let v = e.target.value;
            if (par === 'specks') v = v === 'true';
            if (par === 'seedMode') { markDirty(layer); layer.params.seedMode = v; layer._noises = null; layer._attractors = null; requestRender(); return; }
            if (par === 'scanMode') { markDirty(layer); layer.params.scanMode = v; requestRender(); return; }
            markDirty(layer); layer.params[par] = v; requestRender();
        }
    };

    dom.layerList.addEventListener('input', handleParamEvent);    // continuous drag + keyboard
    dom.layerList.addEventListener('change', handleParamEvent);   // track clicks + unfocus
}

function paramCfg(key) {
    if (['seed', 'contourSteps', 'stainSeed'].includes(key)) return { div: 1, unit: '' };
    if (key === 'flowDirection') return { div: 1, unit: '\u00b0' };
    if (key === 'lineSpacing') return { div: 1000, unit: '\u2030' };
    return { div: 100, unit: '' };
}

// ── ADD LAYER MENU ───────────────────────────────────────────────
function initAddLayerMenu() {
    dom.btnAddLayer.addEventListener('click', e => { e.stopPropagation(); dom.addLayerMenu.classList.toggle('hidden'); });
    dom.addLayerMenu.addEventListener('click', e => { const btn = e.target.closest('.add-menu-item'); if (!btn) return; dom.addLayerMenu.classList.add('hidden'); addLayer(btn.dataset.addType); });
    document.addEventListener('click', () => dom.addLayerMenu.classList.add('hidden'));
}

// ── HOTSPOT EVENTS ───────────────────────────────────────────────
function initHotspotEvents() {
    dom.btnHotspotToggle.addEventListener('click', () => {
        state.hotspotActive = !state.hotspotActive;
        dom.hotspotControls.classList.toggle('hidden', !state.hotspotActive);
        dom.btnHotspotToggle.classList.toggle('active', state.hotspotActive);
        dom.hotspotCanvas.classList.toggle('hidden', !state.hotspotActive);
        dom.hotspotCanvas.classList.toggle('painting', state.hotspotActive);
        dom.brushCursor.classList.toggle('hidden', !state.hotspotActive);
        syncHotspotCanvas(); if (state.hotspotActive) drawHotspotOverlay();
    });
    dom.hotspotBrushSize.addEventListener('input', () => { state.hotspotBrush = +dom.hotspotBrushSize.value; const s = dom.hotspotBrushSize.nextElementSibling; if (s) s.textContent = state.hotspotBrush; });
    dom.hotspotBrushSize.addEventListener('change', () => { state.hotspotBrush = +dom.hotspotBrushSize.value; });
    dom.hotspotStrength.addEventListener('input', () => { state.hotspotStr = dom.hotspotStrength.value / 100; const s = dom.hotspotStrength.nextElementSibling; if (s) s.textContent = dom.hotspotStrength.value; });
    dom.hotspotStrength.addEventListener('change', () => { state.hotspotStr = dom.hotspotStrength.value / 100; });
    dom.btnHotspotErase.addEventListener('click', () => { state.hotspotErase = !state.hotspotErase; dom.btnHotspotErase.classList.toggle('active', state.hotspotErase); dom.btnHotspotErase.textContent = state.hotspotErase ? '✏ Paint' : '⌦ Erase'; });
    dom.btnHotspotClear.addEventListener('click', () => { if (state.hotspotMask) state.hotspotMask.fill(0); drawHotspotOverlay(); requestRender(); });
    let painting = false;
    const onDown = e => { e.preventDefault(); painting = true; const cx = e.clientX || (e.touches?.[0]?.clientX), cy = e.clientY || (e.touches?.[0]?.clientY); if (cx != null) paintHotspot(cx, cy); };
    const onMove = e => { const cx = e.clientX ?? (e.touches?.[0]?.clientX), cy = e.clientY ?? (e.touches?.[0]?.clientY); if (cx == null) return; if (state.hotspotActive) updateBrushCursor(cx, cy); if (painting && state.hotspotActive) paintHotspot(cx, cy); };
    dom.hotspotCanvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', () => { painting = false; });
    dom.hotspotCanvas.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', e => { if (!state.hotspotActive) return; e.preventDefault(); onMove(e); }, { passive: false });
    window.addEventListener('touchend', () => { painting = false; });
}

// ── VIEW CONTROLS ────────────────────────────────────────────────
function initViewControls() {
    $$('.view-btn').forEach(btn => btn.addEventListener('click', () => {
        $$('.view-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        state.viewMode = btn.dataset.mode; dom.splitDivider.classList.toggle('hidden', state.viewMode !== 'split');
        if (state.viewMode === 'split') positionSplitDiv(); requestRender();
    }));
    dom.btnScanline && dom.btnScanline.addEventListener('click', () => { dom.scanlineOverlay.classList.toggle('hidden'); dom.btnScanline.classList.toggle('active'); });
    dom.btnDownload.addEventListener('click', doDownload);
    dom.splitDivider.addEventListener('mousedown', e => { e.preventDefault(); state.isDraggingSplit = true; });
    window.addEventListener('mousemove', e => { if (!state.isDraggingSplit) return; const r = dom.displayCanvas.getBoundingClientRect(); state.splitPos = Math.max(.05, Math.min(.95, (e.clientX - r.left) / r.width)); positionSplitDiv(); requestRender(); });
    window.addEventListener('mouseup', () => { state.isDraggingSplit = false; });
    window.addEventListener('resize', () => { syncHotspotCanvas(); if (state.viewMode === 'split') positionSplitDiv(); });
}
function positionSplitDiv() { const r = dom.displayCanvas.getBoundingClientRect(), cr = dom.canvasContainer.getBoundingClientRect(); dom.splitDivider.style.left = (r.left - cr.left + state.splitPos * r.width) + 'px'; }

function doDownload() {
    if (!state.originalImage) return;
    const w = filteredCanvas.width, h = filteredCanvas.height;
    if (!w || !h) return;
    // Re-composite at full resolution
    const res = compositeLayers(w, h);
    filteredCtx.putImageData(new ImageData(res, w, h), 0, 0);
    // Vignette
    const vg = filteredCtx.createRadialGradient(w / 2, h / 2, w * .3, w / 2, h / 2, w * .8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.15)');
    filteredCtx.fillStyle = vg; filteredCtx.fillRect(0, 0, w, h);
    // Synchronous download — avoids popup-blocker on async toBlob
    try {
        const dataURL = filteredCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = 'ghost-signal.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        console.error('Download error:', err);
        alert('Download failed. Try right-clicking the canvas and saving.');
    }
}

// ── STAIN PLACEMENT ───────────────────────────────────────────────
function initStainPlacement() {
    const dc = dom.displayCanvas;
    const spc = document.getElementById('stain-place-cursor');

    function getCanvasNormCoords(e) {
        const rect = dc.getBoundingClientRect();
        return { nx: (e.clientX - rect.left) / rect.width, ny: (e.clientY - rect.top) / rect.height };
    }

    // Dragging logic
    let isDraggingStain = false;
    dc.addEventListener('mousedown', e => {
        if (state.placingStainLayerId !== null) return;
        const wavesLayer = state.layers.find(l => l.enabled && l.type === 'waves' && l.expanded);
        if (wavesLayer && wavesLayer.selectedStainId !== null) {
            const stain = (wavesLayer.stains || []).find(s => s.id === wavesLayer.selectedStainId);
            if (stain) {
                const { nx, ny } = getCanvasNormCoords(e);
                if (Math.abs(nx - stain.nx) < 0.1 && Math.abs(ny - stain.ny) < 0.1) {
                    isDraggingStain = true;
                }
            }
        }
    });

    window.addEventListener('mousemove', e => {
        if (state.placingStainLayerId !== null) {
            const rect = dc.getBoundingClientRect();
            spc.style.left = (e.clientX - rect.left - 40) + 'px';
            spc.style.top = (e.clientY - rect.top - 40) + 'px';
            spc.style.width = '80px';
            spc.style.height = '80px';
        }
        if (isDraggingStain) {
            const wavesLayer = state.layers.find(l => l.enabled && l.type === 'waves' && l.expanded);
            const stain = wavesLayer?.stains.find(s => s.id === wavesLayer.selectedStainId);
            if (stain) {
                const { nx, ny } = getCanvasNormCoords(e);
                stain.nx = Math.max(0, Math.min(1, nx));
                stain.ny = Math.max(0, Math.min(1, ny));
                markDirty(wavesLayer); requestRender(); updateSelectionIndicator();
            }
        }
    });

    window.addEventListener('mouseup', () => { isDraggingStain = false; });

    dc.addEventListener('click', e => {
        if (state.placingStainLayerId === null) return;
        const layer = getLayer(state.placingStainLayerId);
        if (!layer) { endStainPlacement(); return; }
        const { nx, ny } = getCanvasNormCoords(e);
        const ns = mkStain(layer);
        ns.nx = Math.max(0, Math.min(1, nx));
        ns.ny = Math.max(0, Math.min(1, ny));
        layer.stains.push(ns);
        layer.selectedStainId = ns.id;
        endStainPlacement();
        renderLayerList();
        requestRender();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && state.placingStainLayerId !== null) endStainPlacement();
    });
}

window.startStainPlacement = function (layerId) {
    state.placingStainLayerId = layerId;
    dom.displayCanvas.classList.add('placing-stain');
    const spc = document.getElementById('stain-place-cursor');
    if (spc) spc.classList.remove('hidden');
};
window.endStainPlacement = function () {
    state.placingStainLayerId = null;
    dom.displayCanvas.classList.remove('placing-stain');
    const spc = document.getElementById('stain-place-cursor');
    if (spc) spc.classList.add('hidden');
};
function updateSelectionIndicator() {
    const si = document.getElementById('stain-selection-indicator');
    if (!si) return;
    const wavesLayer = state.layers.find(l => l.enabled && l.type === 'waves' && l.expanded);
    if (!wavesLayer || wavesLayer.selectedStainId === null || state.viewMode === 'hotspot') {
        si.classList.add('hidden'); return;
    }
    const stain = (wavesLayer.stains || []).find(s => s.id === wavesLayer.selectedStainId);
    if (!stain || !stain.enabled) { si.classList.add('hidden'); return; }
    const rect = dom.displayCanvas.getBoundingClientRect();
    const sz = stain.size * Math.min(rect.width, rect.height) * 1.5;
    si.style.left = (rect.left + stain.nx * rect.width) + 'px';
    si.style.top = (rect.top + stain.ny * rect.height) + 'px';
    si.style.width = sz + 'px';
    si.style.height = sz + 'px';
    si.classList.remove('hidden');
}

// ── INIT ─────────────────────────────────────────────────────────
function init() {
    initUpload(); initAddLayerMenu(); initLayerEvents(); initHotspotEvents(); initViewControls(); initStainPlacement();
    const wav = mkLayer('waves'); wav.name = 'Waves Detection'; state.layers.push(wav);
    const scn = mkLayer('scanner'); scn.name = 'Scanner'; scn.enabled = false; state.layers.push(scn);
    const grn = mkLayer('grain'); grn.name = 'Grain / Glitch'; grn.enabled = false; grn.blendMode = 'overlay'; state.layers.push(grn);
    renderLayerList(); requestAnimationFrame(syncHotspotCanvas);
    window.addEventListener('resize', updateSelectionIndicator);
    window.addEventListener('scroll', updateSelectionIndicator);
}
document.addEventListener('DOMContentLoaded', init);


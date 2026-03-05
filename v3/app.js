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

// ── v3 MODE PRESETS ───────────────────────────────────────────────
const MODE_PRESETS = {
    cold: { palette: 'cold', geometry: 'contours', opacity: .65, density: .45, contrast: .55, noiseScale: .35, threshold: .48, intensity: .60, chromatic: .25, distortion: .18, contourSteps: 10, bandSoftness: .30, presenceCoherence: .65, spatialGravity: .55 },
    spectral: { palette: 'spectral', geometry: 'flow', opacity: .65, density: .50, contrast: .52, noiseScale: .40, threshold: .42, intensity: .70, chromatic: .40, distortion: .28, flowDirection: 45, flowStretch: .50, presenceCoherence: .65, spatialGravity: .55 },
    infrared: { palette: 'infrared', geometry: 'cells', opacity: .68, density: .55, contrast: .55, noiseScale: .45, threshold: .38, intensity: .72, chromatic: .35, distortion: .22, hotspotSize: .55, hotspotCluster: .52, presenceCoherence: .65, spatialGravity: .55 },
    presence: { palette: 'presence', geometry: 'ghost', opacity: .72, density: .42, contrast: .45, noiseScale: .28, threshold: .35, intensity: .80, chromatic: .20, distortion: .35, presenceCoherence: .65, spatialGravity: .55 },
};
function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

// ── LAYER TYPES ──────────────────────────────────────────────────
const LAYER_TYPES = {
    signal: {
        label: 'Signal Field', defaultParams: {
            mode: 'presence', palette: 'presence', geometry: 'ghost',
            opacity: .72, density: .42, contrast: .45, noiseScale: .28,
            threshold: .35, intensity: .80, chromatic: .20, distortion: .35,
            seed: 42, seedMode: 'stable', blendMode: 'screen',
            presenceCoherence: .65, spatialGravity: .55, edgeAffinity: 0,
            contourSteps: 8, bandSoftness: .30,
            flowDirection: 45, flowStretch: .50,
            hotspotSize: .50, hotspotCluster: .50,
        }
    },
    scanner: { label: 'Scanner', defaultParams: { scanMode: 'horizontal', lineThickness: .08, lineSpacing: .05, lineJitter: .15, lineWarp: .25, lineSoftness: .55, scanIntensity: .50, lineColor: '#4dcfb0', dropouts: .08, seed: 7 } },
    grain: { label: 'Grain / Glitch', defaultParams: { grainAmount: .55, grainSize: .4, chromaBleed: .25, noiseCrawl: .2, tearAmount: .08, tearStrength: .35, specks: true, speckAmount: .12, vignetteAmount: .3, seed: 17 } },
};

// ── STATE ────────────────────────────────────────────────────────
const state = {
    originalImage: null, originalData: null, lumMap: null, edgeMap: null,
    layers: [], nextId: 1,
    hotspotMask: null, hotspotActive: false, hotspotErase: false, hotspotBrush: 40, hotspotStr: .6,
    viewMode: 'filtered', splitPos: .5, isDraggingSplit: false,
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
function mkLayer(type, ov = {}) { const def = LAYER_TYPES[type] || LAYER_TYPES.signal; return { id: state.nextId++, type, name: def.label, enabled: true, opacity: .75, blendMode: 'screen', params: { ...def.defaultParams, ...ov }, expanded: false, _attractors: null, _noises: null }; }
function addLayer(type) { state.layers.unshift(mkLayer(type)); renderLayerList(); requestRender(); }
function deleteLayer(id) { state.layers = state.layers.filter(l => l.id !== id); renderLayerList(); requestRender(); }
function duplicateLayer(id) { const i = state.layers.findIndex(l => l.id === id); if (i < 0) return; const c = { ...state.layers[i], id: state.nextId++, name: state.layers[i].name + ' copy', params: { ...state.layers[i].params }, expanded: false, _attractors: null, _noises: null }; state.layers.splice(i, 0, c); renderLayerList(); requestRender(); }
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
            requestAnimationFrame(() => { syncHotspotCanvas(); requestRender(); });
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

// ── GHOST MASS FIELD (v3) ────────────────────────────────────────
function ghostMassField(px, py, p, noises, hotspotIdx) {
    const { C: NC, P: NP, F: NF, M: NM } = noises;
    const coherence = p.presenceCoherence, gravity = p.spatialGravity;
    // Wider sigma by default = larger volumetric blobs
    const sigma = 0.08 + (1 - gravity) * 0.32;
    const ds = 0.3 + p.density * 0.8;
    let mass = 0;
    for (const att of noises._attractors) {
        const dx = px - att.nx, dy = py - att.ny;
        mass += Math.exp(-(dx * dx * 1.0 + dy * dy * 0.7) / (2 * sigma * sigma));
    }
    mass = Math.min(1, mass / noises._attractors.length);
    // Domain warp noise
    const warpX = NP.fbm(px * ds * 0.5, py * ds * 0.5, 3, 2.1, 0.55) * 0.4;
    const warpY = NP.fbm(px * ds * 0.5 + 3.7, py * ds * 0.5, 3, 2.1, 0.55) * 0.4;
    const body = NC.fbm((px + warpX * 0.5) * ds, (py + warpY * 0.5) * ds, 4, 2.0, 0.50);
    const bodyMapped = (body + 1) * 0.5;
    const grain = (NF.n2(px * ds * 5, py * ds * 5) + 1) * 0.5;
    const modulated = bodyMapped * (1 + mass * coherence * 2.5);
    const clamped = Math.min(1, Math.max(0, modulated));
    return Math.min(1, Math.max(0, clamped * 0.88 + grain * 0.12));
}

// ── GEOMETRY HELPERS (v3) ─────────────────────────────────────────
function shapeContours(v, steps, soft) {
    const scaled = v * steps, band = Math.floor(scaled), frac = scaled - band, edge = 1 - soft;
    let bv = (band % 2 === 0) ? (edge >= 0.99 ? 0.3 : 0.3 + Math.max(0, (frac - edge) / (1 - edge)) ** 2 * 0.5) : (edge >= 0.99 ? 0.8 : 0.8 - Math.max(0, (frac - edge) / (1 - edge)) ** 2 * 0.5);
    return bv * v + (1 - bv) * 0.15;
}
function sampleFlow(N, px, py, ds, dir, stretch, oct) {
    const rad = dir * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
    return N.fbm(px * ca - py * sa, (px * sa + py * ca) * (1 + stretch * 3), oct, 2.2, 0.45);
}
function shapeCells(v, hSize, clust) {
    const thr = 0.4 + (1 - hSize) * 0.3, sp = 0.1 + clust * 0.3;
    return v > thr ? Math.min(1, (v - thr) / sp) ** 2 : v * 0.15;
}

// ── SIGNAL FIELD RENDER (v3 pipeline) ────────────────────────────
function renderSignalField(layer, w, h) {
    const p = layer.params;
    const noises = getNoises(layer);
    if (!layer._attractors) layer._attractors = buildAttractors(p.seed);
    noises._attractors = layer._attractors;
    const { C: NC, M: NM, F: NF } = noises;

    const geo = (p.geometry && p.geometry !== 'auto') ? p.geometry : (MODE_PRESETS[p.mode]?.geometry || 'ghost');
    const palette = PALETTES[p.palette || p.mode] || PALETTES.presence;
    const baseScale = 0.001 + p.noiseScale * 0.01;
    const ds = 0.5 + p.density * 1.5;
    const cp = 0.5 + p.contrast * 2.0;
    const thr = p.threshold, im = 0.4 + p.intensity * 1.4;
    const isGhost = geo === 'ghost';
    const hasL = state.lumMap != null, hasH = state.hotspotMask != null;
    const edgeAff = p.edgeAffinity || 0;
    const out = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
            const nx = x / w, px = x * baseScale, py = y * baseScale;
            let norm;
            if (isGhost) {
                norm = ghostMassField(nx, ny, p, noises, y * w + x);
                if (hasL) {
                    const lum = state.lumMap[y * w + x];
                    const lumBias = Math.max(0, 1 - ((lum - 0.45) / 0.55) ** 2);
                    const lumMix = 0.35 + p.presenceCoherence * 0.45;
                    norm = Math.min(1, Math.max(0, norm * (1 - lumMix) + norm * lumBias * 1.2 * lumMix));
                }
                norm = Math.pow(norm, 0.4 + p.contrast * 1.2);
            } else if (geo === 'flow') {
                const c = sampleFlow(NC, px * 0.3, py * 0.3, ds, p.flowDirection || 45, p.flowStretch || .5, 3);
                const m = sampleFlow(NM, px, py, ds, p.flowDirection || 45, (p.flowStretch || .5) * 0.7, 3);
                const f = NF.n2(px * ds * 4, py * ds * 4);
                norm = Math.pow(Math.max(0, Math.min(1, (c * 0.5 + m * 0.35 + f * 0.15 + 1) * 0.5)), cp);
            } else if (geo === 'cells') {
                const c = NC.fbm(px * ds * 0.3, py * ds * 0.3, 3, 2.0, 0.5);
                const m = NM.fbm(px * ds * 0.8, py * ds * 0.8, 3, 2.2, 0.45);
                const f = NF.n2(px * ds * 4, py * ds * 4);
                norm = shapeCells(Math.pow(Math.max(0, Math.min(1, ((c * 0.55 + m * 0.3 + f * 0.15) + 1) * 0.5)), cp), p.hotspotSize || .5, p.hotspotCluster || .5);
            } else if (geo === 'contours') {
                const c = NC.fbm(px * ds * 0.3, py * ds * 0.3, 3, 2.0, 0.5);
                const m = NM.fbm(px * ds, py * ds, 3, 2.2, 0.45);
                const f = NF.n2(px * ds * 4, py * ds * 4);
                norm = shapeContours(Math.pow(Math.max(0, Math.min(1, ((c * 0.5 + m * 0.35 + f * 0.15) + 1) * 0.5)), cp), p.contourSteps || 8, p.bandSoftness || .3);
            } else {
                const c = NC.fbm(px * ds * 0.3, py * ds * 0.3, 3, 2.0, 0.5);
                const m = NM.fbm(px * ds, py * ds, 3, 2.2, 0.45);
                const f = NF.n2(px * ds * 4, py * ds * 4);
                norm = Math.pow(Math.max(0, Math.min(1, (c * 0.5 + m * 0.35 + f * 0.15 + 1) * 0.5)), cp);
            }
            // Hotspot boost injects presence into the same field
            if (hasH) { const hv = state.hotspotMask[y * w + x]; if (hv > 0.005) norm = Math.min(1, norm + hv * p.intensity * 0.75); }
            // Activity zone
            let af = norm > thr ? Math.min(1, (norm - thr) / (1 - thr + 0.01)) * im : norm * (isGhost ? 0.22 : 0.3);
            // Edge affinity
            if (state.edgeMap && edgeAff > 0) {
                const ev = state.edgeMap[y * w + x] || 0;
                if (isGhost && edgeAff < 0.5) af = af * (1 - edgeAff * 2) + af * (1 - ev) * edgeAff * 2;
                else af = af * (1 - edgeAff) + af * ev * 2.5 * edgeAff;
                af = Math.min(1.3, Math.max(0, af));
            }
            // Color from v3 palette
            const rgb = samplePalette(palette, norm);
            let r = rgb[0], g = rgb[1], b = rgb[2];
            if (isGhost) { const gr = (r + g + b) / 3; r = r * 0.75 + gr * 0.25; g = g * 0.75 + gr * 0.25; b = b * 0.75 + gr * 0.25; }
            const alpha = Math.min(255, af * 255 * (isGhost ? 1.15 : 1));
            const idx = (y * w + x) * 4;
            out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = alpha;
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
function renderGrain(layer, w, h) {
    const p = layer.params, NG = new SimplexNoise(p.seed), NG2 = new SimplexNoise(p.seed * 3 + 97), NT = new SimplexNoise(p.seed * 11 + 503);
    const gFreq = 1 + p.grainSize * 8, bleedPx = Math.round(p.chromaBleed * 6), tearThresh = 1 - p.tearAmount * .6;
    const tearOff = new Int16Array(h);
    for (let y = 0; y < h; y++) { const tn = NT.n2(.05, y / h * 15 + p.seed * .007); tearOff[y] = tn > tearThresh ? Math.round((tn - tearThresh) / (1 - tearThresh) * p.tearStrength * 40 * (Math.random() > .5 ? 1 : -1)) : 0; }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        const to = tearOff[y];
        for (let x = 0; x < w; x++) {
            const xg = x * gFreq / w, yg = y * gFreq / h;
            const g1 = NG.n2(xg, yg), g2 = p.noiseCrawl > 0 ? NG2.n2(xg + p.noiseCrawl * 2, yg) * .2 : 0;
            const grain = (g1 * .85 + g2) * p.grainAmount;
            let rExtra = 0, bExtra = 0;
            if (bleedPx > 0) { const xr = Math.max(0, Math.min(w - 1, x + bleedPx + to)), xb = Math.max(0, Math.min(w - 1, x - bleedPx + to)); rExtra = (NG.n2(xr * gFreq / w, yg) - g1) * .5 * p.chromaBleed; bExtra = (NG.n2(xb * gFreq / w, yg) - g1) * .5 * p.chromaBleed; }
            const gv = Math.round(grain * 180), rv = Math.round(rExtra * 120), bv = Math.round(bExtra * 120);
            let spA = 0, spV = 128;
            if (p.specks) { const sn = Math.abs(NG.n2(x * 25 + .7, y * 25 + .3)); if (sn > 1 - p.speckAmount * .12) { spA = Math.round((sn - (1 - p.speckAmount * .12)) * 6000); spV = Math.random() > .5 ? 230 : 20; } }
            const alpha = Math.min(255, Math.abs(gv) * 2.2 + spA + Math.abs(rv) + Math.abs(bv)); if (alpha < 2) continue;
            const tx = Math.max(0, Math.min(w - 1, x + to)), oi = (y * w + tx) * 4;
            out[oi] = Math.max(0, Math.min(255, 128 + gv + rv + (spA ? spV - 128 : 0)));
            out[oi + 1] = Math.max(0, Math.min(255, 128 + gv + (spA ? spV - 128 : 0)));
            out[oi + 2] = Math.max(0, Math.min(255, 128 + gv + bv + (spA ? spV - 128 : 0)));
            out[oi + 3] = Math.max(out[oi + 3], alpha);
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
}

function compositeLayers(w, h) {
    const orig = state.originalData.data, final = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { final[i * 4] = orig[i * 4]; final[i * 4 + 1] = orig[i * 4 + 1]; final[i * 4 + 2] = orig[i * 4 + 2]; final[i * 4 + 3] = 255; }
    for (let li = state.layers.length - 1; li >= 0; li--) {
        const layer = state.layers[li]; if (!layer.enabled) continue;
        let ld;
        if (layer.type === 'signal') ld = renderSignalField(layer, w, h);
        else if (layer.type === 'scanner') ld = renderScanner(layer, w, h);
        else if (layer.type === 'grain') ld = renderGrain(layer, w, h);
        else continue;
        // Scanner/Grain: optional hotspot alpha gate
        if (layer.type !== 'signal' && (layer.maskMode === 'hotspot' || layer.maskMode === 'hybrid') && state.hotspotMask)
            for (let i = 0; i < w * h; i++)ld[i * 4 + 3] = Math.round(ld[i * 4 + 3] * state.hotspotMask[i]);
        const bf = blendFn(layer.blendMode), op = layer.opacity;
        const isSig = layer.type === 'signal';
        const chrMax = isSig ? (layer.params.chromatic || 0) * 12 : 0, distMax = isSig ? (layer.params.distortion || 0) * 14 : 0;
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
    // Use active signal layer's palette for visual consistency
    const sigLayer = state.layers.find(l => l.type === 'signal' && l.enabled);
    const pal = (sigLayer && PALETTES[sigLayer.params.palette || sigLayer.params.mode]) || PALETTES.presence;
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
        const badge = layer.type === 'grain' ? 'GRN' : layer.type === 'scanner' ? 'SCN' : 'SIG';
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

function buildTypeParams(l) { if (l.type === 'scanner') return buildScannerParams(l); if (l.type === 'grain') return buildGrainParams(l); return buildSignalParams(l); }

function buildSignalParams(layer) {
    const p = layer.params;
    const geo = p.geometry || 'ghost';
    const geoOpts = ['ghost', 'flow', 'cells', 'contours', 'auto'].map(g => `<option value="${g}"${p.geometry === g ? ' selected' : ''}>${g}</option>`).join('');
    const modeOpts = ['presence', 'spectral', 'infrared', 'cold'].map(m => `<option value="${m}"${p.mode === m ? ' selected' : ''}>${PALETTES[m]?.name || m}</option>`).join('');
    let geoExtra = '';
    if (geo === 'flow' || geo === 'auto') geoExtra += `${sl('flowDirection', 'Flow Direction', p.flowDirection || 45, 1, 0, 360, '°')}${sl('flowStretch', 'Flow Stretch', p.flowStretch || .5, 100)}`;
    if (geo === 'cells') geoExtra += `${sl('hotspotSize', 'Hotspot Size', p.hotspotSize || .5, 100)}${sl('hotspotCluster', 'Hotspot Cluster', p.hotspotCluster || .5, 100)}`;
    if (geo === 'contours') geoExtra += `${sl('contourSteps', 'Contour Steps', p.contourSteps || 8, 1, 2, 20)}${sl('bandSoftness', 'Band Softness', p.bandSoftness || .3, 100)}`;
    return `<div class="params-section">Detection Mode</div>
<div class="control-row"><label>Mode</label><select data-param="mode">${modeOpts}</select></div>
<div class="params-section">Signal</div>
${sl('density', 'Density', p.density, 100)}
${sl('contrast', 'Interference', p.contrast, 100)}
${sl('noiseScale', 'Drift Scale', p.noiseScale, 100)}
<div class="params-section">Activity Zones</div>
${sl('threshold', 'Threshold', p.threshold, 100)}
${sl('intensity', 'Intensity', p.intensity, 100)}
<div class="params-section">Distortion</div>
${sl('chromatic', 'Chromatic Aberration', p.chromatic, 100)}
${sl('distortion', 'Distortion Amount', p.distortion, 100)}
<div class="params-section">Advanced</div>
<div class="control-row"><label>Signal Geometry</label><select data-param="geometry">${geoOpts}</select></div>
${sl('presenceCoherence', 'Presence Coherence', p.presenceCoherence || .65, 100)}
${sl('spatialGravity', 'Spatial Gravity', p.spatialGravity || .55, 100)}
${sl('edgeAffinity', 'Edge Affinity', p.edgeAffinity || 0, 100)}
${geoExtra}
<div class="params-section">Seed</div>
<div class="control-row"><label>Seed Mode</label><select data-param="seedMode"><option value="stable"${p.seedMode === 'stable' ? ' selected' : ''}>Stable</option><option value="wild"${p.seedMode === 'wild' ? ' selected' : ''}>Wild</option></select></div>
${sl('seed', 'Pattern Seed', p.seed, 1, 0, 999)}`;
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
${sl('grainAmount', 'Grain Amount', p.grainAmount, 100)}
${sl('grainSize', 'Grain Size', p.grainSize, 100)}
${sl('noiseCrawl', 'Noise Crawl', p.noiseCrawl, 100)}
<div class="params-section">Analog Error</div>
${sl('chromaBleed', 'Chroma Bleed', p.chromaBleed, 100)}
${sl('tearAmount', 'Tear Frequency', p.tearAmount, 100)}
${sl('tearStrength', 'Tear Strength', p.tearStrength, 100)}
<div class="params-section">Artifacts</div>
<div class="control-row"><label>Dust Specks</label><select data-param="specks"><option value="true"${p.specks ? ' selected' : ''}>On</option><option value="false"${!p.specks ? ' selected' : ''}>Off</option></select></div>
${sl('speckAmount', 'Speck Amount', p.speckAmount, 100)}
${sl('vignetteAmount', 'Vignette', p.vignetteAmount, 100)}
${sl('seed', 'Seed', p.seed, 1, 0, 999)}`;
}

function sl(key, label, val, div, min = 0, max = 100, unit = '') {
    const raw = div === 1 ? val : Math.round(val * (div === 1000 ? 1000 : 100));
    return `<div class="control-row"><label title="${label}">${label}</label><input type="range" data-param="${key}" min="${min}" max="${max}" value="${raw}"><span class="control-value">${raw}${unit}</span></div>`;
}

// ── SLIDER UPDATE (shared logic) ─────────────────────────────────
function applyRangeInput(layer, item, e) {
    const par = e.target.dataset.param; if (!par) return;
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
        // Select params
        if (par) {
            let v = e.target.value;
            if (par === 'specks') v = v === 'true';
            if (par === 'seedMode') { layer.params.seedMode = v; layer._noises = null; layer._attractors = null; requestRender(); return; }
            if (par === 'scanMode') { layer.params.scanMode = v; requestRender(); return; }
            if (par === 'mode' && layer.type === 'signal') {
                // Apply v3 mode preset to the layer params
                const preset = MODE_PRESETS[v];
                if (preset) { Object.assign(layer.params, preset, { mode: v, seed: layer.params.seed, seedMode: layer.params.seedMode }); layer._attractors = null; layer._noises = null; }
                else layer.params.mode = v;
                renderLayerList(); requestRender(); return;
            }
            if (par === 'geometry' && layer.type === 'signal') {
                layer.params.geometry = v;
                renderLayerList(); requestRender(); return;
            }
            layer.params[par] = v; requestRender();
        }
    };

    dom.layerList.addEventListener('input', handleParamEvent);    // continuous drag + keyboard
    dom.layerList.addEventListener('change', handleParamEvent);   // track clicks + unfocus
}

function paramCfg(key) {
    if (['seed', 'contourSteps'].includes(key)) return { div: 1, unit: '' };
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

// ── INIT ─────────────────────────────────────────────────────────
function init() {
    initUpload(); initAddLayerMenu(); initLayerEvents(); initHotspotEvents(); initViewControls();
    const sig = mkLayer('signal'); sig.name = 'Signal Field'; state.layers.push(sig);
    const scn = mkLayer('scanner'); scn.name = 'Scanner'; scn.enabled = false; state.layers.push(scn);
    const grn = mkLayer('grain'); grn.name = 'Grain / Glitch'; grn.enabled = false; grn.blendMode = 'overlay'; state.layers.push(grn);
    renderLayerList(); requestAnimationFrame(syncHotspotCanvas);
}
document.addEventListener('DOMContentLoaded', init);

/**
 * GHOST SIGNAL INSTRUMENT
 * Professional Experimental Visualization Tool
 * 
 * CORE ARCHITECTURE:
 * - State: Single source of truth.
 * - Layer classes: Decoupled rendering logic.
 * - SignalCloud: Independent volumetric objects.
 * - Renderer: Offscreen canvas pipeline with early-out optimizations.
 * - UI Bindings: Real-time parameter updates.
 */

/* ── UTILITIES ────────────────────────────────────────── */

// Seeded PRNG (Mulberry32)
const createRandom = (seed) => {
    return () => {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
};

// 2D Simplex-like Noise implementation (Fast for JS)
const noise = (() => {
    const p = new Uint8Array(512);
    const permutation = [151, 160, 137, 91, 90, 15,
        131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23,
        190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33,
        88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166,
        77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244,
        102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196,
        135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123,
        5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42,
        223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
        129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228,
        251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107,
        49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254,
        138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
    for (let i = 0; i < 256; i++) p[256 + i] = p[i] = permutation[i];

    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (t, a, b) => a + t * (b - a);
    const grad = (hash, x, y) => {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };

    return (x, y) => {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = fade(x);
        const v = fade(y);
        const a = p[X] + Y, aa = p[a], ab = p[a + 1],
            b = p[X + 1] + Y, ba = p[b], bb = p[b + 1];
        return lerp(v, lerp(u, grad(p[aa], x, y), grad(p[ba], x - 1, y)),
            lerp(u, grad(p[ab], x, y - 1), grad(p[bb], x - 1, y - 1)));
    };
})();

const fbm = (x, y, octaves, persistence = 0.5) => {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
        total += noise(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= 2;
    }
    return total / maxValue;
};

// Fixed Color Palettes
const PALETTES = {
    cold: {
        name: "Cold Infrastructure",
        stops: [
            { pos: 0.0, color: "rgba(0, 0, 0, 0)" },
            { pos: 0.2, color: "rgba(0, 150, 200, 0.4)" }, // Brighter cyan
            { pos: 0.6, color: "rgba(30, 60, 180, 0.9)" },  // Saturated blue
            { pos: 0.9, color: "rgba(120, 0, 220, 1.0)" },  // Stronger ultraviolet
            { pos: 1.0, color: "rgba(200, 50, 255, 0.8)" }  // Magenta fringe
        ]
    },
    dense: {
        name: "Dense Network",
        stops: [
            { pos: 0.0, color: "rgba(10, 5, 20, 0.2)" },   // Cool shadow base
            { pos: 0.3, color: "rgba(220, 140, 0, 0.6)" }, // Warmer amber
            { pos: 0.7, color: "rgba(240, 240, 30, 0.95)" }, // Luminous sodium
            { pos: 1.0, color: "rgba(180, 50, 20, 1.0)" }   // Rich deep red
        ]
    },
    residual: {
        name: "Residual Trace",
        stops: [
            { pos: 0.0, color: "rgba(0, 0, 0, 0)" },
            { pos: 0.4, color: "rgba(80, 200, 120, 0.7)" }, // Stronger green core
            { pos: 1.0, color: "rgba(255, 255, 255, 1.0)" }  // Pure white edge
        ]
    },
    neutral: {
        name: "Neutral Field",
        stops: [
            { pos: 0.0, color: "rgba(0, 0, 0, 0)" },
            { pos: 0.3, color: "rgba(50, 150, 180, 0.4)" },  // Cyan tension
            { pos: 0.7, color: "rgba(150, 100, 180, 0.5)" }, // Purple tension
            { pos: 1.0, color: "rgba(200, 200, 210, 0.9)" }  // Grayscale peak
        ]
    }
};

/* ── SIGNAL CLOUD CLASS ──────────────────────────────── */

class SignalCloud {
    constructor(x, y, id) {
        this.id = id;
        this.x = x;
        this.y = y;

        // Default Parameters
        this.params = {
            intensity: 0.8,
            size: 200,
            edgeAffinity: 0.6,
            palette: 'cold',
            threshold: 0.05,
            opacity: 0.8,
            irregularity: 0.5,
            useMetaballs: true,
            chromaticAberration: 0.3,
            interference: 0.2,
            distortion: 0.4,
            seed: Math.floor(Math.random() * 10000),
            anisotropy: 1.5,
            elongation: 0.2, // Vertical elongation bias
            blendMode: 'screen',
            dataVisible: true
        };

        // Fake Data
        this.data = {
            deviceId: "DEV-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
            network: ["ERR_VOID", "GHOST_NET", "FIELD_0X4", "NULL_SIG"][Math.floor(Math.random() * 4)],
            strength: (Math.random() * -100).toFixed(1) + " dBm",
            hash: "0x" + Math.random().toString(16).substr(2, 4).toUpperCase()
        };

        this.dirty = true;
        this.offscreen = document.createElement('canvas');
        this.ctx = this.offscreen.getContext('2d');
    }

    renderToCache() {
        if (!this.dirty) return;

        const size = Math.floor(this.params.size * 3.0);
        this.offscreen.width = size;
        this.offscreen.height = size;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, size, size);

        const centerX = size / 2;
        const centerY = size / 2;
        const radius = this.params.size;

        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        const buf = new Uint32Array(data.buffer);

        const rng = createRandom(this.params.seed);
        const seedShift = rng() * 2000;

        // Perceptual Scaling - DRATICALLY STRONGER FOR v11
        const irregularity = Math.pow(this.params.irregularity, 1.2) * 2.5;
        const distortion = this.params.distortion * 2.5; // Burning through
        const interference = this.params.interference * 3.5;
        const aberration = this.params.chromaticAberration * 15;

        const palette = PALETTES[this.params.palette] || PALETTES.cold;
        const threshold = this.params.threshold;
        const baseIntensity = this.params.intensity;
        const intensityBoost = 1.0 + Math.pow(baseIntensity, 2) * 10.0;
        const opacity = this.params.opacity;
        const anisotropy = this.params.anisotropy;
        const elongation = this.params.elongation;

        for (let py = 0; py < size; py++) {
            const dy = py - centerY;
            const dyAniso = dy * (anisotropy / (1 + elongation));
            const dySqAniso = dyAniso * dyAniso;
            const rowOffset = py * size;

            for (let px = 0; px < size; px++) {
                const dx = px - centerX;
                const distSq = (dx * dx) / anisotropy + dySqAniso;
                const dist = Math.sqrt(distSq);

                if (dist > radius * 1.8) continue;

                // 1. Base Falloff
                const sigma = radius * 0.7;
                let val = Math.exp(-(dist * dist) / (2.0 * sigma * sigma));

                // 2. Domain Warp (STRONGER)
                const noiseScale = 0.003 * (1 + irregularity * 0.4);
                const wx = px * noiseScale + seedShift;
                const wy = py * noiseScale + seedShift;

                // Drastic warp at high distortion
                const nx = noise(wx, wy) * distortion * 350;
                const ny = noise(wx + 11, wy + 11) * distortion * 350;

                // 3. FBM + Interference (STRONGER)
                const fx = (px + nx) * 0.008;
                const fy = (py + ny) * 0.008;
                let detail = fbm(fx, fy, 4, 0.5);

                if (interference > 0) {
                    const ripple = Math.sin((dist + nx) * 0.1 - seedShift * 0.02) * 0.5 + 0.5;
                    const ridge = 1.0 - Math.abs(noise(fx * 4, fy * 4) * 2 - 1);
                    detail += ridge * ripple * interference * 1.5;
                }

                val *= (0.4 + 0.6 * detail);

                const edgeNoise = noise(px * 0.045 + seedShift, py * 0.045) * 0.5 + 0.5;
                val *= (1.0 - (dist / (radius * 1.4)) * this.params.edgeAffinity * edgeNoise);

                if (val < threshold) continue;

                // Smoothstep mapping to sharpen midtones
                val = (val - threshold) / (1.0 - threshold);

                // Visibility Gamma (thicker core at high intensity)
                const visibilityGamma = 1.2 - (baseIntensity * 0.95);
                val = Math.pow(Math.max(0, val), Math.max(0.25, visibilityGamma));

                // Hard Boost Control
                const boosted = Math.max(0, Math.min(1.0, val * intensityBoost));
                const baseC = this.samplePalette(palette, boosted);

                let r = baseC.r, g = baseC.g, b = baseC.b;

                // RGB Color Gain & Hot Core Bleach
                const applyGainAndBleach = (channelR, channelG, channelB) => {
                    const rgbGain = 1.0 + Math.pow(baseIntensity, 2.0) * 6.0;
                    let outR = Math.min(255, channelR * rgbGain);
                    let outG = Math.min(255, channelG * rgbGain);
                    let outB = Math.min(255, channelB * rgbGain);

                    if (boosted > 0.7) {
                        const mix = Math.pow((boosted - 0.7) / 0.3, 1.2);
                        const mixVal = mix * 0.6;
                        outR = outR + (255 - outR) * mixVal;
                        outG = outG + (255 - outG) * mixVal;
                        outB = outB + (255 - outB) * mixVal;
                    }
                    return { r: outR, g: outG, b: outB };
                };

                let gained = applyGainAndBleach(r, g, b);
                r = gained.r; g = gained.g; b = gained.b;

                if (aberration > 0.5) {
                    const valR = val * (1 + noise(px * 0.08 + seedShift, py * 0.08) * 0.3);
                    const valB = val * (1 - noise(px * 0.08 + 15, py * 0.08 + 15) * 0.3);

                    const abR = this.samplePalette(palette, Math.min(1.0, Math.pow(Math.max(0, valR), Math.max(0.25, visibilityGamma)) * intensityBoost)).r;
                    const abB = this.samplePalette(palette, Math.min(1.0, Math.pow(Math.max(0, valB), Math.max(0.25, visibilityGamma)) * intensityBoost)).b;

                    const aberratedGained = applyGainAndBleach(abR, g, abB);
                    r = aberratedGained.r;
                    b = aberratedGained.b;
                }

                // Nuclear Alpha: Uncapped aggressive gain + Core Burn term
                let finalAlpha = Math.max(0, Math.min(1.0, Math.pow(boosted, 0.6) * opacity * 2.0));
                finalAlpha = Math.max(0, Math.min(1.0, finalAlpha + Math.pow(boosted, 3.0) * 0.65));

                const alpha = Math.floor(finalAlpha * 255);
                buf[rowOffset + px] = (alpha << 24) | (Math.floor(b) << 16) | (Math.floor(g) << 8) | Math.floor(r);
            }
        }

        ctx.putImageData(imgData, 0, 0);
        this.dirty = false;
    }

    samplePalette(palette, t) {
        t = Math.max(0, Math.min(1, t));
        if (t === 0) return { r: 0, g: 0, b: 0, a: 0 };

        // Simple linear interpolation between stops
        const stops = palette.stops;
        for (let i = 0; i < stops.length - 1; i++) {
            if (t >= stops[i].pos && t <= stops[i + 1].pos) {
                const range = stops[i + 1].pos - stops[i].pos;
                const weight = (t - stops[i].pos) / range;
                const c1 = this.parseRGBA(stops[i].color);
                const c2 = this.parseRGBA(stops[i + 1].color);
                return {
                    r: c1.r + (c2.r - c1.r) * weight,
                    g: c1.g + (c2.g - c1.g) * weight,
                    b: c1.b + (c2.b - c1.b) * weight,
                    a: c1.a + (c2.a - c1.a) * weight
                };
            }
        }
        return this.parseRGBA(stops[stops.length - 1].color);
    }

    parseRGBA(str) {
        const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return { r: 0, g: 0, b: 0, a: 1 };
        return {
            r: parseInt(match[1]),
            g: parseInt(match[2]),
            b: parseInt(match[3]),
            a: match[4] === undefined ? 1 : parseFloat(match[4])
        };
    }
}

/* ── LAYERS ─────────────────────────────────────────── */

class Layer {
    constructor(name, type) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.name = name;
        this.type = type;
        this.enabled = true;
        this.opacity = 1.0;
        this.dirty = true;
    }
    render(ctx, canvas) { }
}

class SignalLayer extends Layer {
    constructor() {
        super("Signal Layer", "signal");
        this.signals = [];
    }
    render(ctx, canvas) {
        this.signals.forEach(s => {
            s.renderToCache();
            ctx.globalAlpha = 1.0;
            ctx.drawImage(s.offscreen, s.x - s.offscreen.width / 2, s.y - s.offscreen.height / 2);
        });
    }
}

class ScannerLayer extends Layer {
    constructor() {
        super("Scanner Layer", "scanner");
        this.params = {
            orientation: 'horizontal',
            thickness: 40,
            lineCount: 8,
            softness: 0.5,
            intensity: 0.8,
            roughness: 0.3,
            jitter: 0.2,
            warp: 0.4,
            color: '#4a7a9b',
            seed: 1234
        };
    }
    render(ctx, canvas) {
        const { orientation, thickness, lineCount, softness, intensity, roughness, jitter, warp, color, seed } = this.params;

        // Ensure we draw over the image area, fallback to canvas
        const canvasRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
        const rect = (State.image && State.imageRect && State.imageRect.w > 0) ? State.imageRect : canvasRect;

        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        const N = Math.max(1, Math.floor(lineCount || 2));
        const step = (orientation === 'horizontal' ? rect.h : rect.w) / N;

        // Start slightly before and end slightly after to cover edges
        for (let i = -1; i <= N; i++) {
            const pos = (orientation === 'horizontal' ? rect.y : rect.x) + i * step;

            // Hardness curve and aggressive alpha scaling + line-to-line roughness variation
            const alphaWave = fbm(i * 0.1 + seed, seed * 0.13, 2);
            const rVariation = roughness * (noise(i * 0.5, seed) * 0.4);
            const baseAlpha = Math.pow(intensity, 0.4) * (0.6 + alphaWave * (0.4 + rVariation));

            // Draw volumetric gradient band
            const grad = orientation === 'horizontal'
                ? ctx.createLinearGradient(0, pos - thickness / 2, 0, pos + thickness / 2)
                : ctx.createLinearGradient(pos - thickness / 2, 0, pos + thickness / 2, 0);

            // Softness scales the outer edges closer to center
            const innerSpread = Math.max(0.01, 1 - softness);

            const edgeAlpha = baseAlpha * 0.5 * (1 - softness);
            const cTransparent = this.hexToRGBA(color, 0);
            const cEdge = this.hexToRGBA(color, edgeAlpha);
            const cCoreA = this.hexToRGBA(color, baseAlpha);
            const cBrightCenter = this.hexToRGBA('#ffffff', baseAlpha * intensity * 0.8); // High contrast line

            // Build gradient
            grad.addColorStop(0, cTransparent);
            grad.addColorStop(0.5 - innerSpread * 0.5, cEdge);
            grad.addColorStop(0.48, cCoreA);
            grad.addColorStop(0.5, cBrightCenter); // Tight bright core
            grad.addColorStop(0.52, cCoreA);
            grad.addColorStop(0.5 + innerSpread * 0.5, cEdge);
            grad.addColorStop(1, cTransparent);

            ctx.fillStyle = grad;

            // Segment length for drawing (smaller for more roughness points)
            const segStep = Math.max(8, 30 - roughness * 20);

            if (orientation === 'horizontal') {
                ctx.beginPath();
                for (let x = rect.x; x <= rect.x + rect.w + segStep; x += segStep) {
                    const wx = x * 0.0015 + seed;
                    const offset = noise(wx, i * jitter) * warp * 200;
                    const microJitter = (Math.abs(noise(x * 0.1, i * 0.1 + seed)) * 2 - 1) * roughness * thickness * 0.3;
                    if (x === rect.x) ctx.moveTo(x, pos + offset - thickness / 2 + microJitter);
                    else ctx.lineTo(x, pos + offset - thickness / 2 + microJitter);
                }
                for (let x = rect.x + rect.w + segStep; x >= rect.x; x -= segStep) {
                    const wx = x * 0.0015 + seed;
                    const offset = noise(wx, i * jitter) * warp * 200;
                    const microJitter = (Math.abs(noise(x * 0.1, i * 0.1 + seed)) * 2 - 1) * roughness * thickness * 0.3;
                    ctx.lineTo(x, pos + offset + thickness / 2 + microJitter);
                }
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.beginPath();
                for (let y = rect.y; y <= rect.y + rect.h + segStep; y += segStep) {
                    const wy = y * 0.0015 + seed;
                    const offset = noise(wy, i * jitter) * warp * 200;
                    const microJitter = (Math.abs(noise(y * 0.1, i * 0.1 + seed)) * 2 - 1) * roughness * thickness * 0.3;
                    if (y === rect.y) ctx.moveTo(pos + offset - thickness / 2 + microJitter, y);
                    else ctx.lineTo(pos + offset - thickness / 2 + microJitter, y);
                }
                for (let y = rect.y + rect.h + segStep; y >= rect.y; y -= segStep) {
                    const wy = y * 0.0015 + seed;
                    const offset = noise(wy, i * jitter) * warp * 200;
                    const microJitter = (Math.abs(noise(y * 0.1, i * 0.1 + seed)) * 2 - 1) * roughness * thickness * 0.3;
                    ctx.lineTo(pos + offset + thickness / 2 + microJitter, y);
                }
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.restore();
    }

    hexToRGBA(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}

class GrainLayer extends Layer {
    constructor() {
        super("Grain Layer", "grain");
        this.params = {
            grainSize: 1.0,
            amount: 0.15,
            opacity: 0.3,
            character: 0.5, // low = blotchy, high = tight
            tintStrength: 0.5,
            color: '#808080'
        };
        this.grainCanvas = document.createElement('canvas');
    }
    render(ctx, canvas) {
        if (this.grainCanvas.width !== canvas.width || this.grainCanvas.height !== canvas.height) {
            this.grainCanvas.width = canvas.width;
            this.grainCanvas.height = canvas.height;
            this.dirty = true;
        }

        if (this.dirty) {
            const gCtx = this.grainCanvas.getContext('2d');
            const data = gCtx.createImageData(canvas.width, canvas.height);
            const pixels = data.data;
            const size = this.params.grainSize;
            const amount = this.params.amount;
            const character = this.params.character;

            // Parse tint color
            const tintMatch = this.params.color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
            const tintR = tintMatch ? parseInt(tintMatch[1], 16) : 128;
            const tintG = tintMatch ? parseInt(tintMatch[2], 16) : 128;
            const tintB = tintMatch ? parseInt(tintMatch[3], 16) : 128;
            const ts = this.params.tintStrength;

            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const idx = (y * canvas.width + x) * 4;

                    // Classic analog noise: mix of pure random and smoothed noise
                    const rand = Math.random();
                    const n = fbm(x * 0.2 / size, y * 0.2 / size, 2);

                    // character: 0 -> more fbm (blotchy), 1 -> more pure random (tight)
                    const noiseVal = (rand * character + (n * 0.5 + 0.5) * (1 - character));
                    const luma = noiseVal * 255;

                    if (Math.random() < amount * 2.0) {
                        pixels[idx] = luma * (1 - ts) + tintR * ts;
                        pixels[idx + 1] = luma * (1 - ts) + tintG * ts;
                        pixels[idx + 2] = luma * (1 - ts) + tintB * ts;
                        pixels[idx + 3] = 255;
                    } else {
                        pixels[idx + 3] = 0;
                    }
                }
            }
            gCtx.putImageData(data, 0, 0);
            this.dirty = false;
        }

        ctx.save();
        ctx.globalAlpha = this.params.opacity;
        ctx.globalCompositeOperation = (this.params.opacity > 0.6 && this.params.tintStrength > 0.6) ? 'screen' : 'overlay';
        ctx.drawImage(this.grainCanvas, 0, 0);
        ctx.restore();
    }
}

class DataLayer extends Layer {
    constructor() {
        super("Data Layer", "data");
        this.params = {
            fontSize: 10,
            color: '#c8c8d0',
            opacity: 0.6,
            tracking: 1,
            xOffset: 20,
            yOffset: 20
        };
    }
    render(ctx, canvas, signals) {
        if (!signals) return;
        ctx.save();
        ctx.font = `${this.params.fontSize}px 'JetBrains Mono'`;

        signals.forEach(s => {
            if (!s.params.dataVisible) return;
            ctx.globalAlpha = 1.0;
            const opacity = this.params.opacity;

            const x = s.x + this.params.xOffset;
            let y = s.y + this.params.yOffset;

            const lines = [
                `ID: ${s.data.deviceId}`,
                `NET: ${s.data.network}`,
                `PWR: ${s.data.strength}`,
                `0x: ${s.data.hash}`
            ];

            const padding = 4;
            const lineH = this.params.fontSize + 4;


            // 2. Connector Line (Thicker logic)
            ctx.shadowBlur = opacity > 0.8 ? 8 : 4;
            ctx.shadowColor = this.params.color;
            ctx.beginPath();
            ctx.strokeStyle = this.params.color;
            ctx.globalAlpha = opacity;
            ctx.lineWidth = opacity > 0.8 ? 2 : 1;
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(x - padding, y - padding);
            ctx.stroke();

            // 3. Text
            ctx.shadowBlur = 0;
            ctx.globalAlpha = opacity;
            ctx.fillStyle = this.params.color;

            lines.forEach((line, i) => {
                ctx.fillText(line, x, y + (i * lineH));
            });
        });
        ctx.restore();
    }
}

/* ── APP ENGINE ─────────────────────────────────────── */

const State = {
    image: null,
    imageRect: { x: 0, y: 0, w: 0, h: 0 },
    layers: [],
    signals: [],
    selectedSignalId: null,
    selectedLayerId: null,
    isPlacingSignal: false,
    resolution: { w: 0, h: 0 }
};

const UI = {
    canvas: document.getElementById('main-canvas'),
    ctx: document.getElementById('main-canvas').getContext('2d'),
    upload: document.getElementById('image-upload'),
    btnAddSignal: document.getElementById('btn-add-signal'),
    placementIndicator: document.getElementById('placement-indicator'),
    layerList: document.getElementById('layer-list'),
    signalList: document.getElementById('signal-list'),
    paramsBody: document.getElementById('params-body'),
    paramsTitle: document.getElementById('params-title'),
    signalCount: document.getElementById('signal-count'),
    status: {
        res: document.getElementById('status-resolution'),
        layers: document.getElementById('status-layers'),
        signals: document.getElementById('status-signals'),
        fps: document.getElementById('status-fps')
    }
};

const Renderer = {
    dirty: true,
    animationRequested: false,

    init() {
        window.addEventListener('resize', () => this.resize());
        this.resize();
    },

    resize() {
        const container = UI.canvas.parentElement;
        UI.canvas.width = container.clientWidth;
        UI.canvas.height = container.clientHeight;
        State.resolution = { w: UI.canvas.width, h: UI.canvas.height };
        UI.status.res.textContent = `${UI.canvas.width}×${UI.canvas.height}`;
        this.requestRender();
    },

    requestRender() {
        if (this.animationRequested) return;
        this.animationRequested = true;
        requestAnimationFrame(() => this.render());
    },

    render() {
        this.animationRequested = false;
        const canvas = UI.canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Compute and Draw Background Image
        if (State.image) {
            const aspect = State.image.width / State.image.height;
            let dw = canvas.width, dh = dw / aspect;
            if (dh > canvas.height) { dh = canvas.height; dw = dh * aspect; }

            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;

            State.imageRect = { x: dx, y: dy, w: dw, h: dh };
            ctx.drawImage(State.image, dx, dy, dw, dh);
        } else {
            State.imageRect = { x: 0, y: 0, w: 0, h: 0 };
        }

        // Draw Layers
        State.layers.forEach(layer => {
            if (!layer.enabled) return;
            ctx.save();

            // CLIP to imageRect for specific layers
            // REQUIRE State.image for scanner/grain/signal to render at all
            if (layer.type === 'signal' || layer.type === 'scanner' || layer.type === 'grain') {
                if (!State.image || State.image.width === 0) {
                    ctx.restore();
                    return;
                }
                ctx.beginPath();
                ctx.rect(State.imageRect.x, State.imageRect.y, State.imageRect.w, State.imageRect.h);
                ctx.clip();
            }

            ctx.globalAlpha = layer.opacity || 1.0;
            if (layer.type === 'signal') {
                // Signals apply their own blendMode
                layer.signals.forEach(s => {
                    s.renderToCache();
                    const bMode = s.params.blendMode || 'screen'; // default to screen for strong read

                    if (bMode === 'add') {
                        ctx.globalCompositeOperation = 'lighter';
                    } else {
                        ctx.globalCompositeOperation = bMode;
                    }

                    // Nuclear Mode Multi-pass rendering
                    let passes = 1;
                    let passAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
                    const sigOpacity = s.params.opacity !== undefined ? s.params.opacity : 1.0;
                    const sigIntensity = s.params.intensity !== undefined ? s.params.intensity : 0.8;

                    if (sigOpacity > 1.0 || sigIntensity > 1.5) {
                        passes = (sigOpacity > 1.5 || sigIntensity > 2.0) ? 3 : 2;

                        // Calculate distributed alpha, clamped to canvas max of 1.0
                        passAlpha = (passAlpha * sigOpacity) / passes;
                        passAlpha = Math.max(0, Math.min(1.0, passAlpha));
                    }

                    ctx.globalAlpha = passAlpha;

                    for (let p = 0; p < passes; p++) {
                        ctx.drawImage(s.offscreen, s.x - s.offscreen.width / 2, s.y - s.offscreen.height / 2);
                    }
                });
            } else if (layer.type === 'data') {
                layer.render(ctx, canvas, State.signals);
            } else {
                layer.render(ctx, canvas);
            }
            ctx.restore();
        });

        UI.status.layers.textContent = `${State.layers.length} layers`;
        UI.status.signals.textContent = `${State.signals.length} signals`;
        UI.signalCount.textContent = State.signals.length;

        const hasAnimated = State.layers.some(l => l.enabled && l.type === 'scanner');
        if (hasAnimated) this.requestRender();
    }
};

/* ── UI BINDINGS ────────────────────────────────────── */

function initBindings() {
    UI.upload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                if (img.width > 0 && img.height > 0) {
                    State.image = img;
                    UI.btnAddSignal.disabled = false;
                    Renderer.requestRender();
                } else {
                    console.error("Image loaded with zero dimensions.");
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    UI.btnAddSignal.addEventListener('click', () => {
        State.isPlacingSignal = !State.isPlacingSignal;
        UI.btnAddSignal.classList.toggle('active', State.isPlacingSignal);
        UI.placementIndicator.classList.toggle('hidden', !State.isPlacingSignal);
        UI.canvas.parentElement.classList.toggle('placing', State.isPlacingSignal);
    });

    UI.canvas.addEventListener('click', (e) => {
        if (!State.isPlacingSignal) return;

        const rect = UI.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        addSignal(x, y);

        State.isPlacingSignal = false;
        UI.btnAddSignal.classList.remove('active');
        UI.placementIndicator.classList.add('hidden');
        UI.canvas.parentElement.classList.remove('placing');
    });

    document.getElementById('btn-add-layer').addEventListener('click', () => {
        document.getElementById('layer-menu').classList.toggle('hidden');
    });

    document.querySelectorAll('.layer-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.layer;
            addLayer(type);
            document.getElementById('layer-menu').classList.add('hidden');
        });
    });
}

function addLayer(type) {
    let layer;
    switch (type) {
        case 'signal': layer = new SignalLayer(); break;
        case 'scanner': layer = new ScannerLayer(); break;
        case 'grain': layer = new GrainLayer(); break;
        case 'data': layer = new DataLayer(); break;
    }
    if (layer) {
        State.layers.push(layer);
        updateLayerList();
        Renderer.requestRender();
    }
}

function addSignal(x, y) {
    const signal = new SignalCloud(x, y, Date.now());
    State.signals.push(signal);

    // Ensure we have a signal layer if not present
    if (!State.layers.find(l => l.type === 'signal')) {
        addLayer('signal');
    }

    // Add to first signal layer's signals array
    const signalLayer = State.layers.find(l => l.type === 'signal');
    signalLayer.signals.push(signal);

    updateSignalList();
    selectSignal(signal.id);
    Renderer.requestRender();
}

function updateLayerList() {
    UI.layerList.innerHTML = '';
    State.layers.forEach(layer => {
        const li = document.createElement('li');
        li.className = `layer-item ${State.selectedLayerId === layer.id ? 'selected' : ''}`;
        li.innerHTML = `
            <button class="layer-toggle ${layer.enabled ? 'active' : ''}">👁</button>
            <span class="layer-name">${layer.name}</span>
            <div class="layer-order-btns">
                <button class="layer-order-btn top-btn">↑</button>
                <button class="layer-order-btn bot-btn">↓</button>
            </div>
        `;

        li.querySelector('.layer-toggle').onclick = (e) => {
            e.stopPropagation();
            layer.enabled = !layer.enabled;
            updateLayerList();
            Renderer.requestRender();
        };

        li.onclick = () => selectLayer(layer.id);

        UI.layerList.appendChild(li);
    });
}

function updateSignalList() {
    UI.signalList.innerHTML = '';
    State.signals.forEach(s => {
        const li = document.createElement('li');
        li.className = `signal-item ${State.selectedSignalId === s.id ? 'selected' : ''}`;
        li.innerHTML = `
            <span class="layer-name">CLOUD_${s.data.hash}</span>
            <button class="signal-delete">×</button>
        `;
        li.onclick = () => selectSignal(s.id);
        li.querySelector('.signal-delete').onclick = (e) => {
            e.stopPropagation();
            removeSignal(s.id);
        };
        UI.signalList.appendChild(li);
    });
}

function selectLayer(id) {
    State.selectedLayerId = id;
    State.selectedSignalId = null;
    updateLayerList();
    updateSignalList();

    const layer = State.layers.find(l => l.id === id);
    if (layer) renderParamsPanel(layer);
}

function selectSignal(id) {
    State.selectedSignalId = id;
    State.selectedLayerId = null;
    updateSignalList();
    updateLayerList();

    const signal = State.signals.find(s => s.id === id);
    if (signal) renderParamsPanel(signal);
}

function removeSignal(id) {
    State.signals = State.signals.filter(s => s.id !== id);
    State.layers.forEach(l => {
        if (l.type === 'signal') l.signals = l.signals.filter(s => s.id !== id);
    });
    if (State.selectedSignalId === id) {
        State.selectedSignalId = null;
        UI.paramsBody.innerHTML = '<p class="placeholder-text">Select a signal cloud or layer to edit parameters.</p>';
    }
    updateSignalList();
    Renderer.requestRender();
}

/* ── PARAMETER RENDERING ────────────────────────────── */

function renderParamsPanel(target) {
    UI.paramsTitle.textContent = target.name || `CLOUD_${target.data.hash}`;
    UI.paramsBody.innerHTML = '';

    const params = target.params;
    if (!params) return;

    Object.keys(params).forEach(key => {
        const val = params[key];
        const row = document.createElement('div');
        row.className = 'param-row';

        const label = document.createElement('span');
        label.className = 'param-label';
        label.textContent = key.replace(/([A-Z])/g, ' $1').toLowerCase();

        if (typeof val === 'number') {
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'param-slider';

            // Heuristics for slider ranges
            let min = 0, max = 1, step = 0.01;
            if (key === 'size') { min = 10; max = 800; step = 1; }
            if (key === 'seed') { min = 0; max = 10000; step = 1; }
            if (key === 'thickness') { min = 1; max = 300; step = 1; }
            if (key === 'lineCount') { min = 2; max = 250; step = 1; }
            if (key === 'softness') { min = 0; max = 1; step = 0.01; }
            if (key === 'roughness') { min = 0; max = 1; step = 0.01; }
            if (key === 'warp') { min = 0; max = 4; step = 0.01; }
            if (key === 'fontSize') { min = 6; max = 24; step = 1; }
            if (key === 'distortion') { min = 0; max = 4; step = 0.01; }
            if (key === 'anisotropy') { min = 0.5; max = 10; step = 0.1; }
            if (key === 'elongation') { min = 0; max = 2; step = 0.01; }
            if (key === 'grainSize') { min = 0.5; max = 10; step = 0.1; }
            if (key === 'irregularity') { min = 0; max = 2; step = 0.01; }
            if (key === 'chromaticAberration') { min = 0; max = 3; step = 0.01; }
            if (key === 'interference') { min = 0; max = 3; step = 0.01; }
            if (key === 'character') { min = 0; max = 1; step = 0.01; }
            if (key === 'tintStrength') { min = 0; max = 1; step = 0.01; }

            // Nuclear Mode Overrides
            if (key === 'intensity' && target instanceof SignalCloud) { max = 3; }
            if (key === 'opacity' && target instanceof SignalCloud) { max = 2; }

            slider.min = min;
            slider.max = max;
            slider.step = step;
            slider.value = val;

            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'param-value';
            valueDisplay.textContent = val;

            slider.oninput = (e) => {
                target.params[key] = parseFloat(e.target.value);
                valueDisplay.textContent = e.target.value;
                if (target instanceof SignalCloud) target.dirty = true;
                if (target instanceof GrainLayer) target.dirty = true;
                Renderer.requestRender();
            };

            row.appendChild(label);
            row.appendChild(slider);
            row.appendChild(valueDisplay);
        } else if (typeof val === 'boolean') {
            row.className = 'param-toggle-row';
            const toggle = document.createElement('div');
            toggle.className = `param-toggle ${val ? 'active' : ''}`;
            toggle.onclick = () => {
                target.params[key] = !target.params[key];
                toggle.classList.toggle('active');
                if (target instanceof SignalCloud) target.dirty = true;
                Renderer.requestRender();
            };
            row.appendChild(label);
            row.appendChild(toggle);
        } else if (key === 'palette') {
            const select = document.createElement('select');
            select.className = 'param-select';
            Object.keys(PALETTES).forEach(pk => {
                const opt = document.createElement('option');
                opt.value = pk;
                opt.textContent = PALETTES[pk].name;
                if (pk === val) opt.selected = true;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                target.params[key] = e.target.value;
                if (target instanceof SignalCloud) target.dirty = true;
                Renderer.requestRender();
            };
            row.appendChild(label);
            row.appendChild(select);
        } else if (key === 'blendMode') {
            const select = document.createElement('select');
            select.className = 'param-select';
            ['screen', 'add', 'multiply', 'color-dodge', 'overlay'].forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m.toUpperCase();
                if (m === val) opt.selected = true;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                target.params[key] = e.target.value;
                Renderer.requestRender();
            };
            row.appendChild(label);
            row.appendChild(select);
        } else if (key === 'orientation') {
            const select = document.createElement('select');
            select.className = 'param-select';
            ['horizontal', 'vertical'].forEach(o => {
                const opt = document.createElement('option');
                opt.value = o;
                opt.textContent = o;
                if (o === val) opt.selected = true;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                target.params[key] = e.target.value;
                Renderer.requestRender();
            };
            row.appendChild(label);
            row.appendChild(select);
        } else if (key === 'color') {
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.className = 'param-color-input';
            colorInput.value = val;
            colorInput.oninput = (e) => {
                target.params[key] = e.target.value;
                if (target instanceof GrainLayer) target.dirty = true;
                Renderer.requestRender();
            };
            row.appendChild(label);
            row.appendChild(colorInput);
        }

        UI.paramsBody.appendChild(row);
    });
}

/* ── BOOTSTRAP ──────────────────────────────────────── */

window.addEventListener('load', () => {
    Renderer.init();
    initBindings();

    // Add default layers for a quick start
    addLayer('signal');
    addLayer('scanner');
    addLayer('grain');
    addLayer('data');

    // Select the first layer
    if (State.layers.length > 0) selectLayer(State.layers[0].id);

    console.log("GHOST SIGNAL INSTRUMENT: READY");
});

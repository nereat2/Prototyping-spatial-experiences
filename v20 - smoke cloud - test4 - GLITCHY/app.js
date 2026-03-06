/**
 * GHOST SIGNAL INSTRUMENT — vAtom Fluid
 * 
 * CORE ARCHITECTURE (preserved):
 * - State: Single source of truth.
 * - Layer classes: Decoupled rendering logic.
 * - AtomFluidEngine: Global WebGL N-S fluid sim (atomFluid.js).
 * - SignalAnchor: Lightweight per-signal emitter with micro-emitters.
 * - Renderer: Offscreen canvas pipeline with compositing.
 * - Telemetry: Data integration module (telemetry.js).
 * - DebugMode: On-screen HUD (debug.js).
 * - DeformEngine: Non-destructive image warping.
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

// 2D Perlin Noise
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
    let total = 0, frequency = 1, amplitude = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
        total += noise(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= 2;
    }
    return total / maxValue;
};

// Depth-Shaded Palettes — shadow/mid/highlight/accent for volumetric colorization
const PALETTES = {
    cold: {
        name: "Cold Infrastructure",
        shadow: { r: 10, g: 15, b: 40 },
        mid: { r: 40, g: 80, b: 150 },
        highlight: { r: 140, g: 170, b: 220 },
        accent: { r: 90, g: 50, b: 180 }
    },
    dense: {
        name: "Dense Network",
        shadow: { r: 25, g: 10, b: 5 },
        mid: { r: 160, g: 100, b: 30 },
        highlight: { r: 230, g: 190, b: 80 },
        accent: { r: 180, g: 60, b: 25 }
    },
    residual: {
        name: "Residual Trace",
        shadow: { r: 8, g: 20, b: 15 },
        mid: { r: 40, g: 130, b: 80 },
        highlight: { r: 160, g: 210, b: 180 },
        accent: { r: 80, g: 180, b: 120 }
    },
    neutral: {
        name: "Neutral Field",
        shadow: { r: 15, g: 18, b: 25 },
        mid: { r: 80, g: 90, b: 120 },
        highlight: { r: 180, g: 185, b: 200 },
        accent: { r: 120, g: 90, b: 160 }
    }
};

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

class DataLayer extends Layer {
    constructor() {
        super("Data Layer", "data");
        this.params = {
            fontSize: 10,
            color: '#c8c8d0',
            opacity: 0.6
        };
    }
    render(ctx, canvas, signals) {
        if (!signals) return;
        ctx.save();
        ctx.font = `${this.params.fontSize}px 'JetBrains Mono'`;
        const cW = canvas.width, cH = canvas.height;
        signals.forEach(s => {
            if (!s.params.dataVisible) return;
            const opacity = this.params.opacity;
            const line = `ID: ${s.getDisplayId()}`;

            // Measure text for box clamping
            const metrics = ctx.measureText(line);
            const boxW = metrics.width + 8;
            const boxH = this.params.fontSize + 6;

            // Fix 1: tracking toggle
            let lx, ly;
            if (s.params.tracking === 1) {
                // Relative to blob
                lx = s.x + (s.params.dataOffsetX || 20);
                ly = s.y + (s.params.dataOffsetY || 20);
            } else {
                // Absolute position
                lx = s.params.dataAbsX || 100;
                ly = s.params.dataAbsY || 100;
            }

            // Fix 5: clamp to canvas bounds
            lx = Math.max(6, Math.min(cW - boxW - 6, lx));
            ly = Math.max(boxH + 2, Math.min(cH - 6, ly));

            ctx.shadowBlur = 4;
            ctx.shadowColor = this.params.color;
            ctx.globalAlpha = opacity;
            ctx.fillStyle = this.params.color;
            ctx.fillText(line, lx, ly);
            ctx.shadowBlur = 0;
        });
        ctx.restore();
    }
}

/* ── TELEMETRY → ATOM FLUID MAPPING ───────────────── */

const TelemetryMapper = {
    /** Apply telemetry to atom fluid anchor params */
    apply(signal, ts) {
        if (!ts || !ts.norm) return;
        const n = ts.norm;

        signal.params.density = 0.5 + n.wifiMeanRssi * 2.0;
        signal.params.emissionRate = 2 + Math.floor(n.wifiBurstRate * 12);
        const baseCurl = 14 + n.wifiRssiVariance * 78;
        const glitchSpike = Telemetry.jitter ? (n.wifiBurstRate * 20 + n.wifiChannelSpread * 10) : 0;
        signal.params.curlRadius = Math.min(140, baseCurl + glitchSpike);
        signal.params.speed = 0.5 + n.wifiBurstRate * 2.0;
        signal.params.opacity = 0.5 + n.wifiMeanRssi * 0.5;
        signal.params.anchorJitter = 3 + n.wifiDeviceCount * 15;
        signal.params.hue = 180 + n.wifiChannelSpread * 160;
    }
};

/* ── APP ENGINE ─────────────────────────────────────── */

const State = {
    image: null,
    imageRect: { x: 0, y: 0, w: 0, h: 0 },
    layers: [],
    signals: [],
    selectedSignalId: null,
    selectedLayerId: null,
    isPlacingSignal: false,
    isDeforming: false,
    resolution: { w: 0, h: 0 },
    cameraActive: false,
    videoElement: null,
    useManualParams: false,  // When true, telemetry mapping is skipped
    lastSignalPlacement: null
};

const DeformEngine = {
    name: 'DEFORM SETTINGS',
    params: {
        brushSize: 120,
        strength: 1.2,
        softness: 0.5,
        stabilize: 0.15
    },
    // Camera deformation: snapshot buffer for live camera warp
    cameraSnapshot: null,
    cameraSnapshotCtx: null,
    buffer: null,
    ctx: null,
    hasEdits: false,
    isDragging: false,
    lastPt: null,

    initBuffer(w, h) {
        if (!this.buffer || this.buffer.width !== w || this.buffer.height !== h) {
            this.buffer = document.createElement('canvas');
            this.buffer.width = w;
            this.buffer.height = h;
            this.ctx = this.buffer.getContext('2d', { willReadFrequently: true });
        }
        this.reset();
    },

    reset() {
        if (!this.ctx) return;
        if (Camera.active && Camera.video) {
            // For camera mode, snapshot current frame
            this.ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
            this.ctx.drawImage(Camera.video, 0, 0, this.buffer.width, this.buffer.height);
        } else if (State.image) {
            this.ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
            this.ctx.drawImage(State.image, 0, 0, this.buffer.width, this.buffer.height);
        }
        this.hasEdits = false;
        Renderer.requestRender();
    },

    /** Snapshot current camera frame for deformation */
    snapshotCamera() {
        if (!Camera.active || !Camera.video) return;
        const vw = Camera.getWidth();
        const vh = Camera.getHeight();
        if (vw <= 0 || vh <= 0) return;
        if (!this.buffer || this.buffer.width !== vw || this.buffer.height !== vh) {
            this.initBuffer(vw, vh);
        }
        this.ctx.clearRect(0, 0, vw, vh);
        this.ctx.drawImage(Camera.video, 0, 0, vw, vh);
    },

    applyDeform(x, y, dx, dy) {
        if (!this.ctx || !this.buffer) return;
        const ir = State.imageRect;
        if (!ir || ir.w === 0) return;

        const bx = ((x - ir.x) / ir.w) * this.buffer.width;
        const by = ((y - ir.y) / ir.h) * this.buffer.height;
        const bdx = (dx / ir.w) * this.buffer.width;
        const bdy = (dy / ir.h) * this.buffer.height;
        const r = this.params.brushSize * (this.buffer.width / UI.canvas.width);
        const str = this.params.strength * 2.0;

        const sx = Math.max(0, Math.floor(bx - r));
        const sy = Math.max(0, Math.floor(by - r));
        const ew = Math.min(this.buffer.width - sx, Math.ceil(r * 2));
        const eh = Math.min(this.buffer.height - sy, Math.ceil(r * 2));
        if (ew <= 0 || eh <= 0) return;

        const imgData = this.ctx.getImageData(sx, sy, ew, eh);
        const data = imgData.data;
        const srcData = new Uint8ClampedArray(data);
        let edited = false;

        for (let py = 0; py < eh; py++) {
            for (let px = 0; px < ew; px++) {
                const cx = px + sx, cy = py + sy;
                const distX = cx - bx, distY = cy - by;
                const distSq = distX * distX + distY * distY;
                const rSq = r * r;

                if (distSq < rSq) {
                    const dist = Math.sqrt(distSq);
                    const falloff = Math.pow(1 - (dist / r), 1.0 + (1.0 - this.params.softness));
                    const pullX = cx - bdx * str * falloff;
                    const pullY = cy - bdy * str * falloff;
                    const lx = pullX - sx, ly = pullY - sy;

                    if (lx >= 0 && lx < ew - 1 && ly >= 0 && ly < eh - 1) {
                        const x0 = Math.floor(lx), y0 = Math.floor(ly);
                        const x1 = x0 + 1, y1 = y0 + 1;
                        const fx = lx - x0, fy = ly - y0;
                        const i00 = (y0 * ew + x0) * 4;
                        const i10 = (y0 * ew + x1) * 4;
                        const i01 = (y1 * ew + x0) * 4;
                        const i11 = (y1 * ew + x1) * 4;

                        for (let c = 0; c < 4; c++) {
                            const val = srcData[i00 + c] * (1 - fx) * (1 - fy)
                                + srcData[i10 + c] * fx * (1 - fy)
                                + srcData[i01 + c] * (1 - fx) * fy
                                + srcData[i11 + c] * fx * fy;
                            data[(py * ew + px) * 4 + c] = val;
                        }
                        edited = true;
                    }
                }
            }
        }

        if (edited) {
            this.ctx.putImageData(imgData, sx, sy);
            this.hasEdits = true;
            Renderer.requestRender();
        }
    }
};

/* ══════════════════════════════════════════════════════════
   ImageDeformPass — standalone WebGL deformation + color sampling
   Separate GL context; does NOT touch AtomFluidEngine state.
   ══════════════════════════════════════════════════════════ */

const ImageDeformPass = {
    canvas: null,
    gl: null,
    _ready: false,
    _program: null,
    _imageTex: null,
    _imageW: 0,
    _imageH: 0,
    _vbo: null,
    _ibo: null,
    // 1×1 FBO for color sampling
    _sampleFBO: null,
    _sampleTex: null,

    init() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'deform-pass-canvas';
        this.canvas.style.display = 'none';
        document.body.appendChild(this.canvas);

        const params = {
            alpha: true, depth: false, stencil: false,
            antialias: false, premultipliedAlpha: false,
            preserveDrawingBuffer: true
        };
        const gl = this.canvas.getContext('webgl', params) ||
            this.canvas.getContext('experimental-webgl', params);
        if (!gl) { console.warn('ImageDeformPass: no WebGL'); return; }
        this.gl = gl;

        // Compile shaders
        const vs = this._compile(gl.VERTEX_SHADER, `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0);
            }
        `);
        const fs = this._compile(gl.FRAGMENT_SHADER, `
            precision highp float;
            uniform sampler2D uImage;
            uniform int uAnchorCount;
            uniform vec3 uAnchors[16];
            uniform float uStrength;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                for (int i = 0; i < 16; i++) {
                    if (i >= uAnchorCount) break;
                    vec2 anchor = uAnchors[i].xy;
                    float radius = uAnchors[i].z;
                    vec2 diff = uv - anchor;
                    float dist = length(diff);
                    float falloff = exp(-dist * dist / (radius * radius * 0.5));
                    uv -= diff * falloff * uStrength;
                }
                gl_FragColor = texture2D(uImage, uv);
            }
        `);
        if (!vs || !fs) return;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('ImageDeformPass link:', gl.getProgramInfoLog(prog)); return;
        }
        this._program = {
            program: prog,
            aPosition: gl.getAttribLocation(prog, 'aPosition'),
            uImage: gl.getUniformLocation(prog, 'uImage'),
            uAnchorCount: gl.getUniformLocation(prog, 'uAnchorCount'),
            uAnchors: [],
            uStrength: gl.getUniformLocation(prog, 'uStrength')
        };
        for (let i = 0; i < 16; i++) {
            this._program.uAnchors[i] = gl.getUniformLocation(prog, `uAnchors[${i}]`);
        }

        // Fullscreen quad
        this._vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        this._ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

        // 1×1 FBO for sampleColor
        this._sampleTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._sampleTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this._sampleFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sampleFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._sampleTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this._ready = true;
    },

    _compile(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('ImageDeformPass shader:', gl.getShaderInfoLog(s)); return null;
        }
        return s;
    },

    /** Upload source image as texture (call once on image load, not per frame) */
    uploadImage(img) {
        if (!this._ready || !img) return;
        const gl = this.gl;
        if (!this._imageTex) this._imageTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        this._imageW = img.width || img.videoWidth || 0;
        this._imageH = img.height || img.videoHeight || 0;
    },

    /** Render deformed image. anchors = SignalAnchor[], imageRect = {x,y,w,h}, cW/cH = canvas size */
    render(anchors, imageRect, cW, cH) {
        if (!this._ready || !this._imageTex || !anchors || anchors.length === 0) return null;
        const gl = this.gl;

        // Size output canvas to match display rect
        const dw = Math.round(imageRect.w) || cW;
        const dh = Math.round(imageRect.h) || cH;
        if (this.canvas.width !== dw || this.canvas.height !== dh) {
            this.canvas.width = dw;
            this.canvas.height = dh;
        }

        gl.viewport(0, 0, dw, dh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this._program.program);

        // Bind image texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
        gl.uniform1i(this._program.uImage, 0);

        // Anchor data: convert canvas px to normalized UV within the image rect
        const count = Math.min(anchors.length, 16);
        gl.uniform1i(this._program.uAnchorCount, count);
        for (let i = 0; i < 16; i++) {
            if (i < count) {
                const a = anchors[i];
                const nx = (a.x - imageRect.x) / imageRect.w;
                const ny = (a.y - imageRect.y) / imageRect.h;
                const nr = (a.params.radiusLimit / imageRect.w) * 1.5; // radius in UV space
                gl.uniform3f(this._program.uAnchors[i], nx, ny, Math.max(0.01, nr));
            } else {
                gl.uniform3f(this._program.uAnchors[i], 0, 0, 0);
            }
        }

        // Subtle strength — gravitational indentation feel
        gl.uniform1f(this._program.uStrength, 0.012);

        // Draw quad
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
        gl.enableVertexAttribArray(this._program.aPosition);
        gl.vertexAttribPointer(this._program.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        return this.canvas;
    },

    /** Sample image color at canvas position. Returns {r,g,b} 0-255, clamped to avoid pure B/W */
    sampleColor(canvasX, canvasY, imageRect) {
        if (!this._ready || !this._imageTex) return null;
        const gl = this.gl;

        const u = (canvasX - imageRect.x) / imageRect.w;
        const v = (canvasY - imageRect.y) / imageRect.h;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;

        // Render 1×1 pixel of the image at (u,v) into the sample FBO
        // Use a simple pass-through with viewport trick
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sampleFBO);
        gl.viewport(0, 0, 1, 1);

        gl.useProgram(this._program.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
        gl.uniform1i(this._program.uImage, 0);
        gl.uniform1i(this._program.uAnchorCount, 0); // no deformation for sampling
        gl.uniform1f(this._program.uStrength, 0.0);

        // We need to sample at a specific UV. Override the quad to emit a single point at (u,v).
        // Simplest: draw the full image and use gl.readPixels. But that's wasteful for 1px.
        // Instead, use a viewport/scissor trick won't work with fullscreen quad.
        // Practical approach: render full image to FBO, read 1px. Use a small temp texture.
        // Actually — use a dedicated 1-pixel precision approach:
        // Create a 1×1 canvas render, shifting UVs so the target pixel lands at center.

        // Most practical and fast: render the full image at small res, read the pixel.
        // For a one-time sample, just use a temporary small canvas read.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Fallback: use a 2D canvas to sample the pixel from the original image
        return this._sampleViaCanvas(canvasX, canvasY, imageRect);
    },

    /** Internal: sample pixel via a tiny offscreen 2D canvas (called once per anchor, not per frame) */
    _sampleViaCanvas(canvasX, canvasY, imageRect) {
        const img = State.image;
        if (!img) return null;

        const u = (canvasX - imageRect.x) / imageRect.w;
        const v = (canvasY - imageRect.y) / imageRect.h;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;

        const sw = img.width || img.videoWidth || 0;
        const sh = img.height || img.videoHeight || 0;
        if (sw === 0 || sh === 0) return null;

        const px = Math.floor(u * sw);
        const py = Math.floor(v * sh);

        // Tiny offscreen canvas — draw 1 pixel region
        if (!this._sampleCanvas) {
            this._sampleCanvas = document.createElement('canvas');
            this._sampleCanvas.width = 1;
            this._sampleCanvas.height = 1;
            this._sampleCtx = this._sampleCanvas.getContext('2d', { willReadFrequently: true });
        }
        this._sampleCtx.clearRect(0, 0, 1, 1);
        this._sampleCtx.drawImage(img, px, py, 1, 1, 0, 0, 1, 1);
        const data = this._sampleCtx.getImageData(0, 0, 1, 1).data;

        // Clamp to avoid pure white/black
        const r = Math.max(30, Math.min(225, data[0]));
        const g = Math.max(30, Math.min(225, data[1]));
        const b = Math.max(30, Math.min(225, data[2]));

        return { r, g, b };
    }
};

const UI = {
    canvas: document.getElementById('main-canvas'),
    ctx: document.getElementById('main-canvas').getContext('2d'),
    upload: document.getElementById('image-upload'),
    btnAddSignal: document.getElementById('btn-add-signal'),
    btnDeformMode: document.getElementById('btn-deform-mode'),
    btnCamera: document.getElementById('btn-camera'),
    btnCapture: document.getElementById('btn-capture'),
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

/* ── CAMERA ──────────────────────────────────────────── */

const Camera = {
    video: null,
    stream: null,
    active: false,

    async start() {
        try {
            this.video = document.getElementById('camera-video');
            if (!this.video) {
                this.video = document.createElement('video');
                this.video.id = 'camera-video';
                this.video.setAttribute('playsinline', '');
                this.video.setAttribute('autoplay', '');
                this.video.style.display = 'none';
                document.body.appendChild(this.video);
            }

            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            this.active = true;
            State.cameraActive = true;

            // Create image-like interface for the renderer
            State.image = this.video;
            UI.btnAddSignal.disabled = false;
            UI.btnDeformMode.disabled = false;
            if (UI.btnCamera) UI.btnCamera.textContent = 'STOP CAMERA';

            Renderer.requestRender();
        } catch (err) {
            console.error('Camera access failed:', err);
            alert('Camera access denied or unavailable.');
        }
    },

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.video) {
            this.video.srcObject = null;
        }
        this.active = false;
        State.cameraActive = false;
        if (UI.btnCamera) UI.btnCamera.textContent = 'START CAMERA';
    },

    toggle() {
        if (this.active) this.stop();
        else this.start();
    },

    /** Get current video dimensions (for aspect ratio) */
    getWidth() {
        return this.video ? this.video.videoWidth || 640 : 640;
    },
    getHeight() {
        return this.video ? this.video.videoHeight || 480 : 480;
    }
};

/* ── RENDERER ──────────────────────────────────────── */

const Renderer = {
    dirty: true,
    _lastTime: 0,

    init() {
        // Init global fluid engine FIRST (resize() needs it)
        try {
            const container = UI.canvas.parentElement;
            AtomFluidEngine.init(container.clientWidth, container.clientHeight);
        } catch (e) {
            console.error('AtomFluidEngine init failed:', e);
        }
        window.addEventListener('resize', () => this.resize());
        this.resize();
    },

    resize() {
        const container = UI.canvas.parentElement;
        UI.canvas.width = container.clientWidth;
        UI.canvas.height = container.clientHeight;
        State.resolution = { w: UI.canvas.width, h: UI.canvas.height };
        UI.status.res.textContent = `${UI.canvas.width}×${UI.canvas.height}`;
        // Resize global fluid engine
        AtomFluidEngine.resize(UI.canvas.width, UI.canvas.height);
    },

    requestRender() {
        // Always running now (continuous loop)
    },

    _renderScannerGlitch(ctx, timestamp, layerOpacity) {
        if (!AtomFluidEngine.canvas) return;
        const t = timestamp * 0.001;
        if (!this._glitchCanvas) {
            this._glitchCanvas = document.createElement('canvas');
            this._glitchCtx = this._glitchCanvas.getContext('2d');
        }
        const gc = this._glitchCanvas;
        const gctx = this._glitchCtx;
        if (!gctx) return;
        if (gc.width !== ctx.canvas.width || gc.height !== ctx.canvas.height) {
            gc.width = ctx.canvas.width;
            gc.height = ctx.canvas.height;
        }

        State.signals.forEach((s, idx) => {
            const glitch = Math.max(0, Math.min(1, s.params.scannerGlitch || 0));
            if (glitch < 0.01) return;
            const sigOp = Math.min(2.0, s.params.opacity || 0.85);

            const shapeRadius = Math.max(
                24,
                (s.params.radiusLimit || 60) * 2.4 + (s.params.anchorJitter || 0) * 1.2
            );
            const minX = Math.max(0, Math.floor(s.x - shapeRadius));
            const minY = Math.max(0, Math.floor(s.y - shapeRadius));
            const maxX = Math.min(gc.width, Math.ceil(s.x + shapeRadius));
            const maxY = Math.min(gc.height, Math.ceil(s.y + shapeRadius));
            const bw = maxX - minX;
            const bh = maxY - minY;
            if (bw <= 2 || bh <= 2) return;

            gctx.clearRect(minX, minY, bw, bh);
            gctx.globalCompositeOperation = 'source-over';

            const step = Math.max(2, 8 - glitch * 5);
            const scanDrift = (Math.sin(t * (10 + glitch * 22) + idx * 0.9) * 0.5 + 0.5) * step;
            const tone = s.color
                ? `rgba(${Math.round(s.color.r * 255)}, ${Math.round(s.color.g * 255)}, ${Math.round(s.color.b * 255)}, `
                : 'rgba(140, 195, 235, ';

            for (let yPos = minY + scanDrift; yPos <= maxY; yPos += step) {
                const wave = Math.sin(yPos * 0.24 + t * (16 + glitch * 28) + idx * 3.1);
                const xJitter = wave * (2 + glitch * 18);
                const yJitter = Math.sin(yPos * 0.12 + t * 9.0 + idx * 2.0) * glitch * 1.8;
                const alpha = (0.05 + glitch * 0.3) * (0.55 + 0.45 * (wave * 0.5 + 0.5));

                gctx.globalAlpha = Math.min(1, alpha);
                gctx.strokeStyle = `${tone}1)`;
                gctx.lineWidth = 0.9 + glitch * 2.4;
                gctx.beginPath();
                gctx.moveTo(minX + xJitter, yPos + yJitter);
                gctx.lineTo(maxX + xJitter, yPos + yJitter);
                gctx.stroke();
            }

            // Mask scanlines with the actual fluid silhouette so glitch adapts to blob shape/size.
            gctx.globalCompositeOperation = 'destination-in';
            gctx.globalAlpha = 1.0;
            gctx.drawImage(AtomFluidEngine.canvas, minX, minY, bw, bh, minX, minY, bw, bh);
            gctx.globalCompositeOperation = 'source-over';

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = Math.min(1, layerOpacity * sigOp);
            ctx.drawImage(gc, minX, minY, bw, bh, minX, minY, bw, bh);
            ctx.restore();

            gctx.clearRect(minX, minY, bw, bh);
        });
    },

    /** Main continuous render loop */
    loop(timestamp) {
        requestAnimationFrame((t) => this.loop(t));

        const dt = this._lastTime > 0 ? timestamp - this._lastTime : 16;
        this._lastTime = timestamp;

        // Track FPS for debug
        DebugMode.trackFrame(timestamp);

        // Update telemetry
        Telemetry.update();

        // Map telemetry to atom fluid anchor params
        if (!State.useManualParams) {
            State.signals.forEach(s => {
                TelemetryMapper.apply(s, Telemetry.telemetryState);
            });
        }

        // Update global fluid engine with all anchors
        if (State.signals.length > 0) {
            AtomFluidEngine.update(dt, State.signals);
            AtomFluidEngine.render();
        }

        this.render(timestamp, dt);
    },

    render(timestamp, dt) {
        const canvas = UI.canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        let signalFluidDrawn = false;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw source (camera or static image)
        const source = State.image;
        if (source) {
            const sw = Camera.active ? Camera.getWidth() : source.width;
            const sh = Camera.active ? Camera.getHeight() : source.height;
            if (sw > 0 && sh > 0) {
                const aspect = sw / sh;
                let dw = canvas.width, dh = dw / aspect;
                if (dh > canvas.height) { dh = canvas.height; dw = dh * aspect; }
                const dx = (canvas.width - dw) / 2;
                const dy = (canvas.height - dh) / 2;
                State.imageRect = { x: dx, y: dy, w: dw, h: dh };

                // Determine base image source (deform engine edits or raw)
                let imgSource = source;
                if (Camera.active && State.isDeforming) {
                    DeformEngine.snapshotCamera();
                    if (DeformEngine.hasEdits && DeformEngine.buffer) imgSource = DeformEngine.buffer;
                } else if (!Camera.active && DeformEngine.hasEdits && DeformEngine.buffer) {
                    imgSource = DeformEngine.buffer;
                }

                // Apply localized deformation at signal anchors (gravitational indentation)
                if (State.signals.length > 0 && ImageDeformPass._ready && ImageDeformPass._imageTex) {
                    const deformed = ImageDeformPass.render(State.signals, State.imageRect, canvas.width, canvas.height);
                    if (deformed) {
                        ctx.drawImage(deformed, dx, dy, dw, dh);
                    } else {
                        ctx.drawImage(imgSource, dx, dy, dw, dh);
                    }
                } else {
                    ctx.drawImage(imgSource, dx, dy, dw, dh);
                }
            }
        } else {
            State.imageRect = { x: 0, y: 0, w: 0, h: 0 };
        }

        // Draw layers
        State.layers.forEach(layer => {
            if (!layer.enabled) return;
            ctx.save();

            if (layer.type === 'signal') {
                if (!State.image) { ctx.restore(); return; }
                ctx.beginPath();
                ctx.rect(State.imageRect.x, State.imageRect.y, State.imageRect.w, State.imageRect.h);
                ctx.clip();
            }

            ctx.globalAlpha = layer.opacity || 1.0;

            if (layer.type === 'signal') {
                // Global fluid: draw the single engine canvas across full viewport
                if (State.signals.length > 0 && AtomFluidEngine.canvas) {
                    // Prevent duplicate rendering when multiple signal layers exist.
                    if (signalFluidDrawn) {
                        ctx.restore();
                        return;
                    }

                    const layOp = layer.opacity || 1.0;
                    const sharedSignal = State.signals.find(s => s.id === State.selectedSignalId) || State.signals[0];
                    const bMode = (sharedSignal && sharedSignal.params.blendMode) || 'screen';
                    const sigOp = sharedSignal ? Math.min(2.0, sharedSignal.params.opacity || 0.85) : 0.85;
                    const drawOp = layOp * sigOp;

                    if (bMode === 'embedded') {
                        ctx.globalCompositeOperation = 'soft-light';
                        ctx.globalAlpha = drawOp * 0.9;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                        ctx.globalCompositeOperation = 'overlay';
                        ctx.globalAlpha = drawOp * 0.6;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = drawOp * 0.35;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.globalAlpha = drawOp * 0.2;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                    } else if (bMode === 'add') {
                        ctx.globalCompositeOperation = 'lighter';
                        ctx.globalAlpha = drawOp;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                    } else {
                        ctx.globalCompositeOperation = bMode;
                        ctx.globalAlpha = drawOp;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                    }

                    this._renderScannerGlitch(ctx, timestamp, layOp);
                    signalFluidDrawn = true;
                }
            } else if (layer.type === 'data') {
                layer.render(ctx, canvas, State.signals);
            } else {
                layer.render(ctx, canvas);
            }
            ctx.restore();
        });

        // Status bar
        UI.status.layers.textContent = `${State.layers.length} layers`;
        UI.status.signals.textContent = `${State.signals.length} signals`;
        UI.signalCount.textContent = State.signals.length;
        UI.status.fps.textContent = `${DebugMode._fps} fps`;

        // Debug HUD (rendered last, on top)
        DebugMode.renderHUD(ctx, canvas, State.signals);
    },

    /** Capture current frame as PNG (without debug overlay unless toggled) */
    capture() {
        const canvas = UI.canvas;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        const ectx = exportCanvas.getContext('2d');

        // Temporarily disable debug for capture
        const debugWasOn = DebugMode.enabled;
        if (!DebugMode.includeInExport) {
            DebugMode.enabled = false;
        }

        // Re-render to export canvas
        const origCtx = UI.ctx;
        this.render(performance.now(), 16);

        // Draw main canvas content to export canvas
        ectx.drawImage(canvas, 0, 0);

        // Restore debug
        DebugMode.enabled = debugWasOn;

        // Trigger re-render to restore debug HUD
        this.render(performance.now(), 16);

        // Download
        exportCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ghost_signal_${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
        }, 'image/png');
    }
};

/* ── UI BINDINGS ────────────────────────────────────── */

function initBindings() {
    // Image upload
    UI.upload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                if (img.width > 0 && img.height > 0) {
                    Camera.stop();
                    State.image = img;
                    DeformEngine.initBuffer(img.width, img.height);
                    ImageDeformPass.uploadImage(img);
                    UI.btnAddSignal.disabled = false;
                    UI.btnDeformMode.disabled = false;
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Camera toggle
    if (UI.btnCamera) {
        UI.btnCamera.addEventListener('click', () => Camera.toggle());
    }

    // Capture
    if (UI.btnCapture) {
        UI.btnCapture.addEventListener('click', () => Renderer.capture());
    }

    // Telemetry file input
    const telInput = document.getElementById('telemetry-upload');
    if (telInput) {
        telInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) Telemetry.loadFromFile(file);
        });
    }

    // Add Signal
    UI.btnAddSignal.addEventListener('click', () => {
        State.isPlacingSignal = !State.isPlacingSignal;
        if (State.isPlacingSignal) {
            State.isDeforming = false;
            UI.btnDeformMode.classList.remove('active');
            UI.btnDeformMode.textContent = 'DEFORM MODE: OFF';
        }
        UI.btnAddSignal.classList.toggle('active', State.isPlacingSignal);
        UI.placementIndicator.classList.toggle('hidden', !State.isPlacingSignal);
        UI.canvas.parentElement.classList.toggle('placing', State.isPlacingSignal);
    });

    // Deform Mode
    UI.btnDeformMode.addEventListener('click', () => {
        State.isDeforming = !State.isDeforming;
        if (State.isDeforming) {
            State.isPlacingSignal = false;
            UI.btnAddSignal.classList.remove('active');
            UI.placementIndicator.classList.add('hidden');
        }
        UI.btnDeformMode.classList.toggle('active', State.isDeforming);
        UI.btnDeformMode.textContent = `DEFORM MODE: ${State.isDeforming ? 'ON' : 'OFF'}`;
        if (State.isDeforming) {
            UI.canvas.parentElement.classList.add('deforming');
            UI.canvas.parentElement.classList.remove('placing');
            // Init buffer for camera if camera is active
            if (Camera.active) {
                DeformEngine.initBuffer(Camera.getWidth(), Camera.getHeight());
            }
            renderParamsPanel(DeformEngine);
            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn btn-action';
            resetBtn.textContent = 'RESET DEFORMATIONS';
            resetBtn.style.marginTop = '12px';
            resetBtn.onclick = () => DeformEngine.reset();
            UI.paramsBody.appendChild(resetBtn);
        } else {
            UI.canvas.parentElement.classList.remove('deforming');
            UI.paramsBody.innerHTML = '<p class="placeholder-text">Select a signal cloud or layer to edit parameters.</p>';
            UI.paramsTitle.textContent = "PARAMETERS";
            DeformEngine.isDragging = false;
        }
    });

    // Deform mouse events
    UI.canvas.addEventListener('mousedown', (e) => {
        if (State.isDeforming) {
            const rect = UI.canvas.getBoundingClientRect();
            DeformEngine.lastPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            DeformEngine.isDragging = true;
        }
    });

    window.addEventListener('mouseup', () => {
        if (State.isDeforming) {
            DeformEngine.isDragging = false;
            DeformEngine.lastPt = null;
        }
    });

    UI.canvas.addEventListener('mousemove', (e) => {
        if (State.isDeforming && DeformEngine.isDragging && DeformEngine.lastPt) {
            const rect = UI.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const dx = x - DeformEngine.lastPt.x;
            const dy = y - DeformEngine.lastPt.y;
            const stab = DeformEngine.params.stabilize;
            DeformEngine.lastPt.x += dx * (1.0 - stab);
            DeformEngine.lastPt.y += dy * (1.0 - stab);
            DeformEngine.applyDeform(x, y, dx, dy);
        }
    });

    // Place signal on canvas click
    UI.canvas.addEventListener('click', (e) => {
        if (!State.isPlacingSignal) return;
        const rect = UI.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Consume placement mode first to avoid accidental re-entry.
        State.isPlacingSignal = false;
        UI.btnAddSignal.classList.remove('active');
        UI.placementIndicator.classList.add('hidden');
        UI.canvas.parentElement.classList.remove('placing');
        addSignal(x, y);
    });

    // Layer menu
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

    // Debug toggle checkbox
    const debugToggle = document.getElementById('debug-toggle');
    if (debugToggle) {
        debugToggle.addEventListener('change', (e) => {
            DebugMode.enabled = e.target.checked;
        });
    }

    // Debug export toggle
    const debugExport = document.getElementById('debug-export-toggle');
    if (debugExport) {
        debugExport.addEventListener('change', (e) => {
            DebugMode.includeInExport = e.target.checked;
        });
    }

    // Freeze / Jitter toggles
    const freezeToggle = document.getElementById('telemetry-freeze');
    if (freezeToggle) {
        freezeToggle.addEventListener('change', (e) => { Telemetry.freeze = e.target.checked; });
    }
    const jitterToggle = document.getElementById('telemetry-jitter');
    if (jitterToggle) {
        jitterToggle.addEventListener('change', (e) => { Telemetry.jitter = e.target.checked; });
    }

    // Manual params toggle
    const manualToggle = document.getElementById('manual-params-toggle');
    if (manualToggle) {
        manualToggle.addEventListener('change', (e) => { State.useManualParams = e.target.checked; });
    }

    // D key for debug
    window.addEventListener('keydown', (e) => {
        if (e.key === 'd' || e.key === 'D') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            DebugMode.toggle();
        }
    });
}

function addLayer(type) {
    if (type === 'signal' && State.layers.some(l => l.type === 'signal')) {
        return;
    }

    let layer;
    switch (type) {
        case 'signal': layer = new SignalLayer(); break;
        case 'data': layer = new DataLayer(); break;
    }
    if (layer) {
        State.layers.push(layer);
        updateLayerList();
    }
}

function addSignal(x, y) {
    const now = performance.now();
    if (State.lastSignalPlacement) {
        const dt = now - State.lastSignalPlacement.t;
        const dx = x - State.lastSignalPlacement.x;
        const dy = y - State.lastSignalPlacement.y;
        if (dt < 250 && Math.hypot(dx, dy) < 8) return;
    }
    State.lastSignalPlacement = { x, y, t: now };

    const signal = new SignalAnchor(x, y, Date.now());

    // Sample image color at anchor position for natural coloring
    if (State.imageRect && State.imageRect.w > 0) {
        const sampled = ImageDeformPass.sampleColor(x, y, State.imageRect);
        if (sampled) {
            // v16 Baseline: modification 1 - store normalized color
            signal.color = { r: sampled.r / 255, g: sampled.g / 255, b: sampled.b / 255 };

            // Still update HSL for UI sliders to reflect reality
            const hsl = _rgbToHSL(sampled.r, sampled.g, sampled.b);
            signal.params.hue = hsl.h;
            signal.params.saturation = hsl.s;
            signal.params.brightness = hsl.l;
            signal._buildGradient();
        }
    }

    State.signals.push(signal);

    if (!State.layers.find(l => l.type === 'signal')) {
        addLayer('signal');
    }
    const signalLayer = State.layers.find(l => l.type === 'signal');
    signalLayer.signals.push(signal);

    updateSignalList();
    selectSignal(signal.id);
}

/** Convert RGB (0-255) to HSL (h:0-360, s:0-100, l:0-100) */
function _rgbToHSL(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
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
}

/* ── PARAMETER RENDERING ────────────────────────────── */

function createKnobControl(target, key, val, row, label) {
    const knobWrap = document.createElement('div');
    knobWrap.className = 'param-knob-wrap';

    const knob = document.createElement('div');
    knob.className = 'param-knob';

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'param-value';

    const min = 0;
    const max = 1;
    const startDeg = -135;
    const arc = 270;
    let currentValue = Math.max(min, Math.min(max, Number(val) || 0));

    const paint = () => {
        const t = (currentValue - min) / (max - min);
        const angle = startDeg + t * arc;
        knob.style.setProperty('--knob-angle', `${angle}deg`);
        valueDisplay.textContent = currentValue.toFixed(2);
    };

    const applyValue = (nextVal) => {
        currentValue = Math.max(min, Math.min(max, nextVal));
        target.params[key] = currentValue;
        if (target instanceof SignalAnchor) {
            target.dirty = true;
            State.useManualParams = true;
            const mt = document.getElementById('manual-params-toggle');
            if (mt) mt.checked = true;
        }
        paint();
    };

    const updateFromPointer = (ev) => {
        const rect = knob.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = ev.clientX - cx;
        const dy = ev.clientY - cy;
        const deg = Math.atan2(dy, dx) * (180 / Math.PI);
        const clampedDeg = Math.max(startDeg, Math.min(startDeg + arc, deg));
        const t = (clampedDeg - startDeg) / arc;
        applyValue(min + t * (max - min));
    };

    knob.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        knob.setPointerCapture(ev.pointerId);
        knob.classList.add('active');
        updateFromPointer(ev);
    });

    knob.addEventListener('pointermove', (ev) => {
        if (!knob.hasPointerCapture(ev.pointerId)) return;
        updateFromPointer(ev);
    });

    knob.addEventListener('pointerup', (ev) => {
        if (knob.hasPointerCapture(ev.pointerId)) knob.releasePointerCapture(ev.pointerId);
        knob.classList.remove('active');
    });

    knob.addEventListener('pointercancel', (ev) => {
        if (knob.hasPointerCapture(ev.pointerId)) knob.releasePointerCapture(ev.pointerId);
        knob.classList.remove('active');
    });

    knobWrap.appendChild(knob);
    row.appendChild(label);
    row.appendChild(knobWrap);
    row.appendChild(valueDisplay);
    paint();
}

function renderParamsPanel(target) {
    UI.paramsTitle.textContent = target.name || `CLOUD_${target.data.hash}`;
    UI.paramsBody.innerHTML = '';

    const params = target.params;
    if (!params) return;

    Object.keys(params).forEach(key => {
        // Fix 6: hide abs position when tracking=1, hide relative offset when tracking=0
        if (target.params.tracking === 1 && (key === 'dataAbsX' || key === 'dataAbsY')) return;
        if (target.params.tracking === 0 && (key === 'dataOffsetX' || key === 'dataOffsetY')) return;

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

            let min = 0, max = 1, step = 0.01;
            // Atom Fluid Params vAtom
            if (key === 'size') { min = 0.00025; max = 0.03; step = 0.00025; } // v16 Baseline: min is half of 0.0005
            if (key === 'density') { min = 0.1; max = 3.0; step = 0.05; }
            if (key === 'speed') { min = 0.1; max = 5.0; step = 0.05; }
            if (key === 'radiusLimit') { min = 5; max = 200; step = 1; }
            if (key === 'curlRadius') { min = 0; max = 140; step = 1; }
            if (key === 'emissionRate') { min = 0.5; max = 20; step = 0.5; }
            if (key === 'anchorJitter') { min = 0; max = 80; step = 1; }
            if (key === 'blobManipulation') { min = 0; max = 1; step = 0.01; }
            if (key === 'scannerGlitch') { min = 0; max = 1; step = 0.01; }
            if (key === 'hue') { min = 0; max = 360; step = 1; }
            if (key === 'saturation') { min = 0; max = 100; step = 1; }
            if (key === 'brightness') { min = 0; max = 100; step = 1; }
            if (key === 'opacity') { min = 0; max = 2.0; step = 0.01; }
            // Per-signal data offset
            if (key === 'dataOffsetX') { min = -200; max = 200; step = 1; }
            if (key === 'dataOffsetY') { min = -200; max = 200; step = 1; }
            if (key === 'dataAbsX') { min = 0; max = 800; step = 1; }
            if (key === 'dataAbsY') { min = 0; max = 480; step = 1; }
            // Deform params
            if (key === 'brushSize') { min = 10; max = 500; step = 1; }
            if (key === 'strength') { min = 0.1; max = 5.0; step = 0.05; }
            if (key === 'stabilize') { min = 0; max = 0.95; step = 0.01; }
            if (key === 'softness') { min = 0; max = 1; step = 0.01; }
            // Data layer
            if (key === 'fontSize') { min = 6; max = 24; step = 1; }

            slider.min = min; slider.max = max; slider.step = step;
            slider.value = val;

            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'param-value';
            valueDisplay.textContent = val;

            slider.oninput = (e) => {
                target.params[key] = parseFloat(e.target.value);
                valueDisplay.textContent = e.target.value;
                if (target instanceof SignalAnchor) {
                    target.dirty = true;
                    State.useManualParams = true;
                    const mt = document.getElementById('manual-params-toggle');
                    if (mt) mt.checked = true;
                }
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
                if (target instanceof SignalAnchor) target.dirty = true;
            };
            row.appendChild(label);
            row.appendChild(toggle);
        } else if (key === 'deviceIdText') {
            // Text input for editable device ID
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.className = 'param-text';
            textInput.placeholder = target.data ? target.data.deviceId : 'ID...';
            textInput.value = val || '';
            textInput.oninput = (e) => {
                target.params[key] = e.target.value;
                if (target instanceof SignalAnchor) target.dirty = true;
            };
            row.appendChild(label);
            row.appendChild(textInput);
        } else if (key === 'tracking') {
            // Toggle for tracking mode (1=relative, 0=absolute)
            row.className = 'param-toggle-row';
            const toggle = document.createElement('div');
            toggle.className = `param-toggle ${val === 1 ? 'active' : ''}`;
            toggle.onclick = () => {
                target.params[key] = target.params[key] === 1 ? 0 : 1;
                toggle.classList.toggle('active');
                if (target instanceof SignalAnchor) target.dirty = true;
                // Rebuild param panel to show/hide absolute position sliders
                renderParamsPanel(target);
            };
            row.appendChild(label);
            row.appendChild(toggle);
        } else if (key === 'blendMode') {
            const select = document.createElement('select');
            select.className = 'param-select';
            ['embedded', 'screen', 'add', 'soft-light', 'overlay', 'multiply', 'color-dodge'].forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m.toUpperCase();
                if (m === val) opt.selected = true;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                target.params[key] = e.target.value;
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
            };
            row.appendChild(label);
            row.appendChild(colorInput);
        }

        UI.paramsBody.appendChild(row);
    });
}

/* ── BOOTSTRAP ──────────────────────────────────────── */

window.addEventListener('load', () => {
    Telemetry.init();
    ImageDeformPass.init();
    Renderer.init();
    initBindings();

    // Default layers: signal + data only (no scanner/grain)
    addLayer('signal');
    addLayer('data');

    if (State.layers.length > 0) selectLayer(State.layers[0].id);

    console.log("GHOST SIGNAL INSTRUMENT vAtom: ATOM FLUID — READY");

    // Start continuous render loop
    requestAnimationFrame((t) => Renderer.loop(t));
});

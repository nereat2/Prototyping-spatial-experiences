/**
 * GHOST SIGNAL INSTRUMENT — v18 Digital Ghost
 * 
 * CORE ARCHITECTURE (preserved):
 * - State: Single source of truth.
 * - Layer classes: Decoupled rendering logic.
 * - GhostOrb: Particle orb with selectable math motion (ghost.js).
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
                `DEVICE: ${s.data.deviceName}`,
                `ID: ${s.data.deviceId}`,
                `NET: ${s.data.network}`,
                `PWR: ${s.data.strength}`,
                `0x: ${s.data.hash}`
            ];
            const padding = 4;
            const lineH = this.params.fontSize + 4;
            ctx.shadowBlur = opacity > 0.8 ? 8 : 4;
            ctx.shadowColor = this.params.color;
            ctx.beginPath();
            ctx.strokeStyle = this.params.color;
            ctx.globalAlpha = opacity;
            ctx.lineWidth = opacity > 0.8 ? 2 : 1;
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(x - padding, y - padding);
            ctx.stroke();
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

/* ── TELEMETRY → SMOKE MAPPING ────────────────────── */

const TelemetryMapper = {
    /** Apply telemetry state to ghost orb params (non-destructive, additive) */
    apply(signal, ts) {
        if (!ts || !ts.norm) return;
        const n = ts.norm;

        // Map telemetry to v18 Digital Ghost params
        signal.params.particleCount = Math.floor(80 + n.wifiDeviceCount * 400);
        signal.params.radius = 30 + n.wifiMeanRssi * 80;
        signal.params.speed = 0.5 + n.wifiBurstRate * 2.0;
        signal.params.opacity = 0.5 + n.wifiMeanRssi * 0.5;
        signal.params.jitter = 0.1 + n.wifiRssiVariance * 0.6;

        // Color from channel spread
        signal.params.colorH = 180 + n.wifiChannelSpread * 160;
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
    useManualParams: false  // When true, telemetry mapping is skipped
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
        window.addEventListener('resize', () => this.resize());
        this.resize();
    },

    resize() {
        const container = UI.canvas.parentElement;
        UI.canvas.width = container.clientWidth;
        UI.canvas.height = container.clientHeight;
        State.resolution = { w: UI.canvas.width, h: UI.canvas.height };
        UI.status.res.textContent = `${UI.canvas.width}×${UI.canvas.height}`;
    },

    requestRender() {
        // Always running now (continuous loop)
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

        // Map telemetry to smoke params (unless user is manually adjusting)
        if (!State.useManualParams) {
            State.signals.forEach(s => {
                TelemetryMapper.apply(s, Telemetry.telemetryState);
            });
        }

        // Update smoke particles
        State.signals.forEach(s => {
            if (s.update) s.update(dt);
        });

        this.render(timestamp, dt);
    },

    render(timestamp, dt) {
        const canvas = UI.canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

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

                if (Camera.active && State.isDeforming) {
                    // D1: Camera deform — snapshot frame, apply warp, draw result
                    DeformEngine.snapshotCamera();
                    if (DeformEngine.hasEdits && DeformEngine.buffer) {
                        ctx.drawImage(DeformEngine.buffer, dx, dy, dw, dh);
                    } else {
                        ctx.drawImage(source, dx, dy, dw, dh);
                    }
                } else if (!Camera.active && DeformEngine.hasEdits && DeformEngine.buffer) {
                    ctx.drawImage(DeformEngine.buffer, dx, dy, dw, dh);
                } else {
                    ctx.drawImage(source, dx, dy, dw, dh);
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
                layer.signals.forEach(s => {
                    s.renderToCache();
                    const bMode = s.params.blendMode || 'embedded';

                    const ox = s.x - s.offscreen.width / 2;
                    const oy = s.y - s.offscreen.height / 2;
                    const sigOp = Math.min(2.0, s.params.opacity || 1.0);
                    const layOp = layer.opacity || 1.0;

                    if (bMode === 'embedded') {
                        // C2: Strong embedded blend — 3 passes for depth
                        // Pass 1: soft-light (main body)
                        ctx.globalCompositeOperation = 'soft-light';
                        ctx.globalAlpha = layOp * sigOp * 0.9;
                        ctx.drawImage(s.offscreen, ox, oy);

                        // Pass 2: overlay (contrast + depth)
                        ctx.globalCompositeOperation = 'overlay';
                        ctx.globalAlpha = layOp * sigOp * 0.6;
                        ctx.drawImage(s.offscreen, ox, oy);

                        // Pass 3: screen (rim light / highlights)
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = layOp * sigOp * 0.35;
                        ctx.drawImage(s.offscreen, ox, oy);

                        // Pass 4: source-over for solid presence
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.globalAlpha = layOp * sigOp * 0.2;
                        ctx.drawImage(s.offscreen, ox, oy);
                    } else if (bMode === 'add') {
                        ctx.globalCompositeOperation = 'lighter';
                        ctx.globalAlpha = layOp * sigOp;
                        ctx.drawImage(s.offscreen, ox, oy);
                    } else {
                        ctx.globalCompositeOperation = bMode;
                        ctx.globalAlpha = layOp * sigOp;
                        ctx.drawImage(s.offscreen, ox, oy);
                    }
                });
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
        addSignal(x, y);
        State.isPlacingSignal = false;
        UI.btnAddSignal.classList.remove('active');
        UI.placementIndicator.classList.add('hidden');
        UI.canvas.parentElement.classList.remove('placing');
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
    const signal = new GhostOrb(x, y, Date.now());
    State.signals.push(signal);

    if (!State.layers.find(l => l.type === 'signal')) {
        addLayer('signal');
    }
    const signalLayer = State.layers.find(l => l.type === 'signal');
    signalLayer.signals.push(signal);

    updateSignalList();
    selectSignal(signal.id);
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

            // Digital Ghost Params v18
            if (key === 'particleCount') { min = 10; max = 1000; step = 10; }
            if (key === 'radius') { min = 10; max = 200; step = 1; }
            if (key === 'dotSize') { min = 0.5; max = 5; step = 0.1; }
            if (key === 'speed') { min = 0; max = 5.0; step = 0.05; }
            if (key === 'motionA') { min = 0; max = 10; step = 0.1; }
            if (key === 'motionB') { min = 0; max = 10; step = 0.1; }
            if (key === 'motionC') { min = -3.14; max = 3.14; step = 0.05; }
            if (key === 'colorH') { min = 0; max = 360; step = 1; }
            if (key === 'colorS') { min = 0; max = 100; step = 1; }
            if (key === 'colorL') { min = 0; max = 100; step = 1; }
            if (key === 'opacity') { min = 0; max = 1.0; step = 0.01; }
            if (key === 'jitter') { min = 0; max = 2.0; step = 0.01; }
            if (key === 'breathing') { min = 0; max = 0.5; step = 0.01; }
            if (key === 'trailAlpha') { min = 0; max = 0.3; step = 0.005; }
            if (key === 'seed') { min = 0; max = 10000; step = 1; }
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
                if (target instanceof GhostOrb) {
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
                if (target instanceof GhostOrb) target.dirty = true;
            };
            row.appendChild(label);
            row.appendChild(toggle);
        } else if (key === 'motionFn') {
            const select = document.createElement('select');
            select.className = 'param-select';
            ['lissajous', 'rose', 'lorenz', 'orbital', 'perlin'].forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m.toUpperCase();
                if (m === val) opt.selected = true;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                target.params[key] = e.target.value;
                if (target instanceof GhostOrb) target.dirty = true;
            };
            row.appendChild(label);
            row.appendChild(select);
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
    Renderer.init();
    initBindings();

    // Default layers: signal + data only (no scanner/grain)
    addLayer('signal');
    addLayer('data');

    if (State.layers.length > 0) selectLayer(State.layers[0].id);

    console.log("GHOST SIGNAL INSTRUMENT v18: DIGITAL GHOST — READY");

    // Start continuous render loop
    requestAnimationFrame((t) => Renderer.loop(t));
});

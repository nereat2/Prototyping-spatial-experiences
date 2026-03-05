/**
 * SMOKE SIGNAL CLOUD — v17 Rising Smoke Source
 * 
 * Features:
 * - Perlin/FBM Engine: Specific noise implementation from provided source
 * - Rising Dynamics: Particles move vertically from anchor, expanding/fading
 * - Embers: Companion sparks rising with high-speed jitter
 * - Warm/Cold Palette: Contextual color mapping (hsla-based)
 * - Ellipse Rendering: Non-circular radial gradients for volumetric wisps
 */

// Perlin helpers (Encapsulated to avoid collision with app.js)
const SmokeEngine = (() => {
    const PERM = new Uint8Array(512);
    const GRAD = [];
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
        const a = Math.random() * Math.PI * 2;
        GRAD.push([Math.cos(a), Math.sin(a)]);
    }

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + t * (b - a); }

    function noise(x, y) {
        const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x), yf = y - Math.floor(y);
        const u = fade(xf), v = fade(yf);
        const aa = PERM[PERM[xi] + yi];
        const ab = PERM[PERM[xi] + yi + 1];
        const ba = PERM[PERM[xi + 1] + yi];
        const bb = PERM[PERM[xi + 1] + yi + 1];
        const dot = (g, dx, dy) => GRAD[g][0] * dx + GRAD[g][1] * dy;
        return lerp(
            lerp(dot(aa, xf, yf), dot(ba, xf - 1, yf), u),
            lerp(dot(ab, xf, yf - 1), dot(bb, xf - 1, yf - 1), u),
            v
        );
    }

    function fbm(x, y, oct) {
        let v = 0, a = 0.5, f = 1, m = 0;
        for (let i = 0; i < oct; i++) {
            v += noise(x * f, y * f) * a;
            m += a; a *= 0.5; f *= 2.1;
        }
        return v / m;
    }

    return { fbm };
})();

class SmokeSignalCloud {
    constructor(x, y, id) {
        this.id = id;
        this.anchorX = x; // source point on screen
        this.anchorY = y;
        this.x = x;
        this.y = y;

        this.params = {
            speed: 1.0,           // master speed multiplier
            smokeCount: 95,       // high-vis blobs
            emberCount: 20,       // companion sparks
            lockRadius: 240,
            density: 0.6,         // overall visibility scale
            smokeOpacity: 0.062,  // base per-smoke alpha
            emberOpacity: 0.8,    // base per-ember alpha
            palette: 'cold',      // 'cold' | 'warm'
            dataVisible: true,
            seed: Math.floor(Math.random() * 10000)
        };

        const deviceNames = [
            "Anna's iPhone", "Dad's Laptop", "Kitchen Tablet", "Leo's AirPods",
            "Reception iMac", "Unknown Android", "Maria's Watch", "Office Printer",
            "Smart TV Living Room", "Visitor Device", "Security Camera 02",
            "Router Upstairs", "Grandma's iPad", "Studio MacBook"
        ];
        this.data = {
            deviceName: deviceNames[Math.floor(Math.random() * deviceNames.length)],
            deviceId: "DEV-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
            network: ["ERR_VOID", "GHOST_NET", "FIELD_0X4", "NULL_SIG"][Math.floor(Math.random() * 4)],
            strength: (Math.random() * -100).toFixed(1) + " dBm",
            hash: "0x" + Math.random().toString(16).substr(2, 4).toUpperCase()
        };

        this.smokeParticles = [];
        this.emberParticles = [];
        this._initParticles();

        this.offscreen = document.createElement('canvas');
        this.ctx = this.offscreen.getContext('2d');
        this._initialized = false;
        this._time = 0;
        this.dirty = true;
    }

    _initParticles() {
        this.smokeParticles = Array.from({ length: this.params.smokeCount }, () => this._createSmoke(true));
        this.emberParticles = Array.from({ length: this.params.emberCount }, () => this._createEmber());
    }

    _createSmoke(init = false) {
        const s = {
            lx: (Math.random() - 0.5) * 22, // relative to anchor
            ly: init ? -(Math.random() * 600) : 80, // rise up initially, or start at base
            baseY: 80,
            vx: 0,
            vy: -(0.22 + Math.random() * 0.32),
            life: init ? Math.random() : 0,
            decay: 0.007 + Math.random() * 0.005,
            size: 30 + Math.random() * 55,
            maxSize: 0,
            rot: Math.random() * Math.PI * 2,
            rotSpd: (Math.random() - 0.5) * 0.005,
            ox: Math.random() * 200,
            oy: Math.random() * 200,
            warm: false,
            hue: 195 + Math.random() * 50,
            currentSize: 0
        };
        s.maxSize = s.size * (2.8 + Math.random() * 2);
        s.currentSize = s.size;
        return s;
    }

    _createEmber() {
        return {
            lx: (Math.random() - 0.5) * 16,
            ly: 75 + Math.random() * 8,
            vx: (Math.random() - 0.5) * 0.45,
            vy: -(0.55 + Math.random() * 0.9),
            life: 0,
            decay: 0.013 + Math.random() * 0.011,
            r: 0.8 + Math.random() * 1.4,
            hue: 18 + Math.random() * 35
        };
    }

    _resetSmoke(s) {
        const fresh = this._createSmoke(false);
        Object.assign(s, fresh);
    }

    _resetEmber(e) {
        const fresh = this._createEmber();
        Object.assign(e, fresh);
    }

    _initBuffers() {
        const size = 1024;
        if (this.offscreen.width !== size) {
            this.offscreen.width = size;
            this.offscreen.height = size;
        }
        this.x = this.anchorX;
        this.y = this.anchorY;
        this._initialized = true;
    }

    update(dt) {
        if (!this._initialized) this._initBuffers();

        const speed = this.params.speed;
        const dSec = Math.min(dt / 1000, 0.05); // local speed independent of global?
        this._time += dSec * speed; // but scaled by knob

        // Update Smoke
        this.smokeParticles.forEach(p => {
            p.life += p.decay * speed;
            const t = this._time;
            const nx = SmokeEngine.fbm(p.lx * 0.0028 + p.ox + t * 0.11, p.ly * 0.0028 + t * 0.045, 4);
            const ny = SmokeEngine.fbm(p.lx * 0.0028 + p.oy + t * 0.07, p.ly * 0.0028 + 60 + t * 0.055, 4);

            p.vx += nx * 0.5 * speed;
            p.vy += (ny * 0.15 - 0.007) * speed;

            p.vx *= 0.965;
            p.vy *= 0.982;

            p.lx += p.vx;
            p.ly += p.vy;
            p.rot += p.rotSpd * speed;
            p.currentSize = p.size + (p.maxSize - p.size) * p.life;

            if (p.life >= 1) this._resetSmoke(p);
        });

        // Update Embers
        this.emberParticles.forEach(e => {
            e.life += e.decay * speed;
            e.vx += (Math.random() - 0.5) * 0.07 * speed;
            e.lx += e.vx;
            e.ly += e.vy * speed;
            e.vy *= 0.992;
            if (e.life >= 1) this._resetEmber(e);
        });

        // Dynamic resizing of pool if params change
        if (this.smokeParticles.length !== this.params.smokeCount) {
            this._initParticles();
        }
    }

    renderToCache() {
        if (!this._initialized) this._initBuffers();

        const ctx = this.ctx;
        const w = this.offscreen.width;
        const h = this.offscreen.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;

        const isWarm = this.params.palette === 'warm';

        // 1. Sort Smoke by Size (elliptical blobs)
        const sortedSmoke = [...this.smokeParticles].sort((a, b) => b.currentSize - a.currentSize);

        // 2. Draw Ground Glow (Source)
        const sg = ctx.createRadialGradient(cx, cy + 75, 0, cx, cy + 75, 100);
        sg.addColorStop(0, isWarm ? "rgba(255,190,100,0.08)" : "rgba(100,190,255,0.05)");
        sg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 75, 100, 38, 0, 0, Math.PI * 2);
        ctx.fill();

        // 3. Draw Smoke
        sortedSmoke.forEach(p => {
            const life = p.life;
            let a = life < 0.1 ? life / 0.1 : life < 0.55 ? 1 : 1 - (life - 0.55) / 0.45;
            a = Math.max(0, a) * this.params.smokeOpacity * this.params.density;

            ctx.save();
            ctx.translate(cx + p.lx, cy + p.ly);
            ctx.rotate(p.rot);

            const r = p.currentSize;
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);

            if (isWarm) {
                g.addColorStop(0, `hsla(28,18%,74%,${a * 1.3})`);
                g.addColorStop(0.45, `hsla(18,12%,52%,${a * 0.75})`);
                g.addColorStop(1, "hsla(210,8%,28%,0)");
            } else {
                g.addColorStop(0, `hsla(${p.hue},7%,82%,${a * 1.1})`);
                g.addColorStop(0.45, `hsla(${p.hue},5%,54%,${a * 0.65})`);
                g.addColorStop(1, `hsla(${p.hue},4%,22%,0)`);
            }

            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(0, 0, r, r * 1.18, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });

        // 4. Draw Embers
        this.emberParticles.forEach(e => {
            const life = e.life;
            let a = life < 0.18 ? life / 0.18 : 1 - (life - 0.18) / 0.82;
            a = Math.max(0, a) * this.params.emberOpacity * this.params.density;

            ctx.beginPath();
            ctx.arc(cx + e.lx, cy + e.ly, e.r * (1 - life * 0.4), 0, Math.PI * 2);
            ctx.fillStyle = isWarm
                ? `hsla(${e.hue},85%,68%,${a})`
                : `hsla(${200 + e.hue},60%,85%,${a})`;
            ctx.fill();
        });

        this.dirty = false;
    }

    getParticleCount() {
        return this.smokeParticles.length + this.emberParticles.length;
    }
}

/**
 * DIGITAL GHOST — Particle Orb System v18
 *
 * Each GhostOrb = a cloud of pixel-dots orbiting an anchor point
 * using selectable mathematical motion functions.
 * Designed for 800×480 AR overlay on live camera feed.
 *
 * Motion Functions:
 *   lissajous — Parametric x=sin(at), y=cos(bt) orbits
 *   rose      — Polar r=cos(kθ) petal paths
 *   lorenz    — Projected Lorenz attractor XY (chaotic)
 *   orbital   — Elliptical Keplerian orbits
 *   perlin    — FBM curl-noise displacement field
 */

/* ── PERLIN ENGINE (scoped) ─────────────────────────── */

const GhostNoise = (() => {
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
            m += a; a *= 0.5; f *= 2.0;
        }
        return v / m;
    }

    return { noise, fbm };
})();

/* ── MOTION FUNCTIONS ───────────────────────────────── */

const MotionFunctions = {

    /**
     * Lissajous — parametric harmonic curves
     * x = R·sin(a·t + phaseX)
     * y = R·cos(b·t + phaseY)
     */
    lissajous(particle, t, params) {
        const { radius, motionA, motionB, motionC } = params;
        const r = radius * (1.0 + particle.radiusOffset * 0.3);
        const pt = t * particle.speed + particle.phase;
        const x = r * Math.sin(motionA * pt + motionC);
        const y = r * Math.cos(motionB * pt);
        return { x, y };
    },

    /**
     * Rose — polar curve r = R·cos(k·θ)
     * Creates petal-shaped orbital paths
     */
    rose(particle, t, params) {
        const { radius, motionA } = params;
        const k = motionA || 3;
        const theta = t * particle.speed + particle.phase;
        const r = radius * (0.3 + 0.7 * Math.abs(Math.cos(k * theta)));
        const rOffset = r * (1.0 + particle.radiusOffset * 0.25);
        const x = rOffset * Math.cos(theta);
        const y = rOffset * Math.sin(theta);
        return { x, y };
    },

    /**
     * Lorenz — projected chaotic attractor
     * Simplified 2D projection of the Lorenz system.
     * Each particle traces a butterfly-like path.
     */
    lorenz(particle, t, params) {
        const { radius, motionA, motionB } = params;
        const sigma = motionA || 10;
        const rho = motionB || 28;
        const pt = t * particle.speed * 0.3 + particle.phase;

        // Simplified Lorenz-like parametric
        const lx = Math.sin(pt * 1.3) * Math.cos(pt * 0.7) +
            0.5 * Math.sin(pt * sigma * 0.1);
        const ly = Math.cos(pt * 0.9) * Math.sin(pt * 1.1) +
            0.5 * Math.cos(pt * rho * 0.05);

        const r = radius * (1.0 + particle.radiusOffset * 0.35);
        return { x: lx * r, y: ly * r };
    },

    /**
     * Orbital — elliptical Keplerian paths
     * Varying eccentricity and inclination per particle.
     */
    orbital(particle, t, params) {
        const { radius, motionA, motionB } = params;
        const eccentricity = Math.min(0.9, (motionA || 0.5) * 0.3);
        const inclination = (motionB || 1.0) * 0.5;

        const theta = t * particle.speed + particle.phase;
        const r = radius * (1 - eccentricity * eccentricity) /
            (1 + eccentricity * Math.cos(theta));
        const rOffset = r * (1.0 + particle.radiusOffset * 0.2);

        const x = rOffset * Math.cos(theta);
        const y = rOffset * Math.sin(theta) * (0.6 + inclination * 0.4);
        return { x, y };
    },

    /**
     * Perlin — FBM curl-noise displacement
     * Each particle drifts through a noise field, creating smoky currents.
     */
    perlin(particle, t, params) {
        const { radius } = params;
        const scale = 0.008;
        const pt = t * particle.speed * 0.5;

        const nx = GhostNoise.fbm(
            particle.noiseOx + pt * 0.3,
            particle.noiseOy + pt * 0.15,
            4
        );
        const ny = GhostNoise.fbm(
            particle.noiseOx + 100 + pt * 0.2,
            particle.noiseOy + 100 + pt * 0.25,
            4
        );

        const r = radius * (1.0 + particle.radiusOffset * 0.3);
        return { x: nx * r * 2, y: ny * r * 2 };
    }
};

/* ── GHOST ORB CLASS ────────────────────────────────── */

class GhostOrb {
    constructor(x, y, id) {
        this.id = id;
        this.anchorX = x;
        this.anchorY = y;
        this.x = x;
        this.y = y;

        this.params = {
            particleCount: 200,
            radius: 60,
            dotSize: 1.5,
            speed: 1.0,
            motionFn: 'lissajous',
            motionA: 3,
            motionB: 2,
            motionC: 0,
            colorH: 200,
            colorS: 60,
            colorL: 70,
            opacity: 0.8,
            jitter: 0.3,
            breathing: 0.15,
            trailAlpha: 0.05,
            blendMode: 'screen',
            dataVisible: true,
            seed: Math.floor(Math.random() * 10000)
        };

        // Device data (simulated until real telemetry is connected)
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

        this.particles = [];
        this._initParticles();

        this.offscreen = document.createElement('canvas');
        this.ctx = this.offscreen.getContext('2d');
        this._initialized = false;
        this._time = 0;
        this._breathPhase = Math.random() * Math.PI * 2;
        this.dirty = true;
    }

    _initParticles() {
        const count = this.params.particleCount;
        this.particles = [];
        for (let i = 0; i < count; i++) {
            this.particles.push(this._createParticle(i, count));
        }
    }

    _createParticle(index, total) {
        const seed = this.params.seed + index;
        const rng = this._seededRandom(seed);
        return {
            phase: (index / total) * Math.PI * 2 + rng() * 0.5,
            speed: 0.4 + rng() * 1.2,
            radiusOffset: (rng() - 0.5) * 2,
            noiseOx: rng() * 300,
            noiseOy: rng() * 300,
            alpha: 0.5 + rng() * 0.5,
            jitterX: 0,
            jitterY: 0,
            hueShift: (rng() - 0.5) * 30  // Per-particle hue variation
        };
    }

    _seededRandom(seed) {
        return () => {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    _initBuffers() {
        // Buffer size: radius * 3 to accommodate glow and jitter
        const size = Math.max(256, Math.ceil(this.params.radius * 6));
        if (this.offscreen.width !== size || this.offscreen.height !== size) {
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
        const dSec = Math.min(dt / 1000, 0.05);
        this._time += dSec * speed;

        // Resize particle pool if count changed
        if (this.particles.length !== this.params.particleCount) {
            this._initParticles();
        }

        // Resize buffer if radius changed significantly
        const neededSize = Math.max(256, Math.ceil(this.params.radius * 6));
        if (Math.abs(this.offscreen.width - neededSize) > 50) {
            this._initBuffers();
        }

        // Update per-particle jitter
        const jitterAmt = this.params.jitter * this.params.radius * 0.3;
        this.particles.forEach(p => {
            p.jitterX = (Math.random() - 0.5) * jitterAmt;
            p.jitterY = (Math.random() - 0.5) * jitterAmt;
        });

        this._breathPhase += dSec * 1.2;
    }

    renderToCache() {
        if (!this._initialized) this._initBuffers();

        const ctx = this.ctx;
        const w = this.offscreen.width;
        const h = this.offscreen.height;
        const cx = w / 2;
        const cy = h / 2;

        // Trail effect: fade previous frame
        const trail = this.params.trailAlpha;
        if (trail > 0.001) {
            ctx.globalCompositeOperation = 'destination-in';
            ctx.globalAlpha = 1.0 - trail;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1.0;
        } else {
            ctx.clearRect(0, 0, w, h);
        }

        // Breathing modulation
        const breathMod = 1.0 + Math.sin(this._breathPhase) * this.params.breathing;

        // Ambient glow behind orb
        const glowR = this.params.radius * breathMod * 1.5;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        const { colorH, colorS, colorL, opacity } = this.params;
        glow.addColorStop(0, `hsla(${colorH}, ${colorS}%, ${colorL}%, ${opacity * 0.08})`);
        glow.addColorStop(0.5, `hsla(${colorH}, ${colorS}%, ${Math.max(0, colorL - 20)}%, ${opacity * 0.03})`);
        glow.addColorStop(1, `hsla(${colorH}, ${colorS}%, ${Math.max(0, colorL - 40)}%, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();

        // Get the motion function
        const motionFn = MotionFunctions[this.params.motionFn] || MotionFunctions.lissajous;

        // Apply breathing to a copy of params
        const renderParams = Object.assign({}, this.params, {
            radius: this.params.radius * breathMod
        });

        // Render each particle as a pixel dot
        const dotSize = this.params.dotSize;
        const t = this._time;

        this.particles.forEach(p => {
            const pos = motionFn(p, t, renderParams);
            const px = cx + pos.x + p.jitterX;
            const py = cy + pos.y + p.jitterY;

            const hue = (colorH + p.hueShift) % 360;
            const alpha = p.alpha * opacity;

            ctx.fillStyle = `hsla(${hue}, ${colorS}%, ${colorL}%, ${alpha})`;

            if (dotSize <= 1.5) {
                // Pixel-perfect dots: use fillRect for crisp digital look
                ctx.fillRect(
                    Math.round(px - dotSize / 2),
                    Math.round(py - dotSize / 2),
                    Math.ceil(dotSize),
                    Math.ceil(dotSize)
                );
            } else {
                // Larger dots: use arc for smooth circles
                ctx.beginPath();
                ctx.arc(px, py, dotSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Optional: bright core dot at center
        ctx.fillStyle = `hsla(${colorH}, ${Math.min(100, colorS + 20)}%, ${Math.min(100, colorL + 20)}%, ${opacity * 0.4})`;
        const coreR = 2 + Math.sin(this._breathPhase * 1.5) * 1;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();

        this.dirty = false;
    }

    getParticleCount() {
        return this.particles.length;
    }
}

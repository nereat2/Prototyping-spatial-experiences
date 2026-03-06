/**
 * ATOM FLUID ENGINE — vNext Global WebGL Navier-Stokes
 *
 * ONE global fluid sim canvas (full viewport size).
 * Multiple SignalAnchors inject splats into the shared field.
 * No per-signal canvases → no square edge artifacts → signals mix.
 *
 * Each anchor has N micro-emitters orbiting with mixed CW/CCW
 * for atomic, multi-directional motion (not a single vortex).
 */

"use strict";

/* ══════════════════════════════════════════════════════════
   SignalAnchor — lightweight per-signal data holder
   ══════════════════════════════════════════════════════════ */

class SignalAnchor {
    constructor(x, y, id) {
        this.id = id;
        this.x = x;
        this.y = y;

        // Per-signal tunable params
        this.params = {
            size: 0.003,            // v16 Baseline default
            density: 1.2,           // injection intensity
            speed: 1.0,             // scales injection force + emitter motion (NOT solver dt)
            radiusLimit: 60,        // max spread from anchor (px) — replaces old dissipation
            curlRadius: 30,         // curl/vorticity strength
            emissionRate: 5,        // splats per second per micro-emitter
            anchorJitter: 8,        // coherent noise offset radius (px)
            blobManipulation: 0,    // 0..1 manual "grab/twist" deformation control
            scannerGlitch: 0,       // 0..1 horizontal scanner-line glitch intensity
            hue: Math.random() * 360,
            saturation: 70,
            brightness: 80,
            opacity: 0.85,
            blendMode: 'embedded',  // default natural blending
            dataVisible: true,
            tracking: 1,            // 1=label follows blob, 0=label at fixed absolute position
            dataOffsetX: 20,
            dataOffsetY: 20,
            dataAbsX: 100,          // absolute label X (used when tracking=0)
            dataAbsY: 100,          // absolute label Y (used when tracking=0)
            deviceIdText: ''        // editable per-cloud ID text (empty = use generated)
        };
        this.color = null;          // v16 Baseline: modification 1

        // Simulated device data
        const names = [
            "Anna's iPhone", "Dad's Laptop", "Kitchen Tablet", "Leo's AirPods",
            "Reception iMac", "Unknown Android", "Maria's Watch", "Office Printer",
            "Smart TV Living Room", "Visitor Device", "Security Camera 02",
            "Router Upstairs", "Grandma's iPad", "Studio MacBook"
        ];
        this.data = {
            deviceName: names[Math.floor(Math.random() * names.length)],
            deviceId: "DEV-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
            network: ["ERR_VOID", "GHOST_NET", "FIELD_0X4", "NULL_SIG"][Math.floor(Math.random() * 4)],
            strength: (Math.random() * -100).toFixed(1) + " dBm",
            hash: "0x" + Math.random().toString(16).substr(2, 4).toUpperCase()
        };

        this.dirty = true;
        this._time = 0;
        this._splatCount = 0;

        // Per-anchor gradient palette (5 stops, HSL for rich mixing)
        this._buildGradient();

        // Create micro-emitters (3–7) with mixed CW/CCW
        this.microEmitters = [];
        const n = 3 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
            const cw = i % 2 === 0 ? 1 : -1;
            this.microEmitters.push({
                radius: 15 + Math.random() * 35,
                omega: cw * (0.03 + Math.random() * 0.12),
                phase: Math.random() * Math.PI * 2,
                radialBias: (Math.random() - 0.5) * 0.3,
                noisePhase: Math.random() * 100,
                colorOffset: Math.random() * 60 - 30
            });
        }
    }

    /** Rebuild 5-stop gradient palette from current hue */
    _buildGradient() {
        const h = this.params.hue;
        this.colorGradient = [
            { h: h - 30, s: 60, l: 25 },
            { h: h - 10, s: 75, l: 40 },
            { h: h, s: 85, l: 55 },
            { h: h + 15, s: 70, l: 45 },
            { h: h + 30, s: 55, l: 65 }
        ];
    }

    /** Get display ID text */
    getDisplayId() {
        return this.params.deviceIdText || this.data.deviceId;
    }

    getParticleCount() { return this._splatCount; }
}

/* ══════════════════════════════════════════════════════════
   AtomFluidEngine — singleton global fluid sim
   ══════════════════════════════════════════════════════════ */

const AtomFluidEngine = {
    canvas: null,
    gl: null,
    _noGL: false,
    _isWebGL2: false,
    _supportLinear: false,
    _ext: null,
    _programs: null,
    _shaders: null,
    _texW: 0,
    _texH: 0,
    _density: null,
    _velocity: null,
    _divergenceFBO: null,
    _curlFBO: null,
    _pressure: null,
    _time: 0,
    _totalSplats: 0,

    // Global sim config (defaults, can be overridden by first anchor or globally)
    config: {
        TEXTURE_DOWNSAMPLE: 1,
        DENSITY_DISSIPATION: 0.975,
        VELOCITY_DISSIPATION: 0.985,
        PRESSURE_DISSIPATION: 0.8,
        PRESSURE_ITERATIONS: 20,
        CURL: 30,
        BUOYANCY: 0.15   // subtle upward bias (candle-like)
    },

    /* ── Init ──────────────────────────────────────────── */

    init(containerW, containerH) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'atom-fluid-canvas';
        this.canvas.style.display = 'none';
        document.body.appendChild(this.canvas);

        this.canvas.width = containerW;
        this.canvas.height = containerH;

        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        };

        let gl = this.canvas.getContext("webgl2", params);
        this._isWebGL2 = !!gl;
        if (!this._isWebGL2) {
            gl = this.canvas.getContext("webgl", params) ||
                this.canvas.getContext("experimental-webgl", params);
        }
        if (!gl) { this._noGL = true; console.error("AtomFluidEngine: no WebGL"); return; }

        this.gl = gl;

        const halfFloat = gl.getExtension("OES_texture_half_float");
        let supportLinear = gl.getExtension("OES_texture_half_float_linear");
        if (this._isWebGL2) {
            gl.getExtension("EXT_color_buffer_float");
            supportLinear = gl.getExtension("OES_texture_float_linear");
        }
        this._supportLinear = supportLinear;

        const isWGL2 = this._isWebGL2;
        this._ext = {
            internalFormat: isWGL2 ? gl.RGBA16F : gl.RGBA,
            internalFormatRG: isWGL2 ? gl.RG16F : gl.RGBA,
            formatRG: isWGL2 ? gl.RG : gl.RGBA,
            texType: isWGL2 ? gl.HALF_FLOAT : (halfFloat ? halfFloat.HALF_FLOAT_OES : gl.FLOAT)
        };

        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        this._compileShaders();
        this._createPrograms();
        this._initBlit();
        this._initFramebuffers();
    },

    resize(w, h) {
        if (this._noGL) return;
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this._initFramebuffers();
    },

    /* ── Shaders ───────────────────────────────────────── */

    _compileShader(type, source) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("Shader:", gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    },

    _compileShaders() {
        const gl = this.gl;
        this._shaders = {};

        this._shaders.baseVertex = this._compileShader(gl.VERTEX_SHADER,
            `precision highp float; precision mediump sampler2D;
             attribute vec2 aPosition;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform vec2 texelSize;
             void main () {
                 vUv = aPosition * 0.5 + 0.5;
                 vL = vUv - vec2(texelSize.x, 0.0);
                 vR = vUv + vec2(texelSize.x, 0.0);
                 vT = vUv + vec2(0.0, texelSize.y);
                 vB = vUv - vec2(0.0, texelSize.y);
                 gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0);
             }`);

        this._shaders.clear = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uTexture; uniform float value;
             void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`);

        this._shaders.display = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uTexture;
             void main () {
                 vec4 c = texture2D(uTexture, vUv);
                 float a = length(c.rgb);
                 gl_FragColor = vec4(c.rgb, smoothstep(0.0, 0.05, a));
             }`);

        this._shaders.splat = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uTarget;
             uniform float aspectRatio; uniform vec3 color;
             uniform vec2 point; uniform float radius;
             void main () {
                 vec2 p = vUv - point.xy; p.x *= aspectRatio;
                 vec3 splat = exp(-dot(p, p) / radius) * color;
                 vec3 base = texture2D(uTarget, vUv).xyz;
                 gl_FragColor = vec4(base + splat, 1.0);
             }`);

        this._shaders.advectionManual = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uVelocity, uSource;
             uniform vec2 texelSize; uniform float dt, dissipation;
             vec4 bilerp(in sampler2D sam, in vec2 p) {
                 vec4 st; st.xy = floor(p - 0.5) + 0.5; st.zw = st.xy + 1.0;
                 vec4 uv = st * texelSize.xyxy;
                 vec4 a = texture2D(sam, uv.xy), b = texture2D(sam, uv.zy);
                 vec4 c = texture2D(sam, uv.xw), d = texture2D(sam, uv.zw);
                 vec2 f = p - st.xy;
                 return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
             }
             void main () {
                 vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;
                 gl_FragColor = dissipation * bilerp(uSource, coord);
                 gl_FragColor.a = 1.0;
             }`);

        this._shaders.advection = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uVelocity, uSource;
             uniform vec2 texelSize; uniform float dt, dissipation;
             void main () {
                 vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                 gl_FragColor = dissipation * texture2D(uSource, coord);
             }`);

        this._shaders.divergence = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity;
             vec2 sampleV(in vec2 uv) {
                 vec2 m = vec2(1.0);
                 if (uv.x < 0.0) { uv.x = 0.0; m.x = -1.0; }
                 if (uv.x > 1.0) { uv.x = 1.0; m.x = -1.0; }
                 if (uv.y < 0.0) { uv.y = 0.0; m.y = -1.0; }
                 if (uv.y > 1.0) { uv.y = 1.0; m.y = -1.0; }
                 return m * texture2D(uVelocity, uv).xy;
             }
             void main () {
                 float L = sampleV(vL).x, R = sampleV(vR).x;
                 float T = sampleV(vT).y, B = sampleV(vB).y;
                 gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
             }`);

        this._shaders.curl = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity;
             void main () {
                 float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
                 float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
                 gl_FragColor = vec4(R - L - T + B, 0.0, 0.0, 1.0);
             }`);

        this._shaders.vorticity = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
             void main () {
                 float L = texture2D(uCurl, vL).y, R = texture2D(uCurl, vR).y;
                 float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x;
                 float C = texture2D(uCurl, vUv).x;
                 vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
                 force *= 1.0 / length(force + 0.00001) * curl * C;
                 vec2 vel = texture2D(uVelocity, vUv).xy;
                 gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
             }`);

        this._shaders.pressure = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform sampler2D uPressure, uDivergence;
             vec2 bnd(in vec2 uv) { return min(max(uv, 0.0), 1.0); }
             void main () {
                 float L = texture2D(uPressure, bnd(vL)).x;
                 float R = texture2D(uPressure, bnd(vR)).x;
                 float T = texture2D(uPressure, bnd(vT)).x;
                 float B = texture2D(uPressure, bnd(vB)).x;
                 float div = texture2D(uDivergence, vUv).x;
                 gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
             }`);

        this._shaders.gradientSubtract = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform sampler2D uPressure, uVelocity;
             vec2 bnd(in vec2 uv) { return min(max(uv, 0.0), 1.0); }
             void main () {
                 float L = texture2D(uPressure, bnd(vL)).x;
                 float R = texture2D(uPressure, bnd(vR)).x;
                 float T = texture2D(uPressure, bnd(vT)).x;
                 float B = texture2D(uPressure, bnd(vB)).x;
                 vec2 vel = texture2D(uVelocity, vUv).xy;
                 vel -= vec2(R - L, T - B);
                 gl_FragColor = vec4(vel, 0.0, 1.0);
             }`);
    },

    _createGLProgram(vs, fs) {
        const gl = this.gl;
        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("Link:", gl.getProgramInfoLog(p)); return null;
        }
        const uniforms = {};
        const cnt = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < cnt; i++) {
            const nm = gl.getActiveUniform(p, i).name;
            uniforms[nm] = gl.getUniformLocation(p, nm);
        }
        return { program: p, uniforms, bind() { gl.useProgram(p); } };
    },

    _createPrograms() {
        const s = this._shaders;
        const advFS = this._supportLinear ? s.advection : s.advectionManual;
        this._programs = {
            clear: this._createGLProgram(s.baseVertex, s.clear),
            display: this._createGLProgram(s.baseVertex, s.display),
            splat: this._createGLProgram(s.baseVertex, s.splat),
            advection: this._createGLProgram(s.baseVertex, advFS),
            divergence: this._createGLProgram(s.baseVertex, s.divergence),
            curl: this._createGLProgram(s.baseVertex, s.curl),
            vorticity: this._createGLProgram(s.baseVertex, s.vorticity),
            pressure: this._createGLProgram(s.baseVertex, s.pressure),
            gradientSubtract: this._createGLProgram(s.baseVertex, s.gradientSubtract)
        };
    },

    _initBlit() {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
    },

    _blit(dest) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, dest);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
    },

    /* ── FBO Management ────────────────────────────────── */

    _createFBO(texId, w, h, intFmt, fmt, type, filter) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + texId);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, w, h, 0, fmt, type, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return [tex, fbo, texId];
    },

    _createDoubleFBO(texId, w, h, intFmt, fmt, type, filter) {
        let a = this._createFBO(texId, w, h, intFmt, fmt, type, filter);
        let b = this._createFBO(texId + 1, w, h, intFmt, fmt, type, filter);
        return {
            get first() { return a; }, get second() { return b; },
            swap() { const t = a; a = b; b = t; }
        };
    },

    _initFramebuffers() {
        const gl = this.gl, e = this._ext;
        const ds = this.config.TEXTURE_DOWNSAMPLE;
        this._texW = gl.drawingBufferWidth >> ds;
        this._texH = gl.drawingBufferHeight >> ds;
        const w = this._texW, h = this._texH;
        const filt = this._supportLinear ? gl.LINEAR : gl.NEAREST;
        this._density = this._createDoubleFBO(0, w, h, e.internalFormat, gl.RGBA, e.texType, filt);
        this._velocity = this._createDoubleFBO(2, w, h, e.internalFormatRG, e.formatRG, e.texType, filt);
        this._divergenceFBO = this._createFBO(4, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
        this._curlFBO = this._createFBO(5, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
        this._pressure = this._createDoubleFBO(6, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
    },

    /* ── Splat ──────────────────────────────────────────── */

    _splat(x, y, dx, dy, color, radius) {
        const gl = this.gl, c = this.canvas, p = this._programs.splat;
        p.bind();
        gl.uniform1i(p.uniforms.uTarget, this._velocity.first[2]);
        gl.uniform1f(p.uniforms.aspectRatio, c.width / c.height);
        gl.uniform2f(p.uniforms.point, x / c.width, y / c.height);
        gl.uniform3f(p.uniforms.color, dx, dy, 1.0);
        gl.uniform1f(p.uniforms.radius, radius);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        gl.uniform1i(p.uniforms.uTarget, this._density.first[2]);
        gl.uniform3f(p.uniforms.color, color[0], color[1], color[2]);
        this._blit(this._density.second[1]);
        this._density.swap();
    },

    /* ── HSL → RGB helper ──────────────────────────────── */

    _hslToRGB(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s /= 100; l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r = 0, g = 0, bl = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; bl = x; }
        else if (h < 240) { g = x; bl = c; }
        else if (h < 300) { r = x; bl = c; }
        else { r = c; bl = x; }
        return [r + m, g + m, bl + m];
    },

    /** Lerp between gradient stops, override S with signal params.saturation */
    _lerpGradientRGB(gradient, t, emitterColorOffset, paramSaturation) {
        const n = gradient.length - 1;
        const seg = Math.min(Math.floor(t * n), n - 1);
        const f = (t * n) - seg;
        const a = gradient[seg], b = gradient[seg + 1];
        const h = a.h + (b.h - a.h) * f + emitterColorOffset;
        // Use the signal's saturation param instead of gradient's hardcoded s
        const satClamped = Math.max(0, Math.min(100, paramSaturation));
        const l = a.l + (b.l - a.l) * f;
        return this._hslToRGB(h, satClamped, l);
    },

    /* ── Simple noise for wobble ────────────────────────── */

    _noise(t) {
        return Math.sin(t * 1.7) * 0.3 + Math.sin(t * 3.1) * 0.2 + Math.sin(t * 5.3) * 0.1;
    },

    /* ── Emit splats from all anchors ──────────────────── */

    _emitFromAnchors(anchors, dt) {
        anchors.forEach(anchor => {
            const p = anchor.params;
            // Speed scales emitter motion + injection force, NOT dt
            const speedScale = Math.max(0.05, p.speed * 0.25); // 4x slower overall motion

            // Advance emitter time by speed-scaled dt
            anchor._time += dt * speedScale;

            // Rebuild gradient if hue changed
            if (anchor._lastGradHue !== p.hue) {
                anchor._buildGradient();
                anchor._lastGradHue = p.hue;
            }

            // D: emissionRate controls splat count per frame
            const splatsPerFrame = p.emissionRate * dt;
            const wholeSplats = Math.floor(splatsPerFrame);
            const fractional = splatsPerFrame - wholeSplats;
            const totalSplats = Math.max(1, wholeSplats + (Math.random() < fractional ? 1 : 0));

            // C: radiusLimit clamp
            const rLimit = Math.max(5, p.radiusLimit);

            // G: brightness factor (0-100 → 0.0-2.0 multiplier)
            const brightnessFactor = (p.brightness / 100) * 2.0;

            anchor.microEmitters.forEach((em) => {
                for (let si = 0; si < totalSplats; si++) {
                    // C: clamp orbit radius to radiusLimit
                    const orbitR = Math.min(em.radius, rLimit);
                    const angle = em.omega * anchor._time + em.phase;
                    const emitterTime = anchor._time + em.noisePhase * 0.01;

                    // E: coherent noise jitter, clamped to radiusLimit
                    const jitterScale = Math.min(p.anchorJitter, rLimit);
                    const wobbleX = this._noise(emitterTime * 0.7 + em.noisePhase) * jitterScale;
                    const wobbleY = this._noise(emitterTime * 0.9 + em.noisePhase + 50) * jitterScale;

                    // Emitter position (clamped distance from anchor)
                    let offX = Math.cos(angle) * orbitR + wobbleX;
                    let offY = Math.sin(angle) * orbitR + wobbleY;
                    const dist = Math.sqrt(offX * offX + offY * offY);
                    if (dist > rLimit) {
                        const scale = rLimit / dist;
                        offX *= scale;
                        offY *= scale;
                    }
                    const ex = anchor.x + offX;
                    const ey = anchor.y + offY;

                    // B: gentle force — reduced ~10× (was 40-100, now 5-15)
                    const rDirX = Math.cos(angle);
                    const rDirY = Math.sin(angle);
                    const noiseX = this._noise(emitterTime * 1.3 + em.noisePhase * 2) * 0.3;
                    const noiseY = this._noise(emitterTime * 1.1 + em.noisePhase * 3) * 0.3;
                    const forceMag = 5 + (rLimit / 200) * 10; // gentle, scales slightly with radius
                    let dx = (rDirX * em.radialBias + noiseX) * forceMag * speedScale;
                    let dy = (rDirY * em.radialBias + noiseY) * forceMag * speedScale;

                    // Manual blob manipulation: emulate grabbing and twisting the cloud.
                    const manip = Math.max(0, Math.min(1, p.blobManipulation || 0));
                    if (manip > 0.0001) {
                        const handAngle = anchor._time * (0.8 + manip * 2.4) + em.phase * 0.5;
                        const handRadius = rLimit * (0.25 + manip * 0.65);
                        const handX = Math.cos(handAngle) * handRadius;
                        const handY = Math.sin(handAngle) * handRadius;
                        const toHandX = handX - offX;
                        const toHandY = handY - offY;
                        const toHandLen = Math.hypot(toHandX, toHandY) + 0.0001;
                        const handDirX = toHandX / toHandLen;
                        const handDirY = toHandY / toHandLen;
                        // Keep deformation effective regardless of signal speed.
                        const pullForce = (6 + rLimit * 0.08) * manip;
                        const twistForce = (4 + rLimit * 0.06) * manip;
                        dx += handDirX * pullForce - handDirY * twistForce;
                        dy += handDirY * pullForce + handDirX * twistForce;
                    }

                    // Gradient palette colour with per-emitter offset + signal saturation
                    const t = Math.random();
                    // D: constant per-splat intensity (not inversely scaled)
                    // G: brightness multiplies final RGB
                    const intensity = p.density * 0.15 * brightnessFactor;

                    let color;
                    if (anchor.color) {
                        // v16 Baseline: Use sampled color but keep depth with slight random variation for volumetric feel
                        const rVar = (Math.random() - 0.5) * 0.05;
                        const gVar = (Math.random() - 0.5) * 0.05;
                        const bVar = (Math.random() - 0.5) * 0.05;
                        color = [
                            (anchor.color.r + rVar) * intensity,
                            (anchor.color.g + gVar) * intensity,
                            (anchor.color.b + bVar) * intensity
                        ];
                    } else {
                        const rgb = this._lerpGradientRGB(anchor.colorGradient, t, em.colorOffset, p.saturation);
                        color = [rgb[0] * intensity, rgb[1] * intensity, rgb[2] * intensity];
                    }

                    this._splat(ex, ey, dx, dy, color, p.size);
                    anchor._splatCount++;
                    this._totalSplats++;
                }
            });
        });
    },

    /* ── Simulation Step ───────────────────────────────── */

    update(dt, anchors) {
        if (this._noGL || !anchors || anchors.length === 0) return;

        const gl = this.gl;
        // A: stable solver dt — NEVER multiply by speed
        const dSec = Math.max(0.001, Math.min(dt / 1000, 0.016));
        this._time += dSec;

        // Curl from first anchor or global default
        const avgCurl = anchors.length > 0 ? anchors[0].params.curlRadius : this.config.CURL;

        const tw = this._texW, th = this._texH;
        gl.viewport(0, 0, tw, th);

        // Advect velocity
        const advP = this._programs.advection;
        advP.bind();
        gl.uniform2f(advP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(advP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(advP.uniforms.uSource, this._velocity.first[2]);
        gl.uniform1f(advP.uniforms.dt, dSec);
        gl.uniform1f(advP.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        // Advect density
        gl.uniform1i(advP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(advP.uniforms.uSource, this._density.first[2]);
        gl.uniform1f(advP.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
        this._blit(this._density.second[1]);
        this._density.swap();

        // Emit from all anchors (using same stable dt)
        this._emitFromAnchors(anchors, dSec);

        // Curl
        const curlP = this._programs.curl;
        curlP.bind();
        gl.uniform2f(curlP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(curlP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._curlFBO[1]);

        // Vorticity
        const vortP = this._programs.vorticity;
        vortP.bind();
        gl.uniform2f(vortP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(vortP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(vortP.uniforms.uCurl, this._curlFBO[2]);
        gl.uniform1f(vortP.uniforms.curl, avgCurl);
        gl.uniform1f(vortP.uniforms.dt, dSec);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        // Divergence
        const divP = this._programs.divergence;
        divP.bind();
        gl.uniform2f(divP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(divP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._divergenceFBO[1]);

        // Pressure clear
        const clrP = this._programs.clear;
        clrP.bind();
        const pTex = this._pressure.first[2];
        gl.activeTexture(gl.TEXTURE0 + pTex);
        gl.bindTexture(gl.TEXTURE_2D, this._pressure.first[0]);
        gl.uniform1i(clrP.uniforms.uTexture, pTex);
        gl.uniform1f(clrP.uniforms.value, this.config.PRESSURE_DISSIPATION);
        this._blit(this._pressure.second[1]);
        this._pressure.swap();

        // Pressure solve
        const prP = this._programs.pressure;
        prP.bind();
        gl.uniform2f(prP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(prP.uniforms.uDivergence, this._divergenceFBO[2]);
        const prTex = this._pressure.first[2];
        gl.activeTexture(gl.TEXTURE0 + prTex);
        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this._pressure.first[0]);
            gl.uniform1i(prP.uniforms.uPressure, prTex);
            this._blit(this._pressure.second[1]);
            this._pressure.swap();
        }

        // Gradient subtract
        const gsP = this._programs.gradientSubtract;
        gsP.bind();
        gl.uniform2f(gsP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(gsP.uniforms.uPressure, this._pressure.first[2]);
        gl.uniform1i(gsP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();
    },

    /* ── Render density to canvas ──────────────────────── */

    render() {
        if (this._noGL) return;
        const gl = this.gl;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        const dp = this._programs.display;
        dp.bind();
        gl.uniform1i(dp.uniforms.uTexture, this._density.first[2]);
        this._blit(null);
    },

    getTotalSplats() { return this._totalSplats; }
};

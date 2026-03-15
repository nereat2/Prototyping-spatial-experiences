/**
 * BLOB FIELD ENGINE — Particle-based signal overlay
 * 
 * Replaces the global fluid simulation with anchored particle clouds.
 * Particles are swarming around anchors using GLSL-driven noise.
 * High performance WebGL Points approach.
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
            size: 4.0,              // point size (pixels)
            density: 1.2,           // particle alpha
            speed: 1.0,             // swarm animation speed
            radiusLimit: 60,        // swarm radius (px)
            curlRadius: 30,
            emissionRate: 5,
            growthWobble: 0.5,      // pulse/wobble without translation
            haloAmount: 0.4,
            haloDistance: 20,
            shapeX: 1.0,
            shapeY: 1.0,
            hue: Math.random() * 360,
            saturation: 70,
            brightness: 80,
            opacity: 1.0,
            blendMode: 'screen',
            particleCount: 1000,
            dataVisible: true,
            tracking: 1,            // 1=label follows blob, 0=label at fixed absolute position
            dataOffsetX: 20,
            dataOffsetY: 20,
            dataAbsX: 100,          // absolute label X (used when tracking=0)
            dataAbsY: 100,          // absolute label Y (used when tracking=0)
            deviceIdText: ''        // editable per-cloud ID text (empty = use generated)
        };

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

        // Compatibility emitters (unused by BlobFieldEngine but kept for state consistency)
        this.microEmitters = [];
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

    getParticleCount() { return 256; }
}

const BlobFieldEngine = {
    canvas: null,
    gl: null,
    _ready: false,
    _program: null,
    _vbo: null,
    _texW: 0,
    _texH: 0,
    _time: 0,
    _sprite: null,

    // Config
    MAX_ANCHORS: 16,
    PARTICLES_PER_ANCHOR: 5000, // Total ~80k points

    init(w, h) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'blob-field-canvas';
        this.canvas.style.display = 'none';
        document.body.appendChild(this.canvas);
        this.canvas.width = w;
        this.canvas.height = h;

        const params = {
            alpha: true, depth: false, stencil: false,
            antialias: true, preserveDrawingBuffer: true
        };
        const gl = this.canvas.getContext('webgl', params) ||
            this.canvas.getContext('experimental-webgl', params);
        if (!gl) { console.error("BlobFieldEngine: no WebGL"); return; }
        this.gl = gl;

        this._compileShaders();
        this._initBuffers();
        this._createSprite();

        gl.clearColor(0, 0, 0, 0);
        this._ready = true;
    },

    resize(w, h) {
        if (!this._ready) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this.gl.viewport(0, 0, w, h);
    },

    _compileShader(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("BlobShader:", gl.getShaderInfoLog(s)); return null;
        }
        return s;
    },

    _compileShaders() {
        const gl = this.gl;
        const vs = this._compileShader(gl.VERTEX_SHADER, `
            precision highp float;
            attribute vec2 aParticleData; // x: random seed, y: point index total
            
            uniform float uTime;
            uniform vec2 uResolution;
            uniform vec3 uAnchorPos[16];     // x, y (screen px), z (active flag)
            uniform vec4 uAnchorParams[16];  // x: size, y: density, z: radiusLimit, w: speed
            uniform float uAnchorCounts[16]; 
            uniform float uAnchorCurl[16];   
            uniform float uGrowthWobble[16]; 
            uniform float uShapeX[16];
            uniform float uShapeY[16];
            uniform float uHaloAmount[16];
            uniform float uHaloDistance[16];
            uniform float uBrightness[16];
            uniform float uSaturation[16];
            uniform vec3 uAnchorGradients[80]; 
            
            varying vec4 vColor;
            varying float vHaloAmount;
            varying float vHaloDistance;
            varying float vBrightness;
            varying float vSaturation;

            float hash(float n) { return fract(sin(n) * 43758.5453123); }

            void main() {
                float idxInCluster = mod(aParticleData.y, ${this.PARTICLES_PER_ANCHOR}.0);
                int id = int(aParticleData.y / ${this.PARTICLES_PER_ANCHOR}.0);
                
                if (uAnchorPos[id].z < 0.5 || idxInCluster >= uAnchorCounts[id]) {
                    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
                    return;
                }

                vec2 anchor = uAnchorPos[id].xy;
                float pSize = uAnchorParams[id].x;
                float density = uAnchorParams[id].y;
                float rLimit = uAnchorParams[id].z;
                float speed = uAnchorParams[id].w;
                float curl = uAnchorCurl[id];
                float wobble = uGrowthWobble[id];
                float sX = uShapeX[id];
                float sY = uShapeY[id];

                float t = uTime * speed;
                float seed = aParticleData.x;

                // Swarm Logic
                float angle = seed * 6.28 + t * (0.5 + curl * 0.02) * (hash(seed) * 2.0 - 1.0);
                float dist = sqrt(hash(seed + 1.0)) * rLimit;
                
                // Growth Wobble (scale the distance organically without translating anchor)
                dist *= (1.0 + sin(t * 3.0 + seed * 6.28) * 0.2 * wobble);

                vec2 offset = vec2(cos(angle), sin(angle)) * dist;
                offset += vec2(sin(t * 1.5 + seed * 10.0), cos(t * 1.3 + seed * 11.0)) * (rLimit * 0.1);
                
                // Anisotropic Shape scaling
                offset.x *= sX;
                offset.y *= sY;

                vec2 pos = (anchor + offset) / uResolution;
                pos = pos * 2.0 - 1.0;
                pos.y = -pos.y; 

                gl_Position = vec4(pos, 0.0, 1.0);
                
                // Scale point size to avoid clipping shape/halo
                gl_PointSize = pSize * max(sX, sY) * (1.0 + uHaloDistance[id] * 0.05);

                // Pass to fragment
                int stopIdx = id * 5 + int(mod(idxInCluster, 5.0));
                vColor = vec4(uAnchorGradients[stopIdx], density);
                vHaloAmount = uHaloAmount[id];
                vHaloDistance = uHaloDistance[id];
                vBrightness = uBrightness[id];
                vSaturation = uSaturation[id];
            }
        `);

        const fs = this._compileShader(gl.FRAGMENT_SHADER, `
            precision highp float;
            varying vec4 vColor;
            varying float vHaloAmount;
            varying float vHaloDistance;
            varying float vBrightness;
            varying float vSaturation;

            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float r = length(uv);

                // Procedural core
                float core = smoothstep(0.4, 0.1, r);

                // Procedural halo
                float haloStart = 0.4 + vHaloDistance * 0.005;
                float halo = smoothstep(haloStart + 0.1, haloStart, r) * vHaloAmount;

                // Color calibration
                vec3 rgb = vColor.rgb;
                float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                rgb = mix(vec3(luma), rgb, vSaturation);
                rgb *= vBrightness;

                float finalAlpha = (core + halo) * vColor.a;
                gl_FragColor = vec4(rgb, finalAlpha);
            }
        `);

        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs);
        gl.linkProgram(p);

        this._program = {
            program: p,
            aParticleData: gl.getAttribLocation(p, "aParticleData"),
            uTime: gl.getUniformLocation(p, "uTime"),
            uResolution: gl.getUniformLocation(p, "uResolution"),
            uAnchorPos: gl.getUniformLocation(p, "uAnchorPos"),
            uAnchorParams: gl.getUniformLocation(p, "uAnchorParams"),
            uAnchorCounts: gl.getUniformLocation(p, "uAnchorCounts"),
            uAnchorCurl: gl.getUniformLocation(p, "uAnchorCurl"),
            uGrowthWobble: gl.getUniformLocation(p, "uGrowthWobble"),
            uShapeX: gl.getUniformLocation(p, "uShapeX"),
            uShapeY: gl.getUniformLocation(p, "uShapeY"),
            uHaloAmount: gl.getUniformLocation(p, "uHaloAmount"),
            uHaloDistance: gl.getUniformLocation(p, "uHaloDistance"),
            uBrightness: gl.getUniformLocation(p, "uBrightness"),
            uSaturation: gl.getUniformLocation(p, "uSaturation"),
            uAnchorGradients: gl.getUniformLocation(p, "uAnchorGradients")
        };
    },

    _initBuffers() {
        const gl = this.gl;
        const count = this.MAX_ANCHORS * this.PARTICLES_PER_ANCHOR;
        const data = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            data[i * 2] = Math.random(); // seed
            data[i * 2 + 1] = i;        // index
        }
        this._vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    },

    _createSprite() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const gl = this.gl;
        this._sprite = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._sprite);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },

    update(dt, anchors) {
        if (!this._ready) return;
        this._time += dt * 0.001;
        this._anchors = anchors;
    },

    render() {
        if (!this._ready || !this._anchors) return;
        const gl = this.gl;
        const p = this._program;

        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(p.program);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        gl.uniform1f(p.uTime, this._time);
        gl.uniform2f(p.uResolution, this.canvas.width, this.canvas.height);

        const posArr = new Float32Array(this.MAX_ANCHORS * 3);
        const paramArr = new Float32Array(this.MAX_ANCHORS * 4);
        const countArr = new Float32Array(this.MAX_ANCHORS);
        const curlArr = new Float32Array(this.MAX_ANCHORS);
        const wobbleArr = new Float32Array(this.MAX_ANCHORS);
        const shapeXArr = new Float32Array(this.MAX_ANCHORS);
        const shapeYArr = new Float32Array(this.MAX_ANCHORS);
        const haloAmtArr = new Float32Array(this.MAX_ANCHORS);
        const haloDistArr = new Float32Array(this.MAX_ANCHORS);
        const brightArr = new Float32Array(this.MAX_ANCHORS);
        const satArr = new Float32Array(this.MAX_ANCHORS);
        const gradArr = new Float32Array(this.MAX_ANCHORS * 5 * 3);

        for (let i = 0; i < this.MAX_ANCHORS; i++) {
            if (i < this._anchors.length) {
                const a = this._anchors[i];

                if (a.dirty) {
                    a._buildGradient();
                    a.dirty = false;
                }

                posArr[i * 3] = a.x;
                posArr[i * 3 + 1] = a.y;
                posArr[i * 3 + 2] = 1.0;

                paramArr[i * 4] = a.params.size;
                paramArr[i * 4 + 1] = a.params.density;
                paramArr[i * 4 + 2] = a.params.radiusLimit;
                paramArr[i * 4 + 3] = a.params.speed;

                countArr[i] = a.params.particleCount || 1000;
                curlArr[i] = a.params.curlRadius || 30;
                wobbleArr[i] = a.params.growthWobble || 0;
                shapeXArr[i] = a.params.shapeX || 1.0;
                shapeYArr[i] = a.params.shapeY || 1.0;
                haloAmtArr[i] = a.params.haloAmount || 0;
                haloDistArr[i] = a.params.haloDistance || 0;
                brightArr[i] = (a.params.brightness / 80.0); // Normalize or scale relative to default 80
                satArr[i] = (a.params.saturation / 70.0);    // Normalize or scale relative to default 70

                const stops = a.colorGradient || [];
                for (let s = 0; s < 5; s++) {
                    const stop = stops[s] || { h: 0, s: 0, l: 0 };
                    const rgb = this._hslToRGB(stop.h, stop.s, stop.l);
                    gradArr[(i * 5 + s) * 3 + 0] = rgb[0];
                    gradArr[(i * 5 + s) * 3 + 1] = rgb[1];
                    gradArr[(i * 5 + s) * 3 + 2] = rgb[2];
                }
            } else {
                posArr[i * 3 + 2] = 0.0;
            }
        }

        gl.uniform3fv(p.uAnchorPos, posArr);
        gl.uniform4fv(p.uAnchorParams, paramArr);
        gl.uniform1fv(p.uAnchorCounts, countArr);
        gl.uniform1fv(p.uAnchorCurl, curlArr);
        gl.uniform1fv(p.uGrowthWobble, wobbleArr);
        gl.uniform1fv(p.uShapeX, shapeXArr);
        gl.uniform1fv(p.uShapeY, shapeYArr);
        gl.uniform1fv(p.uHaloAmount, haloAmtArr);
        gl.uniform1fv(p.uHaloDistance, haloDistArr);
        gl.uniform1fv(p.uBrightness, brightArr);
        gl.uniform1fv(p.uSaturation, satArr);
        gl.uniform3fv(p.uAnchorGradients, gradArr);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._sprite);
        gl.uniform1i(p.uSprite, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.enableVertexAttribArray(p.aParticleData);
        gl.vertexAttribPointer(p.aParticleData, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, this.MAX_ANCHORS * this.PARTICLES_PER_ANCHOR);
    },

    _hslToRGB(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s /= 100; l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return [r + m, g + m, b + m];
    }
};

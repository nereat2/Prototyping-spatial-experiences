/**
 * FLUID SIGNAL CLOUD — vNext WebGL Navier-Stokes Fluid Simulation
 *
 * Each FluidSignalCloud instance:
 * - Owns an offscreen WebGL canvas
 * - Runs a full Navier-Stokes sim (advection, curl, vorticity, pressure solve)
 * - Emits splats autonomously at its anchor position (no mouse interaction)
 * - Composites into the existing 2D layer pipeline via drawImage()
 *
 * Interface (matches prior GhostOrb/SmokeSignalCloud):
 *   .offscreen   — the canvas element to draw
 *   .x, .y       — anchor position on screen
 *   .params      — tunable parameters
 *   .data         — simulated device data
 *   .update(dt)
 *   .renderToCache()
 *   .getParticleCount()
 */

"use strict";

class FluidSignalCloud {
    constructor(x, y, id) {
        this.id = id;
        this.anchorX = x;
        this.anchorY = y;
        this.x = x;
        this.y = y;

        // Tunable parameters
        this.params = {
            // Fluid simulation
            TEXTURE_DOWNSAMPLE: 1,
            DENSITY_DISSIPATION: 0.98,
            VELOCITY_DISSIPATION: 0.99,
            PRESSURE_DISSIPATION: 0.8,
            PRESSURE_ITERATIONS: 25,
            CURL: 30,
            SPLAT_RADIUS: 0.005,

            // Emitter
            emissionRate: 3,        // splats per frame
            splatForce: 600,        // directional force magnitude
            anchorJitter: 30,       // px jitter around anchor
            intensity: 1.0,         // color brightness multiplier
            colorCycleRate: 0.3,    // hue rotation speed

            // Compositing
            opacity: 0.9,
            blendMode: 'screen',
            dataVisible: true,
            seed: Math.floor(Math.random() * 10000)
        };

        // Simulated device data
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

        // Internal state
        this._time = 0;
        this._colorPhase = Math.random() * Math.PI * 2;
        this._emitAngle = Math.random() * Math.PI * 2;
        this._splatCount = 0;
        this.dirty = true;

        // Create offscreen WebGL canvas
        this.offscreen = document.createElement('canvas');
        this.offscreen.width = 256;
        this.offscreen.height = 256;

        this._initWebGL();
    }

    /* ── WebGL Initialization ─────────────────────────── */

    _initWebGL() {
        const canvas = this.offscreen;
        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        };

        let gl = canvas.getContext("webgl2", params);
        let isWebGL2 = !!gl;
        if (!isWebGL2) {
            gl = canvas.getContext("webgl", params) ||
                canvas.getContext("experimental-webgl", params);
        }

        if (!gl) {
            console.error("FluidSignalCloud: WebGL not available");
            this._noGL = true;
            return;
        }

        this.gl = gl;
        this._isWebGL2 = isWebGL2;

        // Extensions
        const halfFloat = gl.getExtension("OES_texture_half_float");
        let supportLinear = gl.getExtension("OES_texture_half_float_linear");
        if (isWebGL2) {
            gl.getExtension("EXT_color_buffer_float");
            supportLinear = gl.getExtension("OES_texture_float_linear");
        }
        this._supportLinear = supportLinear;

        const internalFormat = isWebGL2 ? gl.RGBA16F : gl.RGBA;
        const internalFormatRG = isWebGL2 ? gl.RG16F : gl.RGBA;
        const formatRG = isWebGL2 ? gl.RG : gl.RGBA;
        const texType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat ? halfFloat.HALF_FLOAT_OES : gl.FLOAT);

        this._ext = { internalFormat, internalFormatRG, formatRG, texType };

        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        // Compile shaders
        this._compileShaders();

        // Create programs
        this._createPrograms();

        // Quad buffer
        this._initBlit();

        // Framebuffers
        this._initFramebuffers();
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error("Shader error:", gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }

    _compileShaders() {
        const gl = this.gl;

        this._shaders = {};

        this._shaders.baseVertex = this._compileShader(gl.VERTEX_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             attribute vec2 aPosition;
             varying vec2 vUv;
             varying vec2 vL;
             varying vec2 vR;
             varying vec2 vT;
             varying vec2 vB;
             uniform vec2 texelSize;
             void main () {
                 vUv = aPosition * 0.5 + 0.5;
                 vL = vUv - vec2(texelSize.x, 0.0);
                 vR = vUv + vec2(texelSize.x, 0.0);
                 vT = vUv + vec2(0.0, texelSize.y);
                 vB = vUv - vec2(0.0, texelSize.y);
                 gl_Position = vec4(aPosition, 0.0, 1.0);
             }`);

        this._shaders.clear = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             uniform sampler2D uTexture;
             uniform float value;
             void main () {
                 gl_FragColor = value * texture2D(uTexture, vUv);
             }`);

        this._shaders.display = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             uniform sampler2D uTexture;
             void main () {
                 vec4 c = texture2D(uTexture, vUv);
                 gl_FragColor = vec4(c.rgb, length(c.rgb) > 0.01 ? 1.0 : 0.0);
             }`);

        this._shaders.splat = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             uniform sampler2D uTarget;
             uniform float aspectRatio;
             uniform vec3 color;
             uniform vec2 point;
             uniform float radius;
             void main () {
                 vec2 p = vUv - point.xy;
                 p.x *= aspectRatio;
                 vec3 splat = exp(-dot(p, p) / radius) * color;
                 vec3 base = texture2D(uTarget, vUv).xyz;
                 gl_FragColor = vec4(base + splat, 1.0);
             }`);

        this._shaders.advectionManual = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             uniform sampler2D uVelocity;
             uniform sampler2D uSource;
             uniform vec2 texelSize;
             uniform float dt;
             uniform float dissipation;
             vec4 bilerp (in sampler2D sam, in vec2 p) {
                 vec4 st;
                 st.xy = floor(p - 0.5) + 0.5;
                 st.zw = st.xy + 1.0;
                 vec4 uv = st * texelSize.xyxy;
                 vec4 a = texture2D(sam, uv.xy);
                 vec4 b = texture2D(sam, uv.zy);
                 vec4 c = texture2D(sam, uv.xw);
                 vec4 d = texture2D(sam, uv.zw);
                 vec2 f = p - st.xy;
                 return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
             }
             void main () {
                 vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;
                 gl_FragColor = dissipation * bilerp(uSource, coord);
                 gl_FragColor.a = 1.0;
             }`);

        this._shaders.advection = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             uniform sampler2D uVelocity;
             uniform sampler2D uSource;
             uniform vec2 texelSize;
             uniform float dt;
             uniform float dissipation;
             void main () {
                 vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                 gl_FragColor = dissipation * texture2D(uSource, coord);
             }`);

        this._shaders.divergence = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             varying vec2 vL;
             varying vec2 vR;
             varying vec2 vT;
             varying vec2 vB;
             uniform sampler2D uVelocity;
             vec2 sampleVelocity (in vec2 uv) {
                 vec2 multiplier = vec2(1.0, 1.0);
                 if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }
                 if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }
                 if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }
                 if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }
                 return multiplier * texture2D(uVelocity, uv).xy;
             }
             void main () {
                 float L = sampleVelocity(vL).x;
                 float R = sampleVelocity(vR).x;
                 float T = sampleVelocity(vT).y;
                 float B = sampleVelocity(vB).y;
                 float div = 0.5 * (R - L + T - B);
                 gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
             }`);

        this._shaders.curl = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             varying vec2 vL;
             varying vec2 vR;
             varying vec2 vT;
             varying vec2 vB;
             uniform sampler2D uVelocity;
             void main () {
                 float L = texture2D(uVelocity, vL).y;
                 float R = texture2D(uVelocity, vR).y;
                 float T = texture2D(uVelocity, vT).x;
                 float B = texture2D(uVelocity, vB).x;
                 float vorticity = R - L - T + B;
                 gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0);
             }`);

        this._shaders.vorticity = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             varying vec2 vL;
             varying vec2 vR;
             varying vec2 vT;
             varying vec2 vB;
             uniform sampler2D uVelocity;
             uniform sampler2D uCurl;
             uniform float curl;
             uniform float dt;
             void main () {
                 float L = texture2D(uCurl, vL).y;
                 float R = texture2D(uCurl, vR).y;
                 float T = texture2D(uCurl, vT).x;
                 float B = texture2D(uCurl, vB).x;
                 float C = texture2D(uCurl, vUv).x;
                 vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
                 force *= 1.0 / length(force + 0.00001) * curl * C;
                 vec2 vel = texture2D(uVelocity, vUv).xy;
                 gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
             }`);

        this._shaders.pressure = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             varying vec2 vL;
             varying vec2 vR;
             varying vec2 vT;
             varying vec2 vB;
             uniform sampler2D uPressure;
             uniform sampler2D uDivergence;
             vec2 boundary (in vec2 uv) {
                 uv = min(max(uv, 0.0), 1.0);
                 return uv;
             }
             void main () {
                 float L = texture2D(uPressure, boundary(vL)).x;
                 float R = texture2D(uPressure, boundary(vR)).x;
                 float T = texture2D(uPressure, boundary(vT)).x;
                 float B = texture2D(uPressure, boundary(vB)).x;
                 float C = texture2D(uPressure, vUv).x;
                 float divergence = texture2D(uDivergence, vUv).x;
                 float pressure = (L + R + B + T - divergence) * 0.25;
                 gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
             }`);

        this._shaders.gradientSubtract = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float;
             precision mediump sampler2D;
             varying vec2 vUv;
             varying vec2 vL;
             varying vec2 vR;
             varying vec2 vT;
             varying vec2 vB;
             uniform sampler2D uPressure;
             uniform sampler2D uVelocity;
             vec2 boundary (in vec2 uv) {
                 uv = min(max(uv, 0.0), 1.0);
                 return uv;
             }
             void main () {
                 float L = texture2D(uPressure, boundary(vL)).x;
                 float R = texture2D(uPressure, boundary(vR)).x;
                 float T = texture2D(uPressure, boundary(vT)).x;
                 float B = texture2D(uPressure, boundary(vB)).x;
                 vec2 velocity = texture2D(uVelocity, vUv).xy;
                 velocity.xy -= vec2(R - L, T - B);
                 gl_FragColor = vec4(velocity, 0.0, 1.0);
             }`);
    }

    _createGLProgram(vertexShader, fragmentShader) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Program link error:", gl.getProgramInfoLog(program));
            return null;
        }
        const uniforms = {};
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const name = gl.getActiveUniform(program, i).name;
            uniforms[name] = gl.getUniformLocation(program, name);
        }
        return { program, uniforms, bind() { gl.useProgram(program); } };
    }

    _createPrograms() {
        const s = this._shaders;
        const advFragShader = this._supportLinear ? s.advection : s.advectionManual;

        this._programs = {
            clear: this._createGLProgram(s.baseVertex, s.clear),
            display: this._createGLProgram(s.baseVertex, s.display),
            splat: this._createGLProgram(s.baseVertex, s.splat),
            advection: this._createGLProgram(s.baseVertex, advFragShader),
            divergence: this._createGLProgram(s.baseVertex, s.divergence),
            curl: this._createGLProgram(s.baseVertex, s.curl),
            vorticity: this._createGLProgram(s.baseVertex, s.vorticity),
            pressure: this._createGLProgram(s.baseVertex, s.pressure),
            gradientSubtract: this._createGLProgram(s.baseVertex, s.gradientSubtract)
        };
    }

    _initBlit() {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
            new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
    }

    _blit(destination) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    /* ── Framebuffer Management ───────────────────────── */

    _createFBO(texId, w, h, internalFormat, format, type, param) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + texId);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        return [texture, fbo, texId];
    }

    _createDoubleFBO(texId, w, h, internalFormat, format, type, param) {
        let fbo1 = this._createFBO(texId, w, h, internalFormat, format, type, param);
        let fbo2 = this._createFBO(texId + 1, w, h, internalFormat, format, type, param);
        return {
            get first() { return fbo1; },
            get second() { return fbo2; },
            swap() { const tmp = fbo1; fbo1 = fbo2; fbo2 = tmp; }
        };
    }

    _initFramebuffers() {
        const gl = this.gl;
        const e = this._ext;
        const ds = this.params.TEXTURE_DOWNSAMPLE;

        this._texW = gl.drawingBufferWidth >> ds;
        this._texH = gl.drawingBufferHeight >> ds;
        const w = this._texW;
        const h = this._texH;
        const filterParam = this._supportLinear ? gl.LINEAR : gl.NEAREST;

        this._density = this._createDoubleFBO(0, w, h, e.internalFormat, gl.RGBA, e.texType, filterParam);
        this._velocity = this._createDoubleFBO(2, w, h, e.internalFormatRG, e.formatRG, e.texType, filterParam);
        this._divergenceFBO = this._createFBO(4, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
        this._curlFBO = this._createFBO(5, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
        this._pressure = this._createDoubleFBO(6, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
    }

    /* ── Splat ────────────────────────────────────────── */

    _splat(x, y, dx, dy, color) {
        const gl = this.gl;
        const canvas = this.offscreen;
        const p = this._programs.splat;

        p.bind();
        gl.uniform1i(p.uniforms.uTarget, this._velocity.first[2]);
        gl.uniform1f(p.uniforms.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(p.uniforms.point, x / canvas.width, 1.0 - y / canvas.height);
        gl.uniform3f(p.uniforms.color, dx, -dy, 1.0);
        gl.uniform1f(p.uniforms.radius, this.params.SPLAT_RADIUS);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        gl.uniform1i(p.uniforms.uTarget, this._density.first[2]);
        gl.uniform3f(p.uniforms.color, color[0] * 0.3, color[1] * 0.3, color[2] * 0.3);
        this._blit(this._density.second[1]);
        this._density.swap();
    }

    /* ── Autonomous Emission ──────────────────────────── */

    _emitSplats() {
        const rate = Math.max(1, Math.round(this.params.emissionRate));
        const canvas = this.offscreen;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        for (let i = 0; i < rate; i++) {
            // Position: center + jittered offset
            const jitter = this.params.anchorJitter;
            const px = cx + (Math.random() - 0.5) * jitter;
            const py = cy + (Math.random() - 0.5) * jitter;

            // Direction: smooth sweep + noise
            this._emitAngle += 0.03 + Math.random() * 0.02;
            const force = this.params.splatForce;
            const dx = Math.cos(this._emitAngle) * force * (0.5 + Math.random() * 0.5);
            const dy = Math.sin(this._emitAngle) * force * (0.5 + Math.random() * 0.5);

            // Color: cycling hue
            this._colorPhase += this.params.colorCycleRate * 0.01;
            const hue = this._colorPhase;
            const intensity = this.params.intensity;
            const color = [
                (Math.sin(hue) * 0.5 + 0.5) * intensity + 0.1,
                (Math.sin(hue + 2.094) * 0.5 + 0.5) * intensity + 0.1,
                (Math.sin(hue + 4.189) * 0.5 + 0.5) * intensity + 0.1
            ];

            this._splat(px, py, dx, dy, color);
            this._splatCount++;
        }
    }

    /* ── Simulation Step ──────────────────────────────── */

    update(dt) {
        if (this._noGL) return;

        const gl = this.gl;
        const dSec = Math.min(dt / 1000, 0.016);
        this._time += dSec;

        const tw = this._texW;
        const th = this._texH;

        gl.viewport(0, 0, tw, th);

        // Step 1: Advect velocity
        const advP = this._programs.advection;
        advP.bind();
        gl.uniform2f(advP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(advP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(advP.uniforms.uSource, this._velocity.first[2]);
        gl.uniform1f(advP.uniforms.dt, dSec);
        gl.uniform1f(advP.uniforms.dissipation, this.params.VELOCITY_DISSIPATION);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        // Step 2: Advect density
        gl.uniform1i(advP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(advP.uniforms.uSource, this._density.first[2]);
        gl.uniform1f(advP.uniforms.dissipation, this.params.DENSITY_DISSIPATION);
        this._blit(this._density.second[1]);
        this._density.swap();

        // Step 3: Autonomous emission
        this._emitSplats();

        // Step 4: Curl
        const curlP = this._programs.curl;
        curlP.bind();
        gl.uniform2f(curlP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(curlP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._curlFBO[1]);

        // Step 5: Vorticity confinement
        const vortP = this._programs.vorticity;
        vortP.bind();
        gl.uniform2f(vortP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(vortP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(vortP.uniforms.uCurl, this._curlFBO[2]);
        gl.uniform1f(vortP.uniforms.curl, this.params.CURL);
        gl.uniform1f(vortP.uniforms.dt, dSec);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        // Step 6: Divergence
        const divP = this._programs.divergence;
        divP.bind();
        gl.uniform2f(divP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(divP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._divergenceFBO[1]);

        // Step 7: Pressure clear
        const clrP = this._programs.clear;
        clrP.bind();
        const pTexId = this._pressure.first[2];
        gl.activeTexture(gl.TEXTURE0 + pTexId);
        gl.bindTexture(gl.TEXTURE_2D, this._pressure.first[0]);
        gl.uniform1i(clrP.uniforms.uTexture, pTexId);
        gl.uniform1f(clrP.uniforms.value, this.params.PRESSURE_DISSIPATION);
        this._blit(this._pressure.second[1]);
        this._pressure.swap();

        // Step 8: Pressure solve (Jacobi iterations)
        const prP = this._programs.pressure;
        prP.bind();
        gl.uniform2f(prP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(prP.uniforms.uDivergence, this._divergenceFBO[2]);
        const prTexId = this._pressure.first[2];
        gl.activeTexture(gl.TEXTURE0 + prTexId);
        for (let i = 0; i < this.params.PRESSURE_ITERATIONS; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this._pressure.first[0]);
            gl.uniform1i(prP.uniforms.uPressure, prTexId);
            this._blit(this._pressure.second[1]);
            this._pressure.swap();
        }

        // Step 9: Gradient subtraction
        const gsP = this._programs.gradientSubtract;
        gsP.bind();
        gl.uniform2f(gsP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(gsP.uniforms.uPressure, this._pressure.first[2]);
        gl.uniform1i(gsP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();
    }

    /* ── Render to Offscreen ──────────────────────────── */

    renderToCache() {
        if (this._noGL) return;

        const gl = this.gl;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        const dispP = this._programs.display;
        dispP.bind();
        gl.uniform1i(dispP.uniforms.uTexture, this._density.first[2]);
        this._blit(null); // Render to screen (the offscreen canvas)

        this.dirty = false;
    }

    getParticleCount() {
        return this._splatCount;
    }
}

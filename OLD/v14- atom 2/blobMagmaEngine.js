/**
 * BlobMagmaEngine - A Three.js based particle engine
 * Implements organic "magma" wobble and round procedural particles.
 */
class BlobMagmaEngine {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '5'; // Above deform pass

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.anchors = [];
        this.blobs = new Map(); // Map anchor.id -> THREE.Points
        this.time = 0;
        this._ready = false;
        this.MAX_PARTICLES = 5000;
    }

    init(w, h) {
        this.canvas.width = w;
        this.canvas.height = h;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setSize(w, h);

        this.scene = new THREE.Scene();
        // Orthographic camera for 2D coordinate mapping [0,w] [0,h]
        this.camera = new THREE.OrthographicCamera(0, w, h, 0, 0.1, 1000);
        this.camera.position.z = 10;

        this.circleTexture = this._createCircleTexture();
        this._ready = true;
    }

    resize(w, h) {
        if (!this._ready) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this.renderer.setSize(w, h);
        this.camera.right = w;
        this.camera.top = h;
        this.camera.updateProjectionMatrix();
    }

    _createCircleTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const center = size / 2;

        const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        return tex;
    }

    _createBlob(anchor) {
        // High particle count as requested (Task 4/6)
        const count = Math.min(anchor.params.particleCount || 1000, this.MAX_PARTICLES);
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            seeds[i] = Math.random();
            // Start at origin, offsets applied in shader
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(1, 1, 1) },
                uSprite: { value: this.circleTexture },
                uSize: { value: anchor.params.size || 4.0 },
                uDensity: { value: anchor.params.density || 1.0 },
                uRadiusLimit: { value: anchor.params.radiusLimit || 60 },
                uSpeed: { value: anchor.params.speed || 1.0 },
                uWobble: { value: anchor.params.growthWobble || 0 },
                uShape: { value: new THREE.Vector2(anchor.params.shapeX || 1, anchor.params.shapeY || 1) },
                uHalo: { value: new THREE.Vector2(anchor.params.haloAmount || 0, anchor.params.haloDistance || 0) },
                uSaturation: { value: (anchor.params.saturation || 70) / 70.0 },
                uBrightness: { value: (anchor.params.brightness || 80) / 80.0 },
                uOpacity: { value: anchor.params.opacity || 1.0 }
            },
            vertexShader: `
                uniform float uTime;
                uniform float uSize;
                uniform float uRadiusLimit;
                uniform float uSpeed;
                uniform float uWobble;
                uniform vec2 uShape;
                attribute float seed;
                varying float vSeed;
                
                float hash(float n) { return fract(sin(n) * 43758.5453123); }

                void main() {
                    vSeed = seed;
                    float t = uTime * uSpeed;
                    
                    // Magma Wobble Logic
                    float angle = seed * 6.28318 + t * (0.2 + hash(seed) * 0.4);
                    float dist = sqrt(hash(seed + 1.23)) * uRadiusLimit;
                    
                    // Expand/Contract wobble
                    dist *= (1.0 + sin(t * 2.1 + seed * 15.0) * 0.2 * uWobble);

                    vec3 pos = vec3(cos(angle), sin(angle), 0.0) * dist;
                    
                    // Turbulence (nervous magma feel)
                    pos.x += sin(t * 3.5 + seed * 30.0) * (uRadiusLimit * 0.1);
                    pos.y += cos(t * 3.2 + seed * 33.0) * (uRadiusLimit * 0.1);

                    // Anisotropic Shape
                    pos.x *= uShape.x;
                    pos.y *= uShape.y;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Responsive sizing
                    gl_PointSize = uSize * (1.0 + sin(t * 1.5 + seed * 10.0) * 0.2);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform sampler2D uSprite;
                uniform float uDensity;
                uniform float uOpacity;
                uniform vec2 uHalo; // x: amount, y: distance
                uniform float uSaturation;
                uniform float uBrightness;
                varying float vSeed;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float r = length(uv);
                    
                    // Round particle fix: sample sprite + discard low alpha
                    vec4 tex = texture2D(uSprite, gl_PointCoord);
                    if (tex.a < 0.1) discard;

                    // Procedural Halo logic
                    float core = smoothstep(0.4, 0.1, r);
                    float haloStart = 0.4 + uHalo.y * 0.005;
                    float halo = smoothstep(haloStart + 0.1, haloStart, r) * uHalo.x;
                    
                    float alpha = (core + halo) * uDensity * uOpacity * tex.a;

                    // Functional Brightness & Saturation
                    vec3 rgb = uColor;
                    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                    rgb = mix(vec3(luma), rgb, uSaturation);
                    rgb *= uBrightness;

                    gl_FragColor = vec4(rgb, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: false
        });

        const points = new THREE.Points(geometry, material);
        points.position.set(anchor.x, anchor.y, 0);
        this.scene.add(points);
        return points;
    }

    update(dt, anchors) {
        if (!this._ready) return;
        this.time += dt * 0.001;
        this.anchors = anchors;

        // Sync blobs with anchors
        const activeIds = new Set();
        anchors.forEach(a => {
            activeIds.add(a.id);
            let blob = this.blobs.get(a.id);
            if (!blob) {
                blob = this._createBlob(a);
                this.blobs.set(a.id, blob);
            }

            // Update position (centroid fixed at anchor)
            blob.position.set(a.x, a.y, 0);

            // Update color (sampled base color)
            if (a.baseColor) {
                blob.material.uniforms.uColor.value.setRGB(
                    a.baseColor.r / 255,
                    a.baseColor.g / 255,
                    a.baseColor.b / 255
                );
            }

            // Sync all uniforms
            const u = blob.material.uniforms;
            u.uTime.value = this.time;
            u.uSize.value = a.params.size;
            u.uDensity.value = a.params.density;
            u.uRadiusLimit.value = a.params.radiusLimit;
            u.uSpeed.value = a.params.speed;
            u.uWobble.value = a.params.growthWobble;
            u.uShape.value.set(a.params.shapeX, a.params.shapeY);
            u.uHalo.value.set(a.params.haloAmount, a.params.haloDistance);
            u.uSaturation.value = a.params.saturation / 70.0;
            u.uBrightness.value = a.params.brightness / 80.0;
            u.uOpacity.value = a.params.opacity;

            // Handle particle count change (rebuild if needed)
            if (blob.geometry.attributes.position.count !== Math.min(a.params.particleCount || 1000, this.MAX_PARTICLES)) {
                this.scene.remove(blob);
                this.blobs.delete(a.id);
            }
        });

        // Cleanup removed anchors
        for (let [id, blob] of this.blobs) {
            if (!activeIds.has(id)) {
                this.scene.remove(blob);
                this.blobs.delete(id);
            }
        }
    }

    render() {
        if (!this._ready) return;
        this.renderer.render(this.scene, this.camera);
    }
}

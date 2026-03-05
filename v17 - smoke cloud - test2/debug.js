/**
 * DEBUG MODE
 * On-screen HUD showing telemetry, perf counters, and smoke params.
 * Toggle via checkbox or D key. Does not appear in exports by default.
 */

const DebugMode = {
    enabled: false,
    includeInExport: false,

    // Perf tracking
    _fps: 60,
    _frameTimes: [],
    _lastFrameTime: 0,

    /** Toggle debug on/off */
    toggle() {
        this.enabled = !this.enabled;
        const cb = document.getElementById('debug-toggle');
        if (cb) cb.checked = this.enabled;
    },

    /** Track frame timing for FPS calculation */
    trackFrame(timestamp) {
        if (this._lastFrameTime > 0) {
            const dt = timestamp - this._lastFrameTime;
            this._frameTimes.push(dt);
            if (this._frameTimes.length > 30) this._frameTimes.shift();
            const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
            this._fps = Math.round(1000 / avg);
        }
        this._lastFrameTime = timestamp;
    },

    /** Get total particle count across all smoke clouds */
    getTotalParticles(signals) {
        let total = 0;
        signals.forEach(s => {
            if (s.getParticleCount) total += s.getParticleCount();
        });
        return total;
    },

    /** Render the debug HUD onto the given canvas context */
    renderHUD(ctx, canvas, signals) {
        if (!this.enabled) return;

        const ts = Telemetry.telemetryState;
        if (!ts) return;

        const lines = [];

        // Telemetry section
        lines.push('── TELEMETRY ──');
        lines.push(`Source: ${ts.source}`);
        lines.push(`WiFi Devices: ${ts.raw.wifiDeviceCount} (${ts.norm.wifiDeviceCount.toFixed(2)})`);
        lines.push(`WiFi RSSI: ${ts.raw.wifiMeanRssi.toFixed(1)} dBm (${ts.norm.wifiMeanRssi.toFixed(2)})`);
        lines.push(`RSSI Var: ${ts.raw.wifiRssiVariance.toFixed(1)} (${ts.norm.wifiRssiVariance.toFixed(2)})`);
        lines.push(`Ch Spread: ${ts.raw.wifiChannelSpread} (${ts.norm.wifiChannelSpread.toFixed(2)})`);
        lines.push(`Burst Rate: ${ts.raw.wifiBurstRate.toFixed(0)} (${ts.norm.wifiBurstRate.toFixed(2)})`);
        lines.push(`BTLE: ${ts.raw.btleCount}  BT: ${ts.raw.btClassicCount}`);
        lines.push(`Freeze: ${Telemetry.freeze ? '● ON' : '○ OFF'}  Jitter: ${Telemetry.jitter ? '● ON' : '○ OFF'}`);

        lines.push('');
        lines.push('── PERFORMANCE ──');
        lines.push(`FPS: ${this._fps}`);

        let totalP = 0;
        signals.forEach((s, i) => {
            const pc = s.getParticleCount ? s.getParticleCount() : 0;
            totalP += pc;
            lines.push(`Cloud ${i}: ${pc} particles`);
        });
        lines.push(`Total particles: ${totalP}`);

        if (signals.length > 0 && signals[0].params) {
            const bs = signals[0].params.bufferScale || 0.33;
            lines.push(`Buffer scale: ${bs.toFixed(2)}`);
        }
        lines.push(`Resolution: ${canvas.width}×${canvas.height}`);

        // Atom fluid params
        if (signals.length > 0) {
            const p = signals[0].params;
            lines.push('');
            lines.push('── ATOM FLUID ──');
            lines.push(`anchors: ${signals.length}`);
            lines.push(`curl: ${p.curlRadius}`);
            lines.push(`density: ${p.density.toFixed(2)}`);
            lines.push(`emission: ${p.emissionRate}`);
            lines.push(`speed: ${p.speed.toFixed(2)}`);
            lines.push(`hue: ${p.hue}  sat: ${p.saturation}  bri: ${p.brightness}`);
            lines.push(`total splats: ${AtomFluidEngine.getTotalSplats()}`);
        }

        // Draw HUD background
        const padding = 10;
        const lineH = 14;
        const hudW = 280;
        const hudH = lines.length * lineH + padding * 2;

        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.roundRect(padding, padding, hudW, hudH, 6);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#8fe88f';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            if (line.startsWith('──')) {
                ctx.fillStyle = '#66ccff';
            } else {
                ctx.fillStyle = '#c0e8c0';
            }
            ctx.fillText(line, padding + 8, padding + 6 + i * lineH);
        });

        ctx.restore();
    }
};

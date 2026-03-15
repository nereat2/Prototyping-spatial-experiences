/**
 * TELEMETRY MODULE
 * Parses WiFi/BT sensor dumps, computes derived metrics,
 * provides forced synthetic data when no real sensors are present.
 */

const Telemetry = {
    source: 'FORCED', // 'FORCED' | 'FILE' | 'LIVE'
    forcedMode: true,
    freeze: false,
    jitter: false,
    _seed: 42,
    _rng: null,
    _lastLogTime: 0,

    // Raw parsed values
    raw: {
        wifiDeviceCount: 0,
        wifiMeanRssi: -65,
        wifiRssiVariance: 0,
        wifiChannelSpread: 0,
        wifiBurstRate: 0,
        btleCount: 0,
        btClassicCount: 0,
        timestamp: 0
    },

    // Normalized [0..1] values
    normalized: {
        wifiDeviceCount: 0,
        wifiMeanRssi: 0,
        wifiRssiVariance: 0,
        wifiChannelSpread: 0,
        wifiBurstRate: 0,
        btleCount: 0,
        btClassicCount: 0
    },

    // Combined state exposed each frame
    telemetryState: null,

    init() {
        this._rng = this._createRng(this._seed);
        this._generateForced();
        this._updateState();
    },

    _createRng(seed) {
        return () => {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    },

    /** Generate plausible synthetic telemetry */
    _generateForced() {
        const r = this._rng;
        this.raw.wifiDeviceCount = Math.floor(5 + r() * 20);
        this.raw.wifiMeanRssi = -(30 + r() * 60); // -30 to -90 dBm
        this.raw.wifiRssiVariance = 2 + r() * 18;
        this.raw.wifiChannelSpread = Math.floor(1 + r() * 11);
        this.raw.wifiBurstRate = 10 + r() * 490;
        this.raw.btleCount = Math.floor(r() * 15);
        this.raw.btClassicCount = Math.floor(r() * 5);
        this.raw.timestamp = Date.now();
    },

    /** Ingest a telemetry payload (JSON shape from dump files) */
    ingest(payload) {
        try {
            // wifi_all_60s or wifi_aps_60s shape
            if (payload.wifi || payload.wifi_aps || payload.wifi_all) {
                const wifi = payload.wifi || payload.wifi_aps || payload.wifi_all;
                const devices = Array.isArray(wifi) ? wifi : (wifi.devices || wifi.entries || []);

                // Unique BSSIDs
                const bssids = new Set();
                const rssiValues = [];
                const channels = new Set();
                let frameCount = 0;

                devices.forEach(d => {
                    if (d.bssid || d.mac || d.BSSID) bssids.add(d.bssid || d.mac || d.BSSID);
                    const rssi = d.rssi || d.RSSI || d.signal || d.signalLevel;
                    if (rssi !== undefined) rssiValues.push(Number(rssi));
                    const ch = d.channel || d.frequency || d.Channel;
                    if (ch !== undefined) channels.add(ch);
                    if (d.frames || d.packets) frameCount += Number(d.frames || d.packets || 0);
                });

                this.raw.wifiDeviceCount = bssids.size || devices.length;

                if (rssiValues.length > 0) {
                    const mean = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;
                    this.raw.wifiMeanRssi = mean;
                    const variance = rssiValues.reduce((a, b) => a + (b - mean) ** 2, 0) / rssiValues.length;
                    this.raw.wifiRssiVariance = Math.sqrt(variance);
                }

                this.raw.wifiChannelSpread = channels.size;

                // Burst rate: frames / window (assume 60s window)
                const windowSec = payload.window || 60;
                this.raw.wifiBurstRate = frameCount / windowSec;
            }

            // btle_60s shape
            if (payload.btle || payload.ble) {
                const ble = payload.btle || payload.ble;
                const entries = Array.isArray(ble) ? ble : (ble.devices || ble.entries || []);
                this.raw.btleCount = entries.length;
            }

            // bt_classic_60s shape
            if (payload.bt_classic || payload.bluetooth) {
                const bt = payload.bt_classic || payload.bluetooth;
                const entries = Array.isArray(bt) ? bt : (bt.devices || bt.entries || []);
                this.raw.btClassicCount = entries.length;
            }

            if (payload.timestamp) this.raw.timestamp = payload.timestamp;

            this.forcedMode = false;
            this.source = 'FILE';
        } catch (err) {
            this._throttledLog('Telemetry parse error: ' + err.message);
        }

        this._normalize();
        this._updateState();
    },

    /** Normalize raw values to [0..1] */
    _normalize() {
        const n = this.normalized;
        const r = this.raw;
        n.wifiDeviceCount = Math.min(1, Math.max(0, r.wifiDeviceCount / 30));
        n.wifiMeanRssi = Math.min(1, Math.max(0, (r.wifiMeanRssi + 90) / 60)); // -90→0, -30→1
        n.wifiRssiVariance = Math.min(1, Math.max(0, r.wifiRssiVariance / 20));
        n.wifiChannelSpread = Math.min(1, Math.max(0, r.wifiChannelSpread / 12));
        n.wifiBurstRate = Math.min(1, Math.max(0, r.wifiBurstRate / 500));
        n.btleCount = Math.min(1, Math.max(0, r.btleCount / 20));
        n.btClassicCount = Math.min(1, Math.max(0, r.btClassicCount / 10));
    },

    _updateState() {
        this._normalize();
        this.telemetryState = {
            raw: { ...this.raw },
            norm: { ...this.normalized },
            source: this.source
        };
    },

    /** Called each frame; applies jitter if enabled */
    update() {
        if (this.freeze) return;

        const r = this._rng;

        // Jitter applies small random perturbations to whatever the current source is
        if (this.jitter) {
            this.raw.wifiMeanRssi += (r() - 0.5) * 8.0; // pronounce jitter
            this.raw.wifiRssiVariance = Math.max(1, this.raw.wifiRssiVariance + (r() - 0.5) * 4.0);
            this.raw.wifiBurstRate = Math.max(0, this.raw.wifiBurstRate + (r() - 0.5) * 80.0);
            this.raw.wifiChannelSpread = Math.max(1, Math.min(13, this.raw.wifiChannelSpread + (r() < 0.1 ? (r() < 0.5 ? -1 : 1) : 0)));
        }

        if (this.forcedMode) {
            // Slowly drift forced values for base visual interest (if not jittering, or on top of jitter)
            if (r() < 0.015) {
                this.raw.wifiDeviceCount = Math.max(1, Math.min(30, this.raw.wifiDeviceCount + Math.floor((r() - 0.5) * 4)));
                this.raw.wifiMeanRssi = Math.max(-90, Math.min(-30, this.raw.wifiMeanRssi + (r() - 0.5) * 4));
                this.raw.wifiBurstRate = Math.max(5, Math.min(500, this.raw.wifiBurstRate + (r() - 0.5) * 20));
            }
        }

        this._updateState();
    },

    /** Load from file input */
    loadFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                this.ingest(json);
            } catch (err) {
                this._throttledLog('Failed to parse telemetry file: ' + err.message);
            }
        };
        reader.readAsText(file);
    },

    _throttledLog(msg) {
        const now = Date.now();
        if (now - this._lastLogTime > 1000) {
            console.warn('[Telemetry]', msg);
            this._lastLogTime = now;
        }
    }
};

# Glitch Effect Implementation — v18.2 Baseline

## Summary

Successfully ported a localized, horizontal-band glitch effect into the v18.2 smoke cloud system. The glitch is:

- **Per-signal**: Each blob can have independent glitch intensity
- **Locally bounded**: Only applied within a region around each signal anchor
- **Masked by silhouette**: Constrained to the actual blob alpha from AtomFluidEngine
- **Horizontal phase-shift**: Technological tearing effect, NOT circular or spinning
- **Renderer-level overlay**: Non-destructive, applied after the signal layer is composited

---

## Changes Made

### 1. atomFluid.js — SignalAnchor Parameters

**Location**: Lines 25–47 (constructor params object)

**Added**:
```javascript
glitchAmount: 0.0,      // 0..1 glitch intensity on blob surface
glitchOpacity: 1.0      // 0..1 glitch overlay opacity
```

- Conservative defaults (0.0 / 1.0) ensure no glitch visible until explicitly enabled
- Both parameters are per-signal, allowing independent control

---

### 2. app.js — UI Sliders in renderParamsPanel()

**Location**: Lines 1368–1369 (range configuration for sliders)

**Added**:
```javascript
if (key === 'glitchAmount') { min = 0; max = 1; step = 0.01; }
if (key === 'glitchOpacity') { min = 0; max = 1; step = 0.01; }
```

- Minimal UI additions
- Sliders appear automatically when a signal is selected in the params panel
- Fine-grained control (0.01 step resolution)

---

### 3. app.js — Renderer Initialization

**Location**: Lines 696–718 (Renderer.init)

**Added**:
```javascript
_glitchCanvas: null,
_glitchCtx: null,
```

**In init()**:
```javascript
// Create glitch canvas
this._glitchCanvas = document.createElement('canvas');
this._glitchCanvas.style.display = 'none';
document.body.appendChild(this._glitchCanvas);
this._glitchCtx = this._glitchCanvas.getContext('2d', { willReadFrequently: true });
```

- Offscreen canvas for local glitch rendering
- Dynamically resized per signal to match local bounding box
- `willReadFrequently: true` optimizes for `getImageData` calls

---

### 4. app.js — Glitch Overlay Method

**Location**: Lines 875–971 (new method: `drawSignalGlitchOverlay`)

**Behavior**:

1. **Per-signal iteration**: Loops through all active signals
2. **Early exit**: Returns if `glitchAmount ≤ 0` or `glitchOpacity ≤ 0`
3. **Local bounding box**: Creates a work region ~2.2× the signal's `radiusLimit`
4. **Blob extraction**: Copies the local region from AtomFluidEngine.canvas
5. **Horizontal band glitch**:
   - Divides the local area into horizontal bands (~8% of local height each)
   - Each band is offset horizontally by a smooth, time-varying amount
   - Offset calculation: `sin(bandPhase * π*2) * 0.5 + noise * 0.3`
   - Maximum shift scales with `glitchAmount` (up to 12px)
6. **Subtle fringing** (when `glitchAmount > 0.3`):
   - Optional RGB phase-slip duplication at ±1.5px
   - Adds technological color-separation artifact
7. **Silhouette masking**:
   - `globalCompositeOperation = 'destination-in'` with original blob alpha
   - Ensures glitch stays within the actual smoke boundary
8. **Compositing**:
   - Overlays result back onto main canvas at `globalAlpha = glitchOpacity * glitchAmount`
   - Uses `'overlay'` blend mode for subtle integration

---

### 5. app.js — Render Loop Integration

**Location**: Lines 862 (Renderer.render method)

**Added**:
```javascript
// Draw per-signal glitch overlay
this.drawSignalGlitchOverlay(ctx, canvas, timestamp);
```

**Placement**: After all layers are drawn (signal + data), before status bar and debug HUD.

---

## Design Principles

### What Was Preserved (NOT Modified)

✅ Navier-Stokes advection, curl, pressure solvers  
✅ Smoke density and velocity field dynamics  
✅ Color sampling from image pixels  
✅ Image deformation pass (gravitational indentation)  
✅ Signal layer blending logic (embedded/screen/add/etc.)  
✅ Current compositing pipeline  

### What Was Ported

✅ Per-signal glitch parameters  
✅ Local offscreen canvas for glitch rendering  
✅ Horizontal band displacement algorithm  
✅ Blob silhouette masking (destination-in)  
✅ Time-based phase variation (smooth + noise)  

### What Was Deliberately Avoided

❌ No circular or vortex-like deformation  
❌ No spinning wheel aesthetic  
❌ No full-screen scanlines  
❌ No square artifacts outside blob bounds  
❌ No rewrite of fluid solver shaders  

---

## Behavior Specification

### At glitchAmount = 0.0
- No visible glitch effect
- Only blob smoke is rendered normally

### At glitchAmount = 0.0 ~ 0.3
- Subtle horizontal band displacement
- Very faint internal duplication
- Blinks softly with time
- Effect confined to blob edges

### At glitchAmount = 0.5 ~ 1.0
- Strong horizontal tearing across blob surface
- Visible phase-shift color fringing
- Continuous wave-like motion
- Glitch occupies most of blob interior
- Intensity controlled by `glitchOpacity` (can be dimmed further)

---

## Technical Notes

1. **Band height**: Calculated as `max(2, floor(localHeight * 0.08))` to adapt to blob size
2. **Time phase**: `(timestamp * 0.001) % 1.0` provides smooth, repeating cycles
3. **PRNG**: Seeded with `signal.id.charCodeAt(0)` ensures consistent glitch per signal
4. **Offset calculation**:
   - Smooth sine wave: `sin(bandPhase * π*2) * 0.5 + 0.5`
   - Noise variation: `rng() * 0.3 - 0.15`
   - Range: `[-maxShift/2, +maxShift/2]`
5. **Silhouette masking**: Uses the same `AtomFluidEngine.canvas` alpha that defines the blob boundary
6. **Composite mode**: `'overlay'` blend mode creates technological feel without oversaturation

---

## Testing Checklist

- [x] glitchAmount = 0: no effect visible
- [x] glitchAmount = 0.01–0.3: subtle banding
- [x] glitchAmount = 0.3–1.0: strong tearing effect
- [x] glitchOpacity control: dims/brightens overlay
- [x] Per-signal control: each blob can have different glitch
- [x] Glitch confined to blob: no square or full-screen artifacts
- [x] Smoke dynamics unchanged: v18.2 fluid behavior preserved
- [x] Horizontal effect: NO circular/spinning deformation
- [x] Blending: smooth integration with existing layers

---

## Files Modified

1. **atomFluid.js**: Added `glitchAmount` and `glitchOpacity` to `SignalAnchor.params`
2. **app.js**: 
   - Added `_glitchCanvas` and `_glitchCtx` to Renderer
   - Extended `Renderer.init()` to create glitch canvas
   - Added UI sliders in `renderParamsPanel()`
   - Implemented `drawSignalGlitchOverlay()` method
   - Integrated glitch call into `Renderer.render()`

---

## No Breaking Changes

- All existing functionality remains intact
- v18.2 smoke system works exactly as before
- Glitch is purely additive (enabled only when params > 0)
- Backward compatible with saved scenes/states (defaults to 0)

# Veo Small Text Watermark Support Design

Date: 2026-06-15

## Goal

Add first-class support for the new small `Veo` text watermark seen in Google Flow / Veo video outputs, following the observed Allenk `VeoWatermarkRemover v0.6.3-demo` behavior as closely as practical inside this project.

The target sample for the first implementation pass is:

- `src/assets/video-samples/veo-20260615.mp4`
- Metadata: `720x1280`, `24fps`, `8s`, `192` frames, audio present

## Evidence

Allenk public source state:

- `allenk/GeminiWatermarkTool` is open source and currently contains the image pipeline.
- `allenk/VeoWatermarkRemover` v0.6.3 public tree contains README/artwork only, but its release binary contains embedded resources and exposes video CLI behavior.
- `GeminiWatermarkTool-Video --help` exposes `--mark {auto,diamond,veo}` and `--veo-alpha`.

Allenk v0.6.3 binary observations on the target sample:

- `--mark veo` logs:
  - `Veo text: region (682,1254) 23x10 (mean NCC 0.81)`
  - `Veo text: seed scale x1.256`
  - `NcnnDenoiser: sigma=20, strength=100%, roi=86x74, 230 edge pixels`
  - output summary: `Veo-text 23x10 192/192 frames x1.26 +audio +AI`
- `--mark auto` currently locks a weak diamond candidate on this sample:
  - `Auto watermark type: Gemini diamond`
  - `smart-search relocated 720-class -> (360,716) 37x37 (NCC 0.48)`

Extracted Allenk embedded PNG templates:

- `23x10` small `Veo` text template, matching the target sample.
- `68x30` `Veo` text template.
- `99x43` `Veo` text template.

These templates are grayscale alpha-like profiles and must be treated as separate from the Gemini diamond alpha profiles.

## Product Behavior

The video pipeline should support three watermark kinds:

- `diamond`: existing Gemini diamond video watermark path.
- `veo-text`: new small `Veo` text path.
- `unknown`: no safe processing.

Default behavior should detect both diamond and `veo-text`. A high-confidence `veo-text` match should be allowed to beat a weak diamond match, because Allenk auto currently misclassifies the target sample as diamond while forced `--mark veo` succeeds.

No user-facing mode switch is required in the first pass, but internal debug/report output should include the selected `watermarkKind`, template id, region, NCC score, and seed scale.

## Architecture

### Template Assets

Add a dedicated Veo text alpha/template module, separate from `embeddedAlphaMaps`.

Initial profiles:

- `veo-text-23x10`
- `veo-text-68x30`
- `veo-text-99x43`

Each profile stores:

- width
- height
- normalized alpha map
- recommended search geometry
- recommended cleanup options

The extracted Allenk templates can seed these assets, but the runtime API should not depend on Allenk file paths under `.artifacts`.

### Detection

Add a `detectVeoTextWatermarkFromFrames()` path.

Detection inputs:

- sampled frames
- video width/height
- candidate templates

Detection steps:

1. Search only a bottom-right window.
2. For each template, run normalized cross-correlation against luma or low-saturation bright evidence.
3. Aggregate across sampled frames and require cross-frame agreement.
4. Return the best candidate with:
   - `watermarkKind: 'veo-text'`
   - region `{ x, y, width, height }`
   - template id
   - mean/max NCC
   - frame votes
   - confidence

For `720x1280`, the expected first-pass match is:

- template `veo-text-23x10`
- region `(682,1254) 23x10`
- mean NCC near `0.81`

### Selection Policy

Add a video watermark selection layer that compares diamond and `veo-text` detections.

Recommended policy:

- If `veo-text` confidence is strong, select `veo-text`.
- If diamond confidence is strong and `veo-text` is weak/absent, select diamond.
- If both are weak, fail closed.
- If diamond is moderate but `veo-text` is high, select `veo-text`.

For the target sample, this should select `veo-text`, not the weak diamond candidate.

### Removal

Add a Veo text removal processor:

1. Estimate a per-shot seed scale from sampled frames.
2. Apply reverse alpha blending using the selected Veo text alpha template.
3. Use a conservative per-frame refinement hook, initially bounded around the per-shot seed.
4. Run local residual cleanup/FDnCNN-style backend over a padded ROI.

Initial Allenk-aligned cleanup defaults:

- sigma: `20`
- strength: `100%`
- ROI around the `23x10` text roughly `86x74`
- edge/active pixels derived from the text alpha map, expected around `230` for the target sample

The implementation should reuse the existing video cleanup backend boundaries where possible, but must not reuse the Gemini diamond alpha map for Veo text.

### Reports And Artifacts

Extend or add reports for:

- candidate detection summary
- before/after crop sheet
- selected watermark kind
- template id and region
- per-frame score distribution
- seed scale
- cleanup options

The existing `score:video-candidates` script can be extended or complemented by a Veo text specific scorer.

## Testing

Add focused tests for:

- Veo text template loading and dimensions.
- `720x1280` target sample detection prefers `veo-text-23x10`.
- Selection policy chooses high-confidence `veo-text` over weak diamond.
- Existing diamond catalog tests continue to pass.
- CLI/script entrypoint coverage for any new analysis script.

Verification commands should use `pnpm`:

- `pnpm exec node --test tests/video/videoWatermarkCatalog.test.js tests/video/videoWatermarkDetector.test.js`
- Any new Veo text detector tests.
- A targeted scorer run against `src/assets/video-samples/veo-20260615.mp4`.

## Constraints

- Do not start local dev servers from Codex.
- Do not overwrite user worktree changes.
- Keep the first implementation evidence-gated to the target sample and extracted template profiles.
- Fail closed when detection is ambiguous.
- Avoid claiming full parity with Allenk until before/after crop evidence and residual metrics support it.

## Open Implementation Notes

- The Allenk release binary proves the templates and runtime behavior, but not the exact C++ implementation.
- The first implementation should be transparent and reproducible: NCC + reverse alpha + bounded cleanup.
- A future `Alpha Judge`-style model can be added behind an `intensityEstimator` interface after enough training/evaluation data exists.

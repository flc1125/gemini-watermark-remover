# Bound Gemini Preview Fetch Fallback Design

## Context

On a real Gemini page, a cold refresh can leave the generated-image replacement in `data-gwr-page-image-state=failed` even though the userscript initializes successfully and the image remains visible.

The failure is reproducible with an explicitly bound Gemini display-preview URL under `/gg/`:

- the image element resolves to a renderable `blob:https://gemini.google.com/...` source;
- `dataset.gwrSourceUrl` contains the matching `/gg/...=s0` URL remembered from Gemini history data;
- `shouldTreatPageImageSourceAsPreview` classifies the matching explicit binding as original-quality work;
- `processOriginalPageImageSource` attempts a background fetch;
- the current real `/gg/` resource returns HTTP 403;
- the error bypasses the existing preview candidate fallback and marks the element failed.

The same failed-state DOM image was verified to support a successful Canvas capture at its natural `1408x768` resolution. Copy and native full-size download remain functional and recover the preview after a usable `rd-gg` binding becomes available.

## Goal

Allow an explicitly bound Gemini display-preview URL to recover through the existing preview processing candidates when its preferred original-quality fetch fails.

## Non-Goals

- Do not change watermark detection, alpha selection, or removal algorithms.
- Do not add retries for HTTP 403 responses.
- Do not weaken copy or download fail-closed behavior.
- Do not change successful `rd-gg`, `rd-gg-dl`, or successful explicitly bound `/gg/` processing.
- Do not refactor the page image replacement controller or session store.
- Do not modify unrelated release artifacts already present in the worktree.

## Considered Approaches

### 1. Fall back inside `processPageImageSource` for bound display previews

Keep the original-quality attempt for every Gemini display-preview URL. If that attempt fails, use the existing `processPreviewPageImageSource` candidate sequence, which tries page fetch and then rendered Canvas capture.

This is the selected approach because it is scoped to page display processing, preserves the successful bound-source path, and reuses existing diagnostics and skip behavior.

### 2. Add generic fetch-error fallback to `acquireOriginalBlob`

Catch background-fetch errors in the lower-level blob acquisition helper and capture the rendered element. This is broader than required and obscures the distinction between an original asset and a display-preview fallback.

### 3. Retry the `/gg/` request

Retrying does not repair an unavailable or unauthorized history URL and would delay the user-visible preview. The real failure remained stable while the rendered image was already usable.

## Design

`processPageImageSource` will treat every Gemini display-preview asset URL as eligible for the existing two-stage display flow:

1. Prefer `processOriginalPageImageSource` with `preferRenderedCaptureForPreview: false` and aspect-ratio validation.
2. Return immediately when original-quality acquisition and removal succeed.
3. If the original-quality attempt throws, call `processPreviewPageImageSource`.
4. The preview processor tries its existing candidates in order:
   - page-bridge fetch;
   - rendered Canvas capture.
5. If neither candidate is usable, retain the existing `preview-fetch-unavailable` skipped result rather than introducing a new error contract.

The explicit binding still controls session classification and successful-path behavior. The change only extends failure recovery for URLs already recognized by `isGeminiDisplayPreviewAssetUrl`.

Copy and download hooks do not call this display fallback and remain unchanged.

## Regression Tests

Add a focused test to `tests/shared/pageImageReplacement.test.js` with an explicitly bound `/gg/` source where:

- background/original-quality fetch throws `Failed to fetch image: 403`;
- page-bridge preview fetch also fails;
- rendered capture returns a usable preview blob;
- preview processing returns a processed blob.

The test must fail before implementation because the 403 currently escapes. After the fix it must assert:

- the original-quality attempt occurs first;
- preview candidates run only after that failure;
- rendered capture is selected after page fetch fails;
- the processed blob is returned;
- full-strength removal is not called on the rendered preview.

Keep the existing test proving that a successful explicitly bound `/gg/` fetch still uses original-quality removal.

## Verification

1. Run the new focused test and confirm the expected red failure.
2. Apply the minimal branch change and confirm the focused test turns green.
3. Run all shared page-image replacement and original-blob tests.
4. Run the broader repository test and build commands appropriate to the changed userscript surface.
5. Rebuild and reinstall the userscript in the fixed Chrome profile.
6. Cold-refresh the real Gemini page without copy or download interaction.
7. Confirm the image reaches `data-gwr-page-image-state=ready`, the processed object URL is present, and no terminal `Failed to fetch image: 403` event remains.
8. Recheck copy and native full-size download, including the confirmed `2816x1536` issue #111 path.

## Acceptance Criteria

- A cold-refresh `/gg/` 403 no longer leaves the preview in `failed` state when rendered capture is available.
- Original-quality processing remains preferred and unchanged when the bound `/gg/` request succeeds.
- The fallback uses existing preview candidate diagnostics and processing behavior.
- Copy and download behavior remain unchanged.
- No core watermark algorithm files are modified.
- No unrelated tracked files are changed.

## Risks and Mitigations

- **Risk:** a bound `/gg/` source could silently use lower-resolution rendered pixels.
  - **Mitigation:** original-quality acquisition remains first; rendered capture is used only after failure and only for page display.
- **Risk:** fallback could hide a useful failure signal.
  - **Mitigation:** existing candidate diagnostics retain the failed page-fetch evidence and selected rendered-capture strategy.
- **Risk:** session classification could change and affect copy/download bindings.
  - **Mitigation:** keep `shouldTreatPageImageSourceAsPreview` and preparation/session classification unchanged; alter only processing fallback control flow.

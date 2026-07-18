# Clipboard Fallback Resource Slot Isolation Design

## Context

On the real Gemini page, `复制图片` and `下载完整尺寸的图片` can run in the same image session. A clean-page trace established two different source qualities:

- Gemini writes a processed `image/png` clipboard payload at `1408x768`;
- the native full-size download chain (`c8o8Fe` followed by `rd-gg`) produces `2816x1536`.

The clipboard hook correctly processes the clipboard payload when no reusable processed resource is available. However, both the clipboard hook and the download hook currently report their resolved blobs to the same `handleProcessedBlobResolved` callback in `src/userscript/index.js`. That callback always stores the result in the session's `full` slot.

After a copy action, the `1408x768` clipboard fallback therefore occupies the `full` slot. A later download action sees that processed resource as reusable, skips Gemini's native full-size request chain, and returns the cached `1408x768` blob instead of the real `2816x1536` image.

## Goal

Keep a clipboard fallback result available for preview-quality reuse without allowing it to masquerade as a full-size download resource.

## Non-Goals

- Do not force Gemini's copy action to fetch or write a full-size image.
- Do not change the clipboard payload format or copy success behavior.
- Do not change Gemini's native download click handling, intent gate, sticky window, or request interception.
- Do not add dimension heuristics or infer full quality from particular image sizes.
- Do not change watermark detection or removal algorithms.
- Do not refactor the image session store.
- Do not modify unrelated release artifacts already present in the worktree.

## Considered Approaches

### 1. Store clipboard fallback results in the preview slot

Introduce a clipboard-specific resolved-blob callback in `src/userscript/index.js`. It stores the fallback result with `slot: 'preview'` and `processedFrom: 'clipboard-fallback'`. Keep the existing callback for download results so they continue to populate `slot: 'full'`.

This is the selected approach because the producer knows the resource provenance, the session store already models preview and full quality separately, and no consumer needs special-case rejection logic.

### 2. Reject clipboard-origin resources in the download reuse path

Teach the download hook to reject a full-slot resource whose `processedFrom` value identifies clipboard processing. This would prevent the observed reuse, but it leaves incorrectly classified data in the session and requires every future full-quality consumer to remember the exception.

### 3. Gate full-slot storage by dimensions

Compare the clipboard blob dimensions with known catalog sizes or another session resource before choosing a slot. This is unnecessarily complex and brittle because valid Gemini aspect ratios and output sizes evolve, and dimension equality alone does not prove original quality.

## Design

`src/userscript/index.js` will expose two internal callback responsibilities:

1. The existing download resolved-blob callback continues to call `storeProcessedBlobResolved` with `slot: 'full'` and download provenance.
2. A new clipboard fallback resolved-blob callback calls `storeProcessedBlobResolved` with:
   - `slot: 'preview'`;
   - `processedFrom: 'clipboard-fallback'`.
3. `installGeminiDownloadHook` remains wired to the full-resource callback.
4. `installGeminiClipboardImageHook` is rewired to the clipboard fallback callback.

No clipboard-hook API change is needed. Its `onProcessedBlobResolved` notification occurs only when fallback processing has produced a clipboard blob. Existing paths that reuse an already-known full resource do not need to store that resource again.

The session store's normal full-quality selection remains unchanged. Because the clipboard fallback no longer occupies or overwrites the full slot, a later download cannot reuse it as a full processed resource and must continue into Gemini's native request flow. If the session already contains a genuine full resource, recording a later clipboard fallback in the preview slot leaves that full resource intact.

## Data Flow

### Copy fallback

1. The user clicks `复制图片`.
2. Gemini supplies its clipboard image payload.
3. The clipboard hook processes that payload when no reusable processed resource is available.
4. The processed PNG is written to the clipboard.
5. The clipboard-specific callback records the same blob in the session preview slot.

### Subsequent full-size download

1. The user clicks `下载完整尺寸的图片`.
2. The download hook checks for a genuine reusable full resource.
3. The preview-slot clipboard fallback is not eligible as the full processed resource.
4. Gemini's native `c8o8Fe` request continues and eventually exposes the `rd-gg` full-size asset.
5. The download hook processes the full-size asset, stores it in the full slot, and Gemini downloads the resulting full-size blob.

## Error Handling

This change introduces no new errors or user-facing messages. Existing behavior remains authoritative:

- copy fallback reports its current clipboard processing failures;
- download remains fail-closed when no original binding can be obtained;
- a full resource already present in the session remains reusable;
- storing a preview fallback does not clear or downgrade an existing full resource.

## Regression Tests

Add focused wiring coverage in `tests/userscript/downloadOnlyEntry.test.js` that verifies:

- the download hook receives the existing full-resource callback;
- the clipboard hook receives a distinct clipboard-fallback callback;
- the clipboard callback stores its payload in `slot: 'preview'` with `processedFrom: 'clipboard-fallback'`;
- the download callback still stores download output in `slot: 'full'`.

The test must fail before implementation because both hooks currently share the full-slot callback. Keep clipboard-hook behavior tests unchanged except for correcting any test description that inaccurately calls its fallback payload full-size.

## Verification

1. Run the new focused regression test and confirm it fails for the shared callback wiring.
2. Apply the minimal `src/userscript/index.js` wiring change and confirm the focused test passes.
3. Run the related clipboard hook, download hook, image session store, and userscript entry tests.
4. Run the full repository test suite and production build.
5. Reinstall the rebuilt userscript in the fixed Chrome profile and verify installed-source freshness.
6. Cold-refresh the real Gemini page and wait until the preview reaches `ready`.
7. Click copy and confirm Gemini still writes a processed `image/png` at `1408x768` without an alert.
8. Click full-size download in the same page session and confirm:
   - the native `c8o8Fe` and `rd-gg` chain occurs;
   - the saved processed image is `2816x1536`;
   - no user-facing failure alert appears.

## Acceptance Criteria

- Copying an image does not populate or overwrite the session full slot with the clipboard fallback.
- Copy remains successful with Gemini's current `1408x768` PNG payload.
- A subsequent full-size download in the same session produces `2816x1536`, not `1408x768`.
- The native download request chain remains passive and unblocked.
- Genuine full resources remain reusable by copy and download actions.
- No watermark algorithm or unrelated release file is changed.

## Risks and Mitigations

- **Risk:** clipboard fallback processing is repeated more often because it is no longer considered full quality.
  - **Mitigation:** the result remains cached in the preview slot and is available to preview-quality consumers; correctness takes priority over falsely reusing it for download.
- **Risk:** a future clipboard path may genuinely return a full-size payload.
  - **Mitigation:** this callback is explicitly for fallback provenance rather than dimension-based quality. A future verified full-size copy path can use the full callback deliberately.
- **Risk:** wiring-only tests could miss a session-selection regression.
  - **Mitigation:** retain existing session-store unit coverage and complete the real copy-then-download acceptance flow in the fixed profile.

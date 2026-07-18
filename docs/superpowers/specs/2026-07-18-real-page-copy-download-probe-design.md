# Real-Page Copy/Download Probe Design

## Context

Issue #111 exposed a regression surface that unit tests and the existing real-page pixel comparison do not cover end to end: copying a processed Gemini preview must not consume, replace, or otherwise contaminate the later full-size download request slot. The one-time browser acceptance harness proved the current fix on the fixed Chrome profile, but that harness lives under ignored artifacts and is not a durable repository command.

The repository already has three relevant conventions:

- Tampermonkey freshness checks compare the complete installed userscript body with the local production artifact.
- Real-page probes attach to the fixed Chrome profile through CDP port `9226` and write structured artifacts under `.artifacts`.
- Pure parsing and evaluation helpers are unit-tested separately from the browser-driven command.

This design turns the successful one-time copy-then-download validation into a repeatable probe without changing userscript behavior.

## Goals

1. Add one repository command that validates a copy action followed by a native full-size download on the currently open Gemini image.
2. Prove that clipboard handling stays preview-only while the later download still follows Gemini's native `c8o8Fe` and physical `rd-gg` request chain.
3. Fail before interacting with Gemini when the installed Tampermonkey userscript is stale.
4. Produce a machine-readable report for success and every controlled failure.
5. Keep the command safe to run against the user's existing fixed Chrome session.

## Non-Goals

- The probe will not install or update Tampermonkey scripts.
- It will not start `pnpm dev`, Chrome, or any other local service.
- It will not generate a Gemini image or choose among multiple ready images.
- It will not replace the existing pixel-comparison probe or detector-quality gates.
- It will not modify release artifacts, versions, changelogs, or distribution packages.
- It will not require the downloaded image to be larger than the clipboard image; valid Gemini flows can expose equal dimensions.

## Chosen Approach

Add an independent `scripts/real-page-copy-download-probe.js` entry point and expose it as:

```text
pnpm probe:real-page:copy-download
```

Keeping it independent from `real-page-pixel-compare.js` gives each command one responsibility. The pixel probe measures before/after image quality, while the new probe validates action isolation and native request continuity. Extending the Tampermonkey smoke probe was also rejected because that command targets the local worker/bridge probe page rather than a logged-in real Gemini session.

## Operator Contract

Before running the command, the operator must:

1. Keep the fixed Chrome profile open on CDP port `9226`.
2. Keep the Tampermonkey editor tab for the production userscript open and stable so exact freshness can be read.
3. Keep the local production userscript installed and exactly fresh.
4. Open the logged-in Gemini conversation containing the target generated image.
5. Put the target image into a state where exactly one recognized copy action and exactly one recognized full-size download action are available.

The probe fails clearly if the action surface is absent or ambiguous. It does not use `.first()` to guess which image the operator intended.

## CLI

Supported options:

- `--cdp <url-or-port>`: CDP endpoint; defaults to `9226` using the repository's existing endpoint normalization convention.
- `--output-root <path>`: artifact directory; defaults to `.artifacts/real-page-copy-download`.
- `--page-prefix <url-prefix>`: Gemini page prefix; defaults to `https://gemini.google.com/`.
- `--expected-clipboard-size <WIDTHxHEIGHT>`: optional exact clipboard PNG dimensions.
- `--expected-download-size <WIDTHxHEIGHT>`: optional exact downloaded PNG dimensions.

Timeouts remain internal constants for the first version. This keeps the public surface small while allowing the native download path enough time for the known late `rd-gg-dl` request.

For the issue #111 acceptance case, the intended invocation is:

```text
pnpm probe:real-page:copy-download -- --expected-clipboard-size 1408x768 --expected-download-size 2816x1536
```

Without expected-size options, the probe applies generic validity criteria and does not hardcode one Gemini model or aspect ratio.

## Architecture and Components

### 1. CLI and pure helpers

The script exports pure helpers so most behavior can be verified without a browser:

- parse CLI arguments and `WIDTHxHEIGHT` values;
- validate the PNG signature and read dimensions from the IHDR header;
- classify observed requests as `c8o8Fe`, physical `rd-gg`, or unrelated;
- evaluate collected observations against generic and optional exact-size requirements;
- sanitize network observations before writing the report.

These helpers have no Playwright dependency and do not touch the filesystem.

### 2. Freshness preflight

The runner calls the existing `runTampermonkeyFreshnessCheck` before connecting to the Gemini action surface.

- Exact match: continue.
- Stale or mismatched install: write a failed copy/download report and exit nonzero.
- Unavailable freshness context: fail closed for this real-page probe rather than treating it like the more permissive smoke probe.

The preflight never opens the installer and never updates the installed script. Its report summary and freshness report path are included in the new report.

### 3. Gemini page selection and readiness

The runner connects to the fixed profile with Playwright `connectOverCDP`, selects exactly one page whose URL matches `--page-prefix`, brings it to the foreground, and performs a cold reload. It waits for the userscript's processed image readiness marker, then brings the same page to the foreground again before invoking clipboard APIs. The persisted page URL is reduced to origin plus route kind; conversation identifiers and query strings are not written.

All of these actions happen in one Playwright/CDP connection. This preserves the user-activation behavior observed during the one-time acceptance run.

Recognized accessible labels cover the current Chinese and English copy/full-download labels. Each action must resolve to exactly one visible button. Zero or multiple matches fail at the `page-ready` stage.

### 4. Clipboard observation

Immediately before the copy click, the probe installs a temporary page-realm wrapper around `navigator.clipboard.write`. The wrapper:

- records whether the call was made and whether its promise resolved or rejected;
- reads the first `image/png` clipboard item's bytes in memory;
- records byte length and validated PNG dimensions;
- delegates to the original clipboard implementation so the real action still occurs.

The probe clicks the copy action once and waits for the wrapped write to settle. It does not read the system clipboard afterward and does not persist the clipboard PNG by default.

The original clipboard method is restored in `finally`, including when later stages fail. Restoration errors are recorded but do not hide the primary failure.

### 5. Download and network observation

After copy completion, the probe begins the download phase in the same page session. It observes requests and dialogs, then clicks the native full-size download action exactly once while waiting for Playwright's browser `download` event.

The click is not intercepted or canceled. The downloaded file is copied to:

```text
.artifacts/real-page-copy-download/latest-download.png
```

The probe validates the file as PNG, records its byte length and dimensions, and records whether the download phase observed:

- a Gemini `c8o8Fe` request; and
- a physical generated-asset `rd-gg` request, including the `rd-gg-dl` form.

Request classification may inspect URL and request body in memory, but persisted observations contain only a minimized host/path/category representation. Query strings, authorization material, request bodies, and generated asset tokens are not stored.

Dialogs are recorded and dismissed so an error alert cannot leave the command hanging.

### 6. Report writer

Every controlled exit writes:

```text
.artifacts/real-page-copy-download/latest.json
```

The report has this logical shape:

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "status": "pass | fail",
  "stage": "freshness | connect | page-ready | copy | download | verify | complete",
  "cdpUrl": "http://127.0.0.1:9226",
  "pageUrl": "sanitized Gemini URL",
  "freshness": {
    "status": "fresh | stale | unavailable",
    "exactMatch": true,
    "reportPath": ".artifacts/tampermonkey-freshness/latest.json"
  },
  "expectations": {
    "clipboardSize": null,
    "downloadSize": null
  },
  "clipboard": {
    "writeCalled": true,
    "writeResolved": true,
    "mimeType": "image/png",
    "bytes": 2787523,
    "width": 1408,
    "height": 768
  },
  "download": {
    "eventObserved": true,
    "artifactPath": ".artifacts/real-page-copy-download/latest-download.png",
    "bytes": 10775841,
    "width": 2816,
    "height": 1536,
    "sawC8o8Fe": true,
    "sawPhysicalRdGg": true
  },
  "network": [],
  "dialogs": [],
  "failures": []
}
```

Fields whose stages were not reached remain `null`, `false`, or empty rather than being omitted unpredictably. A caught error adds a stable failure code, a concise message, and the observations collected so far. Stack traces are printed for local diagnosis but are not required in the persisted report.

## Pass and Failure Criteria

The generic probe passes only when all of the following are true:

1. The installed userscript exactly matches the local production artifact.
2. Exactly one recognized copy action and one recognized full-size download action are available.
3. `navigator.clipboard.write` is called with an `image/png` item and resolves successfully.
4. The clipboard PNG has a valid signature, positive byte length, and positive dimensions.
5. A browser download event occurs and produces a valid, non-empty PNG.
6. The download phase observes both `c8o8Fe` and physical `rd-gg` traffic.
7. No failure alert/dialog appears.
8. Any supplied expected dimensions match exactly.

The probe does not pass based only on button clicks, console logs, or a download filename.

Failures are assigned to the last active stage and produce a nonzero process exit. Expected examples include stale userscript, CDP unavailable, no unique action surface, clipboard write rejection, missing PNG clipboard item, download timeout, invalid downloaded PNG, missing native-chain request, failure alert, and exact-size mismatch.

## Cleanup and Side-Effect Boundaries

- The probe does not close the user's Chrome process; closing the Playwright browser object only disconnects from CDP.
- The clipboard wrapper is restored in `finally`.
- Request and dialog listeners are removed after the run.
- Temporary browser download paths are not treated as durable output; only `latest-download.png` is retained.
- The previous `latest-download.png` is removed at run start so a failed run cannot be mistaken for a new successful download. A successful run then writes its replacement.
- Re-running the probe intentionally replaces `latest.json` within its own artifact directory.
- The new probe writes only within its configured output root. Its reused freshness preflight retains the existing separate `.artifacts/tampermonkey-freshness/latest.json` behavior.

## Testing Strategy

Unit tests in `tests/scripts/realPageCopyDownloadProbe.test.js` cover:

- default and explicit CLI parsing;
- valid and malformed exact-size syntax;
- PNG signature/IHDR dimension parsing and invalid buffers;
- `c8o8Fe` and physical `rd-gg` request classification;
- removal of query strings, request bodies, and asset tokens from persisted observations;
- generic passing evaluation;
- each core missing-signal failure;
- optional clipboard/download dimension mismatch failures.

`tests/scripts/scriptEntrypoints.test.js` verifies the package-script mapping.

The real logged-in browser flow remains a deliberate acceptance probe rather than a deterministic automated test in the default suite. After implementation, verification consists of focused unit tests, the full test suite, production build, freshness preflight, and one exact-size issue #111 run against the fixed profile.

## Acceptance Result

The feature is complete when:

- `pnpm probe:real-page:copy-download -- --expected-clipboard-size 1408x768 --expected-download-size 2816x1536` exits `0` on the prepared issue #111 Gemini image;
- `latest.json` records clipboard `1408x768`, download `2816x1536`, resolved clipboard write, `c8o8Fe`, physical `rd-gg`, and no dialogs;
- `latest-download.png` exists and is a valid PNG;
- the new focused tests, full suite, and build pass; and
- existing dirty release artifacts remain untouched.

## Risks and Mitigations

- **Browser focus affects clipboard completion.** Bring the Gemini page forward before and after reload and keep the whole flow in one CDP connection.
- **Gemini labels or DOM structure can change.** Match a small bilingual accessible-label set and fail explicitly when it no longer identifies one action.
- **Native downloads can be slow.** Use a download timeout that covers the known approximately 24-second chain without making hangs indefinite.
- **Network evidence can leak signed URLs.** Persist only categorized, sanitized host/path summaries.
- **A stale install can create misleading failures.** Make exact freshness a mandatory preflight and perform no hidden reinstall.
- **Multiple images can make the target ambiguous.** Require a single visible action surface and leave target selection to the operator.

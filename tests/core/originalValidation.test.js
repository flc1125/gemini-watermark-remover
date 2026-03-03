import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateOriginalFromExif, isLikelyGeminiDimensions } from '../../src/utils.js';

test('isLikelyGeminiDimensions should include common metadata-stripped Gemini sizes', () => {
    assert.equal(isLikelyGeminiDimensions(768, 1376), true);
    assert.equal(isLikelyGeminiDimensions(848, 1264), true);
    assert.equal(isLikelyGeminiDimensions(1024, 1024), true);
});

test('isLikelyGeminiDimensions should reject common non-Gemini canvas sizes', () => {
    assert.equal(isLikelyGeminiDimensions(1280, 720), false);
    assert.equal(isLikelyGeminiDimensions(1000, 1000), false);
});

test('evaluateOriginalFromExif should trust Gemini Credit metadata', () => {
    const out = evaluateOriginalFromExif({
        Credit: 'Made with Google AI',
        ImageWidth: 2000,
        ImageHeight: 1300
    });
    assert.deepEqual(out, { is_google: true, is_original: true });
});

test('evaluateOriginalFromExif should fallback to Gemini dimensions when Credit is missing', () => {
    const out = evaluateOriginalFromExif({
        ImageWidth: 768,
        ImageHeight: 1376
    });
    assert.deepEqual(out, { is_google: true, is_original: true });
});

test('evaluateOriginalFromExif should keep unknown sizes as non-Gemini', () => {
    const out = evaluateOriginalFromExif({
        ImageWidth: 1280,
        ImageHeight: 720
    });
    assert.deepEqual(out, { is_google: false, is_original: true });
});

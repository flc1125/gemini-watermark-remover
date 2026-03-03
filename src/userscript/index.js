import { WatermarkEngine } from '../core/watermarkEngine.js';
import { isGeminiGeneratedAssetUrl, normalizeGoogleusercontentImageUrl } from './urlUtils.js';

let engine = null;
const processingQueue = new Set();

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const canvasToBlob = (canvas, type = 'image/png') =>
  new Promise(resolve => canvas.toBlob(resolve, type));

const isValidGeminiImage = (img) => img.closest('generated-image,.generated-image-container') !== null;

const findGeminiImages = () =>
  [...document.querySelectorAll('img[src*="googleusercontent.com"]')].filter(isValidGeminiImage);

const fetchBlob = (url) => new Promise((resolve, reject) => {
  // use GM_xmlhttpRequest to fetch image blob to avoid cross-origin issue
  GM_xmlhttpRequest({
    method: 'GET',
    url,
    responseType: 'blob',
    onload: (response) => resolve(response.response),
    onerror: reject
  });
});

async function processImage(imgElement) {
  if (!engine || processingQueue.has(imgElement)) return;

  processingQueue.add(imgElement);
  imgElement.dataset.watermarkProcessed = 'processing';

  const originalSrc = imgElement.src;
  try {
    imgElement.src = '';
    const normalSizeBlob = await fetchBlob(normalizeGoogleusercontentImageUrl(originalSrc));
    const normalSizeBlobUrl = URL.createObjectURL(normalSizeBlob);
    const normalSizeImg = await loadImage(normalSizeBlobUrl);
    const processedCanvas = await engine.removeWatermarkFromImage(normalSizeImg, { adaptiveMode: 'always' });
    const processedBlob = await canvasToBlob(processedCanvas);

    URL.revokeObjectURL(normalSizeBlobUrl);

    imgElement.src = URL.createObjectURL(processedBlob);
    imgElement.dataset.watermarkProcessed = 'true';

    console.log('[Gemini Watermark Remover] Processed image');
  } catch (error) {
    console.warn('[Gemini Watermark Remover] Failed to process image:', error);
    imgElement.dataset.watermarkProcessed = 'failed';
    imgElement.src = originalSrc;
  } finally {
    processingQueue.delete(imgElement);
  }
}

const processAllImages = () => {
  const images = findGeminiImages();
  if (images.length === 0) return;

  console.log(`[Gemini Watermark Remover] Found ${images.length} images to process`);
  images.forEach(processImage);
};

const setupMutationObserver = () => {
  new MutationObserver(debounce(processAllImages, 100))
    .observe(document.body, { childList: true, subtree: true });
  console.log('[Gemini Watermark Remover] MutationObserver active');
};

async function processImageBlob(blob) {
  const blobUrl = URL.createObjectURL(blob);
  const img = await loadImage(blobUrl);
  const canvas = await engine.removeWatermarkFromImage(img, { adaptiveMode: 'always' });
  URL.revokeObjectURL(blobUrl);
  return canvasToBlob(canvas);
}

// Intercept fetch requests to replace downloadable image with the watermark removed image
const { fetch: origFetch } = unsafeWindow;
unsafeWindow.fetch = async (...args) => {
  const input = args[0];
  const url = typeof input === 'string' ? input : input?.url;
  if (isGeminiGeneratedAssetUrl(url)) {
    console.log('[Gemini Watermark Remover] Intercepting:', url);

    const normalizedUrl = normalizeGoogleusercontentImageUrl(url);
    if (typeof input === 'string') {
      args[0] = normalizedUrl;
    } else if (typeof Request !== 'undefined' && input instanceof Request) {
      args[0] = new Request(normalizedUrl, input);
    } else {
      args[0] = normalizedUrl;
    }

    const response = await origFetch(...args);
    if (!engine || !response.ok) return response;

    try {
      const processedBlob = await processImageBlob(await response.blob());
      return new Response(processedBlob, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (error) {
      console.warn('[Gemini Watermark Remover] Processing failed:', error);
      return response;
    }
  }

  return origFetch(...args);
};

(async function init() {
  try {
    console.log('[Gemini Watermark Remover] Initializing...');
    engine = await WatermarkEngine.create();

    processAllImages();
    setupMutationObserver();

    console.log('[Gemini Watermark Remover] Ready');
  } catch (error) {
    console.error('[Gemini Watermark Remover] Initialization failed:', error);
  }
})();

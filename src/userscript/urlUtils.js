function isGoogleusercontentHost(hostname) {
  return hostname === 'googleusercontent.com' || hostname.endsWith('.googleusercontent.com');
}

function hasGeminiAssetPath(pathname) {
  return pathname.includes('/rd-gg/') || pathname.includes('/rd-gg-dl/');
}

export function isGeminiGeneratedAssetUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    return isGoogleusercontentHost(parsed.hostname) && hasGeminiAssetPath(parsed.pathname);
  } catch {
    return false;
  }
}

export function normalizeGoogleusercontentImageUrl(url) {
  if (!isGeminiGeneratedAssetUrl(url)) return url;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const sizeTransformAtTail = /=s\d+([^/]*)$/;
    if (sizeTransformAtTail.test(path)) {
      parsed.pathname = path.replace(sizeTransformAtTail, '=s0$1');
    } else {
      parsed.pathname = `${path}=s0`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

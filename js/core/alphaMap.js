/**
 * Alpha Map 计算模块
 * 从背景捕获图像计算 alpha 通道
 */

/**
 * 从背景捕获图像计算 alpha map
 * @param {ImageData} bgCaptureImageData - 背景捕获的 ImageData 对象
 * @returns {Float32Array} Alpha map (值范围 0.0-1.0)
 */
export function calculateAlphaMap(bgCaptureImageData) {
    const { width, height, data } = bgCaptureImageData;
    const alphaMap = new Float32Array(width * height);

    // 对每个像素，取 RGB 三个通道的最大值并归一化
    for (let i = 0; i < alphaMap.length; i++) {
        const idx = i * 4; // RGBA 格式，每个像素 4 个字节
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // 取 RGB 最大值作为亮度值
        const maxChannel = Math.max(r, g, b);

        // 归一化到 [0, 1] 范围
        alphaMap[i] = maxChannel / 255.0;
    }

    return alphaMap;
}

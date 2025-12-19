/**
 * 反向 Alpha 混合模块
 * 实现去除水印的核心算法
 */

// 常量定义
const ALPHA_THRESHOLD = 0.002;  // 忽略极小的 alpha 值（噪声）
const MAX_ALPHA = 0.99;          // 避免除以接近零的值
const LOGO_VALUE = 255;          // 白色水印的颜色值

/**
 * 使用反向 alpha 混合移除水印
 *
 * 原理：
 * Gemini 添加水印: watermarked = α × logo + (1 - α) × original
 * 反向求解: original = (watermarked - α × logo) / (1 - α)
 *
 * @param {ImageData} imageData - 要处理的图像数据（会被原地修改）
 * @param {Float32Array} alphaMap - Alpha 通道数据
 * @param {Object} position - 水印位置 {x, y, width, height}
 */
export function removeWatermark(imageData, alphaMap, position) {
    const { x, y, width, height } = position;

    // 遍历水印区域的每个像素
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            // 计算在原图中的索引（RGBA 格式，每个像素 4 个字节）
            const imgIdx = ((y + row) * imageData.width + (x + col)) * 4;

            // 计算在 alpha map 中的索引
            const alphaIdx = row * width + col;

            // 获取 alpha 值
            let alpha = alphaMap[alphaIdx];

            // 跳过极小的 alpha 值（噪声）
            if (alpha < ALPHA_THRESHOLD) {
                continue;
            }

            // 限制 alpha 值，避免除零
            alpha = Math.min(alpha, MAX_ALPHA);
            const oneMinusAlpha = 1.0 - alpha;

            // 对 RGB 三个通道应用反向 alpha 混合公式
            for (let c = 0; c < 3; c++) {
                const watermarked = imageData.data[imgIdx + c];

                // 反向 alpha 混合公式
                const original = (watermarked - alpha * LOGO_VALUE) / oneMinusAlpha;

                // 裁剪到 [0, 255] 范围
                imageData.data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
            }

            // Alpha 通道保持不变
            // imageData.data[imgIdx + 3] 不需要修改
        }
    }
}

/**
 * 水印引擎主模块
 * 协调水印检测、alpha map 计算和去除操作
 */

import { calculateAlphaMap } from './alphaMap.js';
import { removeWatermark } from './blendModes.js';

const BG_48_PATH = '../assets/bg_48.png';
const BG_96_PATH = '../assets/bg_96.png';

/**
 * 根据图像尺寸检测水印配置
 * @param {number} imageWidth - 图像宽度
 * @param {number} imageHeight - 图像高度
 * @returns {Object} 水印配置 {logoSize, marginRight, marginBottom}
 */
export function detectWatermarkConfig(imageWidth, imageHeight) {
    // Gemini 的水印规则：
    // 如果图像宽高都大于 1024，使用 96×96 水印
    // 否则使用 48×48 水印
    if (imageWidth > 1024 && imageHeight > 1024) {
        return {
            logoSize: 96,
            marginRight: 64,
            marginBottom: 64
        };
    } else {
        return {
            logoSize: 48,
            marginRight: 32,
            marginBottom: 32
        };
    }
}

/**
 * 计算水印在图像中的位置
 * @param {number} imageWidth - 图像宽度
 * @param {number} imageHeight - 图像高度
 * @param {Object} config - 水印配置
 * @returns {Object} 水印位置 {x, y, width, height}
 */
export function calculateWatermarkPosition(imageWidth, imageHeight, config) {
    const { logoSize, marginRight, marginBottom } = config;

    return {
        x: imageWidth - marginRight - logoSize,
        y: imageHeight - marginBottom - logoSize,
        width: logoSize,
        height: logoSize
    };
}

/**
 * 水印引擎类
 */
export class WatermarkEngine {
    constructor(bgCaptures) {
        this.bgCaptures = bgCaptures;
        this.alphaMaps = {};
    }

    static async create() {
        const bg48 = new Image();
        const bg96 = new Image();

        await Promise.all([
            new Promise((resolve, reject) => {
                bg48.onload = resolve;
                bg48.onerror = reject;
                bg48.src = BG_48_PATH;
            }),
            new Promise((resolve, reject) => {
                bg96.onload = resolve;
                bg96.onerror = reject;
                bg96.src = BG_96_PATH;
            })
        ]);

        return new WatermarkEngine({ bg48, bg96 });
    }

    /**
     * 从背景捕获图像获取 alpha map
     * @param {number} size - 水印尺寸 (48 或 96)
     * @returns {Promise<Float32Array>} Alpha map
     */
    async getAlphaMap(size) {
        // 如果已缓存，直接返回
        if (this.alphaMaps[size]) {
            return this.alphaMaps[size];
        }

        // 选择对应尺寸的背景捕获
        const bgImage = size === 48 ? this.bgCaptures.bg48 : this.bgCaptures.bg96;

        // 创建临时 canvas 来提取 ImageData
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bgImage, 0, 0);

        const imageData = ctx.getImageData(0, 0, size, size);

        // 计算 alpha map
        const alphaMap = calculateAlphaMap(imageData);

        // 缓存结果
        this.alphaMaps[size] = alphaMap;

        return alphaMap;
    }

    /**
     * 移除图像上的水印
     * @param {HTMLImageElement|HTMLCanvasElement} image - 输入图像
     * @returns {Promise<HTMLCanvasElement>} 处理后的 canvas
     */
    async removeWatermarkFromImage(image) {
        // 创建 canvas
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');

        // 绘制原图
        ctx.drawImage(image, 0, 0);

        // 获取图像数据
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // 检测水印配置
        const config = detectWatermarkConfig(canvas.width, canvas.height);
        const position = calculateWatermarkPosition(canvas.width, canvas.height, config);

        // 获取对应尺寸的 alpha map
        const alphaMap = await this.getAlphaMap(config.logoSize);

        // 移除水印
        removeWatermark(imageData, alphaMap, position);

        // 将处理后的数据写回 canvas
        ctx.putImageData(imageData, 0, 0);

        return canvas;
    }

    /**
     * 获取水印信息（用于显示）
     * @param {number} imageWidth - 图像宽度
     * @param {number} imageHeight - 图像高度
     * @returns {Object} 水印信息
     */
    getWatermarkInfo(imageWidth, imageHeight) {
        const config = detectWatermarkConfig(imageWidth, imageHeight);
        const position = calculateWatermarkPosition(imageWidth, imageHeight, config);

        return {
            size: config.logoSize,
            position: position,
            config: config
        };
    }
}

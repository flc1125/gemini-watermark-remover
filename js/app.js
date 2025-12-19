/**
 * 主应用程序 - UI 交互逻辑
 */

import { WatermarkEngine } from './core/watermarkEngine.js';
import i18n from './i18n.js';

// 全局状态
let engine = null;
let imageQueue = [];
let processedCount = 0;

// DOM 元素
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const singlePreview = document.getElementById('singlePreview');
const multiPreview = document.getElementById('multiPreview');
const imageList = document.getElementById('imageList');
const progressText = document.getElementById('progressText');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const originalCanvas = document.getElementById('originalCanvas');
const processedSection = document.getElementById('processedSection');
const processedImage = document.getElementById('processedImage');
const originalInfo = document.getElementById('originalInfo');
const processedInfo = document.getElementById('processedInfo');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const statusMessage = document.getElementById('statusMessage');

/**
 * 初始化应用
 */
async function init() {
    try {
        await i18n.init();
        setupLanguageSwitch();
        showLoading(i18n.t('status.loading'));

        engine = await WatermarkEngine.create();

        hideLoading();
        setupEventListeners();
    } catch (error) {
        hideLoading();
        console.error('初始化错误：', error);
    }
}

/**
 * 设置语言切换
 */
function setupLanguageSwitch() {
    const btn = document.getElementById('langSwitch');
    btn.textContent = i18n.locale === 'zh-CN' ? 'EN' : '中文';
    btn.addEventListener('click', async () => {
        const newLocale = i18n.locale === 'zh-CN' ? 'en-US' : 'zh-CN';
        await i18n.switchLocale(newLocale);
        btn.textContent = newLocale === 'zh-CN' ? 'EN' : '中文';
        updateDynamicTexts();
    });
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        handleFiles(Array.from(e.dataTransfer.files));
    });

    downloadAllBtn.addEventListener('click', downloadAll);
    resetBtn.addEventListener('click', reset);
}

function reset() {
    singlePreview.style.display = 'none';
    multiPreview.style.display = 'none';
    imageQueue = [];
    processedCount = 0;
    fileInput.value = '';
}

function handleFileSelect(e) {
    handleFiles(Array.from(e.target.files));
}

function handleFiles(files) {
    const validFiles = files.filter(file => {
        if (!file.type.match('image/(jpeg|png|webp)')) return false;
        if (file.size > 20 * 1024 * 1024) return false;
        return true;
    });

    if (validFiles.length === 0) return;

    imageQueue = validFiles.map((file, index) => ({
        id: Date.now() + index,
        file,
        name: file.name,
        status: 'pending',
        originalImg: null,
        processedBlob: null
    }));

    processedCount = 0;

    if (validFiles.length === 1) {
        singlePreview.style.display = 'block';
        multiPreview.style.display = 'none';
        processSingle(imageQueue[0]);
    } else {
        singlePreview.style.display = 'none';
        multiPreview.style.display = 'block';
        imageList.innerHTML = '';
        updateProgress();
        multiPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        imageQueue.forEach(item => createImageCard(item));
        processQueue();
    }
}

async function processSingle(item) {
    try {
        const img = await loadImage(item.file);
        item.originalImg = img;

        originalCanvas.width = img.width;
        originalCanvas.height = img.height;
        originalCanvas.getContext('2d').drawImage(img, 0, 0);

        // 显示图片信息
        const watermarkInfo = engine.getWatermarkInfo(img.width, img.height);
        originalInfo.innerHTML = `
            <strong>${i18n.t('info.size')}：</strong>${img.width} × ${img.height} px<br>
            <strong>${i18n.t('info.watermark')}：</strong>${watermarkInfo.size}×${watermarkInfo.size} px<br>
            <strong>${i18n.t('info.position')}：</strong>(${watermarkInfo.position.x}, ${watermarkInfo.position.y})
        `;

        const result = await engine.removeWatermarkFromImage(img);
        const blob = await new Promise(resolve => result.toBlob(resolve, 'image/png'));
        item.processedBlob = blob;

        processedImage.src = URL.createObjectURL(blob);
        processedSection.style.display = 'block';
        downloadBtn.style.display = 'flex';
        downloadBtn.onclick = () => downloadImage(item);

        processedInfo.innerHTML = `
            <strong>${i18n.t('info.size')}：</strong>${img.width} × ${img.height} px<br>
            <strong>${i18n.t('info.status')}：</strong>${i18n.t('info.removed')}
        `;

        processedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error(error);
    }
}

function createImageCard(item) {
    const card = document.createElement('div');
    card.id = `card-${item.id}`;
    card.className = 'bg-white md:h-[130px] rounded-xl shadow-card border border-gray-100 overflow-hidden';
    card.innerHTML = `
        <div class="flex flex-wrap h-full relative">
            <div class="w-full md:w-auto h-full flex">
                <div class="w-24 md:w-48 flex-shrink-0 bg-gray-50 p-2 flex items-center justify-center">
                    <img id="result-${item.id}" class="max-w-full max-h-full rounded"></img>
                </div>
                <div class="flex-1 p-4 flex flex-col min-w-0">
                    <h4 class="font-semibold text-gray-900 mb-2 truncate">${item.name}</h4>
                    <div class="text-xs text-gray-500" id="status-${item.id}">${i18n.t('status.pending')}</div>
                </div>
            </div>
            <div class="absolute bottom-0 right-0 md:static w-auto ml-auto flex-shrink-0 p-2 md:p-4 flex items-center justify-center">
                <button id="download-${item.id}" class="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm hidden">${i18n.t('btn.download')}</button>
            </div>
        </div>
    `;
    imageList.appendChild(card);
}

async function processQueue() {
    for (const item of imageQueue) {
        const img = await loadImage(item.file);
        item.originalImg = img;
        document.getElementById(`result-${item.id}`).src = img.src;
    }

    for (const item of imageQueue) {
        if (item.status !== 'pending') continue;

        item.status = 'processing';
        updateStatus(item.id, i18n.t('status.processing'));

        try {
            const result = await engine.removeWatermarkFromImage(item.originalImg);
            const blob = await new Promise(resolve => result.toBlob(resolve, 'image/png'));
            item.processedBlob = blob;

            document.getElementById(`result-${item.id}`).src = URL.createObjectURL(blob);

            item.status = 'completed';
            const watermarkInfo = engine.getWatermarkInfo(item.originalImg.width, item.originalImg.height);
            updateStatus(item.id, `<strong>${i18n.t('info.size')}：</strong>${item.originalImg.width} × ${item.originalImg.height} px<br>
            <strong>${i18n.t('info.watermark')}：</strong>${watermarkInfo.size}×${watermarkInfo.size} px<br>
            <strong>${i18n.t('info.position')}：</strong>(${watermarkInfo.position.x}, ${watermarkInfo.position.y})`, true);

            const downloadBtn = document.getElementById(`download-${item.id}`);
            downloadBtn.classList.remove('hidden');
            downloadBtn.onclick = () => downloadImage(item);

            processedCount++;
            updateProgress();
        } catch (error) {
            item.status = 'error';
            updateStatus(item.id, i18n.t('status.failed'));
            console.error(error);
        }
    }

    if (processedCount > 0) {
        downloadAllBtn.style.display = 'flex';
    }
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function updateStatus(id, text, isHtml = false) {
    const el = document.getElementById(`status-${id}`);
    if (el) el.innerHTML = isHtml ? text : text.replace(/\n/g, '<br>');
}

function updateProgress() {
    progressText.textContent = `${i18n.t('progress.text')}: ${processedCount}/${imageQueue.length}`;
}

function updateDynamicTexts() {
    if (progressText.textContent) {
        updateProgress();
    }
}

function downloadImage(item) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(item.processedBlob);
    a.download = `unwatermarked_${item.name.replace(/\.[^.]+$/, '')}.png`;
    a.click();
}

async function downloadAll() {
    const completed = imageQueue.filter(item => item.status === 'completed');
    if (completed.length === 0) return;

    const zip = new JSZip();
    completed.forEach(item => {
        const filename = `unwatermarked_${item.name.replace(/\.[^.]+$/, '')}.png`;
        zip.file(filename, item.processedBlob);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `unwatermarked_${Date.now()}.zip`;
    a.click();
}

function showLoading(text = null) {
    loadingOverlay.style.display = 'flex';
    const textEl = loadingOverlay.querySelector('p');
    if (textEl && text) textEl.textContent = text;
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

init();

import {aer} from './aer.js';
import config from './config.js';

const $ = id => document.getElementById(id);
const isX = config.id === 'x-assistant';
const MAX_TEXT = 60000;
const ALLOWED_TARGETS = ['简体中文', 'English', '日本語'];
const imageCache = new Map();
const PREVIEW_STYLES = {'经典绿': 'green', '简洁蓝': 'blue', '知识紫': 'purple'};
let capturedURLs = new Set();
let sourceEdited = false;
let draftSource = null;
let mediaCapabilities = null;
let videoProject = {title: '', scenes: []};
let sceneIndex = 0;
let videoJob = null;
let videoPoll;
let videoBusy = false;
let scenePaint = 0;
let videoRevision = 0;
let imageEpoch = 0;
let imageWorkers = 0;
const imageQueue = [];
const imageObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    imageObserver.unobserve(entry.target);
    imageQueue.push({node: entry.target, epoch: imageEpoch});
  }
  pumpImages();
});

document.title = config.name;
$("name").textContent = config.name;
$("mark").textContent = config.glyph;
$("title-field").hidden = isX;
if (isX) $("suggestions").setAttribute('aria-label', '备选开头');
$("platform-tab").textContent = config.platform;
$("platform-label").textContent = config.platform;
$("platform-heading").textContent = '填入' + config.platform + '编辑器';
$("publish").textContent = '打开' + config.platform + '并填入 ↗';
$("publish-title-field").hidden = isX;
$("platform-description").textContent = isX
  ? '将正文填入一个 X 帖子编辑框；串文请在平台逐条整理。'
  : config.id === 'xiaohongshu-assistant'
    ? '打开小红书创作页，选择笔记类型并上传图片后，自动填入标题和正文。'
    : '打开' + config.platform + '后台，进入编辑页后自动填入标题和正文。';
if (isX) $("copy").textContent = '复制正文';

let busy = false;
let source = null;
let suggestions = [];
let importJob = null;
let startingImport = false;
let revision = 0;
let saveTimer;
let pollTimer;
let saveChain = Promise.resolve();

const VIDEO_DESTINATIONS = {
  channels: {label: '视频号', destination: 'wechat-channels'},
  xiaohongshu: {label: '小红书视频', destination: 'xiaohongshu-video'}
};

function status(text, error = false) {
  $("status").textContent = text;
  $("status").dataset.error = String(error);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function safeURL(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.filter(item => item && safeURL(item.url)).slice(0, 100).map((item, index) => ({
    id: text(item.id) || 'image-' + (index + 1),
    url: safeURL(item.url),
    alt: text(item.alt).slice(0, 300),
    width: Number.isFinite(item.width) ? item.width : 0,
    height: Number.isFinite(item.height) ? item.height : 0
  }));
}

function normalizeSource(value) {
  const item = value && typeof value === 'object' ? value : {};
  const markdown = text(item.markdown) || text(item.text);
  return {
    title: text(item.title),
    url: text(item.url),
    markdown,
    text: text(item.text) || markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[\*_>#`]/g, ''),
    capturedAt: text(item.capturedAt),
    extractedFrom: text(item.extractedFrom),
    images: normalizeImages(item.images),
    videos: Array.isArray(item.videos) ? item.videos.slice(0,20).filter(v => v && ['file','stream','blob'].includes(v.kind)).map(v => ({
      id: text(v.id), url: safeURL(v.url), kind: v.kind, title: text(v.title).slice(0,300),
      poster: safeURL(v.poster), width: Number(v.width) || 0, height: Number(v.height) || 0,
      duration: Number(v.duration) || 0, quality: text(v.quality), from: text(v.from)
    })).filter(v => v.kind === 'blob' || v.url) : []
  };
}

function currentMarkdown() {
  return $("markdown-source").value.trim();
}

function currentBody() {
  return $("output").value.trim();
}

function updateControls() {
  const pending = Boolean(importJob && !importJob.terminal);
  document.querySelectorAll('[data-action],#capture').forEach(button => {
    button.disabled = Boolean(busy || startingImport || videoBusy);
  });
  for (const id of ['download-all', 'download-gallery'])
    $(id).disabled = Boolean(busy || startingImport || !source?.images?.some(image => capturedURLs.has(image.url)));
  $("use-original").disabled = Boolean(busy || startingImport || !currentMarkdown());
  $("publish").disabled = busy || startingImport || pending || !currentBody() || (!isX && !$("title").value.trim());
  $("cancel").hidden = busy !== 'ai';
  updateVideoControls();
}

function updateCounts() {
  $("output-count").textContent = $("output").value.length + ' 字';
}

function updatePublishPreview() {
  $("publish-title").textContent = isX ? 'X 帖子不需要标题' : ($("title").value.trim() || '尚未填写');
  $("publish-body").textContent = currentBody() || '尚未生成创作内容';
  $("publish-image-count").textContent = '页面图片在「图片」中下载';
  $("draft-source").textContent = draftSource?.title
    ? '创作素材：' + draftSource.title + (draftSource.url !== source?.url ? ' · 与当前原文不同' : '')
    : '以原文为素材，生成结果仍可继续编辑。';
}

function showSource() {
  const title = source?.title || '当前页面';
  $("card-title").textContent = '原文 Markdown';
  const count = source?.images?.length || 0;
  const videoCount = source?.videos?.length || 0;
  $("source-meta").textContent = '[' + (source?.extractedFrom === 'selection' ? '选区' : '原文') + '] ' + title + ' · ' + currentMarkdown().length + ' 字符 · ' + count + ' 张图 · ' + videoCount + ' 个视频';
  $("source-meta").title = [title, source?.url].filter(Boolean).join('\n');
  $("image-summary").textContent = count ? count + ' 张图片 · 支持预览和下载' : '未发现图片';
  updatePublishPreview();
}

function saveDraft() {
  clearTimeout(saveTimer);
  const draft = {
    input: source?.markdown || source?.text || '',
    source,
    sourceEdited,
    draftSource,
    videoProject,
    style: $("style").value,
    output: $("output").value,
    title: $("title").value,
    target: $("target").value,
    suggestions,
    importJob
  };
  saveChain = saveChain.catch(() => {}).then(() => aer.storage.put(draft)).then(() => {
    $("draft-state").textContent = '草稿已保存';
    return true;
  }).catch(error => {
    status('草稿保存失败：' + error.message, true);
    return false;
  });
  return saveChain;
}

window.__aerFlushDraft = saveDraft;

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 350);
}

function changed() {
  revision += 1;
  updateCounts();
  updatePublishPreview();
  showSource();
  updateControls();
  queueSave();
}

function setTab(tab) {
  if (!['extract', 'create', 'publish', 'images', 'video', 'search'].includes(tab)) return;
  document.querySelectorAll('.workspace-tab').forEach(button => {
    const active = button.dataset.workspace === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.workspace-panel').forEach(panel => {
    const active = panel.dataset.panel === tab;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  showSource();
  hydratePreviewImages();
  if (tab === 'video') { renderVideoGallery(); showScene(); }
}

document.querySelectorAll('.workspace-tab').forEach(button => {
  button.id ||= 'tab-' + button.dataset.workspace;
  const panel = document.querySelector('[data-panel="' + button.dataset.workspace + '"]');
  panel.id = 'panel-' + button.dataset.workspace;
  panel.setAttribute('aria-labelledby', button.id);
  button.setAttribute('aria-controls', panel.id);
  button.addEventListener('click', () => setTab(button.dataset.workspace));
  button.addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('.workspace-tab')];
    let index = tabs.indexOf(button);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault(); setTab(tabs[index].dataset.workspace); tabs[index].focus();
  });
});

document.querySelectorAll('.content-tab').forEach(button => {
  button.addEventListener('click', () => {
    const markdown = button.dataset.view === 'markdown';
    document.querySelectorAll('.content-tab').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    $("content-card").classList.toggle('show-markdown', markdown);
    hydratePreviewImages();
  });
});

function addText(container, value) {
  if (value) container.appendChild(document.createTextNode(value));
}

function imageFigure(url, alt) {
  const figure = document.createElement('figure');
  figure.className = 'markdown-figure';
  const placeholder = document.createElement('div');
  placeholder.className = 'image-placeholder';
  placeholder.dataset.imageUrl = url;
  placeholder.textContent = '正在读取图片…';
  figure.appendChild(placeholder);
  if (alt) {
    const caption = document.createElement('figcaption');
    const label = document.createElement('span'); label.textContent = alt;
    const download = document.createElement('button'); download.type = 'button'; download.textContent = '下载';
    download.onclick = () => downloadImage({url, alt, id: 'inline-image'});
    caption.append(label, download); figure.appendChild(caption);
  }
  return figure;
}

function appendInline(container, value) {
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(value))) {
    addText(container, value.slice(cursor, match.index));
    if (match[1].startsWith('![')) {
      const url = safeURL(match[3]);
      if (url) container.appendChild(imageFigure(url, match[2] || '页面图片'));
      else addText(container, match[0]);
    } else if (match[4]) {
      const url = safeURL(match[5]);
      const link = document.createElement('a');
      link.textContent = match[4];
      if (url) { link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; }
      container.appendChild(link);
    } else if (match[6] || match[7]) {
      const strong = document.createElement('strong');
      strong.textContent = match[6] || match[7];
      container.appendChild(strong);
    } else if (match[8]) {
      const code = document.createElement('code');
      code.textContent = match[8];
      container.appendChild(code);
    } else if (match[9] || match[10]) {
      const emphasis = document.createElement('em');
      emphasis.textContent = match[9] || match[10];
      container.appendChild(emphasis);
    }
    cursor = pattern.lastIndex;
  }
  addText(container, value.slice(cursor));
}

function appendParagraph(container, lines) {
  const paragraph = document.createElement('p');
  lines.forEach((line, index) => {
    if (index) paragraph.appendChild(document.createElement('br'));
    appendInline(paragraph, line);
  });
  container.appendChild(paragraph);
}

function renderMarkdown(markdown) {
  const root = $("markdown-preview");
  root.replaceChildren();
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) appendParagraph(root, paragraph);
    paragraph = [];
  };
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) { flushParagraph(); index += 1; continue; }
    if (/^```/.test(line)) {
      flushParagraph();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code); root.appendChild(pre); continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const element = document.createElement('h' + Math.min(3, heading[1].length));
      appendInline(element, heading[2]); root.appendChild(element); index += 1; continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ''));
      const quote = document.createElement('blockquote'); appendParagraph(quote, quoteLines); root.appendChild(quote); continue;
    }
    const list = line.match(/^\s*([-*+] |\d+[.)] )(.+)$/);
    if (list) {
      flushParagraph();
      const ordered = /^\d/.test(list[1]);
      const element = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-*+] |\d+[.)] )(.+)$/);
        if (!item || (/^\d/.test(item[1])) !== ordered) break;
        const li = document.createElement('li'); appendInline(li, item[2]); element.appendChild(li); index += 1;
      }
      root.appendChild(element); continue;
    }
    paragraph.push(line); index += 1;
  }
  flushParagraph();
  if (!root.children.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '抓取后在这里预览格式化内容。'; root.appendChild(empty);
  }
  hydratePreviewImages();
}

async function loadImage(url) {
  if (!capturedURLs.has(url)) throw new Error('请重新读取当前页面后预览或下载图片。');
  if (imageCache.has(url)) return imageCache.get(url);
  const request = aer.page.image(url).then(result => {
    const match = text(result?.data).match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match || match[2].length > 12 * 1024 * 1024) throw new Error('图片数据无效或过大。');
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    return new Blob([bytes], {type: match[1].toLowerCase()});
  }).catch(error => { if (imageCache.get(url) === request) imageCache.delete(url); throw error; });
  imageCache.set(url, request);
  if (imageCache.size > 12) imageCache.delete(imageCache.keys().next().value);
  return request;
}

function hydratePreviewImages() {
  for (const node of document.querySelectorAll('[data-image-url]')) imageObserver.observe(node);
}

function pumpImages() {
  while (imageWorkers < 3 && imageQueue.length) {
    const {node, epoch} = imageQueue.shift();
    if (!node.isConnected || epoch !== imageEpoch) continue;
    if (node.closest('[hidden]')) { imageObserver.observe(node); continue; }
    imageWorkers += 1;
    drawImage(node, epoch).finally(() => { imageWorkers -= 1; pumpImages(); });
  }
}

async function drawImage(node, epoch) {
  let bitmap;
  try {
    const blob = await loadImage(node.dataset.imageUrl);
    if (!node.isConnected || epoch !== imageEpoch) return;
    // The host allows no image URL loads. Decode only bytes explicitly returned
    // by page.image; this needs neither a remote request nor an img/blob URL.
    bitmap = await createImageBitmap(blob);
    if (!node.isConnected || epoch !== imageEpoch) return;
    const scale = Math.min(1, 1200 / bitmap.width, 1600 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.className = 'markdown-image';
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', node.parentElement.querySelector('figcaption span')?.textContent || '页面图片');
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    node.replaceWith(canvas);
  } catch (error) {
    if (node.isConnected && epoch === imageEpoch) {
      node.textContent = '此图片暂时无法预览，可尝试下载。';
      node.title = error.message;
    }
  } finally { bitmap?.close(); }
}

function renderGallery() {
  const gallery = $("image-gallery");
  gallery.replaceChildren();
  const images = source?.images || [];
  $("gallery-summary").textContent = images.length ? images.length + ' 张图片 · 单张或全部下载' : '当前原文没有可下载图片';
  for (const image of images) gallery.appendChild(imageFigure(image.url, image.alt || '页面图片 ' + image.id));
  hydratePreviewImages();
  updateControls();
}

function videoText(video) {
  const parts = [];
  if (video.width && video.height) parts.push(`${video.width}×${video.height}`);
  if (video.duration > 0 && Number.isFinite(video.duration)) parts.push(`${Math.round(video.duration)} 秒`);
  if (video.quality) parts.push(video.quality);
  return parts.join(' · ');
}

function videoKindText(kind) {
  if (kind === 'stream') return '分段流';
  if (kind === 'blob') return '页面临时视频';
  return '可下载视频';
}

function renderVideoGallery() {
  const gallery = $("video-gallery");
  if (!gallery) return;
  gallery.replaceChildren();
  const videos = source?.videos || [];
  $("video-count").textContent = String(videos.length);
  if (!videos.length) {
    const empty = document.createElement('p');
    empty.className = 'manual-note';
    empty.textContent = '当前页面没有识别到视频。播放视频 1 秒后重新抓取，通常可以补充已加载的 MP4。';
    gallery.appendChild(empty);
    updateVideoControls();
    return;
  }
  videos.forEach((video, index) => {
    const item = document.createElement('article');
    item.className = 'video-item';
    const title = document.createElement('strong');
    title.textContent = video.title || `视频 ${index + 1}`;
    const meta = document.createElement('small');
    meta.textContent = [videoKindText(video.kind), videoText(video), video.from].filter(Boolean).join(' · ');
    const url = document.createElement('p');
    url.textContent = video.url ? video.url : '没有公开文件地址，不能直接下载。';
    item.append(title, meta, url);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = video.kind === 'file' && video.url ? '下载视频' : '无法直接下载';
    button.disabled = video.kind !== 'file' || !video.url;
    if (!button.disabled) button.onclick = () => downloadVideo(video);
    item.appendChild(button);
    gallery.appendChild(item);
  });
  updateVideoControls();
}

async function saveImage(image) {
  const blob = await loadImage(image.url);
  const extensions = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico'};
  const name = (image.alt || 'aer-image-' + image.id).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').slice(0, 100) || 'aer-image';
  return aer.page.download(image.url, name + '.' + (extensions[blob.type] || 'bin'));
}

async function downloadImage(image) {
  if (busy || startingImport) return;
  busy = 'download'; updateControls();
  try {
    const result = await saveImage(image);
    status(result?.path ? '已下载：' + result.path : '图片已下载。');
  } catch (error) {
    status('图片下载失败：' + error.message, true);
  } finally { busy = false; updateControls(); }
}

async function downloadAll() {
  if (!source?.images?.length || busy || startingImport) return;
  busy = 'download'; updateControls(); status('正在下载 ' + source.images.length + ' 张图片…');
  let completed = 0;
  try {
    for (const image of source.images) { await saveImage(image); completed += 1; }
    status('已下载 ' + completed + ' 张图片。');
  } catch (error) {
    status('已下载 ' + completed + ' 张，剩余图片下载失败：' + error.message, true);
  } finally { busy = false; updateControls(); }
}

function showVideoJob(job) {
  videoJob = job || null;
  const panel = $("video-job");
  if (!panel) return;
  panel.hidden = !job;
  if (!job) return;
  $("video-job-message").textContent = job.message || '正在处理视频…';
  $("video-progress").value = Number.isFinite(job.progress) ? Math.max(0, Math.min(1, job.progress)) : 0;
  $("video-cancel").hidden = Boolean(job.terminal);
  $("video-preview").hidden = !(job.state === 'complete' && job.path);
  updateVideoControls();
}

async function pollVideoJob(jobId) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const job = await aer.media.status(jobId);
    if (videoJob?.jobId !== jobId && videoJob) return job;
    showVideoJob(job);
    if (job.terminal) return job;
    await new Promise(resolve => { videoPoll = setTimeout(resolve, 1000); });
  }
  throw new Error('视频任务等待超时，请稍后从下载文件夹检查。');
}

async function downloadVideo(video) {
  if (busy || startingImport || videoBusy || !video?.url) return;
  videoBusy = true; updateControls(); status('正在下载页面视频…');
  try {
    const initial = await aer.media.download(video.url, video.title || source?.title || 'Aer video');
    showVideoJob(initial);
    const job = initial.terminal ? initial : await pollVideoJob(initial.jobId);
    if (job.state !== 'complete') throw new Error(job.message || '视频下载失败。');
    status(`视频已保存：${job.path || '下载文件夹'}`);
  } catch (error) {
    status('视频下载失败：' + error.message, true);
  } finally { videoBusy = false; updateControls(); }
}

function updateVideoControls() {
  const capability = $("video-capability");
  const build = $("video-build");
  const exportButton = $("video-export");
  const cancel = $("video-cancel");
  const platform = $("video-platform");
  const hasSource = Boolean(source?.videos?.length || currentMarkdown() || currentBody());
  const hasSavedVideo = Boolean(videoJob?.state === 'complete' && videoJob.path);
  const hasPublishVideo = Boolean(source?.videos?.some(item => item.kind === 'file' && item.url) || hasSavedVideo);
  const canRender = Boolean(mediaCapabilities?.render);
  if (capability) capability.textContent = mediaCapabilities
    ? (canRender ? '支持读取页面视频、下载文件，并将图文稿导出为 1080×1920 MP4。' : '当前 Aer 只提供页面视频识别；请更新宿主后再使用视频下载和导出。')
    : '正在检查 Aer 的视频能力…';
  if (build) build.disabled = Boolean(busy || startingImport || videoBusy || !canRender || !hasSource);
  if (exportButton) exportButton.disabled = Boolean(busy || startingImport || videoBusy || !canRender || !videoProject.scenes.length);
  if (cancel) cancel.hidden = !videoJob || Boolean(videoJob.terminal);
  if (platform) platform.disabled = Boolean(busy || startingImport || videoBusy || !hasPublishVideo || !currentBody() && !currentMarkdown());
}

function splitVideoText(value) {
  const textValue = String(value || '').replace(/\r\n?/g, '\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[\*_>#`]/g, '').trim();
  if (!textValue) return [];
  const paragraphs = textValue.split(/\n{2,}/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/(?<=[。！？!?；;])\s*/).filter(Boolean);
    const pieces = sentences.length ? sentences : [paragraph];
    let current = '';
    for (const piece of pieces) {
      if (!current) current = piece;
      else if ((current + piece).length <= 105) current += piece;
      else { chunks.push(current); current = piece; }
      if (current.length >= 105) { chunks.push(current.slice(0, 105)); current = current.slice(105); }
    }
    if (current) chunks.push(current);
  }
  return chunks.slice(0, 24);
}

function buildVideoProject() {
  const base = $("video-source").value === 'draft' && currentBody() ? currentBody() : currentMarkdown();
  const chunks = splitVideoText(base);
  if (!chunks.length) return status('请先抓取页面或生成创作稿。', true);
  const images = source?.images || [];
  videoProject = {
    title: ($("video-title").value.trim() || source?.title || 'Aer 视频').slice(0, 80),
    sourceType: $("video-source").value,
    scenes: chunks.map((value, index) => ({text: value, imageUrl: images[index % Math.max(1, images.length)]?.url || '', seconds: 6}))
  };
  sceneIndex = 0; videoRevision += 1; $("video-title").value = videoProject.title;
  $("storyboard").hidden = false; showScene(); queueSave(); status(`已生成 ${videoProject.scenes.length} 个分镜，可逐个调整字幕和时长。`);
}

function wrapCanvasText(context, value, maxWidth) {
  const lines = [];
  let line = '';
  for (const char of String(value || '')) {
    const next = line + char;
    if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = char; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 8);
}

async function paintScene() {
  const canvas = $("scene-preview");
  const scene = videoProject.scenes[sceneIndex];
  if (!canvas || !scene) return;
  const context = canvas.getContext('2d');
  const style = PREVIEW_STYLES[$("style").value] || 'green';
  const colors = {green: ['#0f3b35', '#46c8ae'], blue: ['#183d68', '#62b6f2'], purple: ['#3c2d61', '#c09bea']};
  const [background, accent] = colors[style];
  context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height);
  if (scene.imageUrl && capturedURLs.has(scene.imageUrl)) {
    try {
      const bitmap = await createImageBitmap(await loadImage(scene.imageUrl));
      const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const width = bitmap.width * scale, height = bitmap.height * scale;
      context.globalAlpha = .42; context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); context.globalAlpha = 1; bitmap.close();
    } catch { /* Keep the color background when a page image cannot be loaded. */ }
  }
  context.fillStyle = '#06131acc'; context.fillRect(70, 520, 940, 860);
  context.fillStyle = accent; context.fillRect(100, 600, 120, 12);
  context.fillStyle = '#ffffff'; context.font = 'bold 68px -apple-system, BlinkMacSystemFont, sans-serif';
  const lines = wrapCanvasText(context, scene.text, 820);
  lines.forEach((line, index) => context.fillText(line, 100, 760 + index * 96));
  context.fillStyle = '#ffffffaa'; context.font = '32px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(`${videoProject.title}  ·  ${sceneIndex + 1}/${videoProject.scenes.length}`, 100, 1320);
  scenePaint += 1;
}

function showScene() {
  const scene = videoProject.scenes[sceneIndex];
  const storyboard = $("storyboard");
  if (!storyboard) return;
  storyboard.hidden = !videoProject.scenes.length;
  if (!scene) { updateVideoControls(); return; }
  $("scene-position").textContent = `画面 ${sceneIndex + 1} / ${videoProject.scenes.length}`;
  $("scene-text").value = scene.text;
  $("scene-duration").value = String(scene.seconds || 6);
  const imageSelect = $("scene-image"); imageSelect.replaceChildren();
  const none = document.createElement('option'); none.value = ''; none.textContent = '无图片'; imageSelect.appendChild(none);
  (source?.images || []).forEach((image, index) => { const option = document.createElement('option'); option.value = image.url; option.textContent = image.alt || `页面图片 ${index + 1}`; imageSelect.appendChild(option); });
  imageSelect.value = scene.imageUrl || '';
  $("video-total").textContent = `总时长约 ${videoProject.scenes.reduce((sum, item) => sum + Number(item.seconds || 6), 0)} 秒 · 最多 24 个画面`;
  paintScene(); updateVideoControls();
}

function updateCurrentScene() {
  const scene = videoProject.scenes[sceneIndex];
  if (!scene) return;
  scene.text = $("scene-text").value.slice(0, 120);
  scene.seconds = Number($("scene-duration").value) || 6;
  scene.imageUrl = $("scene-image").value;
  videoRevision += 1; $("video-total").textContent = `总时长约 ${videoProject.scenes.reduce((sum, item) => sum + Number(item.seconds || 6), 0)} 秒 · 最多 24 个画面`;
  paintScene(); queueSave();
}

async function exportVideo() {
  if (videoBusy || !videoProject.scenes.length || !mediaCapabilities?.render) return;
  updateCurrentScene(); videoBusy = true; updateControls(); status('正在准备视频导出…');
  try {
    const title = videoProject.title || 'Aer 视频';
    const initial = await aer.media.begin(title); showVideoJob(initial);
    for (let index = 0; index < videoProject.scenes.length; index += 1) {
      sceneIndex = index; showScene(); await paintScene();
      const png = $("scene-preview").toDataURL('image/png');
      showVideoJob(await aer.media.scene(initial.jobId, png, Number(videoProject.scenes[index].seconds || 6)));
    }
    showVideoJob(await aer.media.finish(initial.jobId));
    const job = await pollVideoJob(initial.jobId);
    if (job.state !== 'complete') throw new Error(job.message || '视频导出失败。');
    status(`视频已导出：${job.path || '下载文件夹'}`);
  } catch (error) { status('视频导出失败：' + error.message, true); }
  finally { videoBusy = false; updateControls(); }
}

async function startVideoPlatformImport() {
  if (busy || startingImport || videoBusy) return;
  const destination = $("video-destination").value;
  const body = currentBody() || currentMarkdown();
  const title = ($("title").value.trim() || videoProject.title || source?.title || '视频内容').slice(0, 200);
  const video = source?.videos?.find(item => item.kind === 'file' && item.url);
  const savedVideo = videoJob?.state === 'complete' && videoJob.path;
  if (!body || (!video && !savedVideo)) return status('请先抓取包含可下载视频的页面，或先导出/保存一条视频。', true);
  videoBusy = true; updateControls();
  try {
    if (video) {
      const initial = await aer.media.download(video.url, video.title || title); showVideoJob(initial);
      const job = initial.terminal ? initial : await pollVideoJob(initial.jobId);
      if (job.state !== 'complete') throw new Error(job.message || '视频下载失败。');
    }
    const importResult = await aer.editor.prepare(title, body, {destination});
    showImport(importResult); await saveDraft(); pollImport();
    const label = Object.values(VIDEO_DESTINATIONS).find(item => item.destination === destination)?.label || '平台';
    status(`已打开${label}，请在平台上传已保存的视频${savedVideo ? `（${videoJob.path}）` : ''}并确认发布。`);
  } catch (error) { status('打开视频发布页失败：' + error.message, true); }
  finally { videoBusy = false; updateControls(); }
}

function restoreVideoProject(value) {
  const scenes = Array.isArray(value?.scenes) ? value.scenes.filter(item => item && text(item.text)).slice(0, 24).map(item => ({
    text: text(item.text).slice(0, 120), imageUrl: safeURL(item.imageUrl), seconds: [4, 6, 8, 10, 12].includes(Number(item.seconds)) ? Number(item.seconds) : 6
  })) : [];
  videoProject = {title: text(value?.title).slice(0, 80), sourceType: value?.sourceType === 'draft' ? 'draft' : 'original', scenes};
  sceneIndex = 0;
  if ($("video-title")) $("video-title").value = videoProject.title;
  if ($("video-source")) $("video-source").value = videoProject.sourceType;
}

function applyPage(page) {
  source = normalizeSource(page);
  sourceEdited = false;
  $("markdown-source").value = source.markdown;
  if (!currentBody() && !isX) $("title").value = source.title.slice(0, 200);
  showSource(); renderMarkdown(source.markdown); renderGallery(); renderVideoGallery(); changed();
}

async function capture(automatic = false) {
  if (videoBusy || (busy && busy !== 'load')) return;
  busy = 'capture'; updateControls(); status('正在读取页面并转换为 Markdown…');
  const before = revision;
  try {
    const page = normalizeSource(await aer.page.capture());
    capturedURLs = new Set(page.images.map(image => image.url));
    imageEpoch += 1; imageObserver.disconnect(); imageQueue.length = 0; imageCache.clear();
    if (before !== revision || (automatic && sourceEdited && page.url === source?.url)) {
      source = {...source, images: page.images, videos: page.videos};
      showSource(); renderMarkdown(currentMarkdown()); renderGallery(); renderVideoGallery();
      status('已保留你编辑的原文；点击重新抓取可替换为页面内容。');
      await saveDraft(); return;
    }
    applyPage(page);
    await saveDraft();
    status(page.markdown ? '原文已抓取为 Markdown' + (currentBody() ? '，已有创作稿已保留。' : '，可编辑并预览。') : '未找到正文，请选中文字后重新抓取。', !page.markdown);
  } catch (error) {
    capturedURLs = new Set();
    status((currentMarkdown() ? '当前页读取失败，显示的是已保存原文：' : '') + error.message, true);
  } finally { busy = false; updateControls(); }
}

$("markdown-source").addEventListener('input', () => {
  sourceEdited = true;
  source = {...(source || {}), markdown: $("markdown-source").value, text: $("markdown-source").value.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[\*_>#`]/g, '')};
  renderMarkdown(currentMarkdown()); changed();
});
for (const id of ['output', 'title']) $(id).addEventListener('input', changed);
$("target").addEventListener('change', changed);
$("capture").onclick = () => capture(false);
$("download-all").onclick = downloadAll;
$("download-gallery").onclick = downloadAll;
$("copy-markdown").onclick = async () => {
    try {
      await aer.clipboard.write(currentMarkdown()); status('已复制原文 Markdown。');
    } catch (error) { status(error.message, true); }
};
$("use-original").onclick = () => {
  if (busy || startingImport) return;
  setTab('create');
  if (currentBody()) return status('创作页已有稿件，请先复制或清空正文后再使用原文。');
  const heading = currentMarkdown().match(/^\s*#\s+([^\n]+)\n+/);
  $("title").value = (heading?.[1] || source?.title || '').slice(0, 200);
  $("output").value = heading && !isX ? currentMarkdown().slice(heading[0].length) : currentMarkdown();
  draftSource = {title: source?.title, url: source?.url}; changed(); status('原文已带入创作页，可编辑后填入平台。');
};
$("go-publish").onclick = () => setTab('publish');
$("style").addEventListener('change', () => {
  $("content-card").dataset.style = PREVIEW_STYLES[$("style").value]; queueSave();
});
$("search-button").onclick = () => {
  const keyword = $("search-input").value.trim();
  const content = currentMarkdown();
  if (!keyword) return status('请输入搜索关键词。', true);
  const position = content.indexOf(keyword);
  $("search-result").textContent = position < 0 ? '没有找到「' + keyword + '」。' : '找到「' + keyword + '」，位于第 ' + (position + 1) + ' 个字符附近。';
  status(position < 0 ? '没有找到匹配内容。' : '已找到匹配内容。');
};

$("video-build").onclick = buildVideoProject;
$("video-export").onclick = exportVideo;
$("video-platform").onclick = startVideoPlatformImport;
$("scene-prev").onclick = () => { updateCurrentScene(); sceneIndex = (sceneIndex + videoProject.scenes.length - 1) % videoProject.scenes.length; showScene(); };
$("scene-next").onclick = () => { updateCurrentScene(); sceneIndex = (sceneIndex + 1) % videoProject.scenes.length; showScene(); };
$("scene-text").oninput = updateCurrentScene;
$("scene-duration").onchange = updateCurrentScene;
$("scene-image").onchange = updateCurrentScene;
$("scene-add").onclick = () => {
  if (videoProject.scenes.length >= 24) return status('最多支持 24 个画面。', true);
  updateCurrentScene();
  videoProject.scenes.splice(sceneIndex + 1, 0, {text: '新画面', imageUrl: '', seconds: 6});
  sceneIndex += 1; showScene(); queueSave();
};
$("scene-delete").onclick = () => {
  if (videoProject.scenes.length <= 1) return status('至少保留一个画面。', true);
  videoProject.scenes.splice(sceneIndex, 1); sceneIndex = Math.min(sceneIndex, videoProject.scenes.length - 1); showScene(); queueSave();
};
$("video-cancel").onclick = async () => {
  if (!videoJob?.jobId) return;
  try { showVideoJob(await aer.media.cancel(videoJob.jobId)); status('已取消视频任务。'); }
  catch (error) { status('取消视频任务失败：' + error.message, true); }
  finally { videoBusy = false; updateControls(); }
};
$("video-preview").onclick = () => videoJob?.jobId && aer.media.preview(videoJob.jobId).catch(error => status('预览失败：' + error.message, true));

function renderSuggestions() {
  const panel = $("suggestions");
  panel.replaceChildren(); panel.hidden = !suggestions.length;
  suggestions.forEach(value => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = value;
    button.onclick = () => {
      if (isX) {
        const output = currentBody();
        if (output.length + value.length + 2 > MAX_TEXT) return status('正文过长，请缩短后再加入开头。', true);
        $("output").value = [value, output].filter(Boolean).join('\n\n');
        status('已加入开头，可继续编辑。');
      } else {
        $("title").value = value.slice(0, 200);
        status('已采用这个标题，正文保留。');
      }
      changed();
    };
    panel.appendChild(button);
  });
}

document.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
  if (busy || startingImport) return;
  let input = currentMarkdown();
  if (!input) return status('请先读取页面原文。', true);
  const action = button.dataset.action;
  const title = source?.title?.trim();
  if (!isX && title && !/^\s*#\s+/.test(input)) input = '# ' + title + '\n\n' + input;
  if (input.length > MAX_TEXT) return status('原文与标题合计超过 60,000 字符，请缩短后再处理。', true);
  busy = 'ai'; updateControls(); status('正在生成…');
  const before = revision;
  try {
    const result = await aer.ai.transform(action, input, $("target").value);
    if (before !== revision) throw new Error('原文或草稿已修改，未覆盖你的编辑，请重新生成。');
    if (action === 'titles') {
      suggestions = text(result?.text).split(/\n+/).map(line => line.replace(/^\s*(?:[-*#]+|\d+[.、)．])\s*/, '').trim()).filter(Boolean).slice(0, 5);
      renderSuggestions(); setTab('create'); status(isX ? '点击备选开头加入正文。' : '点击备选标题即可采用，正文保留。');
    } else {
      const heading = !isX && text(result?.text).match(/^\s*#\s+([^\n]+)\n+/);
      if (heading) { $("title").value = heading[1].trim().slice(0, 200); $("output").value = text(result.text).slice(heading[0].length).trim(); }
      else $("output").value = text(result?.text);
      draftSource = {title: source?.title, url: source?.url};
      setTab('create'); status('已生成，可编辑后填入平台。');
    }
    changed(); await saveDraft();
  } catch (error) { status(error.message, true); }
  finally { busy = false; updateControls(); }
});

$("cancel").onclick = () => aer.ai.cancel().catch(error => status(error.message, true));
$("copy").onclick = async () => {
  try {
    await aer.clipboard.write([!isX && $("title").value.trim(), currentBody()].filter(Boolean).join('\n\n'));
    status(isX ? '已复制正文。' : '已复制标题和正文。');
  } catch (error) { status(error.message, true); }
};

function showImport(job) {
  importJob = job;
  $("import-status").hidden = !job;
  if (job) {
    $("import-message").textContent = job.message || '正在等待平台编辑器…';
    $("import-status").dataset.error = String(['failed', 'conflict', 'expired'].includes(job.state));
    $("cancel-import").hidden = Boolean(job.terminal);
    status(job.message || '正在等待平台编辑器…', ['failed', 'conflict', 'expired'].includes(job.state));
  }
  updateControls();
}

async function pollImport() {
  clearTimeout(pollTimer);
  if (!importJob || importJob.terminal) return;
  const id = importJob.jobId;
  try {
    const job = await aer.editor.status(id);
    if (importJob?.jobId !== id || importJob.terminal) return;
    showImport(job); if (job.terminal) await saveDraft();
  } catch (error) {
    if (importJob?.jobId !== id || importJob.terminal) return;
    showImport({...importJob, state: 'failed', terminal: true, message: error.message}); await saveDraft();
  }
  if (importJob && !importJob.terminal) pollTimer = setTimeout(pollImport, 1500);
}

async function startImport() {
  if (busy || startingImport || (importJob && !importJob.terminal)) return;
  const title = isX ? '' : $("title").value.trim();
  const body = currentBody();
  if (!body || (!isX && !title)) return status('请先填写标题和创作正文。', true);
  startingImport = true; updateControls();
  try {
    if (!await saveDraft()) return;
    const job = await aer.editor.prepare(title, body);
    showImport(job); await saveDraft(); pollImport();
  } catch (error) { status(error.message, true); }
  finally { startingImport = false; updateControls(); }
}

$("publish").onclick = startImport;

$("cancel-import").onclick = async () => {
  if (!importJob) return;
  try { showImport(await aer.editor.cancel(importJob.jobId)); clearTimeout(pollTimer); await saveDraft(); }
  catch (error) { status(error.message, true); }
};

async function collapse(method) {
  try { if (await saveDraft()) await aer.panel[method](); }
  catch (error) { status(error.message, true); }
}

$("close").onclick = () => collapse('close');
$("menu").onclick = () => aer.panel.menu().catch(error => status(error.message, true));
$("settings").onclick = () => aer.settings().catch(error => status(error.message, true));
document.addEventListener('contextmenu', event => {
  event.preventDefault();
  aer.panel.menu().catch(error => status(error.message, true));
});

function restoreDraft(draft) {
  const savedSource = normalizeSource(draft?.source);
  const input = text(draft?.input);
  source = normalizeSource({...savedSource, markdown: input || savedSource.markdown});
  sourceEdited = Boolean(draft?.sourceEdited || (input && savedSource.markdown && input !== savedSource.markdown));
  draftSource = draft?.draftSource && typeof draft.draftSource === 'object'
    ? {title: text(draft.draftSource.title), url: safeURL(draft.draftSource.url)}
    : text(draft?.output) ? {title: source.title, url: source.url} : null;
  $("markdown-source").value = source.markdown;
  $("output").value = text(draft?.output);
  $("title").value = text(draft?.title) || (!isX && text(draft?.output) ? source.title.slice(0, 200) : '');
  if (ALLOWED_TARGETS.includes(draft?.target)) $("target").value = draft.target;
  suggestions = Array.isArray(draft?.suggestions) ? draft.suggestions.filter(value => typeof value === 'string').slice(0, 5) : [];
  if (draft?.importJob?.jobId) showImport(draft.importJob);
  restoreVideoProject(draft?.videoProject);
  if (PREVIEW_STYLES[draft?.style]) $("style").value = draft.style;
  $("content-card").dataset.style = PREVIEW_STYLES[$("style").value];
  showSource(); renderSuggestions(); renderMarkdown(currentMarkdown()); renderGallery(); renderVideoGallery();
  if (videoProject.scenes.length) showScene();
  updateCounts(); updatePublishPreview();
}

void aer.media.capabilities().then(value => { mediaCapabilities = value; updateVideoControls(); }).catch(() => { mediaCapabilities = {}; updateVideoControls(); });
setTab('extract');
busy = 'load'; updateControls();
try {
  const draft = await aer.storage.get();
  if (draft) restoreDraft(draft);
} catch (error) {
  status('草稿读取失败：' + error.message, true);
}
try {
  await capture(true);
} finally {
  busy = false;
  updateControls();
}
if (importJob && !importJob.terminal) pollImport();

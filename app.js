import {
  deleteAllPdfAttachments,
  deletePdfAttachment,
  deletePdfImportJob,
  estimateStorage,
  getPdfBundle,
  listPdfDocuments,
  loadPendingPdfImportJobs,
  movePdfAttachment,
  openPdfDatabase,
  putPdfAnnotations,
  putPdfBundle,
  putPdfWorkspaceNote,
  putPdfTextState,
  savePdfImportJob,
  searchPdfTextIndex
} from './pdf-storage.js';
import {
  applyBatchAction,
  derivePdfMetadata,
  findPdfPaperMatch,
  isActiveRecord,
  isLibraryRecord,
  isRecordRead,
  libraryStatistics,
  migrateLibraryData,
  pdfFileFingerprint,
  recordHasNotes,
  setRecordRead,
  validateCollectionTree
} from './library-logic.js';
import {
  clampPdfNoteFontSize,
  clampPdfNoteImageWidth,
  clampPdfZoomPercent,
  cleanNewsSource,
  groupNewsItems,
  limitTranslationCache,
  segmentReaderText
} from './ui-logic.js';
import { buildNoteDocx } from './note-export.js';
import { buildNotePdf } from './note-pdf-export.js';

const APP_VERSION = '6.12.0';
const STORAGE_KEY = 'paperscope-library-v4';
const V3_STORAGE_KEY = 'paperscope-library-v3';
const V2_STORAGE_KEY = 'paperscope-library-v2';
const LEGACY_SAVED_KEY = 'paperscope-saved';
const THEME_KEY = 'paperscope-theme';
const FILTER_KEY_PREFIX = 'paperscope-quality-filters-v1-';
const TRANSLATION_SETTINGS_KEY = 'paperscope-translation-settings-v2';
const LEGACY_TRANSLATION_SETTINGS_KEY = 'paperscope-translation-settings-v1';
const TRANSLATION_CACHE_KEY = 'paperscope-translation-cache-v2';
const LEGACY_TRANSLATION_CACHE_KEY = 'paperscope-translation-cache-v1';
const PDF_VIEW_MODE_KEY = 'paperscope-pdf-view-mode-v1';
const PDF_ZOOM_KEY = 'paperscope-pdf-zoom-v1';
const PDF_INSPECTOR_OPEN_KEY = 'paperscope-pdf-inspector-open-v1';
const PDF_INSPECTOR_TAB_KEY = 'paperscope-pdf-inspector-tab-v1';
const PDF_PANE_WIDTH_KEY = 'paperscope-pdf-pane-width-v1';
const UI_SETTINGS_KEY = 'paperscope-ui-settings-v1';
const NOTE_EXPORT_SETTINGS_KEY = 'paperscope-note-export-settings-v1';
const initialPdfInspectorSetting = localStorage.getItem(PDF_INSPECTOR_OPEN_KEY);
const TRANSLATION_DEFAULTS = {
  enabled: true, wordClick: true, selection: true, cache: true, mode: 'auto',
  wordClickMode: 'ctrl', positionMode: 'follow', position: null, onlineEndpoint: '', docked: false
};
const NOTE_EXPORT_DEFAULTS = { format: 'pdf', fontFamily: 'Microsoft YaHei', fontSize: 11, pageSize: 'a4', margin: 'standard', includeMetadata: true, includeImages: true };
const el = id => document.getElementById(id);

const AREA_CONFIG = {
  ai: {
    title: 'AI 论文', eyebrow: 'ARTIFICIAL INTELLIGENCE', subtitle: '算法创新、大模型、智能体、多模态与具身智能。',
    topics: [
      ['推理与测试时计算', /reasoning|test[- ]time|chain[- ]of[- ]thought|verifier|inference[- ]time|deliberation/i],
      ['智能体与规划', /\bagents?\b|planning|tool[- ]use|multi[- ]agent|workflow|computer use/i],
      ['高效模型体系结构', /mixture[- ]of[- ]experts|\bmoe\b|routing|spars|efficient|quantiz|model architecture/i],
      ['多模态与视觉语言', /multimodal|vision[- ]language|\bvlm\b|image generation|video generation/i],
      ['具身智能与机器人', /robot|embodied|manipulation|world model|navigation/i],
      ['训练、对齐与安全', /reinforcement learning|alignment|preference|post[- ]training|fine[- ]tun|reward model|safety/i]
    ]
  },
  architecture: {
    title: '体系结构论文', eyebrow: 'COMPUTER ARCHITECTURE', subtitle: '处理器、加速器、存储、互连、能效与体系结构安全。',
    topics: [
      ['AI 加速器与专用芯片', /accelerator|tensor processing|neural processing|\bnpu\b|\bgpu\b|\btpu\b|systolic|domain[- ]specific/i],
      ['存储与内存系统', /memory|cache|dram|hbm|non[- ]volatile|storage|near[- ]data|processing[- ]in[- ]memory/i],
      ['并行、分布式与互连', /parallel|distributed|interconnect|network[- ]on[- ]chip|\bnoc\b|chiplet|manycore|multicore/i],
      ['处理器与微体系结构', /processor|microarchitecture|instruction set|\bisa\b|pipeline|branch prediction|risc[- ]v|out[- ]of[- ]order/i],
      ['性能、能效与可靠性', /performance|energy|power|efficient|reliability|fault|thermal|benchmark/i],
      ['体系结构安全', /side[- ]channel|speculative execution|trusted execution|hardware security|rowhammer|secure processor/i]
    ]
  }
};

const ROUTE_NAMES = { home: '概览', ai: 'AI 论文', architecture: '体系结构', curated: '顶会期刊精选', library: '个人文献库', news: '研究资讯', venues: '会议期刊', settings: '设置', paper: '论文详情' };
const state = {
  datasets: { ai: null, architecture: null }, news: null, venues: null, curated: null, loaded: false,
  compare: new Set(), batch: new Set(), returnHash: null, selectedPaperId: null,
  installPrompt: null, searchTimer: null, translator: null, translatorStatus: 'checking',
  translationRequestId: 0, translationSelectionTimer: null, translationPayload: null, lastSelectionKey: '',
  dictionaryManifest: null, dictionaryDomain: null, dictionaryShards: new Map(), dictionaryDownloadController: null,
  translationDrag: null,
  pdfModule: null, pdfLibModule: null, tesseractModule: null, ocrWorker: null,
  pdfLoadingTask: null, pdfDocument: null, pdfRecord: null, pdfPaperId: null, pdfPage: 1, pdfScale: clampPdfZoomPercent(localStorage.getItem(PDF_ZOOM_KEY)) / 100, pdfRenderTask: null,
  pdfTextContent: null, pdfSelection: null, pdfAnnotationMode: null, pdfAnnotationDraft: null, pdfTextSelectionDraft: null, pdfBrowseSelection: null, pdfSuppressWordClick: false, pdfAnnotationHistory: [], libraryPdfMatches: null,
  pdfSnapshots: [], pdfSnapshotDrag: null, pdfSnapshotZ: 45, pdfNoteSaveTimer: null, pdfNoteDirty: false, pdfNoteRange: null, pdfNoteHistory: [], pdfNoteHistoryIndex: -1, pdfNoteHistoryTimer: null, pdfNoteHistoryRestoring: false, pdfZoomTimer: null,
  pdfPaneWidth: Number(localStorage.getItem(PDF_PANE_WIDTH_KEY)) || null, pdfPaneResize: null,
  pdfSearchQuery: '', pdfSearchMatches: [], pdfSearchIndex: -1,
  pdfViewMode: localStorage.getItem(PDF_VIEW_MODE_KEY) === 'paged' ? 'paged' : 'continuous',
  pdfInspectorOpen: initialPdfInspectorSetting === null ? matchMedia('(min-width:1100px)').matches : initialPdfInspectorSetting === 'open',
  pdfInspectorTab: localStorage.getItem(PDF_INSPECTOR_TAB_KEY) === 'notes' ? 'notes' : 'annotations',
  pdfColumnTemplate: null,
  pdfContinuousObserver: null, pdfPageObserver: null, pdfContinuousTasks: new Map(), pdfPageVisibility: new Map(),
  pdfImportQueue: [], pdfImportActive: false, pdfImportCancelId: null,
  lineageRequestId: 0,
  serviceWorkerRegistration: null, updateReloading: false
};

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function defaultLibrary() {
  return {
    version: 4,
    profile: { name: '研究者', focus: 'AI · 计算机体系结构', bio: '建立自己的研究脉络。', createdAt: new Date().toISOString() },
    records: {}, recent: {}, collections: {}, savedVenues: [], dailyProgress: {}, vocabulary: {}
  };
}
function migrateLibrary() {
  const current = readJson(STORAGE_KEY, null);
  if (current?.version === 4) return migrateLibraryData(current, defaultLibrary);
  const old = readJson(V3_STORAGE_KEY, null) || readJson(V2_STORAGE_KEY, null);
  if (!old?.records) return defaultLibrary();
  const migrated = migrateLibraryData(old, defaultLibrary);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
  return migrated;
}
let library = migrateLibrary();
let translationSettings = {
  ...TRANSLATION_DEFAULTS,
  ...readJson(LEGACY_TRANSLATION_SETTINGS_KEY, {}),
  ...readJson(TRANSLATION_SETTINGS_KEY, {})
};
let noteExportSettings = { ...NOTE_EXPORT_DEFAULTS, ...readJson(NOTE_EXPORT_SETTINGS_KEY, {}) };
let translationCache = limitTranslationCache({ ...readJson(LEGACY_TRANSLATION_CACHE_KEY, {}), ...readJson(TRANSLATION_CACHE_KEY, {}) });
try {
  localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(translationCache));
  localStorage.removeItem('paperscope-translation-history-v1');
} catch {}
const UI_DEFAULTS = {
  preset: 'classic',
  theme: localStorage.getItem(THEME_KEY) || 'system',
  density: 'standard',
  fontScale: 1,
  sidebar: 'expanded',
  readerPane: 'standard',
  noteFontSize: 14,
  reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
};
let uiSettings = { ...UI_DEFAULTS, ...readJson(UI_SETTINGS_KEY, {}) };
let appearanceSnapshot = null;
function saveLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    toast('浏览器存储空间不足，本次修改未能持久保存，请立即导出备份');
    return false;
  }
}
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function safeUrl(value = '') { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function toast(text, { actionLabel = '', onAction = null, duration = 2700 } = {}) {
  const node = el('toast');
  node.replaceChildren();
  const message = document.createElement('span');
  message.textContent = text;
  node.append(message);
  node.classList.toggle('has-action', Boolean(actionLabel && onAction));
  if (actionLabel && onAction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', () => {
      clearTimeout(toast.timer);
      node.classList.remove('show');
      onAction();
    }, { once: true });
    node.append(button);
  }
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), duration);
}
function dateText(value, withTime = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', withTime ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function paperDateText(paper) {
  const value = paper?.publication?.published || paper?.published; if (!value) return '日期待核验';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return '日期待核验';
  if (paper?.publication?.datePrecision === 'year') return `${date.getUTCFullYear()} 年`;
  if (paper?.publication?.datePrecision === 'month') return `${date.getUTCFullYear()} 年 ${String(date.getUTCMonth() + 1).padStart(2, '0')} 月`;
  return dateText(value);
}
function shanghaiToday() { return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); }
function slug(value = '') { return value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 42) || 'paper'; }
function parseRoute() {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
  const [pathText, queryText = ''] = raw.split('?');
  const parts = pathText.split('/').filter(Boolean).map(part => decodeURIComponent(part));
  return { name: parts[0] || 'home', parts, path: pathText || 'home', query: Object.fromEntries(new URLSearchParams(queryText)) };
}
function navigate(path, params = {}, replace = false) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all'));
  const query = new URLSearchParams(clean).toString(); const hash = `#/${path}${query ? `?${query}` : ''}`;
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) renderRoute();
}
function setQuery(patch, replace = false) {
  const route = parseRoute(); navigate(route.path, { ...route.query, ...patch }, replace);
}
function allPapers() { return [...(state.datasets.ai?.items || []), ...(state.datasets.architecture?.items || [])]; }
function getPaper(id) {
  const base = allPapers().find(item => item.id === id) || library.records[id]?.paper || null;
  const overrides = library.records[id]?.metadataOverrides;
  return base && overrides ? { ...base, ...overrides } : base;
}
function getRecord(id) { return library.records[id] || null; }
function snapshotPaper(paper) {
  return { id: paper.id, arxivId: paper.arxivId || null, arxivUrl: paper.arxivUrl || null, title: paper.title, abstract: paper.abstract || '', authors: paper.authors || [], published: paper.published || null, updated: paper.updated || null, venue: paper.venue || '', venueName: paper.venueName || null, venueYear: paper.venueYear || null, venueType: paper.venueType || null, track: paper.track || '', officialUrl: paper.officialUrl || null, link: safeUrl(paper.link), source: paper.source || '', kind: paper.kind || 'preprint', doi: paper.doi || null, journalRef: paper.journalRef || null, citationCount: Number(paper.citationCount || 0), qualityScore: Number(paper.qualityScore || 0), quality: paper.quality || null, area: paper.area || 'ai', publication: paper.publication || null };
}
function ensureRecord(paper) {
  if (!paper) return null; const old = library.records[paper.id] || library.recent?.[paper.id] || {};
  library.records[paper.id] = {
    paper: snapshotPaper(paper), savedAt: old.savedAt || null, queueAt: old.queueAt || null, readAt: old.readAt || null,
    lastOpenedAt: old.lastOpenedAt || null, archivedAt: old.archivedAt || null, trashAt: old.trashAt || null,
    progress: Number(old.progress || 0), note: old.note || '', tags: Array.isArray(old.tags) ? old.tags : [],
    highlights: Array.isArray(old.highlights) ? old.highlights : [], collections: Array.isArray(old.collections) ? old.collections : [],
    publication: old.publication || paper.publication || null, abstractTranslation: old.abstractTranslation || null,
    pdfAttachment: old.pdfAttachment || null,
    pdfAttachments: Array.isArray(old.pdfAttachments) ? old.pdfAttachments : old.pdfAttachment ? [old.pdfAttachment] : [],
    lineage: old.lineage || null, metadataOverrides: old.metadataOverrides || null
  };
  if (library.recent) delete library.recent[paper.id];
  return library.records[paper.id];
}
function paperTopics(paper) {
  const definitions = AREA_CONFIG[paper.area || 'ai'].topics; const text = `${paper.title} ${paper.abstract}`;
  return definitions.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).slice(0, 2);
}
function publicationInfo(record, paper) {
  const info = record?.publication || paper?.publication;
  if (info?.status === 'published' || paper?.kind === 'published' || paper?.doi || paper?.journalRef) return { ...info, status: 'published', label: `已正式收录${info?.venue || paper?.journalRef || paper?.venue ? ` · ${info?.venue || paper?.journalRef || paper?.venue}` : ''}` };
  if (info?.status === 'not-found') return { ...info, label: '暂未匹配到正式版本' };
  if (info?.status === 'error') return { ...info, label: '上次检查失败' };
  return { status: 'unchecked', label: '尚未检查' };
}

function showView(name) {
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  el(`view-${name}`)?.classList.add('active');
}
function setActiveNav(name) {
  const active = name === 'paper' ? (getPaper(state.selectedPaperId)?.area || 'ai') : name;
  document.querySelectorAll('#main-nav [data-route]').forEach(button => button.classList.toggle('active', button.dataset.route === active));
  el('route-title').textContent = ROUTE_NAMES[name] || 'PaperScope';
}
function currentSearchableRoute(route) { return ['ai', 'architecture', 'curated', 'library', 'news', 'venues'].includes(route.name); }
function syncTopSearch(route) {
  const input = el('global-search'); input.value = route.query.q || '';
  input.placeholder = route.name === 'home' ? '搜索全部论文，按 Enter' : route.name === 'venues' ? '搜索会议或期刊' : route.name === 'news' ? '搜索资讯' : '搜索当前页面';
}
function renderRoute() {
  const route = parseRoute(); if (!ROUTE_NAMES[route.name]) return navigate('home', {}, true);
  closeTranslationPopover(); syncTopSearch(route); setActiveNav(route.name);
  if (route.name === 'settings') { showView('settings'); renderSettingsPage(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  if (!state.loaded) return;
  if (route.name !== 'paper') { state.returnHash = null; closeDrawer(false); }
  if (route.name === 'home') { showView('home'); renderHome(); }
  else if (route.name === 'ai' || route.name === 'architecture') { showView('papers'); renderPaperPage(route.name, route); }
  else if (route.name === 'curated') { showView('curated'); renderCuratedPage(route); }
  else if (route.name === 'library') { showView('library'); renderLibraryPage(route); }
  else if (route.name === 'news') { showView('news'); renderNewsPage(route); }
  else if (route.name === 'venues') { showView('venues'); renderVenuePage(route); }
  else if (route.name === 'paper') {
    const paper = getPaper(route.parts.slice(1).join('/'));
    if (!paper) return navigate('home', {}, true);
    if (!state.returnHash) showView('papers');
    renderPaperPage(paper.area || 'ai', { name: paper.area || 'ai', path: paper.area || 'ai', query: {} });
    openDrawer(paper.id);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderPreviewPapers(target, papers) {
  el(target).innerHTML = papers.slice(0, 6).map(paper => `<article class="preview-paper"><button data-open-paper="${escapeHtml(paper.id)}"><h4 data-translatable>${escapeHtml(paper.title)}</h4><p>${escapeHtml(paperDateText(paper))} · ${escapeHtml(paper.venueName || paper.venue || paper.source)}${paper.qualityScore ? ` · 推荐 ${paper.qualityScore}` : ''}</p></button><button class="small" data-compare="${escapeHtml(paper.id)}" title="加入对比">＋</button></article>`).join('');
}
function todayRecommendation() {
  const items = state.curated?.daily?.items || []; const today = shanghaiToday();
  return items.find(item => item.date === today) || items[0] || null;
}
function renderDaily(prefix) {
  const recommendation = todayRecommendation(); const paper = recommendation ? getPaper(recommendation.paperId) : null;
  if (!recommendation || !paper) { el(`${prefix}-daily-title`).textContent = '今日推荐正在生成'; el(`${prefix}-daily-meta`).textContent = '请稍后刷新数据。'; return; }
  state.dailyPaperId = paper.id; el(`${prefix}-daily-title`).textContent = paper.title;
  el(`${prefix}-daily-meta`).textContent = `${paper.venueName || paper.venue || paper.source} ${paper.venueYear || ''} · ${paperDateText(paper)} · 推荐分 ${paper.qualityScore || '—'}`;
  el(`${prefix}-daily-reason`).textContent = `推荐理由：${recommendation.reason || '正式收录且与重点研究方向相关'}`;
  el(`${prefix}-daily-plan`).innerHTML = recommendation.readingPlan.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const done = Boolean(library.dailyProgress?.[recommendation.date]?.completedAt); el(`${prefix}-daily-done`).textContent = done ? '✓ 今日已完成' : prefix === 'home' ? '完成今日阅读' : '完成打卡'; el(`${prefix}-daily-done`).classList.toggle('primary', done);
  if (prefix === 'curated') el('curated-daily-questions').innerHTML = recommendation.focusQuestions.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}
function completeDaily() {
  const recommendation = todayRecommendation(); if (!recommendation) return toast('今日推荐尚未生成');
  library.dailyProgress ||= {}; const done = library.dailyProgress[recommendation.date]?.completedAt;
  library.dailyProgress[recommendation.date] = done ? {} : { paperId: recommendation.paperId, completedAt: new Date().toISOString() };
  if (!done) { const record = ensureRecord(getPaper(recommendation.paperId)); record.readAt ||= new Date().toISOString(); record.progress = 100; }
  saveLibrary(); renderCurrentView(); toast(done ? '已取消今日打卡' : '今日阅读计划已完成');
}
function queueDaily() { const recommendation = todayRecommendation(); if (!recommendation) return toast('今日推荐尚未生成'); const record = ensureRecord(getPaper(recommendation.paperId)); record.queueAt ||= new Date().toISOString(); saveLibrary(); renderCurrentView(); toast('已加入阅读队列'); }
function openDaily() { const recommendation = todayRecommendation(); if (recommendation) openPaperRoute(recommendation.paperId); }
function libraryStats() {
  return libraryStatistics(library, record => publicationInfo(record, record.paper).status);
}
function renderHome() {
  const ai = state.datasets.ai; const arch = state.datasets.architecture; const stats = libraryStats();
  el('home-focus').textContent = `今日焦点：${ai.topics?.[0]?.name || '等待数据'} × ${arch.topics?.[0]?.name || '等待数据'}`;
  el('home-summary').textContent = `${ai.summary || ''} 体系结构侧重点为「${arch.topics?.[0]?.name || '暂无'}」。`;
  el('home-ai-count').textContent = ai.items.length; el('home-arch-count').textContent = arch.items.length; el('home-sync').textContent = dateText(ai.generatedAt, true).slice(0, 5);
  renderPreviewPapers('home-ai-list', ai.items); renderPreviewPapers('home-arch-list', arch.items);
  renderDaily('home');
  el('home-saved').textContent = stats.saved; el('home-queue').textContent = stats.queue; el('home-read').textContent = stats.read; el('home-notes').textContent = stats.notes;
  const topics = [...ai.topics.slice(0, 2).map(item => ({ ...item, area: 'AI' })), ...arch.topics.slice(0, 2).map(item => ({ ...item, area: 'ARCH' }))].sort((a, b) => b.count - a.count);
  const max = topics[0]?.count || 1;
  el('home-topics').innerHTML = topics.map(topic => `<div class="topic"><div class="topic-line"><b>${escapeHtml(topic.name)}</b><span>${topic.area} · ${topic.count}</span></div><div class="bar"><i style="width:${Math.max(12, Math.round(topic.count / max * 100))}%"></i></div></div>`).join('');
  const saved = new Set(library.savedVenues || []);
  const venues = [...(state.venues.venues || [])].sort((a, b) => Number(saved.has(b.name)) - Number(saved.has(a.name)) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)).slice(0, 5);
  el('home-deadlines').innerHTML = venues.map(venue => `<div class="deadline-card"><div><b>${saved.has(venue.name) ? '★ ' : ''}${escapeHtml(venue.name)}</b><p>${escapeHtml(venue.area === 'architecture' ? '体系结构' : 'AI')} · ${escapeHtml(venue.deadline)}</p></div><button class="small" data-venue-save="${escapeHtml(venue.name)}">${saved.has(venue.name) ? '已关注' : '关注'}</button></div>`).join('');
}

function renderSettingsPage() {
  renderProfile();
  const presetNames = { classic: '经典绿', compact: '紧凑学术', focus: '专注阅读', accessible: '高可访问' };
  const densityNames = { comfortable: '舒适', standard: '标准', compact: '紧凑' };
  el('settings-ui-summary').textContent = `${presetNames[uiSettings.preset] || '经典绿'} · ${densityNames[uiSettings.density] || '标准'} · ${Math.round(Number(uiSettings.fontScale || 1) * 100)}%`;
  el('settings-translation-summary').textContent = translationSettings.enabled ? `已启用 · ${translationSettings.mode === 'online' ? '在线优先' : translationSettings.mode === 'offline' ? '仅离线' : '自动'}` : '已关闭';
  const activeImports = state.pdfImportQueue.filter(job => ['queued', 'processing'].includes(job.status)).length;
  el('settings-import-summary').textContent = activeImports ? `${activeImports} 个任务处理中` : `${state.pdfImportQueue.length} 个任务`;
  el('settings-trash-summary').textContent = `${Object.values(library.records).filter(record => record.trashAt).length} 篇`;
  estimateStorage().then(storage => {
    if (!el('settings-storage-summary')) return;
    el('settings-storage-summary').textContent = storage?.quota ? `${formatFileSize(storage.usage)} / ${formatFileSize(storage.quota)}` : '浏览器未提供配额';
  }).catch(() => { if (el('settings-storage-summary')) el('settings-storage-summary').textContent = '暂时无法估算'; });
}

function getPaperFilters(area, route) {
  const memory = readJson(`${FILTER_KEY_PREFIX}${area}`, {});
  return {
    q: route.query.q || '', topic: route.query.topic || memory.topic || 'all', venue: route.query.venue || memory.venue || 'all', source: route.query.source || memory.source || 'all',
    status: route.query.status || memory.status || 'all', sort: route.query.sort || memory.sort || 'recommended',
    size: [12, 24, 48].includes(Number(route.query.size || memory.size)) ? Number(route.query.size || memory.size) : 12,
    page: Math.max(1, Number(route.query.page || 1))
  };
}
function filterPapers(area, filters) {
  const pattern = AREA_CONFIG[area].topics.find(([name]) => name === filters.topic)?.[1];
  const items = state.datasets[area].items.filter(paper => {
    const record = getRecord(paper.id); const text = `${paper.title} ${paper.abstract} ${(paper.authors || []).join(' ')} ${paper.venue || ''}`.toLowerCase();
    if (filters.q && !text.includes(filters.q.toLowerCase())) return false;
    if (pattern && !pattern.test(`${paper.title} ${paper.abstract}`)) return false;
    if (filters.venue !== 'all' && (paper.venueName || paper.venue || paper.source) !== filters.venue) return false;
    if (filters.source !== 'all' && paper.source !== filters.source) return false;
    if (filters.status === 'preprint' && publicationInfo(record, paper).status === 'published') return false;
    if (filters.status === 'published' && publicationInfo(record, paper).status !== 'published') return false;
    if (filters.status === 'saved' && !record?.savedAt) return false;
    if (filters.status === 'unread' && isRecordRead(record)) return false;
    return true;
  });
  return items.sort((a, b) => filters.sort === 'recommended' ? Number(b.qualityScore || 0) - Number(a.qualityScore || 0) || new Date(b.published) - new Date(a.published) : filters.sort === 'oldest' ? new Date(a.published) - new Date(b.published) : filters.sort === 'title' ? a.title.localeCompare(b.title) : new Date(b.published) - new Date(a.published));
}
function renderPaperPage(area, route) {
  const config = AREA_CONFIG[area]; const filters = getPaperFilters(area, route); const items = filterPapers(area, filters);
  const pages = Math.max(1, Math.ceil(items.length / filters.size)); filters.page = Math.min(filters.page, pages);
  const start = (filters.page - 1) * filters.size; const pageItems = items.slice(start, start + filters.size);
  el('papers-eyebrow').textContent = config.eyebrow; el('papers-title').textContent = config.title; el('papers-subtitle').textContent = `${config.subtitle} 默认按顶会/期刊质量、影响力与主题价值排序，新鲜度仅为弱信号。`;
  el('paper-topic').innerHTML = `<option value="all">全部主题</option>${config.topics.map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  const venues = [...new Set(state.datasets[area].items.map(paper => paper.venueName || paper.venue || paper.source))].sort(); const sources = [...new Set(state.datasets[area].items.map(paper => paper.source))].sort();
  el('paper-venue').innerHTML = `<option value="all">全部会议/期刊</option>${venues.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  el('paper-source').innerHTML = `<option value="all">全部来源</option>${sources.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  el('paper-topic').value = filters.topic; el('paper-venue').value = filters.venue; el('paper-source').value = filters.source; el('paper-status').value = filters.status; el('paper-sort').value = filters.sort; el('paper-page-size').value = String(filters.size);
  localStorage.setItem(`${FILTER_KEY_PREFIX}${area}`, JSON.stringify({ topic: filters.topic, venue: filters.venue, source: filters.source, status: filters.status, sort: filters.sort, size: filters.size }));
  el('paper-result-count').textContent = `找到 ${items.length} 篇 · 第 ${filters.page}/${pages} 页`;
  el('paper-list').innerHTML = pageItems.length ? pageItems.map((paper, index) => paperRow(paper, start + index + 1)).join('') : '<div class="empty">没有符合当前条件的论文。</div>';
  renderPagination('paper-pagination', filters.page, pages, page => navigate(area, { ...filters, page }));
}
function paperRow(paper, index) {
  const record = getRecord(paper.id); const info = publicationInfo(record, paper); const checked = state.compare.has(paper.id);
  return `<article class="paper-row ${isRecordRead(record) ? 'read' : ''}" data-paper-id="${escapeHtml(paper.id)}"><button class="compare-toggle ${checked ? 'active' : ''}" data-action="compare" aria-pressed="${checked}" aria-label="${checked ? '移出' : '加入'}论文对比">对比</button><span class="paper-index">${String(index).padStart(2, '0')}</span><div class="paper-main"><button class="paper-title" data-action="open"><h3 data-translatable>${escapeHtml(paper.title)}</h3></button><p data-translatable>${escapeHtml(paper.abstract)}</p><div class="tag-row"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span>${paper.quality?.tier ? `<span class="tag quality-badge">${escapeHtml(paper.quality.tier)} · ${paper.qualityScore}</span>` : ''}<span class="tag venue-badge">${escapeHtml(`${paper.venueName || paper.venue || paper.source}${paper.venueYear ? ` ${paper.venueYear}` : ''}`)}</span><span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.status === 'published' ? '正式收录' : '预印本')}</span><span class="tag">${escapeHtml(paperDateText(paper))}</span>${record?.note ? '<span class="tag note">有笔记</span>' : ''}${paperTopics(paper).map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div></div><div class="paper-actions"><button data-action="read" class="${isRecordRead(record) ? 'active' : ''}" title="已读" aria-label="切换已读状态">✓</button><button data-action="queue" class="${record?.queueAt ? 'active' : ''}" title="阅读队列" aria-label="切换阅读队列">＋</button><button data-action="save" class="${record?.savedAt ? 'saved' : ''}" title="收藏" aria-label="切换收藏">${record?.savedAt ? '★' : '☆'}</button></div></article>`;
}
function renderPagination(target, page, total, onPage) {
  const node = el(target); if (total <= 1) { node.innerHTML = ''; return; }
  const pages = [...new Set([1, total, page - 2, page - 1, page, page + 1, page + 2].filter(value => value >= 1 && value <= total))].sort((a, b) => a - b);
  node.innerHTML = `<button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>←</button>${pages.map((value, index) => `${index && value - pages[index - 1] > 1 ? '<span>…</span>' : ''}<button data-page="${value}" class="${value === page ? 'active' : ''}">${value}</button>`).join('')}<button data-page="${page + 1}" ${page === total ? 'disabled' : ''}>→</button>`;
  node.onclick = event => { const button = event.target.closest('[data-page]'); if (button && !button.disabled) onPage(Number(button.dataset.page)); };
}

function renderCuratedPage(route) {
  const area = route.query.area || 'all'; const venue = route.query.venue || 'all'; const q = (route.query.q || '').toLowerCase(); const sections = state.curated.sections || [];
  const venues = [...new Set(sections.map(section => section.venue))].sort(); el('curated-area').value = area; el('curated-venue').innerHTML = `<option value="all">全部会议/期刊</option>${venues.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`; el('curated-venue').value = venue;
  el('curated-methodology').textContent = `${state.curated.methodology} ${state.curated.daily?.methodology || ''}`; renderDaily('curated');
  const filtered = sections.filter(section => (area === 'all' || section.area === area) && (venue === 'all' || section.venue === venue)).map(section => ({ ...section, papers: section.paperIds.map(getPaper).filter(Boolean).filter(paper => !q || `${paper.title} ${paper.abstract}`.toLowerCase().includes(q)).sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0)) })).filter(section => section.papers.length);
  el('curated-count').textContent = `${filtered.length} 个专栏 · ${filtered.reduce((sum, section) => sum + section.papers.length, 0)} 篇精选`;
  el('curated-sections').innerHTML = filtered.map(section => `<section class="curated-section"><div class="curated-section-head"><div class="eyebrow">${escapeHtml(`${section.type} · ${section.year}`)}</div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.subtitle)}</p><a href="${escapeHtml(safeUrl(section.officialUrl))}" target="_blank" rel="noopener">${escapeHtml(section.source)} ↗</a></div>${section.papers.slice(0, 8).map(paper => `<article class="preview-paper"><button data-open-paper="${escapeHtml(paper.id)}"><h4 data-translatable>${escapeHtml(paper.title)}</h4><p>推荐 ${paper.qualityScore || '—'} · ${escapeHtml(paper.track || paperDateText(paper))}</p></button><button class="small" data-compare="${escapeHtml(paper.id)}">＋</button></article>`).join('')}<div class="card-head"><button class="small" data-curated-venue="${escapeHtml(section.venue)}">只看此专栏</button><span class="mono">${section.papers.length} PAPERS</span></div></section>`).join('') || '<div class="empty">没有符合当前条件的正式收录专栏。</div>';
  const today = shanghaiToday(); el('daily-cadence').textContent = state.curated.daily?.cadence || '';
  el('daily-schedule').innerHTML = (state.curated.daily?.items || []).map(item => { const paper = getPaper(item.paperId); if (!paper) return ''; const done = Boolean(library.dailyProgress?.[item.date]?.completedAt); return `<div class="schedule-row ${item.date === today ? 'today' : ''}"><span class="mono">${item.date === today ? '今天' : escapeHtml(item.date.slice(5))}${done ? ' · ✓' : ''}</span><div><button class="library-title" data-open-paper="${escapeHtml(paper.id)}"><b>${escapeHtml(paper.title)}</b></button><p>${escapeHtml(`${paper.venueName || paper.venue || paper.source} · ${item.reason}`)}</p></div><button class="small" data-open-paper="${escapeHtml(paper.id)}">查看</button></div>`; }).join('');
}

function toggleRecordField(id, field) {
  const existed = Boolean(getRecord(id)); const previous = existed ? structuredClone(getRecord(id)) : null;
  const record = ensureRecord(getPaper(id)); if (!record) return;
  record.trashAt = null;
  record.archivedAt = null;
  if (field === 'read') {
    const next = !isRecordRead(record);
    setRecordRead(record, next);
    if (!saveLibrary()) { if (previous) library.records[id] = previous; else delete library.records[id]; return; }
    renderCurrentView(); renderDrawerActions();
    toast(next ? '已标记为已读' : '已取消已读并重置进度');
    return;
  }
  const value = `${field}At`; record[value] = record[value] ? null : new Date().toISOString();
  if (!saveLibrary()) { if (previous) library.records[id] = previous; else delete library.records[id]; return; }
  renderCurrentView(); renderDrawerActions();
  toast(record[value] ? field === 'saved' ? '已收藏' : field === 'queue' ? '已加入阅读队列' : '已标记为已读' : '已取消');
}
function markOpened(id) {
  const paper = getPaper(id); if (!paper) return;
  const openedAt = new Date().toISOString();
  const record = getRecord(id);
  if (record) record.lastOpenedAt = openedAt;
  else {
    library.recent ||= {};
    library.recent[id] = { paper: snapshotPaper(paper), lastOpenedAt: openedAt };
  }
  saveLibrary();
}
function renderCurrentView() { const route = parseRoute(); if (route.name === 'paper') return; renderRoute(); }

function renderProfile() {
  const profile = library.profile; const initial = (profile.name || '研').trim().slice(0, 1).toUpperCase();
  el('top-avatar').textContent = initial; el('top-name').textContent = profile.name; el('profile-avatar').textContent = initial;
  el('profile-name-display').textContent = profile.name; el('profile-focus-display').textContent = profile.focus || '尚未填写研究方向';
  el('profile-name').value = profile.name; el('profile-focus').value = profile.focus || ''; el('profile-bio').value = profile.bio || '';
}
function duplicateRecordKey(record) {
  const doi = String(record?.paper?.doi || record?.metadataOverrides?.doi || '').trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const title = normalizedAuthor(record?.metadataOverrides?.title || record?.paper?.title || '').replace(/\s+/g, ' ');
  return title.length >= 18 ? `title:${title}` : null;
}
function duplicateRecordIds() {
  const groups = new Map();
  for (const [id, record] of Object.entries(library.records)) {
    if (!isActiveRecord(record)) continue; const key = duplicateRecordKey(record); if (!key) continue;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(id);
  }
  return new Set([...groups.values()].filter(ids => ids.length > 1).flat());
}
function libraryRecords(tab, collectionId, q, smart = 'unread') {
  if (tab === 'recent') {
    const recent = new Map();
    for (const [id, item] of Object.entries(library.recent || {})) recent.set(id, item);
    for (const [id, record] of Object.entries(library.records || {})) {
      if (record?.lastOpenedAt && !record.trashAt) recent.set(id, record);
    }
    return [...recent.entries()].filter(([, record]) => {
      const paper = { ...record.paper, ...(record.metadataOverrides || {}) };
      return !q || `${paper.title} ${(paper.authors || []).join(' ')} ${paper.venue || ''}`.toLowerCase().includes(q.toLowerCase());
    }).sort(([, a], [, b]) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0));
  }
  const duplicates = tab === 'duplicates' ? duplicateRecordIds() : null;
  return Object.entries(library.records).filter(([, record]) => isLibraryRecord(record)).filter(([id, record]) => {
    const paper = { ...record.paper, ...(record.metadataOverrides || {}) };
    if (q && !`${paper.title} ${(paper.authors || []).join(' ')} ${paper.venue || ''} ${paper.doi || ''} ${record.note} ${(record.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === 'trash') return Boolean(record.trashAt);
    if (tab === 'archive') return Boolean(record.archivedAt && !record.trashAt);
    if (record.trashAt || record.archivedAt) return false;
    if (tab === 'all') return true;
    if (tab === 'saved') return Boolean(record.savedAt);
    if (tab === 'queue') return Boolean(record.queueAt);
    if (tab === 'notes') return recordHasNotes(record);
    if (tab === 'published') return Boolean(record.savedAt && publicationInfo(record, record.paper).status === 'published');
    if (tab === 'collections') return collectionId && collectionId !== 'all' ? record.collections?.includes(collectionId) : Boolean(record.collections?.length);
    if (tab === 'unfiled') return Boolean((record.savedAt || record.pdfAttachment) && !record.collections?.length);
    if (tab === 'duplicates') return duplicates.has(id);
    if (tab === 'smart') {
      if (smart === 'has-pdf') return Boolean(record.pdfAttachment);
      if (smart === 'annotated') return Boolean(record.pdfAttachment?.annotationCount || record.highlights?.length);
      if (smart === 'recent-add') return Date.now() - new Date(record.savedAt || record.pdfAttachment?.importedAt || 0).getTime() <= 7 * 86400_000;
      if (smart === 'needs-metadata') return !paper.title || !(paper.authors || []).length || (!paper.doi && !paper.arxivId);
      if (smart === 'pdf-search') return Boolean(state.libraryPdfMatches?.has(id));
      return !isRecordRead(record);
    }
    return true;
  }).sort(([, a], [, b]) => new Date(b.queueAt || b.savedAt || b.lastOpenedAt || b.readAt || 0) - new Date(a.queueAt || a.savedAt || a.lastOpenedAt || a.readAt || 0));
}
function renderLibraryPage(route) {
  if (route.parts[1] === 'translations') return navigate('library/vocabulary', route.query, true);
  if (route.parts[1] === 'published') return navigate('library/all', route.query, true);
  if (route.parts[1] === 'smart' && !route.query.pdfq) return navigate('library/all', route.query, true);
  renderProfile(); const tab = route.parts[1] || 'all'; const q = route.query.q || ''; const collectionId = route.query.collection || 'all'; const smart = route.query.smart || 'unread'; const page = Math.max(1, Number(route.query.page || 1));
  const stats = libraryStats(); for (const [name, value] of Object.entries(stats)) el(`stat-${name}`).textContent = value;
  document.querySelectorAll('#library-tabs [data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  el('library-tab-select').value = tab;
  el('collection-tools').classList.toggle('hidden', tab !== 'collections'); renderCollectionOptions(collectionId);
  el('smart-tools').classList.toggle('hidden', tab !== 'smart'); el('smart-filter').value = smart;
  if (tab === 'smart' && route.query.pdfq) el('library-pdf-search').value = route.query.pdfq;
  el('merge-duplicates').classList.toggle('hidden', tab !== 'duplicates');
  if (tab === 'vocabulary') {
    state.batch.clear(); state.visibleLibraryIds = []; updateBatchCount();
    return renderVocabularyPage(route);
  }
  const records = libraryRecords(tab, collectionId, q, smart); const total = Math.max(1, Math.ceil(records.length / 10)); const safePage = Math.min(page, total); const pageRecords = records.slice((safePage - 1) * 10, safePage * 10);
  const batchContext = `library/${tab}`;
  if (state.batchContext !== batchContext) {
    state.batch.clear();
    state.batchContext = batchContext;
  }
  state.batch = new Set([...state.batch].filter(id => library.records[id]?.paper));
  state.visibleLibraryIds = pageRecords.map(([id]) => id);
  el('library-list').innerHTML = pageRecords.length ? pageRecords.map(([id, record]) => libraryRow(id, record)).join('') : '<div class="empty">当前分类还没有论文。</div>';
  updateBatchCount();
  renderPagination('library-pagination', safePage, total, next => navigate(`library/${tab}`, { ...route.query, page: next }));
}
function libraryProgressInfo(record) {
  if (isRecordRead(record)) return { label: '阅读完成 100%', detail: '已手动标记为已读。' };
  const manual = Number(record.progress);
  if (manual > 0) return { label: `阅读完成 ${Math.min(100, manual)}%`, detail: '这是在论文详情中手动设置的完成度。' };
  const page = Math.max(0, Number(record.pdfAttachment?.lastPage) || 0);
  const count = Math.max(0, Number(record.pdfAttachment?.pageCount) || 0);
  if (page && count) return { label: `PDF 位置 ${page}/${count} · ${Math.round(page / count * 100)}%`, detail: '这是当前页位置，不代表前面的页面均已读完。' };
  return { label: '尚未设置进度', detail: '可在论文详情中设置阅读完成度；打开 PDF 后也会记录当前页位置。' };
}
function libraryMemberships(record, names, managed) {
  const values = managed ? ['全部文献'] : ['最近看过'];
  if (managed && (record.savedAt || record.pdfAttachment) && !names.length) values.push('待整理');
  if (record.queueAt) values.push('阅读队列');
  if (record.savedAt) values.push('收藏');
  if (recordHasNotes(record)) values.push('笔记与标注');
  if (record.lastOpenedAt) values.push('最近看过');
  if (record.archivedAt && !record.trashAt) values.push('归档');
  if (record.trashAt) values.push('回收站');
  values.push(...names.map(name => `分类：${name}`));
  return [...new Set(values)];
}
function libraryRow(id, record) {
  const paper = getPaper(id) || record.paper;
  const info = publicationInfo(record, paper);
  const names = (record.collections || []).map(collectionId => library.collections[collectionId]?.name).filter(Boolean);
  const managed = Boolean(library.records[id]);
  const selected = managed && state.batch.has(id);
  const trashed = Boolean(record.trashAt);
  const archived = Boolean(record.archivedAt && !trashed);
  const progress = libraryProgressInfo(record);
  const memberships = libraryMemberships(record, names, managed);
  const selectControl = managed
    ? `<input class="check" type="checkbox" data-library-select aria-label="选择论文：${escapeHtml(paper.title)}" ${selected ? 'checked' : ''}>`
    : '<span class="recent-marker" title="仅浏览记录">↗</span>';
  const lifecycleActions = !managed
    ? '<button role="menuitem" data-library-action="save">收藏到文献库</button><button role="menuitem" data-library-action="queue">加入阅读队列</button>'
    : trashed
      ? '<button role="menuitem" data-library-action="restore">恢复到文献库</button><button class="danger" role="menuitem" data-library-action="permanent-delete">永久删除</button>'
      : archived
        ? '<button role="menuitem" data-library-action="restore">取消归档</button><button class="danger" role="menuitem" data-library-action="trash">移至回收站</button>'
        : '<button role="menuitem" data-library-action="category">加入分类</button><button role="menuitem" data-library-action="archive">归档</button><button class="danger" role="menuitem" data-library-action="trash">移至回收站</button>';
  const membershipTags = memberships.map(value => `<span class="tag">${escapeHtml(value)}</span>`).join('');
  return `<article class="library-row ${selected ? 'selected' : ''}" data-library-id="${escapeHtml(id)}">${selectControl}<div class="library-main"><div class="library-title-wrap"><button class="library-title" data-library-action="open"><h3 data-translatable>${escapeHtml(paper.title)}</h3></button><aside class="library-membership-popover" role="tooltip"><strong>这篇文章所在的位置</strong><div class="tag-row">${membershipTags}</div><p>${escapeHtml(progress.detail)}</p></aside></div><p data-translatable>${escapeHtml(record.note || paper.abstract || '')}</p><div class="tag-row"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span>${!managed ? '<span class="tag">仅最近浏览</span>' : ''}<span class="tag" title="${escapeHtml(progress.detail)}">${escapeHtml(progress.label)}</span>${record.pdfAttachment ? `<span class="tag published">本地 PDF · ${record.pdfAttachment.pageCount || '未知'} 页${(record.pdfAttachments?.length || 0) > 1 ? ` · ${record.pdfAttachments.length} 个版本` : ''}</span>` : ''}${record.pdfAttachment?.annotationCount ? `<span class="tag note">${record.pdfAttachment.annotationCount} 条 PDF 标注</span>` : ''}${record.queueAt ? '<span class="tag">阅读队列</span>' : ''}${archived ? '<span class="tag">已归档</span>' : ''}${trashed ? `<span class="tag note">回收站 · ${escapeHtml(dateText(record.trashAt))}</span>` : ''}${record.note ? '<span class="tag note">有笔记</span>' : ''}<span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.label)}</span>${(record.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}${names.map(name => `<span class="tag collection-chip"># ${escapeHtml(name)}</span>`).join('')}</div></div><div class="library-row-actions">${record.pdfAttachment ? '<button class="small" data-library-action="pdf">阅读 PDF</button>' : ''}<button class="small" data-library-action="open">查看</button><details class="row-menu"><summary aria-label="更多文献操作">•••</summary><div role="menu"><button role="menuitem" data-library-action="compare">加入对比</button>${managed ? `<button role="menuitem" data-library-action="read">${isRecordRead(record) ? '标记未读' : '标记已读'}</button><button role="menuitem" data-library-action="queue">${record.queueAt ? '移出队列' : '加入队列'}</button>` : ''}${lifecycleActions}</div></details></div></article>`;
}
function renderVocabularyPage(route) {
  const q = (route.query.q || '').trim().toLowerCase(); const page = Math.max(1, Number(route.query.page || 1));
  const entries = Object.entries(library.vocabulary || {}).filter(([, item]) => !q || `${item.source} ${item.translation} ${item.context || ''} ${getPaper(item.paperId)?.title || ''}`.toLowerCase().includes(q)).sort(([, a], [, b]) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const total = Math.max(1, Math.ceil(entries.length / 12)); const safePage = Math.min(page, total); const pageEntries = entries.slice((safePage - 1) * 12, safePage * 12);
  el('library-list').innerHTML = pageEntries.length ? pageEntries.map(([id, item]) => {
    const paper = getPaper(item.paperId); const sourceLabel = paper?.title || item.paperTitle || '未关联论文';
    const senseCount = (item.meanings || []).reduce((sum, entry) => sum + (entry.senses?.length || 0), 0);
    return `<article class="vocabulary-row" data-vocabulary-id="${escapeHtml(id)}"><div><h3 data-translatable>${escapeHtml(item.source)}</h3><div class="translation">${escapeHtml(item.translation)}</div><p>${escapeHtml(item.context || '')}</p><div class="tag-row"><span class="tag">${escapeHtml(item.provider || '本地词典')}</span>${senseCount ? `<span class="tag">${senseCount} 个义项</span>` : ''}<span class="tag">掌握 ${Number(item.mastery || 0)}/3</span><span class="tag">查询 ${Number(item.lookups || 1)} 次</span><span class="tag">${escapeHtml(sourceLabel)}</span><span class="tag">${escapeHtml(dateText(item.updatedAt || item.createdAt))}</span></div></div><div class="paper-actions">${paper ? '<button data-vocabulary-action="open">论文</button>' : ''}<button data-vocabulary-action="speak">朗读</button><button data-vocabulary-action="mastery">掌握＋</button><button data-vocabulary-action="copy">复制</button><button data-vocabulary-action="remove" title="删除">×</button></div></article>`;
  }).join('') : '<div class="empty">生词本还是空的。阅读论文时点击英文单词，再选择“加入生词本”。</div>';
  renderPagination('library-pagination', safePage, total, next => navigate('library/vocabulary', { ...route.query, page: next }));
}
function exportVocabulary() {
  const rows = [['source', 'translation', 'context', 'provider', 'mastery', 'paper', 'updated_at']];
  for (const item of Object.values(library.vocabulary || {})) {
    rows.push([item.source, item.translation, item.context || '', item.provider || '', String(item.mastery || 0), getPaper(item.paperId)?.title || item.paperTitle || '', item.updatedAt || item.createdAt || '']);
  }
  if (rows.length === 1) return toast('生词本还是空的');
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  downloadText('paperscope-vocabulary.csv', `\uFEFF${csv}`, 'text/csv;charset=utf-8');
}
function renderCollectionOptions(selected) {
  library.collections = validateCollectionTree(library.collections);
  const entries = Object.entries(library.collections);
  const counts = new Map(entries.map(([id]) => [id, Object.values(library.records).filter(record => isActiveRecord(record) && record.collections?.includes(id)).length]));
  const children = new Map();
  for (const entry of entries) {
    const parent = entry[1].parentId && library.collections[entry[1].parentId] ? entry[1].parentId : '';
    if (!children.has(parent)) children.set(parent, []); children.get(parent).push(entry);
  }
  for (const values of children.values()) values.sort((a, b) => Number(a[1].order || 0) - Number(b[1].order || 0) || a[1].name.localeCompare(b[1].name, 'zh-CN'));
  const ordered = []; const visited = new Set(); const visit = (parentId, depth) => {
    for (const [id, collection] of children.get(parentId) || []) {
      if (visited.has(id)) continue;
      visited.add(id); ordered.push([id, collection, depth]); visit(id, depth + 1);
    }
  }; visit('', 0);
  for (const [id, collection] of entries) if (!visited.has(id)) ordered.push([id, collection, 0]);
  const options = ordered.map(([id, collection, depth]) => `<option value="${escapeHtml(id)}">${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(collection.name)}（${counts.get(id) || 0}）</option>`).join('');
  if (selected !== undefined) { el('collection-filter').innerHTML = `<option value="all">全部分类</option>${options}`; el('collection-filter').value = selected || 'all'; }
  el('paper-collection').innerHTML = `<option value="">选择分类</option>${options}`;
  el('collection-parent').innerHTML = `<option value="">顶层分类</option>${options}`;
  if (el('batch-collection-select')) el('batch-collection-select').innerHTML = `<option value="">选择分类…</option>${options}`;
  if (el('pdf-import-collection')) el('pdf-import-collection').innerHTML = `<option value="">导入后放入“待整理”</option>${options}`;
}
async function searchLocalPdfLibrary() {
  const query = el('library-pdf-search').value.trim().toLowerCase(); if (query.length < 2) return toast('请输入至少 2 个字符');
  const button = el('library-pdf-search-button'); button.disabled = true; button.textContent = '检索中…';
  try {
    const matches = await searchPdfTextIndex(query);
    state.libraryPdfMatches = matches; navigate('library/smart', { smart: 'pdf-search', pdfq: query, page: 1 }); toast(`PDF 全文找到 ${matches.size} 篇`);
  } finally { button.disabled = false; button.textContent = '全文检索'; }
}
async function mergeSelectedDuplicates() {
  const ids = [...state.batch]; if (ids.length < 2) return toast('请至少选择 2 条重复记录');
  const keys = new Set(ids.map(id => duplicateRecordKey(getRecord(id))).filter(Boolean));
  if (keys.size > 1 && !confirm('所选记录的 DOI/标题并不完全相同，仍要合并吗？')) return;
  const targetId = ids[0]; const target = ensureRecord(getPaper(targetId));
  for (const sourceId of ids.slice(1)) {
    const source = getRecord(sourceId); if (!source) continue;
    target.savedAt ||= source.savedAt; target.queueAt ||= source.queueAt; target.readAt ||= source.readAt; target.lastOpenedAt ||= source.lastOpenedAt;
    target.progress = Math.max(Number(target.progress || 0), Number(source.progress || 0));
    target.tags = [...new Set([...(target.tags || []), ...(source.tags || [])])];
    target.collections = [...new Set([...(target.collections || []), ...(source.collections || [])])];
    target.highlights = [...(target.highlights || []), ...(source.highlights || []).filter(item => !(target.highlights || []).some(old => old.id === item.id))];
    target.note = [target.note, source.note].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join('\n\n');
    target.publication ||= source.publication; target.abstractTranslation ||= source.abstractTranslation; target.lineage ||= source.lineage;
    const sourceDocuments = (await listPdfDocuments().catch(() => [])).filter(document => document.paperId === sourceId);
    for (const document of sourceDocuments) {
      const previous = [source.pdfAttachment, ...(source.pdfAttachments || [])].find(item => item?.attachmentId === document.attachmentId) || {};
      const primary = !target.pdfAttachment;
      const moved = await movePdfAttachment(sourceId, targetId, document.attachmentId, { primary });
      if (!moved) continue;
      const metadata = pdfAttachmentMeta(moved, previous);
      if (primary) target.pdfAttachment = metadata;
      target.pdfAttachments = [target.pdfAttachment, ...(target.pdfAttachments || []), metadata]
        .filter((item, index, items) => item && items.findIndex(value => value.attachmentId === item.attachmentId) === index);
    }
    delete library.records[sourceId];
  }
  state.batch = new Set([targetId]); saveLibrary(); renderRoute(); toast(`已合并 ${ids.length} 条重复记录`);
}
function selectedRecordIds() {
  return [...state.batch].filter(id => library.records[id]?.paper);
}
function updateBatchCount() {
  const bar = el('library-batchbar'); if (!bar) return;
  const route = parseRoute(); const tab = route.parts[1] || 'all'; const ids = selectedRecordIds();
  el('batch-count').textContent = `${ids.length} 项已选`;
  bar.classList.toggle('hidden', !ids.length || tab === 'vocabulary');
  const visible = state.visibleLibraryIds || [];
  const selectedVisible = visible.filter(id => state.batch.has(id)).length;
  el('library-select-all').checked = Boolean(visible.length && selectedVisible === visible.length);
  el('library-select-all').indeterminate = Boolean(selectedVisible && selectedVisible < visible.length);
  bar.querySelectorAll('[data-batch-mode="standard"]').forEach(node => node.classList.toggle('hidden', ['archive', 'trash'].includes(tab)));
  bar.querySelectorAll('[data-batch-mode="restore"]').forEach(node => node.classList.toggle('hidden', !['archive', 'trash'].includes(tab)));
  bar.querySelectorAll('[data-batch-mode="archive"]').forEach(node => node.classList.toggle('hidden', tab !== 'archive'));
  bar.querySelectorAll('[data-batch-mode="trash"]').forEach(node => node.classList.toggle('hidden', tab !== 'trash'));
  document.querySelectorAll('[data-library-id]').forEach(row => row.classList.toggle('selected', state.batch.has(row.dataset.libraryId)));
}
function runBatchAction(action, message, payload = {}) {
  const ids = selectedRecordIds(); if (!ids.length) return toast('请先选择文献');
  const snapshots = new Map(ids.map(id => [id, structuredClone(library.records[id])]));
  const changed = applyBatchAction(library, ids, action, payload);
  if (!changed) return toast('当前选择没有可执行的操作');
  if (!saveLibrary()) {
    for (const [id, record] of snapshots) library.records[id] = record;
    return;
  }
  renderRoute();
  toast(`${message} · ${changed} 篇`);
}
function moveRecordsToTrash(ids = selectedRecordIds()) {
  const valid = ids.filter(id => library.records[id]?.paper && !library.records[id].trashAt);
  if (!valid.length) return toast('没有可移至回收站的文献');
  const previous = new Map(valid.map(id => [id, {
    trashAt: library.records[id].trashAt || null,
    archivedAt: library.records[id].archivedAt || null
  }]));
  applyBatchAction(library, valid, 'trash');
  if (!saveLibrary()) {
    for (const [id, lifecycle] of previous) Object.assign(library.records[id], lifecycle);
    return;
  }
  state.batch.clear();
  renderRoute();
  toast(`已移至回收站 · ${valid.length} 篇`, {
    actionLabel: '撤销',
    duration: 8000,
    onAction: () => {
      for (const [id, lifecycle] of previous) if (library.records[id]) Object.assign(library.records[id], lifecycle);
      saveLibrary(); renderRoute(); toast('已撤销删除');
    }
  });
}
function restoreRecords(ids = selectedRecordIds()) {
  const valid = ids.filter(id => library.records[id]?.paper && (library.records[id].trashAt || library.records[id].archivedAt));
  if (!valid.length) return toast('没有可恢复的文献');
  const snapshots = new Map(valid.map(id => [id, structuredClone(library.records[id])]));
  applyBatchAction(library, valid, 'restore');
  if (!saveLibrary()) {
    for (const [id, record] of snapshots) library.records[id] = record;
    return;
  }
  state.batch.clear(); renderRoute(); toast(`已恢复 ${valid.length} 篇文献`);
}
async function permanentlyDeleteRecords(ids = selectedRecordIds()) {
  const valid = ids.filter(id => library.records[id]?.trashAt);
  if (!valid.length) return toast('永久删除只能在回收站中执行');
  const attachmentCount = valid.reduce((sum, id) => sum + Math.max(Number(Boolean(library.records[id].pdfAttachment)), library.records[id].pdfAttachments?.length || 0), 0);
  if (!confirm(`永久删除 ${valid.length} 篇文献？这会同时清除 ${attachmentCount} 个本地 PDF 及其文本、批注，且无法撤销。`)) return;
  try {
    for (const id of valid) await deleteAllPdfAttachments(id);
    for (const item of Object.values(library.vocabulary || {})) {
      if (valid.includes(item.paperId)) { item.paperTitle ||= library.records[item.paperId]?.paper?.title || ''; item.paperId = null; }
    }
    for (const id of valid) {
      delete library.records[id];
      delete library.recent?.[id];
      state.batch.delete(id);
    }
    if (!saveLibrary()) throw new Error('文献索引未能持久化，请立即导出备份');
    renderRoute(); toast(`已永久删除 ${valid.length} 篇文献`);
  } catch (error) {
    await repairPdfLibrary({ notify: false }).catch(() => {});
    renderRoute(); toast(`永久删除未完成：${error.message}`);
  }
}

function renderNewsCard(item, group, index) {
  const image = safeUrl(item.image || '');
  const hasImage = image !== '#';
  const context = item.summary || `来自 ${cleanNewsSource(item.source)} 官方频道的研究动态。`;
  const signalText = `${item.title} ${context}`;
  const chineseBrief = /safety|secure|security|risk|guardrail|安全|风险/i.test(signalText)
    ? '这条资讯聚焦 AI 安全、风险控制或防护实践，适合结合原文中的方法边界与落地条件阅读。'
    : /agent|workflow|tool.use|智能体|代理/i.test(signalText)
      ? '这条资讯聚焦智能体及其工作流，建议关注工具权限、运行边界、评测证据和实际部署方式。'
      : /gpu|chip|accelerat|infrastructure|cloud|system|英伟达|芯片|系统/i.test(signalText)
        ? '这条资讯主要涉及计算基础设施与系统实现，可重点查看性能、成本、能效和部署约束。'
        : /model|reason|multimodal|training|推理|模型|多模态|训练/i.test(signalText)
          ? '这条资讯介绍模型能力或训练方法的变化，建议核对实验依据、适用任务和已知限制。'
          : '这是一条来自官方渠道的研究动态，可结合发布时间、来源与专题归类判断是否值得精读。';
  const readingCue = /safety|secure|risk|eval|benchmark|安全|评测/i.test(signalText)
    ? '阅读时重点核对评测边界、风险结论与适用条件。'
    : /gpu|chip|accelerat|infrastructure|cloud|system|英伟达|芯片|系统/i.test(signalText)
      ? '阅读时重点关注基础设施、性能效率与部署约束。'
      : /agent|reason|model|multimodal|智能体|推理|模型|多模态/i.test(signalText)
        ? '阅读时重点关注能力变化、实验依据和可复用的方法。'
        : '可结合发布日期与专题分组判断是否值得进一步精读。';
  const source = cleanNewsSource(item.source);
  const detail = `${source} 官方频道 · ${dateText(item.published)} · 归入“${group.label}”。${readingCue}`;
  return `<a class="news-card ${index === 0 ? 'featured' : ''} ${hasImage ? 'has-image' : 'text-only'}" href="${escapeHtml(safeUrl(item.link))}" target="_blank" rel="noopener"><div class="news-meta"><span class="news-source">${escapeHtml(source)}</span><span class="news-official">官方</span><time class="news-date">${escapeHtml(dateText(item.published))}</time></div><h3 data-translatable>${escapeHtml(item.title)}</h3><p>${escapeHtml(context)}</p><div class="news-extra"><div class="news-extra-inner"><div class="news-extra-content ${hasImage ? '' : 'no-image'}">${hasImage ? `<figure><img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)} 的原文预览图" loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>原文预览图 · 图片版权归原发布方所有</figcaption></figure>` : ''}<div class="news-extra-copy"><section><strong>中文速览</strong><span>${escapeHtml(chineseBrief)}</span></section><section><strong>阅读线索</strong><span>${escapeHtml(detail)}</span></section></div></div></div></div><div class="news-card-footer"><span>${escapeHtml(group.label)}</span><span>查看原文 ↗</span></div></a>`;
}
function renderNewsColumns(group) {
  const split = Math.ceil(group.items.length / 2);
  const columns = [group.items.slice(0, split), group.items.slice(split)];
  return columns.map((items, columnIndex) => `<div class="news-column">${items.map((item, index) => renderNewsCard(item, group, columnIndex ? index + split : index)).join('')}</div>`).join('');
}
function renderNewsPage(route) {
  const q = route.query.q || ''; const source = route.query.source || 'all'; const size = Number(route.query.size) === 18 ? 18 : 9; const page = Math.max(1, Number(route.query.page || 1));
  const groupMode = ['topic', 'newest', 'source'].includes(route.query.group) ? route.query.group : 'topic';
  const sources = [...new Set(state.news.items.map(item => item.source))];
  el('news-source').innerHTML = `<option value="all">全部来源</option>${sources.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(cleanNewsSource(name))}</option>`).join('')}`;
  el('news-source').value = source; el('news-group').value = groupMode; el('news-page-size').value = String(size);
  const filtered = state.news.items.filter(item => (source === 'all' || item.source === source) && (!q || `${item.title} ${item.summary}`.toLowerCase().includes(q.toLowerCase())));
  const ordered = groupNewsItems(filtered, groupMode).flatMap(group => group.items);
  const pages = Math.max(1, Math.ceil(ordered.length / size)); const safePage = Math.min(page, pages); const pageItems = ordered.slice((safePage - 1) * size, safePage * size);
  const pageGroups = groupNewsItems(pageItems, groupMode);
  el('news-result-count').textContent = `${ordered.length} 条资讯 · ${pageGroups.length} 个分组 · 第 ${safePage}/${pages} 页`; el('news-sync').textContent = `更新 ${dateText(state.news.generatedAt, true)}`;
  el('news-list').innerHTML = pageGroups.map(group => `<section class="news-cluster"><header class="news-cluster-head"><div><h2>${escapeHtml(group.label)}</h2><p>${escapeHtml(group.description)}</p></div><span class="news-cluster-count">${group.items.length} 条</span></header><div class="news-cluster-grid">${renderNewsColumns(group)}</div></section>`).join('') || '<div class="empty">没有匹配资讯。</div>';
  renderPagination('news-pagination', safePage, pages, next => navigate('news', { ...route.query, page: next }));
}
function venueRank(venue) { return venue.state === 'open' ? 0 : venue.state === 'rolling' ? 1 : venue.state === 'unannounced' ? 2 : 3; }
function renderVenuePage(route) {
  const q = route.query.q || ''; const area = route.query.area || 'all'; const type = route.query.type || 'all'; const status = route.query.status || 'all'; const sort = route.query.sort || 'deadline'; const page = Math.max(1, Number(route.query.page || 1));
  el('venue-area').value = area; el('venue-type').value = type; el('venue-status').value = status; el('venue-sort').value = sort;
  const items = state.venues.venues.filter(venue => (area === 'all' || venue.area === area) && (type === 'all' || venue.type === type) && (status === 'all' || venue.state === status) && (!q || `${venue.name} ${venue.level} ${venue.source}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : venueRank(a) - venueRank(b) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  const pages = Math.max(1, Math.ceil(items.length / 10)); const safePage = Math.min(page, pages); const pageItems = items.slice((safePage - 1) * 10, safePage * 10); const saved = new Set(library.savedVenues || []);
  el('venue-result-count').textContent = `${items.length} 个会议/期刊 · 第 ${safePage}/${pages} 页`; el('venue-note').textContent = `更新 ${dateText(state.venues.generatedAt, true)}`;
  el('venue-list').innerHTML = pageItems.map(venue => `<tr data-venue-name="${escapeHtml(venue.name)}"><td><button class="small" data-venue-action="save">${saved.has(venue.name) ? '★' : '☆'}</button></td><td><b>${escapeHtml(venue.name)}</b><small>${escapeHtml(venue.type)} · 核验 ${escapeHtml(venue.verifiedAt)}</small></td><td>${venue.area === 'architecture' ? '体系结构' : 'AI'} · ${escapeHtml(venue.level)}</td><td>${escapeHtml(venue.deadline)}</td><td>${escapeHtml(venue.speed)}</td><td><a href="${escapeHtml(safeUrl(venue.officialUrl))}" target="_blank" rel="noopener">官方入口 ↗</a>${venue.deadlineAt ? ' <button class="small" data-venue-action="ics">日历</button>' : ''}</td></tr>`).join('');
  renderPagination('venue-pagination', safePage, pages, next => navigate('venues', { ...route.query, page: next }));
}

function summarizePaper(paper) {
  const text = (paper.abstract || '').replace(/\s+/g, ' ').trim(); const points = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean).slice(0, 3); const topic = paperTopics(paper)[0] || (paper.area === 'architecture' ? '计算机体系结构方法' : '人工智能方法');
  return { oneLine: `论文聚焦「${topic}」。以下信息严格基于来源摘要，不额外推测实验结果。`, points, limitation: text.startsWith('这是一篇已登记 DOI') ? 'Crossref 未提供摘要，只能确认题名、作者、来源和 DOI。' : '这是基于来源摘要的结构化拆分，不替代论文全文。' };
}
function highlightedAbstract(text, highlights) {
  const ranges = [];
  for (const item of highlights || []) { const start = text.indexOf(item.text); if (start >= 0 && !ranges.some(range => start < range.end && start + item.text.length > range.start)) ranges.push({ start, end: start + item.text.length, color: item.color }); }
  ranges.sort((a, b) => a.start - b.start); let cursor = 0; let html = '';
  for (const range of ranges) { html += escapeHtml(text.slice(cursor, range.start)); html += `<mark style="background:${escapeHtml(range.color)}66">${escapeHtml(text.slice(range.start, range.end))}</mark>`; cursor = range.end; }
  return html + escapeHtml(text.slice(cursor));
}
function openPaperRoute(id) { state.returnHash = parseRoute().name === 'paper' ? state.returnHash : location.hash; location.hash = `#/paper/${encodeURIComponent(id)}`; }
function openDrawer(id) {
  const paper = getPaper(id); if (!paper) return; state.selectedPaperId = id; markOpened(id); const record = ensureRecord(paper); const summary = summarizePaper(paper);
  el('detail-title').textContent = paper.title; el('detail-meta').textContent = `${(paper.authors || []).slice(0, 8).join(', ') || '作者信息缺失'} · ${paperDateText(paper)} · ${paper.venueName || paper.venue || paper.source}${paper.track ? ` · ${paper.track}` : ''}`;
  el('detail-summary').textContent = summary.oneLine; el('detail-points').innerHTML = summary.points.map(point => `<li>${escapeHtml(point)}</li>`).join(''); el('detail-limitation').textContent = summary.limitation;
  el('detail-link').href = safeUrl(paper.link); el('detail-link').classList.toggle('hidden', paper.kind === 'local' || !paper.link); el('paper-note').value = record.note || ''; el('paper-tags').value = (record.tags || []).join(', '); el('reading-progress').value = String(record.progress || 0); renderCollectionOptions();
  el('detail-bilingual-panel').classList.toggle('hidden', !record.abstractTranslation?.text);
  el('detail-bilingual-text').textContent = record.abstractTranslation?.text || '';
  el('detail-bilingual-source').textContent = record.abstractTranslation?.provider ? `中文摘要 · ${record.abstractTranslation.provider}` : '中文摘要';
  el('detail-bilingual').textContent = record.abstractTranslation?.text ? '刷新中文摘要' : '生成中英对照';
  const info = publicationInfo(record, paper); el('detail-venue-title').textContent = info.status === 'published' ? `${paper.venueName || info.venue || paper.venue || '正式版本'}${paper.venueYear ? ` ${paper.venueYear}` : ''} · 已正式收录` : '当前为预印本，尚未核验正式收录';
  el('detail-venue-date').textContent = info.status === 'published' ? `收录/出版时间：${info.published ? paperDateText({ ...paper, publication: info }) : '正式版本已匹配，具体日期待官方元数据核验'}${paper.doi || info.doi ? ` · DOI ${paper.doi || info.doi}` : ''}` : `arXiv 上传时间：${dateText(paper.published)}`;
  el('detail-quality-reason').textContent = paper.quality?.reasons?.length ? `推荐依据：${paper.quality.reasons.join('；')} · 推荐分 ${paper.qualityScore}` : '当前未获得旗舰会议/期刊质量标记，请结合原文自行判断。';
  const official = paper.officialUrl || info.url || (paper.doi ? `https://doi.org/${paper.doi}` : null); el('detail-official-link').href = official ? safeUrl(official) : '#'; el('detail-official-link').classList.toggle('hidden', !official);
  const arxiv = paper.arxivUrl || (paper.source === 'arXiv' ? paper.link : null); el('detail-arxiv-link').href = arxiv ? safeUrl(arxiv) : '#'; el('detail-arxiv-link').classList.toggle('hidden', !arxiv);
  renderDrawerActions(); renderHighlights(); renderPdfAttachmentStatus(record); renderLineagePanel(record); el('detail-lineage').textContent = record.lineage ? '刷新追溯' : '查询追溯'; updateDetailNavigation(); el('drawer-overlay').classList.add('open'); el('paper-drawer').classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeDrawer(navigateBack = true) {
  closeTranslationPopover(); el('drawer-overlay').classList.remove('open'); el('paper-drawer').classList.remove('open'); document.body.style.overflow = '';
  if (navigateBack && parseRoute().name === 'paper') { const fallback = state.returnHash; state.returnHash = null; if (fallback) location.hash = fallback; else navigate(getPaper(state.selectedPaperId)?.area || 'ai'); }
}
function renderDrawerActions() {
  const paper = getPaper(state.selectedPaperId); const record = getRecord(state.selectedPaperId); if (!paper) return; const info = publicationInfo(record, paper);
  el('detail-save').textContent = record?.savedAt ? '★ 已收藏' : '☆ 收藏'; el('detail-queue').textContent = record?.queueAt ? '✓ 已在队列' : '＋ 阅读队列'; el('detail-read').textContent = isRecordRead(record) ? '✓ 已读' : '○ 标为已读'; el('detail-compare').textContent = state.compare.has(paper.id) ? '移出对比' : '加入对比';
  el('detail-publication-status').textContent = info.label; el('detail-publication-status').className = `tag ${info.status === 'published' ? 'published' : ''}`;
}
function renderHighlights() {
  const paper = getPaper(state.selectedPaperId); const record = getRecord(state.selectedPaperId); if (!paper) return;
  el('detail-abstract').innerHTML = highlightedAbstract(paper.abstract || '', record?.highlights || []);
  el('highlight-list').innerHTML = record?.highlights?.length ? record.highlights.map(item => `<div class="highlight" style="border-color:${escapeHtml(item.color)}"><button data-highlight-remove="${escapeHtml(item.id)}">×</button>${escapeHtml(item.text)}</div>`).join('') : '<div class="mono" style="margin-top:7px">暂无标注</div>';
}
function openMetadataEditor() {
  const paper = getPaper(state.selectedPaperId); if (!paper) return;
  el('metadata-title').value = paper.title || '';
  el('metadata-authors').value = (paper.authors || []).join('\n');
  el('metadata-date').value = paper.published ? new Date(paper.published).toISOString().slice(0, 10) : '';
  el('metadata-venue').value = paper.venueName || paper.venue || '';
  el('metadata-doi').value = paper.doi || '';
  el('metadata-url').value = paper.link || '';
  el('metadata-modal').classList.add('open');
}
function saveMetadataEditor() {
  const record = ensureRecord(getPaper(state.selectedPaperId)); if (!record) return;
  const title = el('metadata-title').value.trim(); if (!title) return toast('标题不能为空');
  const authors = el('metadata-authors').value.split(/\r?\n|[;；]/).map(value => value.trim()).filter(Boolean);
  const date = el('metadata-date').value;
  record.metadataOverrides = {
    ...(record.metadataOverrides || {}), title, authors,
    published: date ? new Date(`${date}T00:00:00Z`).toISOString() : record.paper.published,
    venue: el('metadata-venue').value.trim(), venueName: el('metadata-venue').value.trim() || null,
    doi: el('metadata-doi').value.trim().replace(/^https?:\/\/doi\.org\//i, '') || null,
    link: safeUrl(el('metadata-url').value.trim())
  };
  saveLibrary(); closeModal('metadata-modal'); openDrawer(state.selectedPaperId); toast('论文元数据已更新');
}
function currentDetailSequence() {
  const paper = getPaper(state.selectedPaperId); if (!paper) return [];
  const route = state.returnHash ? (() => { const old = location.hash; const hash = state.returnHash; const raw = hash.startsWith('#/') ? hash.slice(2) : hash; const [path, query = ''] = raw.split('?'); return { name: path.split('/')[0], query: Object.fromEntries(new URLSearchParams(query)) }; })() : null;
  return route && (route.name === 'ai' || route.name === 'architecture') ? filterPapers(route.name, getPaperFilters(route.name, route)) : state.datasets[paper.area || 'ai'].items;
}
function updateDetailNavigation() { const sequence = currentDetailSequence(); const index = sequence.findIndex(paper => paper.id === state.selectedPaperId); el('previous-paper').disabled = index <= 0; el('next-paper').disabled = index < 0 || index >= sequence.length - 1; }
function moveDetail(offset) { const sequence = currentDetailSequence(); const index = sequence.findIndex(paper => paper.id === state.selectedPaperId); const next = sequence[index + offset]; if (next) { history.replaceState(null, '', `#/paper/${encodeURIComponent(next.id)}`); openDrawer(next.id); } }

function normalizeTitleTokens(title) { return new Set(String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(word => word.length > 1)); }
function titleSimilarity(a, b) { const aa = normalizeTitleTokens(a); const bb = normalizeTitleTokens(b); if (!aa.size || !bb.size) return 0; return 2 * [...aa].filter(token => bb.has(token)).length / (aa.size + bb.size); }
function crossrefDate(item) { const parts = item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0]; return parts?.length ? new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1)).toISOString() : null; }
async function checkPublication(id, quiet = false) {
  const paper = getPaper(id); const record = ensureRecord(paper); if (!paper || !record) return false;
  if (paper.kind === 'published' || paper.doi || paper.journalRef || paper.publication?.status === 'published') { record.publication = { ...(paper.publication || {}), status: 'published', doi: paper.doi || paper.publication?.doi || null, venue: paper.journalRef || paper.publication?.venue || paper.venue, checkedAt: new Date().toISOString(), source: paper.publication?.source || paper.source }; saveLibrary(); return true; }
  try {
    const url = new URL('https://api.crossref.org/works'); url.searchParams.set('query.title', paper.title); url.searchParams.set('rows', '5'); url.searchParams.set('select', 'DOI,title,container-title,published,published-online,URL,author,type');
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
    const candidates = ((await response.json()).message?.items || []).map(item => ({ item, score: titleSimilarity(paper.title, item.title?.[0] || '') })).sort((a, b) => b.score - a.score); const match = candidates[0]?.score >= .78 ? candidates[0] : null;
    record.publication = match ? { status: 'published', doi: match.item.DOI, venue: match.item['container-title']?.[0] || '已登记 DOI', published: crossrefDate(match.item), url: match.item.URL || `https://doi.org/${match.item.DOI}`, checkedAt: new Date().toISOString(), source: 'Crossref 标题匹配', confidence: match.score } : { status: 'not-found', checkedAt: new Date().toISOString(), source: 'Crossref 标题匹配' };
    saveLibrary(); if (!quiet) toast(match ? `已匹配：${record.publication.venue}` : '暂未匹配到正式版本'); return Boolean(match);
  } catch (error) { record.publication = { status: 'error', checkedAt: new Date().toISOString(), message: error.message }; saveLibrary(); if (!quiet) toast('检查失败，请稍后重试'); return false; }
  finally { renderDrawerActions(); }
}

function bibtexFor(paper) {
  const year = paper.published ? new Date(paper.published).getUTCFullYear() : 'n.d.'; const key = `${slug(paper.authors?.[0]?.split(' ').slice(-1)[0] || 'paper')}${year}${slug(paper.title.split(' ').slice(0, 2).join(''))}`;
  const fields = [`  title = {${paper.title}}`, `  author = {${(paper.authors || []).join(' and ')}}`, `  year = {${year}}`, `  ${paper.kind === 'published' ? 'journal' : 'howpublished'} = {${paper.venue || paper.source}}`, paper.doi ? `  doi = {${paper.doi}}` : null, paper.arxivId ? `  eprint = {${paper.arxivId.replace(/v\d+$/, '')}}` : null, `  url = {${safeUrl(paper.link)}}`].filter(Boolean);
  return `@${paper.kind === 'published' ? 'article' : 'misc'}{${key},\n${fields.join(',\n')}\n}`;
}
function markdownFor(paper) { return `- **${paper.title}** — ${(paper.authors || []).join(', ') || 'Unknown authors'} (${paper.published ? new Date(paper.published).getUTCFullYear() : 'n.d.'}). [原文](${safeUrl(paper.link)})${paper.doi ? ` DOI: ${paper.doi}` : ''}`; }
async function copyText(text, message) { try { await navigator.clipboard.writeText(text); toast(message); } catch { const box = document.createElement('textarea'); box.value = text; document.body.appendChild(box); box.select(); document.execCommand('copy'); box.remove(); toast(message); } }
function downloadText(name, text, type = 'text/plain') { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
function exportLibrary() { downloadText(`paperscope-library-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...library, exportedAt: new Date().toISOString(), app: 'PaperScope' }, null, 2), 'application/json'); toast('文献库已导出'); }
async function writeDirectoryFile(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(value);
  await writable.close();
}
async function exportCompleteBackup() {
  if (!('showDirectoryPicker' in window)) {
    exportLibrary();
    return toast('当前浏览器不支持目录备份，已导出文献 JSON；请在 Chromium PWA 中使用完整备份');
  }
  try {
    const root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'paperscope-backup' });
    const folder = await root.getDirectoryHandle(`PaperScope-${new Date().toISOString().slice(0, 10)}`, { create: true });
    const pdfFolder = await folder.getDirectoryHandle('pdf', { create: true });
    const annotationFolder = await folder.getDirectoryHandle('annotations', { create: true });
    const documents = await listPdfDocuments();
    const manifest = [];
    for (const [index, document] of documents.entries()) {
      setPdfProgress(index / Math.max(1, documents.length) * 100, `备份附件 ${index + 1}/${documents.length}`);
      const stem = `${String(index + 1).padStart(3, '0')}-${safePdfFileStem(document.fileName)}`;
      await writeDirectoryFile(pdfFolder, `${stem}.pdf`, document.blob);
      const bundle = await getPdfBundle(document.paperId, document.attachmentId);
      await writeDirectoryFile(annotationFolder, `${stem}.json`, JSON.stringify({
        schema: 'paperscope-pdf-annotations-v1',
        paperId: document.paperId,
        attachmentId: document.attachmentId,
        pageCount: document.pageCount,
        annotations: bundle?.annotations || [],
        workspaceNote: bundle?.workspaceNote || { html: '', text: '', images: [], updatedAt: null }
      }, null, 2));
      manifest.push({ paperId: document.paperId, attachmentId: document.attachmentId, fileName: document.fileName, backupFile: `${stem}.pdf`, fingerprint: document.fingerprint });
    }
    await writeDirectoryFile(folder, 'paperscope-library.json', JSON.stringify({ ...library, exportedAt: new Date().toISOString(), app: 'PaperScope' }, null, 2));
    await writeDirectoryFile(folder, 'manifest.json', JSON.stringify({ schema: 'paperscope-complete-backup-v1', exportedAt: new Date().toISOString(), attachments: manifest }, null, 2));
    setPdfProgress(100, '完整备份已完成');
    toast(`完整备份完成：${documents.length} 个附件`);
  } catch (error) {
    if (error?.name !== 'AbortError') toast(`完整备份失败：${error.message}`);
  }
}
async function importLibraryFile(file) {
  try {
    const value = JSON.parse(await file.text());
    if (![2, 3, 4].includes(value.version) || !value.records || typeof value.records !== 'object') throw new Error('不是有效的 PaperScope 备份');
    if (!confirm(`将合并导入 ${Object.keys(value.records).length} 条记录。当前文献和本机 PDF 不会被整体覆盖，是否继续？`)) return;
    const importedRecords = Object.fromEntries(Object.entries(value.records).filter(([, record]) => record?.paper).map(([id, incoming]) => {
      const existing = library.records[id] || {};
      return [id, {
        ...existing,
        ...incoming,
        savedAt: incoming.savedAt || existing.savedAt || null,
        queueAt: incoming.queueAt || existing.queueAt || null,
        lastOpenedAt: incoming.lastOpenedAt || incoming.readAt || existing.lastOpenedAt || null,
        progress: Math.max(Number(existing.progress || 0), Number(incoming.progress || 0)),
        tags: [...new Set([...(existing.tags || []), ...(incoming.tags || [])])],
        collections: [...new Set([...(existing.collections || []), ...(incoming.collections || [])])],
        highlights: [...(existing.highlights || []), ...(incoming.highlights || []).filter(item => !(existing.highlights || []).some(old => old.id === item.id))],
        pdfAttachment: existing.pdfAttachment || incoming.pdfAttachment || null,
        pdfAttachments: existing.pdfAttachments || (existing.pdfAttachment ? [existing.pdfAttachment] : [])
      }];
    }));
    library = {
      ...library,
      profile: { ...library.profile, ...(value.profile || {}) },
      records: { ...library.records, ...importedRecords },
      collections: { ...library.collections, ...(value.collections || {}) },
      savedVenues: [...new Set([...(library.savedVenues || []), ...(value.savedVenues || [])])],
      dailyProgress: { ...library.dailyProgress, ...(value.dailyProgress || {}) },
      vocabulary: { ...library.vocabulary, ...(value.vocabulary || {}) }
    };
    library = migrateLibraryData(library, defaultLibrary);
    if (!saveLibrary()) throw new Error('导入内容无法写入浏览器存储');
    await repairPdfLibrary({ notify: false });
    renderRoute(); toast('合并导入完成');
  } catch (error) { toast(error.message || '导入失败'); }
}

const getStoredPdf = (paperId, attachmentId = null) => getPdfBundle(paperId, attachmentId);
const putStoredPdf = value => putPdfBundle(value);
const deleteStoredPdf = (paperId, attachmentId = null) => deletePdfAttachment(paperId, attachmentId);

async function loadPdfModule() {
  if (state.pdfModule) return state.pdfModule;
  const module = await import(`./vendor/pdfjs/pdf.mjs?v=${APP_VERSION}`);
  module.GlobalWorkerOptions.workerSrc = new URL(`./vendor/pdfjs/pdf.worker.mjs?v=${APP_VERSION}`, location.href).href;
  state.pdfModule = module;
  return module;
}
async function loadPdfLibModule() {
  if (!state.pdfLibModule) state.pdfLibModule = await import(`./vendor/pdf-lib/pdf-lib.mjs?v=${APP_VERSION}`);
  return state.pdfLibModule;
}
async function loadTesseractModule() {
  if (!state.tesseractModule) state.tesseractModule = await import(`./vendor/tesseract/tesseract.mjs?v=${APP_VERSION}`);
  return state.tesseractModule;
}
function pdfDocumentOptions(data) {
  return {
    data,
    cMapUrl: new URL('./vendor/pdfjs/cmaps/', location.href).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', location.href).href,
    wasmUrl: new URL('./vendor/pdfjs/wasm/', location.href).href,
    useSystemFonts: true,
    stopAtErrors: false,
    enableXfa: true
  };
}
function configurePdfPassword(loadingTask) {
  loadingTask.onPassword = (updatePassword, reason) => {
    const password = prompt(reason === 1 ? '此 PDF 受密码保护，请输入打开密码：' : '密码不正确，请重新输入：');
    if (password === null) loadingTask.destroy().catch(() => {});
    else updatePassword(password);
  };
}
function pdfPageText(content) {
  const items = (content.items || []).filter(item => typeof item.str === 'string' && item.str);
  let text = ''; let last = null;
  for (const item of items) {
    const x = Number(item.transform?.[4] || 0); const y = Number(item.transform?.[5] || 0);
    const height = Math.max(1, Math.hypot(Number(item.transform?.[2] || 0), Number(item.transform?.[3] || 0)));
    if (last) {
      const lineChanged = Math.abs(y - last.y) > Math.max(height, last.height) * .7;
      if (lineChanged && !text.endsWith('\n')) text += '\n';
      else {
        const expectedEnd = last.x + Math.max(0, Number(last.width || 0));
        const gap = x - expectedEnd;
        if (gap > Math.max(height, last.height) * .12 && !/[\s-]$/.test(text)) text += ' ';
      }
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    last = { x, y, height, width: Number(item.width || 0) };
  }
  return text.normalize('NFC').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
function usefulPdfText(text) {
  const value = String(text || '').trim();
  if (value.length < 3) return false;
  const useful = (value.match(/[\p{L}\p{N}]/gu) || []).length;
  return useful / value.length >= .12;
}
async function extractPdfPageText(page) {
  const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: false });
  const text = pdfPageText(content);
  return { text: usefulPdfText(text) ? text : '', content, itemCount: (content.items || []).filter(item => typeof item.str === 'string').length };
}
function setPdfProgress(value, label) {
  if (el('pdf-progress')) el('pdf-progress').style.width = `${Math.max(0, Math.min(100, value))}%`;
  if (label && el('pdf-status')) el('pdf-status').textContent = label;
}
function storedPdfDefaults(stored) {
  if (!stored) return null;
  stored.pages ||= Array.from({ length: stored.pageCount || 0 }, () => '');
  stored.annotations ||= [];
  stored.workspaceNote = {
    html: String(stored.workspaceNote?.html || '').slice(0, 12_000_000),
    text: String(stored.workspaceNote?.text || '').slice(0, 200_000),
    images: Array.isArray(stored.workspaceNote?.images) ? stored.workspaceNote.images.filter(item => item?.id && /^data:image\//.test(item.dataUrl || '')).slice(0, 12) : [],
    updatedAt: stored.workspaceNote?.updatedAt || null
  };
  stored.ocrPages ||= {};
  stored.extractionErrors ||= {};
  stored.schemaVersion ||= 2;
  return stored;
}
function updatePdfImportProgress(jobId, value, label) {
  setPdfProgress(value, label);
  if (!jobId) return;
  const job = state.pdfImportQueue.find(item => item.id === jobId);
  if (!job) return;
  job.progress = Math.round(value);
  job.message = label;
  renderPdfImportQueue();
}
async function repairPdfLibrary({ notify = true } = {}) {
  const documents = await listPdfDocuments().catch(() => []);
  const byPaper = new Map();
  for (const document of documents) {
    if (!byPaper.has(document.paperId)) byPaper.set(document.paperId, []);
    byPaper.get(document.paperId).push(document);
  }
  let repaired = 0; let missing = 0;
  for (const [paperId, record] of Object.entries(library.records)) {
    if (!record?.pdfAttachment) continue;
    const candidates = byPaper.get(paperId) || [];
    const document = candidates.find(item => item.attachmentId === record.pdfAttachment.attachmentId) || candidates[0];
    if (!document) {
      record.pdfAttachment.missing = true;
      missing += 1;
      continue;
    }
    if (record.pdfAttachment.missing || !record.pdfAttachment.attachmentId) {
      const bundle = await getPdfBundle(paperId, document.attachmentId);
      record.pdfAttachment = pdfAttachmentMeta(bundle, record.pdfAttachment);
      record.pdfAttachments = [record.pdfAttachment, ...(record.pdfAttachments || []).filter(item => item.attachmentId !== record.pdfAttachment.attachmentId)];
      repaired += 1;
    }
  }
  for (const document of documents.filter(item => !library.records[item.paperId])) {
    const bundle = await getPdfBundle(document.paperId, document.attachmentId);
    const id = document.paperId.startsWith('local:') ? document.paperId : `local:recovered-${document.attachmentId}`;
    const metadata = derivePdfMetadata(bundle, { name: document.fileName });
    const paper = {
      id, title: metadata.title || document.fileName, abstract: metadata.excerpt, authors: metadata.authors,
      published: null, venue: '恢复的本地 PDF', venueName: '恢复的本地 PDF', source: '附件修复',
      kind: 'local', area: localPdfArea(metadata), link: metadata.doi ? `https://doi.org/${metadata.doi}` : '', doi: metadata.doi, qualityScore: 0, citationCount: 0
    };
    if (id !== document.paperId) await movePdfAttachment(document.paperId, id, document.attachmentId);
    const record = ensureRecord(paper);
    record.savedAt ||= new Date().toISOString();
    record.pdfAttachment = pdfAttachmentMeta(bundle);
    record.pdfAttachments = [record.pdfAttachment];
    repaired += 1;
  }
  if (repaired || missing) saveLibrary();
  if (notify) toast(`附件检查完成：修复 ${repaired} 项，缺失 ${missing} 项`);
  return { repaired, missing };
}
async function parseAndStorePdf(file, paperId, { attachmentId = null, preserveAnnotations = true, jobId = null, fingerprint = null } = {}) {
  if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) throw new Error('请选择 PDF 文件');
  if (file.size > 150 * 1024 * 1024) throw new Error('单个 PDF 不能超过 150 MB');
  const header = new TextDecoder('latin1').decode(await file.slice(0, 5).arrayBuffer());
  if (header !== '%PDF-') throw new Error('文件头不是有效的 PDF');
  const storage = await estimateStorage().catch(() => null);
  if (storage?.quota && storage.quota - storage.usage < file.size * 1.25) throw new Error('浏览器剩余空间不足，无法安全导入此 PDF');
  navigator.storage?.persist?.().catch(() => {});
  const previous = preserveAnnotations ? await getStoredPdf(paperId, attachmentId).catch(() => null) : null;
  const pdfjs = await loadPdfModule();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument(pdfDocumentOptions(bytes));
  configurePdfPassword(loadingTask);
  try {
    const pdf = await loadingTask.promise;
    const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
    const pages = []; const extractionErrors = {};
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (state.pdfImportCancelId === jobId) throw new DOMException('导入已取消', 'AbortError');
      updatePdfImportProgress(jobId, pageNumber / pdf.numPages * 92, `正在提取第 ${pageNumber}/${pdf.numPages} 页`);
      if (paperId === state.selectedPaperId) el('detail-pdf-status').textContent = `正在提取第 ${pageNumber}/${pdf.numPages} 页`;
      const page = await pdf.getPage(pageNumber);
      try { pages.push((await extractPdfPageText(page)).text); }
      catch (error) { pages.push(''); extractionErrors[pageNumber] = error.message || '文本层解析失败'; }
      finally { page.cleanup(); }
    }
    updatePdfImportProgress(jobId, 95, '正在安全保存 PDF');
    const result = {
      schemaVersion: 3,
      attachmentId: attachmentId || previous?.attachmentId || `attachment:${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`,
      paperId,
      primary: true,
      fileName: file.name,
      size: file.size,
      type: 'application/pdf',
      pageCount: pdf.numPages,
      pages,
      annotations: previous?.annotations || [],
      workspaceNote: previous?.workspaceNote || { html: '', text: '', images: [], updatedAt: null },
      ocrPages: {},
      extractionErrors,
      metadata: { title: metadata.info?.Title || '', author: metadata.info?.Author || '', subject: metadata.info?.Subject || '' },
      importedAt: new Date().toISOString(),
      fingerprint: fingerprint || await pdfFileFingerprint(file),
      blob: file.slice(0, file.size, 'application/pdf')
    };
    await putStoredPdf(result);
    updatePdfImportProgress(jobId, 100, '导入完成');
    return result;
  } finally {
    await loadingTask.destroy().catch(() => {});
    if (state.pdfImportCancelId === jobId) state.pdfImportCancelId = null;
  }
}
function pdfAttachmentMeta(stored, previous = {}) {
  storedPdfDefaults(stored);
  return {
    fileName: stored.fileName,
    size: stored.size,
    pageCount: stored.pageCount,
    importedAt: stored.importedAt,
    textPages: stored.pages.filter(Boolean).length,
    ocrPages: Object.keys(stored.ocrPages).length,
    annotationCount: stored.annotations.length,
    extractionErrors: Object.keys(stored.extractionErrors).length,
    lastPage: Number(previous.lastPage || 1),
    attachmentId: stored.attachmentId || previous.attachmentId || null,
    fingerprint: stored.fingerprint || previous.fingerprint || null
  };
}
function renderPdfAttachmentStatus(record) {
  const meta = record?.pdfAttachment;
  const attachmentCount = record?.pdfAttachments?.length || (meta ? 1 : 0);
  el('detail-pdf-status').textContent = meta?.missing ? `${meta.fileName} · 本机文件缺失，请重新导入或运行附件修复` : meta ? `${meta.fileName} · ${meta.pageCount} 页 · ${meta.textPages} 页有文本 · ${meta.annotationCount || 0} 条标注${meta.ocrPages ? ` · OCR ${meta.ocrPages} 页` : ''}${attachmentCount > 1 ? ` · 共 ${attachmentCount} 个版本` : ''}` : '尚未导入 PDF';
  el('detail-pdf-import').textContent = meta ? '替换 PDF' : '导入 PDF';
  for (const id of ['detail-pdf-open', 'detail-pdf-download']) el(id).classList.toggle('hidden', !meta || meta.missing);
  el('detail-pdf-remove').classList.toggle('hidden', !meta);
}
async function attachPdfToPaper(file, paperId) {
  const paper = getPaper(paperId); if (!paper) return;
  const existingRecord = getRecord(paperId);
  if (existingRecord?.pdfAttachment && !confirm('这篇论文已经有 PDF。替换后将保留现有标注，但 OCR 文本会重新生成。是否继续？')) return;
  const button = el('detail-pdf-import'); button.disabled = true; button.textContent = '正在解析…';
  try {
    const stored = await parseAndStorePdf(file, paperId, { attachmentId: existingRecord?.pdfAttachment?.attachmentId || null, preserveAnnotations: true });
    const record = ensureRecord(paper);
    record.pdfAttachment = pdfAttachmentMeta(stored, record.pdfAttachment || {});
    record.pdfAttachments = [record.pdfAttachment];
    record.savedAt ||= new Date().toISOString();
    if (!saveLibrary()) throw new Error('PDF 已保存，但文献索引保存失败；请运行附件修复');
    renderPdfAttachmentStatus(record);
    toast(`PDF 已导入：${stored.pageCount} 页，${record.pdfAttachment.textPages} 页可翻译`);
    await openPdfReader(paperId);
  } catch (error) { toast(error.message || 'PDF 导入失败'); }
  finally { button.disabled = false; renderPdfAttachmentStatus(getRecord(paperId)); }
}
function localPdfArea(metadata) {
  const text = `${metadata.title} ${metadata.excerpt}`.toLowerCase();
  return /architecture|processor|microarchitecture|accelerator|cache|memory system|interconnect|chiplet|risc-v|hardware/.test(text) ? 'architecture' : 'ai';
}
async function importStandalonePdf(file, { jobId = null, open = true, fingerprint = null, collectionId = null } = {}) {
  const id = `local:${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
  try {
    if (!jobId) toast('正在解析本地 PDF…');
    const stored = await parseAndStorePdf(file, id, { preserveAnnotations: false, jobId, fingerprint });
    const metadata = derivePdfMetadata(stored, file);
    const candidates = [...allPapers(), ...Object.values(library.records).map(record => getPaper(record?.paper?.id)).filter(Boolean)];
    const match = findPdfPaperMatch(metadata, candidates);
    if (match?.confidence >= .96 && !getRecord(match.paper.id)?.pdfAttachment) {
      const moved = await movePdfAttachment(id, match.paper.id, stored.attachmentId);
      const record = ensureRecord(match.paper);
      record.savedAt ||= new Date().toISOString();
      record.lastOpenedAt = new Date().toISOString();
      if (library.collections[collectionId]) record.collections = [...new Set([...(record.collections || []), collectionId])];
      record.pdfAttachment = pdfAttachmentMeta(moved);
      record.pdfAttachments = [record.pdfAttachment];
      if (!saveLibrary()) throw new Error('匹配成功，但文献索引保存失败');
      return { paperId: match.paper.id, matched: true, reason: match.reason, stored: moved };
    }
    const paper = {
      id, title: metadata.title, abstract: metadata.excerpt, authors: metadata.authors, published: null,
      venue: '本地 PDF', venueName: '本地 PDF', source: '本地导入', kind: 'local', area: localPdfArea(metadata),
      link: metadata.doi ? `https://doi.org/${metadata.doi}` : metadata.arxivId ? `https://arxiv.org/abs/${metadata.arxivId}` : '',
      doi: metadata.doi, arxivId: metadata.arxivId, citationCount: 0, qualityScore: 0,
      fileModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null
    };
    const record = ensureRecord(paper);
    record.savedAt = new Date().toISOString();
    record.lastOpenedAt = record.savedAt;
    if (library.collections[collectionId]) record.collections = [...new Set([...(record.collections || []), collectionId])];
    record.pdfAttachment = pdfAttachmentMeta(stored);
    record.pdfAttachments = [record.pdfAttachment];
    if (!saveLibrary()) throw new Error('PDF 已保存，但文献记录未能持久化');
    if (open) { navigate('library/saved'); openPaperRoute(id); }
    if (!jobId) toast('本地论文已加入文献库');
    return { paperId: id, matched: false, stored };
  } catch (error) {
    await deleteStoredPdf(id).catch(() => {});
    if (!jobId) toast(error.message || '本地 PDF 导入失败');
    throw error;
  }
}
function formatFileSize(size) {
  const value = Number(size || 0);
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}
async function updatePdfImportStorage() {
  const node = el('pdf-import-storage'); if (!node) return;
  const storage = await estimateStorage().catch(() => null);
  node.textContent = storage?.quota
    ? `浏览器存储：已用 ${formatFileSize(storage.usage)} / ${formatFileSize(storage.quota)}${storage.persisted ? ' · 已申请持久保存' : ''}`
    : '浏览器未提供存储配额信息';
}
function renderPdfImportQueue() {
  const container = el('pdf-import-queue'); if (!container) return;
  const labels = { queued: '等待中', processing: '处理中', success: '已完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' };
  container.innerHTML = state.pdfImportQueue.length ? state.pdfImportQueue.map(job => `
    <article class="pdf-import-job ${escapeHtml(job.status)}" data-pdf-import-job="${escapeHtml(job.id)}">
      <div class="pdf-import-job-main"><strong>${escapeHtml(job.fileName)}</strong><span>${formatFileSize(job.size)} · ${escapeHtml(labels[job.status] || job.status)}</span><small>${escapeHtml(job.message || '')}</small></div>
      <div class="pdf-import-job-progress"><i style="width:${Math.max(0, Math.min(100, Number(job.progress || 0)))}%"></i></div>
      <div class="pdf-import-job-actions">
        ${job.status === 'processing' ? '<button class="small" data-import-action="cancel">取消</button>' : ''}
        ${['failed', 'cancelled'].includes(job.status) ? '<button class="small" data-import-action="retry">重试</button>' : ''}
        ${job.status !== 'processing' ? '<button class="small" data-import-action="remove">移除</button>' : ''}
      </div>
    </article>`).join('') : '<div class="empty">拖入 PDF、选择多个文件或扫描一个文件夹。</div>';
  const active = state.pdfImportQueue.filter(job => ['queued', 'processing'].includes(job.status)).length;
  el('pdf-import-summary').textContent = active ? `${active} 个任务待处理` : state.pdfImportQueue.length ? '队列已处理完毕' : '尚未添加文件';
  if (el('mobile-import-count')) el('mobile-import-count').textContent = String(active);
  if (el('settings-import-summary')) el('settings-import-summary').textContent = active ? `${active} 个任务处理中` : `${state.pdfImportQueue.length} 个任务`;
}
function openPdfImportCenter() {
  el('pdf-import-modal').classList.add('open');
  renderPdfImportQueue();
  updatePdfImportStorage();
}
async function queuePdfFiles(files, { targetPaperId = null } = {}) {
  const pdfs = [...files].filter(file => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
  if (!pdfs.length) return toast('没有找到 PDF 文件');
  openPdfImportCenter();
  for (const file of pdfs) {
    const id = `import:${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
    const job = {
      id, file, blob: file, fileName: file.name, size: file.size, type: file.type || 'application/pdf',
      lastModified: file.lastModified || 0, targetPaperId, collectionId: el('pdf-import-collection')?.value || null, status: 'queued', progress: 0, message: '等待解析'
    };
    state.pdfImportQueue.push(job);
    await savePdfImportJob({ ...job, file: undefined }).catch(() => {});
  }
  renderPdfImportQueue();
  processPdfImportQueue();
}
async function processPdfImportQueue() {
  if (state.pdfImportActive) return;
  state.pdfImportActive = true;
  try {
    while (true) {
      const job = state.pdfImportQueue.find(item => item.status === 'queued');
      if (!job) break;
      job.status = 'processing'; job.progress = 1; job.message = '正在校验文件';
      renderPdfImportQueue();
      try {
        const fingerprint = await pdfFileFingerprint(job.file);
        const duplicate = (await listPdfDocuments()).find(document => document.fingerprint && document.fingerprint === fingerprint);
        if (duplicate) {
          job.status = 'skipped'; job.progress = 100; job.message = '相同 PDF 已在文献库中';
        } else if (job.targetPaperId) {
          const paper = getPaper(job.targetPaperId);
          if (!paper) throw new Error('目标论文不存在');
          const record = ensureRecord(paper);
          const stored = await parseAndStorePdf(job.file, job.targetPaperId, {
            attachmentId: record.pdfAttachment?.attachmentId || null,
            preserveAnnotations: true,
            jobId: job.id,
            fingerprint
          });
          record.pdfAttachment = pdfAttachmentMeta(stored, record.pdfAttachment || {});
          record.pdfAttachments = [record.pdfAttachment, ...(record.pdfAttachments || []).filter(item => item.attachmentId !== record.pdfAttachment.attachmentId)];
          record.savedAt ||= new Date().toISOString();
          if (library.collections[job.collectionId]) record.collections = [...new Set([...(record.collections || []), job.collectionId])];
          if (!saveLibrary()) throw new Error('文献索引保存失败');
          job.status = 'success'; job.progress = 100; job.message = '已附加到论文';
        } else {
          const result = await importStandalonePdf(job.file, { jobId: job.id, open: false, fingerprint, collectionId: job.collectionId });
          job.status = 'success'; job.progress = 100;
          job.message = result.matched ? `已自动关联：${result.reason}` : '已创建本地论文';
        }
        await deletePdfImportJob(job.id).catch(() => {});
      } catch (error) {
        job.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';
        job.message = error?.message || '导入失败';
        await savePdfImportJob({ ...job, file: undefined, blob: job.file }).catch(() => {});
      }
      renderPdfImportQueue();
    }
  } finally {
    state.pdfImportActive = false;
    renderPdfImportQueue();
    if (parseRoute().name === 'library') renderRoute();
  }
}
async function restorePdfImportQueue() {
  const pending = await loadPendingPdfImportJobs().catch(() => []);
  for (const saved of pending) {
    if (!saved.blob) continue;
    const file = new File([saved.blob], saved.fileName, { type: saved.type || 'application/pdf', lastModified: saved.lastModified || Date.now() });
    state.pdfImportQueue.push({ ...saved, file, status: saved.status === 'processing' ? 'queued' : saved.status, progress: saved.status === 'processing' ? 0 : saved.progress || 0 });
  }
  if (state.pdfImportQueue.some(job => job.status === 'queued')) processPdfImportQueue();
}
async function choosePdfDirectory() {
  if ('showDirectoryPicker' in window) {
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read', id: 'paperscope-pdf-library' });
      const files = [];
      async function visit(handle) {
        for await (const entry of handle.values()) {
          if (entry.kind === 'directory') await visit(entry);
          else if (/\.pdf$/i.test(entry.name)) files.push(await entry.getFile());
        }
      }
      await visit(directory);
      return queuePdfFiles(files);
    } catch (error) {
      if (error?.name !== 'AbortError') toast(`读取文件夹失败：${error.message}`);
      return;
    }
  }
  el('local-pdf-directory').click();
}
async function openPdfReader(paperId) {
  try {
    const storedValue = await getStoredPdf(paperId, getRecord(paperId)?.pdfAttachment?.attachmentId || null);
    if (!storedValue) throw new Error('本地 PDF 文件不存在，可能已被浏览器清理');
    const stored = storedPdfDefaults(storedValue);
    if (!stored?.blob) throw new Error('本地 PDF 文件不存在，可能已被浏览器清理');
    if (state.pdfLoadingTask) await state.pdfLoadingTask.destroy().catch(() => {});
    const pdfjs = await loadPdfModule();
    state.pdfLoadingTask = pdfjs.getDocument(pdfDocumentOptions(new Uint8Array(await stored.blob.arrayBuffer())));
    configurePdfPassword(state.pdfLoadingTask);
    state.pdfDocument = await state.pdfLoadingTask.promise;
    state.pdfRecord = stored; state.pdfPaperId = paperId;
    state.pdfPage = Math.max(1, Math.min(stored.pageCount, Number(getRecord(paperId)?.pdfAttachment?.lastPage || 1)));
    state.pdfScale = clampPdfZoomPercent(localStorage.getItem(PDF_ZOOM_KEY), state.pdfScale * 100) / 100;
    syncPdfZoomControls();
    state.pdfColumnTemplate = null;
    clearPdfBrowseSelection();
    state.pdfAnnotationHistory = []; state.pdfAnnotationMode = null; state.pdfSelection = null;
    state.pdfViewMode = localStorage.getItem(PDF_VIEW_MODE_KEY) === 'paged' ? 'paged' : 'continuous';
    el('pdf-view-mode').value = state.pdfViewMode;
    el('pdf-title').textContent = getPaper(paperId)?.title || stored.fileName;
    el('pdf-meta').textContent = `${stored.fileName} · ${(stored.size / 1024 / 1024).toFixed(1)} MB · 本机存储 · ${stored.annotations.length} 条标注`;
    clearPdfSearch();
    el('pdf-modal').classList.add('open');
    state.pdfNoteDirty = false;
    renderPdfWorkspaceNote();
    applyPdfInspectorState();
    updatePdfAnnotationMode();
    await renderPdfPage();
  } catch (error) { toast(error.message || '无法打开 PDF'); }
}
function clearPdfPageObservers() {
  discardPdfTextSelectionDraft();
  clearPdfBrowseSelection();
  closeTranslationPopover();
  state.pdfContinuousObserver?.disconnect();
  state.pdfPageObserver?.disconnect();
  state.pdfContinuousObserver = null; state.pdfPageObserver = null;
  state.pdfContinuousTasks.clear(); state.pdfPageVisibility.clear();
}
function createPdfPageStack(pageNumber, viewport, primary = false) {
  const stack = document.createElement('div');
  stack.className = 'pdf-page-stack'; stack.dataset.pdfPageStack = ''; stack.dataset.page = String(pageNumber);
  stack.style.width = `${Math.floor(viewport.width)}px`; stack.style.height = `${Math.floor(viewport.height)}px`;
  const canvas = document.createElement('canvas'); canvas.className = 'pdf-page-canvas';
  const textLayer = document.createElement('div'); textLayer.className = 'textLayer'; textLayer.dataset.translatable = '';
  const annotationLayer = document.createElement('div'); annotationLayer.className = 'pdf-annotation-layer';
  const pageNumberLabel = document.createElement('span'); pageNumberLabel.className = 'pdf-page-number'; pageNumberLabel.textContent = String(pageNumber);
  if (primary) {
    stack.id = 'pdf-page-stack'; canvas.id = 'pdf-canvas'; textLayer.id = 'pdf-text-layer'; annotationLayer.id = 'pdf-annotation-layer';
  }
  stack.append(canvas, textLayer, annotationLayer, pageNumberLabel);
  return stack;
}
function pdfStackForPage(pageNumber = state.pdfPage) {
  return el('pdf-pages-container')?.querySelector(`[data-pdf-page-stack][data-page="${Number(pageNumber)}"]`) || null;
}
function readerTextMode() {
  return ['paragraphs', 'bilingual', 'plain'].includes(uiSettings.readerTextMode) ? uiSettings.readerTextMode : 'paragraphs';
}
function currentPdfTextBlocks() {
  return segmentReaderText(state.pdfRecord?.pages?.[state.pdfPage - 1] || '');
}
function renderPdfPageText(text) {
  const container = el('pdf-page-text'); if (!container) return;
  const mode = readerTextMode(); const modeSelect = el('pdf-text-mode'); const translateButton = el('pdf-translate-page');
  if (modeSelect) modeSelect.value = mode;
  if (translateButton) translateButton.classList.toggle('hidden', mode !== 'bilingual' || !text);
  const help = el('pdf-text-help');
  if (help) help.textContent = mode === 'bilingual'
    ? '原文与译文逐段对照；译文只缓存在当前浏览器。'
    : mode === 'plain' ? '保留 PDF 提取顺序，适合复制和全文检索。' : '已按标题和语义边界分段，选择文字可翻译或标注。';
  container.className = `pdf-page-text ${mode}`;
  if (!text) {
    container.classList.add('empty');
    container.textContent = '这一页没有可提取的文本。若它是扫描图片，请点击“OCR 本页”；识别结果会保存在当前浏览器。';
    return;
  }
  if (mode === 'plain') {
    container.textContent = text;
    return;
  }
  const blocks = currentPdfTextBlocks();
  container.innerHTML = blocks.map((block, index) => {
    const cached = mode === 'bilingual' ? cachedTranslation(block.text) : null;
    const translation = cached?.translation || '';
    return `<article class="pdf-text-block ${escapeHtml(block.kind)}" data-pdf-paragraph="${index}"><div class="pdf-text-block-head"><span>${block.kind === 'heading' ? '段落标题' : String(index + 1).padStart(2, '0')}</span>${mode === 'bilingual' && block.kind !== 'heading' ? `<button type="button" data-pdf-translate-paragraph="${index}">${translation ? '刷新译文' : '翻译此段'}</button>` : ''}</div><p class="pdf-text-source" data-translatable>${escapeHtml(block.text)}</p>${mode === 'bilingual' && block.kind !== 'heading' ? `<p class="pdf-text-translation ${translation ? '' : 'pending'}">${escapeHtml(translation || '尚未翻译。可逐段翻译，或使用上方“翻译本页”。')}</p>` : ''}</article>`;
  }).join('');
}
async function translateReaderParagraph(source) {
  const cached = cachedTranslation(source); if (cached?.translation) return cached.translation;
  if (!translationSettings.enabled) throw new Error('请先在阅读与翻译设置中启用翻译');
  const context = getPaper(state.pdfPaperId)?.title || '';
  let translation = ''; let provider = '';
  if (translationSettings.mode === 'online' && safeTranslationEndpoint()) {
    const result = await requestOnlineTranslation({ source, context });
    translation = normalizedTranslationText(result.translation); provider = result.provider || '在线精译';
  } else {
    try {
      const translator = await prepareTranslator();
      translation = normalizedTranslationText(await translator.translate(source));
      provider = '浏览器本地模型';
    } catch (error) {
      if (translationSettings.mode !== 'offline' && safeTranslationEndpoint()) {
        const result = await requestOnlineTranslation({ source, context });
        translation = normalizedTranslationText(result.translation); provider = result.provider || '在线精译';
      } else throw error;
    }
  }
  if (!translation) throw new Error('翻译服务没有返回内容');
  storeTranslation(source, translation, { provider });
  return translation;
}
async function translatePdfParagraph(index) {
  const block = currentPdfTextBlocks()[Number(index)]; if (!block?.text || block.kind === 'heading') return;
  const button = el('pdf-page-text')?.querySelector(`[data-pdf-translate-paragraph="${Number(index)}"]`);
  const result = el('pdf-page-text')?.querySelector(`[data-pdf-paragraph="${Number(index)}"] .pdf-text-translation`);
  if (button) { button.disabled = true; button.textContent = '翻译中…'; }
  if (result) { result.textContent = '正在生成译文…'; result.classList.add('pending'); }
  try {
    await translateReaderParagraph(block.text);
    renderPdfPageText(state.pdfRecord?.pages?.[state.pdfPage - 1] || '');
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = '重试翻译'; }
    if (result) result.textContent = `翻译失败：${error.message || '请稍后重试'}`;
  }
}
async function translatePdfCurrentPage() {
  const button = el('pdf-translate-page'); const blocks = currentPdfTextBlocks().filter(block => block.kind !== 'heading' && /[A-Za-z]/.test(block.text)).slice(0, 24);
  if (!blocks.length) return toast('当前页没有可翻译的英文段落');
  button.disabled = true;
  try {
    for (let index = 0; index < blocks.length; index += 1) {
      button.textContent = `翻译 ${index + 1}/${blocks.length}`;
      await translateReaderParagraph(blocks[index].text);
    }
    renderPdfPageText(state.pdfRecord?.pages?.[state.pdfPage - 1] || '');
    toast(`已生成 ${blocks.length} 段对照译文`);
  } catch (error) {
    renderPdfPageText(state.pdfRecord?.pages?.[state.pdfPage - 1] || '');
    toast(`页面翻译未完成：${error.message || '请稍后重试'}`);
  } finally {
    button.disabled = false; button.textContent = '翻译本页';
  }
}
function updatePdfCurrentPage(pageNumber, { save = true } = {}) {
  if (!state.pdfDocument || !state.pdfRecord) return;
  state.pdfPage = Math.max(1, Math.min(state.pdfDocument.numPages, Number(pageNumber) || 1));
  const text = state.pdfRecord.pages[state.pdfPage - 1] || '';
  renderPdfPageText(text);
  el('pdf-page-label').textContent = `${state.pdfPage} / ${state.pdfDocument.numPages}`;
  el('pdf-prev').disabled = state.pdfPage <= 1; el('pdf-next').disabled = state.pdfPage >= state.pdfDocument.numPages;
  renderPdfAnnotationList();
  const attachment = getRecord(state.pdfPaperId)?.pdfAttachment;
  if (save && attachment && attachment.lastPage !== state.pdfPage) { attachment.lastPage = state.pdfPage; saveLibrary(); }
  const readyLabel = state.pdfAnnotationMode ? '页面工具已启用' : translationSettings.enabled ? '可选择文字翻译' : '可选择文字、复制、标注或截图';
  setPdfProgress(100, text ? `第 ${state.pdfPage} 页 · ${readyLabel}` : `第 ${state.pdfPage} 页 · 未检测到文本层`);
}
function syncPdfZoomControls(percent = clampPdfZoomPercent(state.pdfScale * 100)) {
  const value = String(clampPdfZoomPercent(percent));
  if (el('pdf-zoom')) el('pdf-zoom').value = value;
  if (el('pdf-zoom-range')) el('pdf-zoom-range').value = value;
  if (el('pdf-zoom-output')) el('pdf-zoom-output').textContent = `${value}%`;
}
async function applyPdfZoomPercent(value, { render = true } = {}) {
  const percent = clampPdfZoomPercent(value, state.pdfScale * 100);
  clearTimeout(state.pdfZoomTimer); state.pdfZoomTimer = null;
  state.pdfScale = percent / 100;
  localStorage.setItem(PDF_ZOOM_KEY, String(percent));
  syncPdfZoomControls(percent);
  if (render && state.pdfDocument) await renderPdfPage();
}
function schedulePdfZoom(value) {
  const percent = clampPdfZoomPercent(value, state.pdfScale * 100);
  state.pdfScale = percent / 100;
  syncPdfZoomControls(percent);
  clearTimeout(state.pdfZoomTimer);
  state.pdfZoomTimer = setTimeout(() => applyPdfZoomPercent(percent), 140);
}
async function renderPdfPage() {
  if (!state.pdfDocument || !state.pdfRecord) return;
  clearPdfPageObservers();
  el('pdf-canvas-stage').classList.toggle('continuous', state.pdfViewMode === 'continuous');
  if (state.pdfViewMode === 'continuous') return renderPdfContinuousPages();
  const pageNumber = Math.max(1, Math.min(state.pdfDocument.numPages, state.pdfPage));
  state.pdfPage = pageNumber; setPdfProgress(20, `正在渲染第 ${pageNumber} 页`);
  if (state.pdfRenderTask) state.pdfRenderTask.cancel();
  const page = await state.pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: state.pdfScale });
  const stack = createPdfPageStack(pageNumber, viewport, true);
  el('pdf-pages-container').replaceChildren(stack);
  el('pdf-canvas-stage').scrollTop = 0; el('pdf-canvas-stage').scrollLeft = 0;
  await renderPdfPageIntoStack(page, stack, viewport, true);
  // Canvas/text rendering can change the scrollable extent and let browser
  // scroll anchoring restore an old offset. Paged mode must always open at
  // the top-left of the newly rendered page.
  el('pdf-canvas-stage').scrollTop = 0; el('pdf-canvas-stage').scrollLeft = 0;
  page.cleanup();
  updatePdfCurrentPage(pageNumber);
  updatePdfAnnotationMode();
}
async function renderPdfPageIntoStack(page, stack, viewport, current = false) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = stack.querySelector('.pdf-page-canvas'); const context = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
  const renderTask = page.render({ canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
  if (current) state.pdfRenderTask = renderTask;
  await renderTask.promise;
  if (current) state.pdfRenderTask = null;
  let textContent = null;
  try { textContent = await page.getTextContent({ includeMarkedContent: true, disableNormalization: false }); } catch {}
  if (current) state.pdfTextContent = textContent;
  await renderPdfTextLayer(textContent, viewport, stack.querySelector('.textLayer'));
  renderPdfAnnotationLayer(viewport, Number(stack.dataset.page), stack.querySelector('.pdf-annotation-layer'));
  stack.dataset.renderedScale = String(state.pdfScale);
}
async function renderPdfTextLayer(textContent, viewport, layer = pdfStackForPage()?.querySelector('.textLayer')) {
  if (!layer) return;
  layer.replaceChildren();
  layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`;
  const totalScale = Number(viewport.scale) || state.pdfScale;
  // PDF.js 6 text_layer_builder.css sizes glyphs with
  // --total-scale-factor. Setting only the legacy --scale-factor leaves
  // large headings at the fallback 13px size, so hit boxes no longer match
  // the canvas and selections end far before the visible text.
  layer.style.setProperty('--scale-factor', totalScale);
  layer.style.setProperty('--total-scale-factor', totalScale);
  if (!textContent?.items?.length) return;
  try {
    const pdfjs = await loadPdfModule();
    const textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: layer, viewport });
    await textLayer.render();
  } catch (error) {
    console.warn('PDF text layer render failed', error);
  }
}
async function renderPdfContinuousStack(stack) {
  const pageNumber = Number(stack.dataset.page);
  if (!pageNumber || stack.dataset.renderedScale === String(state.pdfScale)) return;
  const existing = state.pdfContinuousTasks.get(pageNumber); if (existing) return existing;
  const task = (async () => {
    const page = await state.pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.pdfScale });
    stack.style.width = `${Math.floor(viewport.width)}px`; stack.style.height = `${Math.floor(viewport.height)}px`;
    await renderPdfPageIntoStack(page, stack, viewport, pageNumber === state.pdfPage);
    page.cleanup();
  })().catch(error => console.warn(`PDF page ${pageNumber} render failed`, error)).finally(() => state.pdfContinuousTasks.delete(pageNumber));
  state.pdfContinuousTasks.set(pageNumber, task);
  return task;
}
async function renderPdfContinuousPages() {
  const container = el('pdf-pages-container'); container.replaceChildren();
  setPdfProgress(8, '正在准备连续阅读');
  for (let pageNumber = 1; pageNumber <= state.pdfDocument.numPages; pageNumber += 1) {
    const page = await state.pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.pdfScale });
    page.cleanup();
    const stack = createPdfPageStack(pageNumber, viewport);
    renderPdfAnnotationLayer(viewport, pageNumber, stack.querySelector('.pdf-annotation-layer'));
    container.appendChild(stack);
  }
  const stage = el('pdf-canvas-stage');
  if ('IntersectionObserver' in window) {
    state.pdfContinuousObserver = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => renderPdfContinuousStack(entry.target));
    }, { root: stage, rootMargin: '1400px 0px', threshold: 0 });
    state.pdfPageObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => state.pdfPageVisibility.set(Number(entry.target.dataset.page), entry.isIntersecting ? entry.intersectionRatio : 0));
      const visible = [...state.pdfPageVisibility.entries()].sort((a, b) => b[1] - a[1])[0];
      if (visible?.[1] > 0) updatePdfCurrentPage(visible[0]);
    }, { root: stage, threshold: [0.15, 0.35, 0.55, 0.75] });
    container.querySelectorAll('[data-pdf-page-stack]').forEach(stack => {
      state.pdfContinuousObserver.observe(stack); state.pdfPageObserver.observe(stack);
    });
  }
  const current = pdfStackForPage(state.pdfPage);
  if (current) {
    stage.scrollTop = Math.max(0, current.offsetTop - 24);
    await renderPdfContinuousStack(current);
    const next = pdfStackForPage(state.pdfPage + 1); if (next) renderPdfContinuousStack(next);
    const previous = pdfStackForPage(state.pdfPage - 1); if (previous) renderPdfContinuousStack(previous);
  }
  updatePdfCurrentPage(state.pdfPage, { save: false });
  updatePdfAnnotationMode();
}
async function goToPdfPage(pageNumber, { behavior = 'smooth' } = {}) {
  if (!state.pdfDocument) return;
  state.pdfPage = Math.max(1, Math.min(state.pdfDocument.numPages, Number(pageNumber) || 1));
  if (state.pdfViewMode === 'continuous') {
    const stack = pdfStackForPage(state.pdfPage);
    if (stack) {
      await renderPdfContinuousStack(stack);
      el('pdf-canvas-stage').scrollTo({ top: Math.max(0, stack.offsetTop - 24), behavior });
      updatePdfCurrentPage(state.pdfPage);
    }
  } else await renderPdfPage();
}
function pdfAnnotationColor(color, alpha = 1) {
  const hex = String(color || '#f4d35e').replace('#', '');
  const value = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex.padEnd(6, '0').slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16) || 0);
  return { r: r / 255, g: g / 255, b: b / 255, css: `rgba(${r},${g},${b},${alpha})` };
}
function currentPdfAnnotations() { return state.pdfRecord?.annotations || []; }
function renderPdfAnnotationLayer(viewport, pageNumber = state.pdfPage, layer = pdfStackForPage(pageNumber)?.querySelector('.pdf-annotation-layer')) {
  if (!layer) return;
  layer.replaceChildren();
  layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`;
  const annotations = currentPdfAnnotations();
  const highlightSurface = document.createElement('div');
  highlightSurface.className = 'pdf-highlight-surface';
  layer.append(highlightSurface);
  for (const annotation of annotations.filter(item => item.page === pageNumber)) {
    const number = annotations.indexOf(annotation) + 1;
    for (const rect of annotation.rects || []) {
      const mark = document.createElement('button');
      mark.type = 'button'; mark.className = `pdf-annotation-mark ${annotation.type}`;
      mark.dataset.annotationId = annotation.id; mark.dataset.number = String(number);
      mark.title = annotation.comment || annotation.text || `标注 ${number}`;
      mark.style.left = `${rect.x * 100}%`; mark.style.top = `${rect.y * 100}%`; mark.style.width = `${rect.width * 100}%`; mark.style.height = `${rect.height * 100}%`;
      const color = pdfAnnotationColor(annotation.color, annotation.type === 'highlight' ? 1 : .12);
      mark.style.background = color.css; mark.style.borderColor = color.css.replace(/,[\d.]+\)$/, ',1)');
      (annotation.type === 'highlight' ? highlightSurface : layer).appendChild(mark);
    }
  }
  layer.classList.toggle('drawing', ['area', 'area-note', 'snapshot'].includes(state.pdfAnnotationMode));
  layer.classList.toggle('snapshot', state.pdfAnnotationMode === 'snapshot');
  renderPdfSearchHighlightsForStack(layer.closest('[data-pdf-page-stack]'));
}
function annotationTypeLabel(type) { return type === 'highlight' ? '高亮' : type === 'underline' ? '下划线' : type === 'note' ? '批注' : '区域'; }
function preferredReaderControlsPlacement() {
  return 'sidebar';
}
function pdfPaneWidthBounds() {
  const readerWidth = el('pdf-reader')?.getBoundingClientRect().width || innerWidth;
  return { min: 220, max: Math.max(220, Math.min(520, Math.floor(readerWidth * .48))) };
}
function defaultPdfPaneWidth() { return uiSettings.readerPane === 'wide' ? 320 : 270; }
function applyPdfPaneWidth(value = state.pdfPaneWidth || defaultPdfPaneWidth(), { save = false } = {}) {
  const reader = el('pdf-reader'); const resizer = el('pdf-pane-resizer');
  if (!reader || !resizer) return;
  const bounds = pdfPaneWidthBounds();
  const width = Math.round(Math.max(bounds.min, Math.min(bounds.max, Number(value) || defaultPdfPaneWidth())));
  state.pdfPaneWidth = width;
  reader.style.setProperty('--reader-pane-width', `${width}px`);
  resizer.setAttribute('aria-valuemin', String(bounds.min));
  resizer.setAttribute('aria-valuemax', String(bounds.max));
  resizer.setAttribute('aria-valuenow', String(width));
  resizer.title = `阅读侧栏 ${width}px · 拖动或方向键调整，双击恢复`;
  if (save) localStorage.setItem(PDF_PANE_WIDTH_KEY, String(width));
}
function placePdfReaderControls() {
  const config = el('pdf-toolbar-config'); const topSlot = el('pdf-toolbar-controls-slot'); const sideSlot = el('pdf-sidebar-controls-slot');
  if (!config || !topSlot || !sideSlot) return;
  if (config.parentElement !== sideSlot) sideSlot.append(config);
  topSlot.classList.add('hidden');
  sideSlot.classList.remove('hidden');
  document.documentElement.dataset.pdfControlsPlacement = preferredReaderControlsPlacement();
}
function syncPdfReaderPreferences() {
  document.documentElement.dataset.readerPane = uiSettings.readerPane === 'wide' ? 'wide' : 'standard';
  uiSettings.noteFontSize = clampPdfNoteFontSize(uiSettings.noteFontSize, uiSettings.noteFont === 'large' ? 16 : 14);
  document.documentElement.style.setProperty('--pdf-note-font-size', `${uiSettings.noteFontSize}px`);
  if (el('pdf-note-font-size')) el('pdf-note-font-size').value = String(uiSettings.noteFontSize);
  placePdfReaderControls();
  applyPdfPaneWidth();
}
function applyPdfInspectorState() {
  const pane = el('pdf-text-pane'); const reader = el('pdf-reader'); const toggle = el('pdf-inspector-toggle'); const resizer = el('pdf-pane-resizer');
  if (!pane || !reader || !toggle) return;
  pane.classList.toggle('hidden', !state.pdfInspectorOpen);
  resizer?.classList.toggle('hidden', !state.pdfInspectorOpen);
  reader.classList.toggle('inspector-hidden', !state.pdfInspectorOpen);
  toggle.setAttribute('aria-expanded', String(state.pdfInspectorOpen));
  document.querySelectorAll('[data-pdf-pane-tab]').forEach(button => {
    const active = button.dataset.pdfPaneTab === state.pdfInspectorTab;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  el('pdf-pane-annotations').classList.toggle('hidden', state.pdfInspectorTab !== 'annotations');
  el('pdf-pane-notes').classList.toggle('hidden', state.pdfInspectorTab !== 'notes');
  placePdfReaderControls();
  applyPdfPaneWidth();
}
function setPdfInspector(open, tab = state.pdfInspectorTab) {
  state.pdfInspectorOpen = Boolean(open);
  state.pdfInspectorTab = tab === 'notes' ? 'notes' : 'annotations';
  localStorage.setItem(PDF_INSPECTOR_OPEN_KEY, state.pdfInspectorOpen ? 'open' : 'closed');
  localStorage.setItem(PDF_INSPECTOR_TAB_KEY, state.pdfInspectorTab);
  if (state.pdfInspectorTab === 'notes') {
    document.querySelector('.pdf-export-menu')?.removeAttribute('open');
    el('pdf-search-results')?.classList.add('hidden');
    requestAnimationFrame(() => el('pdf-workspace-editor')?.focus({ preventScroll: true }));
  }
  applyPdfInspectorState();
}
function renderPdfAnnotationList(selectedId = null) {
  const annotations = currentPdfAnnotations();
  el('pdf-inspector-count').textContent = String(annotations.length);
  el('pdf-annotation-list').innerHTML = annotations.length ? annotations.map((item, index) => `<article class="pdf-annotation-item ${selectedId === item.id ? 'selected' : ''}" style="border-left-color:${escapeHtml(item.color)}" data-pdf-annotation-id="${escapeHtml(item.id)}"><strong>${index + 1}. 第 ${item.page} 页 · ${annotationTypeLabel(item.type)}</strong>${item.text ? `<p>${escapeHtml(item.text.slice(0, 220))}</p>` : ''}${item.comment ? `<p>批注：${escapeHtml(item.comment)}</p>` : ''}<div class="pdf-annotation-actions"><button data-pdf-annotation-action="goto">定位</button><button data-pdf-annotation-action="comment">编辑批注</button><button data-pdf-annotation-action="delete">删除</button></div></article>`).join('') : '<div class="mono">暂无 PDF 标注。选择页面文字或使用区域工具开始标注。</div>';
}
async function persistPdfRecord(kind = 'annotations') {
  const pdfRecord = state.pdfRecord; const paperId = state.pdfPaperId;
  if (!pdfRecord || !paperId) return;
  if (kind === 'text') await putPdfTextState(pdfRecord);
  else if (kind === 'workspace') await putPdfWorkspaceNote(paperId, pdfRecord.attachmentId, pdfRecord.workspaceNote);
  else await putPdfAnnotations(paperId, pdfRecord.attachmentId, pdfRecord.annotations);
  const record = getRecord(paperId);
  if (record) {
    record.pdfAttachment = pdfAttachmentMeta(pdfRecord, record.pdfAttachment || {}); saveLibrary();
    if (state.selectedPaperId === paperId) renderPdfAttachmentStatus(record);
  }
  if (state.pdfRecord === pdfRecord) el('pdf-meta').textContent = `${pdfRecord.fileName} · ${(pdfRecord.size / 1024 / 1024).toFixed(1)} MB · 本机存储 · ${pdfRecord.annotations.length} 条标注`;
}
const PDF_NOTE_MAX_IMAGES = 12;
const PDF_NOTE_MAX_BYTES = 8 * 1024 * 1024;
function currentPdfWorkspaceNote() {
  if (!state.pdfRecord) return null;
  state.pdfRecord.workspaceNote ||= { html: '', text: '', images: [], updatedAt: null };
  return state.pdfRecord.workspaceNote;
}
function sanitizePdfWorkspaceHtml(html = '') {
  const source = document.createElement('template'); const output = document.createElement('div');
  source.innerHTML = String(html || '').slice(0, 12_000_000);
  const allowed = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H2', 'H3', 'FIGURE', 'FIGCAPTION', 'IMG']);
  let imageCount = 0; let textCount = 0;
  const clean = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = String(node.textContent || '').slice(0, Math.max(0, 200_000 - textCount));
      textCount += value.length;
      return document.createTextNode(value);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (node.tagName === 'IMG') {
      const src = String(node.getAttribute('src') || '');
      if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src) || imageCount >= PDF_NOTE_MAX_IMAGES) return document.createDocumentFragment();
      imageCount += 1;
      const image = document.createElement('img');
      image.src = src; image.alt = String(node.getAttribute('alt') || '阅读笔记图片').slice(0, 120);
      image.className = 'pdf-note-inline-image';
      return image;
    }
    const fragment = document.createDocumentFragment();
    if (!allowed.has(node.tagName)) {
      [...node.childNodes].forEach(child => fragment.append(clean(child)));
      return fragment;
    }
    const element = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === 'FIGURE') {
      element.className = 'pdf-note-figure';
      element.dataset.pdfNoteImage = String(node.dataset.pdfNoteImage || `note-image-${Date.now()}-${imageCount}`).slice(0, 120);
      element.dataset.pdfNoteWidth = String(clampPdfNoteImageWidth(node.dataset.pdfNoteWidth));
    }
    [...node.childNodes].forEach(child => element.append(clean(child)));
    return element;
  };
  [...source.content.childNodes].forEach(node => output.append(clean(node)));
  return output.innerHTML;
}
function legacyPdfWorkspaceHtml(note) {
  const root = document.createElement('div');
  const text = String(note?.text || '');
  if (text) {
    text.split(/\n/).forEach(line => {
      const paragraph = document.createElement('p');
      if (line) paragraph.textContent = line; else paragraph.append(document.createElement('br'));
      root.append(paragraph);
    });
  }
  for (const image of Array.isArray(note?.images) ? note.images : []) {
    if (!/^data:image\//.test(image?.dataUrl || '')) continue;
    const figure = document.createElement('figure'); figure.className = 'pdf-note-figure';
    figure.dataset.pdfNoteImage = String(image.id || `note-image-${Date.now()}`);
    const img = document.createElement('img'); img.src = image.dataUrl; img.alt = String(image.name || '阅读笔记图片');
    const caption = document.createElement('figcaption'); caption.textContent = image.name || '阅读笔记图片';
    figure.append(img, caption); root.append(figure);
  }
  return sanitizePdfWorkspaceHtml(root.innerHTML);
}
function pdfWorkspaceDocumentHtml(note = currentPdfWorkspaceNote()) {
  if (!note) return '';
  return sanitizePdfWorkspaceHtml(note.html || legacyPdfWorkspaceHtml(note));
}
function decoratePdfWorkspaceEditor(editor = el('pdf-workspace-editor')) {
  if (!editor) return;
  for (const image of [...editor.querySelectorAll('img')]) {
    if (!image.closest('figure')) {
      const figure = document.createElement('figure'); figure.className = 'pdf-note-figure';
      figure.dataset.pdfNoteImage = crypto.randomUUID ? crypto.randomUUID() : `note-image-${Date.now()}`;
      image.replaceWith(figure); figure.append(image);
    }
  }
  for (const figure of editor.querySelectorAll('figure')) {
    figure.className = 'pdf-note-figure';
    figure.dataset.pdfNoteImage ||= crypto.randomUUID ? crypto.randomUUID() : `note-image-${Date.now()}`;
    figure.dataset.pdfNoteWidth = String(clampPdfNoteImageWidth(figure.dataset.pdfNoteWidth));
    figure.style.setProperty('--pdf-note-image-width', `${figure.dataset.pdfNoteWidth}%`);
    figure.contentEditable = 'false';
    if (!figure.querySelector('figcaption')) {
      const caption = document.createElement('figcaption');
      caption.textContent = figure.querySelector('img')?.alt || '阅读笔记图片';
      figure.append(caption);
    }
    if (!figure.querySelector('[data-pdf-note-image-controls]')) {
      const controls = document.createElement('div'); controls.className = 'pdf-note-figure-actions';
      controls.dataset.pdfNoteImageControls = '';
      const actions = [
        ['shrink', '−', '缩小图片'],
        ['grow', '+', '放大图片'],
        ['delete', '删除', '删除图片']
      ];
      for (const [action, label, title] of actions) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.pdfNoteImageAction = action; button.textContent = label;
        button.title = title; button.setAttribute('aria-label', title); controls.append(button);
      }
      figure.append(controls);
    }
  }
}
function pdfWorkspaceImageElements() {
  return [...(el('pdf-workspace-editor')?.querySelectorAll('img[src^="data:image/"]') || [])];
}
function pdfNoteDataBytes(note = currentPdfWorkspaceNote()) {
  const html = note?.html || legacyPdfWorkspaceHtml(note);
  const template = document.createElement('template'); template.innerHTML = html;
  return [...template.content.querySelectorAll('img[src^="data:image/"]')].reduce((total, image) => total + Math.ceil(String(image.getAttribute('src') || '').length * .75), 0);
}
function renderPdfNoteStatus(note = currentPdfWorkspaceNote(), prefix = '') {
  const status = el('pdf-note-status'); if (!status || !note) return;
  const count = pdfWorkspaceImageElements().length;
  const saved = note.updatedAt ? `已保存 ${dateText(note.updatedAt, true)}` : '尚未保存';
  status.textContent = `${prefix || saved} · ${count}/${PDF_NOTE_MAX_IMAGES} 张 · ${(pdfNoteDataBytes(note) / 1024 / 1024).toFixed(1)} MB`;
}
function pdfWorkspaceEditorHtml(editor = el('pdf-workspace-editor')) {
  if (!editor) return '';
  const clone = editor.cloneNode(true);
  clone.querySelectorAll('[data-pdf-note-image-controls],[data-pdf-note-image-action]').forEach(node => node.remove());
  clone.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'));
  return sanitizePdfWorkspaceHtml(clone.innerHTML);
}
function syncPdfNoteHistoryControls() {
  const undo = el('pdf-note-undo'); const redo = el('pdf-note-redo');
  if (undo) undo.disabled = state.pdfNoteHistoryIndex <= 0;
  if (redo) redo.disabled = state.pdfNoteHistoryIndex < 0 || state.pdfNoteHistoryIndex >= state.pdfNoteHistory.length - 1;
}
function resetPdfNoteHistory(html = pdfWorkspaceEditorHtml()) {
  clearTimeout(state.pdfNoteHistoryTimer); state.pdfNoteHistoryTimer = null;
  state.pdfNoteHistory = [sanitizePdfWorkspaceHtml(html)];
  state.pdfNoteHistoryIndex = 0;
  state.pdfNoteHistoryRestoring = false;
  syncPdfNoteHistoryControls();
}
function commitPdfNoteHistory() {
  if (state.pdfNoteHistoryRestoring) return;
  clearTimeout(state.pdfNoteHistoryTimer); state.pdfNoteHistoryTimer = null;
  const html = pdfWorkspaceEditorHtml();
  if (html === state.pdfNoteHistory[state.pdfNoteHistoryIndex]) return syncPdfNoteHistoryControls();
  state.pdfNoteHistory = state.pdfNoteHistory.slice(0, state.pdfNoteHistoryIndex + 1);
  state.pdfNoteHistory.push(html);
  if (state.pdfNoteHistory.length > 80) state.pdfNoteHistory.shift();
  state.pdfNoteHistoryIndex = state.pdfNoteHistory.length - 1;
  syncPdfNoteHistoryControls();
}
function queuePdfNoteHistory() {
  if (state.pdfNoteHistoryRestoring) return;
  clearTimeout(state.pdfNoteHistoryTimer);
  state.pdfNoteHistoryTimer = setTimeout(commitPdfNoteHistory, 420);
}
function restorePdfNoteHistory(index) {
  const editor = el('pdf-workspace-editor');
  if (!editor || index < 0 || index >= state.pdfNoteHistory.length) return false;
  state.pdfNoteHistoryRestoring = true;
  editor.innerHTML = state.pdfNoteHistory[index];
  decoratePdfWorkspaceEditor(editor);
  state.pdfNoteHistoryIndex = index;
  state.pdfNoteHistoryRestoring = false;
  state.pdfNoteRange = null;
  syncPdfNoteHistoryControls();
  updatePdfNoteCommandStates();
  schedulePdfWorkspaceSave({ recordHistory: false });
  editor.focus({ preventScroll: true });
  return true;
}
function undoPdfWorkspaceNote() {
  commitPdfNoteHistory();
  if (!restorePdfNoteHistory(state.pdfNoteHistoryIndex - 1)) return toast('没有可以撤销的笔记操作');
  toast('已撤销上一步笔记操作');
}
function redoPdfWorkspaceNote() {
  if (!restorePdfNoteHistory(state.pdfNoteHistoryIndex + 1)) return toast('没有可以重做的笔记操作');
  toast('已重做笔记操作');
}
function renderPdfWorkspaceNote() {
  const note = currentPdfWorkspaceNote(); const editor = el('pdf-workspace-editor');
  if (!note || !editor) return;
  note.html = pdfWorkspaceDocumentHtml(note); note.images = [];
  editor.innerHTML = note.html;
  decoratePdfWorkspaceEditor(editor);
  resetPdfNoteHistory(note.html);
  updatePdfNoteCommandStates();
  renderPdfNoteStatus(note);
}
function updatePdfWorkspaceTextFromEditor() {
  const note = currentPdfWorkspaceNote(); const editor = el('pdf-workspace-editor');
  if (!note || !editor) return;
  note.html = pdfWorkspaceEditorHtml(editor);
  const template = document.createElement('template'); template.innerHTML = note.html;
  note.text = String(template.content.textContent || '').replace(/\u00a0/g, ' ').slice(0, 200_000);
  note.images = [];
  state.pdfNoteDirty = true;
}
async function savePdfWorkspaceNote({ quiet = false } = {}) {
  const note = currentPdfWorkspaceNote(); if (!note) return;
  clearTimeout(state.pdfNoteSaveTimer); state.pdfNoteSaveTimer = null;
  updatePdfWorkspaceTextFromEditor();
  note.updatedAt = new Date().toISOString();
  if (el('pdf-note-status')) el('pdf-note-status').textContent = '正在保存…';
  try {
    await persistPdfRecord('workspace');
    state.pdfNoteDirty = false;
    if (state.pdfRecord) renderPdfNoteStatus(note, '已保存刚刚');
    if (!quiet) toast('阅读笔记已保存');
  } catch (error) {
    if (el('pdf-note-status')) el('pdf-note-status').textContent = '保存失败，请导出笔记后重试';
    if (!quiet) toast(`笔记保存失败：${error.message || '存储空间不足'}`);
  }
}
function schedulePdfWorkspaceSave({ recordHistory = true } = {}) {
  updatePdfWorkspaceTextFromEditor();
  if (recordHistory) queuePdfNoteHistory();
  if (el('pdf-note-status')) el('pdf-note-status').textContent = '内容有修改，正在自动保存…';
  clearTimeout(state.pdfNoteSaveTimer);
  state.pdfNoteSaveTimer = setTimeout(() => savePdfWorkspaceNote({ quiet: true }), 650);
}
function rememberPdfWorkspaceRange() {
  const editor = el('pdf-workspace-editor'); const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (container && editor.contains(container)) state.pdfNoteRange = range.cloneRange();
}
function updatePdfNoteCommandStates() {
  const editor = el('pdf-workspace-editor'); const selection = window.getSelection();
  const container = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
  const element = container?.nodeType === Node.ELEMENT_NODE ? container : container?.parentElement;
  const inside = Boolean(element && editor?.contains(element));
  for (const button of document.querySelectorAll('[data-pdf-note-command]')) {
    const command = button.dataset.pdfNoteCommand;
    let active = false;
    if (inside && ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].includes(command)) {
      try { active = document.queryCommandState(command); } catch {}
    } else if (inside && command === 'formatBlock') {
      try { active = String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '') === String(button.dataset.pdfNoteValue || '').toLowerCase(); } catch {}
    }
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function restorePdfWorkspaceRange() {
  const editor = el('pdf-workspace-editor'); const selection = window.getSelection();
  if (!editor || !selection) return null;
  let range = state.pdfNoteRange;
  const container = range?.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range?.commonAncestorContainer?.parentElement;
  if (!range || !container || !editor.contains(container)) {
    range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  }
  selection.removeAllRanges(); selection.addRange(range); return range;
}
function insertPdfWorkspaceFigure(image) {
  const editor = el('pdf-workspace-editor'); if (!editor) return;
  editor.focus({ preventScroll: true });
  const range = restorePdfWorkspaceRange();
  const figure = document.createElement('figure'); figure.className = 'pdf-note-figure';
  figure.dataset.pdfNoteImage = image.id; figure.dataset.pdfNoteWidth = '100'; figure.contentEditable = 'false';
  const img = document.createElement('img'); img.src = image.dataUrl; img.alt = image.name || '阅读笔记图片';
  const caption = document.createElement('figcaption'); caption.textContent = image.name || '阅读笔记图片';
  figure.append(img, caption);
  range.collapse(true);
  const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const block = anchor?.closest?.('p,div,h2,h3,blockquote,li');
  let paragraph = document.createElement(block?.tagName === 'H2' || block?.tagName === 'H3' ? block.tagName.toLowerCase() : 'p');
  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentElement === editor) {
    const tail = range.startContainer.splitText(range.startOffset);
    const before = document.createElement('p'); editor.insertBefore(before, range.startContainer); before.append(range.startContainer);
    paragraph.append(tail);
    if (!paragraph.textContent) paragraph.append(document.createElement('br'));
    before.after(figure, paragraph);
  } else if (block?.tagName === 'LI' && editor.contains(block)) {
    range.insertNode(paragraph); range.insertNode(figure);
  } else if (block && block !== editor && editor.contains(block)) {
    const tailRange = document.createRange();
    try {
      tailRange.setStart(range.startContainer, range.startOffset);
      tailRange.setEnd(block, block.childNodes.length);
      const tail = tailRange.extractContents();
      paragraph.append(tail);
      if (!paragraph.textContent && !paragraph.querySelector('img,br')) paragraph.append(document.createElement('br'));
      block.after(figure, paragraph);
    } catch {
      paragraph.append(document.createElement('br')); editor.append(figure, paragraph);
    }
  } else {
    paragraph.append(document.createElement('br')); editor.append(figure, paragraph);
  }
  decoratePdfWorkspaceEditor(editor);
  const nextRange = document.createRange(); nextRange.selectNodeContents(paragraph); nextRange.collapse(true);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(nextRange);
  state.pdfNoteRange = nextRange.cloneRange();
}
function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('无法读取图片'));
    reader.readAsDataURL(blob);
  });
}
async function compressedPdfNoteImage(blob, name = '阅读截图') {
  if (!blob?.type?.startsWith('image/')) throw new Error('请选择图片文件');
  if (blob.size > 16 * 1024 * 1024) throw new Error('单张原图不能超过 16 MB');
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 1400 / bitmap.width, 1400 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
  if (!output) throw new Error('图片压缩失败');
  return { id: crypto.randomUUID ? crypto.randomUUID() : `note-image-${Date.now()}`, name: String(name || '阅读图片').slice(0, 100), dataUrl: await blobDataUrl(output), createdAt: new Date().toISOString() };
}
async function addPdfWorkspaceImage(blob, name) {
  const note = currentPdfWorkspaceNote(); if (!note) return toast('请先打开一篇 PDF');
  if (pdfWorkspaceImageElements().length >= PDF_NOTE_MAX_IMAGES) return toast(`每篇笔记最多保存 ${PDF_NOTE_MAX_IMAGES} 张图片`);
  try {
    const image = await compressedPdfNoteImage(blob, name);
    if (pdfNoteDataBytes(note) + image.dataUrl.length * .75 > PDF_NOTE_MAX_BYTES) throw new Error('图片笔记已接近 8 MB 上限，请删除旧图或先导出');
    setPdfInspector(true, 'notes');
    insertPdfWorkspaceFigure(image);
    commitPdfNoteHistory();
    note.updatedAt = new Date().toISOString(); state.pdfNoteDirty = true;
    await savePdfWorkspaceNote({ quiet: true });
    toast('图片已插入光标位置，可继续在下方输入文字');
  } catch (error) { toast(error.message || '图片插入失败'); }
}
async function addLatestPdfSnapshotToNote() {
  const snapshot = [...state.pdfSnapshots].reverse().find(item => item.paperId === state.pdfPaperId && item.blob);
  if (!snapshot) return toast('当前论文还没有截图，请先按 S 框选截图');
  await addPdfWorkspaceImage(snapshot.blob, `第 ${snapshot.page} 页截图`);
}
function openPdfWorkspaceExportDialog() {
  if (!currentPdfWorkspaceNote()) return toast('请先打开一篇 PDF');
  el('note-export-format').value = noteExportSettings.format;
  el('note-export-font').value = noteExportSettings.fontFamily;
  el('note-export-font-size').value = String(noteExportSettings.fontSize);
  el('note-export-page-size').value = noteExportSettings.pageSize;
  el('note-export-margin').value = noteExportSettings.margin;
  el('note-export-metadata').checked = noteExportSettings.includeMetadata;
  el('note-export-images').checked = noteExportSettings.includeImages;
  el('note-export-modal').classList.add('open');
  requestAnimationFrame(() => el('note-export-dialog').focus());
}
function readPdfWorkspaceExportOptions() {
  noteExportSettings = {
    format: el('note-export-format').value === 'docx' ? 'docx' : 'pdf',
    fontFamily: el('note-export-font').value || NOTE_EXPORT_DEFAULTS.fontFamily,
    fontSize: Math.max(9, Math.min(24, Number(el('note-export-font-size').value) || 11)),
    pageSize: el('note-export-page-size').value === 'letter' ? 'letter' : 'a4',
    margin: ['narrow', 'wide'].includes(el('note-export-margin').value) ? el('note-export-margin').value : 'standard',
    includeMetadata: el('note-export-metadata').checked,
    includeImages: el('note-export-images').checked
  };
  try { localStorage.setItem(NOTE_EXPORT_SETTINGS_KEY, JSON.stringify(noteExportSettings)); } catch {}
  return noteExportSettings;
}
function pdfWorkspaceExportMetadata(paper) {
  return [
    { label: '作者', value: Array.isArray(paper.authors) ? paper.authors.join('、') : paper.authors },
    { label: '会议/期刊', value: paper.venueName || paper.venue },
    { label: '发表日期', value: paper.published ? dateText(paper.published) : '' },
    { label: 'DOI', value: paper.doi },
    { label: '原文链接', value: paper.officialUrl || paper.link },
    { label: '本地 PDF', value: state.pdfRecord?.fileName },
    { label: '阅读位置', value: state.pdfDocument ? `第 ${state.pdfPage} / ${state.pdfDocument.numPages} 页` : '' },
    { label: 'PDF 标注', value: `${state.pdfRecord?.annotations?.length || 0} 条` }
  ];
}
async function exportPdfWorkspaceNote() {
  const note = currentPdfWorkspaceNote(); if (!note) return;
  const options = readPdfWorkspaceExportOptions();
  closeModal('note-export-modal');
  await savePdfWorkspaceNote({ quiet: true });
  const paper = getPaper(state.pdfPaperId) || {};
  const title = paper.title || state.pdfRecord?.fileName || '阅读笔记';
  const editor = el('pdf-workspace-editor');
  try {
    const formatLabel = options.format === 'pdf' ? 'PDF' : 'Word';
    if (el('pdf-note-status')) el('pdf-note-status').textContent = `正在生成 ${formatLabel} 文档…`;
    const normalized = await normalizePdfNoteForDocx(editor);
    const exportedAt = new Date();
    const payload = { title, exportedAt: exportedAt.toLocaleString('zh-CN'), metadata: pdfWorkspaceExportMetadata(paper), options, ...normalized };
    const stem = `${safePdfFileStem(state.pdfRecord?.fileName || title)}-阅读笔记`;
    if (options.format === 'pdf') {
      const { PDFDocument } = await loadPdfLibModule();
      const bytes = await buildNotePdf({ PDFDocument, ...payload });
      downloadBlob(`${stem}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
      renderPdfNoteStatus(note, 'PDF 文档已导出');
      toast('阅读笔记已导出为 PDF');
    } else {
      const bytes = buildNoteDocx(payload);
      downloadBlob(`${stem}.docx`, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      renderPdfNoteStatus(note, 'Word 文档已导出');
      toast('阅读笔记已导出为 Word（.docx）');
    }
  } catch (error) {
    renderPdfNoteStatus(note, '导出失败');
    toast(`导出失败：${error.message || '无法生成文档'}`);
  }
}
function pdfNoteInlineRuns(node, styles = {}) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ text: node.textContent, ...styles }] : [];
  if (node.nodeType !== Node.ELEMENT_NODE || node.matches('[data-pdf-note-image-controls]')) return [];
  if (node.tagName === 'BR') return [{ text: '\n', ...styles }];
  const next = {
    bold: styles.bold || ['STRONG', 'B'].includes(node.tagName),
    italic: styles.italic || ['EM', 'I'].includes(node.tagName),
    underline: styles.underline || node.tagName === 'U'
  };
  return [...node.childNodes].flatMap(child => pdfNoteInlineRuns(child, next));
}
async function pdfNoteImageForDocx(image) {
  const response = await fetch(image.src); const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('笔记图片转换失败');
  const figure = image.closest('figure');
  return {
    bytes: new Uint8Array(await png.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
    displayWidth: clampPdfNoteImageWidth(figure?.dataset.pdfNoteWidth),
    alt: image.alt || '阅读笔记图片',
    caption: figure?.querySelector('figcaption')?.textContent?.trim() || image.alt || '阅读笔记图片'
  };
}
async function normalizePdfNoteForDocx(editor) {
  const blocks = []; const images = [];
  const visit = async node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) blocks.push({ type: 'paragraph', runs: [{ text }] });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches('[data-pdf-note-image-controls]')) return;
    if (node.tagName === 'FIGURE') {
      const image = node.querySelector('img[src^="data:image/"]');
      if (!image) return;
      const imageIndex = images.length;
      images.push(await pdfNoteImageForDocx(image));
      blocks.push({ type: 'image', imageIndex });
      return;
    }
    if (node.matches('UL,OL')) {
      let index = 0;
      for (const item of node.children) {
        if (item.tagName !== 'LI') continue;
        index += 1;
        blocks.push({ type: node.tagName === 'OL' ? 'number' : 'bullet', index, runs: pdfNoteInlineRuns(item) });
      }
      return;
    }
    if (node.matches('P,DIV,H2,H3,BLOCKQUOTE,LI')) {
      const nestedBlocks = [...node.children].some(child => child.matches('FIGURE,UL,OL,P,DIV,H2,H3,BLOCKQUOTE'));
      if (nestedBlocks && node.matches('DIV')) {
        for (const child of node.childNodes) await visit(child);
        return;
      }
      const runs = pdfNoteInlineRuns(node);
      if (runs.some(run => run.text)) blocks.push({ type: node.matches('H2,H3') ? 'heading' : node.tagName === 'BLOCKQUOTE' ? 'quote' : 'paragraph', runs });
      return;
    }
    for (const child of node.childNodes) await visit(child);
  };
  for (const node of editor?.childNodes || []) await visit(node);
  return { blocks, images };
}
function pdfSelectionToolType() {
  return ['highlight', 'underline', 'note'].includes(state.pdfAnnotationMode) ? state.pdfAnnotationMode : null;
}
function mergePdfSelectionRects(rects, bounds, clip = bounds) {
  const normalized = rects.map(rect => {
    const left = Math.max(bounds.left, clip.left, rect.left - 1); const right = Math.min(bounds.right, clip.right, rect.right + 1);
    const top = Math.max(bounds.top, rect.top); const bottom = Math.min(bounds.bottom, rect.bottom);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }).filter(rect => rect.width > 1 && rect.height > 1);
  normalized.sort((a, b) => Math.abs(a.top - b.top) > Math.min(a.height, b.height) * .45 ? a.top - b.top : a.left - b.left);
  const lines = [];
  for (const rect of normalized) {
    const line = lines.find(value => Math.abs(value.top - rect.top) <= Math.max(2, Math.min(value.height, rect.height) * .4) && Math.min(value.bottom, rect.bottom) - Math.max(value.top, rect.top) > 0);
    if (!line) lines.push({ ...rect });
    else if (rect.left <= line.right + Math.max(3, Math.min(line.height, rect.height) * .55)) {
      line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.right);
      line.top = Math.min(line.top, rect.top); line.bottom = Math.max(line.bottom, rect.bottom);
      line.width = line.right - line.left; line.height = line.bottom - line.top;
    } else lines.push({ ...rect });
  }
  return lines.map(rect => ({
    x: Math.max(0, (rect.left - bounds.left) / bounds.width),
    y: Math.max(0, (rect.top - bounds.top) / bounds.height),
    width: Math.min(1, rect.width / bounds.width),
    height: Math.min(1, rect.height / bounds.height)
  })).filter(rect => rect.width > .001 && rect.height > .001 && rect.x < 1 && rect.y < 1);
}
function pdfRangeFragments(range, layer) {
  const fragments = [];
  for (const span of layer.querySelectorAll('span')) {
    for (const node of span.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent) continue;
      try { if (!range.intersectsNode(node)) continue; } catch { continue; }
      let start = 0; let end = node.textContent.length;
      if (range.startContainer === node) start = range.startOffset;
      if (range.endContainer === node) end = range.endOffset;
      if (end <= start) continue;
      const piece = document.createRange();
      piece.setStart(node, Math.max(0, Math.min(start, node.textContent.length)));
      piece.setEnd(node, Math.max(0, Math.min(end, node.textContent.length)));
      const rects = [...piece.getClientRects()];
      if (rects.length) fragments.push({ text: node.textContent.slice(start, end), rects });
    }
  }
  return fragments;
}
function precisePdfRangeRects(range, layer) {
  const bounds = layer.getBoundingClientRect(); if (!bounds.width || !bounds.height) return [];
  return mergePdfSelectionRects(pdfRangeFragments(range, layer).flatMap(fragment => fragment.rects), bounds);
}
function precisePdfRangeText(range, layer) {
  let output = ''; let previousRect = null;
  for (const fragment of pdfRangeFragments(range, layer)) {
    const value = fragment.text.replace(/\s+/g, ' ').trim(); if (!value) continue;
    const rect = fragment.rects[0];
    const lineChanged = previousRect && Math.abs(rect.top - previousRect.top) > Math.max(rect.height, previousRect.height) * .55;
    const needsSpace = output && !/[\s\-/]$/.test(output) && !/^[,.;:!?)}\]]/.test(value);
    if (needsSpace && (lineChanged || !/^[’']/.test(value))) output += ' ';
    output += value; previousRect = rect;
  }
  return output.replace(/\s+/g, ' ').trim();
}
function pdfRectUnion(rects) {
  const left = Math.min(...rects.map(rect => rect.left)); const right = Math.max(...rects.map(rect => rect.right));
  const top = Math.min(...rects.map(rect => rect.top)); const bottom = Math.max(...rects.map(rect => rect.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}
function pdfVisualTextFragments(layer) {
  const fragments = [];
  for (const span of layer.querySelectorAll('span')) {
    for (const node of span.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(rect => rect.width > .5 && rect.height > .5);
      if (!rects.length) continue;
      if (rects.length === 1) {
        fragments.push({ node, span, start: 0, end: node.textContent.length, text: node.textContent, rect: pdfRectUnion(rects) });
        continue;
      }
      let current = null;
      for (let offset = 0; offset < node.textContent.length; offset += 1) {
        const piece = document.createRange(); piece.setStart(node, offset); piece.setEnd(node, offset + 1);
        const rect = [...piece.getClientRects()].find(value => value.width > .05 && value.height > .5);
        if (!rect) continue;
        const sameLine = current && Math.abs(rect.top - current.rect.top) <= Math.max(2, Math.min(rect.height, current.rect.height) * .45);
        if (!sameLine) {
          current = { node, span, start: offset, end: offset + 1, text: node.textContent.slice(offset, offset + 1), rect: pdfRectUnion([rect]) };
          fragments.push(current);
        } else {
          current.end = offset + 1; current.text = node.textContent.slice(current.start, current.end);
          current.rect = pdfRectUnion([current.rect, rect]);
        }
      }
    }
  }
  return fragments;
}
function pdfStableColumnBreaks(lines, bounds) {
  const tolerance = Math.max(4, Math.min(8, bounds.width * .009));
  const candidates = [];
  lines.forEach((line, lineIndex) => {
    line.fragments.sort((a, b) => a.rect.left - b.rect.left);
    for (let index = 1; index < line.fragments.length; index += 1) {
      const previous = line.fragments[index - 1]; const fragment = line.fragments[index]; const leftmost = line.fragments[0];
      const x = fragment.rect.left; const relative = (x - bounds.left) / bounds.width;
      const gap = fragment.rect.left - previous.rect.right;
      const columnSpan = fragment.rect.left - leftmost.rect.left;
      if (relative < .2 || relative > .84 || columnSpan < bounds.width * .16) continue;
      candidates.push({ x, gap, columnSpan, lineIndex });
    }
  });
  const clusters = [];
  for (const candidate of candidates.sort((a, b) => a.x - b.x)) {
    const cluster = clusters.find(value => Math.abs(value.x - candidate.x) <= tolerance);
    if (!cluster) clusters.push({ x: candidate.x, values: [candidate] });
    else {
      cluster.values.push(candidate);
      cluster.x = cluster.values.reduce((sum, value) => sum + value.x, 0) / cluster.values.length;
    }
  }
  // A handful of deliberately split text nodes on a short single-column
  // paragraph must not be promoted to a page column. Real journal columns
  // repeat the same boundary across substantially more visual rows.
  const minimumSupport = Math.max(8, Math.min(12, Math.ceil(lines.length * .1)));
  const summaries = clusters.map(cluster => {
    const lineIndexes = [...new Set(cluster.values.map(value => value.lineIndex))].sort((a, b) => a - b);
    const spans = cluster.values.map(value => value.columnSpan).sort((a, b) => a - b);
    const gaps = cluster.values.map(value => value.gap).sort((a, b) => a - b);
    return {
      x: cluster.x, support: lineIndexes.length,
      minLineIndex: lineIndexes[0], maxLineIndex: lineIndexes.at(-1), tolerance,
      medianSpan: spans[Math.floor(spans.length / 2)] || 0,
      medianGap: gaps[Math.floor(gaps.length / 2)] || 0,
      relative: (cluster.x - bounds.left) / bounds.width
    };
  }).filter(value => value.maxLineIndex - value.minLineIndex >= 3);
  const strong = summaries.filter(value =>
    value.support >= minimumSupport &&
    value.medianSpan >= bounds.width * .32 &&
    value.relative >= .38 && value.relative <= .62
  );
  const expected = Number.isFinite(state.pdfColumnTemplate) ? state.pdfColumnTemplate : .5;
  let pool = strong;
  // Once a reliable page has established the document gutter, sparse pages
  // may reuse it with lower support. This does not affect standalone
  // single-column PDFs because they never establish a template.
  if (Number.isFinite(state.pdfColumnTemplate)) {
    const weakSupport = Math.max(3, Math.ceil(minimumSupport * .4));
    const nearTemplate = summaries.filter(value =>
      value.support >= weakSupport &&
      value.medianSpan >= bounds.width * .28 &&
      Math.abs(value.relative - state.pdfColumnTemplate) <= .065
    );
    if (nearTemplate.length) pool = nearTemplate;
  }
  const selected = pool.sort((a, b) =>
    Math.abs(a.relative - expected) - Math.abs(b.relative - expected) ||
    b.support - a.support ||
    b.medianSpan - a.medianSpan
  )[0];
  if (!selected) return [];
  if (strong.includes(selected)) {
    state.pdfColumnTemplate = Number.isFinite(state.pdfColumnTemplate)
      ? state.pdfColumnTemplate * .72 + selected.relative * .28
      : selected.relative;
  }
  // The reader currently models the dominant journal gutter. Returning every
  // repeated x-position misclassifies equation alignment and list indents on
  // later pages as extra columns, which clips selections into narrow strips.
  return [selected];
}
function pdfColumnLaneForLeft(left, columnBreaks) {
  return columnBreaks.reduce((lane, value) => left >= value.x - value.tolerance ? lane + 1 : lane, 0);
}
function pdfColumnLaneForRun(run, columnBreaks, bounds) {
  const spansBoundary = columnBreaks.some(value =>
    run.left < value.x - value.tolerance &&
    run.right > value.x + Math.max(value.tolerance * 2, bounds.width * .055)
  );
  // Full-width titles, abstracts, figures and section banners can coexist
  // above or below a multi-column body. Keep them in a separate spanning lane.
  if (spansBoundary && run.width >= bounds.width * .56) return null;
  return pdfColumnLaneForLeft(run.left, columnBreaks);
}
function pdfVisualTextLayout(layer) {
  const bounds = layer.getBoundingClientRect(); const fragments = pdfVisualTextFragments(layer);
  const lines = [];
  for (const fragment of fragments.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
    const center = (fragment.rect.top + fragment.rect.bottom) / 2;
    const line = lines.find(value => {
      const comparableHeight = Math.min(value.typicalHeight, fragment.rect.height);
      // A permissive tolerance lets a taller fragment in the opposite column
      // bridge two adjacent small-print lines. The two physical rows then
      // become one logical line and a drag returns the paragraph above/below.
      // PDF text nodes on the same visual row have almost identical baselines,
      // so use a strict, font-relative tolerance and median anchors.
      const lineTolerance = Math.max(2, comparableHeight * .34);
      const baselineClose = Math.abs(fragment.rect.bottom - value.baseline) <= lineTolerance;
      const centerClose = Math.abs(center - value.center) <= lineTolerance;
      return baselineClose || centerClose;
    });
    if (!line) lines.push({ top: fragment.rect.top, bottom: fragment.rect.bottom, height: fragment.rect.height, typicalHeight: fragment.rect.height, baseline: fragment.rect.bottom, center, fragments: [fragment] });
    else {
      line.fragments.push(fragment); line.top = Math.min(line.top, fragment.rect.top); line.bottom = Math.max(line.bottom, fragment.rect.bottom);
      line.height = line.bottom - line.top;
      const regularHeights = line.fragments.map(value => value.rect.height).sort((a, b) => a - b);
      line.typicalHeight = regularHeights[Math.floor((regularHeights.length - 1) / 2)];
      const regular = line.fragments.filter(value => value.rect.height <= line.typicalHeight * 1.5);
      const baselines = regular.map(value => value.rect.bottom).sort((a, b) => a - b);
      const centers = regular.map(value => (value.rect.top + value.rect.bottom) / 2).sort((a, b) => a - b);
      line.baseline = baselines[Math.floor((baselines.length - 1) / 2)];
      line.center = centers[Math.floor((centers.length - 1) / 2)];
    }
  }
  lines.sort((a, b) => a.center - b.center);
  const columnBreaks = pdfStableColumnBreaks(lines, bounds);
  const runs = [];
  lines.forEach((line, lineIndex) => {
    line.fragments.sort((a, b) => a.rect.left - b.rect.left);
    const gapLimit = Math.max(3, Math.min(line.typicalHeight * .65, bounds.width * .012));
    const lineRuns = [];
    for (const fragment of line.fragments) {
      const previous = lineRuns.at(-1);
      const stableBreak = columnBreaks.find(value => Math.abs(fragment.rect.left - value.x) <= value.tolerance);
      if (!previous || stableBreak || fragment.rect.left - previous.right > gapLimit) {
        lineRuns.push({ lineIndex, fragments: [fragment], left: fragment.rect.left, right: fragment.rect.right, top: fragment.rect.top, bottom: fragment.rect.bottom, columnBreakBefore: Boolean(previous && stableBreak) });
      } else {
        previous.fragments.push(fragment); previous.left = Math.min(previous.left, fragment.rect.left); previous.right = Math.max(previous.right, fragment.rect.right);
        previous.top = Math.min(previous.top, fragment.rect.top); previous.bottom = Math.max(previous.bottom, fragment.rect.bottom);
      }
    }
    line.runs = lineRuns;
    lineRuns.forEach((run, runIndex) => {
      run.runIndex = runIndex; run.width = run.right - run.left; run.height = run.bottom - run.top;
      run.columnLane = pdfColumnLaneForRun(run, columnBreaks, bounds);
      run.fragments.forEach((fragment, fragmentIndex) => { fragment.lineIndex = lineIndex; fragment.runIndex = runIndex; fragment.fragmentIndex = fragmentIndex; fragment.run = run; });
      runs.push(run);
    });
  });
  return { layer, bounds, lines, runs, fragments: runs.flatMap(run => run.fragments), columnBreaks };
}
function pdfPointDistanceToRect(point, rect) {
  const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
  const verticalTieBreak = Math.abs(point.y - (rect.top + rect.bottom) / 2) * .025;
  return Math.hypot(dx, dy) + verticalTieBreak;
}
function pdfCharacterOffsetAtPoint(fragment, point) {
  if (point.x <= fragment.rect.left) return fragment.start;
  if (point.x >= fragment.rect.right) return fragment.end;
  let nearest = fragment.start; let nearestDistance = Infinity;
  for (let offset = fragment.start; offset < fragment.end; offset += 1) {
    const range = document.createRange(); range.setStart(fragment.node, offset); range.setEnd(fragment.node, offset + 1);
    const rect = [...range.getClientRects()].find(value => value.width > .01 && value.height > .5);
    if (!rect) continue;
    const midpoint = (rect.left + rect.right) / 2; const distance = Math.abs(point.x - midpoint);
    if (distance < nearestDistance) {
      nearestDistance = distance; nearest = point.x <= midpoint ? offset : offset + 1;
    }
  }
  return Math.max(fragment.start, Math.min(fragment.end, nearest));
}
function pdfVisualEndpoint(layout, point) {
  const line = layout.lines.reduce((best, candidate) => {
    const distance = Math.abs(point.y - candidate.center);
    return !best || distance < best.distance ? { line: candidate, distance } : best;
  }, null)?.line;
  if (!line?.runs?.length) return null;
  // Text-layer font metrics can make the left column rectangle overlap the
  // visible start of the right column. Prefer the last visual run whose left
  // edge has already been crossed instead of the first overlapping rectangle.
  let run = line.runs[0];
  for (const candidate of line.runs) {
    if (point.x >= candidate.left - 1) run = candidate;
    else break;
  }
  let fragment = null; let distance = Infinity;
  for (const candidate of run.fragments) {
    const candidateDistance = pdfPointDistanceToRect(point, candidate.rect);
    if (candidateDistance < distance) { fragment = candidate; distance = candidateDistance; }
  }
  if (!fragment) return null;
  return { run: fragment.run, fragment, offset: pdfCharacterOffsetAtPoint(fragment, point) };
}
function pdfVisualEndpointFromDomPoint(layout, node, offset) {
  if (!node) return null;
  const textNode = node.nodeType === Node.TEXT_NODE ? node : null;
  if (!textNode) return null;
  const value = Math.max(0, Math.min(Number(offset) || 0, textNode.textContent?.length || 0));
  const candidates = layout.fragments.filter(fragment => fragment.node === textNode && value >= fragment.start && value <= fragment.end);
  if (!candidates.length) return null;
  const fragment = candidates.find(item => value < item.end) || candidates[candidates.length - 1];
  return { run: fragment.run, fragment, offset: Math.max(fragment.start, Math.min(fragment.end, value)) };
}
function comparePdfVisualEndpoints(a, b) {
  return a.run.lineIndex - b.run.lineIndex || a.run.runIndex - b.run.runIndex || a.fragment.fragmentIndex - b.fragment.fragmentIndex || a.offset - b.offset;
}
function pdfRunOverlap(a, b) { return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)); }
function pdfVisualSelectionSameColumn(layout, start, end) {
  if (start.run === end.run) return true;
  // Once a repeated visual column boundary is known, lane identity is the
  // authoritative signal. Text-layer rectangles often overlap at a narrow
  // gutter, so rectangle overlap must never be used to join different lanes.
  if (layout.columnBreaks.length) return start.run.columnLane === end.run.columnLane;
  // Without a repeated page-level boundary there is no trustworthy evidence
  // of separate columns. Treat visual runs as one reading stream so split
  // PDF text nodes on a single line remain selectable end to end.
  return true;
}
function pdfVisualColumnClip(layout, start, end) {
  const breaks = layout.columnBreaks;
  if (!breaks.length) return { left: layout.bounds.left, right: layout.bounds.right };
  const lane = start.run.columnLane;
  if (lane === null) return { left: layout.bounds.left, right: layout.bounds.right };
  return {
    left: lane > 0 ? breaks[Math.min(lane - 1, breaks.length - 1)].x : layout.bounds.left,
    right: lane < breaks.length ? breaks[lane].x : layout.bounds.right
  };
}
function pdfClampClientRect(rect, clip) {
  const left = Math.max(rect.left, clip.left); const right = Math.min(rect.right, clip.right);
  if (right - left <= .15) return null;
  return { left, right, top: rect.top, bottom: rect.bottom, width: right - left, height: rect.height };
}
function pdfSelectedRunsForLine(line, startRun, endRun, columnLane, laneAware) {
  return line.runs.filter(run => {
    if (run.lineIndex === startRun.lineIndex && run.runIndex < startRun.runIndex) return false;
    if (run.lineIndex === endRun.lineIndex && run.runIndex > endRun.runIndex) return false;
    // In a detected multi-column layout, select every fragment in the chosen
    // lane and none from adjacent lanes. Without a column boundary, all runs
    // on the visual line belong to the same reading stream.
    return !laneAware || run.columnLane === columnLane;
  });
}
function pdfRangeRectForFragment(fragment, start, end) {
  if (end <= start) return [];
  const range = document.createRange(); range.setStart(fragment.node, start); range.setEnd(fragment.node, end);
  return [...range.getClientRects()].filter(rect => rect.width > .15 && rect.height > .5);
}
function pdfRectInCapturedLayout(rect, layout, currentBounds) {
  const offsetX = layout.bounds.left - currentBounds.left;
  const offsetY = layout.bounds.top - currentBounds.top;
  return {
    left: rect.left + offsetX, right: rect.right + offsetX,
    top: rect.top + offsetY, bottom: rect.bottom + offsetY,
    width: rect.width, height: rect.height
  };
}
function pdfVisualSelectionText(pieces) {
  let output = ''; let previous = null;
  for (const piece of pieces) {
    const value = piece.text.replace(/\s+/g, ' ').trim(); if (!value) continue;
    const lineChanged = previous && piece.lineIndex !== previous.lineIndex;
    const needsSpace = output && !/[\s\-/]$/.test(output) && !/^[,.;:!?)}\]]/.test(value);
    if (needsSpace && (lineChanged || piece.rect.left - previous.rect.right > 1)) output += ' ';
    output += value; previous = piece;
  }
  return output.replace(/\s+/g, ' ').trim();
}
function pdfVisualSelectionFromEndpoints(layout, start, end) {
  if (!start || !end) return { error: '当前页没有可选择的文字' };
  if (comparePdfVisualEndpoints(start, end) > 0) [start, end] = [end, start];
  const startRun = start.run; const endRun = end.run;
  if (!pdfVisualSelectionSameColumn(layout, start, end)) return { error: '选区跨越了不同分栏，请分别选择每一栏' };
  const columnClip = pdfVisualColumnClip(layout, start, end);
  const laneAware = layout.columnBreaks.length > 0; const columnLane = startRun.columnLane;
  const currentBounds = layout.layer.getBoundingClientRect();
  const selectedRuns = [];
  for (let lineIndex = startRun.lineIndex; lineIndex <= endRun.lineIndex; lineIndex += 1) {
    const line = layout.lines[lineIndex];
    selectedRuns.push(...pdfSelectedRunsForLine(line, startRun, endRun, columnLane, laneAware));
  }
  const pieces = []; const clientRects = [];
  selectedRuns.forEach((run, selectedRunIndex) => {
    const isFirst = selectedRunIndex === 0; const isLast = selectedRunIndex === selectedRuns.length - 1;
    for (const fragment of run.fragments) {
      if (isFirst && fragment.fragmentIndex < start.fragment.fragmentIndex) continue;
      if (isLast && fragment.fragmentIndex > end.fragment.fragmentIndex) continue;
      const from = isFirst && fragment === start.fragment ? start.offset : fragment.start;
      const to = isLast && fragment === end.fragment ? end.offset : fragment.end;
      if (to <= from) continue;
      // Range rectangles are reported in the *current* viewport coordinate
      // system. During a drag the user may wheel-scroll the stage, while
      // layout.bounds intentionally remains the immutable pointerdown space.
      // Translate new Range rectangles back into that captured space before
      // normalizing them; otherwise every scroll delta becomes saved into the
      // blue preview and all later highlights inherit the same offset.
      const rects = pdfRangeRectForFragment(fragment, from, to)
        .map(rect => pdfRectInCapturedLayout(rect, layout, currentBounds))
        .map(rect => pdfClampClientRect(rect, columnClip)).filter(Boolean);
      clientRects.push(...rects);
      pieces.push({ text: fragment.node.textContent.slice(from, to), rect: pdfRectUnion(rects), lineIndex: run.lineIndex });
    }
  });
  const text = pdfVisualSelectionText(pieces);
  const rects = mergePdfSelectionRects(clientRects, layout.bounds, columnClip);
  if (!text || !rects.length) return { error: '请拖选至少一个完整字符' };
  return { page: Number(layout.layer.closest('[data-pdf-page-stack]')?.dataset.page), text: text.slice(0, 2000), rects };
}
function pdfVisualSelectionForRange(range, layer) {
  const layout = pdfVisualTextLayout(layer);
  const start = pdfVisualEndpointFromDomPoint(layout, range.startContainer, range.startOffset);
  const end = pdfVisualEndpointFromDomPoint(layout, range.endContainer, range.endOffset);
  if (!start || !end) return { error: '当前页没有可选择的文字' };
  return pdfVisualSelectionFromEndpoints(layout, start, end);
}
function pdfVisualSelectionFromPoints(layout, startPoint, endPoint, cachedStart = null) {
  const start = cachedStart || pdfVisualEndpoint(layout, startPoint);
  const end = pdfVisualEndpoint(layout, endPoint);
  return pdfVisualSelectionFromEndpoints(layout, start, end);
}
function clearPdfTextSelectionPreview(draft = state.pdfTextSelectionDraft) {
  draft?.previewNodes?.forEach(node => node.remove()); if (draft) draft.previewNodes = [];
}
function renderPdfTextSelectionPreview(draft, selection) {
  clearPdfTextSelectionPreview(draft);
  if (!selection?.rects?.length) return;
  const annotationLayer = draft.stack.querySelector('.pdf-annotation-layer');
  draft.previewNodes = selection.rects.map(rect => {
    const preview = document.createElement('i'); preview.className = 'pdf-selection-preview';
    preview.style.left = `${rect.x * 100}%`; preview.style.top = `${rect.y * 100}%`;
    preview.style.width = `${rect.width * 100}%`; preview.style.height = `${rect.height * 100}%`;
    annotationLayer.appendChild(preview); return preview;
  });
}
function pdfSelectionClientRect(selection, layer) {
  const value = selection?.rects?.at(-1); const bounds = layer?.getBoundingClientRect();
  if (!value || !bounds) return bounds || { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 };
  const left = bounds.left + value.x * bounds.width; const top = bounds.top + value.y * bounds.height;
  const width = value.width * bounds.width; const height = value.height * bounds.height;
  return { left, top, right: left + width, bottom: top + height, width, height };
}
function clearPdfBrowseSelection() {
  const value = state.pdfBrowseSelection; if (!value) return false;
  value.previewNodes?.forEach(node => node.remove());
  if (state.pdfSelection === value.selection) state.pdfSelection = null;
  state.pdfBrowseSelection = null;
  if (!state.pdfAnnotationMode && el('pdf-modal')?.classList.contains('open')) el('pdf-tool-status').textContent = '浏览模式 · 拖选文字，S 框选截图';
  return true;
}
function pdfDraftPointInLayout(draft, event) {
  const currentBounds = draft.layer.getBoundingClientRect();
  // Tool/status text, responsive wrapping and scroll anchoring may move the
  // page while the pointer is held down. Convert the current viewport point
  // back into the immutable coordinate space captured on pointerdown.
  return {
    x: event.clientX + draft.layout.bounds.left - currentBounds.left,
    y: event.clientY + draft.layout.bounds.top - currentBounds.top
  };
}
function updatePdfTextSelectionDraft(event) {
  const draft = state.pdfTextSelectionDraft; if (!draft || draft.pointerId !== event.pointerId) return null;
  draft.endPoint = pdfDraftPointInLayout(draft, event);
  draft.selection = pdfVisualSelectionFromPoints(draft.layout, draft.startPoint, draft.endPoint, draft.startEndpoint);
  renderPdfTextSelectionPreview(draft, draft.selection);
  return draft.selection;
}
function discardPdfTextSelectionDraft() {
  const draft = state.pdfTextSelectionDraft; if (!draft) return false;
  try { draft.layer.releasePointerCapture(draft.pointerId); } catch {}
  draft.stack?.classList.remove('visual-selecting');
  clearPdfTextSelectionPreview(draft); state.pdfTextSelectionDraft = null; return true;
}
async function capturePdfSelection({ applyTool = true } = {}) {
  const selection = window.getSelection(); const pageText = el('pdf-page-text');
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const endElement = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
  const startStack = startElement?.closest?.('[data-pdf-page-stack]'); const endStack = endElement?.closest?.('[data-pdf-page-stack]');
  const inSideText = Boolean(pageText?.contains(startElement) && pageText?.contains(endElement));
  if (!startStack && !inSideText) return false;
  if (startStack && startStack !== endStack) { toast('请在同一页内选择文字'); return false; }
  const pageNumber = startStack ? Number(startStack.dataset.page) : state.pdfPage;
  const layer = startStack?.querySelector('.textLayer') || pdfStackForPage(pageNumber)?.querySelector('.textLayer');
  const visual = startStack && layer ? pdfVisualSelectionForRange(range, layer) : null;
  if (visual?.error && startStack) {
    selection.removeAllRanges();
    if (visual.error.includes('分栏')) toast(visual.error);
    return false;
  }
  const text = visual?.text || (startStack && layer ? precisePdfRangeText(range, layer) : selection.toString().replace(/\s+/g, ' ').trim());
  if (!text) return false;
  const rects = visual?.rects || (startStack && layer ? precisePdfRangeRects(range, layer) : []);
  state.pdfSelection = { page: pageNumber, text: text.slice(0, 2000), rects };
  updatePdfCurrentPage(pageNumber);
  const tool = pdfSelectionToolType();
  if (applyTool && tool) await addPdfSelectionAnnotation(tool, state.pdfSelection);
  return true;
}
async function addPdfSelectionAnnotation(type, capturedSelection = state.pdfSelection) {
  const selection = capturedSelection;
  if (!selection || selection.page !== state.pdfPage) return toast('请先在 PDF 页面上选择文字');
  if (!selection.rects.length) return toast('当前选区没有可用的页面坐标，请直接在 PDF 页面文字上选择');
  const comment = type === 'note' ? prompt('输入批注内容（可留空）：', '') : '';
  if (type === 'note' && comment === null) return;
  const annotation = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, type, page: state.pdfPage,
    rects: selection.rects, text: selection.text, comment: comment?.trim() || '', color: el('pdf-annotation-color').value,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  state.pdfRecord.annotations.push(annotation); state.pdfAnnotationHistory.push(annotation.id);
  closeTranslationPopover(); clearPdfBrowseSelection(); state.pdfSelection = null; window.getSelection()?.removeAllRanges();
  await persistPdfRecord(); renderPdfAnnotationLayerForCurrentPage(); renderPdfAnnotationList(annotation.id); toast(`${annotationTypeLabel(type)}已保存`);
}
function renderPdfAnnotationLayerForPage(pageNumber = state.pdfPage) {
  document.querySelectorAll(`[data-pdf-page-stack][data-page="${Number(pageNumber)}"]`).forEach(stack => {
    const canvas = stack.querySelector('.pdf-page-canvas');
    renderPdfAnnotationLayer({ width: parseFloat(canvas?.style.width) || stack.clientWidth, height: parseFloat(canvas?.style.height) || stack.clientHeight }, Number(pageNumber), stack.querySelector('.pdf-annotation-layer'));
  });
}
function renderPdfAnnotationLayerForCurrentPage() { renderPdfAnnotationLayerForPage(state.pdfPage); }
function renderAllPdfAnnotationLayers() {
  document.querySelectorAll('[data-pdf-page-stack]').forEach(stack => renderPdfAnnotationLayerForPage(Number(stack.dataset.page)));
}
function updatePdfAnnotationMode() {
  document.querySelectorAll('[data-pdf-tool]').forEach(button => button.classList.toggle('active', button.dataset.pdfTool === state.pdfAnnotationMode));
  document.querySelectorAll('[data-pdf-page-stack]').forEach(stack => stack.classList.toggle('annotation-select', Boolean(pdfSelectionToolType())));
  document.querySelectorAll('.pdf-annotation-layer').forEach(layer => {
    layer.classList.toggle('drawing', ['area', 'area-note', 'snapshot'].includes(state.pdfAnnotationMode));
    layer.classList.toggle('snapshot', state.pdfAnnotationMode === 'snapshot');
  });
  const labels = { highlight: '高亮工具 H · 拖选后自动保存', underline: '下划线工具 U · 拖选后自动保存', note: '文字批注 N · 拖选后填写批注', area: '区域工具 R · 拖出矩形', 'area-note': '区域批注 Shift+N · 拖出矩形', snapshot: '截图工具 S · 拖动鼠标自由框选，Esc 取消' };
  const selected = state.pdfBrowseSelection?.selection;
  el('pdf-tool-status').textContent = labels[state.pdfAnnotationMode] || (selected ? `已选择 ${selected.text.length} 字 · H 高亮 / U 下划线 / N 批注 / Ctrl+C 复制 / Esc 取消` : '浏览模式 · 拖选文字，S 框选截图');
  el('pdf-snipping-hint')?.classList.toggle('hidden', state.pdfAnnotationMode !== 'snapshot');
  clearTimeout(state.translationSelectionTimer);
  if (state.pdfAnnotationMode) closeTranslationPopover();
}
function setPdfAnnotationMode(mode) {
  discardPdfTextSelectionDraft(); clearPdfBrowseSelection();
  state.pdfAnnotationMode = state.pdfAnnotationMode === mode ? null : mode;
  state.pdfSelection = null; window.getSelection()?.removeAllRanges();
  updatePdfAnnotationMode();
}
async function applyOrTogglePdfAnnotationTool(mode) {
  if (['highlight', 'underline', 'note'].includes(mode) && state.pdfSelection?.rects?.length) {
    state.pdfAnnotationMode = null; updatePdfAnnotationMode();
    await addPdfSelectionAnnotation(mode, state.pdfSelection);
    return;
  }
  setPdfAnnotationMode(mode);
}
function cancelPdfAnnotationInteraction({ quiet = false } = {}) {
  const hadAnnotation = Boolean(state.pdfAnnotationMode || state.pdfAnnotationDraft || (state.pdfTextSelectionDraft && !state.pdfTextSelectionDraft.browseMode));
  const hadInteraction = Boolean(hadAnnotation || state.pdfTextSelectionDraft || state.pdfSelection || state.pdfBrowseSelection);
  discardPdfTextSelectionDraft();
  const draft = state.pdfAnnotationDraft;
  if (draft) {
    try { draft.layer?.releasePointerCapture(draft.pointerId); } catch {}
    draft.draft?.remove(); state.pdfAnnotationDraft = null;
  }
  state.pdfAnnotationMode = null; clearPdfBrowseSelection(); state.pdfSelection = null; window.getSelection()?.removeAllRanges();
  closeTranslationPopover(); updatePdfAnnotationMode();
  if (hadAnnotation && !quiet) toast('已取消当前工具');
  return hadInteraction;
}
function bringPdfSnapshotToFront(card) {
  if (!card) return;
  state.pdfSnapshotZ += 1;
  card.style.zIndex = String(state.pdfSnapshotZ);
}
function removePdfSnapshot(snapshotId) {
  const index = state.pdfSnapshots.findIndex(item => item.id === snapshotId);
  if (index < 0) return;
  const [snapshot] = state.pdfSnapshots.splice(index, 1);
  URL.revokeObjectURL(snapshot.url);
  el('pdf-snapshot-layer').querySelector(`[data-pdf-snapshot-id="${snapshotId}"]`)?.remove();
}
function addPdfSnapshotWindow(snapshot) {
  const layer = el('pdf-snapshot-layer');
  const card = document.createElement('section');
  const offset = state.pdfSnapshots.length * 24;
  const width = Math.min(390, Math.max(260, window.innerWidth - 28));
  card.className = 'pdf-snapshot-card';
  card.dataset.pdfSnapshotId = snapshot.id;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `PDF 第 ${snapshot.page} 页截图对照`);
  card.style.left = `${Math.max(12, window.innerWidth - width - 28 - offset)}px`;
  card.style.top = `${Math.min(Math.max(18, 72 + offset), Math.max(18, window.innerHeight - 220))}px`;
  card.innerHTML = `<header class="pdf-snapshot-head"><div class="pdf-snapshot-title"><strong>${escapeHtml(snapshot.paperTitle)}</strong><span>第 ${snapshot.page} 页 · 截图对照</span></div><div class="pdf-snapshot-actions"><button type="button" data-pdf-snapshot-action="note" aria-label="插入阅读笔记" title="插入阅读笔记">↘</button><button type="button" data-pdf-snapshot-action="shrink" aria-label="缩小截图">−</button><button type="button" data-pdf-snapshot-action="grow" aria-label="放大截图">＋</button><button type="button" data-pdf-snapshot-action="close" aria-label="关闭截图">×</button></div></header><img src="${snapshot.url}" alt="${escapeHtml(snapshot.paperTitle)} 第 ${snapshot.page} 页截图"><footer class="pdf-snapshot-foot"><span>拖动标题移动 · 右下角缩放</span><span>↘ 可存入阅读笔记</span></footer>`;
  layer.appendChild(card);
  bringPdfSnapshotToFront(card);
}
async function createPdfSnapshot(pageNumber, rect) {
  const stack = pdfStackForPage(pageNumber);
  const canvas = stack?.querySelector('.pdf-page-canvas');
  if (!canvas?.width || !canvas?.height) return toast('当前页面尚未完成渲染，请稍后重试');
  const sourceX = Math.max(0, Math.floor(rect.x * canvas.width));
  const sourceY = Math.max(0, Math.floor(rect.y * canvas.height));
  const sourceWidth = Math.max(1, Math.min(canvas.width - sourceX, Math.ceil(rect.width * canvas.width)));
  const sourceHeight = Math.max(1, Math.min(canvas.height - sourceY, Math.ceil(rect.height * canvas.height)));
  const outputScale = Math.min(1, 1800 / sourceWidth, 1800 / sourceHeight);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sourceWidth * outputScale));
  output.height = Math.max(1, Math.round(sourceHeight * outputScale));
  output.getContext('2d', { alpha: false }).drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
  const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png', .92));
  if (!blob) return toast('截图生成失败，请重新框选');
  while (state.pdfSnapshots.length >= 4) removePdfSnapshot(state.pdfSnapshots[0].id);
  const snapshot = {
    id: crypto.randomUUID ? crypto.randomUUID() : `snapshot-${Date.now()}`,
    page: pageNumber,
    paperId: state.pdfPaperId,
    paperTitle: getPaper(state.pdfPaperId)?.title || state.pdfRecord?.fileName || 'PDF 截图',
    url: URL.createObjectURL(blob),
    blob
  };
  addPdfSnapshotWindow(snapshot);
  state.pdfSnapshots.push(snapshot);
  state.pdfAnnotationMode = null;
  updatePdfAnnotationMode();
  toast(`第 ${pageNumber} 页截图已置顶，可拖动对照`);
}
async function addPdfAreaAnnotation(type, rect) {
  const annotationType = type === 'area-note' ? 'note' : 'area';
  const comment = type === 'area-note' ? prompt('输入区域批注：', '') : '';
  if (type === 'area-note' && comment === null) return;
  const annotation = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, type: annotationType, page: state.pdfPage, rects: [rect], text: '', comment: comment?.trim() || '', color: el('pdf-annotation-color').value, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  state.pdfRecord.annotations.push(annotation); state.pdfAnnotationHistory.push(annotation.id);
  await persistPdfRecord(); renderPdfAnnotationLayerForCurrentPage(); renderPdfAnnotationList(annotation.id);
}
async function undoPdfAnnotation() {
  const id = state.pdfAnnotationHistory.pop() || currentPdfAnnotations().at(-1)?.id;
  if (!id) return toast('没有可撤销的标注');
  const pageNumber = currentPdfAnnotations().find(item => item.id === id)?.page || state.pdfPage;
  state.pdfRecord.annotations = currentPdfAnnotations().filter(item => item.id !== id);
  await persistPdfRecord(); renderPdfAnnotationLayerForPage(pageNumber); renderPdfAnnotationList(); toast('已撤销上一条标注');
}
async function reparsePdfText() {
  if (!state.pdfDocument || !state.pdfRecord) return;
  const button = el('pdf-reparse'); button.disabled = true; const errors = {};
  try {
    for (let pageNumber = 1; pageNumber <= state.pdfDocument.numPages; pageNumber += 1) {
      setPdfProgress(pageNumber / state.pdfDocument.numPages * 100, `重新解析 ${pageNumber}/${state.pdfDocument.numPages}`);
      const page = await state.pdfDocument.getPage(pageNumber);
      try {
        const text = (await extractPdfPageText(page)).text;
        if (text) { state.pdfRecord.pages[pageNumber - 1] = text; delete state.pdfRecord.ocrPages[pageNumber]; }
      } catch (error) { errors[pageNumber] = error.message || '文本层解析失败'; }
      finally { page.cleanup(); }
    }
    state.pdfRecord.extractionErrors = errors; await persistPdfRecord('text'); await renderPdfPage();
    toast(`重新解析完成：${state.pdfRecord.pages.filter(Boolean).length}/${state.pdfRecord.pageCount} 页有文本`);
  } finally { button.disabled = false; }
}
async function getOcrWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  const module = await loadTesseractModule(); const createWorker = module.createWorker || module.default?.createWorker;
  if (typeof createWorker !== 'function') throw new Error('OCR 模块加载失败');
  state.ocrWorker = await createWorker(['eng', 'chi_sim'], 1, {
    workerPath: new URL(`./vendor/tesseract/worker.min.js?v=${APP_VERSION}`, location.href).href,
    corePath: new URL('./vendor/tesseract-core/', location.href).href.replace(/\/$/, ''),
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: message => {
      if (message.status === 'recognizing text') setPdfProgress(message.progress * 100, `OCR 识别 ${Math.round(message.progress * 100)}%`);
      else if (message.status) setPdfProgress(5, `OCR：${message.status}`);
    }
  });
  return state.ocrWorker;
}
async function ocrPdfPage(pageNumber, rerender = true) {
  if (!state.pdfDocument || !state.pdfRecord) return false;
  const page = await state.pdfDocument.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 }); const scale = Math.min(2.6, 3000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: Math.max(1.8, scale) });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const renderTask = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
  await renderTask.promise; page.cleanup();
  const worker = await getOcrWorker(); const result = await worker.recognize(canvas);
  const text = String(result.data?.text || '').normalize('NFC').replace(/\n{3,}/g, '\n\n').trim();
  if (!usefulPdfText(text)) throw new Error('OCR 未识别到有效文字，请检查页面清晰度或语言');
  state.pdfRecord.pages[pageNumber - 1] = text;
  state.pdfRecord.ocrPages[pageNumber] = { language: 'eng+chi_sim', confidence: Number(result.data?.confidence || 0), updatedAt: new Date().toISOString() };
  delete state.pdfRecord.extractionErrors[pageNumber];
  await persistPdfRecord('text'); if (rerender && state.pdfPage === pageNumber) await renderPdfPage();
  return true;
}
async function ocrCurrentPdfPage() {
  const button = el('pdf-ocr-page'); button.disabled = true;
  try { await ocrPdfPage(state.pdfPage); toast(`第 ${state.pdfPage} 页 OCR 完成`); }
  catch (error) { toast(`OCR 失败：${error.message}`); }
  finally { button.disabled = false; setPdfProgress(100, 'OCR 任务结束'); }
}
async function ocrMissingPdfPages() {
  const missing = state.pdfRecord.pages.map((text, index) => text ? null : index + 1).filter(Boolean);
  if (!missing.length) return toast('所有页面已有可检索文本');
  if (missing.length > 20 && !confirm(`共有 ${missing.length} 个无文本页。浏览器 OCR 耗时较长，本次先处理前 20 页，是否继续？`)) return;
  const targets = missing.slice(0, 20); const button = el('pdf-ocr-missing'); button.disabled = true; let success = 0;
  try {
    for (let index = 0; index < targets.length; index += 1) {
      setPdfProgress(index / targets.length * 100, `OCR 第 ${targets[index]} 页 · ${index + 1}/${targets.length}`);
      try { if (await ocrPdfPage(targets[index], false)) success += 1; } catch {}
    }
    await renderPdfPage(); toast(`OCR 完成：${success}/${targets.length} 页`);
  } finally { button.disabled = false; setPdfProgress(100, 'OCR 任务结束'); }
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function safePdfFileStem(name) { return String(name || 'paper').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 100); }
function wrapCanvasText(context, text, maxWidth) {
  const chars = [...String(text || '')]; const lines = []; let line = '';
  for (const char of chars) {
    if (char === '\n') { lines.push(line); line = ''; continue; }
    if (context.measureText(line + char).width > maxWidth && line) { lines.push(line); line = char; } else line += char;
  }
  if (line) lines.push(line); return lines;
}
async function annotationSummaryPngs(annotations) {
  const groups = []; for (let index = 0; index < annotations.length; index += 8) groups.push(annotations.slice(index, index + 8));
  const blobs = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754; const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#163e2e'; context.font = 'bold 38px "Microsoft YaHei",sans-serif'; context.fillText('PaperScope PDF 标注摘要', 80, 85);
    context.fillStyle = '#5f6f66'; context.font = '22px "Microsoft YaHei",sans-serif'; context.fillText(`${getPaper(state.pdfPaperId)?.title || state.pdfRecord.fileName} · 第 ${groupIndex + 1}/${groups.length} 页`, 80, 125);
    let y = 180;
    for (const annotation of groups[groupIndex]) {
      const number = annotations.indexOf(annotation) + 1; const color = pdfAnnotationColor(annotation.color);
      context.fillStyle = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`; context.fillRect(80, y - 22, 14, 32);
      context.fillStyle = '#18231e'; context.font = 'bold 25px "Microsoft YaHei",sans-serif'; context.fillText(`${number}. 第 ${annotation.page} 页 · ${annotationTypeLabel(annotation.type)}`, 112, y);
      y += 38; context.font = '21px "Microsoft YaHei",sans-serif'; context.fillStyle = '#33443b';
      for (const line of wrapCanvasText(context, annotation.text || '区域标注', 1030).slice(0, 4)) { context.fillText(line, 112, y); y += 29; }
      if (annotation.comment) { context.fillStyle = '#0b6b4b'; for (const line of wrapCanvasText(context, `批注：${annotation.comment}`, 1030).slice(0, 4)) { context.fillText(line, 112, y); y += 29; } }
      y += 32; context.strokeStyle = '#dce5df'; context.beginPath(); context.moveTo(80, y); context.lineTo(1160, y); context.stroke(); y += 28;
    }
    blobs.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
  }
  return blobs;
}
async function exportAnnotatedPdf() {
  const annotations = currentPdfAnnotations(); if (!annotations.length) return toast('还没有 PDF 标注');
  const button = el('pdf-export-annotated'); button.disabled = true; button.textContent = '正在生成…';
  try {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLibModule();
    const source = new Uint8Array(await state.pdfRecord.blob.arrayBuffer());
    const pdf = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
    const pages = pdf.getPages(); const font = await pdf.embedFont(StandardFonts.Helvetica); let marker = 0; let rotatedSkipped = 0;
    for (const annotation of annotations) {
      const page = pages[annotation.page - 1]; if (!page) continue; marker += 1;
      if ((page.getRotation()?.angle || 0) % 360 !== 0) { rotatedSkipped += 1; continue; }
      const { width, height } = page.getSize(); const color = pdfAnnotationColor(annotation.color);
      for (const rect of annotation.rects || []) {
        const x = rect.x * width; const y = height - (rect.y + rect.height) * height; const w = rect.width * width; const h = rect.height * height;
        if (annotation.type === 'highlight') page.drawRectangle({ x, y, width: w, height: h, color: rgb(color.r, color.g, color.b), opacity: .32 });
        else if (annotation.type === 'underline') page.drawRectangle({ x, y, width: w, height: Math.max(1.5, h * .08), color: rgb(color.r, color.g, color.b), opacity: .95 });
        else {
          page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(color.r, color.g, color.b), borderWidth: 1.7, borderOpacity: .95 });
          if (annotation.type === 'note') {
            page.drawCircle({ x: Math.min(width - 8, x + w), y: Math.min(height - 8, y + h), size: 8, color: rgb(.05, .38, .27) });
            page.drawText(String(marker), { x: Math.min(width - 11, x + w - 3.5), y: Math.min(height - 11, y + h - 3.5), size: 7, font, color: rgb(1, 1, 1) });
          }
        }
      }
    }
    for (const blob of await annotationSummaryPngs(annotations)) {
      const image = await pdf.embedPng(await blob.arrayBuffer()); const page = pdf.addPage([595.28, 841.89]);
      page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    pdf.setModificationDate(new Date()); pdf.setProducer('PaperScope PDF annotation export');
    const bytes = await pdf.save({ useObjectStreams: false });
    downloadBlob(`${safePdfFileStem(state.pdfRecord.fileName)}-annotated.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    toast(`带标注 PDF 已导出${rotatedSkipped ? `；${rotatedSkipped} 条旋转页标注仅写入摘要` : ''}`);
  } catch (error) { toast(`导出失败：${error.message}`); }
  finally { button.disabled = false; button.textContent = '导出带标注 PDF'; }
}
function exportPdfAnnotations() {
  if (!state.pdfRecord) return;
  const payload = { schema: 'paperscope-pdf-annotations-v1', paperId: state.pdfPaperId, fileName: state.pdfRecord.fileName, pageCount: state.pdfRecord.pageCount, exportedAt: new Date().toISOString(), annotations: currentPdfAnnotations() };
  downloadText(`${safePdfFileStem(state.pdfRecord.fileName)}-annotations.json`, JSON.stringify(payload, null, 2), 'application/json');
}
async function importPdfAnnotationsFile(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.schema !== 'paperscope-pdf-annotations-v1' || !Array.isArray(payload.annotations)) throw new Error('不是有效的 PaperScope PDF 标注文件');
    if (Number(payload.pageCount) !== Number(state.pdfRecord.pageCount) && !confirm('标注文件页数与当前 PDF 不一致，仍要导入吗？')) return;
    const existing = new Set(currentPdfAnnotations().map(item => item.id));
    const imported = payload.annotations.filter(item => item?.id && !existing.has(String(item.id)) && Number(item.page) >= 1 && Number(item.page) <= state.pdfRecord.pageCount && ['highlight', 'underline', 'note', 'area'].includes(item.type) && Array.isArray(item.rects)).map(item => ({
      id: String(item.id).slice(0, 120),
      type: item.type,
      page: Number(item.page),
      rects: item.rects.filter(rect => [rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite)).map(rect => ({
        x: Math.max(0, Math.min(1, rect.x)),
        y: Math.max(0, Math.min(1, rect.y)),
        width: Math.max(0, Math.min(1, rect.width)),
        height: Math.max(0, Math.min(1, rect.height))
      })).filter(rect => rect.width > 0 && rect.height > 0),
      text: String(item.text || '').slice(0, 2000),
      comment: String(item.comment || '').slice(0, 2000),
      color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#f4d35e',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })).filter(item => item.rects.length);
    state.pdfRecord.annotations.push(...imported);
    await persistPdfRecord(); renderAllPdfAnnotationLayers(); renderPdfAnnotationList(); toast('PDF 标注已导入');
  } catch (error) { toast(error.message || '标注导入失败'); }
}
function closePdfReader() {
  if (state.pdfRecord && state.pdfNoteDirty) savePdfWorkspaceNote({ quiet: true }).catch(() => {});
  state.pdfRenderTask?.cancel(); state.pdfRenderTask = null;
  clearPdfPageObservers(); cancelPdfAnnotationInteraction({ quiet: true });
  clearPdfSearch();
  state.pdfLoadingTask?.destroy().catch(() => {});
  state.pdfLoadingTask = null; state.pdfDocument = null; state.pdfRecord = null; state.pdfPaperId = null; state.pdfTextContent = null; state.pdfSelection = null; state.pdfAnnotationMode = null;
}
function normalizedPdfSearchText(value = '', withMap = false) {
  let text = ''; const map = []; let whitespace = false;
  const source = String(value || '').normalize('NFKC');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (/\s/.test(char)) {
      if (!text || whitespace) continue;
      text += ' '; map.push(index); whitespace = true; continue;
    }
    const normalized = char.toLocaleLowerCase();
    for (const part of normalized) { text += part; map.push(index); }
    whitespace = false;
  }
  if (text.endsWith(' ')) { text = text.slice(0, -1); map.pop(); }
  return withMap ? { text, map } : text;
}
function pdfSearchMatchesForPage(text, page, query) {
  const normalized = normalizedPdfSearchText(text, true); const matches = [];
  let position = 0;
  while (query && position <= normalized.text.length - query.length && matches.length < 200) {
    const found = normalized.text.indexOf(query, position); if (found < 0) break;
    const start = normalized.map[found] ?? found; const end = (normalized.map[found + query.length - 1] ?? start) + 1;
    matches.push({ page, start, end, text: String(text || '') });
    position = found + Math.max(1, query.length);
  }
  return matches;
}
function pdfSearchExcerpt(match) {
  const text = String(match.text || '').replace(/\s+/g, ' ');
  const sourceBefore = String(match.text || '').slice(0, match.start).replace(/\s+/g, ' ');
  const displayStart = Math.max(0, sourceBefore.length - 52);
  const hit = String(match.text || '').slice(match.start, match.end).replace(/\s+/g, ' ');
  const before = text.slice(displayStart, Math.min(text.length, sourceBefore.length));
  const after = text.slice(Math.min(text.length, sourceBefore.length + hit.length), Math.min(text.length, sourceBefore.length + hit.length + 76));
  return `${displayStart ? '…' : ''}${escapeHtml(before)}<mark>${escapeHtml(hit)}</mark>${escapeHtml(after)}${sourceBefore.length + hit.length + 76 < text.length ? '…' : ''}`;
}
function closePdfSearchResults() { el('pdf-search-results')?.classList.add('hidden'); }
function clearPdfSearch({ clearInput = true } = {}) {
  state.pdfSearchQuery = ''; state.pdfSearchMatches = []; state.pdfSearchIndex = -1;
  if (clearInput && el('pdf-search-input')) el('pdf-search-input').value = '';
  const container = el('pdf-search-results'); if (container) { container.classList.add('hidden'); container.replaceChildren(); }
  document.querySelectorAll('.pdf-search-mark').forEach(mark => mark.remove());
}
function renderPdfSearchResults() {
  const container = el('pdf-search-results'); if (!container) return;
  const matches = state.pdfSearchMatches;
  const header = `<div class="pdf-search-results-head"><strong>${matches.length ? `${matches.length} 处匹配` : '没有匹配内容'}</strong><button type="button" class="small" data-pdf-search-action="previous" aria-label="上一个匹配">↑</button><button type="button" class="small" data-pdf-search-action="next" aria-label="下一个匹配">↓</button><button type="button" class="small" data-pdf-search-action="close" aria-label="收起搜索结果">×</button></div>`;
  container.innerHTML = header + (matches.length
    ? matches.map((match, index) => `<button type="button" class="${index === state.pdfSearchIndex ? 'active' : ''}" data-pdf-search-index="${index}"><b>第 ${match.page} 页 · 第 ${index + 1} 处</b><br>${pdfSearchExcerpt(match)}</button>`).join('')
    : '<div class="panel-note">请检查关键词，或先对扫描页运行 OCR。</div>');
  container.classList.remove('hidden');
}
function pdfTextLayerSearchMap(layer) {
  const layout = pdfVisualTextLayout(layer); let text = ''; const map = []; let previous = null;
  const append = (value, node, start) => {
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (/\s/.test(char)) {
        if (!text || text.endsWith(' ')) continue;
        text += ' '; map.push({ node, offset: start + index }); continue;
      }
      const normalized = char.normalize('NFKC').toLocaleLowerCase();
      for (const part of normalized) { text += part; map.push({ node, offset: start + index }); }
    }
  };
  for (const fragment of layout.fragments) {
    const changedRun = previous && (fragment.lineIndex !== previous.lineIndex || fragment.runIndex !== previous.runIndex);
    if (changedRun && text && !text.endsWith(' ') && !/[-/\s]$/.test(previous.text) && !/^[,.;:!?)}\]]/.test(fragment.text)) {
      text += ' '; map.push({ node: previous.node, offset: previous.end });
    }
    append(fragment.text, fragment.node, fragment.start); previous = fragment;
  }
  return { text: text.trimEnd(), map, bounds: layout.bounds };
}
function pdfSearchRectsForMappedMatch(mapped, start, end) {
  const groups = [];
  for (let index = start; index < end; index += 1) {
    const point = mapped.map[index]; if (!point?.node) continue;
    const last = groups.at(-1);
    if (last?.node === point.node && point.offset <= last.end + 1) last.end = Math.max(last.end, point.offset + 1);
    else groups.push({ node: point.node, start: point.offset, end: point.offset + 1 });
  }
  return groups.flatMap(group => {
    try {
      const range = document.createRange(); range.setStart(group.node, group.start); range.setEnd(group.node, group.end);
      return [...range.getClientRects()].filter(rect => rect.width > .15 && rect.height > .5);
    } catch { return []; }
  });
}
function renderPdfSearchHighlightsForStack(stack) {
  if (!stack) return;
  const annotationLayer = stack.querySelector('.pdf-annotation-layer'); const textLayer = stack.querySelector('.textLayer');
  annotationLayer?.querySelectorAll('.pdf-search-mark').forEach(mark => mark.remove());
  const query = state.pdfSearchQuery; const page = Number(stack.dataset.page);
  if (!annotationLayer || !textLayer || !query || !textLayer.querySelector('span')) return;
  const mapped = pdfTextLayerSearchMap(textLayer); if (!mapped.text) return;
  const pageMatches = state.pdfSearchMatches.map((match, index) => ({ ...match, index })).filter(match => match.page === page);
  let position = 0; let occurrence = 0;
  while (position <= mapped.text.length - query.length && occurrence < 200) {
    const found = mapped.text.indexOf(query, position); if (found < 0) break;
    const rects = pdfSearchRectsForMappedMatch(mapped, found, found + query.length);
    const active = pageMatches[occurrence]?.index === state.pdfSearchIndex;
    for (const rect of rects) {
      const mark = document.createElement('i'); mark.className = `pdf-search-mark${active ? ' current' : ''}`;
      mark.style.left = `${Math.max(0, (rect.left - mapped.bounds.left) / mapped.bounds.width) * 100}%`;
      mark.style.top = `${Math.max(0, (rect.top - mapped.bounds.top) / mapped.bounds.height) * 100}%`;
      mark.style.width = `${Math.min(1, rect.width / mapped.bounds.width) * 100}%`;
      mark.style.height = `${Math.min(1, rect.height / mapped.bounds.height) * 100}%`;
      annotationLayer.append(mark);
    }
    occurrence += 1; position = found + Math.max(1, query.length);
  }
}
async function activatePdfSearchMatch(index, { keepResultsOpen = true } = {}) {
  const matches = state.pdfSearchMatches; if (!matches.length) return;
  state.pdfSearchIndex = (Number(index) + matches.length) % matches.length;
  const match = matches[state.pdfSearchIndex];
  document.querySelectorAll('.pdf-search-mark.current').forEach(mark => mark.classList.remove('current'));
  await goToPdfPage(match.page, { behavior: 'auto' });
  updatePdfCurrentPage(match.page);
  renderPdfAnnotationLayerForPage(match.page);
  renderPdfSearchResults();
  if (!keepResultsOpen) closePdfSearchResults();
  requestAnimationFrame(() => {
    pdfStackForPage(match.page)?.querySelector('.pdf-search-mark.current')?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  });
}
function movePdfSearchMatch(direction) {
  if (!state.pdfSearchMatches.length) return;
  activatePdfSearchMatch((state.pdfSearchIndex < 0 ? 0 : state.pdfSearchIndex) + direction);
}
async function searchPdfText({ advanceIfSame = false } = {}) {
  const query = normalizedPdfSearchText(el('pdf-search-input').value.trim());
  if (!query) { clearPdfSearch(); return; }
  if (advanceIfSame && query === state.pdfSearchQuery && state.pdfSearchMatches.length) {
    movePdfSearchMatch(1); return;
  }
  state.pdfSearchQuery = query;
  state.pdfSearchMatches = (state.pdfRecord?.pages || []).flatMap((text, index) => pdfSearchMatchesForPage(text, index + 1, query)).slice(0, 200);
  state.pdfSearchIndex = state.pdfSearchMatches.length ? 0 : -1;
  setPdfInspector(true, 'annotations');
  renderPdfSearchResults();
  renderAllPdfAnnotationLayers();
  if (state.pdfSearchMatches.length) await activatePdfSearchMatch(0);
}
async function removeAttachedPdf(paperId) {
  if (!confirm('移除本机保存的 PDF？收藏、笔记和论文元数据会保留。')) return;
  const record = getRecord(paperId);
  await deleteStoredPdf(paperId, record?.pdfAttachment?.attachmentId || null);
  if (record) {
    record.pdfAttachments = (record.pdfAttachments || []).filter(item => item.attachmentId !== record.pdfAttachment?.attachmentId);
    record.pdfAttachment = record.pdfAttachments[0] || null;
  }
  saveLibrary(); renderPdfAttachmentStatus(record); toast('本地 PDF 已移除');
}
async function downloadAttachedPdf(paperId) {
  const stored = await getStoredPdf(paperId, getRecord(paperId)?.pdfAttachment?.attachmentId || null); if (!stored?.blob) return toast('本地 PDF 文件不存在');
  const url = URL.createObjectURL(stored.blob); const link = document.createElement('a'); link.href = url; link.download = stored.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizedAuthor(name = '') { return name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function localLineageWorks(paper) {
  const authors = new Set((paper.authors || []).map(normalizedAuthor).filter(Boolean));
  const selectedYear = Number(String(paper.published || '').slice(0, 4)) || new Date().getFullYear();
  return allPapers().filter(item => item.id !== paper.id).map(item => {
    const overlap = (item.authors || []).filter(name => authors.has(normalizedAuthor(name)));
    return { id: item.id, title: item.title, year: Number(String(item.published || '').slice(0, 4)) || null, venue: item.venueName || item.venue || item.source, url: safeUrl(item.link), citationCount: Number(item.citationCount || 0), sharedAuthors: overlap, support: overlap.length, source: 'PaperScope 本地语料' };
  }).filter(item => item.support && (!item.year || item.year <= selectedYear)).sort((a, b) => b.support - a.support || b.citationCount - a.citationCount).slice(0, 12);
}
async function fetchJson(url, timeout = 15000) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    if (response.ok) return response.json();
    if (![429, 503].includes(response.status) || attempt === 1) throw new Error(`HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get('retry-after') || 1);
    await new Promise(resolve => setTimeout(resolve, Math.min(3500, Math.max(900, retryAfter * 1000))));
  }
  throw new Error('请求失败');
}
function semanticScholarPaperId(paper) {
  if (paper.doi) return `DOI:${paper.doi}`;
  if (paper.arxivId) return `ARXIV:${paper.arxivId.replace(/v\d+$/, '')}`;
  return null;
}
async function crossrefAffiliations(paper) {
  if (!paper.doi) return [];
  try {
    const data = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(paper.doi)}`);
    return [...new Set((data.message?.author || []).flatMap(author => (author.affiliation || []).map(item => item.name)).filter(Boolean))];
  } catch { return []; }
}
async function crossrefPriorWorks(paper) {
  const authors = (paper.authors || []).filter(Boolean);
  if (!authors.length) return [];
  const selectedNames = [...new Set([authors[0], authors[1], authors[authors.length - 1]].filter(Boolean))];
  const currentAuthors = new Map(authors.map(name => [normalizedAuthor(name), name]));
  const selectedYear = Number(String(paper.published || '').slice(0, 4)) || new Date().getFullYear();
  const orcidByAuthor = new Map();
  if (paper.doi) {
    try {
      const current = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(paper.doi)}`);
      for (const author of current.message?.author || []) {
        const name = `${author.given || ''} ${author.family || ''}`.trim();
        const orcid = String(author.ORCID || '').split('/').pop();
        if (name && orcid) orcidByAuthor.set(normalizedAuthor(name), orcid);
      }
    } catch {}
  }
  const results = [];
  for (const authorName of selectedNames) {
    try {
      const url = new URL('https://api.crossref.org/works');
      const orcid = orcidByAuthor.get(normalizedAuthor(authorName));
      if (orcid) {
        url.searchParams.set('filter', `orcid:${orcid},until-pub-date:${selectedYear}-12-31`);
        url.searchParams.set('sort', 'published');
        url.searchParams.set('order', 'desc');
      } else {
        url.searchParams.set('query.author', authorName);
        url.searchParams.set('filter', `until-pub-date:${selectedYear}-12-31`);
      }
      url.searchParams.set('rows', '30');
      url.searchParams.set('select', 'DOI,title,author,published,published-online,container-title,URL,is-referenced-by-count,type');
      const data = await fetchJson(url);
      for (const item of data.message?.items || []) {
        const title = item.title?.[0] || ''; const doi = item.DOI || '';
        if (!title || doi.toLowerCase() === String(paper.doi || '').toLowerCase() || titleSimilarity(title, paper.title) > .9) continue;
        const itemAuthors = (item.author || []).map(author => `${author.given || ''} ${author.family || ''}`.trim()).filter(Boolean);
        const sharedAuthors = itemAuthors.map(name => currentAuthors.get(normalizedAuthor(name))).filter(Boolean);
        if (!sharedAuthors.length || !sharedAuthors.some(name => normalizedAuthor(name) === normalizedAuthor(authorName))) continue;
        const parts = item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0] || [];
        results.push({
          id: doi || `${title}:${parts[0] || ''}`, title, year: parts[0] || null,
          venue: item['container-title']?.[0] || item.type || 'Crossref',
          url: item.URL || (doi ? `https://doi.org/${doi}` : '#'),
          citationCount: Number(item['is-referenced-by-count'] || 0),
          sharedAuthors: [...new Set(sharedAuthors)], support: new Set(sharedAuthors).size, source: orcid ? 'Crossref · ORCID' : 'Crossref 作者检索'
        });
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return results.sort((a, b) => b.support - a.support || b.citationCount - a.citationCount).slice(0, 15);
}
async function semanticScholarPaper(paper) {
  const fields = 'title,year,citationCount,authors,openAccessPdf,externalIds,url';
  const id = semanticScholarPaperId(paper);
  if (id) return fetchJson(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`);
  const result = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(paper.title)}&limit=3&fields=${encodeURIComponent(fields)}`);
  return (result.data || []).map(item => ({ item, score: titleSimilarity(paper.title, item.title || '') })).sort((a, b) => b.score - a.score)[0]?.score >= .78 ? (result.data || []).map(item => ({ item, score: titleSimilarity(paper.title, item.title || '') })).sort((a, b) => b.score - a.score)[0].item : null;
}
async function semanticScholarAuthor(authorId) {
  const fields = 'name,affiliations,paperCount,citationCount,hIndex,papers.title,papers.year,papers.venue,papers.url,papers.citationCount,papers.externalIds';
  return fetchJson(`https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}?fields=${encodeURIComponent(fields)}`);
}
function mergeLineageWorks(profiles, currentPaperId, selectedYear) {
  const merged = new Map();
  for (const profile of profiles) for (const work of profile.papers || []) {
    if (!work.paperId || work.paperId === currentPaperId || (work.year && work.year > selectedYear)) continue;
    const item = merged.get(work.paperId) || { id: work.paperId, title: work.title, year: work.year, venue: work.venue, url: work.url, citationCount: Number(work.citationCount || 0), sharedAuthors: [], support: 0, source: 'Semantic Scholar' };
    item.support += 1; item.sharedAuthors.push(profile.name); item.citationCount = Math.max(item.citationCount, Number(work.citationCount || 0)); merged.set(work.paperId, item);
  }
  return [...merged.values()].sort((a, b) => b.support - a.support || b.citationCount - a.citationCount || (b.year || 0) - (a.year || 0)).slice(0, 15);
}
function renderLineagePanel(record) {
  const data = record?.lineage;
  el('lineage-body').classList.toggle('hidden', !data);
  if (!data) return;
  el('lineage-status').innerHTML = `${escapeHtml(data.sourceLabel || '本地作者交集')}${data.checkedAt ? ` · 更新 ${escapeHtml(dateText(data.checkedAt, true))}` : ''}${data.openAccess?.url ? ` · <a href="${escapeHtml(safeUrl(data.openAccess.url))}" target="_blank" rel="noopener">开放版本 ↗</a>` : ''}`;
  el('lineage-summary').innerHTML = `<div class="lineage-metric"><span>可核验作者</span><b>${data.authors?.length || 0}</b></div><div class="lineage-metric"><span>机构线索</span><b>${data.institutions?.length || 0}</b></div><div class="lineage-metric"><span>历史工作</span><b>${data.works?.length || 0}</b></div>`;
  el('lineage-institutions').innerHTML = data.institutions?.length ? data.institutions.map(name => `<span class="tag">${escapeHtml(name)}</span>`).join('') : '<span class="panel-note">公开元数据未提供机构；这不代表作者没有机构归属。</span>';
  el('lineage-authors').innerHTML = (data.authors || []).map(author => `<div class="lineage-author"><b>${escapeHtml(author.name)}</b><span>${author.role ? `${escapeHtml(author.role)} · ` : ''}${author.paperCount != null ? `${author.paperCount} 篇 · h ${author.hIndex ?? '—'}` : '本地作者信息'}</span></div>`).join('');
  el('lineage-works').innerHTML = data.works?.length ? data.works.map(work => `<article class="lineage-work"><div><a href="${escapeHtml(safeUrl(work.url))}" target="_blank" rel="noopener">${escapeHtml(work.title)}</a><p>${escapeHtml(work.year || '年份未知')} · ${escapeHtml(work.venue || '来源未知')} · ${work.support >= 2 ? `${work.support} 位当前作者共同参与` : `共同作者：${escapeHtml((work.sharedAuthors || []).slice(0, 3).join('、') || '1 位')}`} · 被引 ${Number(work.citationCount || 0)}</p></div><span class="tag">${escapeHtml(work.source)}</span></article>`).join('') : '<div class="panel-note">暂未找到可核验的先前工作。</div>';
}
async function loadPaperLineage(paperId) {
  const paper = getPaper(paperId); const record = ensureRecord(paper); if (!paper || !record) return;
  const requestId = ++state.lineageRequestId; const button = el('detail-lineage');
  el('lineage-body').classList.remove('hidden'); el('lineage-status').textContent = '正在匹配论文、作者、机构和先前工作…'; button.disabled = true; button.textContent = '查询中…';
  const localWorks = localLineageWorks(paper);
  try {
    const [s2Result, crossrefInstitutions, crossrefWorksResult] = await Promise.allSettled([semanticScholarPaper(paper), crossrefAffiliations(paper), crossrefPriorWorks(paper)]);
    if (requestId !== state.lineageRequestId) return;
    const s2Paper = s2Result.status === 'fulfilled' ? s2Result.value : null;
    const candidates = (s2Paper?.authors || []).filter(author => author.authorId);
    const sampled = candidates.length <= 2 ? candidates : [candidates[0], candidates[candidates.length - 1]].filter(Boolean);
    const profiles = [];
    for (const author of sampled) {
      try { profiles.push(await semanticScholarAuthor(author.authorId)); } catch {}
      await new Promise(resolve => setTimeout(resolve, 950));
    }
    if (requestId !== state.lineageRequestId) return;
    const selectedYear = Number(String(paper.published || '').slice(0, 4)) || new Date().getFullYear();
    const remoteWorks = mergeLineageWorks(profiles, s2Paper?.paperId, selectedYear);
    const crossrefWorks = crossrefWorksResult.status === 'fulfilled' ? crossrefWorksResult.value : [];
    const works = [...remoteWorks, ...crossrefWorks, ...localWorks].filter((item, index, items) => items.findIndex(other => normalizedAuthor(other.title) === normalizedAuthor(item.title)) === index).slice(0, 15);
    const institutions = [...new Set([...(crossrefInstitutions.status === 'fulfilled' ? crossrefInstitutions.value : []), ...profiles.flatMap(profile => profile.affiliations || [])])];
    const firstId = candidates[0]?.authorId; const lastId = candidates[candidates.length - 1]?.authorId;
    const authorRows = profiles.length ? profiles : (paper.authors || []).slice(0, 8).map(name => ({ name }));
    const authors = authorRows.map((profile, index, items) => ({
      name: profile.name, paperCount: profile.paperCount, citationCount: profile.citationCount, hIndex: profile.hIndex,
      role: profiles.length && profile.authorId === firstId ? '第一作者线索' : profiles.length && profile.authorId === lastId ? '末位作者线索' : !profiles.length && index === 0 ? '第一作者线索' : !profiles.length && index === items.length - 1 ? '末位作者线索' : '共同作者线索'
    }));
    record.lineage = {
      checkedAt: new Date().toISOString(),
      sourceLabel: s2Paper ? 'Semantic Scholar + Crossref + 本地作者交集' : 'Crossref + 本地作者交集',
      matchTitle: s2Paper?.title || null,
      institutions,
      authors,
      works,
      openAccess: s2Paper?.openAccessPdf?.url ? { url: s2Paper.openAccessPdf.url, status: s2Paper.openAccessPdf.status, license: s2Paper.openAccessPdf.license } : null
    };
    saveLibrary(); renderLineagePanel(record); toast(`已找到 ${works.length} 篇历史工作`);
  } catch (error) {
    record.lineage = {
      checkedAt: new Date().toISOString(), sourceLabel: 'PaperScope 本地作者交集',
      institutions: [], authors: (paper.authors || []).slice(0, 8).map((name, index, items) => ({ name, role: index === 0 ? '第一作者线索' : index === items.length - 1 ? '末位作者线索' : '共同作者线索' })),
      works: localWorks
    };
    saveLibrary(); renderLineagePanel(record); toast(error.message || '外部追溯失败，已显示本地结果');
  } finally { button.disabled = false; button.textContent = record.lineage ? '刷新追溯' : '查询追溯'; }
}

function toggleCompare(id) { if (state.compare.has(id)) state.compare.delete(id); else if (state.compare.size >= 3) return toast('最多同时对比 3 篇论文'); else state.compare.add(id); updateCompareTray(); renderCurrentView(); renderDrawerActions(); }
function updateCompareTray() { el('compare-count').textContent = `已选 ${state.compare.size} 篇`; el('compare-tray').classList.toggle('show', state.compare.size > 0); }
function renderCompare() {
  const papers = [...state.compare].map(getPaper).filter(Boolean); if (papers.length < 2) { closeModal('compare-modal'); return toast('请至少选择 2 篇论文'); }
  const rows = [
    ['标题', paper => `<strong>${escapeHtml(paper.title)}</strong>`], ['领域', paper => paper.area === 'architecture' ? '体系结构' : 'AI'], ['时间', paper => escapeHtml(dateText(paper.published))],
    ['来源', paper => escapeHtml(`${paper.venue || paper.source}`)], ['主题', paper => paperTopics(paper).map(escapeHtml).join('、') || '—'],
    ['摘要', paper => escapeHtml((paper.abstract || '').slice(0, 520))], ['我的笔记', paper => escapeHtml(getRecord(paper.id)?.note || '—')], ['发表状态', paper => escapeHtml(publicationInfo(getRecord(paper.id), paper).label)]
  ];
  el('compare-table').innerHTML = `<thead><tr><th>维度</th>${papers.map((paper, index) => `<th>论文 ${index + 1}<br><button class="small" data-compare-remove="${escapeHtml(paper.id)}">移除</button></th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><th>${label}</th>${papers.map(paper => `<td>${value(paper)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  el('compare-modal').classList.add('open');
}

const COMMAND_PAGES = [
  { label: '今日概览', hint: 'Home', route: 'home' }, { label: 'AI 论文', hint: 'Algorithms & Models', route: 'ai' }, { label: '体系结构论文', hint: 'Hardware & Systems', route: 'architecture' },
  { label: '顶会期刊精选', hint: 'Quality-first & Daily', route: 'curated' }, { label: '个人文献库', hint: 'Library', route: 'library/all' },
  { label: '待整理文献', hint: 'Inbox', route: 'library/unfiled' }, { label: '文献分类', hint: 'Collections', route: 'library/collections' }, { label: '阅读队列', hint: 'Queue', route: 'library/queue' },
  { label: '归档文献', hint: 'Archive', route: 'library/archive' }, { label: '回收站', hint: 'Trash', route: 'library/trash' },
  { label: '研究资讯', hint: 'Official News', route: 'news' }, { label: '会议与期刊', hint: 'Venues', route: 'venues' }, { label: '设置与数据', hint: 'Settings', route: 'settings' }
];
function renderCommands(query = '') {
  const normalized = query.toLowerCase(); const pages = COMMAND_PAGES.filter(item => !normalized || `${item.label} ${item.hint}`.toLowerCase().includes(normalized)); const papers = normalized ? allPapers().filter(paper => `${paper.title} ${(paper.authors || []).join(' ')}`.toLowerCase().includes(normalized)).slice(0, 8) : [];
  el('command-list').innerHTML = `${pages.map(item => `<button class="command-item" data-command-route="${item.route}"><span>${item.label}</span><small>${item.hint}</small></button>`).join('')}${papers.map(paper => `<button class="command-item" data-command-paper="${escapeHtml(paper.id)}"><span>${escapeHtml(paper.title)}</span><small>${paper.area === 'architecture' ? '体系结构' : 'AI'}</small></button>`).join('')}` || '<div class="empty">没有匹配结果</div>';
}
function openCommand(query = '') { el('command-modal').classList.add('open'); el('command-input').value = query; renderCommands(query); setTimeout(() => el('command-input').focus(), 0); }
function closeModal(id) {
  el(id).classList.remove('open');
  if (id === 'pdf-modal') closePdfReader();
  if (id === 'appearance-modal' && appearanceSnapshot) {
    uiSettings = appearanceSnapshot;
    appearanceSnapshot = null;
    applyUiSettings({ save: false });
  }
}

function toggleVenueSave(name) { const saved = new Set(library.savedVenues || []); saved.has(name) ? saved.delete(name) : saved.add(name); library.savedVenues = [...saved]; saveLibrary(); renderCurrentView(); }
function downloadIcs(venue) {
  if (!venue.deadlineAt) return toast('官方尚未公布明确日期，暂不能导出日历'); const start = new Date(venue.deadlineAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const content = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PaperScope//Venue Deadline//CN\r\nBEGIN:VEVENT\r\nUID:${slug(venue.name)}-${start}@paperscope\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}\r\nDTSTART:${start}\r\nSUMMARY:${venue.name} ${venue.deadlineName || '投稿截止'}\r\nURL:${venue.officialUrl}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  downloadText(`${slug(venue.name)}-deadline.ics`, content, 'text/calendar');
}

function migrateLegacySaved() {
  const ids = readJson(LEGACY_SAVED_KEY, []); if (!Array.isArray(ids)) return;
  for (const id of ids) { const paper = getPaper(id); if (paper) ensureRecord(paper).savedAt ||= new Date().toISOString(); }
  localStorage.removeItem(LEGACY_SAVED_KEY); saveLibrary();
}
function syncLibraryPapers() {
  for (const paper of allPapers()) {
    const record = getRecord(paper.id);
    if (record) {
      record.paper = snapshotPaper(paper);
      if (paper.publication?.status === 'published') record.publication = paper.publication;
    }
    if (library.recent?.[paper.id]) library.recent[paper.id].paper = snapshotPaper(paper);
  }
  saveLibrary();
}
async function loadData(force = false) {
  try {
    const suffix = force ? `?v=${Date.now()}` : ''; const get = async path => { const response = await fetch(`${path}${suffix}`, { cache: force ? 'reload' : 'default' }); if (!response.ok) throw new Error(`${path} 加载失败`); return response.json(); };
    const [papers, architecture, news, venues, digest, curated] = await Promise.all([get('./data/papers.json'), get('./data/architecture.json'), get('./data/news.json'), get('./data/venues.json'), get('./data/digest.json'), get('./data/curated.json')]);
    state.datasets.ai = { ...papers, ...digest }; state.datasets.architecture = architecture; state.news = news; state.venues = venues; state.curated = curated; state.loaded = true;
    migrateLegacySaved(); syncLibraryPapers(); renderProfile(); el('side-sync').textContent = `${dateText(papers.generatedAt, true)} · ${papers.items.length + architecture.items.length} 篇 · ${curated.sections.length} 专栏`;
    renderRoute(); if (force) toast(`已检查：数据生成于 ${dateText(papers.generatedAt, true)}`);
  } catch (error) { toast(error.message || '数据加载失败'); document.querySelectorAll('.paper-list').forEach(node => { node.innerHTML = '<div class="empty">无法加载已发布数据，请稍后刷新。</div>'; }); }
}

function showAppUpdate(registration) {
  const waitingUrl = registration.waiting?.scriptURL || '';
  const controllerUrl = navigator.serviceWorker.controller?.scriptURL || '';
  if (!waitingUrl || waitingUrl === controllerUrl) return;
  state.serviceWorkerRegistration = registration;
  el('update-banner').classList.add('show');
}
async function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!state.updateReloading) return;
    location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(`./service-worker.js?v=${APP_VERSION}`);
    state.serviceWorkerRegistration = registration;
    if (registration.waiting && navigator.serviceWorker.controller) showAppUpdate(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing; if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showAppUpdate(registration);
      });
    });
    registration.update().catch(() => {});
  } catch {}
}

function saveTranslationSettings() {
  try { localStorage.setItem(TRANSLATION_SETTINGS_KEY, JSON.stringify(translationSettings)); } catch {}
  applyTranslationSettings();
  if (el('settings-translation-summary')) el('settings-translation-summary').textContent = translationSettings.enabled ? `已启用 · ${translationSettings.mode === 'online' ? '在线优先' : translationSettings.mode === 'offline' ? '仅离线' : '自动'}` : '已关闭';
}
function openTranslationSettings() {
  applyTranslationSettings();
  el('translation-modal').classList.add('open');
  requestAnimationFrame(() => el('translation-dialog').focus());
  toast('翻译设置已打开，可准备语言包或调整开关');
  Promise.allSettled([detectTranslationCapability(), loadDictionaryManifest(), loadDomainDictionary()]);
}
function applyTranslationSettings() {
  document.documentElement.classList.toggle('translation-enabled', translationSettings.enabled);
  el('translation-open').classList.toggle('active', translationSettings.enabled);
  el('translation-open').setAttribute('aria-pressed', String(translationSettings.enabled));
  el('translation-open').title = translationSettings.enabled ? '阅读翻译已开启 · 点击设置' : '阅读翻译已关闭 · 点击设置';
  el('translation-enabled').checked = translationSettings.enabled;
  el('translation-mode').value = translationSettings.mode;
  el('translation-word-click').checked = translationSettings.wordClick;
  el('translation-word-click-mode').value = translationSettings.wordClickMode === 'direct' ? 'direct' : 'ctrl';
  el('translation-selection').checked = translationSettings.selection;
  el('translation-position-mode').value = translationSettings.positionMode;
  el('translation-endpoint').value = translationSettings.onlineEndpoint || '';
  el('translation-cache').checked = translationSettings.cache;
  el('translation-mode').disabled = !translationSettings.enabled;
  el('translation-word-click').disabled = !translationSettings.enabled;
  el('translation-word-click-mode').disabled = !translationSettings.enabled || !translationSettings.wordClick;
  el('translation-selection').disabled = !translationSettings.enabled;
  el('translation-position-mode').disabled = !translationSettings.enabled;
  el('translation-endpoint').disabled = !translationSettings.enabled;
  el('translation-cache').disabled = !translationSettings.enabled;
  if (!translationSettings.enabled) closeTranslationPopover();
  syncTranslationPinButton();
  syncTranslationDockButton();
  renderTranslationEngineStatus();
}
function normalizedTranslationText(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function translationCacheKey(text) { return `en-zh:${normalizedTranslationText(text).toLocaleLowerCase('en-US')}`; }
function cachedTranslation(text) {
  if (!translationSettings.cache) return null;
  const item = translationCache[translationCacheKey(text)];
  if (!item?.translation) return null;
  item.usedAt = new Date().toISOString();
  return item;
}
function storeTranslation(text, translation, details = {}) {
  if (!translationSettings.cache) return;
  const now = new Date().toISOString();
  const key = translationCacheKey(text);
  translationCache[key] = { translation, ...details, usedAt: now, createdAt: translationCache[key]?.createdAt || now };
  translationCache = limitTranslationCache(translationCache);
  try { localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(translationCache)); } catch {}
}
function translationAvailabilityStatus(value) {
  if (['available', 'readily'].includes(value)) return 'available';
  if (['downloadable', 'after-download'].includes(value)) return 'downloadable';
  if (value === 'downloading') return 'downloading';
  return 'unavailable';
}
function renderTranslationEngineStatus(progress) {
  const title = el('translation-engine-title'); const detail = el('translation-engine-detail'); const prepare = el('translation-prepare');
  if (!title || !detail || !prepare) return;
  const labels = {
    checking: ['离线多义词典可用 · 正在检查本地模型', '单词查询不会上传；段落翻译会优先使用浏览器本地模型。'],
    available: ['离线词典与本地翻译均已就绪', '英译中可在浏览器内完成；在线精译仅在你主动使用时发送文本。'],
    downloadable: ['离线词典可用 · 本地语言包待下载', '单词可以直接查多义词典；首次段落翻译需下载浏览器语言包。'],
    downloading: ['正在准备本地语言包', progress === undefined ? '请保持页面打开。' : `下载进度 ${Math.round(progress * 100)}%`],
    unsupported: ['离线多义词典可用', '当前浏览器不支持本地段落翻译，可配置在线精译代理作为补充。'],
    unavailable: ['离线多义词典可用', '当前设备无法使用英译中本地模型，可继续查词或使用在线精译。'],
    error: ['离线多义词典可用 · 本地模型异常', state.translatorError || '可继续查词，或配置在线精译代理。']
  };
  const [heading, description] = labels[state.translatorStatus] || labels.checking;
  title.textContent = heading; detail.textContent = description;
  prepare.disabled = ['checking', 'downloading', 'unsupported', 'unavailable'].includes(state.translatorStatus) || !translationSettings.enabled;
  prepare.textContent = state.translatorStatus === 'available' ? '本地翻译已就绪' : state.translatorStatus === 'downloading' ? '正在下载…' : state.translatorStatus === 'error' ? '重新准备' : '准备本地翻译';
}
async function detectTranslationCapability() {
  if (!('Translator' in window) || typeof window.Translator?.availability !== 'function') {
    state.translatorStatus = 'unsupported'; renderTranslationEngineStatus(); return 'unsupported';
  }
  state.translatorStatus = 'checking'; renderTranslationEngineStatus();
  try {
    const availability = await window.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' });
    state.translatorStatus = translationAvailabilityStatus(availability);
  } catch (error) {
    state.translatorStatus = 'error'; state.translatorError = error.message;
  }
  renderTranslationEngineStatus(); return state.translatorStatus;
}
async function prepareTranslator() {
  if (!translationSettings.enabled) throw new Error('阅读翻译已关闭');
  if (state.translator) return state.translator;
  if (!('Translator' in window) || typeof window.Translator?.create !== 'function') {
    state.translatorStatus = 'unsupported'; renderTranslationEngineStatus(); throw new Error('当前浏览器不支持本地翻译');
  }
  state.translatorStatus = 'downloading'; renderTranslationEngineStatus(0);
  try {
    state.translator = await window.Translator.create({
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => renderTranslationEngineStatus(event.loaded));
      }
    });
    state.translatorStatus = 'available'; state.translatorError = ''; renderTranslationEngineStatus(); return state.translator;
  } catch (error) {
    state.translatorStatus = 'error'; state.translatorError = error.message; renderTranslationEngineStatus(); throw error;
  }
}
function safeTranslationEndpoint(value = translationSettings.onlineEndpoint) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return '';
    return url.href;
  } catch { return ''; }
}
async function fetchDictionaryJson(path) {
  const response = await fetch(path, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`词典资源 HTTP ${response.status}`);
  return response.json();
}
async function loadDictionaryManifest() {
  if (state.dictionaryManifest) return state.dictionaryManifest;
  state.dictionaryManifest = await fetchDictionaryJson(`./data/dictionary/manifest.json?v=${APP_VERSION}`);
  el('translation-pack-title').textContent = `离线词典 · ${Number(state.dictionaryManifest.entries || 0).toLocaleString('zh-CN')} 词条`;
  el('translation-pack-detail').textContent = `${state.dictionaryManifest.shards?.length || 0} 个分片按需加载，也可以一次下载后离线使用。`;
  return state.dictionaryManifest;
}
async function loadDomainDictionary() {
  if (state.dictionaryDomain) return state.dictionaryDomain;
  state.dictionaryDomain = await fetchDictionaryJson(`./data/dictionary/domain.json?v=${APP_VERSION}`);
  return state.dictionaryDomain;
}
function dictionaryKey(text) {
  return normalizedTranslationText(text).toLocaleLowerCase('en-US').replace(/[“”"()[\]{}.,;:!?]+$/g, '').trim();
}
function dictionaryShardName(text) {
  const first = dictionaryKey(text)[0] || '_';
  return /[a-z]/.test(first) ? first : '_';
}
async function loadDictionaryShard(name) {
  if (state.dictionaryShards.has(name)) return state.dictionaryShards.get(name);
  const manifest = await loadDictionaryManifest();
  if (!manifest.shards?.includes(name)) return {};
  const shard = await fetchDictionaryJson(`./data/dictionary/${name}.json?v=${manifest.version || APP_VERSION}`);
  const entries = shard.entries || {};
  state.dictionaryShards.set(name, entries);
  return entries;
}
function dictionaryFallbackKeys(text) {
  const key = dictionaryKey(text); const keys = [key];
  if (!key.includes(' ')) {
    if (key.endsWith('ies') && key.length > 4) keys.push(`${key.slice(0, -3)}y`);
    if (key.endsWith('ing') && key.length > 5) keys.push(key.slice(0, -3), `${key.slice(0, -3)}e`);
    if (key.endsWith('ed') && key.length > 4) keys.push(key.slice(0, -2), key.slice(0, -1));
    if (key.endsWith('es') && key.length > 4) keys.push(key.slice(0, -2));
    if (key.endsWith('s') && key.length > 3) keys.push(key.slice(0, -1));
  }
  return [...new Set(keys)];
}
function compactEntryToDictionary(entry, source = 'ECDICT') {
  if (!entry) return null;
  const senses = (entry.t || []).map((translation, index) => ({
    pos: index === 0 ? entry.pos || '' : '',
    zh: [translation],
    en: entry.d?.[index] || ''
  }));
  return { word: entry.w, phonetic: entry.p || '', senses, exchange: entry.x || '', source };
}
async function lookupOfflineDictionary(text) {
  const key = dictionaryKey(text);
  if (!key || key.length > 90 || key.split(' ').length > 4) return [];
  const domain = await loadDomainDictionary().catch(() => null);
  const domainEntry = domain?.entries?.[key];
  const shard = await loadDictionaryShard(dictionaryShardName(key)).catch(() => ({}));
  let general = null;
  for (const candidate of dictionaryFallbackKeys(key)) {
    if (shard[candidate]) { general = compactEntryToDictionary(shard[candidate]); break; }
  }
  return [domainEntry ? { ...domainEntry, source: 'PaperScope 专业术语' } : null, general].filter(Boolean);
}
function renderDictionaryEntries(entries) {
  const section = el('translation-dictionary-section'); const container = el('translation-dictionary');
  if (!entries?.length) { section.classList.add('hidden'); container.innerHTML = ''; return; }
  el('translation-dictionary-source').textContent = entries.map(item => item.source).filter(Boolean).join(' · ');
  container.innerHTML = entries.map(entry => {
    const senses = (entry.senses || []).slice(0, 10).map(sense => {
      const chinese = Array.isArray(sense.zh) ? sense.zh.join('；') : sense.zh || '';
      return `<li>${sense.pos ? `<b>${escapeHtml(sense.pos)}</b> ` : ''}${escapeHtml(chinese)}${sense.en ? `<small> · ${escapeHtml(sense.en)}</small>` : ''}</li>`;
    }).join('');
    return `<article class="dictionary-entry"><strong>${escapeHtml(entry.word || '')}</strong>${entry.phonetic ? `<small>/${escapeHtml(entry.phonetic)}/</small>` : ''}<ol class="dictionary-senses">${senses}</ol>${entry.exchange ? `<small>词形：${escapeHtml(entry.exchange)}</small>` : ''}</article>`;
  }).join('');
  section.classList.remove('hidden');
}
function translationContext(root, text) {
  const full = normalizedTranslationText(root?.textContent || text); const selected = normalizedTranslationText(text);
  const index = full.toLocaleLowerCase('en-US').indexOf(selected.toLocaleLowerCase('en-US'));
  if (index < 0) return full.slice(0, 240);
  return full.slice(Math.max(0, index - 90), Math.min(full.length, index + selected.length + 110));
}
function translationPaperId(root) {
  const paperRow = root?.closest('[data-paper-id]'); if (paperRow) return paperRow.dataset.paperId;
  const libraryRowNode = root?.closest('[data-library-id]'); if (libraryRowNode) return libraryRowNode.dataset.libraryId;
  const vocabularyRow = root?.closest('[data-vocabulary-id]'); if (vocabularyRow) return library.vocabulary?.[vocabularyRow.dataset.vocabularyId]?.paperId || null;
  if (root?.closest('#pdf-modal')) return state.pdfPaperId;
  return root?.closest('#paper-drawer') ? state.selectedPaperId : null;
}
function syncTranslationPinButton() {
  const pinned = translationSettings.positionMode === 'pinned';
  const popover = el('translation-popover'); const button = el('translation-pin');
  popover?.classList.toggle('pinned', pinned);
  button?.classList.toggle('active', pinned);
  button?.setAttribute('aria-pressed', String(pinned));
  if (button) {
    button.title = pinned ? '取消固定，恢复跟随选区' : '固定当前位置';
    button.textContent = pinned ? '●' : '⌖';
  }
}
function syncTranslationDockButton() {
  const docked = Boolean(translationSettings.docked);
  const popover = el('translation-popover'); const button = el('translation-dock');
  popover?.classList.toggle('docked', docked);
  button?.classList.toggle('active', docked);
  button?.setAttribute('aria-pressed', String(docked));
  if (button) {
    button.title = docked ? '从右侧边栏独立出来' : '停靠到右侧边栏';
    button.textContent = docked ? '↗' : '▥';
  }
}
function setTranslationDocked(docked, { quiet = false } = {}) {
  translationSettings.docked = Boolean(docked);
  if (docked) translationSettings.positionMode = 'pinned';
  saveTranslationSettings();
  const popover = el('translation-popover');
  if (docked) {
    popover.style.left = ''; popover.style.top = '';
  } else if (state.translationPayload?.rect) {
    translationSettings.positionMode = 'follow'; translationSettings.position = null;
    saveTranslationSettings(); positionTranslationPopover(state.translationPayload.rect);
  }
  if (!quiet) toast(docked ? '翻译框已停靠到右侧空白区' : '翻译框已恢复为独立浮窗');
}
function toggleTranslationDock() {
  if (matchMedia('(max-width:720px)').matches) return toast('手机端使用底部翻译卡片，无需停靠');
  setTranslationDocked(!translationSettings.docked);
}
function clampedTranslationPosition(left, top) {
  const popover = el('translation-popover'); const width = popover.offsetWidth || 430; const height = popover.offsetHeight || 360;
  return {
    left: Math.max(12, Math.min(window.innerWidth - width - 12, Number(left) || 12)),
    top: Math.max(12, Math.min(window.innerHeight - height - 12, Number(top) || 12))
  };
}
function saveTranslationPosition(left, top) {
  const position = clampedTranslationPosition(left, top);
  translationSettings.position = position; translationSettings.positionMode = 'pinned';
  saveTranslationSettings();
  return position;
}
function positionTranslationPopover(rect) {
  const popover = el('translation-popover'); popover.classList.add('open');
  syncTranslationDockButton();
  if (translationSettings.docked && !matchMedia('(max-width:720px)').matches) {
    popover.style.left = ''; popover.style.top = ''; return;
  }
  if (matchMedia('(max-width:720px)').matches) {
    popover.style.left = ''; popover.style.top = ''; return;
  }
  if (translationSettings.positionMode === 'pinned' && translationSettings.position) {
    const position = clampedTranslationPosition(translationSettings.position.left, translationSettings.position.top);
    popover.style.left = `${position.left}px`; popover.style.top = `${position.top}px`; return;
  }
  const gap = 9; const width = popover.offsetWidth; const height = popover.offsetHeight;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + Math.min(rect.width / 2, 90) - width / 2));
  const below = rect.bottom + gap; const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - gap);
  popover.style.left = `${left}px`; popover.style.top = `${top}px`;
}
function resetTranslationPosition() {
  translationSettings.position = null; translationSettings.positionMode = 'follow'; translationSettings.docked = false; saveTranslationSettings();
  el('translation-popover').style.left = ''; el('translation-popover').style.top = '';
  toast('翻译框已恢复为跟随选区');
}
function toggleTranslationPin() {
  if (matchMedia('(max-width:720px)').matches) return toast('手机端使用底部翻译卡片，无需固定位置');
  if (translationSettings.positionMode === 'pinned') {
    translationSettings.positionMode = 'follow'; saveTranslationSettings();
    if (state.translationPayload?.rect) positionTranslationPopover(state.translationPayload.rect);
    toast('翻译框将跟随所选文字');
  } else {
    const box = el('translation-popover').getBoundingClientRect();
    saveTranslationPosition(box.left, box.top); toast('已固定翻译框位置');
  }
}
function setupTranslationDragging() {
  const handle = el('translation-drag-handle'); const popover = el('translation-popover');
  handle.addEventListener('pointerdown', event => {
    if (matchMedia('(max-width:720px)').matches || event.target.closest('button')) return;
    if (translationSettings.docked) setTranslationDocked(false, { quiet: true });
    const box = popover.getBoundingClientRect();
    state.translationDrag = { pointerId: event.pointerId, offsetX: event.clientX - box.left, offsetY: event.clientY - box.top };
    handle.setPointerCapture?.(event.pointerId); handle.classList.add('dragging'); event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!state.translationDrag || state.translationDrag.pointerId !== event.pointerId) return;
    const position = clampedTranslationPosition(event.clientX - state.translationDrag.offsetX, event.clientY - state.translationDrag.offsetY);
    popover.style.left = `${position.left}px`; popover.style.top = `${position.top}px`;
  });
  const finish = event => {
    if (!state.translationDrag || (event.pointerId !== undefined && state.translationDrag.pointerId !== event.pointerId)) return;
    const box = popover.getBoundingClientRect(); state.translationDrag = null; handle.classList.remove('dragging');
    if (window.innerWidth - box.right < 58) setTranslationDocked(true);
    else { saveTranslationPosition(box.left, box.top); toast('翻译框位置已固定；拖到右侧边缘可停靠'); }
  };
  handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
}
function closeTranslationPopover() {
  const popover = el('translation-popover'); if (!popover) return;
  popover.classList.remove('open'); state.translationRequestId += 1; state.translationPayload = null;
}
function setTranslationActions(enabled) {
  el('translation-prepare-inline').classList.add('hidden');
  el('translation-copy').textContent = enabled ? '复制译文' : '复制原文';
  el('translation-copy').disabled = !enabled && !state.translationPayload?.source;
  el('translation-vocabulary').disabled = !enabled;
  el('translation-note').disabled = !enabled || !state.translationPayload?.paperId;
  el('translation-online').disabled = translationSettings.mode === 'offline' || !state.translationPayload?.source;
  el('translation-speak').disabled = !('speechSynthesis' in window) || !(state.translationPayload?.translation || state.translationPayload?.source);
}
function resetTranslationResultUi() {
  el('translation-result').textContent = '';
  el('translation-state').textContent = '正在查询离线词典…';
  el('translation-dictionary-section').classList.add('hidden');
  el('translation-alternatives-section').classList.add('hidden');
  el('translation-dictionary').innerHTML = ''; el('translation-alternatives').innerHTML = '';
}
function applyTranslationResult(result, sourceLabel) {
  const payload = state.translationPayload; if (!payload || !result?.translation) return;
  payload.translation = normalizedTranslationText(result.translation);
  payload.provider = result.provider || sourceLabel || '本地翻译';
  payload.alternatives = (result.alternatives || []).filter(Boolean).filter(item => item !== payload.translation).slice(0, 5);
  el('translation-result').textContent = payload.translation;
  const popover = el('translation-popover');
  popover.classList.toggle('word-result', payload.sourceType === 'word' || payload.source.split(/\s+/).length <= 3);
  popover.classList.toggle('paragraph-result', payload.sourceType !== 'word' && payload.source.split(/\s+/).length > 3);
  el('translation-state').textContent = sourceLabel || payload.provider;
  el('translation-provider').textContent = payload.provider;
  if (payload.alternatives.length) {
    el('translation-alternatives').innerHTML = payload.alternatives.map(value => `<button data-translation-alternative="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('');
    el('translation-alternatives-section').classList.remove('hidden');
  }
  setTranslationActions(true);
}
async function requestOnlineTranslation(payload = state.translationPayload) {
  const endpoint = safeTranslationEndpoint();
  if (endpoint) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: payload.source, source: 'en', target: 'zh', context: payload.context, alternatives: 3 }),
      signal: AbortSignal.timeout(20_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `在线服务 HTTP ${response.status}`);
    if (!result.translation) throw new Error('在线服务没有返回译文');
    return result;
  }
  const chunks = splitUtf8TranslationChunks(payload.source, 430);
  const translated = [];
  const alternatives = [];
  for (const chunk of chunks) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', chunk); url.searchParams.set('langpair', 'en|zh-CN'); url.searchParams.set('mt', '1');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const result = await response.json().catch(() => ({}));
    const value = normalizedTranslationText(result?.responseData?.translatedText);
    if (!response.ok || !value) throw new Error(result?.responseDetails || `公共精译服务 HTTP ${response.status}`);
    translated.push(value);
    alternatives.push(...(result.matches || []).map(item => normalizedTranslationText(item.translation)).filter(Boolean));
  }
  return { translation: translated.join(' '), alternatives: [...new Set(alternatives)].slice(0, 3), provider: 'MyMemory 公共翻译记忆' };
}
function splitUtf8TranslationChunks(text, maxBytes = 430) {
  const encoder = new TextEncoder(); const chunks = []; let current = '';
  const segments = String(text || '').split(/(?<=[.!?。！？;；])\s+|\n+/);
  for (const segment of segments) {
    for (const character of [...segment]) {
      const next = current + character;
      if (current && encoder.encode(next).length > maxBytes) { chunks.push(current.trim()); current = character; }
      else current = next;
    }
    if (current) current += ' ';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
async function translateCurrentOnline() {
  const payload = state.translationPayload; if (!payload) return;
  const requestId = ++state.translationRequestId;
  el('translation-state').textContent = '正在进行在线精译…'; el('translation-online').disabled = true;
  try {
    const result = await requestOnlineTranslation(payload);
    if (requestId !== state.translationRequestId) return;
    applyTranslationResult(result, `在线精译 · ${result.provider || '已配置代理'}`);
    storeTranslation(payload.source, payload.translation, { provider: payload.provider, alternatives: payload.alternatives || [] });
  } catch (error) {
    if (requestId === state.translationRequestId) el('translation-state').textContent = `在线精译失败：${error.message}`;
  } finally {
    if (requestId === state.translationRequestId) setTranslationActions(Boolean(state.translationPayload?.translation));
  }
}
async function showTranslation(source, rect, root, sourceType) {
  source = normalizedTranslationText(source);
  if (!translationSettings.enabled || !/[A-Za-z]/.test(source)) return;
  if (source.length > 2000) return toast('单次翻译最多 2,000 个字符');
  const requestId = ++state.translationRequestId;
  const context = translationContext(root, source);
  state.translationPayload = {
    source, translation: '', context, paperId: translationPaperId(root), sourceType, rect, root,
    dictionaryEntries: [], alternatives: [], provider: ''
  };
  el('translation-original').textContent = source;
  el('translation-popover').classList.toggle('word-result', sourceType === 'word' || source.split(/\s+/).length <= 3);
  el('translation-popover').classList.toggle('paragraph-result', sourceType !== 'word' && source.split(/\s+/).length > 3);
  resetTranslationResultUi();
  setTranslationActions(false); positionTranslationPopover(rect);
  const cached = cachedTranslation(source);
  if (cached) {
    applyTranslationResult(cached, `本地缓存 · ${cached.provider || '历史译文'}`);
  }
  const dictionaryEntries = await lookupOfflineDictionary(source).catch(() => []);
  if (requestId !== state.translationRequestId) return;
  state.translationPayload.dictionaryEntries = dictionaryEntries; renderDictionaryEntries(dictionaryEntries);
  if (!state.translationPayload.translation && dictionaryEntries.length) {
    const likely = dictionaryEntries[0]?.senses?.[0]?.zh;
    const translation = Array.isArray(likely) ? likely[0] : likely;
    if (translation) applyTranslationResult({ translation, provider: dictionaryEntries[0].source }, '离线词典 · 多义项见下方');
  }
  if (translationSettings.mode === 'online') {
    await translateCurrentOnline(); positionTranslationPopover(rect); return;
  }
  if (sourceType === 'word' && dictionaryEntries[0]?.source === 'PaperScope 专业术语') {
    el('translation-state').textContent = '专业术语表 · 优先采用领域标准译法';
    setTranslationActions(true); positionTranslationPopover(rect); return;
  }
  if (sourceType === 'selection' && state.translatorStatus === 'downloadable' && !state.translator) {
    el('translation-state').textContent = state.translationPayload.translation ? '离线词典结果 · 下载语言包可获得上下文译文' : '首次使用段落翻译需要下载浏览器语言包。';
    el('translation-prepare-inline').classList.remove('hidden'); setTranslationActions(Boolean(state.translationPayload.translation)); return;
  }
  try {
    const translator = await prepareTranslator();
    if (requestId !== state.translationRequestId || !translationSettings.enabled) return;
    el('translation-state').textContent = '正在进行本地上下文翻译…';
    const result = normalizedTranslationText(await translator.translate(source));
    if (requestId !== state.translationRequestId || !translationSettings.enabled) return;
    if (!result) throw new Error('本地翻译未返回内容');
    applyTranslationResult({ translation: result, provider: '浏览器本地模型' }, '本地上下文翻译 · 未上传文本');
    storeTranslation(source, result, { provider: '浏览器本地模型' }); positionTranslationPopover(rect);
  } catch (error) {
    if (requestId !== state.translationRequestId) return;
    const unavailable = ['unsupported', 'unavailable'].includes(state.translatorStatus);
    if (!state.translationPayload.translation) {
      el('translation-state').textContent = unavailable ? '未找到词典条目；当前浏览器不支持本地翻译，可使用在线精译。' : `本地翻译失败：${error.message || '请稍后重试'}`;
    } else {
      el('translation-state').textContent = unavailable ? '已显示离线词典结果；当前浏览器不支持本地上下文翻译。' : '已显示离线词典结果；本地模型暂不可用。';
    }
    setTranslationActions(Boolean(state.translationPayload.translation));
    if (!unavailable) el('translation-prepare-inline').classList.remove('hidden');
    positionTranslationPopover(rect);
  }
}
function translatableSelection() {
  const selection = window.getSelection(); if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0); const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const root = start?.closest?.('[data-translatable]');
  if (!root || !root.contains(range.endContainer) || root.closest('input,textarea,select,[contenteditable="true"]')) return null;
  let text = selection.toString(); let rect = range.getBoundingClientRect();
  if (root.classList.contains('textLayer')) {
    const visual = pdfVisualSelectionForRange(range, root);
    if (visual?.error) {
      // PDF.js may expose text nodes in storage order rather than visual
      // order. Do not let a native range paint across the column gutter.
      selection.removeAllRanges();
      return null;
    }
    text = visual.text; rect = pdfSelectionClientRect(visual, root);
  }
  text = normalizedTranslationText(text);
  if (!/[A-Za-z]/.test(text)) return null;
  return { text, root, rect };
}
function wordAtPoint(x, y, root) {
  let node; let offset;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y); node = position?.offsetNode; offset = position?.offset;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y); node = range?.startContainer; offset = range?.startOffset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  const text = node.data; const isWord = char => /[A-Za-z0-9'-]/.test(char || '');
  if (!isWord(text[offset]) && isWord(text[offset - 1])) offset -= 1;
  if (!isWord(text[offset])) return null;
  let start = offset; let end = offset + 1;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end < text.length && isWord(text[end])) end += 1;
  while (start < end && /['-]/.test(text[start])) start += 1;
  while (end > start && /['-]/.test(text[end - 1])) end -= 1;
  let word = text.slice(start, end); if (!/[A-Za-z]/.test(word)) return null;
  const domainEntries = state.dictionaryDomain?.entries || {};
  const tokens = [...text.matchAll(/[A-Za-z][A-Za-z0-9'-]*/g)].map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  const clickedIndex = tokens.findIndex(token => token.start <= start && token.end >= end);
  if (clickedIndex >= 0) {
    let phraseMatch = null;
    for (let size = 4; size >= 2 && !phraseMatch; size -= 1) {
      for (let from = Math.max(0, clickedIndex - size + 1); from <= Math.min(clickedIndex, tokens.length - size); from += 1) {
        const group = tokens.slice(from, from + size); const candidate = dictionaryKey(group.map(token => token.text).join(' '));
        if (domainEntries[candidate]) phraseMatch = { text: text.slice(group[0].start, group[group.length - 1].end), start: group[0].start, end: group[group.length - 1].end };
      }
    }
    if (phraseMatch) { word = phraseMatch.text; start = phraseMatch.start; end = phraseMatch.end; }
  }
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  return { text: word, rect: range.getBoundingClientRect() };
}
function vocabularyId(paperId, source) {
  let hash = 2166136261;
  for (const char of `${paperId || 'general'}:${normalizedTranslationText(source).toLowerCase()}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `term-${(hash >>> 0).toString(36)}`;
}
function addCurrentTranslationToVocabulary() {
  const payload = state.translationPayload; if (!payload?.translation) return;
  const id = vocabularyId(payload.paperId, payload.source); const previous = library.vocabulary[id];
  library.vocabulary[id] = {
    id, source: payload.source, translation: payload.translation, context: payload.context,
    meanings: payload.dictionaryEntries || previous?.meanings || [], alternatives: payload.alternatives || previous?.alternatives || [],
    provider: payload.provider || previous?.provider || '离线词典', lookups: Number(previous?.lookups || 0) + 1, mastery: Number(previous?.mastery || 0),
    paperId: payload.paperId || null, paperTitle: getPaper(payload.paperId)?.title || previous?.paperTitle || null,
    createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  saveLibrary(); toast(previous ? '生词本条目已更新' : '已加入生词本');
}
function addCurrentTranslationToNote() {
  const payload = state.translationPayload; const paper = getPaper(payload?.paperId);
  if (!payload?.translation || !paper) return toast('这段文字没有关联论文');
  const record = ensureRecord(paper); const block = `【翻译】\n原文：${payload.source}\n译文：${payload.translation}`;
  if (!record.note.includes(block)) record.note = `${record.note.trim()}${record.note.trim() ? '\n\n' : ''}${block}`;
  saveLibrary(); if (payload.paperId === state.selectedPaperId) el('paper-note').value = record.note; toast('译文已加入论文笔记');
}
function speakCurrentTranslation() {
  const payload = state.translationPayload; const text = payload?.translation || payload?.source;
  if (!text || !('speechSynthesis' in window)) return toast('当前浏览器不支持朗读');
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel(); el('translation-speak').textContent = '朗读'; el('translation-speak').classList.remove('active'); return;
  }
  speechSynthesis.cancel();
  if (speechSynthesis.paused) speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(text);
  const chinese = Boolean(payload.translation);
  utterance.lang = chinese ? 'zh-CN' : 'en-US';
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(voice => voice.lang.toLowerCase().startsWith(chinese ? 'zh' : 'en')) || null;
  utterance.rate = chinese ? .92 : .95;
  const button = el('translation-speak');
  utterance.onstart = () => { button.textContent = '停止'; button.classList.add('active'); };
  utterance.onend = utterance.onerror = () => { button.textContent = '朗读'; button.classList.remove('active'); };
  speechSynthesis.speak(utterance);
}
async function downloadCompleteDictionary() {
  const button = el('translation-download-dictionary'); const bar = el('translation-pack-progress');
  if (state.dictionaryDownloadController) return;
  const controller = new AbortController(); state.dictionaryDownloadController = controller; button.disabled = true;
  try {
    const manifest = await loadDictionaryManifest(); const shards = manifest.shards || [];
    const cache = await caches.open(`paperscope-dictionary-${manifest.version || APP_VERSION}`);
    for (let index = 0; index < shards.length; index += 1) {
      const url = new URL(`./data/dictionary/${shards[index]}.json?v=${manifest.version || APP_VERSION}`, location.href).href;
      const response = await fetch(url, { signal: controller.signal, cache: 'reload' });
      if (!response.ok) throw new Error(`${shards[index]} 分片下载失败`);
      await cache.put(url, response.clone());
      bar.style.width = `${Math.round(((index + 1) / shards.length) * 100)}%`;
      el('translation-pack-detail').textContent = `正在下载 ${index + 1}/${shards.length} 个词典分片…`;
    }
    el('translation-pack-detail').textContent = '完整英汉词典已缓存在当前浏览器，可离线查询。';
    toast('完整离线词典下载完成');
  } catch (error) {
    if (error.name !== 'AbortError') toast(`词典下载失败：${error.message}`);
  } finally {
    state.dictionaryDownloadController = null; button.disabled = false;
  }
}
async function testTranslationEndpoint() {
  const endpoint = safeTranslationEndpoint(el('translation-endpoint').value);
  translationSettings.onlineEndpoint = endpoint; saveTranslationSettings();
  const button = el('translation-test-endpoint'); button.disabled = true;
  try {
    const result = await requestOnlineTranslation({ source: 'memory hierarchy', context: 'The memory hierarchy reduces average data access latency.' });
    toast(`${endpoint ? '在线代理' : '公共精译服务'}可用：${result.provider || result.translation}`);
  } catch (error) {
    toast(`在线代理不可用：${error.message}`);
  } finally {
    button.disabled = false;
  }
}
function splitTranslationChunks(text, limit = 1800) {
  const sentences = normalizedTranslationText(text).split(/(?<=[.!?])\s+/); const chunks = []; let current = '';
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (`${current} ${sentence}`.trim().length <= limit) current = `${current} ${sentence}`.trim();
    else {
      if (current) chunks.push(current);
      if (sentence.length <= limit) current = sentence;
      else {
        for (let index = 0; index < sentence.length; index += limit) chunks.push(sentence.slice(index, index + limit));
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
async function translatePaperAbstract() {
  const paper = getPaper(state.selectedPaperId); if (!paper?.abstract) return toast('当前论文没有可翻译摘要');
  const button = el('detail-bilingual'); button.disabled = true; button.textContent = '正在翻译摘要…';
  el('detail-bilingual-panel').classList.remove('hidden'); el('detail-bilingual-text').textContent = '正在生成中文摘要，请保持页面打开。';
  try {
    const chunks = splitTranslationChunks(paper.abstract); const output = []; let provider = '';
    if (translationSettings.mode === 'online') {
      for (const chunk of chunks) {
        const result = await requestOnlineTranslation({ source: chunk, context: paper.title });
        output.push(result.translation); provider = result.provider || '在线精译';
      }
    } else {
      const translator = await prepareTranslator();
      for (const chunk of chunks) output.push(await translator.translate(chunk));
      provider = '浏览器本地模型';
    }
    const record = ensureRecord(paper);
    record.abstractTranslation = { text: output.join('\n\n'), provider, updatedAt: new Date().toISOString() };
    saveLibrary(); el('detail-bilingual-text').textContent = record.abstractTranslation.text;
    el('detail-bilingual-source').textContent = `中文摘要 · ${provider}`; toast('中英对照摘要已生成');
  } catch (error) {
    el('detail-bilingual-text').textContent = `生成失败：${error.message}`;
    if (translationSettings.mode !== 'online' && safeTranslationEndpoint()) toast('本地模型不可用；可在翻译设置中切换为“优先在线精译”');
  } finally {
    button.disabled = false; button.textContent = getRecord(state.selectedPaperId)?.abstractTranslation?.text ? '刷新中文摘要' : '生成中英对照';
  }
}

document.addEventListener('click', event => {
  const selectedText = window.getSelection()?.toString().trim();
  if (selectedText && event.target.closest('[data-open-paper],[data-action="open"],a.news-card')) return;
  const routeButton = event.target.closest('[data-route]'); if (routeButton) { closeMobileMore(); return navigate(routeButton.dataset.route); }
  const open = event.target.closest('[data-open-paper]'); if (open) return openPaperRoute(open.dataset.openPaper);
  const compare = event.target.closest('[data-compare]'); if (compare) return toggleCompare(compare.dataset.compare);
  const venueSave = event.target.closest('[data-venue-save]'); if (venueSave) return toggleVenueSave(venueSave.dataset.venueSave);
  const curatedVenue = event.target.closest('[data-curated-venue]'); if (curatedVenue) return navigate('curated', { venue: curatedVenue.dataset.curatedVenue });
  const close = event.target.closest('[data-close-modal]'); if (close) return closeModal(close.dataset.closeModal);
});
document.addEventListener('click', event => {
  if (!event.target.closest('.pdf-search-popover')) closePdfSearchResults();
  if (!event.target.closest('.pdf-export-menu')) document.querySelector('.pdf-export-menu')?.removeAttribute('open');
});
document.addEventListener('click', event => {
  if (event.target.closest('#translation-popover')) return;
  const root = event.target.closest('[data-translatable]');
  if (state.pdfSuppressWordClick && root?.classList.contains('textLayer')) return;
  if (root?.closest('#pdf-modal') && state.pdfAnnotationMode) return;
  if (!translationSettings.enabled || !translationSettings.wordClick || !root || event.detail > 1 || event.target.closest('a,button,input,textarea,select,label,[contenteditable="true"]')) {
    if (!root && el('translation-popover').classList.contains('open')) closeTranslationPopover();
    return;
  }
  if (translationSettings.wordClickMode !== 'direct' && !event.ctrlKey && !event.metaKey) return;
  const selection = window.getSelection(); if (selection && !selection.isCollapsed && normalizedTranslationText(selection.toString())) return;
  const word = wordAtPoint(event.clientX, event.clientY, root); if (word) showTranslation(word.text, word.rect, root, 'word');
});
document.addEventListener('selectionchange', () => {
  rememberPdfWorkspaceRange();
  clearTimeout(state.translationSelectionTimer);
  if (!translationSettings.enabled || !translationSettings.selection) return;
  const selection = window.getSelection();
  const anchorElement = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection?.anchorNode;
  if (state.pdfAnnotationMode && anchorElement?.closest?.('#pdf-modal')) {
    state.lastSelectionKey = ''; closeTranslationPopover(); return;
  }
  state.translationSelectionTimer = setTimeout(() => {
    const selected = translatableSelection();
    if (!selected) { state.lastSelectionKey = ''; return; }
    if (selected.text.length > 2000) return toast('单次翻译最多 2,000 个字符');
    const key = `${selected.text}:${Math.round(selected.rect.left)}:${Math.round(selected.rect.top)}`;
    if (key === state.lastSelectionKey) return;
    state.lastSelectionKey = key; showTranslation(selected.text, selected.rect, selected.root, 'selection');
  }, 260);
});
el('paper-list').addEventListener('click', event => {
  const row = event.target.closest('[data-paper-id]'); if (!row) return; const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'open') openPaperRoute(row.dataset.paperId); else if (action === 'save') toggleRecordField(row.dataset.paperId, 'saved'); else if (action === 'queue') toggleRecordField(row.dataset.paperId, 'queue'); else if (action === 'read') toggleRecordField(row.dataset.paperId, 'read'); else if (action === 'compare') toggleCompare(row.dataset.paperId);
});
['paper-topic', 'paper-venue', 'paper-source', 'paper-status', 'paper-sort', 'paper-page-size'].forEach(id => el(id).addEventListener('change', () => {
  const route = parseRoute(); navigate(route.name, { ...route.query, topic: el('paper-topic').value, venue: el('paper-venue').value, source: el('paper-source').value, status: el('paper-status').value, sort: el('paper-sort').value, size: el('paper-page-size').value, page: 1 });
}));
el('papers-reset').addEventListener('click', () => { const route = parseRoute(); localStorage.removeItem(`${FILTER_KEY_PREFIX}${route.name}`); localStorage.removeItem(`paperscope-filters-${route.name}`); navigate(route.name); });
el('global-search').addEventListener('input', event => {
  const route = parseRoute(); clearTimeout(state.searchTimer); if (!currentSearchableRoute(route)) return;
  state.searchTimer = setTimeout(() => setQuery({ q: event.target.value.trim(), page: 1 }, true), 220);
});
el('global-search').addEventListener('keydown', event => { if (event.key === 'Enter' && parseRoute().name === 'home' && event.currentTarget.value.trim()) openCommand(event.currentTarget.value.trim()); });
el('refresh-data').addEventListener('click', () => loadData(true));
['home-daily-open', 'curated-daily-open'].forEach(id => el(id).addEventListener('click', openDaily));
['home-daily-queue', 'curated-daily-queue'].forEach(id => el(id).addEventListener('click', queueDaily));
['home-daily-done', 'curated-daily-done'].forEach(id => el(id).addEventListener('click', completeDaily));
['curated-area', 'curated-venue'].forEach(id => el(id).addEventListener('change', () => navigate('curated', { ...parseRoute().query, area: el('curated-area').value, venue: el('curated-venue').value })));

el('library-tabs').addEventListener('click', event => { const button = event.target.closest('[data-tab]'); if (button) navigate(`library/${button.dataset.tab}`); });
el('library-tab-select').addEventListener('change', event => navigate(`library/${event.target.value}`));
el('library-progress-help').addEventListener('click', () => toast('完成度由论文详情中的进度选项手动设置；未设置时仅显示 PDF 当前页位置。'));
el('library-list').addEventListener('click', event => {
  const vocabularyRow = event.target.closest('[data-vocabulary-id]');
  if (vocabularyRow) {
    const id = vocabularyRow.dataset.vocabularyId; const item = library.vocabulary?.[id]; const action = event.target.closest('[data-vocabulary-action]')?.dataset.vocabularyAction;
    if (action === 'open' && item?.paperId) openPaperRoute(item.paperId);
    else if (action === 'copy' && item) copyText(`${item.source}\n${item.translation}`, '词条已复制');
    else if (action === 'speak' && item && 'speechSynthesis' in window) {
      speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(item.source); utterance.lang = 'en-US'; speechSynthesis.speak(utterance);
    }
    else if (action === 'mastery' && item) {
      item.mastery = (Number(item.mastery || 0) + 1) % 4; item.updatedAt = new Date().toISOString(); saveLibrary(); renderRoute(); toast(`掌握程度 ${item.mastery}/3`);
    }
    else if (action === 'remove') { delete library.vocabulary[id]; saveLibrary(); renderRoute(); toast('词条已删除'); }
    return;
  }
  const row = event.target.closest('[data-library-id]'); if (!row) return; const id = row.dataset.libraryId; const action = event.target.closest('[data-library-action]')?.dataset.libraryAction;
  if (action === 'open') openPaperRoute(id);
  else if (action === 'pdf') openPdfReader(id);
  else if (action === 'save') toggleRecordField(id, 'saved');
  else if (action === 'compare') toggleCompare(id);
  else if (action === 'read') toggleRecordField(id, 'read');
  else if (action === 'queue') toggleRecordField(id, 'queue');
  else if (action === 'archive') { state.batch = new Set([id]); runBatchAction('archive', '已归档'); }
  else if (action === 'trash') moveRecordsToTrash([id]);
  else if (action === 'restore') restoreRecords([id]);
  else if (action === 'permanent-delete') permanentlyDeleteRecords([id]);
  else if (action === 'category') {
    state.batch = new Set([id]); updateBatchCount(); el('batch-collection-select').focus(); toast('请选择分类后点击“加入”');
  }
});
el('library-list').addEventListener('change', event => {
  if (!event.target.matches('[data-library-select]')) return;
  const row = event.target.closest('[data-library-id]'); const id = row.dataset.libraryId;
  event.target.checked ? state.batch.add(id) : state.batch.delete(id);
  row.classList.toggle('selected', event.target.checked);
  updateBatchCount();
});
el('library-select-all').addEventListener('change', event => { document.querySelectorAll('[data-library-select]').forEach(input => { input.checked = event.target.checked; const id = input.closest('[data-library-id]').dataset.libraryId; event.target.checked ? state.batch.add(id) : state.batch.delete(id); }); updateBatchCount(); });
el('batch-clear').addEventListener('click', () => { state.batch.clear(); document.querySelectorAll('[data-library-select]').forEach(input => { input.checked = false; }); updateBatchCount(); });
el('batch-read').addEventListener('click', () => runBatchAction('read', '已标记为已读'));
el('batch-unread').addEventListener('click', () => runBatchAction('unread', '已标记为未读'));
el('batch-queue').addEventListener('click', () => runBatchAction('queue', '已加入阅读队列'));
el('batch-unqueue').addEventListener('click', () => runBatchAction('unqueue', '已移出阅读队列'));
el('batch-archive').addEventListener('click', () => runBatchAction('archive', '已归档'));
el('batch-trash').addEventListener('click', () => moveRecordsToTrash());
el('batch-trash-archived').addEventListener('click', () => moveRecordsToTrash());
el('batch-restore').addEventListener('click', () => restoreRecords());
el('batch-delete-permanent').addEventListener('click', () => permanentlyDeleteRecords());
el('batch-collection-add').addEventListener('click', () => {
  const collectionId = el('batch-collection-select').value;
  if (!library.collections[collectionId]) return toast('请先选择分类');
  runBatchAction('collection-add', `已加入“${library.collections[collectionId].name}”`, { collectionId });
});
el('batch-collection-remove').addEventListener('click', () => {
  const collectionId = el('batch-collection-select').value;
  if (!library.collections[collectionId]) return toast('请先选择分类');
  runBatchAction('collection-remove', `已移出“${library.collections[collectionId].name}”`, { collectionId });
});
el('batch-citations').addEventListener('click', () => { if (!state.batch.size) return toast('请先选择论文'); downloadText('paperscope-citations.bib', [...state.batch].map(id => bibtexFor(getPaper(id))).join('\n\n')); });
el('merge-duplicates').addEventListener('click', mergeSelectedDuplicates);
el('check-publications').addEventListener('click', async () => { const ids = state.batch.size ? [...state.batch] : Object.entries(library.records).filter(([, record]) => record.savedAt).map(([id]) => id).slice(0, 30); if (!ids.length) return toast('请先收藏或选择论文'); const button = el('check-publications'); button.disabled = true; for (let index = 0; index < ids.length; index += 1) { button.textContent = `${index + 1}/${ids.length}`; await checkPublication(ids[index], true); if (index < ids.length - 1) await new Promise(resolve => setTimeout(resolve, 280)); } button.disabled = false; button.textContent = '检查中刊状态'; renderRoute(); toast('发表状态检查完成'); });
el('collection-filter').addEventListener('change', event => { const route = parseRoute(); navigate('library/collections', { ...route.query, collection: event.target.value, page: 1 }); });
el('create-collection').addEventListener('click', () => {
  const name = el('new-collection-name').value.trim(); const parentId = el('collection-parent').value || null;
  if (!name) return toast('请输入分类名称');
  if (Object.values(library.collections).some(collection => collection.parentId === parentId && collection.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return toast('同级分类不能重名');
  const id = `${slug(name)}-${Date.now().toString(36)}`;
  library.collections[id] = {
    name, parentId, color: el('collection-color')?.value || '#116347', icon: 'folder',
    description: el('collection-description')?.value.trim() || '', order: Object.keys(library.collections).length,
    createdAt: new Date().toISOString()
  };
  library.collections = validateCollectionTree(library.collections);
  saveLibrary(); el('new-collection-name').value = ''; if (el('collection-description')) el('collection-description').value = '';
  renderRoute(); toast('分类已创建');
});
el('rename-collection').addEventListener('click', () => {
  const id = el('collection-filter').value; const current = library.collections[id]; if (!current) return toast('请先选择一个分类');
  const name = prompt('新的分类名称：', current.name); if (!name?.trim()) return;
  const normalized = name.trim().toLocaleLowerCase();
  if (Object.entries(library.collections).some(([otherId, collection]) => otherId !== id && collection.parentId === current.parentId && collection.name.toLocaleLowerCase() === normalized)) return toast('同级分类不能重名');
  current.name = name.trim(); saveLibrary(); renderRoute(); toast('分类已重命名');
});
el('delete-collection').addEventListener('click', () => {
  const id = el('collection-filter').value; const current = library.collections[id]; if (!current) return toast('请先选择一个分类');
  const children = Object.values(library.collections).filter(collection => collection.parentId === id).length;
  if (!confirm(`删除分类“${current.name}”？${children ? `其 ${children} 个子分类将提升到顶层；` : ''}文献本身不会被删除。`)) return;
  for (const record of Object.values(library.records)) record.collections = (record.collections || []).filter(value => value !== id);
  for (const collection of Object.values(library.collections)) if (collection.parentId === id) collection.parentId = null;
  delete library.collections[id]; saveLibrary(); navigate('library/collections'); toast('分类已删除');
});
el('smart-filter').addEventListener('change', event => navigate('library/smart', { smart: event.target.value, page: 1 }));
el('library-pdf-search-button').addEventListener('click', searchLocalPdfLibrary);
el('library-pdf-search').addEventListener('keydown', event => { if (event.key === 'Enter') searchLocalPdfLibrary(); });
el('export-vocabulary').addEventListener('click', exportVocabulary); el('export-library').addEventListener('click', exportLibrary); el('export-full-backup').addEventListener('click', exportCompleteBackup); el('repair-pdf-library').addEventListener('click', () => repairPdfLibrary()); el('import-library').addEventListener('click', () => el('import-file').click()); el('import-file').addEventListener('change', event => { const [file] = event.target.files; if (file) importLibraryFile(file); event.target.value = ''; });
el('import-local-pdf').addEventListener('click', openPdfImportCenter);
el('settings-import-pdf').addEventListener('click', openPdfImportCenter);
el('library-new-collection').addEventListener('click', () => { navigate('library/collections'); setTimeout(() => el('new-collection-name').focus(), 80); });
el('empty-trash').addEventListener('click', () => permanentlyDeleteRecords(Object.entries(library.records).filter(([, record]) => record.trashAt).map(([id]) => id)));
el('settings-profile').addEventListener('click', () => el('profile-modal').classList.add('open'));
el('import-pdf-directory').addEventListener('click', choosePdfDirectory);
el('pdf-import-choose').addEventListener('click', () => el('local-pdf-file').click());
el('pdf-import-folder').addEventListener('click', choosePdfDirectory);
el('local-pdf-file').addEventListener('change', async event => { if (event.target.files.length) await queuePdfFiles(event.target.files); event.target.value = ''; });
el('local-pdf-directory').addEventListener('change', async event => { if (event.target.files.length) await queuePdfFiles(event.target.files); event.target.value = ''; });
el('pdf-import-dropzone').addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.classList.add('dragover'); });
el('pdf-import-dropzone').addEventListener('dragleave', event => event.currentTarget.classList.remove('dragover'));
el('pdf-import-dropzone').addEventListener('drop', async event => { event.preventDefault(); event.currentTarget.classList.remove('dragover'); await queuePdfFiles(event.dataTransfer.files); });
el('pdf-import-dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el('local-pdf-file').click(); } });
el('pdf-import-queue').addEventListener('click', async event => {
  const row = event.target.closest('[data-pdf-import-job]'); const action = event.target.closest('[data-import-action]')?.dataset.importAction;
  if (!row || !action) return;
  const job = state.pdfImportQueue.find(item => item.id === row.dataset.pdfImportJob); if (!job) return;
  if (action === 'cancel') state.pdfImportCancelId = job.id;
  else if (action === 'retry') { job.status = 'queued'; job.progress = 0; job.message = '等待重试'; await savePdfImportJob({ ...job, file: undefined, blob: job.file }).catch(() => {}); processPdfImportQueue(); }
  else if (action === 'remove') { state.pdfImportQueue = state.pdfImportQueue.filter(item => item.id !== job.id); await deletePdfImportJob(job.id).catch(() => {}); }
  renderPdfImportQueue();
});

['news-source', 'news-group', 'news-page-size'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('news', { ...route.query, source: el('news-source').value, group: el('news-group').value, size: el('news-page-size').value, page: 1 }); }));
['venue-area', 'venue-type', 'venue-status', 'venue-sort'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('venues', { ...route.query, area: el('venue-area').value, type: el('venue-type').value, status: el('venue-status').value, sort: el('venue-sort').value, page: 1 }); }));
el('venue-list').addEventListener('click', event => { const row = event.target.closest('[data-venue-name]'); const action = event.target.closest('[data-venue-action]')?.dataset.venueAction; if (!row || !action) return; const venue = state.venues.venues.find(item => item.name === row.dataset.venueName); if (action === 'save') toggleVenueSave(venue.name); else if (action === 'ics') downloadIcs(venue); });

el('drawer-close').addEventListener('click', () => closeDrawer()); el('drawer-overlay').addEventListener('click', () => closeDrawer()); el('detail-save').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'saved')); el('detail-queue').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'queue')); el('detail-read').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'read')); el('detail-compare').addEventListener('click', () => toggleCompare(state.selectedPaperId));
el('detail-publication').addEventListener('click', async () => { el('detail-publication').disabled = true; el('detail-publication-status').textContent = '查询 Crossref…'; await checkPublication(state.selectedPaperId); el('detail-publication').disabled = false; });
el('copy-bibtex').addEventListener('click', () => copyText(bibtexFor(getPaper(state.selectedPaperId)), 'BibTeX 已复制')); el('copy-markdown').addEventListener('click', () => copyText(markdownFor(getPaper(state.selectedPaperId)), 'Markdown 引用已复制'));
el('detail-edit-metadata').addEventListener('click', openMetadataEditor); el('save-metadata').addEventListener('click', saveMetadataEditor);
el('detail-bilingual').addEventListener('click', translatePaperAbstract);
el('detail-pdf-import').addEventListener('click', () => el('detail-pdf-file').click());
el('detail-pdf-file').addEventListener('change', async event => { const [file] = event.target.files; if (file) await queuePdfFiles([file], { targetPaperId: state.selectedPaperId }); event.target.value = ''; });
el('detail-pdf-open').addEventListener('click', () => openPdfReader(state.selectedPaperId));
el('detail-pdf-download').addEventListener('click', () => downloadAttachedPdf(state.selectedPaperId));
el('detail-pdf-remove').addEventListener('click', () => removeAttachedPdf(state.selectedPaperId));
el('detail-lineage').addEventListener('click', () => loadPaperLineage(state.selectedPaperId));
el('pdf-prev').addEventListener('click', () => { if (state.pdfPage > 1) goToPdfPage(state.pdfPage - 1); });
el('pdf-next').addEventListener('click', () => { if (state.pdfDocument && state.pdfPage < state.pdfDocument.numPages) goToPdfPage(state.pdfPage + 1); });
el('pdf-view-mode').addEventListener('change', async event => {
  state.pdfViewMode = event.target.value === 'paged' ? 'paged' : 'continuous';
  localStorage.setItem(PDF_VIEW_MODE_KEY, state.pdfViewMode);
  cancelPdfAnnotationInteraction({ quiet: true }); await renderPdfPage();
  toast(state.pdfViewMode === 'continuous' ? '已切换为上下连续滚动' : '已切换为单页翻页');
});
el('pdf-zoom-range').addEventListener('input', event => schedulePdfZoom(event.target.value));
el('pdf-zoom-range').addEventListener('change', event => applyPdfZoomPercent(event.target.value));
el('pdf-zoom').addEventListener('change', event => applyPdfZoomPercent(event.target.value));
el('pdf-zoom').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  applyPdfZoomPercent(event.currentTarget.value);
  event.currentTarget.blur();
});
el('pdf-search-button').addEventListener('click', () => searchPdfText({ advanceIfSame: true }));
el('pdf-search-clear').addEventListener('click', () => clearPdfSearch());
el('pdf-search-input').addEventListener('input', event => { if (!event.currentTarget.value.trim()) clearPdfSearch({ clearInput: false }); });
el('pdf-search-input').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (normalizedPdfSearchText(event.currentTarget.value.trim()) === state.pdfSearchQuery && state.pdfSearchMatches.length) movePdfSearchMatch(event.shiftKey ? -1 : 1);
  else searchPdfText();
});
el('pdf-search-results').addEventListener('click', event => {
  const action = event.target.closest('[data-pdf-search-action]')?.dataset.pdfSearchAction;
  if (action === 'close') return closePdfSearchResults();
  if (action === 'previous') return movePdfSearchMatch(-1);
  if (action === 'next') return movePdfSearchMatch(1);
  const button = event.target.closest('[data-pdf-search-index]');
  if (button) activatePdfSearchMatch(Number(button.dataset.pdfSearchIndex));
});
el('pdf-inspector-toggle').addEventListener('click', () => setPdfInspector(!state.pdfInspectorOpen));
el('pdf-inspector-close').addEventListener('click', () => setPdfInspector(false));
document.querySelectorAll('[data-pdf-pane-tab]').forEach(button => button.addEventListener('click', () => setPdfInspector(true, button.dataset.pdfPaneTab)));
el('pdf-pane-resizer').addEventListener('pointerdown', event => {
  if (event.button !== 0 || matchMedia('(max-width:720px)').matches) return;
  event.preventDefault();
  state.pdfPaneResize = { pointerId: event.pointerId, startX: event.clientX, startWidth: state.pdfPaneWidth || defaultPdfPaneWidth() };
  event.currentTarget.classList.add('dragging'); event.currentTarget.setPointerCapture(event.pointerId);
});
el('pdf-pane-resizer').addEventListener('pointermove', event => {
  const drag = state.pdfPaneResize; if (!drag || drag.pointerId !== event.pointerId) return;
  applyPdfPaneWidth(drag.startWidth + event.clientX - drag.startX);
});
function finishPdfPaneResize(event) {
  const drag = state.pdfPaneResize; if (!drag || drag.pointerId !== event.pointerId) return;
  state.pdfPaneResize = null; el('pdf-pane-resizer').classList.remove('dragging');
  try { el('pdf-pane-resizer').releasePointerCapture(event.pointerId); } catch {}
  applyPdfPaneWidth(state.pdfPaneWidth, { save: true });
}
el('pdf-pane-resizer').addEventListener('pointerup', finishPdfPaneResize);
el('pdf-pane-resizer').addEventListener('pointercancel', finishPdfPaneResize);
el('pdf-pane-resizer').addEventListener('dblclick', () => {
  state.pdfPaneWidth = defaultPdfPaneWidth(); applyPdfPaneWidth(state.pdfPaneWidth, { save: true });
});
el('pdf-pane-resizer').addEventListener('keydown', event => {
  const bounds = pdfPaneWidthBounds();
  const next = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max
    : event.key === 'ArrowLeft' ? (state.pdfPaneWidth || defaultPdfPaneWidth()) - 12
      : event.key === 'ArrowRight' ? (state.pdfPaneWidth || defaultPdfPaneWidth()) + 12 : null;
  if (next === null) return;
  event.preventDefault(); applyPdfPaneWidth(next, { save: true });
});
addEventListener('resize', () => { if (state.pdfInspectorOpen) applyPdfPaneWidth(); });
el('pdf-note-save').addEventListener('click', () => savePdfWorkspaceNote());
el('pdf-workspace-editor').addEventListener('input', schedulePdfWorkspaceSave);
el('pdf-workspace-editor').addEventListener('keyup', () => { rememberPdfWorkspaceRange(); updatePdfNoteCommandStates(); });
el('pdf-workspace-editor').addEventListener('mouseup', () => { rememberPdfWorkspaceRange(); updatePdfNoteCommandStates(); });
el('pdf-workspace-editor').addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoPdfWorkspaceNote(); else undoPdfWorkspaceNote();
  } else if (key === 'y') {
    event.preventDefault(); redoPdfWorkspaceNote();
  }
});
el('pdf-workspace-editor').addEventListener('click', async event => {
  const action = event.target.closest('[data-pdf-note-image-action]')?.dataset.pdfNoteImageAction;
  if (!action) return;
  const figure = event.target.closest('[data-pdf-note-image]');
  if (!figure) return;
  if (action === 'shrink' || action === 'grow') {
    const delta = action === 'grow' ? 15 : -15;
    figure.dataset.pdfNoteWidth = String(clampPdfNoteImageWidth(Number(figure.dataset.pdfNoteWidth) + delta));
    figure.style.setProperty('--pdf-note-image-width', `${figure.dataset.pdfNoteWidth}%`);
    commitPdfNoteHistory(); schedulePdfWorkspaceSave({ recordHistory: false });
    return;
  }
  if (action !== 'delete') return;
  const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'));
  figure.replaceWith(paragraph); state.pdfNoteDirty = true;
  commitPdfNoteHistory();
  await savePdfWorkspaceNote({ quiet: true });
  toast('图片已删除，可使用 Ctrl/Cmd+Z 撤销');
});
el('pdf-pane-notes').querySelector('.pdf-note-toolbar').addEventListener('mousedown', event => {
  if (event.target.closest('button')) event.preventDefault();
});
el('pdf-pane-notes').querySelector('.pdf-note-toolbar').addEventListener('click', event => {
  const button = event.target.closest('[data-pdf-note-command]'); if (!button) return;
  el('pdf-workspace-editor').focus({ preventScroll: true }); restorePdfWorkspaceRange();
  document.execCommand(button.dataset.pdfNoteCommand, false, button.dataset.pdfNoteValue || null);
  rememberPdfWorkspaceRange(); updatePdfNoteCommandStates(); commitPdfNoteHistory(); schedulePdfWorkspaceSave({ recordHistory: false });
});
el('pdf-note-undo').addEventListener('click', undoPdfWorkspaceNote);
el('pdf-note-redo').addEventListener('click', redoPdfWorkspaceNote);
document.addEventListener('selectionchange', () => {
  if (el('pdf-modal')?.classList.contains('open') && state.pdfInspectorTab === 'notes') updatePdfNoteCommandStates();
});
el('pdf-note-font-size').addEventListener('change', event => {
  uiSettings.noteFontSize = clampPdfNoteFontSize(event.target.value);
  applyUiSettings();
  if (el('appearance-note-font')) el('appearance-note-font').value = String(uiSettings.noteFontSize);
  toast(`阅读笔记字号已调整为 ${uiSettings.noteFontSize}px`);
});
el('pdf-note-add-image').addEventListener('click', () => el('pdf-note-image-file').click());
el('pdf-note-image-file').addEventListener('change', async event => {
  for (const file of [...event.target.files]) await addPdfWorkspaceImage(file, file.name);
  event.target.value = '';
});
el('pdf-note-add-snapshot').addEventListener('click', addLatestPdfSnapshotToNote);
el('pdf-note-export').addEventListener('click', openPdfWorkspaceExportDialog);
el('note-export-confirm').addEventListener('click', exportPdfWorkspaceNote);
el('pdf-reparse').addEventListener('click', reparsePdfText);
el('pdf-ocr-page').addEventListener('click', ocrCurrentPdfPage);
el('pdf-ocr-missing').addEventListener('click', ocrMissingPdfPages);
document.querySelector('.pdf-export-menu').addEventListener('click', event => {
  if (event.target.closest('button')) event.currentTarget.removeAttribute('open');
});
document.querySelectorAll('[data-pdf-tool]').forEach(button => button.addEventListener('click', () => applyOrTogglePdfAnnotationTool(button.dataset.pdfTool)));
el('pdf-snapshot-page').addEventListener('click', () => createPdfSnapshot(state.pdfPage, { x: 0, y: 0, width: 1, height: 1 }));
el('pdf-cancel-annotation').addEventListener('click', () => cancelPdfAnnotationInteraction());
el('pdf-undo-annotation').addEventListener('click', undoPdfAnnotation);
el('pdf-export-annotated').addEventListener('click', exportAnnotatedPdf);
el('pdf-export-annotations').addEventListener('click', exportPdfAnnotations);
el('pdf-import-annotations').addEventListener('click', () => el('pdf-annotations-file').click());
el('pdf-annotations-file').addEventListener('change', async event => { const [file] = event.target.files; if (file) await importPdfAnnotationsFile(file); event.target.value = ''; });
document.querySelector('.pdf-export-menu>div').addEventListener('click', event => {
  if (event.target.closest('button')) document.querySelector('.pdf-export-menu')?.removeAttribute('open');
});
el('pdf-pages-container').addEventListener('pointerdown', event => {
  const mode = pdfSelectionToolType(); const layer = event.target.closest('.textLayer');
  // Desktop PDF dragging always uses visual geometry. Tying this to the
  // translation switch previously re-enabled the broken native Range path.
  const browseMode = !mode && event.pointerType !== 'touch';
  if ((!mode && !browseMode) || !layer || event.button !== 0) return;
  const stack = layer.closest('[data-pdf-page-stack]'); const pageNumber = Number(stack?.dataset.page);
  if (!pageNumber) return;
  event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
  discardPdfTextSelectionDraft(); clearPdfBrowseSelection();
  if (browseMode) closeTranslationPopover();
  const layout = pdfVisualTextLayout(layer);
  if (!layout.runs.length) return toast('当前页没有可选择的文字，请尝试 OCR');
  stack.classList.add('visual-selecting');
  state.pdfTextSelectionDraft = {
    pointerId: event.pointerId, mode: mode || 'translate', browseMode, dragging: false, layer, stack, pageNumber, layout,
    startPoint: { x: event.clientX, y: event.clientY }, endPoint: { x: event.clientX, y: event.clientY },
    startEndpoint: pdfVisualEndpoint(layout, { x: event.clientX, y: event.clientY }),
    previewNodes: [], selection: null
  };
  layer.setPointerCapture(event.pointerId);
});
el('pdf-pages-container').addEventListener('pointermove', event => {
  const draft = state.pdfTextSelectionDraft;
  if (!draft || draft.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = pdfDraftPointInLayout(draft, event);
  const distance = Math.hypot(point.x - draft.startPoint.x, point.y - draft.startPoint.y);
  if (draft.browseMode && distance < 3) return;
  draft.dragging = true; updatePdfTextSelectionDraft(event);
});
el('pdf-pages-container').addEventListener('pointerup', async event => {
  const draft = state.pdfTextSelectionDraft;
  if (!draft || draft.pointerId !== event.pointerId) return;
  event.preventDefault(); event.stopPropagation();
  if (draft.browseMode && !draft.dragging) { discardPdfTextSelectionDraft(); return; }
  const selection = updatePdfTextSelectionDraft(event); const mode = draft.mode; const pageNumber = draft.pageNumber;
  if (draft.browseMode) {
    const previewNodes = draft.previewNodes || []; draft.previewNodes = [];
    discardPdfTextSelectionDraft();
    if (selection?.error) { previewNodes.forEach(node => node.remove()); state.pdfSelection = null; return toast(selection.error); }
    state.pdfSelection = selection;
    state.pdfBrowseSelection = { selection, previewNodes, layer: draft.layer };
    state.pdfSuppressWordClick = true; setTimeout(() => { state.pdfSuppressWordClick = false; }, 80);
    updatePdfCurrentPage(pageNumber); updatePdfAnnotationMode();
    if (translationSettings.enabled && translationSettings.selection) {
      if (selection.text.length > 2000) return toast('单次翻译最多 2,000 个字符');
      await showTranslation(selection.text, pdfSelectionClientRect(selection, draft.layer), draft.layer, 'selection');
    }
    return;
  }
  discardPdfTextSelectionDraft();
  if (selection?.error) return toast(selection.error);
  state.pdfSelection = selection; updatePdfCurrentPage(pageNumber);
  await addPdfSelectionAnnotation(mode, selection);
});
el('pdf-pages-container').addEventListener('pointercancel', event => {
  if (state.pdfTextSelectionDraft?.pointerId === event.pointerId) discardPdfTextSelectionDraft();
});
el('pdf-pages-container').addEventListener('mouseup', event => {
  if (!event.target.closest('.textLayer')) return;
  if (pdfSelectionToolType() || state.pdfBrowseSelection) return;
  setTimeout(() => capturePdfSelection({ applyTool: true }));
});
el('pdf-canvas-stage').addEventListener('pointerdown', event => {
  const layer = event.target.closest('.pdf-annotation-layer'); if (!layer) return;
  const mark = event.target.closest('[data-annotation-id]');
  if (mark) {
    const pageNumber = Number(layer.closest('[data-pdf-page-stack]')?.dataset.page);
    if (pageNumber) updatePdfCurrentPage(pageNumber);
    renderPdfAnnotationList(mark.dataset.annotationId); return;
  }
  if (!['area', 'area-note', 'snapshot'].includes(state.pdfAnnotationMode)) return;
  const stack = layer.closest('[data-pdf-page-stack]'); const pageNumber = Number(stack?.dataset.page);
  if (!pageNumber) return;
  updatePdfCurrentPage(pageNumber);
  const bounds = layer.getBoundingClientRect();
  const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)); const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
  const draft = document.createElement('div'); draft.className = `pdf-annotation-draft${state.pdfAnnotationMode === 'snapshot' ? ' snapshot' : ''}`; draft.style.left = `${x}px`; draft.style.top = `${y}px`; layer.appendChild(draft);
  state.pdfAnnotationDraft = { pointerId: event.pointerId, x, y, bounds, draft, mode: state.pdfAnnotationMode, layer, pageNumber }; layer.setPointerCapture(event.pointerId);
});
el('pdf-canvas-stage').addEventListener('pointermove', event => {
  const value = state.pdfAnnotationDraft; if (!value || value.pointerId !== event.pointerId) return;
  const x = Math.max(0, Math.min(value.bounds.width, event.clientX - value.bounds.left)); const y = Math.max(0, Math.min(value.bounds.height, event.clientY - value.bounds.top));
  value.draft.style.left = `${Math.min(value.x, x)}px`; value.draft.style.top = `${Math.min(value.y, y)}px`; value.draft.style.width = `${Math.abs(x - value.x)}px`; value.draft.style.height = `${Math.abs(y - value.y)}px`;
});
el('pdf-canvas-stage').addEventListener('pointerup', async event => {
  const value = state.pdfAnnotationDraft; if (!value || value.pointerId !== event.pointerId) return; state.pdfAnnotationDraft = null;
  const x = Math.max(0, Math.min(value.bounds.width, event.clientX - value.bounds.left)); const y = Math.max(0, Math.min(value.bounds.height, event.clientY - value.bounds.top));
  value.draft.remove(); const width = Math.abs(x - value.x); const height = Math.abs(y - value.y);
  if (width < 8 || height < 8) return toast(`请拖出一个更大的${value.mode === 'snapshot' ? '截图' : '标注'}区域`);
  state.pdfPage = value.pageNumber;
  const rect = { x: Math.min(value.x, x) / value.bounds.width, y: Math.min(value.y, y) / value.bounds.height, width: width / value.bounds.width, height: height / value.bounds.height };
  if (value.mode === 'snapshot') await createPdfSnapshot(value.pageNumber, rect);
  else await addPdfAreaAnnotation(value.mode, rect);
});
el('pdf-snapshot-layer').addEventListener('pointerdown', event => {
  const card = event.target.closest('[data-pdf-snapshot-id]');
  if (!card) return;
  bringPdfSnapshotToFront(card);
  const handle = event.target.closest('.pdf-snapshot-head');
  if (!handle || event.target.closest('button')) return;
  event.preventDefault();
  const bounds = card.getBoundingClientRect();
  state.pdfSnapshotDrag = { card, handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: bounds.left, top: bounds.top };
  handle.setPointerCapture(event.pointerId);
});
el('pdf-snapshot-layer').addEventListener('pointermove', event => {
  const drag = state.pdfSnapshotDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const left = Math.max(6, Math.min(window.innerWidth - drag.card.offsetWidth - 6, drag.left + event.clientX - drag.startX));
  const top = Math.max(6, Math.min(window.innerHeight - 52, drag.top + event.clientY - drag.startY));
  drag.card.style.left = `${left}px`; drag.card.style.top = `${top}px`;
});
function finishPdfSnapshotDrag(event) {
  const drag = state.pdfSnapshotDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  try { drag.handle.releasePointerCapture(event.pointerId); } catch {}
  state.pdfSnapshotDrag = null;
}
el('pdf-snapshot-layer').addEventListener('pointerup', finishPdfSnapshotDrag);
el('pdf-snapshot-layer').addEventListener('pointercancel', finishPdfSnapshotDrag);
el('pdf-snapshot-layer').addEventListener('click', async event => {
  const card = event.target.closest('[data-pdf-snapshot-id]');
  const action = event.target.closest('[data-pdf-snapshot-action]')?.dataset.pdfSnapshotAction;
  if (!card || !action) return;
  if (action === 'close') return removePdfSnapshot(card.dataset.pdfSnapshotId);
  if (action === 'note') {
    const snapshot = state.pdfSnapshots.find(item => item.id === card.dataset.pdfSnapshotId);
    if (!snapshot?.blob) return toast('截图内容已经不可用');
    if (snapshot.paperId !== state.pdfPaperId) return toast('请打开截图对应的论文后再插入笔记');
    return addPdfWorkspaceImage(snapshot.blob, `第 ${snapshot.page} 页截图`);
  }
  const factor = action === 'grow' ? 1.18 : .84;
  const width = Math.max(240, Math.min(Math.min(760, window.innerWidth - 20), card.getBoundingClientRect().width * factor));
  card.style.width = `${width}px`;
  const currentLeft = card.getBoundingClientRect().left;
  card.style.left = `${Math.max(6, Math.min(window.innerWidth - width - 6, currentLeft))}px`;
});
el('pdf-annotation-list').addEventListener('click', async event => {
  const item = event.target.closest('[data-pdf-annotation-id]'); if (!item) return; const id = item.dataset.pdfAnnotationId;
  const annotation = currentPdfAnnotations().find(value => value.id === id); const action = event.target.closest('[data-pdf-annotation-action]')?.dataset.pdfAnnotationAction;
  if (!annotation) return;
  if (action === 'goto') { await goToPdfPage(annotation.page); renderPdfAnnotationList(id); }
  else if (action === 'comment') { const comment = prompt('编辑批注：', annotation.comment || ''); if (comment !== null) { annotation.comment = comment.trim(); annotation.updatedAt = new Date().toISOString(); await persistPdfRecord(); renderPdfAnnotationList(id); } }
  else if (action === 'delete') {
    const index = currentPdfAnnotations().findIndex(value => value.id === id);
    if (index < 0) return;
    const targetRecord = state.pdfRecord; const targetPaperId = state.pdfPaperId;
    const historyIndex = state.pdfAnnotationHistory.lastIndexOf(id);
    if (historyIndex >= 0) state.pdfAnnotationHistory.splice(historyIndex, 1);
    state.pdfRecord.annotations.splice(index, 1);
    await persistPdfRecord(); renderPdfAnnotationLayerForPage(annotation.page); renderPdfAnnotationList();
    toast('PDF 标注已删除', {
      actionLabel: '撤销',
      duration: 5000,
      onAction: async () => {
        if (state.pdfRecord !== targetRecord || state.pdfPaperId !== targetPaperId) return toast('已切换文档，无法撤销标注删除');
        state.pdfRecord.annotations.splice(Math.max(0, index), 0, annotation);
        state.pdfAnnotationHistory.push(annotation.id);
        await persistPdfRecord(); renderPdfAnnotationLayerForPage(annotation.page); renderPdfAnnotationList(annotation.id);
      }
    });
  }
});
el('save-note').addEventListener('click', () => { const record = ensureRecord(getPaper(state.selectedPaperId)); record.note = el('paper-note').value.trim(); record.tags = [...new Set(el('paper-tags').value.split(/[,，]/).map(value => value.trim()).filter(Boolean))].slice(0, 12); record.progress = Number(el('reading-progress').value); if (record.progress === 100) record.readAt ||= new Date().toISOString(); else record.readAt = null; saveLibrary(); toast('阅读记录已保存'); });
el('add-to-collection').addEventListener('click', () => { const collectionId = el('paper-collection').value; if (!collectionId) return toast('请先选择分类'); const record = ensureRecord(getPaper(state.selectedPaperId)); record.trashAt = null; record.archivedAt = null; if (!record.collections.includes(collectionId)) record.collections.push(collectionId); saveLibrary(); toast('已加入分类'); });
el('add-highlight').addEventListener('click', () => { const selection = window.getSelection(); const text = selection?.toString().replace(/\s+/g, ' ').trim(); const anchor = selection?.anchorNode; if (!text || text.length < 3) return toast('请先选中摘要文字'); if (text.length > 500) return toast('单条标注最多 500 字符'); if (!anchor || !el('detail-abstract').contains(anchor.nodeType === Node.TEXT_NODE ? anchor.parentNode : anchor)) return toast('只能标注摘要文字'); const record = ensureRecord(getPaper(state.selectedPaperId)); if (record.highlights.some(item => item.text === text)) return toast('这段文字已经标注'); record.highlights.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), text, color: el('highlight-color').value, createdAt: new Date().toISOString() }); saveLibrary(); selection.removeAllRanges(); renderHighlights(); toast('标注已保存'); });
el('highlight-list').addEventListener('click', event => { const button = event.target.closest('[data-highlight-remove]'); if (!button) return; const record = getRecord(state.selectedPaperId); record.highlights = record.highlights.filter(item => item.id !== button.dataset.highlightRemove); saveLibrary(); renderHighlights(); });
el('previous-paper').addEventListener('click', () => moveDetail(-1)); el('next-paper').addEventListener('click', () => moveDetail(1));

el('open-compare').addEventListener('click', renderCompare); el('clear-compare').addEventListener('click', () => { state.compare.clear(); updateCompareTray(); renderCurrentView(); }); el('compare-table').addEventListener('click', event => { const button = event.target.closest('[data-compare-remove]'); if (button) { state.compare.delete(button.dataset.compareRemove); updateCompareTray(); renderCompare(); } });
el('command-open').addEventListener('click', () => openCommand()); el('command-input').addEventListener('input', event => renderCommands(event.target.value)); el('command-list').addEventListener('click', event => { const route = event.target.closest('[data-command-route]')?.dataset.commandRoute; const paper = event.target.closest('[data-command-paper]')?.dataset.commandPaper; closeModal('command-modal'); if (route) navigate(route); else if (paper) openPaperRoute(paper); });
el('translation-open').addEventListener('click', openTranslationSettings);
function mobileMoreItems() { return [...el('mobile-more-menu').querySelectorAll('[role="menuitem"]:not([disabled])')].filter(item => getComputedStyle(item).display !== 'none'); }
function closeMobileMore({ restoreFocus = false } = {}) {
  const menu = el('mobile-more-menu'); if (!menu.classList.contains('open')) return;
  menu.classList.remove('open'); el('mobile-more').setAttribute('aria-expanded', 'false');
  if (restoreFocus) el('mobile-more').focus();
}
function openMobileMore() {
  el('mobile-more-menu').classList.add('open'); el('mobile-more').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => mobileMoreItems()[0]?.focus());
}
el('mobile-more').addEventListener('click', () => {
  const open = !el('mobile-more-menu').classList.contains('open');
  open ? openMobileMore() : closeMobileMore({ restoreFocus: true });
});
el('mobile-more-menu').addEventListener('keydown', event => {
  const items = mobileMoreItems(); const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMobileMore({ restoreFocus: true }); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1 + items.length) % items.length : (index - 1 + items.length) % items.length;
  items[next]?.focus();
});
el('mobile-import-pdf').addEventListener('click', () => { closeMobileMore(); openPdfImportCenter(); });
el('mobile-backup').addEventListener('click', () => { closeMobileMore(); exportCompleteBackup(); });
document.addEventListener('click', event => {
  if (!el('mobile-more-menu').classList.contains('open') || event.target.closest('#mobile-more-menu,#mobile-more')) return;
  closeMobileMore();
});
el('translation-enabled').addEventListener('change', event => { translationSettings.enabled = event.target.checked; saveTranslationSettings(); if (translationSettings.enabled) detectTranslationCapability(); });
el('translation-mode').addEventListener('change', event => { translationSettings.mode = event.target.value; saveTranslationSettings(); });
el('translation-word-click').addEventListener('change', event => { translationSettings.wordClick = event.target.checked; saveTranslationSettings(); });
el('translation-word-click-mode').addEventListener('change', event => { translationSettings.wordClickMode = event.target.value === 'direct' ? 'direct' : 'ctrl'; saveTranslationSettings(); });
el('translation-selection').addEventListener('change', event => { translationSettings.selection = event.target.checked; saveTranslationSettings(); });
el('translation-position-mode').addEventListener('change', event => {
  translationSettings.positionMode = event.target.value;
  if (translationSettings.positionMode === 'pinned' && !translationSettings.position) {
    translationSettings.position = clampedTranslationPosition(window.innerWidth - 460, 90);
  }
  saveTranslationSettings();
  if (state.translationPayload?.rect) positionTranslationPopover(state.translationPayload.rect);
});
el('translation-endpoint').addEventListener('change', event => { translationSettings.onlineEndpoint = event.target.value.trim(); saveTranslationSettings(); });
el('translation-cache').addEventListener('change', event => { translationSettings.cache = event.target.checked; saveTranslationSettings(); });
el('translation-prepare').addEventListener('click', async () => { try { await prepareTranslator(); toast('本地英译中已经就绪'); } catch { toast('本地翻译准备失败，请查看状态说明'); } });
el('translation-prepare-inline').addEventListener('click', async () => {
  const payload = state.translationPayload; if (!payload) return;
  try { await prepareTranslator(); showTranslation(payload.source, payload.rect, payload.root, payload.sourceType); } catch { toast('本地翻译准备失败，请查看状态说明'); }
});
el('translation-download-dictionary').addEventListener('click', downloadCompleteDictionary);
el('translation-test-endpoint').addEventListener('click', testTranslationEndpoint);
el('translation-reset-position').addEventListener('click', resetTranslationPosition);
el('translation-clear-cache').addEventListener('click', () => {
  translationCache = {};
  localStorage.removeItem(TRANSLATION_CACHE_KEY);
  toast('翻译缓存已清除');
});
el('translation-open-vocabulary').addEventListener('click', () => { closeModal('translation-modal'); navigate('library/vocabulary'); });
el('translation-dock').addEventListener('click', toggleTranslationDock);
el('translation-pin').addEventListener('click', toggleTranslationPin);
el('translation-close').addEventListener('click', closeTranslationPopover);
el('translation-online').addEventListener('click', translateCurrentOnline);
el('translation-speak').addEventListener('click', speakCurrentTranslation);
el('translation-copy').addEventListener('click', () => { const payload = state.translationPayload; copyText(payload?.translation || payload?.source || '', payload?.translation ? '译文已复制' : '原文已复制'); });
el('translation-vocabulary').addEventListener('click', addCurrentTranslationToVocabulary);
el('translation-note').addEventListener('click', addCurrentTranslationToNote);
el('translation-alternatives').addEventListener('click', event => {
  const button = event.target.closest('[data-translation-alternative]'); if (!button || !state.translationPayload) return;
  state.translationPayload.translation = button.dataset.translationAlternative;
  el('translation-result').textContent = state.translationPayload.translation;
  setTranslationActions(true); toast('已切换为该译法');
});
el('update-now').addEventListener('click', () => {
  const waiting = state.serviceWorkerRegistration?.waiting;
  if (!waiting) return location.reload();
  state.updateReloading = true; waiting.postMessage({ type: 'SKIP_WAITING' });
});
el('update-later').addEventListener('click', () => el('update-banner').classList.remove('show'));
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => {
  if (event.target === modal && modal.id !== 'pdf-modal') closeModal(modal.id);
}));
document.addEventListener('keydown', event => {
  const target = event.target; const editing = target?.matches?.('input,textarea,select,[contenteditable="true"]');
  const pdfOpen = el('pdf-modal').classList.contains('open');
  if (pdfOpen && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'c' && !editing && state.pdfBrowseSelection?.selection?.text) {
    event.preventDefault(); copyText(state.pdfBrowseSelection.selection.text, '所选 PDF 文字已复制'); return;
  }
  if (pdfOpen && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !editing) {
    event.preventDefault(); undoPdfAnnotation(); return;
  }
  if (pdfOpen && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const key = event.key.toLowerCase();
    const tool = event.shiftKey && key === 'n' ? 'area-note' : ({ h: 'highlight', u: 'underline', n: 'note', r: 'area', s: 'snapshot' })[key];
    if (tool) { event.preventDefault(); applyOrTogglePdfAnnotationTool(tool); return; }
    if (event.key === 'PageUp' && state.pdfPage > 1) { event.preventDefault(); goToPdfPage(state.pdfPage - 1); return; }
    if (event.key === 'PageDown' && state.pdfDocument && state.pdfPage < state.pdfDocument.numPages) { event.preventDefault(); goToPdfPage(state.pdfPage + 1); return; }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommand(); return; }
  if (event.key === 'Escape') {
    if (el('mobile-more-menu').classList.contains('open')) { event.preventDefault(); closeMobileMore({ restoreFocus: true }); return; }
    if (pdfOpen) {
      const translationWasOpen = el('translation-popover').classList.contains('open');
      if (cancelPdfAnnotationInteraction() || translationWasOpen) { event.preventDefault(); return; }
      event.preventDefault(); return;
    }
    closeTranslationPopover(); document.querySelectorAll('.modal.open').forEach(node => closeModal(node.id));
    if (el('paper-drawer').classList.contains('open')) closeDrawer();
  }
});

el('edit-profile').addEventListener('click', () => el('profile-modal').classList.add('open')); el('save-profile').addEventListener('click', () => { library.profile.name = el('profile-name').value.trim() || '研究者'; library.profile.focus = el('profile-focus').value.trim(); library.profile.bio = el('profile-bio').value.trim(); saveLibrary(); renderProfile(); closeModal('profile-modal'); toast('个人资料已保存'); });
function resolvedUiTheme(theme = uiSettings.theme) {
  return theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme === 'dark' ? 'dark' : 'light';
}
function applyUiSettings({ save = true } = {}) {
  const root = document.documentElement;
  root.dataset.theme = resolvedUiTheme();
  root.dataset.uiPreset = ['classic', 'compact', 'focus', 'accessible'].includes(uiSettings.preset) ? uiSettings.preset : 'classic';
  root.dataset.density = ['comfortable', 'standard', 'compact'].includes(uiSettings.density) ? uiSettings.density : 'standard';
  root.dataset.sidebar = uiSettings.sidebar === 'collapsed' ? 'collapsed' : 'expanded';
  uiSettings.readerPane = uiSettings.readerPane === 'wide' ? 'wide' : 'standard';
  uiSettings.noteFontSize = clampPdfNoteFontSize(uiSettings.noteFontSize, uiSettings.noteFont === 'large' ? 16 : 14);
  delete uiSettings.noteFont;
  root.classList.toggle('reduce-motion', Boolean(uiSettings.reduceMotion));
  root.style.setProperty('--user-font-scale', String(Math.max(.9, Math.min(1.3, Number(uiSettings.fontScale || 1)))));
  syncPdfReaderPreferences();
  el('theme-toggle').textContent = root.dataset.theme === 'dark' ? '切换为明亮主题' : '切换为深色主题';
  if (el('settings-ui-summary')) {
    const presetNames = { classic: '经典绿', compact: '紧凑学术', focus: '专注阅读', accessible: '高可访问' };
    const densityNames = { comfortable: '舒适', standard: '标准', compact: '紧凑' };
    el('settings-ui-summary').textContent = `${presetNames[uiSettings.preset] || '经典绿'} · ${densityNames[uiSettings.density] || '标准'} · ${Math.round(Number(uiSettings.fontScale || 1) * 100)}%`;
    el('settings-reader-summary').textContent = `左侧工具 · ${uiSettings.readerPane === 'wide' ? '宽松' : '紧凑'} · 笔记 ${uiSettings.noteFontSize}px`;
  }
  if (save) {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings));
    localStorage.setItem(THEME_KEY, uiSettings.theme);
  }
}
function syncAppearanceControls() {
  el('appearance-theme').value = uiSettings.theme;
  el('appearance-density').value = uiSettings.density;
  el('appearance-font').value = String(uiSettings.fontScale);
  el('appearance-sidebar').value = uiSettings.sidebar;
  el('appearance-reader-pane').value = uiSettings.readerPane;
  el('appearance-note-font').value = String(clampPdfNoteFontSize(uiSettings.noteFontSize));
  el('appearance-motion').checked = Boolean(uiSettings.reduceMotion);
  document.querySelectorAll('[data-ui-preset]').forEach(button => button.classList.toggle('active', button.dataset.uiPreset === uiSettings.preset));
}
function openAppearanceSettings() {
  appearanceSnapshot = { ...uiSettings };
  syncAppearanceControls();
  el('appearance-modal').classList.add('open');
}
function updateAppearancePreview() {
  uiSettings = {
    ...uiSettings,
    theme: el('appearance-theme').value,
    density: el('appearance-density').value,
    fontScale: Number(el('appearance-font').value),
    sidebar: el('appearance-sidebar').value,
    readerPane: el('appearance-reader-pane').value,
    noteFontSize: clampPdfNoteFontSize(el('appearance-note-font').value),
    reduceMotion: el('appearance-motion').checked
  };
  applyUiSettings({ save: false });
}
function applyTheme(theme) {
  uiSettings.theme = theme;
  applyUiSettings();
}
el('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
el('appearance-open').addEventListener('click', openAppearanceSettings);
document.querySelectorAll('[data-ui-preset]').forEach(button => button.addEventListener('click', () => {
  uiSettings.preset = button.dataset.uiPreset;
  syncAppearanceControls();
  applyUiSettings({ save: false });
}));
['appearance-theme', 'appearance-density', 'appearance-font', 'appearance-sidebar', 'appearance-reader-pane', 'appearance-note-font'].forEach(id => el(id).addEventListener('change', updateAppearancePreview));
el('appearance-motion').addEventListener('change', updateAppearancePreview);
el('appearance-save').addEventListener('click', () => { updateAppearancePreview(); applyUiSettings(); appearanceSnapshot = null; closeModal('appearance-modal'); toast('界面配置已保存'); });
el('appearance-reset').addEventListener('click', () => { uiSettings = { ...UI_DEFAULTS, preset: 'classic' }; applyUiSettings(); appearanceSnapshot = { ...uiSettings }; syncAppearanceControls(); toast('已恢复经典绿设置'); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (uiSettings.theme === 'system') applyUiSettings({ save: false }); });
window.addEventListener('scroll', () => el('backtop').classList.toggle('show', window.scrollY > 500)); el('backtop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('hashchange', renderRoute); window.addEventListener('resize', () => {
  if (window.innerWidth > 720) closeMobileMore();
  placePdfReaderControls();
  if (translationSettings.positionMode !== 'pinned' || !translationSettings.position) return;
  translationSettings.position = clampedTranslationPosition(translationSettings.position.left, translationSettings.position.top);
  if (el('translation-popover').classList.contains('open')) positionTranslationPopover(state.translationPayload?.rect || { left: 20, top: 20, bottom: 21, width: 1, height: 1 });
});
async function promptAppInstall() {
  closeMobileMore();
  if (!state.installPrompt) return toast('当前浏览器暂未提供安装提示，可使用浏览器菜单安装此应用');
  state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; el('install-app-state').textContent = '浏览器';
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; el('install-app-state').textContent = '可安装'; });
el('install-app').addEventListener('click', promptAppInstall);
window.addEventListener('appinstalled', () => { state.installPrompt = null; el('install-app-state').textContent = '已安装'; toast('PaperScope 已安装'); });

applyUiSettings(); applyTranslationSettings(); setupTranslationDragging(); loadDomainDictionary().catch(() => {}); detectTranslationCapability(); renderProfile(); renderCollectionOptions('all'); if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/home'); registerAppServiceWorker(); loadData();
openPdfDatabase().then(async () => {
  await repairPdfLibrary({ notify: false });
  await restorePdfImportQueue();
}).catch(error => toast(error.message || 'PDF 数据库初始化失败'));
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async launchParams => {
    const files = [];
    for (const handle of launchParams.files || []) files.push(await handle.getFile());
    if (files.length) queuePdfFiles(files);
  });
}

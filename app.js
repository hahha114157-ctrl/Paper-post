const APP_VERSION = '6.3.0';
const STORAGE_KEY = 'paperscope-library-v3';
const V2_STORAGE_KEY = 'paperscope-library-v2';
const LEGACY_SAVED_KEY = 'paperscope-saved';
const THEME_KEY = 'paperscope-theme';
const FILTER_KEY_PREFIX = 'paperscope-quality-filters-v1-';
const TRANSLATION_SETTINGS_KEY = 'paperscope-translation-settings-v2';
const LEGACY_TRANSLATION_SETTINGS_KEY = 'paperscope-translation-settings-v1';
const TRANSLATION_CACHE_KEY = 'paperscope-translation-cache-v2';
const LEGACY_TRANSLATION_CACHE_KEY = 'paperscope-translation-cache-v1';
const TRANSLATION_HISTORY_KEY = 'paperscope-translation-history-v1';
const PDF_DB_NAME = 'paperscope-pdf-library-v1';
const PDF_STORE_NAME = 'pdfs';
const PDF_VIEW_MODE_KEY = 'paperscope-pdf-view-mode-v1';
const TRANSLATION_DEFAULTS = {
  enabled: true, wordClick: true, selection: true, cache: true, mode: 'auto',
  positionMode: 'follow', position: null, onlineEndpoint: ''
};
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

const ROUTE_NAMES = { home: '概览', ai: 'AI 论文', architecture: '体系结构', curated: '顶会期刊精选', library: '个人文献库', news: '研究资讯', venues: '会议期刊', paper: '论文详情' };
const state = {
  datasets: { ai: null, architecture: null }, news: null, venues: null, curated: null, loaded: false,
  compare: new Set(), batch: new Set(), returnHash: null, selectedPaperId: null,
  installPrompt: null, searchTimer: null, translator: null, translatorStatus: 'checking',
  translationRequestId: 0, translationSelectionTimer: null, translationPayload: null, lastSelectionKey: '',
  dictionaryManifest: null, dictionaryDomain: null, dictionaryShards: new Map(), dictionaryDownloadController: null,
  translationDrag: null,
  pdfModule: null, pdfLibModule: null, tesseractModule: null, ocrWorker: null,
  pdfLoadingTask: null, pdfDocument: null, pdfRecord: null, pdfPaperId: null, pdfPage: 1, pdfScale: 1.4, pdfRenderTask: null,
  pdfTextContent: null, pdfSelection: null, pdfAnnotationMode: null, pdfAnnotationDraft: null, pdfAnnotationHistory: [], libraryPdfMatches: null,
  pdfViewMode: localStorage.getItem(PDF_VIEW_MODE_KEY) === 'paged' ? 'paged' : 'continuous',
  pdfContinuousObserver: null, pdfPageObserver: null, pdfContinuousTasks: new Map(), pdfPageVisibility: new Map(),
  lineageRequestId: 0,
  serviceWorkerRegistration: null, updateReloading: false
};

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function defaultLibrary() {
  return {
    version: 3,
    profile: { name: '研究者', focus: 'AI · 计算机体系结构', bio: '建立自己的研究脉络。', createdAt: new Date().toISOString() },
    records: {}, collections: {}, savedVenues: [], dailyProgress: {}, vocabulary: {}
  };
}
function migrateLibrary() {
  const current = readJson(STORAGE_KEY, null);
  if (current?.version === 3) return { ...defaultLibrary(), ...current, profile: { ...defaultLibrary().profile, ...(current.profile || {}) }, records: current.records || {}, collections: current.collections || {}, savedVenues: current.savedVenues || [], dailyProgress: current.dailyProgress || {}, vocabulary: current.vocabulary || {} };
  const old = readJson(V2_STORAGE_KEY, null);
  if (!old?.records) return defaultLibrary();
  const records = Object.fromEntries(Object.entries(old.records).map(([id, record]) => [id, {
    ...record, queueAt: record.queueAt || null, lastOpenedAt: record.lastOpenedAt || record.readAt || null,
    progress: Number(record.progress || (record.readAt ? 100 : 0)), collections: Array.isArray(record.collections) ? record.collections : []
  }]));
  const migrated = { ...defaultLibrary(), profile: { ...defaultLibrary().profile, ...(old.profile || {}) }, records };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
  return migrated;
}
let library = migrateLibrary();
let translationSettings = {
  ...TRANSLATION_DEFAULTS,
  ...readJson(LEGACY_TRANSLATION_SETTINGS_KEY, {}),
  ...readJson(TRANSLATION_SETTINGS_KEY, {})
};
let translationCache = { ...readJson(LEGACY_TRANSLATION_CACHE_KEY, {}), ...readJson(TRANSLATION_CACHE_KEY, {}) };
let translationHistory = readJson(TRANSLATION_HISTORY_KEY, []);
function saveLibrary() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(library)); } catch { toast('浏览器存储空间不足，请导出备份'); } }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function safeUrl(value = '') { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function toast(text) { const node = el('toast'); node.textContent = text; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2700); }
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
  if (!paper) return null; const old = library.records[paper.id] || {};
  library.records[paper.id] = {
    paper: snapshotPaper(paper), savedAt: old.savedAt || null, queueAt: old.queueAt || null, readAt: old.readAt || null,
    lastOpenedAt: old.lastOpenedAt || null, progress: Number(old.progress || 0), note: old.note || '', tags: Array.isArray(old.tags) ? old.tags : [],
    highlights: Array.isArray(old.highlights) ? old.highlights : [], collections: Array.isArray(old.collections) ? old.collections : [],
    publication: old.publication || paper.publication || null, abstractTranslation: old.abstractTranslation || null,
    pdfAttachment: old.pdfAttachment || null, lineage: old.lineage || null, metadataOverrides: old.metadataOverrides || null
  };
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
  const records = Object.values(library.records).filter(record => record?.paper);
  return {
    saved: records.filter(record => record.savedAt).length, queue: records.filter(record => record.queueAt).length,
    read: records.filter(record => record.readAt).length, notes: records.filter(record => record.note || record.highlights?.length).length,
    published: records.filter(record => record.savedAt && publicationInfo(record, record.paper).status === 'published').length,
    terms: Object.keys(library.vocabulary || {}).length
  };
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
    if (filters.status === 'unread' && record?.readAt) return false;
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
  return `<article class="paper-row ${record?.readAt ? 'read' : ''}" data-paper-id="${escapeHtml(paper.id)}"><input class="check" type="checkbox" data-action="compare" aria-label="加入对比" ${checked ? 'checked' : ''}><span class="paper-index">${String(index).padStart(2, '0')}</span><div class="paper-main"><button class="paper-title" data-action="open"><h3 data-translatable>${escapeHtml(paper.title)}</h3></button><p data-translatable>${escapeHtml(paper.abstract)}</p><div class="tag-row"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span>${paper.quality?.tier ? `<span class="tag quality-badge">${escapeHtml(paper.quality.tier)} · ${paper.qualityScore}</span>` : ''}<span class="tag venue-badge">${escapeHtml(`${paper.venueName || paper.venue || paper.source}${paper.venueYear ? ` ${paper.venueYear}` : ''}`)}</span><span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.status === 'published' ? '正式收录' : '预印本')}</span><span class="tag">${escapeHtml(paperDateText(paper))}</span>${record?.note ? '<span class="tag note">有笔记</span>' : ''}${paperTopics(paper).map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div></div><div class="paper-actions"><button data-action="read" class="${record?.readAt ? 'active' : ''}" title="已读">✓</button><button data-action="queue" class="${record?.queueAt ? 'active' : ''}" title="阅读队列">＋</button><button data-action="save" class="${record?.savedAt ? 'saved' : ''}" title="收藏">${record?.savedAt ? '★' : '☆'}</button></div></article>`;
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
  el('daily-schedule').innerHTML = (state.curated.daily?.items || []).map(item => { const paper = getPaper(item.paperId); if (!paper) return ''; const done = Boolean(library.dailyProgress?.[item.date]?.completedAt); return `<div class="schedule-row ${item.date === today ? 'today' : ''}"><span class="mono">${item.date === today ? '今天' : escapeHtml(item.date.slice(5))}${done ? ' · ✓' : ''}</span><div><b>${escapeHtml(paper.title)}</b><p>${escapeHtml(`${paper.venueName || paper.venue || paper.source} · ${item.reason}`)}</p></div><button class="small" data-open-paper="${escapeHtml(paper.id)}">查看</button></div>`; }).join('');
}

function toggleRecordField(id, field) {
  const record = ensureRecord(getPaper(id)); if (!record) return;
  const value = `${field}At`; record[value] = record[value] ? null : new Date().toISOString();
  if (field === 'read' && record.readAt) record.progress = Math.max(record.progress || 0, 100);
  saveLibrary(); renderCurrentView(); renderDrawerActions();
  toast(record[value] ? field === 'saved' ? '已收藏' : field === 'queue' ? '已加入阅读队列' : '已标记为已读' : '已取消');
}
function markOpened(id) { const record = ensureRecord(getPaper(id)); if (!record) return; record.lastOpenedAt = new Date().toISOString(); saveLibrary(); }
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
    if (!record?.paper) continue; const key = duplicateRecordKey(record); if (!key) continue;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(id);
  }
  return new Set([...groups.values()].filter(ids => ids.length > 1).flat());
}
function libraryRecords(tab, collectionId, q, smart = 'unread') {
  const duplicates = tab === 'duplicates' ? duplicateRecordIds() : null;
  return Object.entries(library.records).filter(([, record]) => record?.paper).filter(([id, record]) => {
    const paper = { ...record.paper, ...(record.metadataOverrides || {}) };
    if (q && !`${paper.title} ${(paper.authors || []).join(' ')} ${paper.venue || ''} ${paper.doi || ''} ${record.note} ${(record.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === 'all') return true;
    if (tab === 'saved') return Boolean(record.savedAt);
    if (tab === 'queue') return Boolean(record.queueAt);
    if (tab === 'recent') return Boolean(record.lastOpenedAt);
    if (tab === 'notes') return Boolean(record.note || record.highlights?.length || record.pdfAttachment?.annotationCount);
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
      return !record.readAt && Number(record.progress || 0) < 100;
    }
    return true;
  }).sort(([, a], [, b]) => new Date(b.queueAt || b.savedAt || b.lastOpenedAt || b.readAt || 0) - new Date(a.queueAt || a.savedAt || a.lastOpenedAt || a.readAt || 0));
}
function renderLibraryPage(route) {
  renderProfile(); const tab = route.parts[1] || 'saved'; const q = route.query.q || ''; const collectionId = route.query.collection || 'all'; const smart = route.query.smart || 'unread'; const page = Math.max(1, Number(route.query.page || 1));
  const stats = libraryStats(); for (const [name, value] of Object.entries(stats)) el(`stat-${name}`).textContent = value;
  document.querySelectorAll('#library-tabs [data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  el('library-batchbar').classList.toggle('hidden', ['vocabulary', 'translations'].includes(tab));
  el('collection-tools').classList.toggle('hidden', tab !== 'collections'); renderCollectionOptions(collectionId);
  el('smart-tools').classList.toggle('hidden', tab !== 'smart'); el('smart-filter').value = smart;
  if (tab === 'smart' && route.query.pdfq) el('library-pdf-search').value = route.query.pdfq;
  el('merge-duplicates').classList.toggle('hidden', tab !== 'duplicates');
  if (tab === 'vocabulary') return renderVocabularyPage(route);
  if (tab === 'translations') return renderTranslationHistoryPage(route);
  const records = libraryRecords(tab, collectionId, q, smart); const total = Math.max(1, Math.ceil(records.length / 10)); const safePage = Math.min(page, total); const pageRecords = records.slice((safePage - 1) * 10, safePage * 10);
  state.batch.clear(); updateBatchCount(); el('library-select-all').checked = false;
  el('library-list').innerHTML = pageRecords.length ? pageRecords.map(([id, record]) => libraryRow(id, record)).join('') : '<div class="empty">当前分类还没有论文。</div>';
  renderPagination('library-pagination', safePage, total, next => navigate(`library/${tab}`, { ...route.query, page: next }));
}
function libraryRow(id, record) {
  const paper = getPaper(id) || record.paper; const info = publicationInfo(record, paper); const names = (record.collections || []).map(collectionId => library.collections[collectionId]?.name).filter(Boolean);
  return `<article class="library-row" data-library-id="${escapeHtml(id)}"><input class="check" type="checkbox" data-library-select aria-label="选择论文"><div><h3 data-translatable>${escapeHtml(paper.title)}</h3><p data-translatable>${escapeHtml(record.note || paper.abstract || '')}</p><div class="tag-row"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span><span class="tag">进度 ${record.progress || 0}%</span>${record.pdfAttachment ? `<span class="tag published">本地 PDF · ${record.pdfAttachment.pageCount} 页</span>` : ''}${record.pdfAttachment?.annotationCount ? `<span class="tag note">${record.pdfAttachment.annotationCount} 条 PDF 标注</span>` : ''}${record.queueAt ? '<span class="tag">阅读队列</span>' : ''}${record.note ? '<span class="tag note">有笔记</span>' : ''}<span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.label)}</span>${(record.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}${names.map(name => `<span class="tag"># ${escapeHtml(name)}</span>`).join('')}</div></div><div class="paper-actions">${record.pdfAttachment ? '<button data-library-action="pdf">阅读 PDF</button>' : ''}<button data-library-action="compare">对比</button><button data-library-action="open">查看</button><button data-library-action="save" class="${record.savedAt ? 'saved' : ''}">${record.savedAt ? '★' : '☆'}</button></div></article>`;
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
function renderTranslationHistoryPage(route) {
  const q = (route.query.q || '').trim().toLowerCase(); const page = Math.max(1, Number(route.query.page || 1));
  const entries = translationHistory.filter(item => !q || `${item.source} ${item.translation} ${item.context} ${item.provider}`.toLowerCase().includes(q));
  const total = Math.max(1, Math.ceil(entries.length / 15)); const safePage = Math.min(page, total); const pageEntries = entries.slice((safePage - 1) * 15, safePage * 15);
  el('library-list').innerHTML = pageEntries.length ? pageEntries.map(item => `<article class="vocabulary-row" data-translation-history-key="${escapeHtml(item.key)}"><div><h3 data-translatable>${escapeHtml(item.source)}</h3><div class="translation">${escapeHtml(item.translation || '尚无译文')}</div><p>${escapeHtml(item.context || '')}</p><div class="tag-row"><span class="tag">${escapeHtml(item.provider || '本地词典')}</span><span class="tag">${escapeHtml(dateText(item.updatedAt, true))}</span></div></div><div class="paper-actions"><button data-translation-history-action="copy">复制</button><button data-translation-history-action="vocabulary">加入生词</button><button data-translation-history-action="remove" title="删除">×</button></div></article>`).join('') : '<div class="empty">还没有翻译历史。点击单词、术语或框选英文后会自动记录。</div>';
  renderPagination('library-pagination', safePage, total, next => navigate('library/translations', { ...route.query, page: next }));
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
  const entries = Object.entries(library.collections);
  const children = new Map();
  for (const entry of entries) {
    const parent = entry[1].parentId && library.collections[entry[1].parentId] ? entry[1].parentId : '';
    if (!children.has(parent)) children.set(parent, []); children.get(parent).push(entry);
  }
  for (const values of children.values()) values.sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-CN'));
  const ordered = []; const visit = (parentId, depth) => {
    for (const [id, collection] of children.get(parentId) || []) { ordered.push([id, collection, depth]); visit(id, depth + 1); }
  }; visit('', 0);
  const options = ordered.map(([id, collection, depth]) => `<option value="${escapeHtml(id)}">${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(collection.name)}</option>`).join('');
  if (selected !== undefined) { el('collection-filter').innerHTML = `<option value="all">全部专题</option>${options}`; el('collection-filter').value = selected || 'all'; }
  el('paper-collection').innerHTML = `<option value="">选择专题收藏</option>${options}`;
  el('collection-parent').innerHTML = `<option value="">顶层专题</option>${options}`;
}
async function searchLocalPdfLibrary() {
  const query = el('library-pdf-search').value.trim().toLowerCase(); if (query.length < 2) return toast('请输入至少 2 个字符');
  const button = el('library-pdf-search-button'); button.disabled = true; button.textContent = '检索中…'; const matches = new Set();
  try {
    const entries = Object.entries(library.records).filter(([, record]) => record.pdfAttachment);
    for (const [id] of entries) {
      const stored = await getStoredPdf(id).catch(() => null);
      if ((stored?.pages || []).some(text => String(text).toLowerCase().includes(query))) matches.add(id);
    }
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
    if (!target.pdfAttachment && source.pdfAttachment) {
      const stored = await getStoredPdf(sourceId).catch(() => null);
      if (stored) { stored.paperId = targetId; await putStoredPdf(stored); target.pdfAttachment = pdfAttachmentMeta(stored, source.pdfAttachment); }
    }
    await deleteStoredPdf(sourceId).catch(() => {});
    delete library.records[sourceId];
  }
  state.batch = new Set([targetId]); saveLibrary(); renderRoute(); toast(`已合并 ${ids.length} 条重复记录`);
}
function updateBatchCount() { el('batch-count').textContent = `${state.batch.size} 项已选`; }

function renderNewsPage(route) {
  const q = route.query.q || ''; const source = route.query.source || 'all'; const size = Number(route.query.size) === 18 ? 18 : 9; const page = Math.max(1, Number(route.query.page || 1));
  const sources = [...new Set(state.news.items.map(item => item.source))]; el('news-source').innerHTML = `<option value="all">全部来源</option>${sources.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`; el('news-source').value = source; el('news-page-size').value = String(size);
  const items = state.news.items.filter(item => (source === 'all' || item.source === source) && (!q || `${item.title} ${item.summary}`.toLowerCase().includes(q.toLowerCase()))); const pages = Math.max(1, Math.ceil(items.length / size)); const safePage = Math.min(page, pages); const pageItems = items.slice((safePage - 1) * size, safePage * size);
  el('news-result-count').textContent = `${items.length} 条资讯 · 第 ${safePage}/${pages} 页`; el('news-sync').textContent = `更新 ${dateText(state.news.generatedAt, true)}`;
  el('news-list').innerHTML = pageItems.map(item => `<a class="news-card" href="${escapeHtml(safeUrl(item.link))}" target="_blank" rel="noopener"><span class="news-source">${escapeHtml(item.source)} · OFFICIAL</span><h3 data-translatable>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary || '打开官方页面查看详情。')}</p><div class="tag-row"><span class="tag">${escapeHtml(dateText(item.published))}</span></div></a>`).join('') || '<div class="empty">没有匹配资讯。</div>';
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
  el('detail-save').textContent = record?.savedAt ? '★ 已收藏' : '☆ 收藏'; el('detail-queue').textContent = record?.queueAt ? '✓ 已在队列' : '＋ 阅读队列'; el('detail-read').textContent = record?.readAt ? '✓ 已读' : '○ 标为已读'; el('detail-compare').textContent = state.compare.has(paper.id) ? '移出对比' : '加入对比';
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
async function importLibraryFile(file) {
  try { const value = JSON.parse(await file.text()); if (![2, 3].includes(value.version) || !value.records) throw new Error('不是有效的 PaperScope 备份'); if (!confirm(`将导入 ${Object.keys(value.records).length} 条记录并覆盖当前文献库，是否继续？`)) return; localStorage.setItem(value.version === 3 ? STORAGE_KEY : V2_STORAGE_KEY, JSON.stringify(value)); library = migrateLibrary(); saveLibrary(); renderRoute(); toast('导入完成'); } catch (error) { toast(error.message || '导入失败'); }
}

function openPdfDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PDF_STORE_NAME)) request.result.createObjectStore(PDF_STORE_NAME, { keyPath: 'paperId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地 PDF 数据库'));
  });
}
async function pdfStoreOperation(mode, operation) {
  const db = await openPdfDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PDF_STORE_NAME, mode);
      const store = transaction.objectStore(PDF_STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('本地 PDF 存储失败'));
      transaction.onabort = () => reject(transaction.error || new Error('本地 PDF 事务已中止'));
    });
  } finally { db.close(); }
}
const getStoredPdf = paperId => pdfStoreOperation('readonly', store => store.get(paperId));
const putStoredPdf = value => pdfStoreOperation('readwrite', store => store.put(value));
const deleteStoredPdf = paperId => pdfStoreOperation('readwrite', store => store.delete(paperId));

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
  stored.pages ||= Array.from({ length: stored.pageCount || 0 }, () => '');
  stored.annotations ||= [];
  stored.ocrPages ||= {};
  stored.extractionErrors ||= {};
  stored.schemaVersion ||= 2;
  return stored;
}
async function parseAndStorePdf(file, paperId) {
  if (!file || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) throw new Error('请选择 PDF 文件');
  if (file.size > 150 * 1024 * 1024) throw new Error('单个 PDF 不能超过 150 MB');
  const header = new TextDecoder('latin1').decode(await file.slice(0, 5).arrayBuffer());
  if (header !== '%PDF-') throw new Error('文件头不是有效的 PDF');
  const pdfjs = await loadPdfModule();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument(pdfDocumentOptions(bytes));
  configurePdfPassword(loadingTask);
  const pdf = await loadingTask.promise;
  const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
  const pages = []; const extractionErrors = {};
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setPdfProgress(pageNumber / pdf.numPages * 100, `正在提取第 ${pageNumber}/${pdf.numPages} 页`);
    if (paperId === state.selectedPaperId) el('detail-pdf-status').textContent = `正在提取第 ${pageNumber}/${pdf.numPages} 页`;
    const page = await pdf.getPage(pageNumber);
    try { pages.push((await extractPdfPageText(page)).text); }
    catch (error) { pages.push(''); extractionErrors[pageNumber] = error.message || '文本层解析失败'; }
    finally { page.cleanup(); }
  }
  const result = {
    schemaVersion: 2,
    paperId,
    fileName: file.name,
    size: file.size,
    type: 'application/pdf',
    pageCount: pdf.numPages,
    pages,
    annotations: [],
    ocrPages: {},
    extractionErrors,
    metadata: { title: metadata.info?.Title || '', author: metadata.info?.Author || '', subject: metadata.info?.Subject || '' },
    importedAt: new Date().toISOString(),
    blob: file.slice(0, file.size, 'application/pdf')
  };
  await loadingTask.destroy();
  await putStoredPdf(result);
  navigator.storage?.persist?.().catch(() => {});
  return result;
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
    lastPage: Number(previous.lastPage || 1)
  };
}
function renderPdfAttachmentStatus(record) {
  const meta = record?.pdfAttachment;
  el('detail-pdf-status').textContent = meta ? `${meta.fileName} · ${meta.pageCount} 页 · ${meta.textPages} 页有文本 · ${meta.annotationCount || 0} 条标注${meta.ocrPages ? ` · OCR ${meta.ocrPages} 页` : ''}` : '尚未导入 PDF';
  el('detail-pdf-import').textContent = meta ? '替换 PDF' : '导入 PDF';
  for (const id of ['detail-pdf-open', 'detail-pdf-download', 'detail-pdf-remove']) el(id).classList.toggle('hidden', !meta);
}
async function attachPdfToPaper(file, paperId) {
  const paper = getPaper(paperId); if (!paper) return;
  const button = el('detail-pdf-import'); button.disabled = true; button.textContent = '正在解析…';
  try {
    const stored = await parseAndStorePdf(file, paperId);
    const record = ensureRecord(paper);
    record.pdfAttachment = pdfAttachmentMeta(stored, record.pdfAttachment || {});
    record.savedAt ||= new Date().toISOString();
    saveLibrary(); renderPdfAttachmentStatus(record);
    toast(`PDF 已导入：${stored.pageCount} 页，${record.pdfAttachment.textPages} 页可翻译`);
    await openPdfReader(paperId);
  } catch (error) { toast(error.message || 'PDF 导入失败'); }
  finally { button.disabled = false; renderPdfAttachmentStatus(getRecord(paperId)); }
}
async function importStandalonePdf(file) {
  const id = `local:${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
  try {
    toast('正在解析本地 PDF…');
    const stored = await parseAndStorePdf(file, id);
    const rawTitle = stored.metadata.title.trim(); const firstLine = stored.pages.find(Boolean)?.split(/\r?\n/).map(value => value.trim()).find(value => value.length >= 8 && value.length <= 220);
    const title = rawTitle && !/^(untitled|document|unknown)$/i.test(rawTitle) ? rawTitle : firstLine || file.name.replace(/\.pdf$/i, '');
    const rawAuthor = stored.metadata.author.trim();
    const authors = /^(anonymous|unknown)$/i.test(rawAuthor) ? [] : rawAuthor.split(/\s*(?:;|,| and )\s*/i).map(value => value.trim()).filter(Boolean);
    const excerpt = stored.pages.find(Boolean)?.replace(/\s+/g, ' ').slice(0, 1500) || '';
    const doi = excerpt.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[.,;]+$/, '') || null;
    const paper = {
      id, title, abstract: excerpt, authors, published: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString(),
      venue: '本地 PDF', venueName: '本地 PDF', source: '本地导入', kind: 'local', area: 'ai', link: doi ? `https://doi.org/${doi}` : '', doi, citationCount: 0, qualityScore: 0
    };
    const record = ensureRecord(paper);
    record.savedAt = new Date().toISOString();
    record.lastOpenedAt = record.savedAt;
    record.pdfAttachment = pdfAttachmentMeta(stored);
    saveLibrary(); navigate('library/saved'); openPaperRoute(id);
    toast('本地论文已加入文献库');
  } catch (error) {
    await deleteStoredPdf(id).catch(() => {});
    toast(error.message || '本地 PDF 导入失败');
  }
}
async function openPdfReader(paperId) {
  try {
    const stored = storedPdfDefaults(await getStoredPdf(paperId));
    if (!stored?.blob) throw new Error('本地 PDF 文件不存在，可能已被浏览器清理');
    if (state.pdfLoadingTask) await state.pdfLoadingTask.destroy().catch(() => {});
    const pdfjs = await loadPdfModule();
    state.pdfLoadingTask = pdfjs.getDocument(pdfDocumentOptions(new Uint8Array(await stored.blob.arrayBuffer())));
    configurePdfPassword(state.pdfLoadingTask);
    state.pdfDocument = await state.pdfLoadingTask.promise;
    state.pdfRecord = stored; state.pdfPaperId = paperId;
    state.pdfPage = Math.max(1, Math.min(stored.pageCount, Number(getRecord(paperId)?.pdfAttachment?.lastPage || 1)));
    state.pdfScale = Number(el('pdf-zoom').value || 1.4);
    state.pdfAnnotationHistory = []; state.pdfAnnotationMode = null; state.pdfSelection = null;
    state.pdfViewMode = localStorage.getItem(PDF_VIEW_MODE_KEY) === 'paged' ? 'paged' : 'continuous';
    el('pdf-view-mode').value = state.pdfViewMode;
    el('pdf-title').textContent = getPaper(paperId)?.title || stored.fileName;
    el('pdf-meta').textContent = `${stored.fileName} · ${(stored.size / 1024 / 1024).toFixed(1)} MB · 本机存储 · ${stored.annotations.length} 条标注`;
    el('pdf-search-input').value = ''; el('pdf-search-results').classList.add('hidden'); el('pdf-search-results').innerHTML = '';
    el('pdf-modal').classList.add('open');
    updatePdfAnnotationMode();
    await renderPdfPage();
  } catch (error) { toast(error.message || '无法打开 PDF'); }
}
function clearPdfPageObservers() {
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
function updatePdfCurrentPage(pageNumber, { save = true } = {}) {
  if (!state.pdfDocument || !state.pdfRecord) return;
  state.pdfPage = Math.max(1, Math.min(state.pdfDocument.numPages, Number(pageNumber) || 1));
  const text = state.pdfRecord.pages[state.pdfPage - 1] || '';
  el('pdf-page-text').textContent = text || '这一页没有可提取的文本。若它是扫描图片，请点击“OCR 本页”；识别结果会保存在当前浏览器。';
  el('pdf-page-text').classList.toggle('empty', !text);
  el('pdf-page-label').textContent = `${state.pdfPage} / ${state.pdfDocument.numPages}`;
  el('pdf-prev').disabled = state.pdfPage <= 1; el('pdf-next').disabled = state.pdfPage >= state.pdfDocument.numPages;
  const extractionSource = state.pdfRecord.ocrPages?.[state.pdfPage] ? `OCR · ${state.pdfRecord.ocrPages[state.pdfPage].language || '中英'}` : text ? `PDF 文本层 · ${text.length.toLocaleString('zh-CN')} 字符` : state.pdfRecord.extractionErrors?.[state.pdfPage] ? `解析失败：${state.pdfRecord.extractionErrors[state.pdfPage]}` : '未检测到有效文本层，可使用 OCR';
  el('pdf-extraction-report').textContent = extractionSource;
  el('pdf-extraction-report').classList.toggle('warn', !text || Boolean(state.pdfRecord.extractionErrors?.[state.pdfPage]));
  renderPdfAnnotationList();
  const attachment = getRecord(state.pdfPaperId)?.pdfAttachment;
  if (save && attachment && attachment.lastPage !== state.pdfPage) { attachment.lastPage = state.pdfPage; saveLibrary(); }
  setPdfProgress(100, text ? `第 ${state.pdfPage} 页 · ${state.pdfAnnotationMode ? '标注工具已启用' : '可选择文字翻译'}` : `第 ${state.pdfPage} 页 · 未检测到文本层`);
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
  layer.style.setProperty('--scale-factor', state.pdfScale);
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
async function goToPdfPage(pageNumber) {
  if (!state.pdfDocument) return;
  state.pdfPage = Math.max(1, Math.min(state.pdfDocument.numPages, Number(pageNumber) || 1));
  if (state.pdfViewMode === 'continuous') {
    const stack = pdfStackForPage(state.pdfPage);
    if (stack) {
      await renderPdfContinuousStack(stack);
      el('pdf-canvas-stage').scrollTo({ top: Math.max(0, stack.offsetTop - 24), behavior: 'smooth' });
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
  for (const annotation of annotations.filter(item => item.page === pageNumber)) {
    const number = annotations.indexOf(annotation) + 1;
    for (const rect of annotation.rects || []) {
      const mark = document.createElement('button');
      mark.type = 'button'; mark.className = `pdf-annotation-mark ${annotation.type}`;
      mark.dataset.annotationId = annotation.id; mark.dataset.number = String(number);
      mark.title = annotation.comment || annotation.text || `标注 ${number}`;
      mark.style.left = `${rect.x * 100}%`; mark.style.top = `${rect.y * 100}%`; mark.style.width = `${rect.width * 100}%`; mark.style.height = `${rect.height * 100}%`;
      const color = pdfAnnotationColor(annotation.color, annotation.type === 'highlight' ? .34 : .12);
      mark.style.background = color.css; mark.style.borderColor = color.css.replace(/,[\d.]+\)$/, ',1)');
      layer.appendChild(mark);
    }
  }
  layer.classList.toggle('drawing', ['area', 'area-note'].includes(state.pdfAnnotationMode));
}
function annotationTypeLabel(type) { return type === 'highlight' ? '高亮' : type === 'underline' ? '下划线' : type === 'note' ? '批注' : '区域'; }
function renderPdfAnnotationList(selectedId = null) {
  const annotations = currentPdfAnnotations();
  el('pdf-annotation-list').innerHTML = annotations.length ? annotations.map((item, index) => `<article class="pdf-annotation-item ${selectedId === item.id ? 'selected' : ''}" style="border-left-color:${escapeHtml(item.color)}" data-pdf-annotation-id="${escapeHtml(item.id)}"><strong>${index + 1}. 第 ${item.page} 页 · ${annotationTypeLabel(item.type)}</strong>${item.text ? `<p>${escapeHtml(item.text.slice(0, 220))}</p>` : ''}${item.comment ? `<p>批注：${escapeHtml(item.comment)}</p>` : ''}<div class="pdf-annotation-actions"><button data-pdf-annotation-action="goto">定位</button><button data-pdf-annotation-action="comment">编辑批注</button><button data-pdf-annotation-action="delete">删除</button></div></article>`).join('') : '<div class="mono">暂无 PDF 标注。选择页面文字或使用区域工具开始标注。</div>';
}
async function persistPdfRecord() {
  if (!state.pdfRecord) return;
  await putStoredPdf(state.pdfRecord);
  const record = getRecord(state.pdfPaperId);
  if (record) {
    record.pdfAttachment = pdfAttachmentMeta(state.pdfRecord, record.pdfAttachment || {}); saveLibrary();
    if (state.selectedPaperId === state.pdfPaperId) renderPdfAttachmentStatus(record);
  }
  el('pdf-meta').textContent = `${state.pdfRecord.fileName} · ${(state.pdfRecord.size / 1024 / 1024).toFixed(1)} MB · 本机存储 · ${currentPdfAnnotations().length} 条标注`;
}
function pdfSelectionToolType() {
  return ['highlight', 'underline', 'note'].includes(state.pdfAnnotationMode) ? state.pdfAnnotationMode : null;
}
function mergePdfSelectionRects(rects, bounds) {
  const normalized = rects.map(rect => {
    const left = Math.max(bounds.left, rect.left - 1); const right = Math.min(bounds.right, rect.right + 1);
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
async function capturePdfSelection({ applyTool = true } = {}) {
  const selection = window.getSelection(); const pageText = el('pdf-page-text');
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const endElement = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
  const startStack = startElement?.closest?.('[data-pdf-page-stack]'); const endStack = endElement?.closest?.('[data-pdf-page-stack]');
  const inSideText = pageText.contains(startElement) && pageText.contains(endElement);
  if (!startStack && !inSideText) return false;
  if (startStack && startStack !== endStack) { toast('请在同一页内选择文字'); return false; }
  const pageNumber = startStack ? Number(startStack.dataset.page) : state.pdfPage;
  const layer = startStack?.querySelector('.textLayer') || pdfStackForPage(pageNumber)?.querySelector('.textLayer');
  const text = startStack && layer ? precisePdfRangeText(range, layer) : selection.toString().replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const rects = startStack && layer ? precisePdfRangeRects(range, layer) : [];
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
  state.pdfSelection = null; window.getSelection()?.removeAllRanges();
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
  document.querySelectorAll('.pdf-annotation-layer').forEach(layer => layer.classList.toggle('drawing', ['area', 'area-note'].includes(state.pdfAnnotationMode)));
  const labels = { highlight: '高亮工具 H · 拖选后自动保存', underline: '下划线工具 U · 拖选后自动保存', note: '文字批注 N · 拖选后填写批注', area: '区域工具 R · 拖出矩形', 'area-note': '区域批注 Shift+N · 拖出矩形' };
  el('pdf-tool-status').textContent = labels[state.pdfAnnotationMode] || '浏览模式 · 选中文字可翻译';
  clearTimeout(state.translationSelectionTimer);
  if (state.pdfAnnotationMode) closeTranslationPopover();
}
function setPdfAnnotationMode(mode) {
  state.pdfAnnotationMode = state.pdfAnnotationMode === mode ? null : mode;
  state.pdfSelection = null; window.getSelection()?.removeAllRanges();
  updatePdfAnnotationMode();
}
function cancelPdfAnnotationInteraction({ quiet = false } = {}) {
  const hadInteraction = Boolean(state.pdfAnnotationMode || state.pdfAnnotationDraft || state.pdfSelection);
  const draft = state.pdfAnnotationDraft;
  if (draft) {
    try { draft.layer?.releasePointerCapture(draft.pointerId); } catch {}
    draft.draft?.remove(); state.pdfAnnotationDraft = null;
  }
  state.pdfAnnotationMode = null; state.pdfSelection = null; window.getSelection()?.removeAllRanges();
  closeTranslationPopover(); updatePdfAnnotationMode();
  if (hadInteraction && !quiet) toast('已取消当前标注工具');
  return hadInteraction;
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
    state.pdfRecord.extractionErrors = errors; await persistPdfRecord(); await renderPdfPage();
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
  await persistPdfRecord(); if (rerender && state.pdfPage === pageNumber) await renderPdfPage();
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
    state.pdfRecord.annotations.push(...payload.annotations.filter(item => item?.id && item?.page && Array.isArray(item.rects) && !existing.has(item.id)));
    await persistPdfRecord(); renderAllPdfAnnotationLayers(); renderPdfAnnotationList(); toast('PDF 标注已导入');
  } catch (error) { toast(error.message || '标注导入失败'); }
}
function closePdfReader() {
  state.pdfRenderTask?.cancel(); state.pdfRenderTask = null;
  clearPdfPageObservers(); cancelPdfAnnotationInteraction({ quiet: true });
  state.pdfLoadingTask?.destroy().catch(() => {});
  state.pdfLoadingTask = null; state.pdfDocument = null; state.pdfRecord = null; state.pdfPaperId = null; state.pdfTextContent = null; state.pdfSelection = null; state.pdfAnnotationMode = null;
}
function searchPdfText() {
  const query = el('pdf-search-input').value.trim().toLowerCase();
  const container = el('pdf-search-results');
  if (!query) { container.classList.add('hidden'); container.innerHTML = ''; return; }
  const matches = (state.pdfRecord?.pages || []).map((text, index) => ({ text, page: index + 1, position: text.toLowerCase().indexOf(query) })).filter(item => item.position >= 0).slice(0, 40);
  container.innerHTML = matches.length ? matches.map(item => {
    const start = Math.max(0, item.position - 60); const excerpt = item.text.slice(start, item.position + query.length + 100).replace(/\s+/g, ' ');
    return `<button data-pdf-page="${item.page}"><b>第 ${item.page} 页</b><br>${escapeHtml(excerpt)}</button>`;
  }).join('') : '<div class="panel-note">全文中没有找到该关键词。</div>';
  container.classList.remove('hidden');
}
async function removeAttachedPdf(paperId) {
  if (!confirm('移除本机保存的 PDF？收藏、笔记和论文元数据会保留。')) return;
  await deleteStoredPdf(paperId);
  const record = getRecord(paperId); if (record) record.pdfAttachment = null;
  saveLibrary(); renderPdfAttachmentStatus(record); toast('本地 PDF 已移除');
}
async function downloadAttachedPdf(paperId) {
  const stored = await getStoredPdf(paperId); if (!stored?.blob) return toast('本地 PDF 文件不存在');
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
  { label: '顶会期刊精选', hint: 'Quality-first & Daily', route: 'curated' }, { label: '个人文献库', hint: 'Saved & Notes', route: 'library/saved' }, { label: '研究资讯', hint: 'Official News', route: 'news' }, { label: '会议与期刊', hint: 'Venues', route: 'venues' }
];
function renderCommands(query = '') {
  const normalized = query.toLowerCase(); const pages = COMMAND_PAGES.filter(item => !normalized || `${item.label} ${item.hint}`.toLowerCase().includes(normalized)); const papers = normalized ? allPapers().filter(paper => `${paper.title} ${(paper.authors || []).join(' ')}`.toLowerCase().includes(normalized)).slice(0, 8) : [];
  el('command-list').innerHTML = `${pages.map(item => `<button class="command-item" data-command-route="${item.route}"><span>${item.label}</span><small>${item.hint}</small></button>`).join('')}${papers.map(paper => `<button class="command-item" data-command-paper="${escapeHtml(paper.id)}"><span>${escapeHtml(paper.title)}</span><small>${paper.area === 'architecture' ? '体系结构' : 'AI'}</small></button>`).join('')}` || '<div class="empty">没有匹配结果</div>';
}
function openCommand(query = '') { el('command-modal').classList.add('open'); el('command-input').value = query; renderCommands(query); setTimeout(() => el('command-input').focus(), 0); }
function closeModal(id) {
  el(id).classList.remove('open');
  if (id === 'pdf-modal') closePdfReader();
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
function syncLibraryPapers() { for (const paper of allPapers()) { const record = getRecord(paper.id); if (record) { record.paper = snapshotPaper(paper); if (paper.publication?.status === 'published') record.publication = paper.publication; } } saveLibrary(); }
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
  el('translation-selection').checked = translationSettings.selection;
  el('translation-position-mode').value = translationSettings.positionMode;
  el('translation-endpoint').value = translationSettings.onlineEndpoint || '';
  el('translation-cache').checked = translationSettings.cache;
  el('translation-mode').disabled = !translationSettings.enabled;
  el('translation-word-click').disabled = !translationSettings.enabled;
  el('translation-selection').disabled = !translationSettings.enabled;
  el('translation-position-mode').disabled = !translationSettings.enabled;
  el('translation-endpoint').disabled = !translationSettings.enabled;
  el('translation-cache').disabled = !translationSettings.enabled;
  if (!translationSettings.enabled) closeTranslationPopover();
  syncTranslationPinButton();
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
  translationCache = Object.fromEntries(Object.entries(translationCache).sort(([, a], [, b]) => new Date(b.usedAt) - new Date(a.usedAt)).slice(0, 500));
  try { localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(translationCache)); } catch {}
}
function rememberTranslation(payload) {
  if (!payload?.source) return;
  const key = translationCacheKey(payload.source);
  translationHistory = [
    {
      key, source: payload.source, translation: payload.translation || '', context: payload.context || '',
      provider: payload.provider || '离线词典', paperId: payload.paperId || null, updatedAt: new Date().toISOString()
    },
    ...translationHistory.filter(item => item.key !== key)
  ].slice(0, 200);
  try { localStorage.setItem(TRANSLATION_HISTORY_KEY, JSON.stringify(translationHistory)); } catch {}
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
  translationSettings.position = null; translationSettings.positionMode = 'follow'; saveTranslationSettings();
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
    saveTranslationPosition(box.left, box.top); toast('翻译框位置已固定');
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
  el('translation-online').disabled = translationSettings.mode === 'offline' || !safeTranslationEndpoint() || !state.translationPayload?.source;
  el('translation-speak').disabled = !('speechSynthesis' in window) || !state.translationPayload?.source;
}
function resetTranslationResultUi() {
  el('translation-result').textContent = '';
  el('translation-state').textContent = '正在查询离线词典…';
  el('translation-dictionary-section').classList.add('hidden');
  el('translation-alternatives-section').classList.add('hidden');
  el('translation-context-section').classList.add('hidden');
  el('translation-dictionary').innerHTML = ''; el('translation-alternatives').innerHTML = '';
}
function applyTranslationResult(result, sourceLabel) {
  const payload = state.translationPayload; if (!payload || !result?.translation) return;
  payload.translation = normalizedTranslationText(result.translation);
  payload.provider = result.provider || sourceLabel || '本地翻译';
  payload.alternatives = (result.alternatives || []).filter(Boolean).filter(item => item !== payload.translation).slice(0, 5);
  el('translation-result').textContent = payload.translation;
  el('translation-state').textContent = sourceLabel || payload.provider;
  el('translation-provider').textContent = payload.provider;
  if (payload.alternatives.length) {
    el('translation-alternatives').innerHTML = payload.alternatives.map(value => `<button data-translation-alternative="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('');
    el('translation-alternatives-section').classList.remove('hidden');
  }
  setTranslationActions(true); rememberTranslation(payload);
}
async function requestOnlineTranslation(payload = state.translationPayload) {
  const endpoint = safeTranslationEndpoint();
  if (!endpoint) throw new Error('请先在翻译设置中填写 HTTPS 在线代理地址');
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
async function translateCurrentOnline() {
  const payload = state.translationPayload; if (!payload) return;
  const requestId = ++state.translationRequestId;
  el('translation-state').textContent = '正在进行在线精译…'; el('translation-online').disabled = true;
  try {
    const result = await requestOnlineTranslation(payload);
    if (requestId !== state.translationRequestId) return;
    applyTranslationResult(result, `在线精译 · ${result.provider || '安全代理'}`);
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
  resetTranslationResultUi();
  if (context && context !== source) {
    el('translation-context').textContent = context; el('translation-context-section').classList.remove('hidden');
  }
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
  if (translationSettings.mode === 'online' && safeTranslationEndpoint()) {
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
  const text = normalizedTranslationText(root.classList.contains('textLayer') ? precisePdfRangeText(range, root) : selection.toString());
  if (!/[A-Za-z]/.test(text)) return null;
  return { text, root, rect: range.getBoundingClientRect() };
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
  const payload = state.translationPayload; if (!payload?.source || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(payload.source); utterance.lang = 'en-US'; speechSynthesis.speak(utterance);
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
  if (!endpoint) return toast('请输入有效的 HTTPS Worker 地址');
  translationSettings.onlineEndpoint = endpoint; saveTranslationSettings();
  const button = el('translation-test-endpoint'); button.disabled = true;
  try {
    const result = await requestOnlineTranslation({ source: 'memory hierarchy', context: 'The memory hierarchy reduces average data access latency.' });
    toast(`在线代理可用：${result.provider || result.translation}`);
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
      if (!safeTranslationEndpoint()) throw new Error('请先在翻译设置中配置在线精译代理');
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
  const routeButton = event.target.closest('[data-route]'); if (routeButton) return navigate(routeButton.dataset.route);
  const open = event.target.closest('[data-open-paper]'); if (open) return openPaperRoute(open.dataset.openPaper);
  const compare = event.target.closest('[data-compare]'); if (compare) return toggleCompare(compare.dataset.compare);
  const venueSave = event.target.closest('[data-venue-save]'); if (venueSave) return toggleVenueSave(venueSave.dataset.venueSave);
  const curatedVenue = event.target.closest('[data-curated-venue]'); if (curatedVenue) return navigate('curated', { venue: curatedVenue.dataset.curatedVenue });
  const close = event.target.closest('[data-close-modal]'); if (close) return closeModal(close.dataset.closeModal);
});
document.addEventListener('click', event => {
  if (event.target.closest('#translation-popover')) return;
  const root = event.target.closest('[data-translatable]');
  if (root?.closest('#pdf-modal') && state.pdfAnnotationMode) return;
  if (!translationSettings.enabled || !translationSettings.wordClick || !root || event.detail > 1 || event.target.closest('a,button,input,textarea,select,label,[contenteditable="true"]')) {
    if (!root && el('translation-popover').classList.contains('open')) closeTranslationPopover();
    return;
  }
  const selection = window.getSelection(); if (selection && !selection.isCollapsed && normalizedTranslationText(selection.toString())) return;
  const word = wordAtPoint(event.clientX, event.clientY, root); if (word) showTranslation(word.text, word.rect, root, 'word');
});
document.addEventListener('selectionchange', () => {
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
  const historyRow = event.target.closest('[data-translation-history-key]');
  if (historyRow) {
    const key = historyRow.dataset.translationHistoryKey; const item = translationHistory.find(entry => entry.key === key);
    const action = event.target.closest('[data-translation-history-action]')?.dataset.translationHistoryAction;
    if (action === 'copy' && item) copyText(`${item.source}\n${item.translation}`, '翻译已复制');
    else if (action === 'vocabulary' && item) {
      const id = vocabularyId(item.paperId, item.source); const previous = library.vocabulary[id];
      library.vocabulary[id] = { id, ...item, lookups: Number(previous?.lookups || 0) + 1, mastery: Number(previous?.mastery || 0), createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      saveLibrary(); toast(previous ? '生词条目已更新' : '已加入生词本');
    } else if (action === 'remove') {
      translationHistory = translationHistory.filter(entry => entry.key !== key);
      try { localStorage.setItem(TRANSLATION_HISTORY_KEY, JSON.stringify(translationHistory)); } catch {}
      renderRoute(); toast('翻译历史已删除');
    }
    return;
  }
  const row = event.target.closest('[data-library-id]'); if (!row) return; const id = row.dataset.libraryId; const action = event.target.closest('[data-library-action]')?.dataset.libraryAction;
  if (action === 'open') openPaperRoute(id); else if (action === 'pdf') openPdfReader(id); else if (action === 'save') toggleRecordField(id, 'saved'); else if (action === 'compare') toggleCompare(id);
});
el('library-list').addEventListener('change', event => { if (!event.target.matches('[data-library-select]')) return; const id = event.target.closest('[data-library-id]').dataset.libraryId; event.target.checked ? state.batch.add(id) : state.batch.delete(id); updateBatchCount(); });
el('library-select-all').addEventListener('change', event => { document.querySelectorAll('[data-library-select]').forEach(input => { input.checked = event.target.checked; const id = input.closest('[data-library-id]').dataset.libraryId; event.target.checked ? state.batch.add(id) : state.batch.delete(id); }); updateBatchCount(); });
el('batch-read').addEventListener('click', () => { for (const id of state.batch) { const record = ensureRecord(getPaper(id)); record.readAt ||= new Date().toISOString(); record.progress = 100; } saveLibrary(); renderRoute(); toast('已批量标记为已读'); });
el('batch-queue').addEventListener('click', () => { for (const id of state.batch) ensureRecord(getPaper(id)).queueAt ||= new Date().toISOString(); saveLibrary(); renderRoute(); toast('已加入阅读队列'); });
el('batch-citations').addEventListener('click', () => { if (!state.batch.size) return toast('请先选择论文'); downloadText('paperscope-citations.bib', [...state.batch].map(id => bibtexFor(getPaper(id))).join('\n\n')); });
el('merge-duplicates').addEventListener('click', mergeSelectedDuplicates);
el('check-publications').addEventListener('click', async () => { const ids = state.batch.size ? [...state.batch] : Object.entries(library.records).filter(([, record]) => record.savedAt).map(([id]) => id).slice(0, 30); if (!ids.length) return toast('请先收藏或选择论文'); const button = el('check-publications'); button.disabled = true; for (let index = 0; index < ids.length; index += 1) { button.textContent = `${index + 1}/${ids.length}`; await checkPublication(ids[index], true); if (index < ids.length - 1) await new Promise(resolve => setTimeout(resolve, 280)); } button.disabled = false; button.textContent = '检查中刊状态'; renderRoute(); toast('发表状态检查完成'); });
el('collection-filter').addEventListener('change', event => { const route = parseRoute(); navigate('library/collections', { ...route.query, collection: event.target.value, page: 1 }); });
el('create-collection').addEventListener('click', () => { const name = el('new-collection-name').value.trim(); if (!name) return toast('请输入专题名称'); const id = `${slug(name)}-${Date.now().toString(36)}`; library.collections[id] = { name, parentId: el('collection-parent').value || null, createdAt: new Date().toISOString() }; saveLibrary(); el('new-collection-name').value = ''; renderRoute(); toast('专题已创建'); });
el('rename-collection').addEventListener('click', () => { const id = el('collection-filter').value; if (!library.collections[id]) return toast('请先选择一个专题'); const name = prompt('新的专题名称：', library.collections[id].name); if (!name?.trim()) return; library.collections[id].name = name.trim(); saveLibrary(); renderRoute(); toast('专题已重命名'); });
el('delete-collection').addEventListener('click', () => { const id = el('collection-filter').value; if (!library.collections[id]) return toast('请先选择一个专题'); if (!confirm(`删除专题“${library.collections[id].name}”？论文不会被删除。`)) return; for (const record of Object.values(library.records)) record.collections = (record.collections || []).filter(value => value !== id); for (const collection of Object.values(library.collections)) if (collection.parentId === id) collection.parentId = null; delete library.collections[id]; saveLibrary(); navigate('library/collections'); toast('专题已删除'); });
el('smart-filter').addEventListener('change', event => navigate('library/smart', { smart: event.target.value, page: 1 }));
el('library-pdf-search-button').addEventListener('click', searchLocalPdfLibrary);
el('library-pdf-search').addEventListener('keydown', event => { if (event.key === 'Enter') searchLocalPdfLibrary(); });
el('export-vocabulary').addEventListener('click', exportVocabulary); el('export-library').addEventListener('click', exportLibrary); el('import-library').addEventListener('click', () => el('import-file').click()); el('import-file').addEventListener('change', event => { const [file] = event.target.files; if (file) importLibraryFile(file); event.target.value = ''; });
el('import-local-pdf').addEventListener('click', () => el('local-pdf-file').click());
el('local-pdf-file').addEventListener('change', async event => { const [file] = event.target.files; if (file) await importStandalonePdf(file); event.target.value = ''; });

['news-source', 'news-page-size'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('news', { ...route.query, source: el('news-source').value, size: el('news-page-size').value, page: 1 }); }));
['venue-area', 'venue-type', 'venue-status', 'venue-sort'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('venues', { ...route.query, area: el('venue-area').value, type: el('venue-type').value, status: el('venue-status').value, sort: el('venue-sort').value, page: 1 }); }));
el('venue-list').addEventListener('click', event => { const row = event.target.closest('[data-venue-name]'); const action = event.target.closest('[data-venue-action]')?.dataset.venueAction; if (!row || !action) return; const venue = state.venues.venues.find(item => item.name === row.dataset.venueName); if (action === 'save') toggleVenueSave(venue.name); else if (action === 'ics') downloadIcs(venue); });

el('drawer-close').addEventListener('click', () => closeDrawer()); el('drawer-overlay').addEventListener('click', () => closeDrawer()); el('detail-save').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'saved')); el('detail-queue').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'queue')); el('detail-read').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'read')); el('detail-compare').addEventListener('click', () => toggleCompare(state.selectedPaperId));
el('detail-publication').addEventListener('click', async () => { el('detail-publication').disabled = true; el('detail-publication-status').textContent = '查询 Crossref…'; await checkPublication(state.selectedPaperId); el('detail-publication').disabled = false; });
el('copy-bibtex').addEventListener('click', () => copyText(bibtexFor(getPaper(state.selectedPaperId)), 'BibTeX 已复制')); el('copy-markdown').addEventListener('click', () => copyText(markdownFor(getPaper(state.selectedPaperId)), 'Markdown 引用已复制'));
el('detail-edit-metadata').addEventListener('click', openMetadataEditor); el('save-metadata').addEventListener('click', saveMetadataEditor);
el('detail-bilingual').addEventListener('click', translatePaperAbstract);
el('detail-pdf-import').addEventListener('click', () => el('detail-pdf-file').click());
el('detail-pdf-file').addEventListener('change', async event => { const [file] = event.target.files; if (file) await attachPdfToPaper(file, state.selectedPaperId); event.target.value = ''; });
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
el('pdf-zoom').addEventListener('change', async event => { state.pdfScale = Number(event.target.value); await renderPdfPage(); });
el('pdf-search-button').addEventListener('click', searchPdfText);
el('pdf-search-input').addEventListener('keydown', event => { if (event.key === 'Enter') searchPdfText(); });
el('pdf-search-results').addEventListener('click', event => { const button = event.target.closest('[data-pdf-page]'); if (button) goToPdfPage(Number(button.dataset.pdfPage)); });
el('pdf-copy-page').addEventListener('click', () => copyText(state.pdfRecord?.pages?.[state.pdfPage - 1] || '', '本页文本已复制'));
el('pdf-reparse').addEventListener('click', reparsePdfText);
el('pdf-ocr-page').addEventListener('click', ocrCurrentPdfPage);
el('pdf-ocr-missing').addEventListener('click', ocrMissingPdfPages);
document.querySelectorAll('[data-pdf-tool]').forEach(button => button.addEventListener('click', () => setPdfAnnotationMode(button.dataset.pdfTool)));
el('pdf-cancel-annotation').addEventListener('click', () => cancelPdfAnnotationInteraction());
el('pdf-undo-annotation').addEventListener('click', undoPdfAnnotation);
el('pdf-export-annotated').addEventListener('click', exportAnnotatedPdf);
el('pdf-export-annotations').addEventListener('click', exportPdfAnnotations);
el('pdf-import-annotations').addEventListener('click', () => el('pdf-annotations-file').click());
el('pdf-annotations-file').addEventListener('change', async event => { const [file] = event.target.files; if (file) await importPdfAnnotationsFile(file); event.target.value = ''; });
el('pdf-pages-container').addEventListener('mouseup', event => {
  if (!event.target.closest('.textLayer')) return;
  setTimeout(() => capturePdfSelection({ applyTool: true }));
});
el('pdf-page-text').addEventListener('mouseup', () => setTimeout(() => capturePdfSelection({ applyTool: true })));
el('pdf-canvas-stage').addEventListener('pointerdown', event => {
  const layer = event.target.closest('.pdf-annotation-layer'); if (!layer) return;
  const mark = event.target.closest('[data-annotation-id]');
  if (mark) {
    const pageNumber = Number(layer.closest('[data-pdf-page-stack]')?.dataset.page);
    if (pageNumber) updatePdfCurrentPage(pageNumber);
    renderPdfAnnotationList(mark.dataset.annotationId); return;
  }
  if (!['area', 'area-note'].includes(state.pdfAnnotationMode)) return;
  const stack = layer.closest('[data-pdf-page-stack]'); const pageNumber = Number(stack?.dataset.page);
  if (!pageNumber) return;
  updatePdfCurrentPage(pageNumber);
  const bounds = layer.getBoundingClientRect();
  const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)); const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
  const draft = document.createElement('div'); draft.className = 'pdf-annotation-draft'; draft.style.left = `${x}px`; draft.style.top = `${y}px`; layer.appendChild(draft);
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
  if (width < 8 || height < 8) return toast('请拖出一个更大的标注区域');
  state.pdfPage = value.pageNumber;
  await addPdfAreaAnnotation(value.mode, { x: Math.min(value.x, x) / value.bounds.width, y: Math.min(value.y, y) / value.bounds.height, width: width / value.bounds.width, height: height / value.bounds.height });
});
el('pdf-annotation-list').addEventListener('click', async event => {
  const item = event.target.closest('[data-pdf-annotation-id]'); if (!item) return; const id = item.dataset.pdfAnnotationId;
  const annotation = currentPdfAnnotations().find(value => value.id === id); const action = event.target.closest('[data-pdf-annotation-action]')?.dataset.pdfAnnotationAction;
  if (!annotation) return;
  if (action === 'goto') { await goToPdfPage(annotation.page); renderPdfAnnotationList(id); }
  else if (action === 'comment') { const comment = prompt('编辑批注：', annotation.comment || ''); if (comment !== null) { annotation.comment = comment.trim(); annotation.updatedAt = new Date().toISOString(); await persistPdfRecord(); renderPdfAnnotationList(id); } }
  else if (action === 'delete' && confirm('删除这条 PDF 标注？')) { state.pdfRecord.annotations = currentPdfAnnotations().filter(value => value.id !== id); await persistPdfRecord(); renderPdfAnnotationLayerForPage(annotation.page); renderPdfAnnotationList(); }
});
el('save-note').addEventListener('click', () => { const record = ensureRecord(getPaper(state.selectedPaperId)); record.note = el('paper-note').value.trim(); record.tags = [...new Set(el('paper-tags').value.split(/[,，]/).map(value => value.trim()).filter(Boolean))].slice(0, 12); record.progress = Number(el('reading-progress').value); if (record.progress === 100) record.readAt ||= new Date().toISOString(); saveLibrary(); toast('阅读记录已保存'); });
el('add-to-collection').addEventListener('click', () => { const collectionId = el('paper-collection').value; if (!collectionId) return toast('请先选择专题'); const record = ensureRecord(getPaper(state.selectedPaperId)); if (!record.collections.includes(collectionId)) record.collections.push(collectionId); saveLibrary(); toast('已加入专题收藏'); });
el('add-highlight').addEventListener('click', () => { const selection = window.getSelection(); const text = selection?.toString().replace(/\s+/g, ' ').trim(); const anchor = selection?.anchorNode; if (!text || text.length < 3) return toast('请先选中摘要文字'); if (text.length > 500) return toast('单条标注最多 500 字符'); if (!anchor || !el('detail-abstract').contains(anchor.nodeType === Node.TEXT_NODE ? anchor.parentNode : anchor)) return toast('只能标注摘要文字'); const record = ensureRecord(getPaper(state.selectedPaperId)); if (record.highlights.some(item => item.text === text)) return toast('这段文字已经标注'); record.highlights.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), text, color: el('highlight-color').value, createdAt: new Date().toISOString() }); saveLibrary(); selection.removeAllRanges(); renderHighlights(); toast('标注已保存'); });
el('highlight-list').addEventListener('click', event => { const button = event.target.closest('[data-highlight-remove]'); if (!button) return; const record = getRecord(state.selectedPaperId); record.highlights = record.highlights.filter(item => item.id !== button.dataset.highlightRemove); saveLibrary(); renderHighlights(); });
el('previous-paper').addEventListener('click', () => moveDetail(-1)); el('next-paper').addEventListener('click', () => moveDetail(1));

el('open-compare').addEventListener('click', renderCompare); el('clear-compare').addEventListener('click', () => { state.compare.clear(); updateCompareTray(); renderCurrentView(); }); el('compare-table').addEventListener('click', event => { const button = event.target.closest('[data-compare-remove]'); if (button) { state.compare.delete(button.dataset.compareRemove); updateCompareTray(); renderCompare(); } });
el('command-open').addEventListener('click', () => openCommand()); el('command-input').addEventListener('input', event => renderCommands(event.target.value)); el('command-list').addEventListener('click', event => { const route = event.target.closest('[data-command-route]')?.dataset.commandRoute; const paper = event.target.closest('[data-command-paper]')?.dataset.commandPaper; closeModal('command-modal'); if (route) navigate(route); else if (paper) openPaperRoute(paper); });
el('translation-open').addEventListener('click', openTranslationSettings);
el('translation-enabled').addEventListener('change', event => { translationSettings.enabled = event.target.checked; saveTranslationSettings(); if (translationSettings.enabled) detectTranslationCapability(); });
el('translation-mode').addEventListener('change', event => { translationSettings.mode = event.target.value; saveTranslationSettings(); });
el('translation-word-click').addEventListener('change', event => { translationSettings.wordClick = event.target.checked; saveTranslationSettings(); });
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
  translationCache = {}; translationHistory = [];
  localStorage.removeItem(TRANSLATION_CACHE_KEY); localStorage.removeItem(TRANSLATION_HISTORY_KEY);
  toast('翻译缓存与查询历史已清除');
});
el('translation-open-vocabulary').addEventListener('click', () => { closeModal('translation-modal'); navigate('library/vocabulary'); });
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
  setTranslationActions(true); rememberTranslation(state.translationPayload); toast('已切换为该译法');
});
el('update-now').addEventListener('click', () => {
  const waiting = state.serviceWorkerRegistration?.waiting;
  if (!waiting) return location.reload();
  state.updateReloading = true; waiting.postMessage({ type: 'SKIP_WAITING' });
});
el('update-later').addEventListener('click', () => el('update-banner').classList.remove('show'));
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); }));
document.addEventListener('keydown', event => {
  const target = event.target; const editing = target?.matches?.('input,textarea,select,[contenteditable="true"]');
  const pdfOpen = el('pdf-modal').classList.contains('open');
  if (pdfOpen && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !editing) {
    event.preventDefault(); undoPdfAnnotation(); return;
  }
  if (pdfOpen && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const key = event.key.toLowerCase();
    const tool = event.shiftKey && key === 'n' ? 'area-note' : ({ h: 'highlight', u: 'underline', n: 'note', r: 'area' })[key];
    if (tool) { event.preventDefault(); setPdfAnnotationMode(tool); return; }
    if (event.key === 'PageUp' && state.pdfPage > 1) { event.preventDefault(); goToPdfPage(state.pdfPage - 1); return; }
    if (event.key === 'PageDown' && state.pdfDocument && state.pdfPage < state.pdfDocument.numPages) { event.preventDefault(); goToPdfPage(state.pdfPage + 1); return; }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommand(); return; }
  if (event.key === 'Escape') {
    if (pdfOpen) {
      const translationWasOpen = el('translation-popover').classList.contains('open');
      if (cancelPdfAnnotationInteraction() || translationWasOpen) { event.preventDefault(); return; }
      closeModal('pdf-modal'); return;
    }
    closeTranslationPopover(); document.querySelectorAll('.modal.open').forEach(node => closeModal(node.id));
    if (el('paper-drawer').classList.contains('open')) closeDrawer();
  }
});

el('edit-profile').addEventListener('click', () => el('profile-modal').classList.add('open')); el('save-profile').addEventListener('click', () => { library.profile.name = el('profile-name').value.trim() || '研究者'; library.profile.focus = el('profile-focus').value.trim(); library.profile.bio = el('profile-bio').value.trim(); saveLibrary(); renderProfile(); closeModal('profile-modal'); toast('个人资料已保存'); });
function applyTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem(THEME_KEY, theme); el('theme-toggle').textContent = theme === 'dark' ? '☀' : '◐'; }
el('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
window.addEventListener('scroll', () => el('backtop').classList.toggle('show', window.scrollY > 500)); el('backtop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('hashchange', renderRoute); window.addEventListener('resize', () => {
  if (translationSettings.positionMode !== 'pinned' || !translationSettings.position) return;
  translationSettings.position = clampedTranslationPosition(translationSettings.position.left, translationSettings.position.top);
  if (el('translation-popover').classList.contains('open')) positionTranslationPopover(state.translationPayload?.rect || { left: 20, top: 20, bottom: 21, width: 1, height: 1 });
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; el('install-app').classList.add('show'); }); el('install-app').addEventListener('click', async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; el('install-app').classList.remove('show'); }); window.addEventListener('appinstalled', () => toast('PaperScope 已安装'));

applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); applyTranslationSettings(); setupTranslationDragging(); loadDomainDictionary().catch(() => {}); detectTranslationCapability(); renderProfile(); renderCollectionOptions('all'); if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/home'); registerAppServiceWorker(); loadData();

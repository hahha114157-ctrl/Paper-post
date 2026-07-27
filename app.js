const APP_VERSION = '6.0.1';
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
function getPaper(id) { return allPapers().find(item => item.id === id) || library.records[id]?.paper || null; }
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
    publication: old.publication || paper.publication || null, abstractTranslation: old.abstractTranslation || null
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
  el(target).innerHTML = papers.slice(0, 6).map(paper => `<article class="preview-paper"><button data-open-paper="${escapeHtml(paper.id)}"><h4>${escapeHtml(paper.title)}</h4><p>${escapeHtml(paperDateText(paper))} · ${escapeHtml(paper.venueName || paper.venue || paper.source)}${paper.qualityScore ? ` · 推荐 ${paper.qualityScore}` : ''}</p></button><button class="small" data-compare="${escapeHtml(paper.id)}" title="加入对比">＋</button></article>`).join('');
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
  return `<article class="paper-row ${record?.readAt ? 'read' : ''}" data-paper-id="${escapeHtml(paper.id)}"><input class="check" type="checkbox" data-action="compare" aria-label="加入对比" ${checked ? 'checked' : ''}><span class="paper-index">${String(index).padStart(2, '0')}</span><div class="paper-main"><button class="paper-title" data-action="open"><h3>${escapeHtml(paper.title)}</h3></button><p data-translatable>${escapeHtml(paper.abstract)}</p><div class="tag-row"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span>${paper.quality?.tier ? `<span class="tag quality-badge">${escapeHtml(paper.quality.tier)} · ${paper.qualityScore}</span>` : ''}<span class="tag venue-badge">${escapeHtml(`${paper.venueName || paper.venue || paper.source}${paper.venueYear ? ` ${paper.venueYear}` : ''}`)}</span><span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.status === 'published' ? '正式收录' : '预印本')}</span><span class="tag">${escapeHtml(paperDateText(paper))}</span>${record?.note ? '<span class="tag note">有笔记</span>' : ''}${paperTopics(paper).map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div></div><div class="paper-actions"><button data-action="read" class="${record?.readAt ? 'active' : ''}" title="已读">✓</button><button data-action="queue" class="${record?.queueAt ? 'active' : ''}" title="阅读队列">＋</button><button data-action="save" class="${record?.savedAt ? 'saved' : ''}" title="收藏">${record?.savedAt ? '★' : '☆'}</button></div></article>`;
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
  el('curated-sections').innerHTML = filtered.map(section => `<section class="curated-section"><div class="curated-section-head"><div class="eyebrow">${escapeHtml(`${section.type} · ${section.year}`)}</div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.subtitle)}</p><a href="${escapeHtml(safeUrl(section.officialUrl))}" target="_blank" rel="noopener">${escapeHtml(section.source)} ↗</a></div>${section.papers.slice(0, 8).map(paper => `<article class="preview-paper"><button data-open-paper="${escapeHtml(paper.id)}"><h4>${escapeHtml(paper.title)}</h4><p>推荐 ${paper.qualityScore || '—'} · ${escapeHtml(paper.track || paperDateText(paper))}</p></button><button class="small" data-compare="${escapeHtml(paper.id)}">＋</button></article>`).join('')}<div class="card-head"><button class="small" data-curated-venue="${escapeHtml(section.venue)}">只看此专栏</button><span class="mono">${section.papers.length} PAPERS</span></div></section>`).join('') || '<div class="empty">没有符合当前条件的正式收录专栏。</div>';
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
function libraryRecords(tab, collectionId, q) {
  return Object.entries(library.records).filter(([, record]) => record?.paper).filter(([, record]) => {
    if (q && !`${record.paper.title} ${record.note} ${(record.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === 'saved') return Boolean(record.savedAt);
    if (tab === 'queue') return Boolean(record.queueAt);
    if (tab === 'recent') return Boolean(record.lastOpenedAt);
    if (tab === 'notes') return Boolean(record.note || record.highlights?.length);
    if (tab === 'published') return Boolean(record.savedAt && publicationInfo(record, record.paper).status === 'published');
    if (tab === 'collections') return collectionId && collectionId !== 'all' ? record.collections?.includes(collectionId) : Boolean(record.collections?.length);
    return true;
  }).sort(([, a], [, b]) => new Date(b.queueAt || b.savedAt || b.lastOpenedAt || b.readAt || 0) - new Date(a.queueAt || a.savedAt || a.lastOpenedAt || a.readAt || 0));
}
function renderLibraryPage(route) {
  renderProfile(); const tab = route.parts[1] || 'saved'; const q = route.query.q || ''; const collectionId = route.query.collection || 'all'; const page = Math.max(1, Number(route.query.page || 1));
  const stats = libraryStats(); for (const [name, value] of Object.entries(stats)) el(`stat-${name}`).textContent = value;
  document.querySelectorAll('#library-tabs [data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  el('library-batchbar').classList.toggle('hidden', ['vocabulary', 'translations'].includes(tab));
  el('collection-tools').classList.toggle('hidden', tab !== 'collections'); renderCollectionOptions(collectionId);
  if (tab === 'vocabulary') return renderVocabularyPage(route);
  if (tab === 'translations') return renderTranslationHistoryPage(route);
  const records = libraryRecords(tab, collectionId, q); const total = Math.max(1, Math.ceil(records.length / 10)); const safePage = Math.min(page, total); const pageRecords = records.slice((safePage - 1) * 10, safePage * 10);
  state.batch.clear(); updateBatchCount(); el('library-select-all').checked = false;
  el('library-list').innerHTML = pageRecords.length ? pageRecords.map(([id, record]) => libraryRow(id, record)).join('') : '<div class="empty">当前分类还没有论文。</div>';
  renderPagination('library-pagination', safePage, total, next => navigate(`library/${tab}`, { ...route.query, page: next }));
}
function libraryRow(id, record) {
  const info = publicationInfo(record, record.paper); const names = (record.collections || []).map(collectionId => library.collections[collectionId]?.name).filter(Boolean);
  return `<article class="library-row" data-library-id="${escapeHtml(id)}"><input class="check" type="checkbox" data-library-select aria-label="选择论文"><div><h3>${escapeHtml(record.paper.title)}</h3><p data-translatable>${escapeHtml(record.note || record.paper.abstract || '')}</p><div class="tag-row"><span class="tag ${record.paper.area === 'architecture' ? 'arch' : ''}">${record.paper.area === 'architecture' ? '体系结构' : 'AI'}</span><span class="tag">进度 ${record.progress || 0}%</span>${record.queueAt ? '<span class="tag">阅读队列</span>' : ''}${record.note ? '<span class="tag note">有笔记</span>' : ''}<span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.label)}</span>${names.map(name => `<span class="tag"># ${escapeHtml(name)}</span>`).join('')}</div></div><div class="paper-actions"><button data-library-action="compare">对比</button><button data-library-action="open">查看</button><button data-library-action="save" class="${record.savedAt ? 'saved' : ''}">${record.savedAt ? '★' : '☆'}</button></div></article>`;
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
  const options = Object.entries(library.collections).map(([id, collection]) => `<option value="${escapeHtml(id)}">${escapeHtml(collection.name)}</option>`).join('');
  if (selected !== undefined) { el('collection-filter').innerHTML = `<option value="all">全部专题</option>${options}`; el('collection-filter').value = selected || 'all'; }
  el('paper-collection').innerHTML = `<option value="">选择专题收藏</option>${options}`;
}
function updateBatchCount() { el('batch-count').textContent = `${state.batch.size} 项已选`; }

function renderNewsPage(route) {
  const q = route.query.q || ''; const source = route.query.source || 'all'; const size = Number(route.query.size) === 18 ? 18 : 9; const page = Math.max(1, Number(route.query.page || 1));
  const sources = [...new Set(state.news.items.map(item => item.source))]; el('news-source').innerHTML = `<option value="all">全部来源</option>${sources.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`; el('news-source').value = source; el('news-page-size').value = String(size);
  const items = state.news.items.filter(item => (source === 'all' || item.source === source) && (!q || `${item.title} ${item.summary}`.toLowerCase().includes(q.toLowerCase()))); const pages = Math.max(1, Math.ceil(items.length / size)); const safePage = Math.min(page, pages); const pageItems = items.slice((safePage - 1) * size, safePage * size);
  el('news-result-count').textContent = `${items.length} 条资讯 · 第 ${safePage}/${pages} 页`; el('news-sync').textContent = `更新 ${dateText(state.news.generatedAt, true)}`;
  el('news-list').innerHTML = pageItems.map(item => `<a class="news-card" href="${escapeHtml(safeUrl(item.link))}" target="_blank" rel="noopener"><span class="news-source">${escapeHtml(item.source)} · OFFICIAL</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary || '打开官方页面查看详情。')}</p><div class="tag-row"><span class="tag">${escapeHtml(dateText(item.published))}</span></div></a>`).join('') || '<div class="empty">没有匹配资讯。</div>';
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
  el('detail-link').href = safeUrl(paper.link); el('paper-note').value = record.note || ''; el('paper-tags').value = (record.tags || []).join(', '); el('reading-progress').value = String(record.progress || 0); renderCollectionOptions();
  el('detail-bilingual-panel').classList.toggle('hidden', !record.abstractTranslation?.text);
  el('detail-bilingual-text').textContent = record.abstractTranslation?.text || '';
  el('detail-bilingual-source').textContent = record.abstractTranslation?.provider ? `中文摘要 · ${record.abstractTranslation.provider}` : '中文摘要';
  el('detail-bilingual').textContent = record.abstractTranslation?.text ? '刷新中文摘要' : '生成中英对照';
  const info = publicationInfo(record, paper); el('detail-venue-title').textContent = info.status === 'published' ? `${paper.venueName || info.venue || paper.venue || '正式版本'}${paper.venueYear ? ` ${paper.venueYear}` : ''} · 已正式收录` : '当前为预印本，尚未核验正式收录';
  el('detail-venue-date').textContent = info.status === 'published' ? `收录/出版时间：${info.published ? paperDateText({ ...paper, publication: info }) : '正式版本已匹配，具体日期待官方元数据核验'}${paper.doi || info.doi ? ` · DOI ${paper.doi || info.doi}` : ''}` : `arXiv 上传时间：${dateText(paper.published)}`;
  el('detail-quality-reason').textContent = paper.quality?.reasons?.length ? `推荐依据：${paper.quality.reasons.join('；')} · 推荐分 ${paper.qualityScore}` : '当前未获得旗舰会议/期刊质量标记，请结合原文自行判断。';
  const official = paper.officialUrl || info.url || (paper.doi ? `https://doi.org/${paper.doi}` : null); el('detail-official-link').href = official ? safeUrl(official) : '#'; el('detail-official-link').classList.toggle('hidden', !official);
  const arxiv = paper.arxivUrl || (paper.source === 'arXiv' ? paper.link : null); el('detail-arxiv-link').href = arxiv ? safeUrl(arxiv) : '#'; el('detail-arxiv-link').classList.toggle('hidden', !arxiv);
  renderDrawerActions(); renderHighlights(); updateDetailNavigation(); el('drawer-overlay').classList.add('open'); el('paper-drawer').classList.add('open'); document.body.style.overflow = 'hidden';
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
function closeModal(id) { el(id).classList.remove('open'); }

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
  if (!root || !root.contains(range.endContainer) || root.closest('a,button,input,textarea,select,[contenteditable="true"]')) return null;
  const text = normalizedTranslationText(selection.toString()); if (!/[A-Za-z]/.test(text)) return null;
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
  if (action === 'open') openPaperRoute(id); else if (action === 'save') toggleRecordField(id, 'saved'); else if (action === 'compare') toggleCompare(id);
});
el('library-list').addEventListener('change', event => { if (!event.target.matches('[data-library-select]')) return; const id = event.target.closest('[data-library-id]').dataset.libraryId; event.target.checked ? state.batch.add(id) : state.batch.delete(id); updateBatchCount(); });
el('library-select-all').addEventListener('change', event => { document.querySelectorAll('[data-library-select]').forEach(input => { input.checked = event.target.checked; const id = input.closest('[data-library-id]').dataset.libraryId; event.target.checked ? state.batch.add(id) : state.batch.delete(id); }); updateBatchCount(); });
el('batch-read').addEventListener('click', () => { for (const id of state.batch) { const record = ensureRecord(getPaper(id)); record.readAt ||= new Date().toISOString(); record.progress = 100; } saveLibrary(); renderRoute(); toast('已批量标记为已读'); });
el('batch-queue').addEventListener('click', () => { for (const id of state.batch) ensureRecord(getPaper(id)).queueAt ||= new Date().toISOString(); saveLibrary(); renderRoute(); toast('已加入阅读队列'); });
el('batch-citations').addEventListener('click', () => { if (!state.batch.size) return toast('请先选择论文'); downloadText('paperscope-citations.bib', [...state.batch].map(id => bibtexFor(getPaper(id))).join('\n\n')); });
el('check-publications').addEventListener('click', async () => { const ids = state.batch.size ? [...state.batch] : Object.entries(library.records).filter(([, record]) => record.savedAt).map(([id]) => id).slice(0, 30); if (!ids.length) return toast('请先收藏或选择论文'); const button = el('check-publications'); button.disabled = true; for (let index = 0; index < ids.length; index += 1) { button.textContent = `${index + 1}/${ids.length}`; await checkPublication(ids[index], true); if (index < ids.length - 1) await new Promise(resolve => setTimeout(resolve, 280)); } button.disabled = false; button.textContent = '检查中刊状态'; renderRoute(); toast('发表状态检查完成'); });
el('collection-filter').addEventListener('change', event => { const route = parseRoute(); navigate('library/collections', { ...route.query, collection: event.target.value, page: 1 }); });
el('create-collection').addEventListener('click', () => { const name = el('new-collection-name').value.trim(); if (!name) return toast('请输入专题名称'); const id = `${slug(name)}-${Date.now().toString(36)}`; library.collections[id] = { name, createdAt: new Date().toISOString() }; saveLibrary(); el('new-collection-name').value = ''; renderRoute(); toast('专题已创建'); });
el('export-vocabulary').addEventListener('click', exportVocabulary); el('export-library').addEventListener('click', exportLibrary); el('import-library').addEventListener('click', () => el('import-file').click()); el('import-file').addEventListener('change', event => { const [file] = event.target.files; if (file) importLibraryFile(file); event.target.value = ''; });

['news-source', 'news-page-size'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('news', { ...route.query, source: el('news-source').value, size: el('news-page-size').value, page: 1 }); }));
['venue-area', 'venue-type', 'venue-status', 'venue-sort'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('venues', { ...route.query, area: el('venue-area').value, type: el('venue-type').value, status: el('venue-status').value, sort: el('venue-sort').value, page: 1 }); }));
el('venue-list').addEventListener('click', event => { const row = event.target.closest('[data-venue-name]'); const action = event.target.closest('[data-venue-action]')?.dataset.venueAction; if (!row || !action) return; const venue = state.venues.venues.find(item => item.name === row.dataset.venueName); if (action === 'save') toggleVenueSave(venue.name); else if (action === 'ics') downloadIcs(venue); });

el('drawer-close').addEventListener('click', () => closeDrawer()); el('drawer-overlay').addEventListener('click', () => closeDrawer()); el('detail-save').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'saved')); el('detail-queue').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'queue')); el('detail-read').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'read')); el('detail-compare').addEventListener('click', () => toggleCompare(state.selectedPaperId));
el('detail-publication').addEventListener('click', async () => { el('detail-publication').disabled = true; el('detail-publication-status').textContent = '查询 Crossref…'; await checkPublication(state.selectedPaperId); el('detail-publication').disabled = false; });
el('copy-bibtex').addEventListener('click', () => copyText(bibtexFor(getPaper(state.selectedPaperId)), 'BibTeX 已复制')); el('copy-markdown').addEventListener('click', () => copyText(markdownFor(getPaper(state.selectedPaperId)), 'Markdown 引用已复制'));
el('detail-bilingual').addEventListener('click', translatePaperAbstract);
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
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommand(); } if (event.key === 'Escape') { closeTranslationPopover(); document.querySelectorAll('.modal.open').forEach(node => node.classList.remove('open')); if (el('paper-drawer').classList.contains('open')) closeDrawer(); } });

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

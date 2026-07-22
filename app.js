const STORAGE_KEY = 'paperscope-library-v3';
const V2_STORAGE_KEY = 'paperscope-library-v2';
const LEGACY_SAVED_KEY = 'paperscope-saved';
const THEME_KEY = 'paperscope-theme';
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

const ROUTE_NAMES = { home: '概览', ai: 'AI 论文', architecture: '体系结构', library: '个人文献库', news: '研究资讯', venues: '会议期刊', paper: '论文详情' };
const state = {
  datasets: { ai: null, architecture: null }, news: null, venues: null, loaded: false,
  compare: new Set(), batch: new Set(), returnHash: null, selectedPaperId: null,
  installPrompt: null, searchTimer: null
};

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function defaultLibrary() {
  return {
    version: 3,
    profile: { name: '研究者', focus: 'AI · 计算机体系结构', bio: '建立自己的研究脉络。', createdAt: new Date().toISOString() },
    records: {}, collections: {}, savedVenues: []
  };
}
function migrateLibrary() {
  const current = readJson(STORAGE_KEY, null);
  if (current?.version === 3) return { ...defaultLibrary(), ...current, profile: { ...defaultLibrary().profile, ...(current.profile || {}) }, records: current.records || {}, collections: current.collections || {}, savedVenues: current.savedVenues || [] };
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
function saveLibrary() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(library)); } catch { toast('浏览器存储空间不足，请导出备份'); } }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function safeUrl(value = '') { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function toast(text) { const node = el('toast'); node.textContent = text; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2700); }
function dateText(value, withTime = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', withTime ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
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
  return { id: paper.id, arxivId: paper.arxivId || null, title: paper.title, abstract: paper.abstract || '', authors: paper.authors || [], published: paper.published || null, updated: paper.updated || null, venue: paper.venue || '', link: safeUrl(paper.link), source: paper.source || '', kind: paper.kind || 'preprint', doi: paper.doi || null, journalRef: paper.journalRef || null, area: paper.area || 'ai', publication: paper.publication || null };
}
function ensureRecord(paper) {
  if (!paper) return null; const old = library.records[paper.id] || {};
  library.records[paper.id] = {
    paper: snapshotPaper(paper), savedAt: old.savedAt || null, queueAt: old.queueAt || null, readAt: old.readAt || null,
    lastOpenedAt: old.lastOpenedAt || null, progress: Number(old.progress || 0), note: old.note || '', tags: Array.isArray(old.tags) ? old.tags : [],
    highlights: Array.isArray(old.highlights) ? old.highlights : [], collections: Array.isArray(old.collections) ? old.collections : [],
    publication: old.publication || paper.publication || null
  };
  return library.records[paper.id];
}
function paperTopics(paper) {
  const definitions = AREA_CONFIG[paper.area || 'ai'].topics; const text = `${paper.title} ${paper.abstract}`;
  return definitions.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).slice(0, 2);
}
function publicationInfo(record, paper) {
  const info = record?.publication || paper?.publication;
  if (info?.status === 'published' || paper?.kind === 'published' || paper?.doi || paper?.journalRef) return { ...info, status: 'published', label: `已发表${info?.venue || paper?.journalRef || paper?.venue ? ` · ${info?.venue || paper?.journalRef || paper?.venue}` : ''}` };
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
function currentSearchableRoute(route) { return ['ai', 'architecture', 'library', 'news', 'venues'].includes(route.name); }
function syncTopSearch(route) {
  const input = el('global-search'); input.value = route.query.q || '';
  input.placeholder = route.name === 'home' ? '搜索全部论文，按 Enter' : route.name === 'venues' ? '搜索会议或期刊' : route.name === 'news' ? '搜索资讯' : '搜索当前页面';
}
function renderRoute() {
  const route = parseRoute(); if (!ROUTE_NAMES[route.name]) return navigate('home', {}, true);
  syncTopSearch(route); setActiveNav(route.name);
  if (!state.loaded) return;
  if (route.name !== 'paper') { state.returnHash = null; closeDrawer(false); }
  if (route.name === 'home') { showView('home'); renderHome(); }
  else if (route.name === 'ai' || route.name === 'architecture') { showView('papers'); renderPaperPage(route.name, route); }
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
  el(target).innerHTML = papers.slice(0, 6).map(paper => `<article class="preview-paper"><button data-open-paper="${escapeHtml(paper.id)}"><h4>${escapeHtml(paper.title)}</h4><p>${escapeHtml(dateText(paper.published))} · ${escapeHtml(paper.source)}</p></button><button class="small" data-compare="${escapeHtml(paper.id)}" title="加入对比">＋</button></article>`).join('');
}
function libraryStats() {
  const records = Object.values(library.records).filter(record => record?.paper);
  return {
    saved: records.filter(record => record.savedAt).length, queue: records.filter(record => record.queueAt).length,
    read: records.filter(record => record.readAt).length, notes: records.filter(record => record.note || record.highlights?.length).length,
    published: records.filter(record => record.savedAt && publicationInfo(record, record.paper).status === 'published').length
  };
}
function renderHome() {
  const ai = state.datasets.ai; const arch = state.datasets.architecture; const stats = libraryStats();
  el('home-focus').textContent = `今日焦点：${ai.topics?.[0]?.name || '等待数据'} × ${arch.topics?.[0]?.name || '等待数据'}`;
  el('home-summary').textContent = `${ai.summary || ''} 体系结构侧重点为「${arch.topics?.[0]?.name || '暂无'}」。`;
  el('home-ai-count').textContent = ai.items.length; el('home-arch-count').textContent = arch.items.length; el('home-sync').textContent = dateText(ai.generatedAt, true).slice(0, 5);
  renderPreviewPapers('home-ai-list', ai.items); renderPreviewPapers('home-arch-list', arch.items);
  el('home-saved').textContent = stats.saved; el('home-queue').textContent = stats.queue; el('home-read').textContent = stats.read; el('home-notes').textContent = stats.notes;
  const topics = [...ai.topics.slice(0, 2).map(item => ({ ...item, area: 'AI' })), ...arch.topics.slice(0, 2).map(item => ({ ...item, area: 'ARCH' }))].sort((a, b) => b.count - a.count);
  const max = topics[0]?.count || 1;
  el('home-topics').innerHTML = topics.map(topic => `<div class="topic"><div class="topic-line"><b>${escapeHtml(topic.name)}</b><span>${topic.area} · ${topic.count}</span></div><div class="bar"><i style="width:${Math.max(12, Math.round(topic.count / max * 100))}%"></i></div></div>`).join('');
  const saved = new Set(library.savedVenues || []);
  const venues = [...(state.venues.venues || [])].sort((a, b) => Number(saved.has(b.name)) - Number(saved.has(a.name)) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)).slice(0, 5);
  el('home-deadlines').innerHTML = venues.map(venue => `<div class="deadline-card"><div><b>${saved.has(venue.name) ? '★ ' : ''}${escapeHtml(venue.name)}</b><p>${escapeHtml(venue.area === 'architecture' ? '体系结构' : 'AI')} · ${escapeHtml(venue.deadline)}</p></div><button class="small" data-venue-save="${escapeHtml(venue.name)}">${saved.has(venue.name) ? '已关注' : '关注'}</button></div>`).join('');
}

function getPaperFilters(area, route) {
  const memory = readJson(`paperscope-filters-${area}`, {});
  return {
    q: route.query.q || '', topic: route.query.topic || memory.topic || 'all', source: route.query.source || memory.source || 'all',
    status: route.query.status || memory.status || 'all', sort: route.query.sort || memory.sort || 'newest',
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
    if (filters.source !== 'all' && paper.source !== filters.source) return false;
    if (filters.status === 'preprint' && publicationInfo(record, paper).status === 'published') return false;
    if (filters.status === 'published' && publicationInfo(record, paper).status !== 'published') return false;
    if (filters.status === 'saved' && !record?.savedAt) return false;
    if (filters.status === 'unread' && record?.readAt) return false;
    return true;
  });
  return items.sort((a, b) => filters.sort === 'oldest' ? new Date(a.published) - new Date(b.published) : filters.sort === 'title' ? a.title.localeCompare(b.title) : new Date(b.published) - new Date(a.published));
}
function renderPaperPage(area, route) {
  const config = AREA_CONFIG[area]; const filters = getPaperFilters(area, route); const items = filterPapers(area, filters);
  const pages = Math.max(1, Math.ceil(items.length / filters.size)); filters.page = Math.min(filters.page, pages);
  const start = (filters.page - 1) * filters.size; const pageItems = items.slice(start, start + filters.size);
  el('papers-eyebrow').textContent = config.eyebrow; el('papers-title').textContent = config.title; el('papers-subtitle').textContent = `${config.subtitle} 当前数据源：${Object.entries(state.datasets[area].providers || {}).map(([name, count]) => `${name} ${count}`).join(' · ')}`;
  el('paper-topic').innerHTML = `<option value="all">全部主题</option>${config.topics.map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  el('paper-topic').value = filters.topic; el('paper-source').value = filters.source; el('paper-status').value = filters.status; el('paper-sort').value = filters.sort; el('paper-page-size').value = String(filters.size);
  localStorage.setItem(`paperscope-filters-${area}`, JSON.stringify({ topic: filters.topic, source: filters.source, status: filters.status, sort: filters.sort, size: filters.size }));
  el('paper-result-count').textContent = `找到 ${items.length} 篇 · 第 ${filters.page}/${pages} 页`;
  el('paper-list').innerHTML = pageItems.length ? pageItems.map((paper, index) => paperRow(paper, start + index + 1)).join('') : '<div class="empty">没有符合当前条件的论文。</div>';
  renderPagination('paper-pagination', filters.page, pages, page => navigate(area, { ...filters, page }));
}
function paperRow(paper, index) {
  const record = getRecord(paper.id); const info = publicationInfo(record, paper); const checked = state.compare.has(paper.id);
  return `<article class="paper-row ${record?.readAt ? 'read' : ''}" data-paper-id="${escapeHtml(paper.id)}"><input class="check" type="checkbox" data-action="compare" aria-label="加入对比" ${checked ? 'checked' : ''}><span class="paper-index">${String(index).padStart(2, '0')}</span><div class="paper-main"><button class="paper-title" data-action="open"><h3>${escapeHtml(paper.title)}</h3></button><p>${escapeHtml(paper.abstract)}</p><div class="tag-row"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span><span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.status === 'published' ? '已发表' : '预印本')}</span><span class="tag">${escapeHtml(dateText(paper.published))}</span>${record?.note ? '<span class="tag note">有笔记</span>' : ''}${paperTopics(paper).map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div></div><div class="paper-actions"><button data-action="read" class="${record?.readAt ? 'active' : ''}" title="已读">✓</button><button data-action="queue" class="${record?.queueAt ? 'active' : ''}" title="阅读队列">＋</button><button data-action="save" class="${record?.savedAt ? 'saved' : ''}" title="收藏">${record?.savedAt ? '★' : '☆'}</button></div></article>`;
}
function renderPagination(target, page, total, onPage) {
  const node = el(target); if (total <= 1) { node.innerHTML = ''; return; }
  const pages = [...new Set([1, total, page - 2, page - 1, page, page + 1, page + 2].filter(value => value >= 1 && value <= total))].sort((a, b) => a - b);
  node.innerHTML = `<button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>←</button>${pages.map((value, index) => `${index && value - pages[index - 1] > 1 ? '<span>…</span>' : ''}<button data-page="${value}" class="${value === page ? 'active' : ''}">${value}</button>`).join('')}<button data-page="${page + 1}" ${page === total ? 'disabled' : ''}>→</button>`;
  node.onclick = event => { const button = event.target.closest('[data-page]'); if (button && !button.disabled) onPage(Number(button.dataset.page)); };
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
  el('collection-tools').classList.toggle('hidden', tab !== 'collections'); renderCollectionOptions(collectionId);
  const records = libraryRecords(tab, collectionId, q); const total = Math.max(1, Math.ceil(records.length / 10)); const safePage = Math.min(page, total); const pageRecords = records.slice((safePage - 1) * 10, safePage * 10);
  state.batch.clear(); updateBatchCount(); el('library-select-all').checked = false;
  el('library-list').innerHTML = pageRecords.length ? pageRecords.map(([id, record]) => libraryRow(id, record)).join('') : '<div class="empty">当前分类还没有论文。</div>';
  renderPagination('library-pagination', safePage, total, next => navigate(`library/${tab}`, { ...route.query, page: next }));
}
function libraryRow(id, record) {
  const info = publicationInfo(record, record.paper); const names = (record.collections || []).map(collectionId => library.collections[collectionId]?.name).filter(Boolean);
  return `<article class="library-row" data-library-id="${escapeHtml(id)}"><input class="check" type="checkbox" data-library-select aria-label="选择论文"><div><h3>${escapeHtml(record.paper.title)}</h3><p>${escapeHtml(record.note || record.paper.abstract || '')}</p><div class="tag-row"><span class="tag ${record.paper.area === 'architecture' ? 'arch' : ''}">${record.paper.area === 'architecture' ? '体系结构' : 'AI'}</span><span class="tag">进度 ${record.progress || 0}%</span>${record.queueAt ? '<span class="tag">阅读队列</span>' : ''}${record.note ? '<span class="tag note">有笔记</span>' : ''}<span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.label)}</span>${names.map(name => `<span class="tag"># ${escapeHtml(name)}</span>`).join('')}</div></div><div class="paper-actions"><button data-library-action="compare">对比</button><button data-library-action="open">查看</button><button data-library-action="save" class="${record.savedAt ? 'saved' : ''}">${record.savedAt ? '★' : '☆'}</button></div></article>`;
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
  el('detail-title').textContent = paper.title; el('detail-meta').textContent = `${(paper.authors || []).slice(0, 8).join(', ') || '作者信息缺失'} · ${dateText(paper.published)} · ${paper.venue || paper.source}`;
  el('detail-summary').textContent = summary.oneLine; el('detail-points').innerHTML = summary.points.map(point => `<li>${escapeHtml(point)}</li>`).join(''); el('detail-limitation').textContent = summary.limitation;
  el('detail-link').href = safeUrl(paper.link); el('paper-note').value = record.note || ''; el('paper-tags').value = (record.tags || []).join(', '); el('reading-progress').value = String(record.progress || 0); renderCollectionOptions();
  renderDrawerActions(); renderHighlights(); updateDetailNavigation(); el('drawer-overlay').classList.add('open'); el('paper-drawer').classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeDrawer(navigateBack = true) {
  el('drawer-overlay').classList.remove('open'); el('paper-drawer').classList.remove('open'); document.body.style.overflow = '';
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
  { label: '个人文献库', hint: 'Saved & Notes', route: 'library/saved' }, { label: '研究资讯', hint: 'Official News', route: 'news' }, { label: '会议与期刊', hint: 'Venues', route: 'venues' }
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
    const [papers, architecture, news, venues, digest] = await Promise.all([get('./data/papers.json'), get('./data/architecture.json'), get('./data/news.json'), get('./data/venues.json'), get('./data/digest.json')]);
    state.datasets.ai = { ...papers, ...digest }; state.datasets.architecture = architecture; state.news = news; state.venues = venues; state.loaded = true;
    migrateLegacySaved(); syncLibraryPapers(); renderProfile(); el('side-sync').textContent = `${dateText(papers.generatedAt, true)} · ${papers.items.length + architecture.items.length} 篇`;
    renderRoute(); if (force) toast(`已检查：数据生成于 ${dateText(papers.generatedAt, true)}`);
  } catch (error) { toast(error.message || '数据加载失败'); document.querySelectorAll('.paper-list').forEach(node => { node.innerHTML = '<div class="empty">无法加载已发布数据，请稍后刷新。</div>'; }); }
}

document.addEventListener('click', event => {
  const routeButton = event.target.closest('[data-route]'); if (routeButton) return navigate(routeButton.dataset.route);
  const open = event.target.closest('[data-open-paper]'); if (open) return openPaperRoute(open.dataset.openPaper);
  const compare = event.target.closest('[data-compare]'); if (compare) return toggleCompare(compare.dataset.compare);
  const venueSave = event.target.closest('[data-venue-save]'); if (venueSave) return toggleVenueSave(venueSave.dataset.venueSave);
  const close = event.target.closest('[data-close-modal]'); if (close) return closeModal(close.dataset.closeModal);
});
el('paper-list').addEventListener('click', event => {
  const row = event.target.closest('[data-paper-id]'); if (!row) return; const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'open') openPaperRoute(row.dataset.paperId); else if (action === 'save') toggleRecordField(row.dataset.paperId, 'saved'); else if (action === 'queue') toggleRecordField(row.dataset.paperId, 'queue'); else if (action === 'read') toggleRecordField(row.dataset.paperId, 'read'); else if (action === 'compare') toggleCompare(row.dataset.paperId);
});
['paper-topic', 'paper-source', 'paper-status', 'paper-sort', 'paper-page-size'].forEach(id => el(id).addEventListener('change', () => {
  const route = parseRoute(); navigate(route.name, { ...route.query, topic: el('paper-topic').value, source: el('paper-source').value, status: el('paper-status').value, sort: el('paper-sort').value, size: el('paper-page-size').value, page: 1 });
}));
el('papers-reset').addEventListener('click', () => { const route = parseRoute(); localStorage.removeItem(`paperscope-filters-${route.name}`); navigate(route.name); });
el('global-search').addEventListener('input', event => {
  const route = parseRoute(); clearTimeout(state.searchTimer); if (!currentSearchableRoute(route)) return;
  state.searchTimer = setTimeout(() => setQuery({ q: event.target.value.trim(), page: 1 }, true), 220);
});
el('global-search').addEventListener('keydown', event => { if (event.key === 'Enter' && parseRoute().name === 'home' && event.currentTarget.value.trim()) openCommand(event.currentTarget.value.trim()); });
el('refresh-data').addEventListener('click', () => loadData(true));

el('library-tabs').addEventListener('click', event => { const button = event.target.closest('[data-tab]'); if (button) navigate(`library/${button.dataset.tab}`); });
el('library-list').addEventListener('click', event => {
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
el('export-library').addEventListener('click', exportLibrary); el('import-library').addEventListener('click', () => el('import-file').click()); el('import-file').addEventListener('change', event => { const [file] = event.target.files; if (file) importLibraryFile(file); event.target.value = ''; });

['news-source', 'news-page-size'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('news', { ...route.query, source: el('news-source').value, size: el('news-page-size').value, page: 1 }); }));
['venue-area', 'venue-type', 'venue-status', 'venue-sort'].forEach(id => el(id).addEventListener('change', () => { const route = parseRoute(); navigate('venues', { ...route.query, area: el('venue-area').value, type: el('venue-type').value, status: el('venue-status').value, sort: el('venue-sort').value, page: 1 }); }));
el('venue-list').addEventListener('click', event => { const row = event.target.closest('[data-venue-name]'); const action = event.target.closest('[data-venue-action]')?.dataset.venueAction; if (!row || !action) return; const venue = state.venues.venues.find(item => item.name === row.dataset.venueName); if (action === 'save') toggleVenueSave(venue.name); else if (action === 'ics') downloadIcs(venue); });

el('drawer-close').addEventListener('click', () => closeDrawer()); el('drawer-overlay').addEventListener('click', () => closeDrawer()); el('detail-save').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'saved')); el('detail-queue').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'queue')); el('detail-read').addEventListener('click', () => toggleRecordField(state.selectedPaperId, 'read')); el('detail-compare').addEventListener('click', () => toggleCompare(state.selectedPaperId));
el('detail-publication').addEventListener('click', async () => { el('detail-publication').disabled = true; el('detail-publication-status').textContent = '查询 Crossref…'; await checkPublication(state.selectedPaperId); el('detail-publication').disabled = false; });
el('copy-bibtex').addEventListener('click', () => copyText(bibtexFor(getPaper(state.selectedPaperId)), 'BibTeX 已复制')); el('copy-markdown').addEventListener('click', () => copyText(markdownFor(getPaper(state.selectedPaperId)), 'Markdown 引用已复制'));
el('save-note').addEventListener('click', () => { const record = ensureRecord(getPaper(state.selectedPaperId)); record.note = el('paper-note').value.trim(); record.tags = [...new Set(el('paper-tags').value.split(/[,，]/).map(value => value.trim()).filter(Boolean))].slice(0, 12); record.progress = Number(el('reading-progress').value); if (record.progress === 100) record.readAt ||= new Date().toISOString(); saveLibrary(); toast('阅读记录已保存'); });
el('add-to-collection').addEventListener('click', () => { const collectionId = el('paper-collection').value; if (!collectionId) return toast('请先选择专题'); const record = ensureRecord(getPaper(state.selectedPaperId)); if (!record.collections.includes(collectionId)) record.collections.push(collectionId); saveLibrary(); toast('已加入专题收藏'); });
el('add-highlight').addEventListener('click', () => { const selection = window.getSelection(); const text = selection?.toString().replace(/\s+/g, ' ').trim(); const anchor = selection?.anchorNode; if (!text || text.length < 3) return toast('请先选中摘要文字'); if (text.length > 500) return toast('单条标注最多 500 字符'); if (!anchor || !el('detail-abstract').contains(anchor.nodeType === Node.TEXT_NODE ? anchor.parentNode : anchor)) return toast('只能标注摘要文字'); const record = ensureRecord(getPaper(state.selectedPaperId)); if (record.highlights.some(item => item.text === text)) return toast('这段文字已经标注'); record.highlights.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), text, color: el('highlight-color').value, createdAt: new Date().toISOString() }); saveLibrary(); selection.removeAllRanges(); renderHighlights(); toast('标注已保存'); });
el('highlight-list').addEventListener('click', event => { const button = event.target.closest('[data-highlight-remove]'); if (!button) return; const record = getRecord(state.selectedPaperId); record.highlights = record.highlights.filter(item => item.id !== button.dataset.highlightRemove); saveLibrary(); renderHighlights(); });
el('previous-paper').addEventListener('click', () => moveDetail(-1)); el('next-paper').addEventListener('click', () => moveDetail(1));

el('open-compare').addEventListener('click', renderCompare); el('clear-compare').addEventListener('click', () => { state.compare.clear(); updateCompareTray(); renderCurrentView(); }); el('compare-table').addEventListener('click', event => { const button = event.target.closest('[data-compare-remove]'); if (button) { state.compare.delete(button.dataset.compareRemove); updateCompareTray(); renderCompare(); } });
el('command-open').addEventListener('click', () => openCommand()); el('command-input').addEventListener('input', event => renderCommands(event.target.value)); el('command-list').addEventListener('click', event => { const route = event.target.closest('[data-command-route]')?.dataset.commandRoute; const paper = event.target.closest('[data-command-paper]')?.dataset.commandPaper; closeModal('command-modal'); if (route) navigate(route); else if (paper) openPaperRoute(paper); });
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal.id); }));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommand(); } if (event.key === 'Escape') { document.querySelectorAll('.modal.open').forEach(node => node.classList.remove('open')); if (el('paper-drawer').classList.contains('open')) closeDrawer(); } });

el('edit-profile').addEventListener('click', () => el('profile-modal').classList.add('open')); el('save-profile').addEventListener('click', () => { library.profile.name = el('profile-name').value.trim() || '研究者'; library.profile.focus = el('profile-focus').value.trim(); library.profile.bio = el('profile-bio').value.trim(); saveLibrary(); renderProfile(); closeModal('profile-modal'); toast('个人资料已保存'); });
function applyTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem(THEME_KEY, theme); el('theme-toggle').textContent = theme === 'dark' ? '☀' : '◐'; }
el('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
window.addEventListener('scroll', () => el('backtop').classList.toggle('show', window.scrollY > 500)); el('backtop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('hashchange', renderRoute); window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; el('install-app').classList.add('show'); }); el('install-app').addEventListener('click', async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; el('install-app').classList.remove('show'); }); window.addEventListener('appinstalled', () => toast('PaperScope 已安装'));

applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); renderProfile(); renderCollectionOptions('all'); if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/home'); if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {}); loadData();

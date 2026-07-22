const STORAGE_KEY = 'paperscope-library-v2';
const LEGACY_SAVED_KEY = 'paperscope-saved';
const el = id => document.getElementById(id);

const AREA_CONFIG = {
  ai: {
    eyebrow: 'AI RESEARCH RADAR', heading: '今日 AI 研究', paperTitle: 'AI 核心论文', hotspotTitle: 'AI 热点方向',
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
    eyebrow: 'COMPUTER ARCHITECTURE RADAR', heading: '今日体系结构研究', paperTitle: '体系结构核心论文', hotspotTitle: '体系结构热点方向',
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

const state = {
  datasets: { ai: null, architecture: null }, news: null, venues: null,
  area: 'ai', activeTopic: 'all', search: '', selectedId: null,
  libraryTab: 'saved', venueArea: 'all', installPrompt: null,
  legacySaved: readJson(LEGACY_SAVED_KEY, [])
};

const defaultLibrary = () => ({
  version: 2,
  profile: { name: '研究者', focus: 'AI · 计算机体系结构', bio: '建立自己的研究脉络。', createdAt: new Date().toISOString() },
  records: {}
});
let library = loadLibrary();

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function loadLibrary() {
  const value = readJson(STORAGE_KEY, null);
  if (!value || value.version !== 2 || typeof value.records !== 'object') return defaultLibrary();
  return { ...defaultLibrary(), ...value, profile: { ...defaultLibrary().profile, ...(value.profile || {}) }, records: value.records || {} };
}
function saveLibrary() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(library)); }
  catch { toast('浏览器存储空间不足，请先导出备份'); }
}
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function safeUrl(value = '') { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
function toast(text) { const node = el('toast'); node.textContent = text; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2800); }
function dateText(value, withTime = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  const options = withTime ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(value));
}
function currentDataset() { return state.datasets[state.area] || { items: [], topics: [], providers: {} }; }
function allCurrentPapers() { return [...(state.datasets.ai?.items || []), ...(state.datasets.architecture?.items || [])]; }
function getPaper(id) { return allCurrentPapers().find(paper => paper.id === id) || library.records[id]?.paper || null; }
function getRecord(id) { return library.records[id] || null; }
function snapshotPaper(paper) {
  return {
    id: paper.id, arxivId: paper.arxivId || null, title: paper.title, abstract: paper.abstract || '', authors: paper.authors || [],
    published: paper.published || null, updated: paper.updated || null, venue: paper.venue || '', link: safeUrl(paper.link), source: paper.source || '',
    kind: paper.kind || 'preprint', doi: paper.doi || null, journalRef: paper.journalRef || null, area: paper.area || state.area,
    publication: paper.publication || null
  };
}
function ensureRecord(paper) {
  if (!paper) return null;
  const existing = library.records[paper.id] || {};
  library.records[paper.id] = {
    paper: snapshotPaper(paper), savedAt: existing.savedAt || null, readAt: existing.readAt || null,
    note: existing.note || '', tags: Array.isArray(existing.tags) ? existing.tags : [],
    highlights: Array.isArray(existing.highlights) ? existing.highlights : [],
    publication: existing.publication || paper.publication || null
  };
  return library.records[paper.id];
}
function paperTopics(paper, area = paper.area || state.area) {
  const text = `${paper.title} ${paper.abstract}`;
  return AREA_CONFIG[area].topics.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).slice(0, 2);
}
function publicationInfo(record, paper) {
  const info = record?.publication || paper?.publication;
  if (info?.status === 'published' || paper?.kind === 'published' || paper?.doi || paper?.journalRef) {
    return { status: 'published', label: `已发表${info?.venue || paper?.journalRef || paper?.venue ? ` · ${info?.venue || paper?.journalRef || paper?.venue}` : ''}`, ...info };
  }
  if (info?.status === 'not-found') return { ...info, label: '暂未匹配到期刊/会议版本' };
  if (info?.status === 'error') return { ...info, label: '上次检查失败' };
  return { status: 'unchecked', label: '尚未检查中刊状态' };
}

function visiblePapers() {
  const config = AREA_CONFIG[state.area];
  return currentDataset().items.filter(paper => {
    const text = `${paper.title} ${paper.abstract} ${(paper.authors || []).join(' ')} ${paper.venue || ''}`;
    const pattern = config.topics.find(([name]) => name === state.activeTopic)?.[1];
    return (!pattern || pattern.test(text)) && text.toLowerCase().includes(state.search.toLowerCase());
  });
}
function renderFilters() {
  el('filters').innerHTML = `<button class="${state.activeTopic === 'all' ? 'active' : ''}" data-topic="all">全部</button>${AREA_CONFIG[state.area].topics.map(([name]) => `<button class="${state.activeTopic === name ? 'active' : ''}" data-topic="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}`;
}
function renderPapers() {
  const papers = visiblePapers();
  el('paper-list').innerHTML = papers.length ? papers.slice(0, 40).map((paper, index) => {
    const record = getRecord(paper.id);
    const publication = publicationInfo(record, paper);
    const kind = publication.status === 'published' ? '<span class="tag published">已发表</span>' : '<span class="tag">预印本</span>';
    const areaTag = paper.area === 'architecture' ? '<span class="tag arch">体系结构</span>' : '<span class="tag">AI</span>';
    const noteTag = record?.note || record?.highlights?.length ? '<span class="tag note">有笔记</span>' : '';
    return `<article class="paper ${record?.readAt ? 'read' : ''}" data-id="${escapeHtml(paper.id)}"><span class="no">${String(index + 1).padStart(2, '0')}</span><div><h4>${escapeHtml(paper.title)}</h4><p>${escapeHtml(paper.abstract)}</p><div class="tags">${kind}${areaTag}<span class="tag">${escapeHtml(paper.source)}</span><span class="tag">${escapeHtml(dateText(paper.published))}</span>${noteTag}${paperTopics(paper).map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div></div><div class="paper-actions"><button class="icon-btn ${record?.readAt ? 'is-read' : ''}" data-paper-action="read" title="${record?.readAt ? '标为未读' : '标为已读'}">✓</button><button class="icon-btn ${record?.savedAt ? 'saved' : ''}" data-paper-action="save" title="收藏">${record?.savedAt ? '★' : '☆'}</button></div></article>`;
  }).join('') : '<div class="empty">没有匹配结果，请调整主题或关键词。</div>';
}
function renderTopics() {
  const topics = currentDataset().topics || [];
  el('topic-list').innerHTML = topics.length ? topics.map(topic => `<div class="trend"><div class="trend-line"><b>${escapeHtml(topic.name)}</b><span>${topic.count} 篇</span></div><div class="bar"><i style="width:${Math.max(12, Math.round(topic.count / (topics[0].count || 1) * 100))}%"></i></div></div>`).join('') : '<div class="empty">数据不足，未生成热点</div>';
  el('signal-text').textContent = currentDataset().signal || '数据不足，暂不生成趋势判断。';
}
function setArea(area, shouldScroll = false) {
  state.area = area;
  state.activeTopic = 'all';
  const config = AREA_CONFIG[area];
  const data = currentDataset();
  el('area-eyebrow').textContent = config.eyebrow;
  el('area-heading').childNodes[0].nodeValue = `${config.heading}，`;
  el('paper-count').textContent = data.items?.length ? `${data.items.length} 篇可靠来源内容` : '暂无数据';
  el('paper-section-title').textContent = config.paperTitle;
  el('hotspot-title').textContent = config.hotspotTitle;
  el('metric-papers').textContent = data.items?.length || 0;
  el('metric-topics').textContent = data.topics?.length || 0;
  el('metric-time').textContent = data.generatedAt ? dateText(data.generatedAt, true).slice(0, 5) : '—';
  el('provider').textContent = Object.entries(data.providers || {}).map(([name, count]) => `${name} ${count}`).join(' · ').toUpperCase();
  const focus = data.topics?.[0]?.name || '等待可靠数据';
  el('digest-title').textContent = `当前批次焦点：${focus}`;
  el('digest-text').textContent = data.summary || '正在等待已发布数据。';
  renderFilters(); renderPapers(); renderTopics();
  document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.action === area));
  if (shouldScroll) el('research-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleSave(id) {
  const paper = getPaper(id); const record = ensureRecord(paper); if (!record) return;
  record.savedAt = record.savedAt ? null : new Date().toISOString();
  saveLibrary(); renderPapers(); renderLibrary(); if (state.selectedId === id) renderModalActions();
  toast(record.savedAt ? '已收藏到个人主页' : '已取消收藏，阅读和笔记记录仍会保留');
}
function toggleRead(id, silent = false) {
  const paper = getPaper(id); const record = ensureRecord(paper); if (!record) return;
  record.readAt = record.readAt ? null : new Date().toISOString();
  saveLibrary(); renderPapers(); renderLibrary(); if (state.selectedId === id) renderModalActions();
  if (!silent) toast(record.readAt ? '已标记为已读' : '已标记为未读');
}
function markOpened(id) {
  const paper = getPaper(id); const record = ensureRecord(paper); if (!record) return;
  if (!record.readAt) record.readAt = new Date().toISOString();
  saveLibrary(); renderPapers(); renderLibrary();
}
function summarizePaper(paper) {
  const text = (paper.abstract || '').replace(/\s+/g, ' ').trim();
  const points = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean).slice(0, 3);
  const topic = paperTopics(paper)[0] || (paper.area === 'architecture' ? '计算机体系结构方法' : '人工智能方法');
  return {
    oneLine: `论文聚焦「${topic}」。以下信息严格基于来源摘要，不额外推测实验结果。`, keyPoints: points,
    limitation: text.startsWith('这是一篇已登记 DOI') ? 'Crossref 未提供摘要，当前只能确认题名、作者、来源和 DOI。' : '这是基于原摘要的结构化拆分，不是对论文全文的替代。'
  };
}
function renderHighlightedAbstract(text, highlights) {
  const ranges = [];
  for (const item of highlights || []) {
    const start = text.indexOf(item.text);
    if (start >= 0 && !ranges.some(range => start < range.end && start + item.text.length > range.start)) ranges.push({ start, end: start + item.text.length, color: item.color });
  }
  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0; let html = '';
  for (const range of ranges) {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark style="background:${escapeHtml(range.color)}66">${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  return html + escapeHtml(text.slice(cursor));
}
function renderHighlights() {
  const record = getRecord(state.selectedId); const highlights = record?.highlights || [];
  el('highlight-list').innerHTML = highlights.length ? highlights.map(item => `<div class="highlight-item" style="border-color:${escapeHtml(item.color)}"><button data-remove-highlight="${escapeHtml(item.id)}" title="删除标注">×</button><p>${escapeHtml(item.text)}</p><small>${escapeHtml(dateText(item.createdAt, true))}</small></div>`).join('') : '<div class="empty">暂无标注</div>';
  const paper = getPaper(state.selectedId);
  if (paper) el('modal-abstract').innerHTML = renderHighlightedAbstract(paper.abstract || '', highlights);
}
function renderModalActions() {
  const paper = getPaper(state.selectedId); const record = getRecord(state.selectedId); if (!paper) return;
  el('modal-save').textContent = record?.savedAt ? '★ 已收藏' : '☆ 收藏';
  el('modal-read').textContent = record?.readAt ? '✓ 已读' : '○ 标为已读';
  const info = publicationInfo(record, paper);
  el('publication-status').textContent = info.label;
  el('publication-status').className = `tag ${info.status === 'published' ? 'published' : ''}`;
  el('modal-publication').disabled = false;
}
function openPaper(id) {
  const paper = getPaper(id); if (!paper) return;
  state.selectedId = id; markOpened(id);
  const record = ensureRecord(paper); const summary = summarizePaper(paper);
  el('modal').classList.add('open'); document.body.style.overflow = 'hidden';
  el('modal-title').textContent = paper.title;
  el('modal-meta').textContent = `${(paper.authors || []).slice(0, 7).join(', ') || '作者信息缺失'} · ${dateText(paper.published)} · ${paper.venue || paper.source}`;
  el('modal-summary').textContent = summary.oneLine;
  el('modal-points').innerHTML = summary.keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('');
  el('modal-limitation').textContent = summary.limitation;
  el('modal-link').href = safeUrl(paper.link);
  el('paper-note').value = record.note || '';
  el('paper-tags').value = (record.tags || []).join(', ');
  renderModalActions(); renderHighlights();
}
function closeModal() { el('modal').classList.remove('open'); document.body.style.overflow = ''; }

function renderProfile() {
  const profile = library.profile;
  const initial = (profile.name || '研').trim().slice(0, 1).toUpperCase();
  el('profile-avatar').textContent = initial; el('top-avatar').textContent = initial;
  el('profile-name-display').textContent = profile.name; el('top-name').textContent = profile.name;
  el('profile-focus-display').textContent = profile.focus || '尚未填写研究方向';
  el('profile-bio-display').textContent = profile.bio || '建立自己的研究脉络。';
  el('profile-name').value = profile.name; el('profile-focus').value = profile.focus; el('profile-bio').value = profile.bio;
}
function relevantLibraryRecords() {
  return Object.entries(library.records).filter(([, record]) => record?.paper).filter(([, record]) => {
    if (state.libraryTab === 'saved') return Boolean(record.savedAt);
    if (state.libraryTab === 'read') return Boolean(record.readAt);
    if (state.libraryTab === 'notes') return Boolean(record.note || record.highlights?.length);
    if (state.libraryTab === 'published') return Boolean(record.savedAt && publicationInfo(record, record.paper).status === 'published');
    return true;
  }).sort(([, a], [, b]) => new Date(b.savedAt || b.readAt || b.publication?.checkedAt || 0) - new Date(a.savedAt || a.readAt || a.publication?.checkedAt || 0));
}
function renderLibrary() {
  const records = Object.values(library.records).filter(record => record?.paper);
  el('stat-saved').textContent = records.filter(record => record.savedAt).length;
  el('stat-read').textContent = records.filter(record => record.readAt).length;
  el('stat-notes').textContent = records.filter(record => record.note || record.highlights?.length).length;
  el('stat-published').textContent = records.filter(record => record.savedAt && publicationInfo(record, record.paper).status === 'published').length;
  const filtered = relevantLibraryRecords();
  el('library-list').innerHTML = filtered.length ? filtered.map(([id, record]) => {
    const paper = record.paper; const info = publicationInfo(record, paper);
    const activity = state.libraryTab === 'saved' ? record.savedAt : state.libraryTab === 'read' ? record.readAt : record.publication?.checkedAt || record.readAt;
    return `<article class="library-item" data-id="${escapeHtml(id)}"><div><h4>${escapeHtml(paper.title)}</h4><p>${escapeHtml((record.note || paper.abstract || '').slice(0, 180))}</p><div class="library-meta"><span class="tag ${paper.area === 'architecture' ? 'arch' : ''}">${paper.area === 'architecture' ? '体系结构' : 'AI'}</span><span class="tag">${escapeHtml(dateText(activity))}</span>${record.note ? '<span class="tag note">有笔记</span>' : ''}${record.highlights?.length ? `<span class="tag note">${record.highlights.length} 条标注</span>` : ''}<span class="tag ${info.status === 'published' ? 'published' : ''}">${escapeHtml(info.label)}</span></div></div><div class="library-actions"><button class="small-btn" data-library-action="open">查看</button><button class="icon-btn ${record.savedAt ? 'saved' : ''}" data-library-action="save">${record.savedAt ? '★' : '☆'}</button></div></article>`;
  }).join('') : `<div class="empty">${state.libraryTab === 'published' ? '收藏的论文尚未匹配到正式发表版本。点击“检查中刊状态”更新。' : '这个分类目前还没有论文。'}</div>`;
}

function normalizeTitleTokens(title) { return new Set(String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(word => word.length > 1)); }
function titleSimilarity(a, b) {
  const aa = normalizeTitleTokens(a); const bb = normalizeTitleTokens(b); if (!aa.size || !bb.size) return 0;
  const common = [...aa].filter(token => bb.has(token)).length;
  return (2 * common) / (aa.size + bb.size);
}
function crossrefDate(item) {
  const parts = item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0];
  if (!parts?.length) return null;
  return new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1)).toISOString();
}
async function checkPublication(id, quiet = false) {
  const paper = getPaper(id); const record = ensureRecord(paper); if (!paper || !record) return false;
  if (paper.kind === 'published' || paper.doi || paper.journalRef || paper.publication?.status === 'published') {
    record.publication = { ...(paper.publication || {}), status: 'published', doi: paper.doi || paper.publication?.doi || null, venue: paper.journalRef || paper.publication?.venue || paper.venue, checkedAt: new Date().toISOString(), source: paper.publication?.source || paper.source };
    saveLibrary(); return true;
  }
  try {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query.title', paper.title); url.searchParams.set('rows', '5');
    url.searchParams.set('select', 'DOI,title,container-title,published,published-online,URL,author,type');
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
    const items = (await response.json()).message?.items || [];
    const candidates = items.map(item => ({ item, score: titleSimilarity(paper.title, item.title?.[0] || '') })).sort((a, b) => b.score - a.score);
    const match = candidates[0]?.score >= 0.78 ? candidates[0] : null;
    record.publication = match ? {
      status: 'published', doi: match.item.DOI, venue: match.item['container-title']?.[0] || '已登记 DOI',
      published: crossrefDate(match.item), url: match.item.URL || `https://doi.org/${match.item.DOI}`,
      checkedAt: new Date().toISOString(), source: 'Crossref 标题匹配', confidence: match.score
    } : { status: 'not-found', checkedAt: new Date().toISOString(), source: 'Crossref 标题匹配' };
    saveLibrary();
    if (!quiet) toast(match ? `已匹配正式版本：${record.publication.venue}` : '暂未匹配到正式发表版本');
    return Boolean(match);
  } catch (error) {
    record.publication = { status: 'error', checkedAt: new Date().toISOString(), message: error.message };
    saveLibrary(); if (!quiet) toast('检查失败，请稍后重试'); return false;
  } finally { renderLibrary(); if (state.selectedId === id) renderModalActions(); }
}
async function checkAllPublications() {
  const button = el('check-publications');
  const ids = Object.entries(library.records).filter(([, record]) => record.savedAt).map(([id]) => id);
  if (!ids.length) return toast('请先收藏论文');
  button.disabled = true; let published = 0;
  const targets = ids.slice(0, 30);
  for (let index = 0; index < targets.length; index += 1) {
    button.textContent = `检查 ${index + 1}/${targets.length}`;
    if (await checkPublication(targets[index], true)) published += 1;
    if (index < targets.length - 1) await new Promise(resolve => setTimeout(resolve, 300));
  }
  button.disabled = false; button.textContent = '检查中刊状态'; renderLibrary();
  toast(`检查完成：${published} 篇已匹配正式版本${ids.length > 30 ? '（本次最多检查 30 篇）' : ''}`);
}

function renderNews() {
  const data = state.news || {}; const items = data.items || [];
  el('news-provider').textContent = Object.entries(data.providers || {}).map(([name, count]) => `${name} ${count}`).join(' · ') || 'OFFICIAL RSS';
  el('news-list').innerHTML = items.length ? items.slice(0, 12).map(item => `<a class="news-item" href="${escapeHtml(safeUrl(item.link))}" target="_blank" rel="noopener"><span class="news-source">${escapeHtml(item.source)} · OFFICIAL</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary || '打开官方原文查看详情。')}</p><span class="news-date">${escapeHtml(dateText(item.published))}</span></a>`).join('') : '<div class="empty">暂时没有官方资讯。</div>';
}
function renderVenues() {
  const data = state.venues || { venues: [] };
  const venues = data.venues.filter(venue => state.venueArea === 'all' || venue.area === state.venueArea);
  el('venue-note').textContent = `数据生成：${dateText(data.generatedAt, true)}。${data.note || ''}`;
  el('venue-list').innerHTML = venues.map(venue => `<tr><td><b>${escapeHtml(venue.name)}</b><small>${escapeHtml(venue.type)} · 核验 ${escapeHtml(venue.verifiedAt)}</small></td><td><span class="status">${venue.area === 'architecture' ? '体系结构 · ' : 'AI · '}${escapeHtml(venue.level)}</span></td><td class="deadline">${escapeHtml(venue.deadline)}</td><td>${escapeHtml(venue.speed)}</td><td><a class="official" href="${escapeHtml(safeUrl(venue.officialUrl))}" target="_blank" rel="noopener">${escapeHtml(venue.source)} ↗</a></td></tr>`).join('');
}
function migrateLegacySaved() {
  if (!Array.isArray(state.legacySaved) || !state.legacySaved.length) return;
  for (const id of state.legacySaved) { const paper = getPaper(id); if (paper) ensureRecord(paper).savedAt ||= new Date().toISOString(); }
  saveLibrary(); localStorage.removeItem(LEGACY_SAVED_KEY); state.legacySaved = [];
}
function syncLibraryPapers() {
  for (const paper of allCurrentPapers()) {
    const record = getRecord(paper.id); if (!record) continue;
    record.paper = snapshotPaper(paper);
    if (paper.publication?.status === 'published') record.publication = paper.publication;
  }
  saveLibrary();
}
async function loadAll(force = false) {
  const button = el('refresh'); button.disabled = true; button.textContent = '检查中…';
  try {
    const version = force ? `?v=${Date.now()}` : '';
    const getJson = async path => { const response = await fetch(`${path}${version}`, { cache: force ? 'reload' : 'default' }); if (!response.ok) throw new Error(`${path} 加载失败`); return response.json(); };
    const [papers, architecture, news, venues, digest] = await Promise.all([getJson('./data/papers.json'), getJson('./data/architecture.json'), getJson('./data/news.json'), getJson('./data/venues.json'), getJson('./data/digest.json')]);
    state.datasets.ai = { ...papers, ...digest };
    state.datasets.architecture = architecture;
    state.news = news; state.venues = venues;
    migrateLegacySaved(); syncLibraryPapers();
    const warnings = [...(papers.errors || []), ...(architecture.errors || []), ...(news.errors || [])].filter(Boolean);
    el('notice').textContent = warnings.join('；'); el('notice').classList.toggle('show', warnings.length > 0);
    setArea(state.area); renderNews(); renderVenues(); renderProfile(); renderLibrary();
    if (force) toast(`数据版本生成于 ${dateText(papers.generatedAt, true)}`);
  } catch (error) {
    el('paper-list').innerHTML = '<div class="empty">无法加载已发布数据，请稍后刷新或检查网络。</div>';
    el('news-list').innerHTML = '<div class="empty">资讯数据暂不可用。</div>';
    toast(error.message || '同步失败');
  } finally { button.disabled = false; button.textContent = '↻ 检查最新数据'; }
}

function exportLibrary() {
  const payload = { ...library, exportedAt: new Date().toISOString(), app: 'PaperScope' };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `paperscope-library-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  toast('个人文献库已导出');
}
async function importLibraryFile(file) {
  try {
    const value = JSON.parse(await file.text());
    if (value.version !== 2 || !value.records || typeof value.records !== 'object') throw new Error('不是有效的 PaperScope v2 备份');
    const entries = Object.entries(value.records).filter(([id, record]) => id && record?.paper?.title).slice(0, 2000);
    if (!confirm(`将导入 ${entries.length} 条记录并覆盖当前个人文献库，是否继续？`)) return;
    library = { ...defaultLibrary(), profile: { ...defaultLibrary().profile, ...(value.profile || {}) }, records: Object.fromEntries(entries) };
    saveLibrary(); renderProfile(); renderLibrary(); renderPapers(); toast('导入完成');
  } catch (error) { toast(error.message || '导入失败'); }
}

el('refresh').addEventListener('click', () => loadAll(true));
el('search').addEventListener('input', event => { state.search = event.target.value.trim(); renderPapers(); });
el('filters').addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; state.activeTopic = button.dataset.topic; renderFilters(); renderPapers(); });
el('paper-list').addEventListener('click', event => {
  const paperNode = event.target.closest('.paper'); if (!paperNode) return;
  const action = event.target.closest('[data-paper-action]')?.dataset.paperAction;
  if (action === 'save') return toggleSave(paperNode.dataset.id);
  if (action === 'read') return toggleRead(paperNode.dataset.id);
  openPaper(paperNode.dataset.id);
});
document.querySelector('.nav').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return; const action = button.dataset.action;
  if (action === 'ai' || action === 'architecture') return setArea(action, true);
  if (action === 'overview') { setArea(state.area); el('dashboard').scrollIntoView({ behavior: 'smooth' }); }
  else el(action)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.nav button').forEach(item => item.classList.toggle('active', item === button));
});
el('open-profile').addEventListener('click', () => el('library').scrollIntoView({ behavior: 'smooth', block: 'start' }));
el('edit-profile').addEventListener('click', () => el('profile-form').classList.add('open'));
el('cancel-profile').addEventListener('click', () => { renderProfile(); el('profile-form').classList.remove('open'); });
el('save-profile').addEventListener('click', () => {
  library.profile.name = el('profile-name').value.trim() || '研究者'; library.profile.focus = el('profile-focus').value.trim(); library.profile.bio = el('profile-bio').value.trim();
  saveLibrary(); renderProfile(); el('profile-form').classList.remove('open'); toast('个人资料已保存');
});
el('library-tabs').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return; state.libraryTab = button.dataset.library;
  document.querySelectorAll('#library-tabs button').forEach(item => item.classList.toggle('active', item === button)); renderLibrary();
});
el('library-list').addEventListener('click', event => {
  const item = event.target.closest('.library-item'); if (!item) return; const action = event.target.closest('[data-library-action]')?.dataset.libraryAction;
  if (action === 'save') toggleSave(item.dataset.id); else openPaper(item.dataset.id);
});
el('modal').addEventListener('click', event => { if (event.target === el('modal') || event.target.closest('.close')) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
el('modal-save').addEventListener('click', () => toggleSave(state.selectedId));
el('modal-read').addEventListener('click', () => toggleRead(state.selectedId));
el('modal-publication').addEventListener('click', async () => { el('modal-publication').disabled = true; el('publication-status').textContent = '正在查询 Crossref…'; await checkPublication(state.selectedId); renderModalActions(); });
el('save-note').addEventListener('click', () => {
  const paper = getPaper(state.selectedId); const record = ensureRecord(paper); if (!record) return;
  record.note = el('paper-note').value.trim(); record.tags = [...new Set(el('paper-tags').value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))].slice(0, 12);
  saveLibrary(); renderLibrary(); renderPapers(); toast('笔记与标签已保存');
});
el('add-highlight').addEventListener('click', () => {
  const selection = window.getSelection(); const text = selection?.toString().replace(/\s+/g, ' ').trim();
  if (!text || text.length < 3) return toast('请先选中摘要中的一段文字');
  if (text.length > 500) return toast('单条标注最多 500 个字符');
  const anchor = selection.anchorNode; if (!anchor || !el('modal-abstract').contains(anchor.nodeType === Node.TEXT_NODE ? anchor.parentNode : anchor)) return toast('只能标注论文摘要中的文字');
  const record = ensureRecord(getPaper(state.selectedId));
  if (record.highlights.some(item => item.text === text)) return toast('这段文字已经标注');
  record.highlights.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, text, color: el('highlight-color').value, createdAt: new Date().toISOString() });
  saveLibrary(); selection.removeAllRanges(); renderHighlights(); renderLibrary(); renderPapers(); toast('已添加摘要标注');
});
el('highlight-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-highlight]'); if (!button) return;
  const record = getRecord(state.selectedId); if (!record) return; record.highlights = record.highlights.filter(item => item.id !== button.dataset.removeHighlight);
  saveLibrary(); renderHighlights(); renderLibrary(); renderPapers();
});
el('check-publications').addEventListener('click', checkAllPublications);
el('export-library').addEventListener('click', exportLibrary);
el('import-library').addEventListener('click', () => el('import-file').click());
el('import-file').addEventListener('change', event => { const [file] = event.target.files; if (file) importLibraryFile(file); event.target.value = ''; });
el('venue-filters').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return; state.venueArea = button.dataset.venueArea;
  document.querySelectorAll('#venue-filters button').forEach(item => item.classList.toggle('active', item === button)); renderVenues();
});
el('check-venues').addEventListener('click', async () => {
  const button = el('check-venues'); button.disabled = true; button.textContent = '载入中…';
  try { const response = await fetch(`./data/venues.json?v=${Date.now()}`, { cache: 'reload' }); if (!response.ok) throw new Error(); state.venues = await response.json(); renderVenues(); toast('会议期刊数据已重新载入'); }
  catch { toast('会议信息载入失败'); } finally { button.disabled = false; button.textContent = '重新载入'; }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; el('install-app').classList.add('show'); });
el('install-app').addEventListener('click', async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; el('install-app').classList.remove('show'); });
window.addEventListener('appinstalled', () => toast('PaperScope 已安装'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});

renderProfile(); renderLibrary(); renderFilters();
loadAll();

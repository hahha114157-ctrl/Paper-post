const savedIds = (() => { try { return JSON.parse(localStorage.getItem('paperscope-saved') || '[]'); } catch { return []; } })();
const state = { papers: [], topics: [], activeTopic: 'all', search: '', saved: new Set(savedIds), installPrompt: null };
const el = id => document.getElementById(id);
const topicPatterns = {
  '推理与测试时计算': /reasoning|test[- ]time|chain[- ]of[- ]thought|verifier|inference[- ]time|deliberation/i,
  '智能体与规划': /\bagents?\b|planning|tool[- ]use|multi[- ]agent|workflow|computer use/i,
  '高效体系结构': /mixture[- ]of[- ]experts|\bmoe\b|routing|spars|efficient|quantiz|architecture/i,
  '多模态与视觉语言': /multimodal|vision[- ]language|\bvlm\b|image generation|video generation/i,
  '具身智能与机器人': /robot|embodied|manipulation|world model|navigation/i
};

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function toast(text) { const node = el('toast'); node.textContent = text; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2800); }
function dateText(value, withTime = false) {
  if (!value) return '—';
  const options = withTime ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(value));
}
function paperTopics(paper) {
  const text = `${paper.title} ${paper.abstract}`;
  return Object.entries(topicPatterns).filter(([, pattern]) => pattern.test(text)).map(([name]) => name).slice(0, 2);
}
function visiblePapers() {
  return state.papers.filter(paper => {
    const text = `${paper.title} ${paper.abstract} ${(paper.authors || []).join(' ')} ${paper.venue || ''}`;
    const matchesTopic = state.activeTopic === 'all' || (topicPatterns[state.activeTopic] || /.^/).test(text);
    return matchesTopic && text.toLowerCase().includes(state.search.toLowerCase());
  });
}
function renderPapers() {
  const papers = visiblePapers();
  el('paper-list').innerHTML = papers.length ? papers.slice(0, 24).map((paper, index) => {
    const saved = state.saved.has(paper.id);
    const kind = paper.kind === 'published' ? '<span class="tag published">已发表 · DOI</span>' : '<span class="tag">预印本</span>';
    return `<article class="paper" data-id="${escapeHtml(paper.id)}"><span class="no">${String(index + 1).padStart(2, '0')}</span><div><h4>${escapeHtml(paper.title)}</h4><p>${escapeHtml(paper.abstract)}</p><div class="tags">${kind}<span class="tag">${escapeHtml(paper.source)}</span><span class="tag">${escapeHtml(dateText(paper.published))}</span>${paperTopics(paper).map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div></div><span class="star ${saved ? 'saved' : ''}" title="收藏">${saved ? '★' : '☆'}</span></article>`;
  }).join('') : '<div class="empty">没有可靠的匹配结果。请调整主题或关键词。</div>';
  document.querySelectorAll('.paper').forEach(node => node.addEventListener('click', event => {
    const id = node.dataset.id;
    if (event.target.closest('.star')) return toggleSave(id);
    openPaper(id);
  }));
}
function toggleSave(id) {
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  localStorage.setItem('paperscope-saved', JSON.stringify([...state.saved])); renderPapers();
  toast(state.saved.has(id) ? '已收藏论文' : '已取消收藏');
}
function summarizePaper(paper) {
  const text = paper.abstract.replace(/\s+/g, ' ').trim();
  const points = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean).slice(0, 3);
  const topic = paperTopics(paper)[0] || '人工智能方法';
  return {
    oneLine: `论文聚焦「${topic}」。以下结论严格基于来源摘要，不额外推测实验结果。`,
    keyPoints: points,
    limitation: paper.abstract.startsWith('这是一篇已由期刊登记 DOI') ? 'Crossref 未提供摘要，当前只能确认题名、作者、期刊和 DOI。' : '这是结构化摘要，不是大模型生成的中文全文解读。'
  };
}
function openPaper(id) {
  el('modal').classList.add('open'); document.body.style.overflow = 'hidden';
  el('modal-title').textContent = '正在整理来源摘要…'; el('modal-meta').textContent = ''; el('modal-summary').textContent = '';
  el('modal-points').innerHTML = ''; el('modal-limitation').textContent = ''; el('modal-abstract').textContent = ''; el('modal-link').removeAttribute('href');
  const paper = state.papers.find(item => item.id === id);
  try {
    if (!paper) throw new Error();
    const summary = summarizePaper(paper);
    el('modal-title').textContent = paper.title;
    el('modal-meta').textContent = `${(paper.authors || []).slice(0, 6).join(', ') || '作者信息缺失'} · ${dateText(paper.published)} · ${paper.venue || paper.source}`;
    el('modal-summary').textContent = summary.oneLine;
    el('modal-points').innerHTML = (summary.keyPoints || []).map(point => `<li>${escapeHtml(point)}</li>`).join('');
    el('modal-limitation').textContent = summary.limitation;
    el('modal-abstract').textContent = paper.abstract; el('modal-link').href = paper.link;
  } catch { el('modal-title').textContent = '摘要暂时不可用'; el('modal-summary').textContent = '请稍后重试。'; }
}
function closeModal() { el('modal').classList.remove('open'); document.body.style.overflow = ''; }
function renderTopics() {
  const topics = state.topics;
  el('topic-list').innerHTML = topics.length ? topics.map(topic => `<div class="trend"><div class="trend-line"><b>${escapeHtml(topic.name)}</b><span>${topic.count} 篇</span></div><div class="bar"><i style="width:${Math.max(12, Math.round(topic.count / (topics[0].count || 1) * 100))}%"></i></div></div>`).join('') : '<div class="empty">数据不足，未生成热点</div>';
}
function setDigest(data) {
  const title = data.topics?.[0]?.name || '等待可靠数据';
  el('digest-title').textContent = `当前批次焦点：${title}`; el('digest-text').textContent = data.summary;
  el('signal-text').textContent = data.signal; el('metric-topics').textContent = data.topics?.length || 0;
  state.topics = data.topics || []; renderTopics();
}
function renderNews(data) {
  const items = data.items || [];
  el('news-provider').textContent = Object.entries(data.providers || {}).map(([name, count]) => `${name} ${count}`).join(' · ') || 'OFFICIAL RSS';
  el('news-list').innerHTML = items.length ? items.slice(0, 12).map(item => `<a class="news-item" href="${escapeHtml(item.link)}" target="_blank" rel="noopener"><span class="news-source">${escapeHtml(item.source)} · OFFICIAL</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary || '打开官方原文查看详情。')}</p><span class="news-date">${escapeHtml(dateText(item.published))}</span></a>`).join('') : `<div class="empty">${escapeHtml(data.warning || '暂时没有官方资讯。')}</div>`;
}
function renderVenues(data) {
  el('venue-note').textContent = `数据生成：${dateText(data.generatedAt, true)}。${data.note}`;
  el('venue-list').innerHTML = data.venues.map(venue => `<tr><td><b>${escapeHtml(venue.name)}</b><small>${escapeHtml(venue.type)} · 核验 ${escapeHtml(venue.verifiedAt)}</small></td><td><span class="status">${escapeHtml(venue.level)}</span></td><td class="deadline">${escapeHtml(venue.deadline)}</td><td>${escapeHtml(venue.speed)}</td><td><a class="official" href="${escapeHtml(venue.officialUrl)}" target="_blank" rel="noopener">${escapeHtml(venue.source)} ↗</a></td></tr>`).join('');
}
async function loadAll(force = false) {
  const button = el('refresh'); button.disabled = true; button.textContent = '检查中…';
  try {
    const version = force ? `?v=${Date.now()}` : '';
    const [papers, news, venues, digest] = await Promise.all([
      fetch(`./data/papers.json${version}`, { cache: force ? 'reload' : 'default' }).then(response => { if (!response.ok) throw new Error('论文数据加载失败'); return response.json(); }),
      fetch(`./data/news.json${version}`, { cache: force ? 'reload' : 'default' }).then(response => { if (!response.ok) throw new Error('资讯数据加载失败'); return response.json(); }),
      fetch(`./data/venues.json${version}`, { cache: force ? 'reload' : 'default' }).then(response => response.json()),
      fetch(`./data/digest.json${version}`, { cache: force ? 'reload' : 'default' }).then(response => response.json())
    ]);
    state.papers = papers.items || [];
    el('paper-count').textContent = state.papers.length ? `${state.papers.length} 篇可靠来源内容` : '没有可用的实时内容';
    el('metric-papers').textContent = state.papers.length; el('metric-time').textContent = papers.generatedAt ? dateText(papers.generatedAt, true).slice(0, 5) : '—';
    el('provider').textContent = Object.entries(papers.providers || {}).map(([name, count]) => `${name} ${count}`).join(' · ').toUpperCase();
    const warnings = [...(papers.errors || []), ...(news.errors || [])].filter(Boolean);
    el('notice').textContent = warnings.join('；'); el('notice').classList.toggle('show', warnings.length > 0);
    renderPapers(); renderNews(news); renderVenues(venues); setDigest(digest);
    if (force) toast(`已检查：数据生成于 ${dateText(papers.generatedAt, true)}`);
  } catch (error) {
    el('paper-list').innerHTML = '<div class="empty">无法连接本地服务。请确认 PaperScope 服务已经启动。</div>';
    el('news-list').innerHTML = '<div class="empty">资讯接口不可用。</div>'; toast(error.message || '同步失败');
  } finally { button.disabled = false; button.textContent = '↻ 检查最新数据'; }
}

el('refresh').addEventListener('click', () => loadAll(true));
el('search').addEventListener('input', event => { state.search = event.target.value; renderPapers(); });
el('filters').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  document.querySelector('.filters .active').classList.remove('active'); button.classList.add('active'); state.activeTopic = button.dataset.topic; renderPapers();
});
document.querySelectorAll('.nav button').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.nav .active').classList.remove('active'); button.classList.add('active'); el(button.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
el('modal').addEventListener('click', event => { if (event.target === el('modal') || event.target.closest('.close')) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
el('check-venues').addEventListener('click', async () => {
  const button = el('check-venues'); button.disabled = true; button.textContent = '载入中…';
  try { const data = await fetch(`./data/venues.json?v=${Date.now()}`, { cache: 'reload' }).then(response => response.json()); renderVenues(data); toast(`会议数据生成于 ${dateText(data.generatedAt, true)}`); }
  catch { toast('会议信息载入失败'); } finally { button.disabled = false; button.textContent = '重新载入'; }
});

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; el('install-app').classList.add('show'); });
el('install-app').addEventListener('click', async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; el('install-app').classList.remove('show'); });
window.addEventListener('appinstalled', () => toast('PaperScope 已安装'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});

loadAll();

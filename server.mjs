import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const PORT = Number(process.env.PORT || 4173);
const USER_AGENT = `PaperScope/2.0 (${process.env.CONTACT_EMAIL || 'local research dashboard'})`;
const PAPER_TTL = 4 * 60 * 60 * 1000;
const NEWS_TTL = 2 * 60 * 60 * 1000;
let lastDailySync = '';

const NEWS_FEEDS = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/' }
];

const VENUES = [
  { name: 'AAAI-27', type: '会议', level: 'CCF-A', officialUrl: 'https://aaai.org/conference/aaai/aaai-27/', deadlineAt: '2026-07-29T11:59:00Z', deadlineName: '全文截稿', speed: '2026-11-30 公布最终结果', source: 'AAAI-27 官方 CFP', verifiedAt: '2026-07-22' },
  { name: 'NeurIPS 2026', type: '会议', level: 'CCF-A', officialUrl: 'https://neurips.cc/Conferences/2026/CallForPapers', deadlineAt: '2026-05-07T11:59:00Z', deadlineName: '全文截稿', speed: '2026-09-24 作者通知', source: 'NeurIPS 2026 官方 CFP', verifiedAt: '2026-07-22' },
  { name: 'ICML 2026', type: '会议', level: 'CCF-A · PMLR 收录', officialUrl: 'https://icml.cc/Conferences/2026/CallForPapers', deadlineAt: '2026-01-29T11:59:00Z', deadlineName: '全文截稿', speed: '已完成录用；会议于 2026-07-06 至 07-11 举行', source: 'ICML 2026 官方 CFP', verifiedAt: '2026-07-22' },
  { name: 'ACL 2026', type: '会议', level: 'CCF-A · ACL Anthology', officialUrl: 'https://2026.aclweb.org/', deadlineAt: '2026-01-06T11:59:00Z', deadlineName: 'ARR 投稿截止', speed: '2026-04-04 已公布录用结果', source: 'ACL 2026 官方网站', verifiedAt: '2026-07-22' },
  { name: 'ICLR 2027', type: '会议', level: 'CCF-A · OpenReview', officialUrl: 'https://iclr.cc/', deadlineAt: null, deadlineName: '官方尚未公布', speed: '通常采用 OpenReview 公开讨论流程', source: 'ICLR 官方网站', verifiedAt: '2026-07-22' },
  { name: 'IEEE TPAMI', type: '期刊', level: 'CCF-A · JCR Q1', officialUrl: 'https://www.computer.org/csdl/journal/tp', rolling: true, speed: '首轮常见 3–6 个月；不是官方时限承诺', source: 'IEEE Computer Society', verifiedAt: '2026-07-22' },
  { name: 'JMLR', type: '期刊', level: '机器学习旗舰期刊', officialUrl: 'https://jmlr.org/author-info.html', rolling: true, speed: '无固定审稿时限；以编辑流程为准', source: 'JMLR 作者指南', verifiedAt: '2026-07-22' },
  { name: 'TMLR', type: '期刊', level: 'OpenReview · 机器学习', officialUrl: 'https://jmlr.org/tmlr/author-guide.html', rolling: true, speed: '持续评审；时长取决于审稿轮次', source: 'TMLR 作者指南', verifiedAt: '2026-07-22' }
];

const TOPICS = [
  ['推理与测试时计算', /reasoning|test[- ]time|chain[- ]of[- ]thought|verifier|inference[- ]time|deliberation/i],
  ['智能体与规划', /\bagents?\b|planning|tool[- ]use|multi[- ]agent|workflow|computer use/i],
  ['高效体系结构', /mixture[- ]of[- ]experts|\bmoe\b|routing|spars|efficient|quantiz|architecture/i],
  ['多模态与视觉语言', /multimodal|vision[- ]language|\bvlm\b|image generation|video generation/i],
  ['具身智能与机器人', /robot|embodied|manipulation|world model|navigation/i],
  ['训练与对齐', /reinforcement learning|alignment|preference|post[- ]training|fine[- ]tun|reward model/i]
];

const xmlDecode = (value = '') => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').trim();
const stripHtml = (value = '') => xmlDecode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function xmlValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? xmlDecode(match[1]).replace(/\s+/g, ' ').trim() : '';
}
function toIsoDate(dateParts) {
  if (!Array.isArray(dateParts) || !dateParts.length) return null;
  const [year, month = 1, day = 1] = dateParts;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function normalizeTitle(value = '') { return stripHtml(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim(); }
function uniqueNewest(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
}
function paperRankScore(paper) {
  const ageDays = Math.max(0, (Date.now() - new Date(paper.published || 0)) / 86400_000);
  const freshness = Math.max(0, 6 - ageDays / 3);
  const text = `${paper.title} ${paper.abstract}`;
  const signals = [
    /reasoning|deliberation|verifier/i, /architecture|mixture[- ]of[- ]experts|\bmoe\b|routing|spars/i,
    /agent|planning|tool[- ]use/i, /reinforcement learning|reward model|alignment/i,
    /multimodal|vision[- ]language|world model/i, /training|inference|quantiz|efficient/i,
    /benchmark|evaluation|generalization|optimization/i
  ].filter(pattern => pattern.test(text)).length;
  return freshness + signals * 2 + (paper.kind === 'preprint' ? 2 : 1);
}
function rankPapers(items) {
  return uniqueNewest(items).sort((a, b) => paperRankScore(b) - paperRankScore(a) || new Date(b.published) - new Date(a.published));
}

function parseArxiv(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const rawId = xmlValue(entry, 'id');
    return {
      id: `arxiv:${rawId.split('/abs/').pop() || rawId}`,
      title: xmlValue(entry, 'title'),
      abstract: xmlValue(entry, 'summary'),
      published: xmlValue(entry, 'published'),
      updated: xmlValue(entry, 'updated'),
      authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map(a => stripHtml(a[1])),
      categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(c => c[1]),
      venue: 'arXiv 预印本',
      link: rawId.replace('http://', 'https://'),
      source: 'arXiv', kind: 'preprint'
    };
  }).filter(item => item.title && item.abstract && item.published);
}

async function fetchArxiv() {
  const query = new URLSearchParams({
    search_query: '(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO)',
    start: '0', max_results: '60', sortBy: 'submittedDate', sortOrder: 'descending'
  });
  const response = await fetch(`https://export.arxiv.org/api/query?${query}`, {
    headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`arXiv HTTP ${response.status}`);
  const papers = parseArxiv(await response.text());
  if (!papers.length) throw new Error('arXiv returned no readable entries');
  return papers;
}

async function fetchCrossrefQuery(queryText, fromDate, toDate) {
  const query = new URLSearchParams({
    'query.title': queryText,
    filter: `from-pub-date:${fromDate},until-pub-date:${toDate},type:journal-article`,
    sort: 'published', order: 'desc', rows: '25'
  });
  if (process.env.CONTACT_EMAIL) query.set('mailto', process.env.CONTACT_EMAIL);
  const response = await fetch(`https://api.crossref.org/works?${query}`, {
    headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
  const body = await response.json();
  return (body.message?.items || []).map(item => ({
    id: `doi:${item.DOI}`,
    title: stripHtml(item.title?.[0]),
    abstract: stripHtml(item.abstract) || `这是一篇已由期刊登记 DOI 的论文。Crossref 当前未提供摘要，请通过原文链接查看完整内容。`,
    published: toIsoDate(item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0]),
    authors: (item.author || []).map(author => [author.given, author.family].filter(Boolean).join(' ')),
    categories: (item.subject || []).slice(0, 3),
    venue: item['container-title']?.[0] || '已发表期刊论文',
    link: item.URL || `https://doi.org/${item.DOI}`,
    source: 'Crossref', kind: 'published', doi: item.DOI
  })).filter(item => item.title && item.published);
}

async function fetchCrossref() {
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 86400_000);
  const iso = date => date.toISOString().slice(0, 10);
  const papers = await fetchCrossrefQuery('machine learning artificial intelligence large language model', iso(from), iso(to));
  const relevant = /machine learning|artificial intelligence|large language|language model|neural network|deep learning|reinforcement learning|transformer|computer vision|multimodal|robot|foundation model|generative model/i;
  return uniqueNewest(papers.filter(paper => relevant.test(`${paper.title} ${paper.abstract} ${paper.categories.join(' ')}`))).slice(0, 24);
}

function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  return blocks.map((block, index) => {
    const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    const link = stripHtml(xmlValue(block, 'link')) || href || '';
    const description = xmlValue(block, 'description') || xmlValue(block, 'summary') || xmlValue(block, 'content:encoded') || xmlValue(block, 'content');
    const published = xmlValue(block, 'pubDate') || xmlValue(block, 'published') || xmlValue(block, 'updated');
    return {
      id: `news:${source}:${xmlValue(block, 'guid') || link || index}`,
      title: stripHtml(xmlValue(block, 'title')),
      summary: stripHtml(description).slice(0, 420),
      published: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
      link, source, kind: 'news'
    };
  }).filter(item => item.title && item.link && item.published);
}

async function fetchNewsFeed(feed) {
  const response = await fetch(feed.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${feed.name} HTTP ${response.status}`);
  const technical = /model|reasoning|alignment|benchmark|evaluation|research|algorithm|architecture|training|inference|robot|multimodal|vision|language|agent|foundation|safety|robust|cryptograph|systems|dataset|simulation|reinforcement|scientific|weather|visualization/i;
  return parseFeed(await response.text(), feed.name).filter(item => technical.test(`${item.title} ${item.summary}`)).slice(0, 12);
}

async function readCache(name) {
  try { return JSON.parse(await readFile(path.join(dataDir, `${name}-cache.json`), 'utf8')); } catch { return null; }
}
async function writeCache(name, payload) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, `${name}-cache.json`), JSON.stringify(payload, null, 2));
}

async function fetchPapers(force = false) {
  const cached = await readCache('papers');
  if (!force && cached?.items?.length && Date.now() - cached.fetchedAt < PAPER_TTL) return { ...cached, stale: false };
  const providers = await Promise.allSettled([fetchArxiv(), fetchCrossref()]);
  const names = ['arXiv', 'Crossref'];
  const errors = providers.flatMap((result, index) => result.status === 'rejected' ? [`${names[index]}：${result.reason.message}`] : []);
  const counts = Object.fromEntries(providers.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value.length : 0]));
  const items = rankPapers(providers.flatMap(result => result.status === 'fulfilled' ? result.value : [])).slice(0, 80);
  if (items.length) {
    const payload = { items, fetchedAt: Date.now(), providers: counts, errors };
    await writeCache('papers', payload); return { ...payload, stale: false };
  }
  if (cached?.items?.length) return { ...cached, stale: true, errors: [...(cached.errors || []), ...errors], warning: '实时源不可用，正在展示最近一次成功缓存。' };
  return { items: [], fetchedAt: null, providers: counts, errors, stale: true, warning: '所有论文源暂时不可用，未使用虚构或示例内容。' };
}

async function fetchNews(force = false) {
  const cached = await readCache('news');
  if (!force && cached?.items?.length && Date.now() - cached.fetchedAt < NEWS_TTL) return { ...cached, stale: false };
  const results = await Promise.allSettled(NEWS_FEEDS.map(fetchNewsFeed));
  const errors = results.flatMap((result, index) => result.status === 'rejected' ? [`${NEWS_FEEDS[index].name}：${result.reason.message}`] : []);
  const counts = Object.fromEntries(results.map((result, index) => [NEWS_FEEDS[index].name, result.status === 'fulfilled' ? result.value.length : 0]));
  const items = uniqueNewest(results.flatMap(result => result.status === 'fulfilled' ? result.value : [])).slice(0, 30);
  if (items.length) {
    const payload = { items, fetchedAt: Date.now(), providers: counts, errors };
    await writeCache('news', payload); return { ...payload, stale: false };
  }
  if (cached?.items?.length) return { ...cached, stale: true, errors, warning: '官方资讯源不可用，正在展示最近一次成功缓存。' };
  return { items: [], fetchedAt: null, providers: counts, errors, stale: true, warning: '官方资讯源暂时不可用。' };
}

function analyze(papers) {
  const scores = TOPICS.map(([name, pattern]) => ({ name, count: papers.filter(paper => pattern.test(`${paper.title} ${paper.abstract}`)).length }));
  const topics = scores.sort((a, b) => b.count - a.count).filter(item => item.count).slice(0, 5);
  const focus = topics[0]?.name || '暂无足够数据';
  return {
    topics,
    summary: papers.length ? `基于最新 ${papers.length} 篇预印本与已发表论文，当前样本中出现最多的主题是「${focus}」。这是批次关键词统计，不等同于全领域热度排名。` : '暂无可靠论文数据，热点分析已暂停。',
    signal: topics.length > 1 ? `当前批次中「${topics[0].name}」与「${topics[1].name}」同时活跃，可优先关注交叉方向。` : '数据量不足，暂不生成趋势判断。'
  };
}

function summarize(paper) {
  const text = paper.abstract.replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  const matches = TOPICS.filter(([, pattern]) => pattern.test(`${paper.title} ${text}`)).map(([name]) => name);
  return {
    topic: matches[0] || '人工智能方法',
    oneLine: `论文聚焦「${matches[0] || '人工智能方法'}」。以下结论严格基于来源摘要，不额外推测实验结果。`,
    keyPoints: sentences.slice(0, 3),
    limitation: paper.abstract.startsWith('这是一篇已由期刊登记 DOI') ? 'Crossref 未提供摘要，当前只能确认题名、作者、期刊和 DOI。' : '这是结构化摘要，不是大模型生成的中文全文解读。'
  };
}

function venueView(venue) {
  let deadline = '官方尚未公布'; let state = 'unannounced'; let daysLeft = null;
  if (venue.rolling) { deadline = '全年滚动收稿'; state = 'rolling'; }
  else if (venue.deadlineAt) {
    daysLeft = Math.ceil((new Date(venue.deadlineAt) - Date.now()) / 86400_000);
    const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(venue.deadlineAt));
    deadline = `${venue.deadlineName}：${date}${daysLeft >= 0 ? `（剩余 ${daysLeft} 天）` : '（已截止）'}`;
    state = daysLeft >= 0 ? 'open' : 'closed';
  }
  return { ...venue, deadline, state, daysLeft };
}

async function checkVenueSites() {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(VENUES.map(async venue => {
    try {
      let response = await fetch(venue.officialUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      if ([403, 405].includes(response.status)) response = await fetch(venue.officialUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      return { name: venue.name, reachable: response.ok, status: response.status, checkedAt };
    } catch (error) { return { name: venue.name, reachable: false, status: null, error: error.message, checkedAt }; }
  }));
  return { results, checkedAt };
}

function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  res.end(JSON.stringify(body));
}
async function api(req, res, url) {
  if (url.pathname === '/api/health') return reply(res, 200, { ok: true, version: '2.0.0', time: new Date().toISOString() });
  if (url.pathname === '/api/papers') { const data = await fetchPapers(url.searchParams.get('refresh') === '1'); return reply(res, 200, data); }
  if (url.pathname === '/api/news') { const data = await fetchNews(url.searchParams.get('refresh') === '1'); return reply(res, 200, data); }
  if (url.pathname === '/api/digest') { const data = await fetchPapers(); return reply(res, 200, { ...analyze(data.items), fetchedAt: data.fetchedAt, stale: data.stale }); }
  if (url.pathname === '/api/summary') {
    const data = await fetchPapers(); const paper = data.items.find(item => item.id === url.searchParams.get('id'));
    return paper ? reply(res, 200, { paper, summary: summarize(paper) }) : reply(res, 404, { error: '未找到论文' });
  }
  if (url.pathname === '/api/venues') return reply(res, 200, { venues: VENUES.map(venueView), generatedAt: new Date().toISOString(), note: '日期来自对应官方页面的人工核验快照；页面会动态计算截止状态。审稿速度不是官方承诺。' });
  if (url.pathname === '/api/venues/check') return reply(res, 200, await checkVenueSites());
  return reply(res, 404, { error: 'Not found' });
}

const PUBLIC_FILES = new Set(['index.html', 'app.js', 'manifest.webmanifest', 'service-worker.js', 'icon.svg']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!PUBLIC_FILES.has(requested)) { res.writeHead(404); return res.end('Not found'); }
    const data = await readFile(path.join(root, requested));
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(requested)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': requested === 'service-worker.js' ? 'no-cache' : 'public, max-age=300'
    }); res.end(data);
  } catch (error) {
    console.error(error); res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Server error');
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`PaperScope running at http://localhost:${PORT}`));

setInterval(() => {
  const now = new Date();
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(now);
  if (time === '06:30' && lastDailySync !== day) {
    lastDailySync = day;
    Promise.allSettled([fetchPapers(true), fetchNews(true)]).then(() => console.log(`Daily sync completed: ${day}`));
  }
}, 60_000).unref();

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const USER_AGENT = `PaperScope/3.0 (${process.env.CONTACT_EMAIL || 'https://github.com/hahha114157-ctrl/Paper-post'})`;

const STATIC_FILES = ['index.html', 'app.js', 'manifest.webmanifest', 'service-worker.js', 'icon.svg'];
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
function toIsoDate(parts) {
  if (!Array.isArray(parts) || !parts.length) return null;
  const [year, month = 1, day = 1] = parts;
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
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => {
    const entry = match[1]; const rawId = xmlValue(entry, 'id');
    return {
      id: `arxiv:${rawId.split('/abs/').pop() || rawId}`, title: xmlValue(entry, 'title'), abstract: xmlValue(entry, 'summary'),
      published: xmlValue(entry, 'published'), updated: xmlValue(entry, 'updated'),
      authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map(author => stripHtml(author[1])),
      categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(category => category[1]),
      venue: 'arXiv 预印本', link: rawId.replace('http://', 'https://'), source: 'arXiv', kind: 'preprint'
    };
  }).filter(item => item.title && item.abstract && item.published);
}
async function fetchArxiv() {
  const query = new URLSearchParams({ search_query: '(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO)', start: '0', max_results: '60', sortBy: 'submittedDate', sortOrder: 'descending' });
  const response = await fetch(`https://export.arxiv.org/api/query?${query}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`arXiv HTTP ${response.status}`);
  const papers = parseArxiv(await response.text());
  if (!papers.length) throw new Error('arXiv returned no readable entries');
  return papers;
}
async function fetchCrossref() {
  const to = new Date(); const from = new Date(to.getTime() - 45 * 86400_000); const iso = date => date.toISOString().slice(0, 10);
  const query = new URLSearchParams({
    'query.title': 'machine learning artificial intelligence large language model',
    filter: `from-pub-date:${iso(from)},until-pub-date:${iso(to)},type:journal-article`, sort: 'published', order: 'desc', rows: '50'
  });
  if (process.env.CONTACT_EMAIL) query.set('mailto', process.env.CONTACT_EMAIL);
  const response = await fetch(`https://api.crossref.org/works?${query}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
  const body = await response.json();
  const papers = (body.message?.items || []).map(item => ({
    id: `doi:${item.DOI}`, title: stripHtml(item.title?.[0]),
    abstract: stripHtml(item.abstract) || '这是一篇已由期刊登记 DOI 的论文。Crossref 当前未提供摘要，请通过原文链接查看完整内容。',
    published: toIsoDate(item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0]),
    authors: (item.author || []).map(author => [author.given, author.family].filter(Boolean).join(' ')), categories: (item.subject || []).slice(0, 3),
    venue: item['container-title']?.[0] || '已发表期刊论文', link: item.URL || `https://doi.org/${item.DOI}`, source: 'Crossref', kind: 'published', doi: item.DOI
  })).filter(item => item.title && item.published);
  const relevant = /machine learning|artificial intelligence|large language|language model|neural network|deep learning|reinforcement learning|transformer|computer vision|multimodal|robot|foundation model|generative model/i;
  return uniqueNewest(papers.filter(paper => relevant.test(`${paper.title} ${paper.abstract} ${paper.categories.join(' ')}`))).slice(0, 24);
}

function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  return blocks.map((block, index) => {
    const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    const link = stripHtml(xmlValue(block, 'link')) || href || '';
    const description = xmlValue(block, 'description') || xmlValue(block, 'summary') || xmlValue(block, 'content:encoded') || xmlValue(block, 'content');
    const rawDate = xmlValue(block, 'pubDate') || xmlValue(block, 'published') || xmlValue(block, 'updated');
    return { id: `news:${source}:${xmlValue(block, 'guid') || link || index}`, title: stripHtml(xmlValue(block, 'title')), summary: stripHtml(description).slice(0, 420), published: rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null, link, source, kind: 'news' };
  }).filter(item => item.title && item.link && item.published);
}
async function fetchNewsFeed(feed) {
  const response = await fetch(feed.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${feed.name} HTTP ${response.status}`);
  const technical = /model|reasoning|alignment|benchmark|evaluation|research|algorithm|architecture|training|inference|robot|multimodal|vision|language|agent|foundation|safety|robust|cryptograph|systems|dataset|simulation|reinforcement|scientific|weather|visualization/i;
  return parseFeed(await response.text(), feed.name).filter(item => technical.test(`${item.title} ${item.summary}`)).slice(0, 12);
}
function analyze(papers) {
  const topics = TOPICS.map(([name, pattern]) => ({ name, count: papers.filter(paper => pattern.test(`${paper.title} ${paper.abstract}`)).length })).sort((a, b) => b.count - a.count).filter(item => item.count).slice(0, 5);
  const focus = topics[0]?.name || '暂无足够数据';
  return {
    topics,
    summary: papers.length ? `基于最新 ${papers.length} 篇预印本与已发表论文，当前样本中出现最多的主题是「${focus}」。这是批次关键词统计，不等同于全领域热度排名。` : '暂无可靠论文数据。',
    signal: topics.length > 1 ? `当前批次中「${topics[0].name}」与「${topics[1].name}」同时活跃，可优先关注交叉方向。` : '数据量不足，暂不生成趋势判断。'
  };
}
function venueView(venue) {
  let deadline = '官方尚未公布'; let state = 'unannounced'; let daysLeft = null;
  if (venue.rolling) { deadline = '全年滚动收稿'; state = 'rolling'; }
  else if (venue.deadlineAt) {
    daysLeft = Math.ceil((new Date(venue.deadlineAt) - Date.now()) / 86400_000);
    const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(venue.deadlineAt));
    deadline = `${venue.deadlineName}：${date}${daysLeft >= 0 ? `（剩余 ${daysLeft} 天）` : '（已截止）'}`; state = daysLeft >= 0 ? 'open' : 'closed';
  }
  return { ...venue, deadline, state, daysLeft };
}
async function settled(name, promise) {
  try { return { name, items: await promise, error: null }; }
  catch (error) { return { name, items: [], error: error.message }; }
}

async function build() {
  const generatedAt = new Date().toISOString();
  const [arxiv, crossref, ...feeds] = await Promise.all([
    settled('arXiv', fetchArxiv()), settled('Crossref', fetchCrossref()),
    ...NEWS_FEEDS.map(feed => settled(feed.name, fetchNewsFeed(feed)))
  ]);
  const papers = rankPapers([...arxiv.items, ...crossref.items]).slice(0, 80);
  const news = uniqueNewest(feeds.flatMap(result => result.items)).slice(0, 30);
  if (papers.length < 10) throw new Error(`Build aborted: only ${papers.length} reliable papers were available.`);
  if (news.length < 3) throw new Error(`Build aborted: only ${news.length} official news items were available.`);

  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'data'), { recursive: true });
  await Promise.all(STATIC_FILES.map(file => copyFile(path.join(root, file), path.join(dist, file))));
  const json = (name, data) => writeFile(path.join(dist, 'data', `${name}.json`), JSON.stringify(data, null, 2));
  await Promise.all([
    json('papers', { items: papers, generatedAt, providers: { arXiv: arxiv.items.length, Crossref: crossref.items.length }, errors: [arxiv, crossref].filter(item => item.error).map(item => `${item.name}：${item.error}`) }),
    json('news', { items: news, generatedAt, providers: Object.fromEntries(feeds.map(feed => [feed.name, feed.items.length])), errors: feeds.filter(feed => feed.error).map(feed => `${feed.name}：${feed.error}`) }),
    json('digest', { ...analyze(papers), generatedAt }),
    json('venues', { venues: VENUES.map(venueView), generatedAt, note: '日期来自对应官方页面的人工核验快照；页面会动态计算截止状态。审稿速度不是官方承诺。' })
  ]);
  console.log(`Built PaperScope: ${papers.length} papers, ${news.length} news items at ${generatedAt}`);
}

build().catch(error => { console.error(error); process.exitCode = 1; });

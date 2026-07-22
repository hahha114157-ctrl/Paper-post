import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const USER_AGENT = `PaperScope/4.0 (${process.env.CONTACT_EMAIL || 'https://github.com/hahha114157-ctrl/Paper-post'})`;
const STATIC_FILES = ['index.html', 'app.js', 'manifest.webmanifest', 'service-worker.js', 'icon.svg'];

const NEWS_FEEDS = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/' }
];

const AI_TOPICS = [
  ['推理与测试时计算', /reasoning|test[- ]time|chain[- ]of[- ]thought|verifier|inference[- ]time|deliberation/i],
  ['智能体与规划', /\bagents?\b|planning|tool[- ]use|multi[- ]agent|workflow|computer use/i],
  ['高效模型体系结构', /mixture[- ]of[- ]experts|\bmoe\b|routing|spars|efficient|quantiz|model architecture/i],
  ['多模态与视觉语言', /multimodal|vision[- ]language|\bvlm\b|image generation|video generation/i],
  ['具身智能与机器人', /robot|embodied|manipulation|world model|navigation/i],
  ['训练、对齐与安全', /reinforcement learning|alignment|preference|post[- ]training|fine[- ]tun|reward model|safety/i]
];

const ARCH_TOPICS = [
  ['AI 加速器与专用芯片', /accelerator|tensor processing|neural processing|\bnpu\b|\bgpu\b|\btpu\b|systolic|domain[- ]specific/i],
  ['存储与内存系统', /memory|cache|dram|hbm|non[- ]volatile|storage|near[- ]data|processing[- ]in[- ]memory/i],
  ['并行、分布式与互连', /parallel|distributed|interconnect|network[- ]on[- ]chip|\bnoc\b|chiplet|manycore|multicore/i],
  ['处理器与微体系结构', /processor|microarchitecture|instruction set|\bisa\b|pipeline|branch prediction|risc[- ]v|out[- ]of[- ]order/i],
  ['性能、能效与可靠性', /performance|energy|power|efficient|reliability|fault|thermal|benchmark/i],
  ['体系结构安全', /side[- ]channel|speculative execution|trusted execution|hardware security|rowhammer|secure processor/i]
];

const VENUES = [
  { area: 'ai', name: 'AAAI', type: '会议', level: 'CCF-A', officialUrl: 'https://aaai.org/conference/aaai/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '年度会议；录用时间以当届 CFP 为准', source: 'AAAI 官方', verifiedAt: '2026-07-22' },
  { area: 'ai', name: 'NeurIPS', type: '会议', level: 'CCF-A', officialUrl: 'https://neurips.cc/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '年度会议；通常采用多轮评审与 rebuttal', source: 'NeurIPS 官方', verifiedAt: '2026-07-22' },
  { area: 'ai', name: 'ICML', type: '会议', level: 'CCF-A · PMLR 收录', officialUrl: 'https://icml.cc/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '年度会议；见刊以 PMLR 论文集发布为准', source: 'ICML 官方', verifiedAt: '2026-07-22' },
  { area: 'ai', name: 'ACL', type: '会议', level: 'CCF-A · ACL Anthology', officialUrl: 'https://www.aclweb.org/portal/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '常经 ARR 评审；录用后收入 ACL Anthology', source: 'ACL 官方', verifiedAt: '2026-07-22' },
  { area: 'ai', name: 'JMLR', type: '期刊', level: '机器学习旗舰期刊', officialUrl: 'https://jmlr.org/author-info.html', rolling: true, speed: '无固定审稿时限；以编辑流程为准', source: 'JMLR 作者指南', verifiedAt: '2026-07-22' },
  { area: 'ai', name: 'TMLR', type: '期刊', level: 'OpenReview · 机器学习', officialUrl: 'https://jmlr.org/tmlr/author-guide.html', rolling: true, speed: '持续评审；时长取决于评审轮次', source: 'TMLR 作者指南', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'ISCA', type: '会议', level: 'CCF-A · ACM/IEEE', officialUrl: 'https://iscaconf.org/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '年度会议；计算机体系结构旗舰会议', source: 'ISCA 官方', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'MICRO', type: '会议', level: 'CCF-A · ACM/IEEE', officialUrl: 'https://www.microarch.org/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '年度会议；录用与出版日期以当届 CFP 为准', source: 'MICRO 官方', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'HPCA', type: '会议', level: 'CCF-A · IEEE', officialUrl: 'https://hpca-conf.org/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '年度会议；通常在会议前数月公布录用结果', source: 'HPCA 官方', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'ASPLOS', type: '会议', level: 'CCF-A · ACM', officialUrl: 'https://www.asplos-conference.org/', rolling: false, deadlineName: '下一届截稿待官方更新', speed: '体系结构、系统与语言交叉会议', source: 'ASPLOS 官方', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'IEEE TC', type: '期刊', level: 'CCF-A · IEEE Computer Society', officialUrl: 'https://www.computer.org/csdl/journal/tc', rolling: true, speed: '全年投稿；审稿时长以编辑流程为准', source: 'IEEE Computer Society', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'ACM TACO', type: '期刊', level: 'CCF-A · ACM', officialUrl: 'https://dl.acm.org/journal/taco', rolling: true, speed: '全年投稿；录用后通常先在线发表', source: 'ACM Digital Library', verifiedAt: '2026-07-22' },
  { area: 'architecture', name: 'IEEE CAL', type: '期刊', level: '体系结构快报 · IEEE', officialUrl: 'https://www.computer.org/csdl/journal/ca', rolling: true, speed: '短文快报；具体周期以官方投稿说明为准', source: 'IEEE Computer Society', verifiedAt: '2026-07-22' }
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
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
}
function paperRankScore(paper, patterns) {
  const ageDays = Math.max(0, (Date.now() - new Date(paper.published || 0)) / 86400_000);
  const freshness = Math.max(0, 8 - ageDays / 5);
  const text = `${paper.title} ${paper.abstract}`;
  const signals = patterns.filter(([, pattern]) => pattern.test(text)).length;
  return freshness + signals * 2 + (paper.abstract.length > 250 ? 1 : 0);
}
function rankPapers(items, patterns) {
  return uniqueNewest(items).sort((a, b) => paperRankScore(b, patterns) - paperRankScore(a, patterns) || new Date(b.published) - new Date(a.published));
}

function parseArxiv(xml, area) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => {
    const entry = match[1];
    const rawId = xmlValue(entry, 'id');
    const doi = xmlValue(entry, 'arxiv:doi');
    const journalRef = xmlValue(entry, 'arxiv:journal_ref');
    return {
      id: `arxiv:${rawId.split('/abs/').pop() || rawId}`,
      arxivId: rawId.split('/abs/').pop() || rawId,
      title: xmlValue(entry, 'title'), abstract: xmlValue(entry, 'summary'),
      published: xmlValue(entry, 'published'), updated: xmlValue(entry, 'updated'),
      authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map(author => stripHtml(author[1])),
      categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(category => category[1]),
      venue: journalRef || 'arXiv 预印本', link: rawId.replace('http://', 'https://'), source: 'arXiv', kind: doi || journalRef ? 'published' : 'preprint',
      doi: doi || null, journalRef: journalRef || null, area,
      publication: doi || journalRef ? { status: 'published', doi: doi || null, venue: journalRef || '已登记 DOI', checkedAt: new Date().toISOString(), source: 'arXiv metadata' } : { status: 'preprint' }
    };
  }).filter(item => item.title && item.abstract && item.published);
}
async function fetchArxiv({ search, maxResults, area }) {
  const query = new URLSearchParams({ search_query: search, start: '0', max_results: String(maxResults), sortBy: 'submittedDate', sortOrder: 'descending' });
  const response = await fetch(`https://export.arxiv.org/api/query?${query}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(35_000) });
  if (!response.ok) throw new Error(`arXiv HTTP ${response.status}`);
  const papers = parseArxiv(await response.text(), area);
  if (!papers.length) throw new Error('arXiv returned no readable entries');
  return papers;
}
async function fetchCrossref({ queryText, relevant, days = 90, limit = 30, area }) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const iso = date => date.toISOString().slice(0, 10);
  const query = new URLSearchParams({
    'query.bibliographic': queryText,
    filter: `from-pub-date:${iso(from)},until-pub-date:${iso(to)}`,
    sort: 'published', order: 'desc', rows: '80'
  });
  if (process.env.CONTACT_EMAIL) query.set('mailto', process.env.CONTACT_EMAIL);
  const response = await fetch(`https://api.crossref.org/works?${query}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(35_000) });
  if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
  const body = await response.json();
  const allowedTypes = new Set(['journal-article', 'proceedings-article', 'posted-content']);
  const papers = (body.message?.items || []).filter(item => allowedTypes.has(item.type)).map(item => ({
    id: `doi:${item.DOI}`, title: stripHtml(item.title?.[0]),
    abstract: stripHtml(item.abstract) || '这是一篇已登记 DOI 的论文。Crossref 当前未提供摘要，请通过原文链接查看完整内容。',
    published: toIsoDate(item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0]),
    authors: (item.author || []).map(author => [author.given, author.family].filter(Boolean).join(' ')),
    categories: (item.subject || []).slice(0, 5), venue: item['container-title']?.[0] || '已发表论文',
    link: item.URL || `https://doi.org/${item.DOI}`, source: 'Crossref', kind: 'published', doi: item.DOI, area,
    publication: { status: 'published', doi: item.DOI, venue: item['container-title']?.[0] || '已登记 DOI', checkedAt: new Date().toISOString(), source: 'Crossref' }
  })).filter(item => item.title && item.published && relevant.test(`${item.title} ${item.abstract} ${item.categories.join(' ')} ${item.venue}`));
  return uniqueNewest(papers).slice(0, limit);
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
  const technical = /model|reasoning|alignment|benchmark|evaluation|research|algorithm|architecture|training|inference|robot|multimodal|vision|language|agent|foundation|safety|systems|dataset|simulation|reinforcement|processor|accelerator|memory/i;
  return parseFeed(await response.text(), feed.name).filter(item => technical.test(`${item.title} ${item.summary}`)).slice(0, 12);
}
function analyze(papers, topicDefs, areaLabel) {
  const topics = topicDefs.map(([name, pattern]) => ({ name, count: papers.filter(paper => pattern.test(`${paper.title} ${paper.abstract}`)).length })).sort((a, b) => b.count - a.count).filter(item => item.count).slice(0, 6);
  const focus = topics[0]?.name || '暂无足够数据';
  return {
    topics,
    summary: papers.length ? `基于最新 ${papers.length} 篇${areaLabel}预印本与已发表论文，当前样本中出现最多的主题是「${focus}」。这是本批次关键词统计，不等同于全领域热度排名。` : '暂无可靠论文数据。',
    signal: topics.length > 1 ? `当前批次中「${topics[0].name}」与「${topics[1].name}」同时活跃，可优先关注两者的交叉方向。` : '数据量不足，暂不生成趋势判断。'
  };
}
function venueView(venue) {
  let deadline = venue.deadlineName || '官方尚未公布';
  let state = 'unannounced';
  let daysLeft = null;
  if (venue.rolling) { deadline = '全年滚动收稿'; state = 'rolling'; }
  else if (venue.deadlineAt) {
    daysLeft = Math.ceil((new Date(venue.deadlineAt) - Date.now()) / 86400_000);
    const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(venue.deadlineAt));
    deadline = `${venue.deadlineName}：${date}${daysLeft >= 0 ? `（剩余 ${daysLeft} 天）` : '（已截止）'}`;
    state = daysLeft >= 0 ? 'open' : 'closed';
  }
  return { ...venue, deadline, state, daysLeft };
}
async function settled(name, promise) {
  try { return { name, items: await promise, error: null }; }
  catch (error) { return { name, items: [], error: error.message }; }
}

async function build() {
  const generatedAt = new Date().toISOString();
  const aiRelevant = /machine learning|artificial intelligence|large language|language model|neural network|deep learning|reinforcement learning|transformer|computer vision|multimodal|robot|foundation model|generative model/i;
  const archRelevant = /computer architecture|microarchitecture|processor|accelerator|memory system|cache|interconnect|chiplet|risc-v|hardware security|manycore|multicore|processing-in-memory|energy efficiency/i;
  const [aiArxiv, aiCrossref, archArxiv, archCrossref, ...feeds] = await Promise.all([
    settled('arXiv AI', fetchArxiv({ search: '(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO)', maxResults: 70, area: 'ai' })),
    settled('Crossref AI', fetchCrossref({ queryText: 'machine learning artificial intelligence large language model', relevant: aiRelevant, days: 60, limit: 30, area: 'ai' })),
    settled('arXiv Architecture', fetchArxiv({ search: '(cat:cs.AR OR cat:cs.DC OR cat:cs.PF)', maxResults: 80, area: 'architecture' })),
    settled('Crossref Architecture', fetchCrossref({ queryText: 'computer architecture processor accelerator memory systems', relevant: archRelevant, days: 120, limit: 30, area: 'architecture' })),
    ...NEWS_FEEDS.map(feed => settled(feed.name, fetchNewsFeed(feed)))
  ]);
  const aiPapers = rankPapers([...aiArxiv.items, ...aiCrossref.items], AI_TOPICS).slice(0, 100);
  const architecturePapers = rankPapers([...archArxiv.items, ...archCrossref.items], ARCH_TOPICS).slice(0, 100);
  const news = uniqueNewest(feeds.flatMap(result => result.items)).slice(0, 30);
  if (aiPapers.length < 10) throw new Error(`Build aborted: only ${aiPapers.length} reliable AI papers were available.`);
  if (architecturePapers.length < 10) throw new Error(`Build aborted: only ${architecturePapers.length} architecture papers were available.`);
  if (news.length < 3) throw new Error(`Build aborted: only ${news.length} official news items were available.`);

  const aiDigest = analyze(aiPapers, AI_TOPICS, '人工智能');
  const architectureDigest = analyze(architecturePapers, ARCH_TOPICS, '计算机体系结构');
  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'data'), { recursive: true });
  await Promise.all(STATIC_FILES.map(file => copyFile(path.join(root, file), path.join(dist, file))));
  const json = (name, data) => writeFile(path.join(dist, 'data', `${name}.json`), JSON.stringify(data, null, 2));
  await Promise.all([
    json('papers', { items: aiPapers, generatedAt, providers: { arXiv: aiArxiv.items.length, Crossref: aiCrossref.items.length }, errors: [aiArxiv, aiCrossref].filter(item => item.error).map(item => `${item.name}：${item.error}`) }),
    json('architecture', { items: architecturePapers, ...architectureDigest, generatedAt, providers: { arXiv: archArxiv.items.length, Crossref: archCrossref.items.length }, errors: [archArxiv, archCrossref].filter(item => item.error).map(item => `${item.name}：${item.error}`) }),
    json('news', { items: news, generatedAt, providers: Object.fromEntries(feeds.map(feed => [feed.name, feed.items.length])), errors: feeds.filter(feed => feed.error).map(feed => `${feed.name}：${feed.error}`) }),
    json('digest', { ...aiDigest, generatedAt }),
    json('venues', { venues: VENUES.map(venueView), generatedAt, note: '会议与期刊入口指向官方页面；未核验到明确日期时不会猜测截止时间。审稿速度为流程说明，不是官方时限承诺。' })
  ]);
  console.log(`Built PaperScope: ${aiPapers.length} AI papers, ${architecturePapers.length} architecture papers, ${news.length} news items at ${generatedAt}`);
}

build().catch(error => { console.error(error); process.exitCode = 1; });

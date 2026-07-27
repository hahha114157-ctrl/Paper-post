import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const USER_AGENT = `PaperScope/5.1 (${process.env.CONTACT_EMAIL || 'https://github.com/hahha114157-ctrl/Paper-post'})`;
const STATIC_FILES = ['index.html', 'app.js', 'manifest.webmanifest', 'service-worker.js', 'icon.svg'];
const DAY = 86_400_000;
const now = new Date();
const currentYear = now.getUTCFullYear();

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

const HOT_SIGNALS = /reasoning|inference|agent|multimodal|vision.language|foundation model|language model|alignment|reinforcement|world model|robot|mixture.of.experts|sparse|efficient|scaling|benchmark|accelerator|processor|microarchitecture|memory|cache|interconnect|chiplet|risc.v|hardware security/i;

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

const CROSSREF_VENUE_SOURCES = [
  { id: 'cvpr', name: 'CVPR', query: 'Conference on Computer Vision and Pattern Recognition', match: /Computer Vision and Pattern Recognition|\bCVPR\b/i, area: 'ai', type: '会议', home: 'https://cvpr.thecvf.com/', tier: '旗舰会议' },
  { id: 'tpami', name: 'IEEE TPAMI', query: 'IEEE Transactions on Pattern Analysis and Machine Intelligence', match: /Pattern Analysis and Machine Intelligence/i, area: 'ai', type: '期刊', home: 'https://www.computer.org/csdl/journal/tp', tier: '旗舰期刊' },
  { id: 'isca', name: 'ISCA', query: 'International Symposium on Computer Architecture', match: /International Symposium on Computer Architecture|\bISCA\b/i, area: 'architecture', type: '会议', home: 'https://iscaconf.org/', tier: '旗舰会议' },
  { id: 'micro', name: 'MICRO', query: 'International Symposium on Microarchitecture', match: /International Symposium on Microarchitecture|\bMICRO\b/i, area: 'architecture', type: '会议', home: 'https://www.microarch.org/', tier: '旗舰会议' },
  { id: 'hpca', name: 'HPCA', query: 'International Symposium on High-Performance Computer Architecture', match: /High.Performance Computer Architecture|\bHPCA\b/i, area: 'architecture', type: '会议', home: 'https://hpca-conf.org/', tier: '旗舰会议' },
  { id: 'asplos', name: 'ASPLOS', query: 'Architectural Support for Programming Languages and Operating Systems', match: /Architectural Support for Programming Languages|\bASPLOS\b/i, area: 'architecture', type: '会议', home: 'https://www.asplos-conference.org/', tier: '旗舰会议' },
  { id: 'ieee-tc', name: 'IEEE TC', query: 'IEEE Transactions on Computers', match: /IEEE Transactions on Computers/i, area: 'architecture', type: '期刊', home: 'https://www.computer.org/csdl/journal/tc', tier: '旗舰期刊' },
  { id: 'taco', name: 'ACM TACO', query: 'ACM Transactions on Architecture and Code Optimization', match: /Architecture and Code Optimization/i, area: 'architecture', type: '期刊', home: 'https://dl.acm.org/journal/taco', tier: '旗舰期刊' }
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
  return match ? stripHtml(match[1]) : '';
}
function toIsoDate(parts) {
  if (!Array.isArray(parts) || !parts.length) return null;
  const [year, month = 1, day = 1] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function normalizeTitle(value = '') { return stripHtml(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim(); }
function uniquePreservingOrder(items) {
  const seen = new Set();
  return items.filter(item => { const key = normalizeTitle(item.title); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
function uniqueNewest(items) { return uniquePreservingOrder([...items].sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0))); }
function stableId(value = '') { return value.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(-90); }
function topicSignals(paper, patterns) { const text = `${paper.title} ${paper.abstract}`; return patterns.filter(([, pattern]) => pattern.test(text)).length; }
function paperRankScore(paper, patterns) {
  const ageDays = Math.max(0, (Date.now() - new Date(paper.published || 0)) / DAY);
  const recency = ageDays <= 550 ? 8 : ageDays <= 900 ? 4 : 0;
  const venue = paper.quality?.tier ? 38 : paper.kind === 'published' ? 10 : 0;
  const official = paper.quality?.official ? 20 : 0;
  const citations = Math.min(20, Math.log2(Number(paper.citationCount || 0) + 1) * 4);
  const track = /award|oral|spotlight/i.test(paper.track || '') ? 10 : 0;
  return venue + official + citations + track + recency + topicSignals(paper, patterns) * 3 + (paper.abstract?.length > 280 ? 2 : 0);
}
function rankPapers(items, patterns) {
  return uniquePreservingOrder(items).map(paper => {
    const score = Math.round(paperRankScore(paper, patterns));
    const reasons = [...(paper.quality?.reasons || [])];
    if (paper.quality?.tier && !reasons.includes(paper.quality.tier)) reasons.push(paper.quality.tier);
    if (paper.quality?.official && !reasons.includes('官方论文集/出版页可核验')) reasons.push('官方论文集/出版页可核验');
    if (paper.citationCount) reasons.push(`Crossref 被引 ${paper.citationCount} 次`);
    if (topicSignals(paper, patterns)) reasons.push('命中重点研究方向');
    return { ...paper, qualityScore: score, quality: { ...(paper.quality || {}), score, reasons: [...new Set(reasons)].slice(0, 4) } };
  }).sort((a, b) => b.qualityScore - a.qualityScore || new Date(b.published || 0) - new Date(a.published || 0));
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function fetchText(url, timeout = 45_000) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,application/json;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(timeout) });
    if (response.ok) return response.text();
    if (![429, 502, 503].includes(response.status) || attempt === 2) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1_200 * (attempt + 1));
  }
  throw new Error(`${new URL(url).hostname} request failed`);
}
async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; try { output[index] = await mapper(items[index], index); } catch { output[index] = items[index]; } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}
function metaValues(html, key) {
  return [...html.matchAll(/<meta\s+[^>]*>/gi)].map(match => match[0]).filter(tag => new RegExp(`(?:name|property)=["']${key}["']`, 'i').test(tag)).map(tag => xmlDecode(tag.match(/content=["']([\s\S]*?)["']/i)?.[1] || '')).filter(Boolean);
}
function pageAbstract(html) {
  return stripHtml(metaValues(html, 'citation_abstract')[0] || html.match(/<(?:div|section)[^>]+(?:id|class)=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i)?.[1] || html.match(/<h[234][^>]*>\s*Abstract\s*<\/h[234]>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || metaValues(html, 'description')[0] || '');
}

function parseArxiv(xml, area) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => {
    const entry = match[1]; const rawId = xmlValue(entry, 'id'); const doi = xmlValue(entry, 'arxiv:doi'); const journalRef = xmlValue(entry, 'arxiv:journal_ref');
    return {
      id: `arxiv:${rawId.split('/abs/').pop() || rawId}`, arxivId: rawId.split('/abs/').pop() || rawId,
      title: xmlValue(entry, 'title'), abstract: xmlValue(entry, 'summary'), published: xmlValue(entry, 'published'), updated: xmlValue(entry, 'updated'),
      authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map(author => stripHtml(author[1])), categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(category => category[1]),
      venue: journalRef || 'arXiv 预印本', link: rawId.replace('http://', 'https://'), source: 'arXiv', kind: doi || journalRef ? 'published' : 'preprint', doi: doi || null, journalRef: journalRef || null, area,
      publication: doi || journalRef ? { status: 'published', doi: doi || null, venue: journalRef || '已登记 DOI', published: null, arxivDate: xmlValue(entry, 'published'), checkedAt: new Date().toISOString(), source: 'arXiv metadata' } : { status: 'preprint', arxivDate: xmlValue(entry, 'published') }
    };
  }).filter(item => item.title && item.abstract && item.published);
}
async function fetchArxiv({ search, maxResults, area }) {
  const query = new URLSearchParams({ search_query: search, start: '0', max_results: String(maxResults), sortBy: 'submittedDate', sortOrder: 'descending' });
  const papers = parseArxiv(await fetchText(`https://export.arxiv.org/api/query?${query}`, 40_000), area);
  if (!papers.length) throw new Error('arXiv returned no readable entries');
  return papers;
}

function crossrefPaper(item, area, extras = {}) {
  const published = toIsoDate(item.published?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0] || item.issued?.['date-parts']?.[0]);
  const container = item['container-title']?.[0] || extras.name || '已发表论文';
  return {
    id: `doi:${item.DOI}`, title: stripHtml(item.title?.[0]), abstract: stripHtml(item.abstract) || '出版元数据已核验，但当前来源未提供机器可读摘要；请通过出版方页面阅读全文。', published,
    authors: (item.author || []).map(author => [author.given, author.family].filter(Boolean).join(' ')), categories: (item.subject || []).slice(0, 5), venue: extras.name || container,
    venueName: extras.name || container, venueYear: published ? new Date(published).getUTCFullYear() : null, venueType: extras.type || (item.type === 'journal-article' ? '期刊' : '会议'), track: extras.track || '',
    link: item.URL || `https://doi.org/${item.DOI}`, officialUrl: item.URL || `https://doi.org/${item.DOI}`, source: extras.source || 'Crossref', kind: 'published', doi: item.DOI, area, citationCount: Number(item['is-referenced-by-count'] || 0),
    publication: { status: 'published', doi: item.DOI, venue: extras.name || container, published, datePrecision: 'day', url: item.URL || `https://doi.org/${item.DOI}`, checkedAt: new Date().toISOString(), source: extras.source || 'Crossref' },
    quality: extras.tier ? { tier: extras.tier, official: true, reasons: [extras.tier, 'DOI 与出版方页面可核验'] } : undefined
  };
}
async function fetchCrossref({ queryText, relevant, days = 500, limit = 35, area }) {
  const from = new Date(Date.now() - days * DAY); const iso = date => date.toISOString().slice(0, 10);
  const query = new URLSearchParams({ 'query.bibliographic': queryText, filter: `from-pub-date:${iso(from)},until-pub-date:${iso(now)}`, sort: 'is-referenced-by-count', order: 'desc', rows: '100' });
  if (process.env.CONTACT_EMAIL) query.set('mailto', process.env.CONTACT_EMAIL);
  const body = JSON.parse(await fetchText(`https://api.crossref.org/works?${query}`));
  const allowedTypes = new Set(['journal-article', 'proceedings-article', 'posted-content']);
  const papers = (body.message?.items || []).filter(item => allowedTypes.has(item.type)).map(item => crossrefPaper(item, area)).filter(item => { const text = `${item.title} ${item.abstract} ${item.categories.join(' ')} ${item.venue}`; return item.title && item.published && relevant.test(text) && !(area === 'architecture' && /meta.analysis|clinical|medical research|particle accelerator|oncology|drug discovery/i.test(text)); });
  return uniquePreservingOrder(papers).slice(0, limit);
}
async function enrichWithArxivFallback(papers, area) {
  const missing = papers.filter(paper => !paper.abstract || paper.abstract.startsWith('出版元数据')).slice(0, 8); if (!missing.length) return papers;
  const terms = missing.map(paper => `ti:"${paper.title.replace(/["():]/g, ' ')}"`); const query = new URLSearchParams({ search_query: `(${terms.join(' OR ')})`, start: '0', max_results: String(Math.max(16, terms.length * 3)), sortBy: 'relevance', sortOrder: 'descending' });
  try {
    const matches = parseArxiv(await fetchText(`https://export.arxiv.org/api/query?${query}`, 45_000), area); const byTitle = new Map(matches.map(item => [normalizeTitle(item.title), item]));
    return papers.map(paper => { const match = byTitle.get(normalizeTitle(paper.title)); return match ? { ...paper, abstract: match.abstract, authors: paper.authors?.length ? paper.authors : match.authors, arxivUrl: match.link, arxivId: match.arxivId } : paper; });
  } catch { return papers; }
}
async function fetchCrossrefVenue(config) {
  const query = new URLSearchParams({ 'query.container-title': config.query, filter: `from-pub-date:${currentYear - 1}-01-01,until-pub-date:${now.toISOString().slice(0, 10)}`, rows: '100', select: 'DOI,title,abstract,author,container-title,published,published-online,issued,URL,type,subject,is-referenced-by-count' });
  if (process.env.CONTACT_EMAIL) query.set('mailto', process.env.CONTACT_EMAIL);
  const body = JSON.parse(await fetchText(`https://api.crossref.org/works?${query}`));
  const expectedType = config.type === '期刊' ? 'journal-article' : 'proceedings-article';
  const papers = (body.message?.items || []).filter(item => item.type === expectedType && config.match.test(item['container-title']?.[0] || '')).map(item => crossrefPaper(item, config.area, { name: config.name, type: config.type, source: 'Crossref · 出版方 DOI', tier: config.tier }));
  const groups = Map.groupBy(uniquePreservingOrder(papers), paper => paper.venueYear || currentYear - 1);
  const years = [...groups.keys()].sort((a, b) => b - a); const chosenYear = years.find(year => groups.get(year).length >= 4) || years[0];
  const items = await enrichWithArxivFallback((groups.get(chosenYear) || []).sort((a, b) => b.citationCount - a.citationCount).slice(0, 16), config.area);
  return { id: `${config.id}-${chosenYear || currentYear}`, venue: config.name, year: chosenYear || currentYear, type: config.type, area: config.area, title: `${config.name} ${chosenYear || ''} · ${config.type === '期刊' ? '年度高影响力论文' : '正式收录论文'}`.trim(), subtitle: `${config.tier}；按正式出版与 Crossref 被引信号排序`, officialUrl: config.home, source: 'Crossref / 出版方 DOI', items };
}

function candidateTitleScore(title, area = 'ai') {
  const patterns = area === 'architecture' ? ARCH_TOPICS : AI_TOPICS;
  return topicSignals({ title, abstract: '' }, patterns) * 4 + (HOT_SIGNALS.test(title) ? 5 : 0);
}
function selectOfficialCandidates(items, area = 'ai', limit = 18) {
  const ranked = [...items].sort((a, b) => candidateTitleScore(b.title, area) - candidateTitleScore(a.title, area));
  const focused = ranked.filter(item => candidateTitleScore(item.title, area) > 0);
  return uniquePreservingOrder([...(focused.slice(0, limit)), ...(focused.length < Math.min(12, limit) ? ranked.slice(0, limit) : [])]).slice(0, limit);
}
async function fetchPmlrCollection() {
  const volume = 'v267'; const year = 2025; const feedUrl = `https://proceedings.mlr.press/${volume}/feed.xml`;
  const xml = await fetchText(feedUrl, 55_000);
  let candidates = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => {
    const entry = match[1]; const link = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']alternate["']/i)?.[1] || entry.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const authorText = xmlValue(entry, 'name'); const authors = [...authorText.matchAll(/"given"=>"([^"]+)"\s*,\s*"family"=>"([^"]+)"/g)].map(item => `${item[1]} ${item[2]}`);
    return { id: `official:pmlr:${stableId(link)}`, title: xmlValue(entry, 'title'), abstract: '', authors, published: xmlValue(entry, 'published') || `${year}-01-01T00:00:00.000Z`, venue: 'ICML', venueName: 'ICML', venueYear: year, venueType: '会议', track: 'Main Conference', link, officialUrl: link, source: 'PMLR · ICML 官方论文集', kind: 'published', area: 'ai', publication: { status: 'published', venue: 'ICML', published: xmlValue(entry, 'published'), datePrecision: 'day', url: link, source: 'PMLR 官方论文集' }, quality: { tier: '旗舰会议', official: true, reasons: ['ICML 正式收录', 'PMLR 官方论文集'] } };
  }).filter(item => item.title && item.link);
  candidates = selectOfficialCandidates(candidates);
  const items = await mapLimit(candidates, 6, async paper => { const html = await fetchText(paper.link, 35_000); return { ...paper, abstract: pageAbstract(html) || 'PMLR 官方论文页当前未提供机器可读摘要，请打开原文查看。', authors: metaValues(html, 'citation_author').length ? metaValues(html, 'citation_author') : paper.authors }; });
  return { id: `icml-${year}`, venue: 'ICML', year, type: '会议', area: 'ai', title: `ICML ${year} · PMLR 正式论文集`, subtitle: '旗舰机器学习会议；优先选择重点方向论文，不按上传日期追新', officialUrl: `https://proceedings.mlr.press/${volume}/`, source: 'PMLR 官方论文集', items };
}
async function fetchNeuripsCollection() {
  let year; let html; let listingUrl;
  for (const candidateYear of [currentYear, currentYear - 1]) {
    try { const url = `https://proceedings.neurips.cc/paper_files/paper/${candidateYear}`; const body = await fetchText(url, 60_000); if ((body.match(/Abstract-/g) || []).length > 20) { year = candidateYear; html = body; listingUrl = url; break; } } catch {}
  }
  if (!html) throw new Error('NeurIPS proceedings not available');
  let candidates = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(match => {
    const block = match[1]; const anchor = block.match(/<a[^>]+href=["']([^"']*Abstract-(?:Conference|Datasets_and_Benchmarks|Position_Paper)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i); if (!anchor) return null;
    const link = new URL(anchor[1], listingUrl).href; const title = stripHtml(anchor[2]); const remainder = stripHtml(block.replace(anchor[0], '')); const track = /Datasets and Benchmarks/i.test(remainder) ? 'Datasets and Benchmarks Track' : /Position Paper/i.test(remainder) ? 'Position Paper Track' : 'Main Conference Track';
    return { id: `official:neurips:${stableId(link)}`, title, abstract: '', authors: remainder.replace(/Main Conference Track|Datasets and Benchmarks Track|Position Paper Track/gi, '').split(',').map(name => name.trim()).filter(Boolean), published: `${year}-01-01T00:00:00.000Z`, venue: 'NeurIPS', venueName: 'NeurIPS', venueYear: year, venueType: '会议', track, link, officialUrl: link, source: 'NeurIPS Proceedings', kind: 'published', area: 'ai', publication: { status: 'published', venue: 'NeurIPS', published: `${year}-01-01T00:00:00.000Z`, datePrecision: 'year', url: link, source: 'NeurIPS 官方论文集' }, quality: { tier: '旗舰会议', official: true, reasons: ['NeurIPS 正式收录', '官方 Proceedings'] } };
  }).filter(Boolean);
  candidates = selectOfficialCandidates(candidates);
  const items = await mapLimit(candidates, 6, async paper => { const page = await fetchText(paper.link, 35_000); return { ...paper, abstract: pageAbstract(page) || 'NeurIPS 官方论文页当前未提供机器可读摘要，请打开原文查看。', authors: metaValues(page, 'citation_author').length ? metaValues(page, 'citation_author') : paper.authors }; });
  return { id: `neurips-${year}`, venue: 'NeurIPS', year, type: '会议', area: 'ai', title: `NeurIPS ${year} · 官方论文集`, subtitle: '旗舰机器学习会议；从正式收录论文中按重点方向筛选', officialUrl: listingUrl, source: 'NeurIPS Proceedings', items };
}
async function fetchAclCollection() {
  let year; let xml;
  for (const candidateYear of [currentYear, currentYear - 1]) { try { const body = await fetchText(`https://raw.githubusercontent.com/acl-org/acl-anthology/master/data/xml/${candidateYear}.acl.xml`, 60_000); if (body.includes('<volume id="long"')) { year = candidateYear; xml = body; break; } } catch {} }
  if (!xml) throw new Error('ACL Anthology metadata not available');
  const volume = xml.match(/<volume id="long"[\s\S]*?<\/volume>/i)?.[0]; if (!volume) throw new Error('ACL long-paper volume missing');
  let items = [...volume.matchAll(/<paper id="([^"]+)"[^>]*>([\s\S]*?)<\/paper>/gi)].map(match => {
    const paper = match[2]; const anthologyId = xmlValue(paper, 'url'); const doi = xmlValue(paper, 'doi'); const authors = [...paper.matchAll(/<author[^>]*>([\s\S]*?)<\/author>/gi)].map(author => `${xmlValue(author[1], 'first')} ${xmlValue(author[1], 'last')}`.trim()).filter(Boolean); const link = `https://aclanthology.org/${anthologyId}/`;
    return { id: `official:acl:${anthologyId}`, title: xmlValue(paper, 'title'), abstract: xmlValue(paper, 'abstract'), authors, published: `${year}-07-01T00:00:00.000Z`, venue: 'ACL', venueName: 'ACL', venueYear: year, venueType: '会议', track: 'Long Papers', link, officialUrl: link, source: 'ACL Anthology', kind: 'published', doi: doi || null, area: 'ai', publication: { status: 'published', doi: doi || null, venue: 'ACL', published: `${year}-07-01T00:00:00.000Z`, datePrecision: 'month', url: link, source: 'ACL Anthology 官方元数据' }, quality: { tier: '旗舰会议', official: true, reasons: ['ACL 长文正式收录', 'ACL Anthology 可核验'] } };
  }).filter(item => item.title && item.abstract);
  items = selectOfficialCandidates(items);
  return { id: `acl-${year}`, venue: 'ACL', year, type: '会议', area: 'ai', title: `ACL ${year} · Long Papers`, subtitle: '旗舰自然语言处理会议；正式长文专栏', officialUrl: `https://aclanthology.org/events/acl-${year}/`, source: 'ACL Anthology 官方元数据', items };
}

function mergePaperSources(items) {
  const grouped = Map.groupBy(items, item => normalizeTitle(item.title)); const output = [];
  for (const variants of grouped.values()) {
    variants.sort((a, b) => Number(Boolean(b.quality?.official)) - Number(Boolean(a.quality?.official)) || Number(Boolean(b.doi)) - Number(Boolean(a.doi)) || Number(b.kind === 'published') - Number(a.kind === 'published'));
    const primary = { ...variants[0] }; const arxiv = variants.find(item => item.source === 'arXiv'); const rich = variants.find(item => item.abstract && !item.abstract.startsWith('出版元数据') && item.abstract.length > 160);
    if ((!primary.abstract || primary.abstract.startsWith('出版元数据')) && rich) primary.abstract = rich.abstract;
    if ((!primary.authors || !primary.authors.length) && rich?.authors) primary.authors = rich.authors;
    if (arxiv && primary.source !== 'arXiv') { primary.arxivUrl = arxiv.link; primary.arxivId = arxiv.arxivId; }
    output.push(primary);
  }
  return output;
}

function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  return blocks.map((block, index) => { const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]; const link = stripHtml(xmlValue(block, 'link')) || href || ''; const description = xmlValue(block, 'description') || xmlValue(block, 'summary') || xmlValue(block, 'content:encoded') || xmlValue(block, 'content'); const rawDate = xmlValue(block, 'pubDate') || xmlValue(block, 'published') || xmlValue(block, 'updated'); return { id: `news:${source}:${xmlValue(block, 'guid') || link || index}`, title: stripHtml(xmlValue(block, 'title')), summary: stripHtml(description).slice(0, 420), published: rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null, link, source, kind: 'news' }; }).filter(item => item.title && item.link && item.published);
}
async function fetchNewsFeed(feed) {
  const technical = /model|reasoning|alignment|benchmark|evaluation|research|algorithm|architecture|training|inference|robot|multimodal|vision|language|agent|foundation|safety|systems|dataset|simulation|reinforcement|processor|accelerator|memory/i;
  return parseFeed(await fetchText(feed.url, 35_000), feed.name).filter(item => technical.test(`${item.title} ${item.summary}`)).slice(0, 12);
}
function analyze(papers, topicDefs, areaLabel) {
  const topics = topicDefs.map(([name, pattern]) => ({ name, count: papers.filter(paper => pattern.test(`${paper.title} ${paper.abstract}`)).length })).sort((a, b) => b.count - a.count).filter(item => item.count).slice(0, 6); const focus = topics[0]?.name || '暂无足够数据';
  return { topics, summary: papers.length ? `基于 ${papers.length} 篇${areaLabel}论文的顶会/期刊质量信号与主题统计，当前精选池中「${focus}」最活跃。排序不以最近几天上传为主要标准。` : '暂无可靠论文数据。', signal: topics.length > 1 ? `「${topics[0].name}」与「${topics[1].name}」在高质量论文池中同时活跃，可优先关注两者交叉方向。` : '数据量不足，暂不生成趋势判断。' };
}
function venueView(venue) {
  let deadline = venue.deadlineName || '官方尚未公布'; let state = 'unannounced'; let daysLeft = null;
  if (venue.rolling) { deadline = '全年滚动收稿'; state = 'rolling'; }
  else if (venue.deadlineAt) { daysLeft = Math.ceil((new Date(venue.deadlineAt) - Date.now()) / DAY); const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(venue.deadlineAt)); deadline = `${venue.deadlineName}：${date}${daysLeft >= 0 ? `（剩余 ${daysLeft} 天）` : '（已截止）'}`; state = daysLeft >= 0 ? 'open' : 'closed'; }
  return { ...venue, deadline, state, daysLeft };
}
async function settled(name, promise) { try { return { name, items: await promise, error: null }; } catch (error) { return { name, items: [], error: error.message }; } }

function shanghaiDate(offset = 0) { const shifted = new Date(Date.now() + 8 * 3_600_000 + offset * DAY); return shifted.toISOString().slice(0, 10); }
function dailyPlan(papers) {
  const pool = papers.filter(paper => paper.qualityScore >= 55 && paper.abstract?.length > 180 && !paper.abstract.startsWith('出版元数据') && (topicSignals(paper, paper.area === 'architecture' ? ARCH_TOPICS : AI_TOPICS) || HOT_SIGNALS.test(paper.title))); const buckets = Map.groupBy(pool, paper => paper.venueName || paper.venue || paper.source); const balanced = []; let active = [...buckets.values()].map(items => [...items].sort((a, b) => b.qualityScore + candidateTitleScore(b.title, b.area) * 2 - a.qualityScore - candidateTitleScore(a.title, a.area) * 2).slice(0, 8));
  while (active.some(items => items.length)) { for (const items of active) if (items.length) balanced.push(items.shift()); active = active.filter(items => items.length); }
  const candidates = balanced.length >= 7 ? balanced : papers.slice(0, 30); const epochDay = Math.floor((Date.now() + 8 * 3_600_000) / DAY); const offset = candidates.length ? epochDay % candidates.length : 0;
  const items = Array.from({ length: Math.min(14, Math.max(1, candidates.length)) }, (_, index) => { const paper = candidates[(offset + index) % candidates.length]; const topics = (paper.area === 'architecture' ? ARCH_TOPICS : AI_TOPICS).filter(([, pattern]) => pattern.test(`${paper.title} ${paper.abstract}`)).map(([name]) => name); return { date: shanghaiDate(index), paperId: paper.id, reason: [...(paper.quality?.reasons || []), topics[0] ? `主题：${topics[0]}` : null].filter(Boolean).slice(0, 3).join('；'), readingPlan: ['5 分钟：先看摘要、图表与结论，写下论文要解决的问题', '15 分钟：精读方法或体系结构设计，标出关键假设', '15 分钟：核对实验设置、基线与主要结果', '10 分钟：记录局限、可复现点和与你研究的连接'], focusQuestions: ['核心创新相对已有工作改变了什么？', '实验或评估是否足以支持主要结论？', '这篇论文最值得复用的方法或思路是什么？'] }; });
  return { timezone: 'Asia/Shanghai', cadence: '每天 06:30 更新数据；北京时间零点后切换当日推荐', methodology: '先筛选旗舰会议/期刊正式收录论文，再结合官方来源、被引信号、重点主题和年份轮换；新鲜度仅为弱信号。', items };
}

async function build() {
  const generatedAt = new Date().toISOString();
  const aiRelevant = /machine learning|artificial intelligence|large language|language model|neural network|deep learning|reinforcement learning|transformer|computer vision|multimodal|robot|foundation model|generative model/i;
  const archRelevant = /computer architecture|microarchitecture|processor|accelerator|memory system|cache|interconnect|chiplet|risc-v|hardware security|manycore|multicore|processing-in-memory|energy efficiency/i;
  const baseTasks = [
    settled('arXiv AI', fetchArxiv({ search: '(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO)', maxResults: 80, area: 'ai' })),
    settled('Crossref AI', fetchCrossref({ queryText: 'machine learning artificial intelligence large language model', relevant: aiRelevant, days: 550, limit: 35, area: 'ai' })),
    settled('arXiv Architecture', fetchArxiv({ search: '(cat:cs.AR OR cat:cs.DC OR cat:cs.PF)', maxResults: 90, area: 'architecture' })),
    settled('Crossref Architecture', fetchCrossref({ queryText: 'computer architecture processor accelerator memory systems', relevant: archRelevant, days: 700, limit: 35, area: 'architecture' })),
    settled('ICML / PMLR', fetchPmlrCollection()), settled('NeurIPS Proceedings', fetchNeuripsCollection()), settled('ACL Anthology', fetchAclCollection()),
    ...NEWS_FEEDS.map(feed => settled(feed.name, fetchNewsFeed(feed)))
  ];
  const results = await Promise.all(baseTasks); const [aiArxiv, aiCrossref, archArxiv, archCrossref, ...rest] = results;
  const officialCollectionResults = rest.slice(0, 3); const feeds = rest.slice(3);
  const crossrefCollectionResults = [];
  for (const config of CROSSREF_VENUE_SOURCES) {
    crossrefCollectionResults.push(await settled(`${config.name} collection`, fetchCrossrefVenue(config)));
    await sleep(650);
  }
  const collectionResults = [...officialCollectionResults, ...crossrefCollectionResults];
  const sections = collectionResults.filter(result => !result.error && result.items?.items?.length).map(result => result.items);
  const curatedPapers = sections.flatMap(section => section.items);
  const aiPapers = rankPapers(mergePaperSources([...curatedPapers.filter(paper => paper.area === 'ai'), ...aiCrossref.items, ...aiArxiv.items]), AI_TOPICS).slice(0, 110);
  const architecturePapers = rankPapers(mergePaperSources([...curatedPapers.filter(paper => paper.area === 'architecture'), ...archCrossref.items, ...archArxiv.items]), ARCH_TOPICS).slice(0, 110);
  const news = uniqueNewest(feeds.flatMap(result => result.items)).slice(0, 30);
  if (aiPapers.length < 10) throw new Error(`Build aborted: only ${aiPapers.length} reliable AI papers were available.`);
  if (architecturePapers.length < 10) throw new Error(`Build aborted: only ${architecturePapers.length} architecture papers were available.`);
  if (news.length < 3) throw new Error(`Build aborted: only ${news.length} official news items were available.`);

  const finalIds = new Set([...aiPapers, ...architecturePapers].map(paper => paper.id));
  const collectionData = sections.map(section => ({ ...section, items: undefined, paperIds: section.items.map(paper => paper.id).filter(id => finalIds.has(id)) })).filter(section => section.paperIds.length);
  const aiDigest = analyze(aiPapers, AI_TOPICS, '人工智能'); const architectureDigest = analyze(architecturePapers, ARCH_TOPICS, '计算机体系结构'); const recommendations = dailyPlan([...aiPapers, ...architecturePapers]);
  await rm(dist, { recursive: true, force: true }); await mkdir(path.join(dist, 'data'), { recursive: true });
  await Promise.all([
    ...STATIC_FILES.map(file => copyFile(path.join(root, file), path.join(dist, file))),
    cp(path.join(root, 'data', 'dictionary'), path.join(dist, 'data', 'dictionary'), { recursive: true })
  ]);
  const json = (name, data) => writeFile(path.join(dist, 'data', `${name}.json`), JSON.stringify(data, null, 2));
  const collectionErrors = collectionResults.filter(item => item.error).map(item => `${item.name}：${item.error}`);
  await Promise.all([
    json('papers', { items: aiPapers, generatedAt, ranking: 'quality-first-v1', providers: { arXiv: aiArxiv.items.length, Crossref: aiCrossref.items.length, curated: aiPapers.filter(paper => paper.quality?.official).length }, errors: [aiArxiv, aiCrossref].filter(item => item.error).map(item => `${item.name}：${item.error}`) }),
    json('architecture', { items: architecturePapers, ...architectureDigest, generatedAt, ranking: 'quality-first-v1', providers: { arXiv: archArxiv.items.length, Crossref: archCrossref.items.length, curated: architecturePapers.filter(paper => paper.quality?.official).length }, errors: [archArxiv, archCrossref].filter(item => item.error).map(item => `${item.name}：${item.error}`) }),
    json('news', { items: news, generatedAt, providers: Object.fromEntries(feeds.map(feed => [feed.name, feed.items.length])), errors: feeds.filter(feed => feed.error).map(feed => `${feed.name}：${feed.error}`) }),
    json('digest', { ...aiDigest, generatedAt }),
    json('venues', { venues: VENUES.map(venueView), generatedAt, note: '会议与期刊入口指向官方页面；未核验到明确日期时不会猜测截止时间。审稿速度为流程说明，不是官方时限承诺。' }),
    json('curated', { sections: collectionData, daily: recommendations, generatedAt, errors: collectionErrors, methodology: '旗舰会议/期刊正式收录优先；官方论文集或 DOI 可核验；影响力与主题相关性高于新鲜度。' })
  ]);
  console.log(`Built PaperScope: ${aiPapers.length} AI, ${architecturePapers.length} architecture, ${collectionData.length} venue collections, ${recommendations.items.length} daily picks, ${news.length} news at ${generatedAt}`);
  if (collectionErrors.length) console.warn(`Collection warnings: ${collectionErrors.join(' | ')}`);
}

build().catch(error => { console.error(error); process.exitCode = 1; });

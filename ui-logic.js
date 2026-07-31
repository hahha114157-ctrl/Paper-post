const NEWS_TOPICS = [
  {
    key: 'agents',
    label: '智能体与推理',
    description: '智能体、推理能力、工具使用与评测进展',
    pattern: /\bagents?\b|agentic|reasoning|inference|tool[- ]use|computer use|planning|benchmark/i
  },
  {
    key: 'models',
    label: '模型与产品',
    description: '模型发布、API、产品能力与开发者工具',
    pattern: /\bmodel\b|\bgpt\b|gemini|copilot|api|release|launch|preview|developer|chatgpt/i
  },
  {
    key: 'multimodal',
    label: '多模态与生成',
    description: '图像、视频、语音与跨模态生成研究',
    pattern: /multimodal|image|video|audio|voice|vision|generation|creative/i
  },
  {
    key: 'safety',
    label: '安全与治理',
    description: '安全、对齐、隐私、政策与负责任的 AI',
    pattern: /safety|alignment|security|privacy|policy|governance|responsible|risk|trust/i
  },
  {
    key: 'systems',
    label: '系统与基础设施',
    description: '计算基础设施、芯片、效率与规模化系统',
    pattern: /system|infrastructure|compute|chip|accelerator|data center|efficien|latency|serving/i
  },
  {
    key: 'science',
    label: '科学与社会应用',
    description: '科学发现、医疗、教育、机器人与社会影响',
    pattern: /science|biology|medicine|health|education|robot|climate|energy|society/i
  }
];

function newsTimestamp(item) {
  const timestamp = new Date(item?.published || item?.updated || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function cleanNewsSource(source = '') {
  const cleaned = String(source)
    .trim()
    .replace(/[.\s·/_-]*official$/i, '')
    .replace(/\s{2,}/g, ' ');
  return cleaned || '官方来源';
}

export function classifyNewsItem(item = {}) {
  const haystack = `${item.title || ''} ${item.summary || ''}`;
  const safetyTopic = NEWS_TOPICS.find(topic => topic.key === 'safety');
  if (safetyTopic.pattern.test(haystack)) return safetyTopic;
  return NEWS_TOPICS.find(topic => topic.pattern.test(haystack)) || {
    key: 'research',
    label: '研究动态',
    description: '来自官方研究团队的最新进展'
  };
}

export function groupNewsItems(items = [], mode = 'topic') {
  const sorted = [...items].sort((a, b) => newsTimestamp(b) - newsTimestamp(a) || String(a.title || '').localeCompare(String(b.title || '')));
  if (mode === 'newest') {
    return sorted.length ? [{ key: 'latest', label: '最新动态', description: '按发布时间集中查看官方更新', items: sorted }] : [];
  }

  const groups = new Map();
  for (const item of sorted) {
    const definition = mode === 'source'
      ? { key: `source:${cleanNewsSource(item.source).toLowerCase()}`, label: cleanNewsSource(item.source), description: '同一官方来源的连续更新' }
      : classifyNewsItem(item);
    const current = groups.get(definition.key) || { ...definition, items: [] };
    current.items.push(item);
    groups.set(definition.key, current);
  }

  return [...groups.values()].sort((a, b) => {
    const newest = newsTimestamp(b.items[0]) - newsTimestamp(a.items[0]);
    return newest || b.items.length - a.items.length || a.label.localeCompare(b.label);
  });
}

function isReaderHeading(line) {
  if (line.length > 110) return false;
  return /^(abstract|introduction|background|method|methods|methodology|results?|discussion|conclusion|references|acknowledg|appendix)\b/i.test(line)
    || /^\d+(?:\.\d+)*\.?\s+\S+/.test(line)
    || (/^[A-Z\d][A-Z\d\s,:/&-]+$/.test(line) && line.length < 72);
}

export function segmentReaderText(text = '', maxChars = 720) {
  const lines = String(text)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim());
  const blocks = [];
  let buffer = '';

  const flush = kind => {
    const value = buffer.trim();
    if (value) blocks.push({ kind: kind || 'paragraph', text: value });
    buffer = '';
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (isReaderHeading(line)) {
      flush();
      blocks.push({ kind: 'heading', text: line });
      continue;
    }
    if (buffer.endsWith('-') && /^[a-z]/.test(line)) buffer = `${buffer.slice(0, -1)}${line}`;
    else buffer = buffer ? `${buffer} ${line}` : line;

    const sentenceBoundary = /[.!?。！？]["')\]]?$/.test(line);
    if (buffer.length >= maxChars || (buffer.length >= 220 && sentenceBoundary)) flush();
  }
  flush();
  return blocks;
}

export function limitTranslationCache(cache = {}, { maxEntries = 300, maxChars = 350_000 } = {}) {
  const entries = Object.entries(cache)
    .filter(([key, value]) => key && value?.translation)
    .sort(([, a], [, b]) => new Date(b.usedAt || b.createdAt || 0) - new Date(a.usedAt || a.createdAt || 0));
  const limited = {};
  let serializedChars = 2;

  for (const [key, value] of entries) {
    if (Object.keys(limited).length >= maxEntries) break;
    const entryChars = JSON.stringify(key).length + JSON.stringify(value).length + 2;
    if (serializedChars + entryChars > maxChars) continue;
    limited[key] = value;
    serializedChars += entryChars;
  }
  return limited;
}

export function clampPdfZoomPercent(value, fallback = 140) {
  const parsed = value === null || value === undefined || String(value).trim() === '' ? Number.NaN : Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 140;
  return Math.round(Math.max(50, Math.min(400, Number.isFinite(parsed) ? parsed : safeFallback)));
}

export function clampPdfNoteFontSize(value, fallback = 14) {
  const parsed = value === null || value === undefined || String(value).trim() === '' ? Number.NaN : Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 14;
  return Math.round(Math.max(12, Math.min(22, Number.isFinite(parsed) ? parsed : safeFallback)));
}

export function clampPdfNoteImageWidth(value, fallback = 100) {
  const parsed = value === null || value === undefined || String(value).trim() === '' ? Number.NaN : Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 100;
  return Math.round(Math.max(35, Math.min(100, Number.isFinite(parsed) ? parsed : safeFallback)));
}

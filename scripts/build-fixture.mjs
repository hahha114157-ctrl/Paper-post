import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const staticFiles = ['index.html', 'app.js', 'pdf-storage.js', 'library-logic.js', 'ui-logic.js', 'note-export.js', 'note-pdf-export.js', 'manifest.webmanifest', 'service-worker.js', 'icon.svg'];
const generatedAt = '2026-07-29T00:00:00.000Z';

function fixturePaper(area, index) {
  const architecture = area === 'architecture';
  const id = `fixture:${area}:${index}`;
  return {
    id,
    title: architecture
      ? `Fixture Architecture Paper ${index}: Efficient Memory and Processor Design`
      : `Fixture AI Paper ${index}: Reliable Multimodal Reasoning`,
    abstract: architecture
      ? 'A deterministic fixture abstract about computer architecture, processor pipelines, cache systems, memory efficiency, interconnects, evaluation methodology, reproducibility, and hardware design tradeoffs.'
      : 'A deterministic fixture abstract about artificial intelligence, multimodal reasoning, language models, evaluation methodology, alignment, reproducibility, and reliable machine learning systems.',
    authors: [`Fixture Author ${index}`, 'PaperScope Test'],
    published: `2026-0${(index % 7) + 1}-01T00:00:00.000Z`,
    venue: architecture ? 'ISCA' : 'ICML',
    venueName: architecture ? 'ISCA' : 'ICML',
    venueYear: 2026,
    source: 'Fixture',
    kind: 'published',
    area,
    link: `https://example.test/${id}`,
    officialUrl: `https://example.test/${id}`,
    doi: `10.9999/${area}.${index}`,
    qualityScore: 80 - index,
    citationCount: index,
    quality: { tier: '测试数据', official: true, reasons: ['离线夹具', '确定性构建'] },
    publication: { status: 'published', venue: architecture ? 'ISCA' : 'ICML', published: `2026-0${(index % 7) + 1}-01T00:00:00.000Z` }
  };
}

const ai = Array.from({ length: 12 }, (_, index) => fixturePaper('ai', index + 1));
const architecture = Array.from({ length: 12 }, (_, index) => fixturePaper('architecture', index + 1));
const today = '2026-07-29';
const daily = Array.from({ length: 14 }, (_, index) => ({
  date: new Date(Date.parse(`${today}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10),
  paperId: [...ai, ...architecture][index],
  reason: '离线夹具推荐，用于验证稳定构建和界面回归',
  readingPlan: ['5 分钟：阅读摘要', '15 分钟：检查方法', '15 分钟：核对实验', '10 分钟：记录结论'],
  focusQuestions: ['核心问题是什么？', '证据是否充分？', '可以复用什么？']
}));

await rm(dist, { recursive: true, force: true });
await Promise.all([
  mkdir(path.join(dist, 'data'), { recursive: true }),
  mkdir(path.join(dist, 'vendor', 'pdfjs'), { recursive: true }),
  mkdir(path.join(dist, 'vendor', 'pdf-lib'), { recursive: true }),
  mkdir(path.join(dist, 'vendor', 'tesseract'), { recursive: true }),
  mkdir(path.join(dist, 'vendor', 'tesseract-core'), { recursive: true })
]);
await Promise.all([
  ...staticFiles.map(file => copyFile(path.join(root, file), path.join(dist, file))),
  cp(path.join(root, 'data', 'dictionary'), path.join(dist, 'data', 'dictionary'), { recursive: true }),
  copyFile(path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs'), path.join(dist, 'vendor', 'pdfjs', 'pdf.mjs')),
  copyFile(path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs'), path.join(dist, 'vendor', 'pdfjs', 'pdf.worker.mjs')),
  copyFile(path.join(root, 'node_modules', 'pdfjs-dist', 'web', 'pdf_viewer.css'), path.join(dist, 'vendor', 'pdfjs', 'pdf_viewer.css')),
  cp(path.join(root, 'node_modules', 'pdfjs-dist', 'cmaps'), path.join(dist, 'vendor', 'pdfjs', 'cmaps'), { recursive: true }),
  cp(path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts'), path.join(dist, 'vendor', 'pdfjs', 'standard_fonts'), { recursive: true }),
  cp(path.join(root, 'node_modules', 'pdfjs-dist', 'wasm'), path.join(dist, 'vendor', 'pdfjs', 'wasm'), { recursive: true }),
  copyFile(path.join(root, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.esm.min.js'), path.join(dist, 'vendor', 'pdf-lib', 'pdf-lib.mjs')),
  copyFile(path.join(root, 'node_modules', 'tesseract.js', 'dist', 'tesseract.esm.min.js'), path.join(dist, 'vendor', 'tesseract', 'tesseract.mjs')),
  copyFile(path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), path.join(dist, 'vendor', 'tesseract', 'worker.min.js')),
  cp(path.join(root, 'node_modules', 'tesseract.js-core'), path.join(dist, 'vendor', 'tesseract-core'), { recursive: true })
]);

const writeJson = (name, value) => writeFile(path.join(dist, 'data', `${name}.json`), JSON.stringify(value, null, 2));
await Promise.all([
  writeJson('papers', { items: ai, generatedAt, ranking: 'fixture' }),
  writeJson('architecture', { items: architecture, generatedAt, ranking: 'fixture', summary: '离线体系结构夹具摘要。', topics: [{ name: '存储与内存系统', count: 12 }] }),
  writeJson('digest', { generatedAt, summary: '离线 AI 夹具摘要。', topics: [{ name: '训练、对齐与安全', count: 12 }] }),
  writeJson('news', { generatedAt, items: [1, 2, 3].map(index => ({ title: `Fixture Research News ${index}`, summary: '用于离线界面测试的资讯。', source: 'Fixture', published: generatedAt, link: `https://example.test/news/${index}` })) }),
  writeJson('venues', { generatedAt, venues: [
    { area: 'ai', name: 'ICML', type: '会议', level: 'Fixture', officialUrl: 'https://example.test/icml', state: 'unannounced', deadline: '下一届截稿待更新', source: 'Fixture' },
    { area: 'architecture', name: 'ISCA', type: '会议', level: 'Fixture', officialUrl: 'https://example.test/isca', state: 'unannounced', deadline: '下一届截稿待更新', source: 'Fixture' }
  ] }),
  writeJson('curated', {
    generatedAt,
    methodology: '离线夹具，仅用于测试。',
    sections: [
      { area: 'ai', venue: 'ICML', type: '会议', year: 2026, title: 'ICML Fixture', subtitle: '离线测试专栏', officialUrl: 'https://example.test/icml', source: 'Fixture', paperIds: ai.map(paper => paper.id) },
      { area: 'architecture', venue: 'ISCA', type: '会议', year: 2026, title: 'ISCA Fixture', subtitle: '离线测试专栏', officialUrl: 'https://example.test/isca', source: 'Fixture', paperIds: architecture.map(paper => paper.id) }
    ],
    daily: { timezone: 'Asia/Shanghai', cadence: '离线测试', methodology: '确定性夹具', items: daily }
  })
]);

console.log(`Built deterministic PaperScope fixture: ${ai.length} AI, ${architecture.length} architecture.`);

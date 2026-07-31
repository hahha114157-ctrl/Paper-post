import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { buildNotePdf } from '../note-pdf-export.js';

const output = path.resolve(process.argv[2] || 'tmp/pdfs/note-export-validation.pdf');
const bytes = await buildNotePdf({
  PDFDocument,
  title: 'Four Ways to Deploy More Secure AI Agents',
  exportedAt: '2026/07/31 12:00:00',
  metadata: [
    { label: '作者', value: 'PaperScope 验证作者' },
    { label: '会议/期刊', value: 'OpenAI Research' },
    { label: 'DOI', value: '10.0000/paperscope.validation' },
    { label: '原文链接', value: 'https://example.com/paper' },
    { label: '阅读位置', value: '第 4 / 12 页' }
  ],
  blocks: [
    { type: 'heading', runs: [{ text: '关键结论' }] },
    { type: 'paragraph', runs: [{ text: '安全部署智能体需要同时控制模型权限、工具边界、数据访问与运行时审计。导出结果应保持统一字体、清晰层级和稳定分页。' }] },
    { type: 'quote', runs: [{ text: '这是一段引用：PDF 使用固定版式，适合阅读、打印与分享。' }] },
    { type: 'bullet', runs: [{ text: '最小权限与显式授权' }] },
    { type: 'bullet', runs: [{ text: '工具输入输出验证' }] },
    { type: 'bullet', runs: [{ text: '持续监控与可追溯日志' }] },
    { type: 'paragraph', runs: [{ text: '长段落换行验证：'.repeat(12) + '中文和 English text should remain readable without clipped glyphs or overflowing the page margin.'.repeat(8) }] }
  ],
  options: { fontFamily: 'Microsoft YaHei', fontSize: 12, pageSize: 'a4', margin: 'standard', includeMetadata: true, includeImages: true },
  canvasFactory: () => createCanvas(1, 1),
  encodeJpeg: canvas => new Uint8Array(canvas.toBuffer('image/jpeg', 90))
});

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(output);

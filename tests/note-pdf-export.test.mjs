import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { buildNotePdf } from '../note-pdf-export.js';

test('PDF export produces a readable paged document with configurable metadata', async () => {
  const bytes = await buildNotePdf({
    PDFDocument,
    title: '安全智能体研究',
    exportedAt: '2026/07/31 12:00:00',
    metadata: [{ label: '作者', value: '测试作者' }, { label: 'DOI', value: '10.1000/test' }],
    blocks: [
      { type: 'heading', runs: [{ text: '关键结论' }] },
      { type: 'paragraph', runs: [{ text: '这是一段用于验证中文字体、自动换行和固定版式的阅读笔记。'.repeat(220) }] }
    ],
    options: { fontFamily: 'Microsoft YaHei', fontSize: 12, pageSize: 'a4', margin: 'standard', includeMetadata: true },
    canvasFactory: () => createCanvas(1, 1),
    encodeJpeg: canvas => new Uint8Array(canvas.toBuffer('image/jpeg', 90))
  });
  assert.equal(new TextDecoder('latin1').decode(bytes.slice(0, 5)), '%PDF-');
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 2);
  assert.equal(document.getTitle(), '安全智能体研究 · 阅读笔记');
  assert.equal(document.getAuthor(), 'PaperScope');
});

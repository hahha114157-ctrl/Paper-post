function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function blockText(block = {}) {
  const prefix = block.type === 'bullet' ? '• ' : block.type === 'number' ? `${block.index || 1}. ` : '';
  return prefix + (block.runs || []).map(run => run.text || '').join('');
}

function splitLines(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    const tokens = paragraph.match(/\s+|[A-Za-z0-9]+(?:[-'/:.][A-Za-z0-9]+)*|[\u3400-\u9fff]|[^\s]/g) || [];
    for (const token of tokens) {
      const next = line + token;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else line = next;
      if (context.measureText(line).width <= maxWidth) continue;
      let remainder = '';
      for (const character of [...line]) {
        if (remainder && context.measureText(remainder + character).width > maxWidth) {
          lines.push(remainder.trimEnd()); remainder = character;
        } else remainder += character;
      }
      line = remainder;
    }
    lines.push(line);
  }
  return lines;
}

async function imageBitmap(image, decodeImage) {
  if (decodeImage) return decodeImage(image.bytes);
  const blob = new Blob([image.bytes], { type: 'image/png' });
  return createImageBitmap(blob);
}

export async function buildNotePdf({
  PDFDocument,
  title = '阅读笔记',
  metadata = [],
  blocks = [],
  images = [],
  exportedAt = new Date().toISOString(),
  options = {},
  canvasFactory,
  decodeImage,
  encodeJpeg
} = {}) {
  const makeCanvas = canvasFactory || (typeof document !== 'undefined' ? () => document.createElement('canvas') : null);
  if (!PDFDocument || !makeCanvas) throw new Error('当前环境无法生成 PDF');
  const pageSize = options.pageSize === 'letter' ? [612, 792] : [595.28, 841.89];
  const canvasSize = options.pageSize === 'letter' ? [1224, 1584] : [1190, 1684];
  const scale = canvasSize[0] / pageSize[0];
  const marginPoints = options.margin === 'narrow' ? 36 : options.margin === 'wide' ? 85 : 57;
  const margin = marginPoints * scale;
  const baseSize = clamp(options.fontSize, 9, 24) * scale;
  const fontFamily = String(options.fontFamily || 'Microsoft YaHei');
  const includeMetadata = options.includeMetadata !== false;
  const includeImages = options.includeImages !== false;
  const pageCanvases = [];
  let canvas;
  let context;
  let y;

  const startPage = () => {
    canvas = makeCanvas();
    [canvas.width, canvas.height] = canvasSize;
    context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'top';
    pageCanvases.push(canvas);
    y = margin;
  };
  const footerRoom = 54 * scale;
  const ensureRoom = height => {
    if (y + height <= canvas.height - margin - footerRoom) return;
    startPage();
  };
  const drawText = (text, style = {}) => {
    const size = (style.size || baseSize);
    const lineHeight = size * (style.lineHeight || 1.65);
    const indent = style.indent || 0;
    context.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${size}px "${fontFamily}", sans-serif`;
    const lines = splitLines(context, text, canvas.width - margin * 2 - indent);
    ensureRoom(Math.min(Math.max(1, lines.length), 2) * lineHeight + (style.after || baseSize * .55));
    for (const line of lines) {
      ensureRoom(lineHeight);
      if (style.rule) {
        context.fillStyle = '#116347'; context.fillRect(margin, y, 5 * scale, lineHeight);
      }
      context.fillStyle = style.color || '#18231e';
      context.fillText(line, margin + indent, y);
      y += lineHeight;
    }
    y += style.after ?? baseSize * .55;
  };
  const drawMetadataRow = (label, value, style = {}) => {
    const size = style.size || baseSize * .9;
    const lineHeight = size * (style.lineHeight || 1.5);
    const labelWidth = 72 * scale;
    const gap = 12 * scale;
    const valueX = margin + labelWidth + gap;
    context.font = `400 ${size}px "${fontFamily}", sans-serif`;
    const lines = splitLines(context, String(value || ''), canvas.width - margin - valueX);
    ensureRoom(Math.min(Math.max(1, lines.length), 2) * lineHeight + (style.after ?? baseSize * .25));
    for (let index = 0; index < lines.length; index += 1) {
      ensureRoom(lineHeight);
      if (index === 0) {
        context.fillStyle = style.labelColor || '#6d7b73';
        context.textAlign = 'right';
        context.fillText(`${label}：`, margin + labelWidth, y);
      }
      context.fillStyle = style.color || '#46534c';
      context.textAlign = 'left';
      context.fillText(lines[index], valueX, y);
      y += lineHeight;
    }
    y += style.after ?? baseSize * .25;
    context.textAlign = 'left';
  };

  startPage();
  drawText(`${title} · 阅读笔记`, { size: baseSize * 1.7, bold: true, color: '#116347', lineHeight: 1.35, after: baseSize * 1.2 });
  if (includeMetadata) {
    for (const item of metadata.filter(item => item?.value)) drawMetadataRow(item.label, item.value);
  }
  drawMetadataRow('导出时间', exportedAt, { size: baseSize * .82, color: '#6d7b73', lineHeight: 1.45, after: baseSize });
  context.fillStyle = '#dde5df'; context.fillRect(margin, y, canvas.width - margin * 2, 2); y += baseSize * 1.2;

  if (!blocks.length) drawText('暂无阅读笔记', { italic: true, color: '#6d7b73' });
  for (const block of blocks) {
    if (block.type === 'image') {
      if (!includeImages || !images[block.imageIndex]) continue;
      const image = images[block.imageIndex];
      const bitmap = await imageBitmap(image, decodeImage);
      const maxWidth = (canvas.width - margin * 2) * clamp(image.displayWidth || 100, 20, 100) / 100;
      const width = Math.min(maxWidth, bitmap.width);
      const height = width * bitmap.height / bitmap.width;
      const usableHeight = canvas.height - margin * 2 - footerRoom;
      const ratio = Math.min(1, usableHeight / height);
      const finalWidth = width * ratio; const finalHeight = height * ratio;
      ensureRoom(finalHeight + baseSize * 2);
      context.drawImage(bitmap, (canvas.width - finalWidth) / 2, y, finalWidth, finalHeight);
      bitmap.close?.(); y += finalHeight + baseSize * .35;
      if (image.caption) drawText(image.caption, { size: baseSize * .75, color: '#6d7b73', lineHeight: 1.35, after: baseSize });
      continue;
    }
    const style = block.type === 'heading'
      ? { size: baseSize * 1.3, bold: true, color: '#116347', lineHeight: 1.45, after: baseSize * .7 }
      : block.type === 'quote'
        ? { italic: true, color: '#59675f', indent: baseSize * 1.3, rule: true }
        : block.type === 'bullet' || block.type === 'number'
          ? { indent: baseSize * .9, after: baseSize * .3 }
          : {};
    drawText(blockText(block), style);
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} · 阅读笔记`);
  pdf.setAuthor('PaperScope');
  pdf.setSubject('论文阅读笔记');
  for (let index = 0; index < pageCanvases.length; index += 1) {
    const pageCanvas = pageCanvases[index];
    const footer = pageCanvas.getContext('2d');
    footer.font = `${baseSize * .72}px "${fontFamily}", sans-serif`;
    footer.fillStyle = '#7b8780'; footer.textAlign = 'center';
    footer.fillText(`${index + 1} / ${pageCanvases.length}`, pageCanvas.width / 2, pageCanvas.height - margin * .65);
    const bytes = encodeJpeg
      ? await encodeJpeg(pageCanvas)
      : await new Promise((resolve, reject) => pageCanvas.toBlob(async blob => blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error('PDF 页面渲染失败')), 'image/jpeg', .9));
    const image = await pdf.embedJpg(bytes);
    const page = pdf.addPage(pageSize);
    page.drawImage(image, { x: 0, y: 0, width: pageSize[0], height: pageSize[1] });
  }
  return pdf.save({ useObjectStreams: false });
}

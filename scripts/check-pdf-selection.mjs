import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

const context = vm.createContext({ state: { pdfColumnTemplate: null } });
vm.runInContext(`${functionSource('pdfStableColumnBreaks')};${functionSource('pdfRectInCapturedLayout')}`, context);

const bounds = { left: 0, top: 100, right: 1000, bottom: 1100, width: 1000, height: 1000 };
const rect = (left, right) => ({ left, right, top: 0, bottom: 12, width: right - left, height: 12 });
const fragment = (left, right) => ({ rect: rect(left, right) });
const complexLines = Array.from({ length: 32 }, (_, index) => ({
  fragments: [
    fragment(70, 478),
    fragment(506 + (index % 2), 522),
    ...(index < 24 ? [fragment(538 + (index % 2), 570)] : []),
    ...(index < 18 ? [fragment(666 + (index % 2), 710)] : [])
  ]
}));
const dominant = context.pdfStableColumnBreaks(complexLines, bounds);
assert.equal(dominant.length, 1, 'complex pages must expose only one dominant journal gutter');
assert.ok(Math.abs(dominant[0].relative - .5065) < .01, 'formula/list indents must not replace the central gutter');

const sparseLines = Array.from({ length: 5 }, (_, index) => ({
  fragments: [fragment(70, 480), fragment(511 + (index % 2), 900)]
}));
const sparse = context.pdfStableColumnBreaks(sparseLines, bounds);
assert.equal(sparse.length, 1, 'a sparse later page should reuse the established document gutter');
assert.ok(Math.abs(sparse[0].relative - .5115) < .01);

context.state.pdfColumnTemplate = null;
const splitSingleColumn = Array.from({ length: 6 }, (_, index) => ({
  fragments: [fragment(50, 470), fragment(510 + (index % 2), 930)]
}));
assert.equal(context.pdfStableColumnBreaks(splitSingleColumn, bounds).length, 0, 'split nodes on a short single-column page are not columns');

const captured = context.pdfRectInCapturedLayout(
  { left: 150, right: 250, top: -180, bottom: -160, width: 100, height: 20 },
  { bounds: { left: 20, top: 100 } },
  { left: -80, top: -300 }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(captured)),
  { left: 250, right: 350, top: 220, bottom: 240, width: 100, height: 20 },
  'wheel scrolling during a drag must be removed from Range client rectangles'
);

console.log('PDF selection regression checks passed.');

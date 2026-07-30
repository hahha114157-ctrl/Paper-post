import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNewsItem,
  cleanNewsSource,
  groupNewsItems,
  limitTranslationCache,
  segmentReaderText
} from '../ui-logic.js';

test('official source labels are separated from the readable source name', () => {
  assert.equal(cleanNewsSource('OpenAI.official'), 'OpenAI');
  assert.equal(cleanNewsSource('Google DeepMind · Official'), 'Google DeepMind');
  assert.equal(cleanNewsSource('Microsoft Research'), 'Microsoft Research');
});

test('similar news is kept in adjacent topic groups', () => {
  const items = [
    { title: 'New safety evaluation framework', summary: 'Responsible deployment', source: 'OpenAI.official', published: '2026-07-28' },
    { title: 'Agent reasoning benchmark', summary: 'Tool-use evaluation', source: 'Research', published: '2026-07-30' },
    { title: 'Policy update for safer models', summary: 'AI safety governance', source: 'Research', published: '2026-07-29' }
  ];
  const groups = groupNewsItems(items, 'topic');
  assert.equal(groups.length, 2);
  assert.equal(groups.find(group => group.key === 'safety').items.length, 2);
  assert.equal(classifyNewsItem(items[1]).key, 'agents');
});

test('reader text becomes meaningful headings and paragraphs', () => {
  const blocks = segmentReaderText(`1 Introduction
Modern research tools need a calm reading surface.
They should preserve context while reducing clutter.

METHODS
We group related controls and keep the document central.`);
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'paragraph', 'heading', 'paragraph']);
  assert.match(blocks[1].text, /surface\. They/);
});

test('translation cache keeps recent useful entries within count and size budgets', () => {
  const cache = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `term-${index}`,
    {
      translation: `译文-${index}-${'x'.repeat(35)}`,
      usedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    }
  ]));
  const limited = limitTranslationCache(cache, { maxEntries: 3, maxChars: 360 });
  assert.equal(Object.keys(limited).length, 3);
  assert.deepEqual(Object.keys(limited), ['term-7', 'term-6', 'term-5']);
  assert.ok(JSON.stringify(limited).length <= 360);
});

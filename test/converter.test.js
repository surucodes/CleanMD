const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { toMarkdown, postProcess } = require('../src/converter');

function md(html, format = 'obsidian') {
  const { document } = new JSDOM(`<div id="root">${html}</div>`).window;
  return toMarkdown(document.getElementById('root'), { format });
}

const TABLE_WITH_BR = `
  <table>
    <thead><tr><th>Step</th><th>Details</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>First line<br>Second line<br>Third line</td></tr>
      <tr><td>2</td><td>Single</td></tr>
    </tbody>
  </table>`;

test('TC-1: table and fenced code block with language', () => {
  const out = md(`
    <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    <pre><code class="language-python">print("hi")\n</code></pre>`);
  assert.equal(out, '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```python\nprint("hi")\n```\n');
});

test('TC-2: <br> inside a table cell stays inline, rows stay intact', () => {
  assert.equal(
    md(TABLE_WITH_BR),
    '| Step | Details |\n| --- | --- |\n| 1 | First line<br>Second line<br>Third line |\n| 2 | Single |\n',
  );
});

test('FR-5.2: <br> outside a table keeps the default hard break', () => {
  assert.equal(md('<p>one<br>two</p>'), 'one  \ntwo\n');
});

test('block content and pipes inside cells cannot break the row', () => {
  const out = md(`
    <table><thead><tr><th>Cmd</th><th>Notes</th></tr></thead>
    <tbody><tr><td><code>a | b</code></td><td><p>para one</p><p>para two</p></td></tr></tbody></table>`);
  assert.equal(out, '| Cmd | Notes |\n| --- | --- |\n| `a \\| b` | para one<br>para two |\n');
});

test('headerless table still converts to a pipe table', () => {
  assert.equal(md('<table><tr><td>x</td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>'),
    '| x | y |\n| --- | --- |\n| 1 | 2 |\n');
});

const COMPOSITE = `
  <h2>Plan</h2>
  <p>Intro <strong>bold</strong> and <em>italic</em> and <del>gone</del>.</p>
  ${TABLE_WITH_BR}
  <ul><li>Top<ul><li>Nested</li></ul></li><li>Second</li></ul>
  <ol><li>One</li><li>Two</li></ol>
  <pre><code class="language-bash">echo hi</code></pre>`;

const COMPOSITE_MD = [
  '## Plan',
  '',
  'Intro **bold** and *italic* and ~~gone~~.',
  '',
  '| Step | Details |',
  '| --- | --- |',
  '| 1 | First line<br>Second line<br>Third line |',
  '| 2 | Single |',
  '',
  '- Top',
  '  - Nested',
  '- Second',
  '',
  '1. One',
  '2. Two',
  '',
  '```bash',
  'echo hi',
  '```',
  '',
].join('\n');

test('TC-3: composite response is valid for both Obsidian and ADO', () => {
  assert.equal(md(COMPOSITE, 'obsidian'), COMPOSITE_MD);
  assert.equal(md(COMPOSITE, 'ado'), COMPOSITE_MD);
});

test('TC-4: already well-spaced markdown passes through ADO unchanged', () => {
  assert.equal(postProcess(COMPOSITE_MD, 'ado'), COMPOSITE_MD);
});

test('TC-5: tightly packed blocks get blank lines at boundaries only', () => {
  const tight = 'Intro\n| a | b |\n| --- | --- |\n| 1 | 2 |\nAfter\n```js\nx | y\n```\n```sh\nls\n```\nEnd';
  assert.equal(
    postProcess(tight, 'ado'),
    'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n\n```js\nx | y\n```\n\n```sh\nls\n```\n\nEnd\n',
  );
  assert.equal(postProcess(tight, 'obsidian'), tight + '\n');
});

test('ADO: mermaid fences become ::: mermaid containers', () => {
  const src = '```mermaid\ngraph TD\n  A-->B\n```';
  assert.equal(postProcess(src, 'ado'), '::: mermaid\ngraph TD\n  A-->B\n:::\n');
  assert.equal(postProcess(src, 'obsidian'), src + '\n');
  assert.equal(postProcess('```mermaid\ngraph TD', 'ado'), '```mermaid\ngraph TD\n');
});

test('FR-6.4: output is trimmed and ends with exactly one newline', () => {
  assert.equal(postProcess('\n\n  text  \n\n\n', 'obsidian'), 'text\n');
  assert.equal(postProcess('a\n\n\n\nb', 'gfm'), 'a\n\nb\n');
});

test('ChatGPT-style code block: header and copy button are dropped', () => {
  const out = md(`
    <pre><div class="rounded"><div class="flex">python</div><div class="sticky"><button>Copy code</button></div>
    <div class="overflow-y-auto"><code class="whitespace-pre! language-python"><span>def f():\n    return 1\n</span></code></div></div></pre>`);
  assert.equal(out, '```python\ndef f():\n    return 1\n```\n');
});

test('Claude-style code block: language label outside <pre> is dropped', () => {
  const out = md(`
    <div class="relative"><div class="sticky"><button>Copy</button></div>
    <div class="text-text-500">typescript</div>
    <div class="overflow-x-auto"><pre class="code-block__code"><code class="language-typescript">const a = 1;</code></pre></div></div>`);
  assert.equal(out, '```typescript\nconst a = 1;\n```\n');
});

test('code containing ``` gets a longer fence', () => {
  assert.equal(md('<pre><code class="language-md">```js\nx\n```</code></pre>'), '````md\n```js\nx\n```\n````\n');
});

test('KaTeX renders back to its TeX source', () => {
  const katex = (tex) =>
    `<span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow>` +
    `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` +
    `<span class="katex-html" aria-hidden="true">garbage</span></span>`;
  const out = md(`<p>Energy ${katex('E = mc^2')} and</p><span class="katex-display">${katex('\\sum_{i=1}^n x_i')}</span>`);
  assert.equal(out, 'Energy $E = mc^2$ and\n\n$$\n\\sum_{i=1}^n x_i\n$$\n');
});

test('task lists convert', () => {
  assert.equal(md('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>'),
    '- [x] done\n- [ ] todo\n');
});

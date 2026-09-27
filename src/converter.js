// DOM -> destination-flavoured Markdown. Runs as a content script (Turndown
// globals come from lib/) and under plain Node for the tests (NFR-5).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('turndown'), require('turndown-plugin-gfm'));
  } else {
    root.CleanMD = Object.assign(root.CleanMD || {}, factory(root.TurndownService, root.turndownPluginGfm));
  }
})(globalThis, function (TurndownService, turndownPluginGfm) {
  'use strict';

  // Host-page UI chrome that can sit inside a response container.
  const STRIP_SELECTORS = ['button', 'style', 'script', 'noscript', 'template', '.sr-only', '[aria-hidden="true"]', '.llmmd-bar'];

  const MATH_TAG = 'cleanmd-math';

  function hasAncestor(node, nodeNames) {
    for (let el = node.parentNode; el; el = el.parentNode) {
      if (nodeNames.includes(el.nodeName)) return true;
    }
    return false;
  }

  function languageOf(pre) {
    const candidates = [pre.querySelector('code'), pre, ...pre.querySelectorAll('[class*="language-"]')];
    for (const el of candidates) {
      const match = el && /(?:^|\s)language-([\w+#.-]+)/.exec(el.getAttribute('class') || '');
      if (match) return match[1];
    }
    return '';
  }

  // A fence one backtick longer than any backtick run in the code, so the code can't close it early.
  function fenceFor(code) {
    const longestRun = Math.max(0, ...(code.match(/`+/g) || []).map((run) => run.length));
    return '`'.repeat(Math.max(3, longestRun + 1));
  }

  function isHeaderRow(tr) {
    let table = tr.parentNode;
    while (table && table.nodeName !== 'TABLE') table = table.parentNode;
    return !!table && table.rows[0] === tr;
  }

  function cellPrefix(cell) {
    return cell.previousElementSibling ? ' ' : '| ';
  }

  function createService() {
    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
    });
    service.use(turndownPluginGfm.gfm);

    // Turndown checks addRule entries newest-first and ahead of its built-ins,
    // so each rule below overrides the stock or GFM-plugin rule it names.

    // FR-5.1: a real newline inside a pipe-table cell ends the row and corrupts
    // every row after it, so <br> in a cell stays literal inline HTML.
    // FR-5.2: <br> elsewhere falls through to Turndown's default.
    service.addRule('tableCellLineBreak', {
      filter: (node) => node.nodeName === 'BR' && hasAncestor(node, ['TD', 'TH']),
      replacement: () => '<br>',
    });

    // The GFM plugin's cell rule leaves `|` unescaped and passes through the
    // newlines that block content (<p>, lists) produces inside a cell.
    // It also counts whitespace text nodes when deciding which cell is first.
    service.addRule('tableCell', {
      filter: ['th', 'td'],
      replacement(content, node) {
        const text = content.trim().replace(/[ \t]*\n+[ \t]*/g, '<br>').replace(/\|/g, '\\|');
        return cellPrefix(node) + text + ' |';
      },
    });

    // Treat the first row as the header even without <thead>/<th>, instead of
    // the plugin's fallback of emitting the whole table as raw HTML.
    service.addRule('tableRow', {
      filter: 'tr',
      replacement(content, node) {
        if (!isHeaderRow(node)) return '\n' + content;
        const alignments = { left: ':--', right: '--:', center: ':-:' };
        const divider = Array.from(node.children)
          .map((cell) => {
            const align = (cell.getAttribute('align') || cell.style?.textAlign || '').toLowerCase();
            return cellPrefix(cell) + (alignments[align] || '---') + ' |';
          })
          .join('');
        return '\n' + content + '\n' + divider;
      },
    });

    service.addRule('table', {
      filter: 'table',
      replacement: (content) => '\n\n' + content.replace(/\n+/g, '\n').trim() + '\n\n',
    });

    // The plugin emits single-tilde strikethrough, which Obsidian and Markdig don't render.
    service.addRule('strikethrough', {
      filter: ['del', 's', 'strike'],
      replacement: (content) => '~~' + content + '~~',
    });

    // Stock rule pads markers to "-   item" / "1.  item".
    service.addRule('listItem', {
      filter: 'li',
      replacement(content, node, options) {
        const parent = node.parentNode;
        let prefix = options.bulletListMarker + ' ';
        if (parent.nodeName === 'OL') {
          const start = parent.getAttribute('start');
          const index = Array.prototype.indexOf.call(parent.children, node);
          prefix = (start ? Number(start) + index : index + 1) + '. ';
        }
        const isParagraph = /\n$/.test(content);
        content = content.replace(/^\n+/, '').replace(/\n+$/, '') + (isParagraph ? '\n' : '');
        content = content.replace(/^(\[[ x]\]) +/, '$1 '); // task checkbox + source whitespace
        content = content.replace(/\n/g, '\n' + ' '.repeat(prefix.length));
        return prefix + content + (node.nextSibling ? '\n' : '');
      },
    });

    // FR-4.3: the stock rule only fires when <code> is <pre>'s first child;
    // ChatGPT and Claude both wrap it in header/toolbar divs.
    service.addRule('codeBlock', {
      filter: 'pre',
      replacement(content, node) {
        const code = (node.querySelector('code') || node).textContent.replace(/\n+$/, '');
        const fence = fenceFor(code);
        return '\n\n' + fence + languageOf(node) + '\n' + code + '\n' + fence + '\n\n';
      },
    });

    service.addRule('math', {
      filter: (node) => node.nodeName === MATH_TAG.toUpperCase(),
      replacement(content, node) {
        const tex = node.getAttribute('data-tex');
        return node.hasAttribute('data-display') ? '\n\n$$\n' + tex + '\n$$\n\n' : '$' + tex + '$';
      },
    });

    return service;
  }

  let service;

  // KaTeX renders every formula twice (MathML + HTML); keep only its TeX source.
  function replaceMath(root) {
    for (const katex of Array.from(root.querySelectorAll('.katex'))) {
      const tex = katex.querySelector('annotation[encoding="application/x-tex"]');
      const target = katex.closest('.katex-display') || katex;
      if (!tex || !root.contains(target)) continue;
      const marker = root.ownerDocument.createElement(MATH_TAG);
      marker.setAttribute('data-tex', tex.textContent.trim());
      if (target !== katex) marker.setAttribute('data-display', '');
      marker.textContent = tex.textContent; // non-empty, or Turndown treats it as blank
      target.replaceWith(marker);
    }
  }

  // Drops the language label ("python") both sites render just above a code block.
  function stripCodeLabels(root) {
    for (const pre of root.querySelectorAll('pre')) {
      const lang = languageOf(pre).toLowerCase();
      if (!lang) continue;
      let el = pre;
      for (let depth = 0; depth < 3 && el && el !== root; depth++, el = el.parentElement) {
        for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (/^(DIV|SPAN)$/.test(sib.nodeName) && sib.textContent.trim().toLowerCase() === lang) sib.remove();
        }
      }
    }
  }

  // Classifies each line once so the block fixes below never touch code inside fences.
  function scanLines(markdown) {
    const lines = [];
    let openFence = null;
    let block = 0;
    for (const text of markdown.split('\n')) {
      if (openFence) {
        const trimmed = text.trim();
        const closes = trimmed[0] === openFence[0] && /^(`{3,}|~{3,})$/.test(trimmed) && trimmed.length >= openFence.length;
        lines.push({ text, kind: 'fence', block, closes });
        if (closes) openFence = null;
        continue;
      }
      const fence = /^\s*(`{3,}|~{3,})/.exec(text);
      if (fence) {
        openFence = fence[1];
        lines.push({ text, kind: 'fence', block: ++block, opens: true });
      } else if (!text.trim()) {
        lines.push({ text: '', kind: 'blank' });
      } else {
        lines.push({ text, kind: /^\s*\|/.test(text) ? 'table' : 'text' });
      }
    }
    return lines;
  }

  function collapseBlankRuns(lines) {
    return lines.filter((line, i) => !(line.kind === 'blank' && lines[i - 1]?.kind === 'blank'));
  }

  // FR-6.2: Markdig needs a blank line between a table or fence and adjacent
  // content. Lines are compared by kind, never by a character class, so rows
  // of one table and lines of one fence are never split (defect R-4).
  function separateBlocks(lines) {
    const out = [];
    for (const line of lines) {
      const prev = out[out.length - 1];
      const boundary = prev && prev.kind !== 'blank' && line.kind !== 'blank' &&
        (prev.kind !== line.kind || (line.kind === 'fence' && prev.block !== line.block));
      if (boundary) out.push({ text: '', kind: 'blank' });
      out.push(line);
    }
    return out;
  }

  // ADO Wiki renders Mermaid only inside its ::: mermaid container, not a ```mermaid fence.
  function adoMermaid(lines) {
    const out = lines.map((line) => ({ ...line }));
    out.forEach((line, i) => {
      const open = line.opens && /^(\s*)(`{3,}|~{3,})\s*mermaid\s*$/i.exec(line.text);
      const close = open && out.find((l, j) => j > i && l.block === line.block && l.closes);
      if (!close) return; // unclosed (e.g. copied mid-stream): leave the fence alone
      line.text = open[1] + '::: mermaid';
      close.text = open[1] + ':::';
    });
    return out;
  }

  // FR-6.1
  function postProcess(markdown, format) {
    let lines = collapseBlankRuns(scanLines(markdown.replace(/\r\n?/g, '\n')));
    switch (format) {
      case 'ado':
        lines = adoMermaid(separateBlocks(lines));
        break;
      case 'obsidian':
        // FR-6.3: deliberately no changes yet; frontmatter and callouts go here.
        break;
      default:
        break;
    }
    // FR-6.4
    return lines.map((line) => line.text).join('\n').trim() + '\n';
  }

  // FR-4.1: converts a response container (left untouched; a clone is converted).
  function toMarkdown(sourceNode, { format = 'obsidian', strip = [] } = {}) {
    const root = sourceNode.cloneNode(true);
    replaceMath(root);
    for (const el of root.querySelectorAll(STRIP_SELECTORS.concat(strip).join(','))) el.remove();
    stripCodeLabels(root);
    service = service || createService();
    return postProcess(service.turndown(root), format);
  }

  return { toMarkdown, postProcess };
});

(() => {
  'use strict';

  const { detectPlatform, toMarkdown, DEFAULT_SETTINGS, FORMATS } = globalThis.CleanMD;

  const platform = detectPlatform(location.hostname);
  if (!platform) return; // FR-1.2

  const BUTTON_LABEL = 'Copy as MD';
  const BAR_CLASS = 'llmmd-bar';
  const INJECTED_ATTR = 'data-llmmd-injected';
  const FEEDBACK_MS = 1500;
  const SCAN_DEBOUNCE_MS = 250;
  // Long enough for the site's own clipboard write to land before ours replaces it.
  const NATIVE_COPY_DELAY_MS = 300;

  let settings = { ...DEFAULT_SETTINGS };
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    settings = stored;
  });
  // FR-3.4: popup changes apply to the next copy without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue ?? DEFAULT_SETTINGS[key];
    }
  });

  // ---- Response discovery -------------------------------------------------

  // Top-level response containers; a match nested inside another match is part of it.
  function findResponses(scope = document) {
    return Array.from(scope.querySelectorAll(platform.contentSelector))
      .filter((el) => !el.parentElement?.closest(platform.contentSelector));
  }

  function responseContaining(node) {
    let top = null;
    for (let el = node.closest(platform.contentSelector); el; el = el.parentElement?.closest(platform.contentSelector)) {
      top = el;
    }
    return top;
  }

  // ---- Conversion + clipboard ---------------------------------------------

  function convert(nodes) {
    return nodes.map((node) => toMarkdown(node, { format: settings.format, strip: platform.stripSelectors })).join('\n');
  }

  async function copyResponses(responses) {
    await navigator.clipboard.writeText(convert(responses)); // FR-7.1
  }

  function formatLabel() {
    return FORMATS[settings.format]?.label ?? settings.format;
  }

  // ---- Injected "Copy as MD" button (FR-2, FR-7) --------------------------

  const resetTimers = new WeakMap();

  function flash(button, text) {
    button.textContent = text;
    clearTimeout(resetTimers.get(button));
    resetTimers.set(button, setTimeout(() => { button.textContent = BUTTON_LABEL; }, FEEDBACK_MS));
  }

  function inject(response) {
    // FR-2.3: the marker alone isn't enough, since React may drop our bar on re-render.
    if (response.hasAttribute(INJECTED_ATTR) && response.nextElementSibling?.classList.contains(BAR_CLASS)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'llmmd-btn';
    button.textContent = BUTTON_LABEL;
    button.addEventListener('mouseenter', () => {
      button.title = `Copy this response as ${formatLabel()} Markdown`;
    });
    button.addEventListener('click', (event) => {
      event.preventDefault(); // FR-7.4
      event.stopPropagation();
      copyResponses([response]).then(
        () => flash(button, 'Copied!'),
        (error) => {
          console.error('[CleanMD] copy failed', error);
          flash(button, 'Error');
        },
      );
    });

    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.append(button);
    response.after(bar);
    response.setAttribute(INJECTED_ATTR, '');
  }

  // FR-2.4: pick up responses that stream in after load.
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      findResponses().forEach(inject);
    }, SCAN_DEBOUNCE_MS);
  }
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  scheduleScan();

  // ---- Ctrl/Cmd+C on a selection -------------------------------------------

  const TABLE_PARTS = ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR'];

  // A selection spanning several rows clones bare <tr>/<td>s; rebuild the
  // table around them, re-adding the header row if it wasn't selected.
  function rebuildTable(ancestor, fragment, range) {
    if (!TABLE_PARTS.includes(ancestor.nodeName)) return fragment;
    const table = ancestor.closest('table');
    let inner = fragment;
    for (let el = ancestor; el !== table; el = el.parentElement) {
      const shell = el.cloneNode(false);
      shell.append(inner);
      inner = shell;
    }
    const tableShell = table.cloneNode(false);
    const headerRow = table.rows[0];
    if (headerRow && !range.intersectsNode(headerRow)) {
      const thead = document.createElement('thead');
      thead.append(headerRow.cloneNode(true));
      tableShell.append(thead);
    }
    tableShell.append(inner);
    return tableShell;
  }

  function selectionToMarkdown() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const ancestor = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!ancestor || !responseContaining(ancestor)) return null;
    // Text inside one code block is already exact; the browser's copy is correct.
    if (ancestor.closest('pre, code')) return null;

    const wrapper = document.createElement('div');
    wrapper.append(rebuildTable(ancestor, range.cloneContents(), range));
    return convert([wrapper]);
  }

  // Capture on window so this runs before any copy handler the site registers.
  window.addEventListener('copy', (event) => {
    if (!settings.convertSelection) return;
    let markdown;
    try {
      markdown = selectionToMarkdown();
    } catch (error) {
      console.error('[CleanMD] selection conversion failed', error);
      return; // fall back to the browser's normal copy
    }
    if (markdown == null) return;
    // text/plain only: if HTML were also on the clipboard, Obsidian would
    // convert that instead, which is the path that breaks tables.
    event.clipboardData.setData('text/plain', markdown);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // ---- The site's own "Copy" button -----------------------------------------

  // Climbs from the site's copy button to the nearest ancestor that holds
  // response content. Bails out if that ancestor also holds another turn's
  // copy button, since it would then span more than one turn.
  function responsesForNativeButton(button) {
    for (let el = button.parentElement; el && el !== document.body; el = el.parentElement) {
      const responses = findResponses(el);
      if (!responses.length) continue;
      return el.querySelectorAll(platform.nativeCopySelector).length === 1 ? responses : [];
    }
    return [];
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'llmmd-toast';
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), FEEDBACK_MS);
  }

  document.addEventListener('click', (event) => {
    if (!settings.overrideNativeCopy || !platform.nativeCopySelector) return;
    const button = event.target.closest?.(platform.nativeCopySelector);
    // Copy buttons on code blocks sit inside the response; leave those exact.
    if (!button || button.closest(`pre, .${BAR_CLASS}`) || responseContaining(button)) return;
    const responses = responsesForNativeButton(button);
    if (!responses.length) return;
    setTimeout(() => {
      copyResponses(responses).then(
        () => toast(`CleanMD: copied as ${formatLabel()} Markdown`),
        (error) => console.error('[CleanMD] native copy override failed', error),
      );
    }, NATIVE_COPY_DELAY_MS);
  }, true);
})();

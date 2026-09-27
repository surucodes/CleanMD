// Shared by the content script and the popup.
(function (root) {
  'use strict';

  const FORMATS = {
    obsidian: { label: 'Obsidian', hint: 'GFM tables, $math$, ```mermaid fences' },
    ado: { label: 'Azure DevOps Wiki', hint: 'Adds Markdig block spacing and ::: mermaid containers' },
    gfm: { label: 'GitHub / plain Markdown', hint: 'Standard GFM with no destination tweaks' },
  };

  const DEFAULT_SETTINGS = {
    format: 'obsidian', // FR-3.3
    convertSelection: true, // Ctrl/Cmd+C on selected response text
    overrideNativeCopy: true, // the chat site's own "Copy" button
  };

  root.CleanMD = Object.assign(root.CleanMD || {}, { FORMATS, DEFAULT_SETTINGS });
})(globalThis);

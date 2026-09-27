// FR-1.3 / NFR-4: every host-page selector lives here. When a site redesign
// makes the buttons disappear, this is the only file that should need editing.
(function (root) {
  'use strict';

  const PLATFORM_CONFIG = {
    chatgpt: {
      label: 'ChatGPT',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      // Rendered markdown of one assistant message. Historically the most stable of the three.
      contentSelector: '[data-message-author-role="assistant"] .markdown',
      // The per-turn "Copy" button in the action bar under each response.
      nativeCopySelector: '[data-testid="copy-turn-action-button"]',
      stripSelectors: [],
    },
    claude: {
      label: 'Claude',
      hosts: ['claude.ai'],
      // CHECK FIRST when buttons vanish: Claude renames these classes more often than ChatGPT.
      // .font-claude-message is the older name, kept as a fallback.
      contentSelector: '.font-claude-response, .font-claude-message',
      nativeCopySelector: '[data-testid="action-bar-copy"]',
      stripSelectors: [],
    },
    copilot: {
      label: 'Microsoft 365 Copilot',
      hosts: ['m365.cloud.microsoft', 'copilot.cloud.microsoft', 'microsoft365.com', 'copilot.microsoft.com'],
      // UNVERIFIED: best-effort guesses, not yet checked against the live Copilot DOM.
      // Inspect an assistant reply in DevTools and replace these on first use.
      contentSelector: '[data-content="ai-message"], [data-testid="markdown-reply"], [data-testid="copilot-message-reply-div"]',
      nativeCopySelector: '[data-testid="CopyButtonTestId"], [data-testid="copy-button"]',
      stripSelectors: [],
    },
  };

  // FR-1.1: the platform whose host list matches, or null (FR-1.2: do nothing).
  function detectPlatform(hostname) {
    for (const [id, config] of Object.entries(PLATFORM_CONFIG)) {
      if (config.hosts.some((host) => hostname === host || hostname.endsWith('.' + host))) {
        return { id, ...config };
      }
    }
    return null;
  }

  root.CleanMD = Object.assign(root.CleanMD || {}, { PLATFORM_CONFIG, detectPlatform });
})(globalThis);

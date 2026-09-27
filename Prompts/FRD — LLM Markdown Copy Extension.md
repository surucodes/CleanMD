# Functional Requirements Document — LLM Markdown Copy Extension

Sep 26, 2026 · @Suraj Prasanna

## 1. Purpose and Overview

**Product name (working):** LLM Markdown Copy — Obsidian & ADO Wiki

**Problem statement:** When a user copies a ChatGPT or Claude response into a note-taking or documentation tool (Obsidian, Azure DevOps Wiki, etc.), the copied content does not preserve correct Markdown structure. Tables in particular break — multi-line cell content collapses, rows merge, and formatting is lost. This forces manual reformatting after every copy.

**Purpose:** Build a browser extension that intercepts the rendered HTML of an LLM chat response, converts it to clean, spec-correct Markdown using a real HTML-to-Markdown parser (not a naive text copy), applies formatting fixes specific to the destination flavor (Obsidian or Azure DevOps Wiki), and places the result on the clipboard — ready to paste with no manual cleanup.

**Primary user:** A single named user who works across ChatGPT and Claude for technical work, and pastes results into an Obsidian vault and an Azure DevOps Wiki daily. The extension is scoped first to this personal workflow; broader distribution (Chrome Web Store) is a secondary goal once the MVP is proven in daily use. Now , the user can either directly copy the text and then paste or click on the copy option provided by the LLM UI , this should ideally work on both. Also , should support mutiple options.

**Core value proposition:** Correctness of structural conversion — especially tables — over breadth of features. Section 2 intentionally keeps v1 narrow, because surveyed prior art (Section 7) already covers generic "copy as markdown" adequately. The gap this project fills is destination-flavor-aware post-processing (particularly Azure DevOps Wiki, which no surveyed competitor targets) and a table-conversion path verified against the specific failure mode — embedded line breaks inside table cells — that motivated this project.

## 2. Scope

### 2.1 In scope (v1 / MVP)

| # | Item |
| --- | --- |
| S1 | Manifest V3 Chrome/Edge browser extension |
| S2 | Support for three source platforms: chatgpt.com / chat.openai.com, claude.ai and microsoft copilot 365 |
| S3 | Support for mainly two destination markdown flavors: Obsidian and Azure DevOps Wiki , with other options as well&#32; |
| S4 | Per-response "Copy as MD" button injected into the chat UI |
| S5 | HTML-to-Markdown conversion via Turndown + the GFM plugin (tables, strikethrough, task lists) |
| S6 | Correct handling of multi-line table cells (the confirmed root cause of broken tables) |
| S7 | Correct fenced code block conversion with language tag preserved |
| S8 | Format-flavor toggle (Obsidian / ADO Wiki/ something else ) via the extension's popup, persisted across sessions |
| S9 | Clipboard write of the final converted markdown, with visual copy confirmation on the button |
| &#32; |  |

### 2.2 Out of scope for v1

See Section 9 for the full list and rationale. In brief: direct push to Obsidian or ADO via their REST APIs, batch/whole-thread export, YAML frontmatter injection, callout auto-detection, and Chrome Web Store publishing are all deferred past the MVP.

## 3. Definitions and Glossary

| Term | Meaning |
| --- | --- |
| ADO Wiki | Azure DevOps Wiki — a project wiki whose markdown is rendered by the Markdig parser, with some syntax differences from GitHub-flavored markdown (e.g. `[[_TOC_]]` for table of contents, stricter block spacing rules) |
| GFM | GitHub-Flavored Markdown — the markdown dialect extension (pipe tables, strikethrough, task lists) that both Obsidian and ADO Wiki substantially support |
| Turndown | The open-source JavaScript library (`turndown` npm package) used to convert HTML DOM nodes into Markdown text. Used here as the core conversion engine rather than string-based scraping |
| turndown-plugin-gfm | Official companion plugin for Turndown adding GFM table, strikethrough, and task-list-item conversion rules |
| Content script | A browser extension script injected directly into the page's DOM (chatgpt.com or claude.ai), able to read and act on the live page |
| Manifest V3 (MV3) | The current Chrome/Edge extension platform specification; required for any new extension submitted to the Chrome Web Store |
| Flavor | The destination markdown dialect the user is converting to — either "obsidian" or "ado" in this document. Selected via the extension's popup and stored via `chrome.storage.sync` |
| Cell line-break bug | The specific defect motivating this project: an LLM response's `<br>` inside a table cell converts by default to a literal newline, which terminates a markdown table row mid-cell and corrupts every subsequent row |

## 4. Actors and Target Platforms

### 4.1 Actor

Only one actor in v1: **the end user**, who reads an LLM response, clicks "Copy as MD," and pastes the result into a destination document. There is no admin, reviewer, or multi-user role.

### 4.2 Source platforms (where content is copied FROM)

| Platform | Hosts matched | Notes |
| --- | --- | --- |
| ChatGPT | `chatgpt.com`, `chat.openai.com` | Assistant turn identified via `[data-message-author-role="assistant"]`; rendered content lives in a `.markdown` node inside the turn |
| Claude | `claude.ai` | Assistant turn identified via `[data-testid="conversation-turn"]`; rendered content lives in a `.font-claude-message` node. Flagged as the less stable of the two selectors |

### 4.3 Destination formats (where content is pasted TO)

| Format | Rendering engine | Selected via |
| --- | --- | --- |
| Obsidian | Obsidian's own markdown renderer (CommonMark + GFM extensions, lenient on block spacing) | Popup radio button, default selection |
| Azure DevOps Wiki | Markdig | Popup radio button |

Both destinations are reached the same way — clipboard paste — there is no direct-write integration with either in v1 (see Section 9).

## 5. Functional Requirements

### FR-1 Platform detection

- FR-1.1: On page load, the content script MUST determine which supported platform (ChatGPT or Claude) it is running on by matching `location.hostname` against a config table.
- FR-1.2: If the hostname matches no supported platform, the extension MUST take no action (no button injection, no observers started).
- FR-1.3: Platform-to-selector mappings MUST live in a single config object (`PLATFORM_CONFIG`) so a broken selector can be fixed in one place without touching conversion logic.

### FR-2 Response detection and button injection

- FR-2.1: The extension MUST identify each individual assistant response ("turn") in the DOM using the platform's configured `responseSelector`.
- FR-2.2: The extension MUST inject exactly one "Copy as MD" button per assistant turn, placed visibly adjacent to that turn's content.
- FR-2.3: The extension MUST NOT inject a duplicate button into a turn it has already processed (tracked via a `data-llmmd-injected` marker on the turn element).
- FR-2.4: The extension MUST detect newly-appearing assistant turns — including ones that stream in after the initial page load — via a `MutationObserver` on `document.body`, and inject buttons into them without a page reload.

### FR-3 Format selection

- FR-3.1: The user MUST be able to choose between exactly two destination formats — "Obsidian" and "Azure DevOps Wiki" — via radio buttons in the extension's toolbar popup.
- FR-3.2: The selected format MUST persist across browser sessions using `chrome.storage.sync`.
- FR-3.3: The default format on first install, before any selection is made, MUST be "Obsidian."
- FR-3.4: Changing the format in the popup MUST take effect on the next "Copy as MD" click — no page reload required.

### FR-4 HTML-to-Markdown conversion

- FR-4.1: On button click, the extension MUST read the `innerHTML` of the response's content container (per FR-1.3's selector config) and convert it to Markdown using Turndown, configured with: ATX-style headings, fenced code blocks, `-` bullet markers, `*` emphasis delimiters.
- FR-4.2: The conversion MUST use `turndown-plugin-gfm`'s GFM rule set so that tables, strikethrough, and task-list items convert correctly by default, without custom rules duplicating that behavior.
- FR-4.3: Fenced code blocks MUST preserve the source language as a fence tag (e.g. ```` ```python ````), read from a `language-xxx` class on the `<code>` element. (Verified: Turndown's built-in fenced-code rule already does this — no custom rule required, confirmed against both platforms' markup in testing.)

### FR-5 Table integrity (primary defect fix)

- FR-5.1: A `<br>` element found inside a `<td>` or `<th>` (at any ancestor depth) MUST be converted to a literal `<br>` string in the output, NOT Turndown's default two-trailing-spaces-plus-newline line break.
  - Rationale: a real newline inside a GFM pipe-table cell terminates that table row, corrupting every row that follows it in the same table. This was confirmed via direct testing (Section 10, TC-3) to be the actual mechanism behind the tables breaking, and is the core defect this project exists to fix.
  - Both destination renderers (Obsidian, Markdig/ADO Wiki) support raw inline HTML inside table cells, so a literal `<br>` renders correctly in both.
- FR-5.2: A `<br>` element found OUTSIDE a table cell MUST retain Turndown's default line-break conversion (two trailing spaces + newline), so normal paragraph line breaks are unaffected.
- FR-5.3: This rule MUST be implemented as a Turndown `addRule` (not a post-hoc string regex on the output), because rule-level interception happens before the table structure is serialized to text, and is verified to take precedence over Turndown's built-in `br` rule (Turndown checks custom `addRule` entries, most-recently-added first, ahead of built-in rules).

### FR-6 Format-specific post-processing

- FR-6.1: After Turndown conversion, the extension MUST run a `postProcess(markdown, format)` step keyed on the selected destination format.
- FR-6.2: For `format === "ado"`: the extension MUST ensure a blank line separates a table block from adjacent non-table content, and a fenced code block from adjacent non-code content, WITHOUT inserting blank lines between rows of the same table or lines of the same fence.
  - This MUST be implemented so that the check for "is this a table row / fence line" excludes `|` / `` ` `` from the character class used to detect "non-table" or "non-fence" adjacent lines (see Section 8, defect log, for the specific bug this guards against: an earlier draft of this regex incorrectly matched between table rows themselves and fragmented the table).
  - Verified via testing (Section 10, TC-4 and TC-5) that: (a) normal Turndown output, which already separates blocks correctly, passes through unchanged; (b) synthetically tightly-packed input gets the missing blank lines inserted correctly.
- FR-6.3: For `format === "obsidian"`: no structural changes are applied in v1 (Obsidian's renderer was found to be lenient enough not to need them). This branch MUST remain present as an explicit no-op rather than being omitted, so future Obsidian-specific rules (e.g. frontmatter, callouts — see Section 9) have a defined insertion point.
- FR-6.4: Output MUST be trimmed of leading/trailing whitespace and end with exactly one trailing newline.

### FR-7 Clipboard write and user feedback

- FR-7.1: The final post-processed markdown MUST be written to the system clipboard via `navigator.clipboard.writeText`.
- FR-7.2: On successful copy, the button's label MUST change to "Copied!" for 1.5 seconds, then revert to its original label.
- FR-7.3: On conversion or clipboard failure, the button's label MUST change to "Error" for 1.5 seconds, then revert, and the error MUST be logged to the console for debugging.
- FR-7.4: The button MUST prevent default event behavior and stop propagation on click, so it never interferes with the host page's own click handlers.

## 6. Non-Functional Requirements

| # | Category | Requirement |
| --- | --- | --- |
| NFR-1 | Privacy | All conversion happens locally in the browser. No response content, converted markdown, or usage data is transmitted to any server. |
| NFR-2 | Permissions | The extension requests only the minimum Manifest V3 permissions needed: `clipboardWrite`, `storage`, and host permissions scoped to the four supported hostnames — no broad `<all_urls>` access. |
| NFR-3 | Performance | Conversion of a single response MUST complete synchronously within the click handler with no perceptible delay (target: under 100ms for a typical response) — Turndown's DOM-based conversion is fast enough that no async/background processing is needed for v1. |
| NFR-4 | Resilience to DOM changes | Platform selectors MUST be isolated in one config object (`PLATFORM_CONFIG`) so that a ChatGPT or Claude UI redesign requires a one-place fix, not a rewrite of conversion logic. This is a known, accepted risk — see Section 8. |
| NFR-5 | Maintainability | Conversion and post-processing logic MUST be unit-testable outside the browser (in plain Node.js), since selector/DOM logic and conversion logic have different failure modes and should be verifiable independently. |
| NFR-6 | Bundle size / offline capability | Turndown and turndown-plugin-gfm MUST be bundled as local UMD files inside the extension package — no runtime dependency on a CDN — so the extension works offline and isn't subject to CSP restrictions on external script loading. |
| NFR-7 | Browser compatibility | Target Manifest V3 — compatible with current Chrome and Edge. Firefox support is not required for v1 (see Section 9). |

## 7. Dependencies and Assumptions

### 7.1 Library dependencies

| Library | Role | Notes |
| --- | --- | --- |
| `turndown` | Core HTML → Markdown conversion engine | Bundled as a local UMD file (`lib/turndown.js`), not loaded from a CDN |
| `turndown-plugin-gfm` | Adds GFM table, strikethrough, and task-list conversion rules on top of Turndown | Bundled as a local UMD file (`lib/turndown-plugin-gfm.js`) |

### 7.2 Browser API dependencies

- `chrome.storage.sync` — persisting the selected format across sessions (and, if the user is signed into Chrome, across devices)
- `navigator.clipboard.writeText` — writing the converted markdown to the system clipboard
- `MutationObserver` — detecting new/streamed assistant turns without a page reload

### 7.3 Assumptions

- The user has one Chromium-based browser (Chrome or Edge) as their primary browser for this workflow.
- ChatGPT and Claude's DOM structure remains close enough to what was observed during this build that the configured selectors keep working for a reasonable maintenance window; when they drift, Section 8 documents exactly what to check first.
- Obsidian and Azure DevOps Wiki both render raw inline HTML (`<br>`) inside markdown table cells — this was not independently re-verified against a live Obsidian install or a live ADO Wiki instance in this build session; it is based on both platforms' documented CommonMark/Markdig compatibility and is flagged as an assumption to confirm during first real-world use (see Section 10, UAT).

### 7.4 Prior art considered

Surveyed before starting this build (see chat history for full findings): **Obsidian AI Exporter** (multi-platform, direct Obsidian REST API push), **ChatGPT Copy As Markdown** (polished, ChatGPT-only, no ADO Wiki flavor), **Simple ChatGPT Clipper**, **ChatGPT CopyIt**, and **chat\_gpt\_markdown\_magic** (older, simpler, single-purpose copy buttons). None of the surveyed tools target Azure DevOps Wiki specifically — this is the identified gap this project fills.

## 8. Known Limitations and Risks

| # | Risk / Limitation | Impact | Mitigation |
| --- | --- | --- | --- |
| R-1 | Platform selectors are fragile. ChatGPT and Claude both redesign their DOM periodically without notice (a documented pain point in every surveyed competitor's own README). | Buttons silently stop appearing until selectors are updated. | Selectors isolated in one PLATFORM\_CONFIG object with inline comments flagging which one to check first (Claude's is explicitly called out as less stable than ChatGPT's). No automated selector-health check exists in v1. |
| R-2 | Turndown's default text escaping will escape markdown-special characters (square brackets, underscores) found in ordinary response text. Confirmed in testing: a literal ADO table-of-contents marker written as plain text inside a table cell gets backslash-escaped on conversion. | Rare in practice (responses rarely contain literal ADO TOC syntax as prose), but would look wrong if it occurred. | Not fixed in v1 — logged here as a known edge case rather than silently ignored. |
| R-3 | The claim that Obsidian and ADO Wiki both correctly render raw inline HTML line breaks inside table cells (FR-5.1) is based on documented renderer compatibility, not a live round-trip test against real Obsidian or ADO installs. | If the assumption is wrong for either renderer, tables would still look broken after paste for that destination specifically. | Flagged in Section 7.3; first real-world use should confirm this before treating the defect as closed. |
| R-4 | An earlier draft of the ADO blank-line post-processing regex (FR-6.2) had a bug where it inserted blank lines between every table row, not just at table boundaries — caught during testing before shipping, but it demonstrates a general risk class: string-level regex post-processing on markdown is easy to get subtly wrong. | Would have shipped broken tables under the ADO format specifically, if untested. | Caught and fixed via direct test cases (Section 10) before this document was written. Any future change to the post-processing step should be re-run against the same test cases. |
| R-5 | No automated test suite ships with the extension itself — verification in this build was done via ad hoc Node.js scripts exercising the same conversion functions outside the browser, not a checked-in test file. | Regressions in future edits could go undetected. | Logged as a v1 gap; a minimal test file mirroring the ad hoc scripts is a natural first addition (see Section 9). |
| R-6 | Single-maintainer project with no CI, no automated Chrome Web Store update pipeline. | Any DOM-breakage fix (R-1) requires manual detection and a manual reload of the unpacked extension until published. | Acceptable for v1's personal-use scope; revisit if or when Chrome Web Store publishing (Section 9) becomes a goal. |

## 9. Out of Scope / Future Enhancements

Deferred deliberately, to keep v1 shippable in a small number of weekend sessions:

| Enhancement | Why deferred |
| --- | --- |
| Direct push to Obsidian via its Local REST API plugin, or direct push to ADO Wiki via its REST API, instead of clipboard-only copy | Highest-value stretch feature, but a materially larger scope — auth/token handling, API error states, and a settings UI for endpoints/keys. Clipboard-only ships the core value (correct conversion) fastest. |
| Batch / whole-thread export (entire conversation, not just one response) | Needs a different UI (thread-level control, not per-response button) and a decision on multi-file vs single-file output. |
| YAML frontmatter auto-injection for Obsidian (date, source URL, tags) | Straightforward addition once the core conversion is proven reliable in daily use; the postProcess "obsidian" branch (FR-6.3) is already structured to receive this. |
| Auto-detection of LLM-style "Note:" or warning text and conversion to Obsidian callout syntax | Judgment-call heuristic (what counts as a callout) that risks false positives; not attempted until the core conversion has been used enough to see real patterns. |
| Auto table-of-contents insertion for ADO Wiki documents with 3+ headings | Small, low-risk addition; deferred only because it wasn't part of the table-integrity defect this build focused on fixing. |
| Firefox / other browser support | v1 targets Manifest V3 (Chrome/Edge) only; Firefox's MV3 support and API surface differ enough to warrant a separate pass. |
| Chrome Web Store publishing | v1 is scoped for personal use as an unpacked/loaded extension first, to validate real-world reliability (see Section 8, R-3) before investing in store listing, review process, and versioned update infrastructure. |
| Checked-in automated test suite | Currently ad hoc Node.js verification scripts (see Section 8, R-5); formalizing these into a real test file is a natural next step, not a v1 blocker. |

## 10. Acceptance Criteria and Test Cases

### 10.1 Automated / scripted test cases (verified during this build)

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| TC-1 | Convert a table + fenced code block through the full conversion pipeline | Table renders as valid GFM pipe syntax; code fence carries the correct language tag | Pass |
| TC-2 | Convert a table cell containing multiple line breaks (the reported defect) | All rows remain on their own table line; line-break content is preserved via inline HTML in the cell, not a raw newline | Pass, after the br-in-td/th rule fix (FR-5.1) |
| TC-3 | Composite response: heading, paragraph, table with multi-line cell, nested list, code block — run through both Obsidian and ADO post-processing | Both outputs remain structurally valid; ADO output has correctly placed blank lines around table and code fence | Pass, after the FR-6.2 regex fix |
| TC-4 | Normal (already well-spaced) Turndown output run through ADO post-processing | Output is unchanged — no spurious blank lines inserted between table rows | Pass (this caught the original regex bug, R-4) |
| TC-5 | Synthetically tightly-packed markdown (table or fence with no surrounding blank line) run through ADO post-processing | Missing blank lines are correctly inserted at the table/fence boundary only | Pass |

### 10.2 Manual acceptance criteria (for real-world use — not yet performed)

| ID | Criterion |
| --- | --- |
| UAT-1 | Load the unpacked extension in Chrome/Edge developer mode; "Copy as MD" button appears under at least one real assistant response on both chatgpt.com and claude.ai |
| UAT-2 | Click the button on a response containing a genuinely broken table (the kind that originally motivated this project); paste into a real Obsidian note; table renders correctly, including any multi-line cell content |
| UAT-3 | Repeat UAT-2 pasting into a real Azure DevOps Wiki page; table renders correctly |
| UAT-4 | Switch the format toggle in the popup between paste attempts; confirm the ADO-specific spacing fixes are only applied when "Azure DevOps Wiki" is selected |
| UAT-5 | Confirm the button correctly re-appears on new responses as a conversation continues (streaming), without a page reload |
| UAT-6 | Confirm no console errors appear during normal use across a full multi-turn conversation |

### 10.3 Definition of done for v1

All rows in 10.1 pass (already true as of this document) AND all rows in 10.2 pass on first real-world use. R-3 (the br-in-cell renderer assumption) is explicitly called out as the one thing this build could not verify without a live Obsidian vault and ADO Wiki instance — UAT-2 and UAT-3 close that gap.

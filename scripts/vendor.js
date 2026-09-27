// Copies the browser builds of Turndown and its GFM plugin into lib/, so the
// extension ships them locally instead of loading from a CDN (NFR-6).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = {
  'lib/turndown.js': 'node_modules/turndown/lib/turndown.browser.umd.js',
  'lib/turndown-plugin-gfm.js': 'node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js',
};

fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
for (const [dest, src] of Object.entries(files)) {
  fs.copyFileSync(path.join(root, src), path.join(root, dest));
  console.log(`vendored ${dest}`);
}

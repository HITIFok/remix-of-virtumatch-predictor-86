#!/usr/bin/env node
// Compute SHA-256 hashes for inline <style> and <script> content in index.html
// These hashes go into CSP style-src and script-src directives.

import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const html = readFileSync('/home/z/my-project/index.html', 'utf8');

// Extract the inline <style> block content (between <style> and </style>)
const styleMatch = html.match(/<style>\n([\s\S]*?)\n    <\/style>/);
if (!styleMatch) {
  console.error('Could not find inline <style> block');
  process.exit(1);
}
const styleContent = styleMatch[1];
const styleHash = createHash('sha256').update(styleContent).digest('base64');
console.log(`style-src hash: 'sha256-${styleHash}'`);
console.log(`  (content length: ${styleContent.length} chars)`);

// Extract the inline <script> block content (between <script> and </script>, excluding type="module")
const scriptMatch = html.match(/<script>\n([\s\S]*?)\n    <\/script>/);
if (!scriptMatch) {
  console.error('Could not find inline <script> block');
  process.exit(1);
}
const scriptContent = scriptMatch[1];
const scriptHash = createHash('sha256').update(scriptContent).digest('base64');
console.log(`script-src hash: 'sha256-${scriptHash}'`);
console.log(`  (content length: ${scriptContent.length} chars)`);

// Also check for inline style attributes
const styleAttrMatches = [...html.matchAll(/style="([^"]+)"/g)];
console.log(`\nFound ${styleAttrMatches.length} inline style attributes to convert to CSS classes:`);
for (const m of styleAttrMatches) {
  console.log(`  style="${m[1].substring(0, 60)}${m[1].length > 60 ? '...' : ''}"`);
  const attrHash = createHash('sha256').update(m[1]).digest('base64');
  console.log(`    hash: 'sha256-${attrHash}'`);
}

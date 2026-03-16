import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexHtmlPath = path.resolve(__dirname, '../index.html');
const themeInitPath = path.resolve(__dirname, '../public/theme-init.js');

test('index.html loads theme bootstrap from an external script', async () => {
  const html = await readFile(indexHtmlPath, 'utf8');

  assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/);
});

test('theme bootstrap script exists in public assets', async () => {
  const script = await readFile(themeInitPath, 'utf8');

  assert.match(script, /localStorage\.getItem\('theme'\)/);
  assert.match(script, /document\.documentElement\.classList\.add\('dark'\)/);
});

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Mobile components exist', () => {
  const mobileDir = path.join(__dirname, '../src/components/mobile');
  const files = [
    'BottomNav.tsx',
    'SwipeableCard.tsx',
    'MobileCard.tsx',
    'PullToRefresh.tsx',
    'ResponsiveTable.tsx',
    'InfiniteScroll.tsx',
    'TouchButton.tsx'
  ];

  files.forEach(file => {
    const filePath = path.join(mobileDir, file);
    assert.ok(fs.existsSync(filePath), `${file} should exist`);
  });
});

test('PWA files exist', () => {
  const publicDir = path.join(__dirname, '../public');

  assert.ok(fs.existsSync(path.join(publicDir, 'sw.js')), 'Service worker should exist');
  assert.ok(fs.existsSync(path.join(publicDir, 'manifest.json')), 'Manifest should exist');
});

test('Mobile hooks exist', () => {
  const hooksDir = path.join(__dirname, '../src/hooks');

  assert.ok(fs.existsSync(path.join(hooksDir, 'useMobileDetect.ts')), 'useMobileDetect hook should exist');
  assert.ok(fs.existsSync(path.join(hooksDir, 'usePWAInstall.ts')), 'usePWAInstall hook should exist');
});

test('Manifest has required PWA fields', () => {
  const manifestPath = path.join(__dirname, '../public/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.name, 'Manifest should have name');
  assert.ok(manifest.short_name, 'Manifest should have short_name');
  assert.ok(manifest.start_url, 'Manifest should have start_url');
  assert.ok(manifest.display === 'standalone', 'Manifest should have standalone display');
  assert.ok(manifest.icons && manifest.icons.length > 0, 'Manifest should have icons');
  assert.ok(manifest.shortcuts, 'Manifest should have shortcuts');
});

test('Service worker has push notification support', () => {
  const swPath = path.join(__dirname, '../public/sw.js');
  const swContent = fs.readFileSync(swPath, 'utf8');

  assert.ok(swContent.includes('push'), 'Service worker should handle push events');
  assert.ok(swContent.includes('notificationclick'), 'Service worker should handle notification clicks');
});

test('Mobile CSS exists', () => {
  const mobileCssPath = path.join(__dirname, '../src/styles/mobile.css');
  assert.ok(fs.existsSync(mobileCssPath), 'Mobile CSS should exist');

  const content = fs.readFileSync(mobileCssPath, 'utf8');
  assert.ok(content.includes('touch-target'), 'Mobile CSS should have touch-target class');
  assert.ok(content.includes('safe-area-inset'), 'Mobile CSS should support safe area insets');
});


import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = relative => readFileSync(new URL('../mobile/'+relative,import.meta.url),'utf8');

test('desktop layout uses fixed sidebar and unrestricted responsive work area',()=>{
  const css=read('styles.css');
  assert.match(css,/@media\(min-width:980px\)/);
  assert.match(css,/grid-template-columns:236px minmax\(0,1fr\)/);
  assert.match(css,/\.bottom-nav\{grid-column:1;grid-row:2;/);
  assert.match(css,/max-width:1500px/);
});
test('tablet landscape has two-column reader and mobile portrait preserves bottom navigation',()=>{
  const css=read('styles.css');
  assert.match(css,/@media\(min-width:600px\) and \(max-width:979px\)/);
  assert.match(css,/\.reader-screen\{display:grid;grid-template-columns:minmax\(175px,30%\)/);
  assert.match(css,/@media\(max-width:599px\) and \(orientation:portrait\)/);
  assert.match(css,/@media\(max-width:760px\) and \(orientation:landscape\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
});
test('Modules and Assignments readers use matching responsive outlines',()=>{
  const page=read('core/page-ui.mjs');
  const assignment=read('core/assignment-ui.mjs');
  assert.match(page,/reader-screen/);
  assert.match(page,/reader-outline/);
  assert.match(page,/data-open-page-slug/);
  assert.match(assignment,/reader-screen assignment-screen/);
  assert.match(assignment,/reader-outline/);
  assert.match(assignment,/data-open-assignment-id/);
});
test('privacy-preserving offline service worker caches app assets but not course API responses',()=>{
  const sw=read('public/sw.js');
  assert.match(sw,/event\.request\.method !== 'GET'/);
  assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw,/url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.doesNotMatch(sw,/token|Authorization/);
});
test('account controls are accessible without replacing the original Quercus operations',()=>{
  const html=read('index.html');
  assert.match(html,/id="accountButton"/);
  assert.match(html,/id="accountDialog"/);
  assert.match(html,/id="cloudAutoUpload"/);
  assert.match(html,/id="cloudUploadNow"/);
  assert.match(html,/id="connectButton"/);
  assert.match(html,/id="exportButton"/);
  assert.match(html,/id="importButton"/);
  assert.match(html,/https:\/\/ep-proud-poetry-bd2f21s9\.neonauth\./);
  const app=read('app.js');
  assert.match(app,/await cloud\.initialize\(\)/);
  assert.match(app,/await cloud\.localChanged\(next,\{fromQuercus:true\}\)/);
});

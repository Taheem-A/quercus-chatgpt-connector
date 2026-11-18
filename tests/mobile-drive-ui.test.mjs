import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('new Drive organizer opens from More and preserves all existing sections',()=>{
  const app=read('../mobile/app.js');
  const html=read('../mobile/index.html');
  assert.match(app,/setupDrive/);
  assert.match(app,/drive\.open/);
  assert.match(app,/id="openDriveMore"/);
  assert.match(html,/id="driveDialog"/);
  assert.match(html,/driveFolderMap/);
  assert.match(html,/driveFilePreview/);
  assert.match(html,/driveUploadContext/);
  assert.match(html,/driveUploadSelected/);
  assert.match(html,/driveConfirmAccount/);
  assert.match(html,/data-export="full-with-attachments"/);
  assert.match(app,/pages:snapshotPages,announcements:snapshotAnnouncements,more:snapshotMore/);
});
test('Google OAuth is limited to official script origin and Drive API hosts',()=>{
  const html=read('../mobile/index.html');
  assert.match(html,/script-src 'self' https:\/\/accounts\.google\.com/);
  assert.match(html,/connect-src 'self' https:\/\/www\.googleapis\.com/);
  assert.match(html,/src="https:\/\/accounts\.google\.com\/gsi\/client"/);
  const ui=read('../mobile/core/drive-ui.mjs');
  assert.match(ui,/Connect your Quercus token/);
  assert.match(ui,/ensureReady\(\)/);
  assert.match(ui,/Confirm the displayed Google account before any Drive upload/);
  assert.match(ui,/Re-read the destination before EACH write/);
  assert.match(ui,/getCanvasToken\(\)/);
  assert.match(ui,/localStorage\.setItem\(scopedKey\(subject\)/);
  assert.doesNotMatch(ui,/localStorage\.setItem\([^)]*accessToken/);
  assert.doesNotMatch(ui,/\bdeleteFile\b|\bmoveFile\b|\bupdateExisting\b/);
});
test('Google Drive install does not change automatic deployment control',()=>{
  const config=JSON.parse(read('../mobile/vercel.json'));
  assert.equal(config.git.deploymentEnabled,false);
  assert(config.rewrites.some(x=>x.source.startsWith('/auth/')));
});

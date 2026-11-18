import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DriveAuthorization} from '../mobile/core/drive-auth.mjs';
import {DRIVE_SCOPES} from '../mobile/core/drive-api.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const id='123456789012-abcdefghijklmnopqrstuvwx.apps.googleusercontent.com';

test('deployment sends OAuth popup-compatible opener policy on HTML entrypoints only',()=>{
  const cfg=JSON.parse(read('../mobile/vercel.json'));
  assert.equal(cfg.git.deploymentEnabled,false,'automatic Git deployments must stay off');
  for(const source of ['/','/index.html']){
    const route=cfg.headers.find(row=>row.source===source);
    assert(route,'missing COOP rule for '+source);
    assert.equal(route.headers.find(h=>h.key.toLowerCase()==='cross-origin-opener-policy')?.value,
      'same-origin-allow-popups');
  }
});
test('Google GIS and installed app assets are authorized by CSP and rooted paths',()=>{
  const html=read('../mobile/index.html');
  const manifest=JSON.parse(read('../mobile/public/manifest.webmanifest'));
  assert.match(html,/script-src 'self' https:\/\/accounts\.google\.com/);
  assert.match(html,/style-src 'self' https:\/\/accounts\.google\.com\/gsi\/style 'unsafe-inline'/);
  assert.match(html,/<link rel="icon" href="\/icon\.svg"/);
  assert.match(html,/<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.icons[0].src,'/icon.svg');
  assert.match(html,/meta name="mobile-web-app-capable"/);
});
test('OAuth callback that never fires fails with actionable timeout and can be retried',async()=>{
  let timeout,callback;
  let cancelled=null;
  const fake={accounts:{oauth2:{
    initTokenClient(config){
      callback=config.callback;
      return {requestAccessToken(){}};
    }
  }}};
  const auth=new DriveAuthorization(()=>fake,{
    timeoutMs:100,
    schedule:fn=>{timeout=fn;return 9;},
    cancel:id=>{cancelled=id;}
  });
  const pending=auth.connect(id);
  assert.equal(typeof timeout,'function');
  timeout();
  await assert.rejects(pending,/did not return an authorization result/);
  assert.equal(cancelled,9);
  assert.equal(auth.isConnected(),false);
  callback({access_token:'a'.repeat(60),scope:DRIVE_SCOPES,expires_in:3600});
  assert.equal(auth.isConnected(),false,'late callback cannot create an unauthorized session');
});
test('popup error callback settles the connection and restores ordinary error handling',async()=>{
  let cancelled=null;
  const fake={accounts:{oauth2:{
    initTokenClient(config){return {
      requestAccessToken(){config.error_callback({type:'popup_failed_to_open'});}
    };}
  }}};
  const auth=new DriveAuthorization(()=>fake,{
    schedule:()=>17,cancel:id=>{cancelled=id;}
  });
  await assert.rejects(auth.connect(id),/popup was blocked or closed/);
  assert.equal(cancelled,17);
});
test('successful authorization still accepts granted Drive scopes and does not store a token',async()=>{
  let cleaned=null;
  const fake={accounts:{oauth2:{
    initTokenClient(config){return {requestAccessToken(){
      config.callback({access_token:'a'.repeat(60),scope:DRIVE_SCOPES,expires_in:3600});
    }};}
  }}};
  const auth=new DriveAuthorization(()=>fake,{
    schedule:()=>42,cancel:id=>{cleaned=id;}
  });
  assert.equal(await auth.connect(id),true);
  assert.equal(cleaned,42);
  assert.equal(auth.isConnected(),true);
  auth.disconnect();
  assert.equal(auth.isConnected(),false);
});
test('Drive UI shows progress then verifies account without making network calls from a timer',()=>{
  const ui=read('../mobile/core/drive-ui.mjs');
  assert.match(ui,/Google permission window opened/);
  assert.match(ui,/Permission granted\. Verifying access/);
  assert.match(ui,/busy=false;\s+drawConfig\(\)/);
});

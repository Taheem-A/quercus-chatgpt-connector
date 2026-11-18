import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCloudJwt,looksLikeJwt } from '../mobile/core/neon-jwt.mjs';
import { authProxyRoute } from '../mobile/core/auth-proxy-route.mjs';

const fakeJwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.signaturebytes';

test('never mistake an opaque Neon session token or a Quercus API key for a signed JWT',()=>{
  assert.equal(looksLikeJwt(fakeJwt),true);
  assert.equal(looksLikeJwt('session-token_9a8b7c'),false);
  assert.equal(looksLikeJwt('opaque.neon-session'),false);
  assert.equal(looksLikeJwt(''),false);
  assert.equal(looksLikeJwt(null),false);
  assert.equal(looksLikeJwt('aaa.bbb.'),false);
  assert.equal(looksLikeJwt('aaa.bbb.ccc.ddd'),false);
});
test('signed cloud access JWT comes from same-origin GET /auth/token only',async()=>{
  let count=0;
  const result=await getCloudJwt(async (path,opts)=>{
    count++;
    assert.equal(path,'/auth/token');
    assert.equal(opts.method,'GET');
    assert.equal(opts.credentials,'same-origin');
    assert.equal(opts.cache,'no-store');
    return new Response(JSON.stringify({token:fakeJwt}),{
      status:200,headers:{'content-type':'application/json'},
    });
  });
  assert.equal(result,fakeJwt);
  assert.equal(count,1);
  assert.deepEqual(authProxyRoute('https://quercus-pocket.vercel.app/auth/token'),{path:'token',query:''});
});
test('cloud refuses malformed provider response instead of sending a bad credential to Postgres',async()=>{
  await assert.rejects(()=>getCloudJwt(async()=>new Response(JSON.stringify({token:'opaque-session-id'}),{status:200})),/instead of a signed JWT/);
  await assert.rejects(()=>getCloudJwt(async()=>new Response(JSON.stringify({data:{session:{token:'opaque-session-id'}}}),{status:200})),/instead of a signed JWT/);
  await assert.rejects(()=>getCloudJwt(async()=>new Response('unauthorized',{status:401})),/expired/);
  await assert.rejects(()=>getCloudJwt(async()=>new Response('unavailable',{status:503})),/Could not obtain/);
  await assert.rejects(()=>getCloudJwt(async()=>new Response('invalid json',{status:200})),/instead of a signed JWT/);
});
test('all cloud database queries use JWT-backed client, never the session client',()=>{
  const src=readFileSync(new URL('../mobile/core/cloud-client.mjs',import.meta.url),'utf8');
  assert.match(src,/getToken:getCloudJwt/);
  assert.equal((src.match(/privateDb\.from\(TABLE\)/g)||[]).length,4);
  assert.doesNotMatch(src,/neon\.from\(TABLE\)/);
  assert.match(src,/async current\(\)/);
  assert.match(src,/neon\.auth\.getSession\(\)/);
  assert.doesNotMatch(src,/getSession\(\)[\s\S]{0,150}\.token/);
});

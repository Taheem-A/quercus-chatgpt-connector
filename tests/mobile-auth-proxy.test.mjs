import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authProxyRoute } from '../mobile/core/auth-proxy-route.mjs';

test('same-origin auth route passes only validated relative endpoint paths',()=>{
  const base='https://quercus-pocket.vercel.app';
  assert.deepEqual(authProxyRoute(base+'/api/auth-proxy?path=sign-in/email'),
    {path:'sign-in/email',query:''});
  assert.deepEqual(authProxyRoute(base+'/auth/get-session?fields=user'),
    {path:'get-session',query:'fields=user'});
  assert.deepEqual(authProxyRoute(base+'/auth/email-otp/verify-email'),
    {path:'email-otp/verify-email',query:''});
  assert.equal(authProxyRoute(base+'/auth/../etc'),null);
  assert.equal(authProxyRoute(base+'/api/auth-proxy?path=https%3A%2F%2Fevil.com'),null);
  assert.equal(authProxyRoute(base+'/api/auth-proxy?path=..%2F..%2Fprivate'),null);
  assert.equal(authProxyRoute(base+'/api/auth-proxy?path=oauth%0Aevil'),null);
  assert.equal(authProxyRoute(base+'/api/auth-proxy?path='+ 'a'.repeat(260)),null);
  assert.equal(authProxyRoute('garbage'),null);
});

test('auth uses a first-party proxy with no embedded cookie secret',()=>{
  const config=JSON.parse(readFileSync(new URL('../mobile/vercel.json',import.meta.url),'utf8'));
  assert.deepEqual(config.rewrites,[{source:'/auth/:path*',destination:'/api/auth-proxy?path=:path*'}]);
  const client=readFileSync(new URL('../mobile/core/cloud-client.mjs',import.meta.url),'utf8');
  assert.match(client,/location\.origin\+'\/auth'/);
  const proxy=readFileSync(new URL('../mobile/api/auth-proxy.mjs',import.meta.url),'utf8');
  assert.match(proxy,/handleAuthProxyRequest/);
  assert.match(proxy,/NEON_AUTH_COOKIE_SECRET/);
  assert.match(proxy,/sameSite:'lax'/);
  assert.match(proxy,/64\*1024/);
  assert.match(proxy,/['"]Cache-Control['"]:/);
  assert.doesNotMatch(client,/pNJzHOyUkhbx/);
  assert.doesNotMatch(proxy,/pNJzHOyUkhbx/);
});

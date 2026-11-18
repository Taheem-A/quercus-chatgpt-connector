import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveClient} from '../mobile/core/drive-api.mjs';

const bearer='test-token-for-drive-browser-mock';
const folder='F'.repeat(25);
const ok=data=>new Response(JSON.stringify(data),{
  status:200,headers:{'content-type':'application/json'}
});

test('default Drive fetch preserves the Window receiver required by Safari',async()=>{
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=function(url,options){
    assert.strictEqual(this,globalThis,'native fetch must be invoked with the browser Window receiver');
    calls.push({url,options});
    return Promise.resolve(ok({user:{emailAddress:'test@example.com'}}));
  };
  try{
    const client=new DriveClient(()=>bearer); // No injected fetch: production default.
    const result=await client.about();
    assert.equal(result.user.emailAddress,'test@example.com');
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/\/drive\/v3\/about\?/);
    assert.equal(calls[0].options.headers.Authorization,'Bearer '+bearer);
    assert.equal(calls[0].options.redirect,'error');
    assert.equal(calls[0].options.credentials,'omit');
  }finally{
    globalThis.fetch=original;
  }
});

test('default Drive fetch works for folder metadata as well as account validation',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=function(url,options){
    assert.strictEqual(this,globalThis,'global fetch receiver must not be DriveClient');
    assert.equal(options.method,'GET');
    return Promise.resolve(ok({id:folder,name:'Fall 2026',
      mimeType:'application/vnd.google-apps.folder'}));
  };
  try{
    const client=new DriveClient(()=>bearer);
    assert.equal((await client.getFile(folder)).name,'Fall 2026');
  }finally{
    globalThis.fetch=original;
  }
});

test('network failure reports the request stage without exposing credentials or claiming the internet is down',async()=>{
  const client=new DriveClient(()=>bearer,async()=>{
    throw new TypeError('Load failed');
  });
  await assert.rejects(client.about(),error=>{
    assert.match(error.message,/browser request failed before a response/);
    assert.match(error.message,/CORS restriction, blocked redirect, or network problem/);
    assert.doesNotMatch(error.message,/test-token-for-drive-browser-mock/);
    return true;
  });
});

test('native receiver exceptions have a distinct compatibility message',async()=>{
  const client=new DriveClient(()=>bearer,async()=>{
    throw new TypeError('Can only call Window.fetch on instances of Window');
  });
  await assert.rejects(client.about(),/browser API compatibility error/);
});

test('Google HTTP errors remain accurate and no private response bodies are reflected',async()=>{
  const client=new DriveClient(()=>bearer,async()=>{
    return new Response('confidential provider response token abc',{status:403});
  });
  await assert.rejects(client.getFile(folder),error=>
    error.message.includes('denied access')&&!error.message.includes('confidential'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveClient,DRIVE_SCOPES} from '../mobile/core/drive-api.mjs';
import {DriveAuthorization,validGoogleClientId} from '../mobile/core/drive-auth.mjs';

const token='test-access-token-that-is-not-a-real-credential';
const root='R'.repeat(25), child='F'.repeat(25), file='X'.repeat(25);
const okJson=(data,headers={})=>new Response(JSON.stringify(data),{
  status:200,headers:{'content-type':'application/json',...headers}
});
test('Google authorization uses ephemeral token model with both narrowly chosen scopes',async()=>{
  assert(DRIVE_SCOPES.includes('drive.metadata.readonly'));
  assert(DRIVE_SCOPES.includes('drive.file'));
  assert(!DRIVE_SCOPES.includes('/auth/drive '),'full-scope Drive write is not requested');
  assert.equal(validGoogleClientId('123456789012-abcdefghijklmnopqrstuvwx.apps.googleusercontent.com'),true);
  assert.equal(validGoogleClientId('not-a-valid-client-id'),false);
  let requested=0,revoked=null,settings;
  const fake={accounts:{oauth2:{
    initTokenClient(opts){settings=opts;return {requestAccessToken(){
      requested++;opts.callback({
        access_token:token,
        expires_in:3600,
        scope:DRIVE_SCOPES
      });
    }};},
    revoke(t,done){revoked=t;done();}
  }}};
  const auth=new DriveAuthorization(()=>fake);
  assert.equal(auth.isConnected(),false);
  await auth.connect('123456789012-abcdefghijklmnopqrstuvwx.apps.googleusercontent.com');
  assert.equal(requested,1);
  assert.equal(settings.scope,DRIVE_SCOPES);
  assert.equal(auth.token(),token);
  auth.disconnect();
  assert.equal(auth.isConnected(),false);
  assert.equal(revoked,token);
});
test('Drive client never sends a request outside Google APIs or without consent',async()=>{
  const calls=[];
  const client=new DriveClient(()=>token,async (url,options)=>{
    calls.push({url,options});return okJson({id:root,name:'Fall 2026',
      mimeType:'application/vnd.google-apps.folder'});
  });
  await client.getFile(root);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.redirect,'error');
  await assert.rejects(client.request('GET','https://evil.example/steal'),/invalid target/);
  await assert.rejects(new DriveClient(()=>null).getFile(root),/Connect Google Drive/);
});
test('existing Drive tree is discovered read-only with strict pagination and folder-depth limits',async()=>{
  let next=0;
  const client=new DriveClient(()=>token,async (url,opts)=>{
    const u=new URL(url);
    assert.equal(opts.method,'GET');
    if(u.pathname.endsWith('/files/'+root))
      return okJson({id:root,name:'Fall 2026',mimeType:'application/vnd.google-apps.folder'});
    if(u.searchParams.get('q')?.includes("'"+root+"'")){
      next++;
      if(!u.searchParams.has('pageToken')){
        return okJson({files:[{id:child,name:'MAT188',mimeType:'application/vnd.google-apps.folder',
          parents:[root]}],nextPageToken:'PAGE2'});
      }
      assert.equal(u.searchParams.get('pageToken'),'PAGE2');
      return okJson({files:[{id:file,name:'Lecture.pdf',mimeType:'application/pdf',parents:[root]}]});
    }
    return okJson({files:[{id:'T'.repeat(25),name:'Tutorials',mimeType:'application/vnd.google-apps.folder',parents:[child]}]});
  });
  const nodes=await client.crawlTree(root,{maxDepth:1});
  assert.equal(nodes.length,4);
  assert.equal(next,2);
  assert.deepEqual(nodes.filter(x=>x.mimeType==='application/pdf').map(x=>x.id),[file]);
});
test('Google upload only creates new files with a safe resumable session and no mutation endpoints',async()=>{
  const calls=[];
  const client=new DriveClient(()=>token,async (url,opts)=>{
    calls.push({url,opts});
    if(opts.method==='POST'){
      const metadata=JSON.parse(opts.body);
      assert.deepEqual(metadata.parents,[child]);
      assert.equal(metadata.name,'Lecture 01.pdf');
      assert.equal(metadata.appProperties.quercusPocketFileId,'501');
      return new Response('',{status:200,headers:{
        'location':'https://www.googleapis.com/upload/drive/v3/files?upload_id=session123'
      }});
    }
    if(opts.method==='PUT'){
      assert(opts.body instanceof Blob);
      assert.equal(await opts.body.text(),'hello');
      return okJson({id:file,name:'Lecture 01.pdf',webViewLink:'https://drive.google.com/file/d/id'});
    }
    throw Error('Only create endpoints expected');
  });
  const result=await client.uploadNew({
    folderId:child,name:'Lecture 01.pdf',mimeType:'application/pdf',
    bytes:new TextEncoder().encode('hello'),
    appProperties:{quercusPocketFileId:'501'}
  });
  assert.equal(result.id,file);
  assert.deepEqual(calls.map(x=>x.opts.method),['POST','PUT']);
  await assert.rejects(client.uploadNew({
    folderId:child,name:'../malicious.pdf',bytes:new Uint8Array([1])
  }),/Invalid file/);
});
test('malformed or cross-site resumable upload location is rejected before binary transfer',async()=>{
  let calls=0;
  const client=new DriveClient(()=>token,async (url,opts)=>{
    calls++;
    return new Response('',{status:200,headers:{
      location:'https://evil.example/exfiltrate'
    }});
  });
  await assert.rejects(client.uploadNew({
    folderId:child,name:'notes.pdf',mimeType:'application/pdf',bytes:new Uint8Array([1])
  }),/Unsafe Google Drive upload session/);
  assert.equal(calls,1);
});
test('Google API errors do not reflect response bodies containing private data',async()=>{
  const client=new DriveClient(()=>token,async()=>new Response(
    '{"error":"sensitive private bearer token"}',{status:403}
  ));
  await assert.rejects(client.getFile(root),e=>
    e.message.includes('denied access')&&!e.message.includes('sensitive'));
});

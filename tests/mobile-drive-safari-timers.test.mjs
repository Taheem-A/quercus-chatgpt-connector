import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveAuthorization} from '../mobile/core/drive-auth.mjs';
import {DRIVE_SCOPES} from '../mobile/core/drive-api.mjs';

const clientId='123456789012-abcdefghijklmnopqrstuvwx.apps.googleusercontent.com';
const validToken='a'.repeat(60);

test('default OAuth timer delegates to Window-bound setTimeout and clearTimeout, as required by Safari',async()=>{
  const originalSchedule=globalThis.setTimeout;
  const originalCancel=globalThis.clearTimeout;
  let scheduled=null,cleared=null,scheduledDelay=null;
  // Mimic Safari receiver-sensitive timers: detached functions fail.
  globalThis.setTimeout=function(callback,delay){
    assert.strictEqual(this,globalThis,'setTimeout needs its Window receiver');
    scheduled=callback;scheduledDelay=delay;
    return 73;
  };
  globalThis.clearTimeout=function(id){
    assert.strictEqual(this,globalThis,'clearTimeout needs its Window receiver');
    cleared=id;
  };
  try{
    const fakeGoogle={accounts:{oauth2:{
      initTokenClient(opts){return {
        requestAccessToken(){
          opts.callback({
            access_token:validToken,scope:DRIVE_SCOPES,expires_in:3600
          });
        }
      };}
    }}};
    const auth=new DriveAuthorization(()=>fakeGoogle);
    assert.equal(await auth.connect(clientId),true);
    assert.equal(auth.token(),validToken);
    assert.equal(scheduledDelay,90000);
    assert.equal(typeof scheduled,'function');
    assert.equal(cleared,73);
  }finally{
    globalThis.setTimeout=originalSchedule;
    globalThis.clearTimeout=originalCancel;
  }
});

test('default OAuth timeout also invokes Window methods with valid receiver',async()=>{
  const originalSchedule=globalThis.setTimeout;
  const originalCancel=globalThis.clearTimeout;
  let invokeTimeout,clearCount=0;
  globalThis.setTimeout=function(callback){
    assert.strictEqual(this,globalThis);
    invokeTimeout=callback;
    return 74;
  };
  globalThis.clearTimeout=function(id){
    assert.strictEqual(this,globalThis);
    assert.equal(id,74);
    clearCount++;
  };
  try{
    const fakeGoogle={accounts:{oauth2:{
      initTokenClient(){return {requestAccessToken(){}};}
    }}};
    const auth=new DriveAuthorization(()=>fakeGoogle);
    const pending=auth.connect(clientId);
    assert.equal(typeof invokeTimeout,'function');
    invokeTimeout();
    await assert.rejects(pending,/Google did not return an authorization result/);
    assert.equal(clearCount,1);
    assert.equal(auth.isConnected(),false);
  }finally{
    globalThis.setTimeout=originalSchedule;
    globalThis.clearTimeout=originalCancel;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseExportArgs,runLocalExport} from '../scripts/export-archives.mjs';

const snapshot=()=>({
  meta:{completedAt:'2026-11-18T17:00:00Z'},
  courses:[{id:101,course_code:'MAT188'}],
  courseData:{101:{files:[{id:501,display_name:'Booklet.pdf',size:5}],
    folders:[],pages:[],pageDetails:{},assignments:[]}},
  global:{},
  diagnostics:[],
  derived:{assignments:[],counts:{}}
});

test('CLI requires explicit ZIP destination and a known archive mode',()=>{
  assert.throws(()=>parseExportArgs([]),/--out/);
  assert.throws(()=>parseExportArgs(['--out','report.txt']),/zip/);
  assert.throws(()=>parseExportArgs(['--out','archive.zip','--mode','unknown']),/mode/);
  assert.throws(()=>parseExportArgs(['--out','archive.zip','--max-mb','999']),/between 1 and 240/);
  const x=parseExportArgs(['--out','archive.zip','--mode','attachments-only']);
  assert.equal(x.mode,'attachments-only');
  assert.equal(path.basename(x.output),'archive.zip');
});
test('metadata ZIP can be written without a Canvas token, never overwrites an existing archive',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quercus-zip-cli-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const output=path.join(dir,'saved.zip');
  const opts=parseExportArgs(['--out',output,'--mode','full-without-attachments']);
  const cfg={readFile:async()=>JSON.stringify(snapshot()),
    settingsProvider:async()=>{throw Error('must not request a token');}};
  const result=await runLocalExport(opts,cfg);
  assert.equal(result.manifest.mode,'full-without-attachments');
  assert.equal(result.manifest.attachmentCount,1);
  const file=await fs.readFile(output);
  assert.equal(file[0],0x50);
  assert.equal(file[1],0x4b);
  await assert.rejects(()=>runLocalExport(opts,cfg),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(output),file,'existing archive remains intact');
});
test('laptop binary path uses existing authenticated Canvas client, not unauthenticated browser CORS',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quercus-zip-cli-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let downloads=0;
  const opts=parseExportArgs(['--out',path.join(dir,'files.zip'),'--mode','attachments-only']);
  const result=await runLocalExport(opts,{
    readFile:async()=>JSON.stringify(snapshot()),
    settingsProvider:async()=>({configured:true,baseUrl:'https://q.utoronto.ca',token:'private'}),
    canvasFactory:()=>({
      async getOne(api){return {data:{id:501,url:'https://q.utoronto.ca/files/501/download'}};},
      async downloadFile(id){
        assert.equal(id,'501');
        downloads++;
        return {response:new Response('hello',{status:200,
          headers:{'content-type':'application/pdf'}})};
      }
    }),
    onProgress:()=>{}
  });
  assert.equal(result.manifest.downloaded,1);
  assert.equal(result.manifest.failed,0);
  assert.equal(downloads,1);
  assert(result.bytes>50);
});

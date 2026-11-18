import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeArchiveSegment,fileIdsInHtml,discoverAttachments
} from '../mobile/core/attachment-inventory.mjs';
import {
  makeSnapshotArchive,makeAttachmentArchive,readBoundedResponse
} from '../mobile/core/attachment-export.mjs';

const sample=()=>({
  meta:{completedAt:'2026-11-18T17:00:00.000Z',app:'Quercus Pocket'},
  user:{profile:{id:22}},
  courses:[{id:101,course_code:'MAT188',name:'Linear Algebra'},
    {id:102,course_code:'APS111',name:'Engineering Strategies'}],
  global:{
    userFiles:[{id:503,display_name:'Personal Notes.txt',size:5}],
    announcements:[]
  },
  courseData:{
    101:{
      files:[
        {id:501,display_name:'Booklet 7.pdf',folder_id:601,size:5,
          'content-type':'application/pdf'},
        {id:502,display_name:'Booklet 7.pdf',folder_id:601,size:7},
      ],
      folders:[{id:601,name:'Practice Booklets',parent_folder_id:600},
        {id:600,name:'04 Practice',parent_folder_id:null}],
      pages:[{url:'week7',title:'Week 7'}],
      pageDetails:{week7:{body:'<p><a href="/courses/101/files/502/download">File</a><img src="/files/504/preview"></p>'}},
      assignments:[{id:900,description:'<a data-api-endpoint="/api/v1/files/501" href="#">Booklet</a>',
        submission:{attachments:[{id:501}]}}],
      submissions:[],
      announcements:[{id:17,message:'<a href="https://q.utoronto.ca/courses/101/files/504/download">Exam</a>'}],
      discussions:[]
    },
    102:{
      files:[{id:501,display_name:'Duplicate file.pdf',size:5}],
      folders:[],pages:[],pageDetails:{},assignments:[],submissions:[],announcements:[],discussions:[]
    }
  },
  diagnostics:[{ok:true}]
});

test('sanitizes archive paths against traversal, Windows reserved names and separator injection',()=>{
  assert.equal(safeArchiveSegment('../secret'),'.._secret');
  assert.equal(safeArchiveSegment('CON'),'_CON');
  assert.equal(safeArchiveSegment('foo\\bar'),'foo_bar');
  assert.equal(safeArchiveSegment(' ..  '),'unnamed');
  assert.equal(safeArchiveSegment('e.g. pdf'),'e.g. pdf');
  assert(safeArchiveSegment('a'.repeat(200)).length<=100);
});
test('inventory includes actual course files, linked and embedded files and user files, deduped by immutable Canvas ID',()=>{
  const s=sample();
  assert.deepEqual(fileIdsInHtml('<a href="/courses/101/files/501/download">one</a><img src="/api/v1/files/504/preview">'),
    ['501','504']);
  assert.deepEqual(fileIdsInHtml('https://evil.example.com/files/666'),[]);
  const inventory=discoverAttachments(s);
  assert.equal(inventory.length,4);
  const file=inventory.find(x=>x.fileId==='501');
  assert.match(file.relativePath,/MAT188\/04 Practice\/Practice Booklets\/Booklet 7 \[Canvas-501\]\.pdf$/);
  assert(file.sources.some(x=>x.courseId==='102'),'deduplicated metadata tracks additional courses');
  assert(file.sources.some(x=>x.source==='assignment:900'));
  const linked=inventory.find(x=>x.fileId==='504');
  assert.equal(linked.metadata,null);
  assert.equal(linked.relativePath,'attachments/MAT188/file-504 [Canvas-504]');
  assert(inventory.some(x=>x.fileId==='503'&&x.courseId==='personal'));
});
test('full metadata archive preserves raw snapshot, every category table and a manifest of all linked files',()=>{
  const a=makeSnapshotArchive(sample());
  assert.match(a.name,/full-no-attachments/);
  assert.equal(a.manifest.mode,'full-without-attachments');
  assert.equal(a.manifest.attachmentCount,4);
  assert(a.manifest.files.every(x=>x.status==='not-requested'));
  assert.equal(a.data[0],0x50);
  assert.equal(a.data[1],0x4b);
});
test('binary export includes actual file bytes with checksums and never writes signed URLs into manifest',async()=>{
  const seen=[];
  const archive=await makeAttachmentArchive(sample(),{
    mode:'attachments-only',
    client:{async getOne(path){
      const id=/(\d+)$/.exec(path)?.[1];
      return {data:{id:Number(id),url:'https://q.utoronto.ca/download/'+id+'?signature=SECRET-URL'}};
    }},
    download:async (url,options)=>{
      seen.push({url,options});
      return new Response(new TextEncoder().encode('hello'),{
        status:200,headers:{'content-type':'application/pdf','content-length':'5'}
      });
    }
  });
  assert.equal(archive.manifest.attachmentCount,4);
  assert.equal(archive.manifest.downloaded,4);
  assert.equal(archive.manifest.failed,0);
  assert(archive.manifest.files.every(f=>f.status==='downloaded'&&f.sizeDownloaded===5));
  assert.doesNotMatch(JSON.stringify(archive.manifest),/SECRET-URL/);
  assert.equal(archive.manifest.files[0].sha256,
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert(seen.every(x=>x.options.credentials==='omit'&&x.options.mode==='cors'));
  assert.equal(archive.data[0],0x50);
  assert.equal(archive.data[1],0x4b);
});
test('failed signed downloads never masquerade as complete; report CORS/size failures without raw URL values',async()=>{
  let calls=0;
  const result=await makeAttachmentArchive(sample(),{
    mode:'full-with-attachments',
    maxFileBytes:6,
    client:{async getOne(path){
      const id=/(\d+)$/.exec(path)?.[1];
      return {data:{id:Number(id),url:'https://q.utoronto.ca/'+id+'?private=1234'}};
    }},
    download:async()=>{
      calls++;
      throw new TypeError('Network error with sensitive signed URL https://x/token=SECRET');
    },
  });
  assert(result.manifest.files.some(f=>f.reason==='file-exceeds-export-limit'));
  assert(result.manifest.files.some(f=>f.reason==='browser-network-or-cors-error'));
  assert(result.manifest.failed>0);
  assert.equal(result.manifest.isComplete,false);
  assert.doesNotMatch(JSON.stringify(result.manifest),/SECRET|private=1234/);
  assert(calls>0);
});
test('bounded downloader refuses HTML login pages and overlong byte streams',async()=>{
  await assert.rejects(readBoundedResponse(
    new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}})
  ),/not a binary/);
  await assert.rejects(readBoundedResponse(
    new Response('0123456789',{headers:{'content-length':'10'}}),5
  ),/size limit/);
  await assert.rejects(readBoundedResponse(
    new Response('0123456789',{headers:{'content-length':'1'}}),5
  ),/size limit/);
});
test('invalid modes, wrong clients and incomplete snapshots fail safely',async()=>{
  await assert.rejects(makeAttachmentArchive(sample(),{mode:'random',client:{}}),/mode/);
  await assert.rejects(makeAttachmentArchive(sample(),{mode:'attachments-only'}),/token/);
  assert.throws(()=>discoverAttachments({courses:[],courseData:null}),/complete/);
});

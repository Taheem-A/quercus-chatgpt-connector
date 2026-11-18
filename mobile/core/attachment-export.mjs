import { createZip } from './zip.mjs';
import { exportFiles, filenameStamp } from './export.mjs';
import { discoverAttachments } from './attachment-inventory.mjs';

// All binary downloads run in the authenticated user's browser, never through
// the Vercel JSON relay. CORS can prevent binary access even if an iframe or
// direct link displays correctly. The manifest explicitly reports failures.
export const MAX_FILE_BYTES=32*1024*1024;
export const MAX_ARCHIVE_BYTES=180*1024*1024;
const mimeZip='application/zip';

const errorText=e=>{
  if(e?.message==='File exceeds browser archive size limit.')return 'file-exceeds-export-limit';
  if(e?.message==='Archive budget exceeded.')return 'archive-budget-exhausted';
  if(e?.message==='File response is not a binary download.')return 'unexpected-download-response';
  if(e?.message==='Canvas file access refused.')return 'canvas-file-access-refused';
  // Do not leak presigned URL tokens, cookie values, or fetched response text.
  return 'browser-network-or-cors-error';
};
export async function readBoundedResponse(response,maxBytes=MAX_FILE_BYTES){
  if(!response?.ok)throw Error('Canvas file access refused.');
  if(response.type==='opaque')throw Error('Canvas file access refused.');
  const mime=response.headers.get('content-type')||'';
  if(/text\/html/i.test(mime))throw Error('File response is not a binary download.');
  const length=Number(response.headers.get('content-length')||0);
  if(length>maxBytes)throw Error('File exceeds browser archive size limit.');
  if(!response.body)throw Error('File response is not a binary download.');
  const reader=response.body.getReader();
  const chunks=[];let lengthRead=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      lengthRead+=value.byteLength;
      if(lengthRead>maxBytes)throw Error('File exceeds browser archive size limit.');
      chunks.push(value);
    }
  }catch(error){
    await reader.cancel().catch(()=>{});
    throw error;
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(lengthRead);
  let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  return bytes;
}
const validUrl=link=>{
  let parsed;try{parsed=new URL(link);}catch{return null;}
  // Refuse http, data, file, javascript, and embedded URL credentials.
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)return null;
  return parsed.href;
};
const hashBytes=async bytes=>{
  if(!globalThis.crypto?.subtle)return null;
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
const buildManifest=(snapshot,mode,inventory)=>({
  format:'quercus-pocket-archive',schemaVersion:1,mode,
  generatedAt:new Date().toISOString(),
  sourceSyncedAt:snapshot.meta?.completedAt||snapshot.meta?.startedAt||null,
  sourceApp:snapshot.meta?.app||null,
  isComplete:false,
  notes:[
    'This archive includes only records available to the syncing Quercus account; unavailable or failed API endpoints remain in snapshot diagnostics.',
    'Binary file downloads depend on Quercus permissions and browser CORS. Every skipped attachment is listed below.',
    "Archive folder destinations are provisional Canvas course/folder groupings, not a user's configured Google Drive filing rules.",
  ],
  attachmentCount:inventory.length,
  files:[],
  diagnostics:(snapshot.diagnostics||[]).filter(x=>!x.ok).map(x=>({
    scope:x.scope||null,name:x.name||null,status:x.status||null,
  })),
});
export function makeSnapshotArchive(snapshot){
  const inventory=discoverAttachments(snapshot);
  const manifest=buildManifest(snapshot,'full-without-attachments',inventory);
  manifest.isComplete=manifest.diagnostics.length===0;
  manifest.files=inventory.map(entry=>({
    fileId:entry.fileId,courseId:entry.courseId,path:entry.relativePath,
    displayName:entry.displayName,sources:entry.sources,size:entry.size,
    status:'not-requested',
  }));
  return {
    name:'quercus-full-no-attachments-'+filenameStamp(snapshot)+'.zip',
    type:mimeZip,
    data:createZip([
      ...exportFiles(snapshot),
      {name:'manifest.json',data:JSON.stringify(manifest,null,2)+'\n'},
    ]),
    manifest,
  };
}
export async function makeAttachmentArchive(snapshot,{
  mode,client,download=fetch,onProgress=()=>{},signal,maxFileBytes=MAX_FILE_BYTES,
  maxArchiveBytes=MAX_ARCHIVE_BYTES,
}={}){
  if(!['full-with-attachments','attachments-only'].includes(mode))
    throw Error('Unknown binary export mode.');
  if(!client?.getOne)throw Error('A connected Quercus token is required to download file bytes.');
  if(!Number.isSafeInteger(maxFileBytes)||maxFileBytes<1||
     !Number.isSafeInteger(maxArchiveBytes)||maxArchiveBytes<1)
    throw Error('Invalid export size limits.');
  const inventory=discoverAttachments(snapshot);
  const manifest=buildManifest(snapshot,mode,inventory);
  const base=mode==='full-with-attachments'?exportFiles(snapshot):[];
  const entries=[...base];
  // ZIP writer copies each byte into a final buffer; keep conservative limits
  // to avoid crashing Safari. Desktop bulk exports use the local downloader.
  const overhead=base.reduce((n,e)=>n+new TextEncoder().encode(e.name).length+
    (typeof e.data==='string'?new TextEncoder().encode(e.data).length:e.data.byteLength)+100,0);
  let total=overhead+128*1024;
  if(total>maxArchiveBytes)
    throw Error('Snapshot alone exceeds the browser archive budget. Use the JSON export or the desktop downloader.');
  for(let i=0;i<inventory.length;i++){
    if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');
    const file=inventory[i];
    const record={
      fileId:file.fileId,courseId:file.courseId,courseCode:file.courseCode,
      displayName:file.displayName,archivePath:file.relativePath,
      sources:file.sources,sizeExpected:file.size,
      mimeType:file.mimeType,status:'pending',
    };
    manifest.files.push(record);
    onProgress({current:i+1,total:inventory.length,name:file.displayName,
      status:'checking'});
    if(file.size!==null && file.size>maxFileBytes){
      record.status='skipped';record.reason='file-exceeds-export-limit';continue;
    }
    if(total>=maxArchiveBytes-1024){
      record.status='skipped';record.reason='archive-budget-exhausted';continue;
    }
    try{
      const response=await client.getOne('/api/v1/files/'+file.fileId);
      const metadata=response?.data;
      if(!metadata || String(metadata.id)!==file.fileId)
        throw Error('Canvas file access refused.');
      const url=validUrl(metadata.url);
      if(!url)throw Error('Canvas file access refused.');
      const result=await download(url,{
        method:'GET',mode:'cors',credentials:'omit',redirect:'follow',
        cache:'no-store',signal,
      });
      const bytes=await readBoundedResponse(result,
        Math.min(maxFileBytes,maxArchiveBytes-total-1024));
      if(total+bytes.length+128>=maxArchiveBytes)
        throw Error('Archive budget exceeded.');
      entries.push({name:file.relativePath,data:bytes});
      total+=bytes.length+new TextEncoder().encode(file.relativePath).length+100;
      record.status='downloaded';
      record.sizeDownloaded=bytes.length;
      record.sha256=await hashBytes(bytes);
    }catch(error){
      if(signal?.aborted)throw error;
      record.status='failed';
      record.reason=errorText(error);
    }
    onProgress({current:i+1,total:inventory.length,name:file.displayName,
      status:record.status});
  }
  manifest.downloaded=manifest.files.filter(f=>f.status==='downloaded').length;
  manifest.failed=manifest.files.filter(f=>f.status!=='downloaded').length;
  manifest.isComplete=manifest.failed===0 && manifest.diagnostics.length===0;
  entries.push({name:'manifest.json',data:JSON.stringify(manifest,null,2)+'\n'});
  return {
    name:'quercus-'+(mode==='attachments-only'?'organized-attachments':'full-with-attachments')+
      '-'+filenameStamp(snapshot)+'.zip',
    type:mimeZip,
    data:createZip(entries),
    manifest,
  };
}

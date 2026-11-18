// Run from repository root. Browser signed URLs can fail CORS; this local
// downloader uses the existing authenticated CanvasClient without a public
// binary proxy. Only writes one new ZIP to the explicit --out path.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CanvasClient} from '../lib/canvas.mjs';
import {loadSettings} from '../lib/config.mjs';
import {makeAttachmentArchive,makeSnapshotArchive} from '../mobile/core/attachment-export.mjs';

export function parseExportArgs(argv){
  const options={mode:'full-with-attachments',maxArchiveBytes:180*1024*1024};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(!['--out','--mode','--max-mb','--snapshot'].includes(flag))
      throw Error('Unknown option: '+flag);
    const value=argv[++i];
    if(!value||value.startsWith('--'))throw Error('Missing value for '+flag);
    if(flag==='--out')options.output=path.resolve(value);
    if(flag==='--mode')options.mode=value;
    if(flag==='--snapshot')options.snapshotPath=path.resolve(value);
    if(flag==='--max-mb')options.maxArchiveBytes=Math.floor(Number(value)*1024*1024);
  }
  if(!options.output||path.extname(options.output).toLowerCase()!=='.zip')
    throw Error('Pass --out "C:\\path\\archive.zip".');
  if(!['full-with-attachments','full-without-attachments','attachments-only']
    .includes(options.mode))throw Error('Invalid export mode.');
  if(!Number.isSafeInteger(options.maxArchiveBytes)||
      options.maxArchiveBytes<1024*1024||options.maxArchiveBytes>240*1024*1024)
    throw Error('Choose --max-mb between 1 and 240.');
  return options;
}
export async function runLocalExport(options,{
  readFile=fs.readFile,writeFile=fs.writeFile,mkdir=fs.mkdir,
  remove=fs.rm,settingsProvider=loadSettings,canvasFactory=opts=>new CanvasClient(opts),
  onProgress=evt=>process.stdout.write('Export '+evt.current+'/'+evt.total+
    ': '+evt.status+' '+evt.name+'\n'),
}={}){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const snapshotPath=options.snapshotPath||path.join(root,'data','snapshot.json');
  const snapshot=JSON.parse(await readFile(snapshotPath,'utf8'));
  if(!Array.isArray(snapshot.courses)||!snapshot.courseData)
    throw Error('Invalid Quercus snapshot.');
  let archive;
  if(options.mode==='full-without-attachments'){
    archive=makeSnapshotArchive(snapshot);
  }else{
    const settings=await settingsProvider(root);
    if(!settings.configured)throw Error('Configure a local Quercus token before downloading attachments.');
    const client=canvasFactory(settings);
    const urls=new Map();
    archive=await makeAttachmentArchive(snapshot,{
      mode:options.mode,maxArchiveBytes:options.maxArchiveBytes,
      client:{
        async getOne(apiPath){
          const result=await client.getOne(apiPath);
          const data=result.data;
          if(data?.url)urls.set(data.url,String(data.id));
          return result;
        }
      },
      async download(url){
        const fileId=urls.get(url);
        if(!fileId)throw Error('File source is not authorized.');
        const {response}=await client.downloadFile(fileId);
        return response;
      },
      onProgress,
    });
  }
  await mkdir(path.dirname(options.output),{recursive:true});
  try{
    await writeFile(options.output,archive.data,{flag:'wx'});
  }catch(error){
    if(error.code!=='EEXIST')await remove(options.output,{force:true}).catch(()=>{});
    throw error;
  }
  return {path:options.output,
    bytes:archive.data.byteLength,
    manifest:archive.manifest,
  };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const options=parseExportArgs(process.argv.slice(2));
    const report=await runLocalExport(options);
    console.log(JSON.stringify({
      path:report.path,bytes:report.bytes,
      complete:report.manifest.isComplete,
      detected:report.manifest.attachmentCount,
      downloaded:report.manifest.downloaded||0,
      failed:report.manifest.failed||0,
    },null,2));
    if(!report.manifest.isComplete)process.exitCode=2;
  }catch(error){
    console.error(String(error?.message||error));
    process.exitCode=1;
  }
}

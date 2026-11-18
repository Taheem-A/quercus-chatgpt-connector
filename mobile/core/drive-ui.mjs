import {DriveAuthorization,validGoogleClientId} from './drive-auth.mjs';
import {DriveClient} from './drive-api.mjs';
import {makeDriveTree,parseDriveFolderId,planDriveUploads} from './drive-plan.mjs';
import {makeSnapshotArchive} from './attachment-export.mjs';
import {BrowserCanvasClient} from './canvas.mjs';

const $=id=>document.getElementById(id);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const scopedKey=id=>'quercus-pocket-drive-v1:'+(id||'guest');
const trim=s=>String(s||'').trim();
const maxBytes=50*1024*1024;
const allowedName=name=>typeof name==='string'&&!/[/\\\x00-\x1f]/.test(name)&&name.length>0&&name.length<=200;
function loadLocal(id){
  try{
    const x=JSON.parse(localStorage.getItem(scopedKey(id))||'null');
    if(x && x.version===1)return {
      version:1,clientId:typeof x.clientId==='string'?x.clientId:'',
      rootId:typeof x.rootId==='string'?x.rootId:'',
      courseMappings:x.courseMappings&&typeof x.courseMappings==='object'?x.courseMappings:{},
      fileOverrides:x.fileOverrides&&typeof x.fileOverrides==='object'?x.fileOverrides:{},
    };
  }catch{}
  return {version:1,clientId:'',rootId:'',courseMappings:{},fileOverrides:{}};
}
export function setupDrive({getSnapshot,getCanvasToken,getUserId}){
  const auth=new DriveAuthorization();
  let subject=null,config=null,client=null,tree=null,plan=null,about=null,busy=false;
  let filter='review',selected=new Set(),cancel=null,lastUploaded=null;
  const dialog=$('driveDialog'),status=$('driveStatus');
  const update=text=>{if(status)status.textContent=text;};
  const save=()=>{
    try{localStorage.setItem(scopedKey(subject),JSON.stringify(config));return true;}
    catch{update('Browser storage is unavailable. Folder preferences will not survive reloading.');return false;}
  };
  const load=()=>{
    const current=getUserId?.()||'guest';
    if(subject!==current){
      auth.disconnect();client=null;tree=null;plan=null;about=null;selected.clear();
      subject=current;config=loadLocal(current);
    }
  };
  const connected=()=>Boolean(client&&auth.isConnected());
  const folderOptions=(list,current,blank)=>'<option value="">'+safe(blank)+'</option>'+
    list.map(f=>'<option value="'+safe(f.id)+'"'+(f.id===current?' selected':'')+'>'+
      safe(tree.label(f.id))+'</option>').join('');
  function drawConfig(){
    load();
    $('driveClientId').value=config.clientId;
    $('driveRootId').value=config.rootId;
    $('driveIdentity').textContent=connected()
      ?'Connected to '+(about?.user?.emailAddress||'a Google Drive account')+
        ' for this browser session. No OAuth token is stored.'
      :'Not connected to Google Drive. Connect with Google to scan and upload.';
    $('driveConnect').disabled=busy;
    $('driveScan').disabled=busy||!connected();
    $('driveConfirmAccount').disabled=!connected();
    $('driveUploadSelected').disabled=busy||!connected()||!tree;
    $('driveUploadContext').disabled=busy||!connected()||!tree;
    $('driveCancel').hidden=!busy;
    $('driveAccountInfo').textContent=connected()
      ?'Verify that '+(about?.user?.emailAddress||'this account')+' is the personal Drive you intended before uploading.'
      :'Google OAuth requires one public Web client ID and access to Drive metadata. Write operations create new files only.';
  }
  function drawMap(){
    if(!tree||!getSnapshot()){
      $('driveFolderMap').innerHTML='<p class="hint">Scan your existing semester folder to map the course folders.</p>';
      $('driveFilePreview').innerHTML='';
      $('driveSummary').textContent='No Drive folder scanned.';
      return;
    }
    plan=planDriveUploads(getSnapshot(),tree,config);
    const immediate=tree.folders.filter(f=>f.parentId===tree.rootId);
    const cm=plan.courses;
    $('driveFolderMap').innerHTML=(getSnapshot().courses||[]).map(c=>{
      const id=String(c.id),mapping=cm[id],manual=config.courseMappings[id]||'';
      return '<label class="drive-map-row"><span><strong>'+safe(c.course_code||c.name||id)+
        '</strong><small>'+safe(mapping?.method==='course-code'?'Exact course-code match':
        mapping?.method==='manual'?'Your chosen folder':'Needs a course folder mapping')+'</small></span>'+
        '<select data-drive-course="'+safe(id)+'">'+
        folderOptions(immediate,manual,
          mapping?.method==='course-code'
            ?'Auto: '+mapping.label:'Choose course folder…')+
        '</select></label>';
    }).join('');
    const rows=plan.rows;
    $('driveSummary').textContent=rows.length+' detected attachments · '+plan.counts.ready+
      ' ready for review · '+plan.counts.review+' need decisions · '+
      plan.counts.existing+' already uploaded.';
    const candidates=filter==='ready'?rows.filter(x=>x.status==='ready'):
      filter==='all'?rows:filter==='existing'?rows.filter(x=>x.status==='already-uploaded'):
      rows.filter(x=>!['ready','already-uploaded'].includes(x.status));
    $('driveFilePreview').innerHTML=candidates.length
      ?candidates.slice(0,120).map(r=>{
        const choices=tree.folders.filter(f=>r.courseFolderId&&
          f.id!==r.courseFolderId&&tree.isDescendant(f.id,r.courseFolderId));
        const override=config.fileOverrides[r.fileId]||'';
        const canPick=r.status==='ready';
        return '<div class="drive-preview-row" data-file-id="'+safe(r.fileId)+'">'+
          '<div class="drive-file-heading">'+
          '<label><input type="checkbox" data-drive-select="'+safe(r.fileId)+'"'+
          (selected.has(r.fileId)&&canPick?' checked':'')+
          (!canPick||busy?' disabled':'')+'><strong>'+safe(r.displayName)+'</strong></label>'+
          '<span class="drive-file-status '+safe(r.status)+'">'+safe(r.status.replace(/-/g,' '))+'</span></div>'+
          '<p>'+safe(r.courseCode)+' · '+safe(r.sources.map(x=>x.source).slice(0,2).join(', '))+'</p>'+
          '<p><strong>Destination:</strong> '+safe(r.destination||'Review required')+'</p>'+
          (choices.length
            ?'<label class="drive-override">Change location <select data-drive-file-folder="'+safe(r.fileId)+'">'+
              folderOptions(choices,override,'Use deterministic suggestion / review')+
              '</select></label>':'')+
          '<a href="https://q.utoronto.ca/files/'+safe(r.fileId)+
          '" target="_blank" rel="noopener noreferrer">View original in Quercus</a></div>';
      }).join('')+
      (candidates.length>120?'<p class="hint">Displaying the first 120 matching files. Narrow the filter or map more courses.</p>':'')
      :'<p class="hint">No files in this filter.</p>';
    $('driveReviewFilter').value=filter;
    $('driveUploadSelected').textContent='Upload '+selected.size+' approved file'+(selected.size===1?'':'s');
  }
  function draw(){drawConfig();drawMap();}
  const ensureReady=()=>{
    if(!getSnapshot())throw Error('Sync or import a full Quercus snapshot first.');
    if(!connected())throw Error('Connect your Google Drive account first.');
    if(!$('driveConfirmAccount').checked)
      throw Error('Confirm the displayed Google account before any Drive upload.');
    if(!tree||!plan)throw Error('Scan the Drive semester folder first.');
  };
  async function handleUpload(){
    ensureReady();
    const candidates=plan.rows.filter(r=>r.status==='ready'&&selected.has(r.fileId));
    if(!candidates.length)throw Error('Select at least one ready file. Review items cannot be uploaded until mapped.');
    if(!getCanvasToken())throw Error('Connect your Quercus token on this device to download attachment bytes.');
    const confirmed=confirm('Create '+candidates.length+' new file'+(candidates.length===1?'':'s')+
      ' in the listed Google Drive folders? Existing files will NOT be changed or deleted. Failed downloads will be skipped.');
    if(!confirmed)return;
    cancel=new AbortController();busy=true;draw();
    let uploaded=0,skipped=0;const failures=[];
    const canvas=new BrowserCanvasClient(getCanvasToken());
    try{
      for(let i=0;i<candidates.length;i++){
        if(cancel.signal.aborted)break;
        const row=candidates[i];
        update('Checking '+(i+1)+'/'+candidates.length+': '+row.displayName);
        try{
          if(!allowedName(row.displayName))throw Error('Filename must be reviewed.');
          if(row.size!=null&&row.size>maxBytes)throw Error('File too large for web upload.');
          // Re-read the destination before EACH write; a file may have been
          // created since the dry run by another tab or device.
          const existing=await client.listChildren(row.folderId);
          if(existing.some(f=>f.name===row.displayName||
              f.appProperties?.quercusPocketFileId===row.fileId)){
            skipped++;failures.push(row.displayName+': already exists');continue;
          }
          const result=await canvas.getOne('/api/v1/files/'+row.fileId);
          if(String(result.data?.id)!==row.fileId||!result.data?.url)
            throw Error('Canvas did not authorize this file.');
          const url=new URL(result.data.url);
          if(url.protocol!=='https:'||url.username||url.password)
            throw Error('Invalid signed file download URL.');
          const response=await fetch(url.href,{
            method:'GET',mode:'cors',credentials:'omit',redirect:'follow',
            cache:'no-store',signal:cancel.signal
          });
          if(!response.ok)throw Error('Canvas download failed or was denied.');
          const mime=response.headers.get('content-type')||row.mimeType||'application/octet-stream';
          if(/text\/html/i.test(mime))throw Error('Canvas returned a login page, not a file.');
          const raw=await response.blob();
          if(raw.size>maxBytes)throw Error('File exceeds 50 MiB.');
          await client.uploadNew({
            folderId:row.folderId,name:row.displayName,mimeType:mime,bytes:raw,signal:cancel.signal,
            appProperties:{quercusPocketFileId:row.fileId,quercusPocketCourseId:row.courseId,
              quercusPocketSourceUpdatedAt:row.updatedAt||'unknown'}
          });
          uploaded++;selected.delete(row.fileId);
        }catch(error){
          if(cancel.signal.aborted)break;
          skipped++;failures.push(row.displayName+': '+String(error.message||error).slice(0,120));
        }
        update('Uploaded '+uploaded+' of '+candidates.length+' · '+skipped+' skipped or failed.');
      }
      const ended=cancel.signal.aborted;
      update((ended?'Stopped. ':'Finished. ')+uploaded+' new file'+(uploaded===1?'':'s')+
        ' added; '+skipped+' skipped/failed.'+
        (failures.length?' See details below.':''));
      $('driveUploadReport').textContent=failures.slice(0,80).join('\n');
    }finally{
      cancel=null;busy=false;
      // Refresh metadata so any app-created files are seen as uploaded.
      try{const items=await client.crawlTree(config.rootId,{onProgress:()=>{}});tree=makeDriveTree(config.rootId,items);}
      catch{update('Upload finished, but the Drive folder scan needs refreshing.');}
      selected.clear();draw();
    }
  }
  async function uploadContext(){
    ensureReady();
    const confirmed=confirm('Create one NEW Quercus Pocket Exports folder if necessary, then upload a full snapshot ZIP WITHOUT attachment bytes? Nothing else will be modified.');
    if(!confirmed)return;
    busy=true;draw();
    try{
      const archive=makeSnapshotArchive(getSnapshot());
      const siblings=await client.listChildren(config.rootId);
      let out=siblings.filter(f=>f.mimeType==='application/vnd.google-apps.folder'&&
        f.name==='Quercus Pocket Exports');
      if(out.length>1)throw Error('Several matching export folders exist. Review Drive before proceeding.');
      const folder=out[0]||await client.createFolder('Quercus Pocket Exports',config.rootId);
      update('Uploading '+archive.name+' …');
      const result=await client.uploadNew({
        folderId:folder.id,name:archive.name,mimeType:'application/zip',
        bytes:new Blob([archive.data],{type:'application/zip'}),
        appProperties:{quercusPocketExport:'full-without-attachments'}
      });
      lastUploaded=result;
      $('driveUploadReport').textContent='Created '+archive.name+' (Drive file ID '+result.id+').';
      update('ChatGPT-ready ZIP saved to Google Drive. Source Quercus snapshot remains unchanged.');
    }finally{busy=false;draw();}
  }
  function listen(id,fn){$(id).addEventListener('click',fn);}
  const task=async fn=>{
    try{await fn();}catch(error){update(String(error.message||error));}
  };
  listen('driveConnect',()=>task(async()=>{
    load();
    config.clientId=trim($('driveClientId').value);save();
    if(!validGoogleClientId(config.clientId))throw Error('Enter a Google OAuth Web client ID from Google Cloud Console.');
    // This callback starts in a direct user gesture, so GIS can open a popup.
    await auth.connect(config.clientId);
    client=new DriveClient(()=>auth.token());
    about=await client.about();tree=null;plan=null;selected.clear();
    $('driveConfirmAccount').checked=false;
    update('Google connected for this session. Verify the account and scan your semester folder.');
    draw();
  }));
  listen('driveDisconnect',()=>{
    auth.disconnect();client=null;about=null;tree=null;plan=null;selected.clear();
    $('driveConfirmAccount').checked=false;update('Google disconnected. Preferences retained locally.');draw();
  });
  listen('driveSaveConfig',()=>{
    load();config.clientId=trim($('driveClientId').value);
    config.rootId=parseDriveFolderId($('driveRootId').value)||'';
    save();update('Drive settings saved on this device. OAuth tokens are never stored.');drawConfig();
  });
  listen('driveScan',()=>task(async()=>{
    if(!connected())throw Error('Connect Google Drive first.');
    const id=parseDriveFolderId($('driveRootId').value);
    if(!id)throw Error('Paste the existing term folder URL or folder ID.');
    config.rootId=id;save();
    busy=true;tree=null;plan=null;selected.clear();drawConfig();
    try{
      const items=await client.crawlTree(id,{
        onProgress:x=>update('Scanning '+x.scanned+' folders; '+x.files+' Drive items discovered…')
      });
      tree=makeDriveTree(id,items);
      update('Drive scan complete: '+tree.folders.length+' folders indexed. Review the course mappings and proposed destinations.');
    }finally{busy=false;draw();}
  }));
  $('driveFolderMap').addEventListener('change',event=>{
    const target=event.target;
    if(!target.matches('select[data-drive-course]'))return;
    const id=target.dataset.driveCourse;
    if(target.value)config.courseMappings[id]=target.value;
    else delete config.courseMappings[id];
    save();selected.clear();drawMap();
  });
  $('driveFilePreview').addEventListener('change',event=>{
    const target=event.target;
    if(target.matches('select[data-drive-file-folder]')){
      const id=target.dataset.driveFileFolder;
      if(target.value)config.fileOverrides[id]=target.value;
      else delete config.fileOverrides[id];
      save();selected.clear();drawMap();
    }else if(target.matches('input[data-drive-select]')){
      if(target.checked)selected.add(target.dataset.driveSelect);
      else selected.delete(target.dataset.driveSelect);
      $('driveUploadSelected').textContent='Upload '+selected.size+' approved files';
    }
  });
  listen('driveSelectReady',()=>{
    for(const r of plan?.rows||[])if(r.status==='ready')selected.add(r.fileId);
    drawMap();
  });
  listen('driveClearSelections',()=>{selected.clear();drawMap();});
  listen('driveUploadSelected',()=>task(handleUpload));
  listen('driveUploadContext',()=>task(uploadContext));
  listen('driveCancel',()=>cancel?.abort());
  $('driveReviewFilter').addEventListener('change',event=>{filter=event.target.value;drawMap();});
  // Account consent is deliberately never remembered across connections.
  $('driveConfirmAccount').addEventListener('change',()=>{drawConfig();});
  return {open(){
    load();
    $('driveUploadReport').textContent='';
    update('No files have been uploaded. Drive actions require explicit approval.');
    draw();dialog.showModal();
  }};
}

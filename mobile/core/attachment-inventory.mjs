// Source-aware, read-only attachment inventory. Does not impose a user's
// eventual Google Drive taxonomy. Keeps Canvas folder hierarchy when known.
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function safeArchiveSegment(v,fallback='unnamed'){
  let s=String(v??'').normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')
    .replace(/[. ]+$/g,'')
    .trim().slice(0,100).replace(/[. ]+$/g,'');
  if(!s||s==='.'||s==='..')s=fallback;
  if(RESERVED.test(s))s='_'+s;
  return s;
}
export function fileIdsInHtml(value){
  const result=new Set();
  if(typeof value!=='string')return [];
  // Capture absolute URLs as a unit, so a foreign URL such as
  // https://evil.example/files/123 cannot slip through as "/files/123".
  const pattern=/https?:\/\/[^\s"'<>]+|\/(?:api\/v1\/)?(?:(?:courses|groups|users)\/\d+\/)?files\/\d+(?:\/[^\s"'<>]*)?/gi;
  for(const match of value.matchAll(pattern)){
    let url;
    try{url=new URL(match[0],'https://q.utoronto.ca');}catch{continue;}
    if(url.origin!=='https://q.utoronto.ca')continue;
    const item=/^\/(?:api\/v1\/)?(?:(?:courses|groups|users)\/\d+\/)?files\/(\d+)(?:\/|$)/.exec(url.pathname);
    if(item)result.add(item[1]);
  }
  return [...result];
}
const validId=v=>/^\d+$/.test(String(v??''));
const basename=(f,id)=>safeArchiveSegment(f?.display_name||f?.filename||'file-'+id,'file-'+id);
function folderPath(folderId,folders){
  const parts=[],visited=new Set();
  let id=String(folderId??'');
  while(validId(id)&&folders.has(id)&&!visited.has(id)&&parts.length<12){
    visited.add(id);
    const folder=folders.get(id);
    const name=safeArchiveSegment(folder.name||'Folder '+id);
    // Canvas course root folders often duplicate the course code; retain the
    // source tree, but don't fabricate missing parent folders.
    parts.unshift(name);
    id=String(folder.parent_folder_id??'');
  }
  return parts;
}
function htmlSources(courseId,cd){
  const sources=[];
  for(const page of cd.pages||[]){
    const body=cd.pageDetails?.[page.url]?.body??page.body;
    sources.push({where:'page:'+String(page.url),html:body});
  }
  for(const a of cd.assignments||[])sources.push({where:'assignment:'+a.id,html:a.description});
  for(const a of cd.announcements||[])sources.push({where:'announcement:'+a.id,html:a.message});
  for(const d of cd.discussions||[])sources.push({where:'discussion:'+d.id,html:d.message});
  return sources;
}
// Return every file ID visible in synced metadata, including links embedded
// in content that the /files endpoint may omit. Unknown file IDs are probed
// with the user's token at download time and may be unavailable.
export function discoverAttachments(snapshot){
  if(!Array.isArray(snapshot?.courses)||!snapshot?.courseData)
    throw new Error('A complete Quercus snapshot is required.');
  const found=new Map();
  const courses=new Map((snapshot.courses||[]).map(c=>[String(c.id),c]));
  function register(id,courseId,metadata=null,source=''){
    id=String(id);
    if(!validId(id))return;
    const course=courses.get(String(courseId));
    const key=course?String(course.id):'personal';
    let entry=found.get(id);
    if(!entry){
      entry={fileId:id,courseId:key,courseCode:course?.course_code||course?.name||'Personal',
        metadata:metadata||null,sources:[],folderNames:[]};
      found.set(id,entry);
    }
    if(metadata && (!entry.metadata||Object.keys(metadata).length>Object.keys(entry.metadata).length))
      entry.metadata=metadata;
    const ref={courseId:key,source};
    if(source&&!entry.sources.some(x=>x.courseId===key&&x.source===source))
      entry.sources.push(ref);
  }
  for(const course of snapshot.courses){
    const id=String(course.id),cd=snapshot.courseData[id]||{};
    for(const file of cd.files||[])register(file?.id,id,file,'course-file-list');
    for(const a of cd.assignments||[]){
      for(const file of a.attachments||[])register(file?.id,id,file,'assignment:'+a.id);
      for(const file of a.submission?.attachments||[])register(file?.id,id,file,'submission:'+a.id);
    }
    for(const sub of cd.submissions||[]){
      for(const file of sub.attachments||[])register(file?.id,id,file,'submission:'+sub.assignment_id);
    }
    for(const a of [...(cd.announcements||[]),...(cd.discussions||[])]){
      for(const file of a.attachments||[])register(file?.id,id,file,'discussion:'+a.id);
      if(a.attachment)register(a.attachment.id,id,a.attachment,'discussion:'+a.id);
    }
    for(const {where,html} of htmlSources(id,cd))
      for(const fileId of fileIdsInHtml(html))register(fileId,id,null,where);
  }
  for(const f of snapshot.global?.userFiles||[])register(f?.id,'personal',f,'user-file-list');
  for(const f of snapshot.global?.userSubmissions||[]){
    for(const a of f.attachments||[])register(a?.id,String(f.course_id||'personal'),a,'user-submission:'+f.assignment_id);
  }
  for(const entry of found.values()){
    const cd=snapshot.courseData[entry.courseId]||{};
    const folderMap=new Map([...(cd.folders||[]),...(snapshot.global?.userFolders||[])]
      .filter(f=>validId(f?.id)).map(f=>[String(f.id),f]));
    entry.folderNames=folderPath(entry.metadata?.folder_id,folderMap);
    const course=safeArchiveSegment(entry.courseCode,'Course-'+entry.courseId);
    const name=basename(entry.metadata,entry.fileId);
    // Add the immutable Canvas ID to avoid overwriting same-name files.
    const dot=name.lastIndexOf('.');
    const stem=dot>0?name.slice(0,dot):name;
    const ext=dot>0?name.slice(dot):'';
    entry.relativePath=['attachments',course,...entry.folderNames,
      safeArchiveSegment(stem,'file')+' [Canvas-'+entry.fileId+']'+ext].join('/');
    entry.displayName=name;
    entry.size=Number.isSafeInteger(Number(entry.metadata?.size))
      ?Number(entry.metadata.size):null;
    entry.mimeType=entry.metadata?.['content-type']||entry.metadata?.content_type||null;
    entry.updatedAt=entry.metadata?.updated_at||null;
  }
  return [...found.values()].sort((a,b)=>
    a.courseCode.localeCompare(b.courseCode)||a.relativePath.localeCompare(b.relativePath));
}

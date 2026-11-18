import {discoverAttachments} from './attachment-inventory.mjs';

export const FOLDER_MIME='application/vnd.google-apps.folder';
const norm=s=>String(s??'').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g,' ').trim();
export function isDriveId(s){return /^[a-zA-Z0-9_-]{12,128}$/.test(String(s??''));}
export function parseDriveFolderId(value){
  const v=String(value||'').trim();
  if(isDriveId(v))return v;
  try{
    const url=new URL(v);
    if(url.protocol!=='https:'||url.hostname!=='drive.google.com')return null;
    const id=/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{12,128})\/?$/.exec(url.pathname)?.[1];
    return id||null;
  }catch{return null;}
}
export function courseCode(course){
  const name=String(course.course_code||course.name||'');
  return /^[A-Z]{2,4}\s*\d{3}/.exec(name.toUpperCase())?.[0].replace(/\s/g,'')||
    name.split(/\s/)[0].toUpperCase();
}
export function makeDriveTree(rootId,items){
  if(!isDriveId(rootId))throw Error('Select a valid Drive folder first.');
  const node=new Map();
  for(const f of items||[]){
    if(!isDriveId(f?.id)||typeof f.name!=='string')continue;
    node.set(f.id,{id:f.id,name:f.name,mimeType:f.mimeType||'',parentId:f.parentId||null,
      size:f.size??null,md5Checksum:f.md5Checksum||null,webViewLink:f.webViewLink||null,
      appProperties:f.appProperties||{},canAddChildren:f.canAddChildren!==false});
  }
  const root=node.get(rootId);
  if(!root||root.mimeType!==FOLDER_MIME)throw Error('The selected Drive root folder is inaccessible.');
  const children=new Map();
  for(const item of node.values()){
    if(!children.has(item.parentId))children.set(item.parentId,[]);
    children.get(item.parentId).push(item);
  }
  const isDescendant=(childId,parentId)=>{
    const seen=new Set();let current=node.get(childId);
    while(current && !seen.has(current.id)){
      if(current.id===parentId)return true;
      seen.add(current.id);current=node.get(current.parentId);
    }
    return false;
  };
  const folders=[...node.values()].filter(f=>f.mimeType===FOLDER_MIME&&isDescendant(f.id,rootId));
  const depth=id=>{let d=0,n=node.get(id),seen=new Set();while(n&&n.id!==rootId&&!seen.has(n.id)){seen.add(n.id);n=node.get(n.parentId);d++;}return d;};
  const label=id=>{
    if(!isDescendant(id,rootId))return '';
    const parts=[];let n=node.get(id),seen=new Set();
    while(n&&!seen.has(n.id)){seen.add(n.id);parts.unshift(n.name);if(n.id===rootId)break;n=node.get(n.parentId);}
    return parts.join(' / ');
  };
  return {rootId,nodes:node,folders,children,depth,label,isDescendant};
}
export function proposeCourseMappings(snapshot,tree,manual={}){
  const out={};
  const rootChildren=tree.folders.filter(f=>f.parentId===tree.rootId);
  for(const course of snapshot?.courses||[]){
    const courseId=String(course.id);
    const preset=manual[courseId];
    if(preset && tree.nodes.get(preset)?.mimeType===FOLDER_MIME&&tree.isDescendant(preset,tree.rootId)){
      out[courseId]={folderId:preset,method:'manual',label:tree.label(preset)};continue;
    }
    const code=courseCode(course);
    const match=rootChildren.filter(f=>{
      const n=norm(f.name);
      return n===norm(code)||n.startsWith(norm(code)+' ');
    });
    out[courseId]=match.length===1
      ?{folderId:match[0].id,method:'course-code',label:tree.label(match[0].id)}
      :{folderId:null,method:match.length?'ambiguous':'unmapped',label:null};
  }
  return out;
}
const RULES=[
  {key:'course-info',matcher:/\b(syllabus|course\s+(outline|info|schedule)|grading policy|course description)\b/i,folders:/\b(course info|syllabus)\b/i},
  {key:'tutorial',matcher:/\b(tutorial|practical|lab(?:oratory)?|tut\b)\b/i,folders:/\b(tutorials?|practicals?|labs?)\b/i},
  {key:'lecture',matcher:/\b(lecture|lec\b|slide|class notes)\b/i,folders:/\blectures?\b/i},
  {key:'reading',matcher:/\b(reading|textbook|chapter|ebook)\b/i,folders:/\b(readings?|textbooks?)\b/i},
  {key:'practice',matcher:/\b(practice|problem set|webwork|worksheet|booklet|exercise)\b/i,folders:/\bpractice\b/i},
  {key:'assessment',matcher:/\b(midterm|final exam|quiz|exam|test|assessment|marking scheme)\b/i,folders:/\bassessments?\b/i},
  {key:'assignment',matcher:/\b(assignment|project|charter|requirements|design specification|deliverable)\b/i,folders:/\b(assignments?|projects?)\b/i},
  {key:'reference',matcher:/\b(reference|formula sheet|cheat sheet|handbook|appendix)\b/i,folders:/\breferences?\b/i},
];
// No AI guesswork: strict folder title and source term matching. User-defined
// overrides always take precedence, and uncertain decisions stay in Review.
export function recommendDriveFolder(file,tree,courseFolderId,overrideId=null){
  if(overrideId){
    const item=tree.nodes.get(overrideId);
    if(item?.mimeType===FOLDER_MIME && tree.isDescendant(overrideId,courseFolderId))
      return {folderId:overrideId,reason:'manual',confidence:'approved'};
    return {folderId:null,reason:'invalid-override',confidence:'review'};
  }
  const folders=tree.folders.filter(f=>f.id!==courseFolderId&&tree.isDescendant(f.id,courseFolderId));
  const sourceParts=(file.folderNames||[]).map(norm).filter(Boolean);
  if(sourceParts.length){
    const exact=folders.filter(f=>{
      const label=norm(f.name);
      return label===sourceParts.at(-1);
    });
    if(exact.length===1)return {folderId:exact[0].id,reason:'matching-source-folder',confidence:'high'};
  }
  const text=String(file.displayName||'')+' '+(file.folderNames||[]).join(' ')+
    ' '+(file.sources||[]).map(x=>x.source?.split(':')[0]).join(' ');
  const classes=RULES.filter(r=>r.matcher.test(text));
  if(classes.length!==1)return {folderId:null,reason:classes.length?'multiple-categories':'unclassified',confidence:'review'};
  const matches=folders.filter(f=>classes[0].folders.test(f.name));
  // Prefer top-level course category; distinct practice subfolders are special
  // and require explicit source-folder evidence or a manual mapping.
  const direct=matches.filter(f=>f.parentId===courseFolderId);
  if(direct.length===1)return {folderId:direct[0].id,reason:'rule:'+classes[0].key,confidence:'medium'};
  return {folderId:null,reason:'missing-or-ambiguous-destination',confidence:'review'};
}
export function planDriveUploads(snapshot,tree,{courseMappings={},fileOverrides={}}={}){
  const mapping=proposeCourseMappings(snapshot,tree,courseMappings);
  const rows=discoverAttachments(snapshot).map(file=>{
    const course=mapping[file.courseId];
    const root=course?.folderId;
    const selected=root?recommendDriveFolder(file,tree,root,fileOverrides[file.fileId]):null;
    const folderId=selected?.folderId||null;
    const destination=folderId?tree.label(folderId):null;
    const existing=folderId?(tree.children.get(folderId)||[]).filter(e=>e.mimeType!==FOLDER_MIME):[];
    const byId=existing.filter(e=>String(e.appProperties?.quercusPocketFileId)===file.fileId);
    const byName=existing.filter(e=>norm(e.name)===norm(file.displayName));
    const status=!root?'unmapped-course':!folderId?'review':byId.length?'already-uploaded':byName.length?'name-conflict':'ready';
    return {...file,folderId,destination,status,why:selected?.reason||course?.method||'unmapped',
      existingFileId:byId[0]?.id||byName[0]?.id||null,
      courseFolderId:root||null};
  });
  return {rows,courses:mapping,counts:{
    ready:rows.filter(r=>r.status==='ready').length,
    review:rows.filter(r=>r.status==='review'||r.status==='unmapped-course'||r.status==='name-conflict').length,
    existing:rows.filter(r=>r.status==='already-uploaded').length,
  }};
}

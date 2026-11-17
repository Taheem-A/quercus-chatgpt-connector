import { validateSnapshot, assignments, pages, announcements, files, extractMarkdownSections, courseName, dateValue } from './data.mjs';

const $ = id => document.getElementById(id);
const content = $('content');
const state = { snapshot:null, markdown:null, view:'home', query:'', course:'all' };
const DB_NAME = 'quercus-pocket-private';
const DB_VERSION = 1;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

function escapeHtml(v='') { return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeUrl(url) { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.href : ''; } catch { return ''; } }
function link(url, label='Open in Quercus') { const href = safeUrl(url); return href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + ' ↗</a>' : ''; }
function readableDate(value) { const t = Date.parse(value||''); return Number.isFinite(t) ? new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'No date'; }
function match(...values){const q=state.query;return !q||values.some(v=>String(v||'').toLowerCase().includes(q));}
function section(title,inner,desc=''){return '<div class="section-head"><h2>'+escapeHtml(title)+'</h2><small>'+escapeHtml(desc)+'</small></div>'+inner;}
function empty(title,text){return '<div class="empty"><strong>'+escapeHtml(title)+'</strong>'+escapeHtml(text)+'</div>';}
function card(title,info,body='',actions='',metadata='') {
  return '<article class="card"><div class="meta">'+escapeHtml(metadata)+'</div><h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(info)+'</p>'+(body?'<div class="detail">'+body+'</div>':'')+(actions?'<div class="detail">'+actions+'</div>':'')+'</article>';
}
function grouped(items,renderer,limit=80){
  const count=items.length;
  return count?'<div class="stack two">'+items.slice(0,limit).map(renderer).join('')+'</div>'+(count>limit?'<p class="hint">Showing the first '+limit+' of '+count+' matches. Narrow your search to find more.</p>':''):empty('No matches','Try a different search or course filter.');
}
function openImport(){ $('importMessage').textContent=''; $('importDialog').showModal(); }
function setStatus() {
  const stamp = state.snapshot?.meta?.completedAt || state.snapshot?.meta?.startedAt;
  $('syncStatus').textContent = stamp ? 'Last synchronized on laptop: ' + readableDate(stamp) + ' · Snapshot, not live data' : state.markdown ? 'Saved Markdown export · Read-only and available offline' : 'No saved course data yet · Import a Quercus export';
}
function updateHeader(){
  setStatus();
  document.querySelectorAll('.bottom-nav button').forEach(el=>{
    const selected=el.dataset.view===state.view;el.classList.toggle('selected',selected);
    if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
}
function snapshotHome(){
  const snapshot=state.snapshot;
  const due=assignments(snapshot).filter(a=>a.dueAt&&dateValue(a.dueAt)>=Date.now()&&!a.excused&&!a.submitted).sort((a,b)=>dateValue(a.dueAt)-dateValue(b.dueAt));
  const recent=announcements(snapshot).slice(0,4);
  return '<div class="stats"><div class="stat"><b>'+snapshot.courses.length+'</b><span>Courses</span></div><div class="stat"><b>'+due.filter(a=>dateValue(a.dueAt)<Date.now()+604800000).length+'</b><span>Due this week</span></div><div class="stat"><b>'+pages(snapshot).filter(p=>p.status==='retrieved').length+'</b><span>Pages synced</span></div></div>'+
    '<div class="notice">Your private course snapshot is available even when your laptop is off. Due dates and grades will not update until you import another export.</div>'+
    section('Coming up',grouped(due.filter(a=>match(a.name,a.courseCode,a.descriptionText)),a=>card(a.name,readableDate(a.dueAt),link(a.htmlUrl), '',a.courseCode||a.courseName),5),due.length+' pending')+
    section('Latest announcements',grouped(recent.filter(a=>match(a.title,a.text,a.course)),a=>card(a.title,a.text.slice(0,260),link(a.url),'',a.course+' · '+readableDate(a.date)),4));
}
function snapshotTasks(){
  const arr=assignments(state.snapshot).filter(a=>match(a.name,a.courseCode,a.courseName,a.descriptionText));
  arr.sort((a,b)=>dateValue(a.dueAt)-dateValue(b.dueAt));
  const future=arr.filter(a=>dateValue(a.dueAt)>=Date.now()&&!a.excused&&a.dueAt);
  const other=arr.filter(a=>dateValue(a.dueAt)<Date.now()||!a.dueAt);
  return section('Upcoming deadlines',grouped(future,a=>card(a.name,readableDate(a.dueAt)+(a.submitted?' · Submitted':' · Not submitted'),a.descriptionText?'<details><summary>Assignment details</summary><div class="body-text">'+escapeHtml(a.descriptionText)+'</div></details>':'',link(a.htmlUrl),a.courseCode||a.courseName)))+
    section('Earlier and undated',grouped(other.slice().reverse(),a=>card(a.name,(a.dueAt?readableDate(a.dueAt):'No deadline')+(a.submitted?' · Submitted':''), '',link(a.htmlUrl),a.courseCode||a.courseName),35),'Review submission status in Quercus');
}
function snapshotCourses(){
  const arr=state.snapshot.courses.filter(c=>match(c.name,c.course_code,c.term?.name));
  return section('Your courses',grouped(arr,c=>{
    const cd=state.snapshot.courseData?.[c.id]||{};
    const grade=(state.snapshot.derived?.grades||[]).find(g=>String(g.courseId)===String(c.id));
    const grades=grade?.currentGrade||grade?.currentScore;
    return card(courseName(c),c.name||'Course','<span class="pill">'+(cd.modules||[]).length+' modules</span> <span class="pill muted">'+(cd.pages||[]).length+' pages</span>'+(grades!==undefined?' <span class="pill">Grade '+escapeHtml(grades)+'</span>':''),'<button class="button outline" data-course="'+escapeHtml(c.id)+'">View pages</button>',c.term?.name||'');
  }));
}
function snapshotPages(){
  const all=pages(state.snapshot);
  const arr=all.filter(p=>(state.course==='all'||String(p.courseId)===state.course)&&match(p.title,p.course,p.module,p.text));
  const courses=state.snapshot.courses;
  const select='<label class="sr-only" for="pageCourse">Filter course</label><select id="pageCourse" class="course-select"><option value="all">All courses</option>'+courses.map(c=>'<option value="'+escapeHtml(c.id)+'" '+(state.course===String(c.id)?'selected':'')+'>'+escapeHtml(courseName(c))+'</option>').join('')+'</select>';
  return section('Course pages',select+grouped(arr,p=>card(p.title,p.module||'Course Page','<span class="pill '+(p.status==='retrieved'?'':'warn')+'">'+(p.status==='retrieved'?'Content saved':'Body unavailable')+'</span>'+(p.text?'<details><summary>Read page</summary><div class="body-text">'+escapeHtml(p.text)+'</div></details>':''),link(p.url),p.course)),arr.length+' found');
}
function snapshotMore(){
  const notes=announcements(state.snapshot).filter(a=>match(a.title,a.text,a.course));
  const matches=files(state.snapshot).filter(f=>match(f.title,f.course));
  return section('Announcements',grouped(notes,a=>card(a.title,a.text.slice(0,600),a.text.length>600?'<details><summary>Read full announcement</summary><div class="body-text">'+escapeHtml(a.text)+'</div></details>':'',link(a.url),a.course+' · '+readableDate(a.date)),25))+
    section('Course files',grouped(matches,f=>card(f.title,f.course, '',link(f.url,'Open / download'),f.bytes?Math.round(f.bytes/1024)+' KB':''),35),matches.length+' found')+
    section('Saved data','<div class="card"><p>Your export is stored in private browser storage on this device. This is <b>not</b> connected to live Quercus.</p><div class="footer-actions"><button class="button" id="refreshExport">Import newer export</button><button class="button outline" id="clearData">Delete saved data</button></div></div>');
}
function markdownHome(){
  const items=extractMarkdownSections(state.markdown);
  const filtered=items.filter(s=>match(s.title,s.content));
  return '<div class="notice warning">Markdown reading mode. Import the Complete JSON export to access the full interactive course dashboard.</div>'+
    section('Saved export sections',grouped(filtered,s=>card(s.title,s.content.length.toLocaleString()+' characters','<details><summary>Read section</summary><div class="md-block">'+escapeHtml(s.content)+'</div></details>'),45),items.length+' sections');
}
function render(){
  updateHeader();
  if(!state.snapshot&&!state.markdown){
    content.innerHTML=empty('No export on this phone','Your courses stay private and available offline after you import them.')+
      '<div class="cta"><button class="button" id="firstImport">Import Quercus export</button></div>'+
      '<div class="notice">For the full dashboard, export <b>Complete JSON</b> from the desktop connector, then transfer it to your phone using AirDrop, iCloud Drive or another method you trust.</div>';
    $('firstImport').addEventListener('click',openImport);return;
  }
  if(state.markdown&&!state.snapshot){content.innerHTML=markdownHome();return;}
  content.innerHTML=({home:snapshotHome,tasks:snapshotTasks,courses:snapshotCourses,pages:snapshotPages,more:snapshotMore}[state.view]||snapshotHome)();
  const courseSelect=$('pageCourse');if(courseSelect)courseSelect.addEventListener('change',e=>{state.course=e.target.value;render()});
  document.querySelectorAll('[data-course]').forEach(b=>b.addEventListener('click',()=>{state.course=b.dataset.course;state.view='pages';state.query='';$('search').value='';render();scrollTo(0,0)}));
  $('refreshExport')?.addEventListener('click',openImport);
  $('clearData')?.addEventListener('click',async()=>{if(!confirm('Delete the imported Quercus export from this phone?'))return;await dbClear();state.snapshot=null;state.markdown=null;state.course='all';state.view='home';render()});
}
function dbOpen(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>req.result.createObjectStore('data');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});}
async function dbRead(){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('data','readonly');const req=t.objectStore('data').get('latest');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);t.oncomplete=()=>db.close();});}
async function dbWrite(value){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('data','readwrite');t.objectStore('data').put(value,'latest');t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)};});}
async function dbClear(){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('data','readwrite');t.objectStore('data').clear();t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)};});}
async function importFile(file){
  const msg=$('importMessage');
  if(!file)return;
  if(file.size>MAX_FILE_BYTES)throw new Error('File too large. Maximum 40 MB.');
  msg.textContent='Reading file on this device…';
  const text=await file.text();
  if(file.name.toLowerCase().endsWith('.json')) {
    const snapshot=validateSnapshot(JSON.parse(text));
    await dbWrite({kind:'json',value:snapshot});
    state.snapshot=snapshot;state.markdown=null;
  } else if(file.name.toLowerCase().endsWith('.md')) {
    if(!text.startsWith('# Quercus'))throw new Error('This does not look like a Quercus Markdown export.');
    await dbWrite({kind:'markdown',value:text});
    state.markdown=text;state.snapshot=null;
  } else throw new Error('Choose the Complete JSON (.json) or ChatGPT Markdown (.md) Quercus export.');
  state.view='home';state.course='all';state.query='';$('search').value='';
  $('importDialog').close();render();
}
$('importButton').addEventListener('click',openImport);
$('fileInput').addEventListener('change',async event=>{try{await importFile(event.target.files?.[0])}catch(e){$('importMessage').textContent='Unable to import: '+e.message}finally{event.target.value=''}});
$('search').addEventListener('input',e=>{state.query=e.target.value.toLowerCase().trim();render()});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render();scrollTo(0,0)}));
try {const stored=await dbRead();if(stored?.kind==='json')state.snapshot=validateSnapshot(stored.value);else if(stored?.kind==='markdown')state.markdown=stored.value;}catch(e){console.warn('Could not read private mobile storage',e);}
render();
if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(()=>{});

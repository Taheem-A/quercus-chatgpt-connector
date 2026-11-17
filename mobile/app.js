import { validateSnapshot, assignments, pages, announcements, files, extractMarkdownSections, courseName, dateValue } from './data.mjs';
import { BrowserCanvasClient } from './core/canvas.mjs';
import { syncQuercus } from './core/sync.mjs';
import { renderCanvasContent, contentLinks } from './core/rich-content.mjs';
import { makeMobileExport, makeSavedMarkdownExport } from './core/mobile-export.mjs';

const $ = id => document.getElementById(id);
const content = $('content');
const state = { snapshot:null, markdown:null, view:'home', query:'', course:'all', token:null, syncing:false };
const DB_NAME = 'quercus-pocket-private';
const DB_VERSION = 2;
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
function openExport(){
  if(!state.snapshot&&!state.markdown){alert('Sync Quercus or import an export before downloading your data.');return;}
  $('exportResult').replaceChildren();
  $('exportMessage').textContent='';
  for(const button of document.querySelectorAll('[data-export]')){
    button.disabled=!state.snapshot && button.dataset.export!=='chatgpt';
  }
  $('exportDialog').showModal();
}

function openConnect(){
  $('connectMessage').textContent='';
  $('tokenInput').value='';
  $('rememberToken').checked=false;
  $('connectDialog').showModal();
}
function setStatus() {
  const stamp = state.snapshot?.meta?.completedAt || state.snapshot?.meta?.startedAt;
  $('syncStatus').textContent = stamp ? 'Last synced ' + readableDate(stamp) + ' · ' + (state.snapshot?.meta?.app === 'Quercus Pocket' ? 'Live phone sync' : 'Imported snapshot') + ' · Available offline' : state.markdown ? 'Saved Markdown export · Read-only and available offline' : 'Connect Quercus directly, or import a saved export.';
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
    '<div class="notice">Your latest synced snapshot stays on this phone for offline access. Tap ⟳ to get fresh Quercus information whenever you have internet.</div>'+
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
// Safe Canvas HTML renderer: preserves links without trusting raw course markup.
function pageContentHtml(html) {
  const main = renderCanvasContent(html).outerHTML;
  const resources = contentLinks(html);
  const files = resources.filter(x => x.kind === 'file');
  const links = resources.filter(x => x.kind !== 'file');
  const entry = x => {
    const target = escapeHtml(x.url);
    const attr = x.kind === 'file' ? ' data-canvas-file="' + escapeHtml(x.fileId) + '"' : '';
    return '<li><a class="canvas-link ' + (x.kind === 'file' ? 'canvas-file' : '') +
      '" href="' + target + '" target="_blank" rel="noopener noreferrer"' + attr + '>' +
      escapeHtml(x.label || (x.kind === 'file' ? 'Attachment' : 'Open link')) + '</a></li>';
  };
  let extra = '';
  if (files.length) extra += '<h4>Attachments (' + files.length + ')</h4><ul class="resource-list">' + files.map(entry).join('') + '</ul>';
  if (links.length) extra += '<h4>Other linked resources (' + links.length + ')</h4><ul class="resource-list">' + links.map(entry).join('') + '</ul>';
  return main + extra;
}
function fileAction(file) {
  if (file.id && /^\d+$/.test(String(file.id))) {
    return '<a class="canvas-link canvas-file" data-canvas-file="' + escapeHtml(file.id) +
      '" href="' + escapeHtml('https://q.utoronto.ca/files/' + file.id + '/download') +
      '" target="_blank" rel="noopener noreferrer">Open / download file ↧</a>';
  }
  return link(file.url, 'Open file');
}
function snapshotPages(){
  const all=pages(state.snapshot);
  const arr=all.filter(p=>(state.course==='all'||String(p.courseId)===state.course)&&match(p.title,p.course,p.module,p.text));
  const courses=state.snapshot.courses;
  const select='<label class="sr-only" for="pageCourse">Filter course</label><select id="pageCourse" class="course-select"><option value="all">All courses</option>'+courses.map(c=>'<option value="'+escapeHtml(c.id)+'" '+(state.course===String(c.id)?'selected':'')+'>'+escapeHtml(courseName(c))+'</option>').join('')+'</select>';
  return section('Course pages',select+grouped(arr,p=>card(p.title,p.module||'Course Page','<span class="pill '+(p.status==='retrieved'?'':'warn')+'">'+(p.status==='retrieved'?'Content saved':'Body unavailable')+'</span>'+(p.html?'<details><summary>Read page and open links</summary>'+pageContentHtml(p.html)+'</details>':p.text?'<details><summary>Read page</summary><div class="body-text">'+escapeHtml(p.text)+'</div></details>':''),link(p.url),p.course)),arr.length+' found');
}
function snapshotMore(){
  const notes=announcements(state.snapshot).filter(a=>match(a.title,a.text,a.course));
  const matches=files(state.snapshot).filter(f=>match(f.title,f.course));
  return section('Announcements',grouped(notes,a=>card(a.title,a.text.slice(0,600),a.text.length>600?'<details><summary>Read full announcement</summary><div class="body-text">'+escapeHtml(a.text)+'</div></details>':'',link(a.url),a.course+' · '+readableDate(a.date)),25))+
    section('Course files',grouped(matches,f=>card(f.title,f.course, '',fileAction(f),f.bytes?Math.round(f.bytes/1024)+' KB':''),35),matches.length+' found')+
    section('Sync and privacy','<div class="card"><p>You can sync Quercus directly on this phone with an access token. Your saved data stays offline-capable. Live requests pass through the restricted HTTPS relay; no Quercus token or course snapshot is stored on Vercel.</p><div class="footer-actions"><button class="button" id="syncAgain">Sync now</button><button class="button outline" id="changeToken">Change token</button><button class="button outline" id="forgetToken">Forget saved token</button><button class="button outline" id="openExportMore">Export my data</button><button class="button outline" id="refreshExport">Import saved export</button><button class="button outline" id="clearData">Delete saved data</button></div></div>');
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
    content.innerHTML=empty('Connect directly to Quercus','Sync your course data from your phone with no laptop required.')+
      '<div class="cta"><button class="button" id="firstConnect">Connect and sync Quercus</button><button class="button outline" id="firstImport">Import a saved export</button></div>'+
      '<div class="notice">Your token stays on your phone unless you submit a live sync request; the read-only Vercel relay forwards each request to Quercus over HTTPS without storing the token. Synced data is saved on this device for offline use.</div>';
    $('firstImport').addEventListener('click',openImport);
    $('firstConnect').addEventListener('click',()=>state.token?startLiveSync():openConnect());return;
  }
  if(state.markdown&&!state.snapshot){content.innerHTML=markdownHome();return;}
  content.innerHTML=({home:snapshotHome,tasks:snapshotTasks,courses:snapshotCourses,pages:snapshotPages,more:snapshotMore}[state.view]||snapshotHome)();
  const courseSelect=$('pageCourse');if(courseSelect)courseSelect.addEventListener('change',e=>{state.course=e.target.value;render()});
  document.querySelectorAll('[data-course]').forEach(b=>b.addEventListener('click',()=>{state.course=b.dataset.course;state.view='pages';state.query='';$('search').value='';render();scrollTo(0,0)}));
  $('refreshExport')?.addEventListener('click',openImport);
  $('openExportMore')?.addEventListener('click',openExport);
  $('syncAgain')?.addEventListener('click',()=>state.token?startLiveSync():openConnect());
  $('changeToken')?.addEventListener('click',openConnect);
  $('forgetToken')?.addEventListener('click',async()=>{await dbForgetToken();state.token=null;alert('Saved access token cleared from this device.');});
  $('clearData')?.addEventListener('click',async()=>{if(!confirm('Delete all imported Quercus data AND your saved access token from this phone?'))return;await dbClear();state.token=null;state.snapshot=null;state.markdown=null;state.course='all';state.view='home';render()});
}
function dbOpen(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('data'))req.result.createObjectStore('data');if(!req.result.objectStoreNames.contains('auth'))req.result.createObjectStore('auth')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});}
async function dbRead(){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('data','readonly');const req=t.objectStore('data').get('latest');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);t.oncomplete=()=>db.close();});}
async function dbWrite(value){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('data','readwrite');t.objectStore('data').put(value,'latest');t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)};});}
async function dbClear(){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction(['data','auth'],'readwrite');t.objectStore('data').clear();t.objectStore('auth').clear();t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)};});}
async function dbReadToken(){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('auth','readonly');const q=t.objectStore('auth').get('token');q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);t.oncomplete=()=>db.close();});}
async function dbSaveToken(token){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('auth','readwrite');t.objectStore('auth').put(token,'token');t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)};});}
async function dbForgetToken(){const db=await dbOpen();return new Promise((resolve,reject)=>{const t=db.transaction('auth','readwrite');t.objectStore('auth').delete('token');t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)};});}
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

let exportBlobUrl = null;
async function exportSnapshot(format) {
  const info = state.snapshot
    ? makeMobileExport(state.snapshot, format)
    : format === 'chatgpt' ? makeSavedMarkdownExport(state.markdown) : null;
  if (!info) throw new Error('Only the saved Markdown can be exported in Markdown-only mode. Sync or import JSON for other formats.');
  if (exportBlobUrl) URL.revokeObjectURL(exportBlobUrl);
  const blob = new Blob([info.data], {type:info.type});
  exportBlobUrl = URL.createObjectURL(blob);
  const result = $('exportResult');
  const anchor = document.createElement('a');
  anchor.href = exportBlobUrl;
  anchor.download = info.name;
  anchor.className = 'button export-ready';
  anchor.textContent = 'Save ' + info.name;
  result.replaceChildren(anchor);
  $('exportMessage').textContent = 'Generated on your phone: ' + Math.max(1, Math.round(blob.size/1024)) + ' KB. Save to Files or use Share.';
  if (navigator.share && navigator.canShare && typeof File !== 'undefined') {
    const file = new File([blob], info.name, {type:info.type});
    if (navigator.canShare({files:[file]})) {
      try {
        await navigator.share({files:[file],title:'Quercus Pocket export'});
        $('exportMessage').textContent = 'Share completed. The Save button remains available below.';
      } catch (error) {
        if (error.name !== 'AbortError') $('exportMessage').textContent = 'Sharing unavailable; use Save below.';
      }
    }
  }
}

// The Canvas file API returns a download URL for files readable by this student.
// Open that URL on the device (typically a signed Canvas/CDN link). No binary file
// passes through Vercel, and the token never appears in a link or download URL.
async function handleFileLink(event) {
  const a = event.target.closest('a[data-canvas-file]');
  if (!a || !content.contains(a) || !state.token || !navigator.onLine) return;
  const id = a.dataset.canvasFile;
  if (!/^\d+$/.test(id)) return;
  event.preventDefault();
  const fallback = a.href;
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.document.body.textContent = 'Preparing Quercus file…';
  try {
    const response = await new BrowserCanvasClient(state.token).getOne('/api/v1/files/' + id);
    const link = response.data?.url;
    const url = new URL(link || '');
    if (url.protocol !== 'https:') throw new Error('Quercus did not provide a secure download URL.');
    if (popup) {
      popup.location.href = url.toString();
    } else {
      const notice = document.createElement('div');
      notice.className = 'download-result';
      const ready = document.createElement('a');
      ready.href = url.toString();
      ready.target = '_blank'; ready.rel = 'noopener noreferrer';
      ready.textContent = 'Tap here to open attachment ' + id;
      notice.appendChild(ready);
      a.after(notice);
    }
  } catch (error) {
    if (popup) popup.location.href = fallback;
    else alert('Automatic file access was unavailable. Open the original page in Quercus to download it.');
  }
}

function progressText(update) {
  const strip = $('liveSync');
  strip.hidden = false;
  $('liveSyncText').textContent = update.message || 'Syncing courses…';
  $('liveSyncProgress').value = update.percent || 0;
}

async function startLiveSync() {
  if (state.syncing) return;
  if (!state.token) { openConnect(); return; }
  if (!navigator.onLine) {
    alert('You are offline. Existing course data is available, but live syncing needs internet.');
    return;
  }
  state.syncing = true;
  $('connectButton').disabled = true;
  progressText({ message: 'Verifying Quercus access…', percent: 1 });
  try {
    const client = new BrowserCanvasClient(state.token);
    const profile = await client.getOne('/api/v1/users/self/profile');
    if (!profile?.data?.id) throw new Error('Unable to verify your Quercus token.');
    const next = await syncQuercus(client, { onProgress: progressText });
    if (!next.courses?.length) throw new Error('Sync returned no courses; your previously saved data was preserved.');
    next.meta.app = 'Quercus Pocket';
    // Write only after a validated sync; do not replace good data on API failure.
    await dbWrite({ kind: 'json', value: next });
    state.snapshot = next;
    state.markdown = null;
    state.view = 'home';
    state.course = 'all';
    state.query = '';
    $('search').value = '';
    progressText({ message: 'Sync complete: ' + next.courses.length + ' courses, ' + (next.derived?.counts?.pages || 0) + ' pages. ' + next.meta.failedEndpoints + ' endpoint(s) unavailable.', percent: 100 });
    render();
  } catch (error) {
    progressText({ message: 'Sync failed: ' + error.message + ' · Previously saved data was kept.', percent: 0 });
    // Invalid or revoked token should not be forgotten automatically.
  } finally {
    state.syncing = false;
    $('connectButton').disabled = false;
  }
}

$('connectButton').addEventListener('click', () => state.token ? startLiveSync() : openConnect());
$('connectNow').addEventListener('click', async () => {
  if (state.syncing) return;
  const entered = $('tokenInput').value.trim();
  if (!entered && !state.token) {
    $('connectMessage').textContent = 'Paste a Quercus API token first.';
    return;
  }
  if (entered) {
    if (entered.length < 10 || entered.length > 1024 || /\s/.test(entered)) {
      $('connectMessage').textContent = 'The access token format does not look valid.';
      return;
    }
    state.token = entered;
    if ($('rememberToken').checked) {
      try { await dbSaveToken(entered); }
      catch { $('connectMessage').textContent = 'Unable to remember token on this device. You can still sync this session.'; }
    } else {
      await dbForgetToken().catch(() => {});
    }
  }
  $('tokenInput').value='';
  $('connectDialog').close();
  startLiveSync();
});

$('importButton').addEventListener('click',openImport);
$('exportButton').addEventListener('click',openExport);
document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click',async ()=>{
  $('exportMessage').textContent = 'Preparing export on this phone…';
  button.disabled = true;
  try {await exportSnapshot(button.dataset.export);}
  catch(error){$('exportMessage').textContent='Export failed: '+error.message;}
  finally {button.disabled=false;}
}));
content.addEventListener('click',handleFileLink);
$('fileInput').addEventListener('change',async event=>{try{await importFile(event.target.files?.[0])}catch(e){$('importMessage').textContent='Unable to import: '+e.message}finally{event.target.value=''}});
$('search').addEventListener('input',e=>{state.query=e.target.value.toLowerCase().trim();render()});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render();scrollTo(0,0)}));
try {const stored=await dbRead();if(stored?.kind==='json')state.snapshot=validateSnapshot(stored.value);else if(stored?.kind==='markdown')state.markdown=stored.value;state.token=await dbReadToken();}catch(e){console.warn('Could not read private mobile storage',e);}
render();
if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(()=>{});

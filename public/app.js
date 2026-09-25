const VIEWS = [
  ['overview', 'Overview', 'Your Quercus workload and sync state', 'home'],
  ['assignments', 'Assignments', 'Deadlines, submission state, and grades', 'list'],
  ['calendar', 'Calendar & Planner', 'Canvas calendar, planner, and to-do items', 'calendar'],
  ['announcements', 'Announcements', 'Announcements across your courses', 'bell'],
  ['courses', 'Courses', 'Courses, terms, and synced coverage', 'book'],
  ['modules', 'Modules', 'Modules, items, and completion state', 'layers'],
  ['pages', 'Pages', 'Course pages and synced page content', 'fileText'],
  ['discussions', 'Discussions', 'Discussion topics visible to your account', 'message'],
  ['quizzes', 'Quizzes', 'Quiz metadata visible through Canvas', 'quiz'],
  ['grades', 'Grades & Submissions', 'Course grade summaries and submission history', 'grade'],
  ['files', 'Files', 'Course file metadata and downloads', 'folder'],
  ['messages', 'Messages', 'Canvas Inbox conversations returned by your account', 'mail'],
  ['diagnostics', 'Diagnostics', 'Endpoint coverage, failures, and sync health', 'activity'],
  ['raw', 'Raw API', 'Run a read-only Canvas GET request locally', 'terminal'],
  ['export', 'Export', 'JSON, CSV, Markdown, ICS, and ChatGPT context', 'download'],
  ['settings', 'Settings', 'Local-only credentials and app preferences', 'gear'],
];

const ROUTES = new Set(VIEWS.map(v => v[0]));
const COURSE_COLORS = [
  'var(--course-blue)','var(--course-teal)','var(--course-green)','var(--course-amber)',
  'var(--course-orange)','var(--course-rose)','var(--course-violet)','var(--course-slate)',
];

const state = {
  route: routeFromHash(), snapshot: null, settings: null, status: null,
  search: '', course: 'all', syncTimer: null, syncStatus: null, loading: true,
  theme: localStorage.getItem('quercus-theme') || 'light',
};

document.documentElement.dataset.theme = state.theme;
const app = document.querySelector('#app');

function routeFromHash() {
  const raw = (location.hash || '#overview').slice(1).split('?')[0];
  return ROUTES.has(raw) ? raw : 'overview';
}
function go(route) { location.hash = ROUTES.has(route) ? route : 'overview'; }
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function stripHtml(html = '') {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
function fmtDate(value, compact = false) {
  if (!value) return '—';
  const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA', compact ? {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'} : {dateStyle:'medium',timeStyle:'short'}).format(d);
}
function fmtDay(value) {
  if (!value) return '—'; const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA',{weekday:'short',month:'short',day:'numeric'}).format(d);
}
function fmtBytes(value) {
  let n = Number(value || 0); if (!n) return '0 B'; const units=['B','KB','MB','GB','TB']; let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i+=1;} return `${n.toFixed(i?1:0)} ${units[i]}`;
}
function relativeDue(value) {
  if (!value) return 'No due date'; const ms=Date.parse(value)-Date.now(); if(Number.isNaN(ms)) return fmtDate(value,true);
  const hours=Math.round(ms/3600000); if(hours<-48)return `${Math.abs(Math.round(hours/24))}d overdue`; if(hours<0)return `${Math.abs(hours)}h overdue`; if(hours<24)return `Due in ${hours}h`; return `Due in ${Math.round(hours/24)}d`;
}
function matchSearch(...values) { return !state.search || values.flat().filter(Boolean).join(' ').toLowerCase().includes(state.search.toLowerCase()); }
function coursePass(id) { return state.course==='all'||String(id)===String(state.course); }
function courseById(id) { return (state.snapshot?.courses||[]).find(c=>String(c.id)===String(id))||{}; }
function courseName(id) { const c=courseById(id); return c.course_code||c.name||`Course ${id}`; }
function courseColor(idOrCode) {
  const str=String(idOrCode??'course'); let hash=0; for(let i=0;i<str.length;i+=1)hash=((hash<<5)-hash)+str.charCodeAt(i);
  return COURSE_COLORS[Math.abs(hash)%COURSE_COLORS.length];
}
function courseBadge(idOrCode,label) {
  const c=typeof idOrCode==='object'?idOrCode:courseById(idOrCode); const text=label||c.course_code||c.name||String(idOrCode||'Course'); const key=c.id||c.course_code||idOrCode;
  return `<span class="course-badge" style="--course:${courseColor(key)}">${escapeHtml(text)}</span>`;
}
function status(label,type='info') { return `<span class="status ${type}">${escapeHtml(label)}</span>`; }
function assignmentStatus(a) {
  if(a.excused)return status('Excused','info'); if(a.missing)return status('Missing','danger'); if(a.late)return status('Late','warning');
  if(a.submitted||a.workflowState==='submitted'||a.workflowState==='graded')return status('Submitted','success'); return status('Not submitted','info');
}
function icon(name,size=18) {
  const common=`width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const shapes={
    home:`<path d="M4 10.5 12 4l8 6.5v8.5a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>`,
    calendar:`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>`,
    list:`<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none"/>`,
    book:`<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23zM20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23z"/>`,
    gear:`<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6L11.5 3h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4z" transform="translate(1.5)"/>`,
    search:`<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>`, external:`<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>`,
    clock:`<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>`, sun:`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`, moon:`<path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>`,
    bell:`<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>`, layers:`<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>`, fileText:`<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>`,
    message:`<path d="M4 5h16v12H8l-4 4z"/>`, quiz:`<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2.9-1.2 2M12 17h.01"/>`, grade:`<path d="M4 4h16v16H4z"/><path d="m8 12 2.5 2.5L16 9"/>`, folder:`<path d="M3 6h7l2 2h9v11H3z"/>`, mail:`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>`,
    activity:`<path d="M3 12h4l2-6 4 12 2-6h6"/>`, terminal:`<path d="m5 7 4 5-4 5M11 17h8"/>`, download:`<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>`, refresh:`<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>`, chevron:`<path d="m9 6 6 6-6 6"/>`,
  };
  return `<svg ${common}>${shapes[name]||shapes.list}</svg>`;
}
function link(url,label='Open') { return url?`<a class="ghost-btn" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)} ${icon('external',14)}</a>`:''; }
function toast(message,type='') {
  const region=document.querySelector('#toast-region'); if(!region)return; const el=document.createElement('div'); el.className=`toast ${type}`; el.innerHTML=`<span>${escapeHtml(message)}</span><button class="ghost-btn" aria-label="Dismiss">×</button>`; el.querySelector('button').addEventListener('click',()=>el.remove()); region.appendChild(el); setTimeout(()=>el.remove(),4500);
}
async function api(url,options={}) {
  const res=await fetch(url,{headers:{'content-type':'application/json',...(options.headers||{})},...options}); const type=res.headers.get('content-type')||''; const body=type.includes('application/json')?await res.json():await res.text(); if(!res.ok)throw new Error(body?.error||body||`HTTP ${res.status}`); return body;
}

function navItem(route) { const meta=VIEWS.find(v=>v[0]===route),active=state.route===route; return `<button class="nav-item ${active?'active':''}" data-route="${route}" aria-current="${active?'page':'false'}"><span class="nav-icon">${icon(meta[3])}</span><span class="nav-label">${escapeHtml(meta[1])}</span></button>`; }
function navGroup(routes) { return `<nav class="nav-group">${routes.map(navItem).join('')}</nav>`; }
function connectionMarkup() { const configured=state.settings?.configured; return `<div class="connection ${configured?'ok':'bad'}"><span class="connection-dot"></span><span>${configured?'Quercus connected':'Connection required'}</span></div>`; }
function syncMarkup() { const s=state.syncStatus||state.status?.sync||{}; const cls=s.running?'running':s.stage==='error'?'error':''; let label=state.snapshot?'Synced':'No snapshot'; if(s.running)label=`${Math.round(s.percent||0)}%`; if(s.stage==='error')label='Sync error'; return `<div class="sync ${cls}"><span class="sync-dot"></span><span>${escapeHtml(label)}</span></div>`; }
function shell(content) {
  const meta=VIEWS.find(v=>v[0]===state.route)||VIEWS[0], profileLabel=state.snapshot?.profile?.name||state.snapshot?.user?.name||'Local', initial=String(profileLabel).trim().slice(0,1).toUpperCase()||'Q';
  return `<div class="app-shell"><aside class="sidebar" aria-label="Primary navigation"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Quercus Local</span></div><div class="nav-scroll">${navGroup(['overview','assignments','calendar','announcements'])}${navGroup(['courses','modules','pages','discussions','quizzes','grades'])}${navGroup(['files','messages'])}${navGroup(['diagnostics','raw','export'])}${navGroup(['settings'])}</div><div class="sidebar-spacer"></div><div class="sidebar-status">${connectionMarkup()}<div class="version">Local snapshot workspace</div></div></aside><header class="topbar"><label class="command-trigger" aria-label="Search current view">${icon('search',16)}<input id="global-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search ${escapeHtml(meta[1].toLowerCase())}…" autocomplete="off"/><span class="shortcut">/</span></label><div class="topbar-actions"><button class="primary-btn" data-action="sync">${icon('refresh',17)} <span>Sync</span></button>${syncMarkup()}<button class="icon-btn" data-action="toggle-theme" aria-label="Toggle theme">${state.theme==='dark'?icon('sun',17):icon('moon',17)}</button><div class="profile" aria-hidden="true">${escapeHtml(initial)}</div><span class="profile-label">${escapeHtml(profileLabel.split(' ')[0]||'Local')}</span></div></header><main class="main"><div class="page"><div id="page-content">${content}</div></div></main>${mobileNav()}${syncProgress()}</div><div class="toast-region" id="toast-region" aria-live="polite"></div>`;
}
function mobileNav() { const item=(route,label,ico)=>`<button class="${state.route===route?'active':''}" data-route="${route}"><span>${icon(ico,18)}</span><span>${label}</span></button>`; return `<nav class="mobile-nav" aria-label="Mobile navigation">${item('overview','Overview','home')}${item('assignments','Work','list')}<button class="sync-mobile" data-action="sync" aria-label="Sync Quercus">${icon('refresh',19)}</button>${item('calendar','Calendar','calendar')}${item('export','Export','download')}</nav>`; }
function syncProgress() { const s=state.syncStatus||state.status?.sync||{},visible=s.running||s.stage==='error'; return `<div id="sync-progress" class="sync-progress ${visible?'':'hidden'}" role="status" aria-live="polite"><div class="sync-progress-main"><div class="sync-progress-row"><span><strong id="sync-message">${escapeHtml(s.error||s.message||'Syncing Quercus…')}</strong>${s.currentCourse?` · ${escapeHtml(s.currentCourse)}`:''}</span><span id="sync-percent">${Math.round(s.percent||0)}%</span></div><div class="progress"><span id="sync-progress-fill" style="width:${Math.max(0,Math.min(100,s.percent||0))}%"></span></div></div></div>`; }
function pageTitle(title,subtitle,summary='',aside='') { return `<div class="page-title-row"><div><h1 class="page-title">${escapeHtml(title)}</h1><p class="page-subtitle">${escapeHtml(subtitle)}</p>${summary?`<div class="summary-line">${summary}</div>`:''}</div>${aside}</div>`; }
function filterToolbar(extra='') { const courses=state.snapshot?.courses||[]; return `<div class="view-toolbar"><div class="toolbar-left">${extra}</div><div class="toolbar-right"><label class="sr-only" for="course-filter">Filter by course</label><select id="course-filter" class="select"><option value="all">All courses</option>${courses.map(c=>`<option value="${escapeHtml(c.id)}" ${String(state.course)===String(c.id)?'selected':''}>${escapeHtml(c.course_code||c.name)}</option>`).join('')}</select></div></div>`; }
function emptyState(title,detail,action='') { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>${action}</div></div>`; }
function noSnapshot() { if(state.loading)return emptyState('Loading Quercus Local','Reading your saved snapshot and local settings.'); if(!state.settings?.configured)return emptyState('Connect Quercus first','Add your personal Canvas access token in Settings, then run your first sync.','<button class="primary-btn" data-route="settings">Open settings</button>'); return emptyState('No snapshot yet','Sync Quercus once to build the local dataset used throughout this app.',`<button class="primary-btn" data-action="sync">${icon('refresh',16)} Sync Quercus</button>`); }

function overviewView() {
  if(!state.snapshot)return `<div class="page-inner overview-width">${pageTitle('Overview','Your Quercus workload and sync state')}${noSnapshot()}</div>`;
  const s=state.snapshot,d=s.derived||{},counts=d.counts||{},urgent=(d.overdueAssignments||[]).filter(a=>coursePass(a.courseId)),upcoming=(d.upcomingAssignments||[]).filter(a=>coursePass(a.courseId)),announcements=(d.recentAnnouncements||[]).filter(a=>coursePass(a.courseId)),focus=urgent[0]||upcoming[0],lastSync=s.meta?.completedAt||s.meta?.startedAt,failures=s.meta?.failedEndpoints||0;
  const health=failures?`<div class="callout warning" style="min-width:250px"><strong>${failures} endpoint ${failures===1?'warning':'warnings'}</strong><span class="tiny">The rest of your snapshot is still available.</span></div>`:`<div class="callout success" style="min-width:250px"><strong>✓ Snapshot healthy</strong><span class="tiny">No endpoint failures reported.</span></div>`;
  return `<div class="page-inner overview-width">${pageTitle('Overview',lastSync?`Last synced ${fmtDate(lastSync)}`:'Your latest Quercus snapshot',`${counts.courses??s.courses?.length??0} courses · ${counts.upcoming??0} due soon · ${counts.overdue??0} need attention`,health)}<div class="stat-strip"><div class="stat-cell"><span class="stat-label">Courses</span><strong class="stat-value">${counts.courses??s.courses?.length??0}</strong></div><div class="stat-cell"><span class="stat-label">Due next 7 days</span><strong class="stat-value">${counts.upcoming??0}</strong></div><div class="stat-cell"><span class="stat-label">Overdue / missing</span><strong class="stat-value">${counts.overdue??0}</strong></div><div class="stat-cell"><span class="stat-label">Synced files</span><strong class="stat-value">${counts.files??0}</strong></div></div><div class="overview-layout"><div>${focus?`<section class="card attention-card"><div><div class="eyebrow">${urgent.length?'NEEDS ATTENTION':'NEXT DEADLINE'}</div><div class="attention-main">${courseBadge(focus.courseId,focus.courseCode||focus.courseName)}<div><h2 class="attention-title">${escapeHtml(focus.name||'Assignment')}</h2><div class="muted" style="font-size:13px;margin-bottom:8px">${escapeHtml(relativeDue(focus.dueAt))}</div><div class="meta"><span>${icon('clock',14)} ${fmtDate(focus.dueAt,true)}</span><span>${escapeHtml(focus.pointsPossible??'—')} points</span><span>${escapeHtml(focus.workflowState||(focus.submitted?'submitted':'not submitted'))}</span></div></div></div></div><div class="attention-actions">${link(focus.htmlUrl,'Open')}</div></section>`:`<section class="card attention-card"><div><div class="eyebrow">STATUS</div><h2 class="attention-title">Nothing urgent detected</h2><div class="muted">No upcoming or overdue assignments were returned in this snapshot.</div></div></section>`}<div class="section-head"><h2>Upcoming deadlines</h2><button class="secondary-btn" data-route="assignments">View all assignments</button></div><div class="row-list">${upcoming.slice(0,8).map(a=>`<div class="task-row"><span class="assessment-course-line" style="--course:${courseColor(a.courseId)}"></span><div><div style="display:flex;align-items:center;gap:10px;min-width:0">${courseBadge(a.courseId,a.courseCode||a.courseName)}<span class="task-title">${escapeHtml(a.name)}</span></div><div class="tiny" style="margin-top:4px">${fmtDate(a.dueAt,true)}</div></div>${assignmentStatus(a)}${link(a.htmlUrl)}</div>`).join('')||'<div class="task-row"><span></span><span class="muted">Nothing due in the next seven days.</span><span></span><span></span></div>'}</div></div><aside class="side-stack"><section class="card side-card"><h3>Recent announcements</h3><div class="side-upcoming">${announcements.slice(0,5).map(a=>`<div class="side-upcoming-item"><span class="course-line" style="--course:${courseColor(a.courseId)}"></span><span><strong style="display:block;font-size:13px">${escapeHtml(a.title||'Announcement')}</strong><span class="tiny">${escapeHtml(a.courseName||courseName(a.courseId))} · ${fmtDay(a.postedAt)}</span></span>${a.htmlUrl?`<a href="${escapeHtml(a.htmlUrl)}" target="_blank" rel="noreferrer">${icon('external',14)}</a>`:''}</div>`).join('')||'<span class="tiny">No recent announcements returned.</span>'}</div></section><section class="card side-card"><h3>Quick actions</h3><div style="display:grid;gap:8px"><button class="quick-action" data-action="sync">${icon('refresh',18)}<span><strong style="display:block">Sync Quercus</strong><span class="tiny">Refresh every accessible Canvas endpoint</span></span></button><button class="quick-action" data-route="export">${icon('download',18)}<span><strong style="display:block">Export for ChatGPT</strong><span class="tiny">Create a compact context package</span></span></button><button class="quick-action" data-route="diagnostics">${icon('activity',18)}<span><strong style="display:block">Check sync health</strong><span class="tiny">${failures?`${failures} endpoint warnings`:'All endpoint probes healthy'}</span></span></button></div></section></aside></div></div>`;
}

function coursesView() {
  if(!state.snapshot)return `<div class="page-inner">${pageTitle('Courses','Courses, terms, and synced coverage')}${noSnapshot()}</div>`;
  const courses=(state.snapshot.courses||[]).filter(c=>coursePass(c.id)&&matchSearch(c.course_code,c.name,c.term?.name));
  return `<div class="page-inner">${pageTitle('Courses','Courses, terms, and synced coverage',`${courses.length} visible course${courses.length===1?'':'s'}`)}${filterToolbar()}${courses.length?`<div class="course-grid">${courses.map(c=>{const cd=state.snapshot.courseData?.[c.id]||{},grade=(state.snapshot.derived?.grades||[]).find(g=>String(g.courseId)===String(c.id));return `<section class="card course-card" style="--course:${courseColor(c.id)}"><div class="course-card-head"><div>${courseBadge(c)}<h2 style="margin-top:10px">${escapeHtml(c.course_code||`Course ${c.id}`)}</h2></div>${link(c.html_url||`https://q.utoronto.ca/courses/${c.id}`,'Open')}</div><div class="course-card-name">${escapeHtml(c.name||'Untitled course')}</div><div class="course-metrics"><div class="course-metric"><strong>${cd.assignments?.length||0}</strong><span>Assignments</span></div><div class="course-metric"><strong>${cd.modules?.length||0}</strong><span>Modules</span></div><div class="course-metric"><strong>${grade?.currentScore??'—'}</strong><span>Current %</span></div></div><div class="tiny">${escapeHtml(c.term?.name||cd.course?.term?.name||'Term unavailable')}</div></section>`;}).join('')}</div>`:emptyState('No courses match','Try a different search or course filter.')}</div>`;
}
function assignmentRow(a) { return `<div class="assessment-row"><span class="assessment-course-line" style="--course:${courseColor(a.courseId)}"></span><div>${courseBadge(a.courseId,a.courseCode||a.courseName)}<div class="assessment-type">${escapeHtml(a.submissionTypes?.join?.(', ')||'Assignment')}</div></div><div><div class="task-title">${escapeHtml(a.name||'Untitled assignment')}</div>${a.descriptionText?`<div class="task-description">${escapeHtml(a.descriptionText)}</div>`:''}</div><div><strong style="font-size:13px">${fmtDay(a.dueAt)}</strong><div class="tiny">${a.dueAt?new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit'}).format(new Date(a.dueAt)):'No due time'}</div></div><div>${assignmentStatus(a)}</div><div class="muted tiny">${escapeHtml(a.grade??'—')}${a.pointsPossible!=null?` / ${escapeHtml(a.pointsPossible)}`:''}</div><div>${a.htmlUrl?`<a href="${escapeHtml(a.htmlUrl)}" target="_blank" rel="noreferrer">${icon('chevron',17)}</a>`:''}</div></div>`; }
function assignmentsView() {
  if(!state.snapshot)return `<div class="page-inner">${pageTitle('Assignments','Deadlines, submission state, and grades')}${noSnapshot()}</div>`;
  const rows=(state.snapshot.derived?.assignments||[]).filter(a=>coursePass(a.courseId)&&matchSearch(a.courseCode,a.courseName,a.name,a.descriptionText,a.workflowState)),now=Date.now(),attention=rows.filter(a=>a.missing||a.late||(a.dueAt&&Date.parse(a.dueAt)<now&&!a.submitted)),soon=rows.filter(a=>!attention.includes(a)&&a.dueAt&&Date.parse(a.dueAt)>=now&&Date.parse(a.dueAt)<=now+7*86400000),later=rows.filter(a=>!attention.includes(a)&&!soon.includes(a));
  const group=(title,data)=>data.length?`<section class="assessment-group"><h2>${escapeHtml(title)} <span class="status info">${data.length}</span></h2><div class="row-list">${data.map(assignmentRow).join('')}</div></section>`:'';
  return `<div class="page-inner wide">${pageTitle('Assignments','Deadlines, submission state, and grades',`${rows.length} assignment${rows.length===1?'':'s'} in this view`)}${filterToolbar()}${rows.length?`${group('Needs attention',attention)}${group('Next 7 days',soon)}${group('Later / no due date',later)}`:emptyState('No assignments match','Try a different search or course filter.')}</div>`;
}

function calendarView() {
  if(!state.snapshot)return `<div class="page-inner">${pageTitle('Calendar & Planner','Canvas calendar, planner, and to-do items')}${noSnapshot()}</div>`;
  const items=[];
  for(const e of state.snapshot.global?.calendarEvents||[]){const cid=String(e.context_code||'').replace('course_','');items.push({kind:'Event',cls:'event',title:e.title,date:e.start_at||e.end_at,courseId:cid,course:courseName(cid)||e.context_code,url:e.html_url,text:stripHtml(e.description||'')});}
  for(const e of state.snapshot.global?.calendarAssignments||[]){const cid=String(e.context_code||'').replace('course_','');items.push({kind:'Assignment',cls:'assignment',title:e.title,date:e.start_at||e.end_at,courseId:cid,course:courseName(cid)||e.context_code,url:e.html_url,text:stripHtml(e.description||'')});}
  for(const p of state.snapshot.global?.plannerItems||[])items.push({kind:'Planner',cls:'planner',title:p.plannable?.title||p.plannable?.name||p.plannable_type,date:p.plannable_date,courseId:p.course_id,course:p.course_id?courseName(p.course_id):p.context_name,url:p.html_url,text:''});
  for(const t of state.snapshot.global?.todo||[])items.push({kind:'Todo',cls:'todo',title:t.assignment?.name||t.type||'Todo item',date:t.assignment?.due_at,courseId:t.course_id,course:t.course_id?courseName(t.course_id):'',url:t.assignment?.html_url,text:''});
  items.sort((a,b)=>Date.parse(a.date||'9999')-Date.parse(b.date||'9999')); const filtered=items.filter(x=>coursePass(x.courseId)&&matchSearch(x.kind,x.title,x.course,x.text));
  return `<div class="page-inner">${pageTitle('Calendar & Planner','Canvas calendar, planner, and to-do items',`${filtered.length} dated item${filtered.length===1?'':'s'} in this view`)}${filterToolbar()}${filtered.length?`<section class="timeline">${filtered.map(x=>`<div class="timeline-row"><div class="time-label">${fmtDay(x.date)}</div><div class="timeline-block ${x.cls}" style="--course:${courseColor(x.courseId||x.course)}">${x.course?courseBadge(x.courseId||x.course,x.course):''}<strong>${escapeHtml(x.title||'Untitled')}</strong>${x.text?`<span class="muted">${escapeHtml(x.text.slice(0,130))}</span>`:''}<span class="block-time">${x.date?new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit'}).format(new Date(x.date)):''}</span>${x.url?`<a href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">${icon('external',14)}</a>`:''}</div></div>`).join('')}</section>`:emptyState('No calendar items match','Try a different search or course filter.')}</div>`;
}

function announcementsView() {
  if(!state.snapshot)return `<div class="page-inner">${pageTitle('Announcements','Announcements across your courses')}${noSnapshot()}</div>`;
  const rows=(state.snapshot.global?.announcements||[]).filter(a=>{const cid=a.course_id||String(a.context_code||'').replace('course_','');return coursePass(cid)&&matchSearch(a.title,stripHtml(a.message||''),a.author?.display_name,courseName(cid));}).sort((a,b)=>Date.parse(b.posted_at||b.created_at||0)-Date.parse(a.posted_at||a.created_at||0));
  return `<div class="page-inner">${pageTitle('Announcements','Announcements across your courses',`${rows.length} announcement${rows.length===1?'':'s'} in this view`)}${filterToolbar()}${rows.length?`<div class="feed">${rows.map(a=>{const cid=a.course_id||String(a.context_code||'').replace('course_','');return `<article class="feed-item"><div class="feed-head"><div><div style="margin-bottom:8px">${courseBadge(cid,courseName(cid))}</div><h2 class="feed-title">${escapeHtml(a.title||'Untitled announcement')}</h2><div class="tiny">${fmtDate(a.posted_at||a.created_at)}${a.author?.display_name?` · ${escapeHtml(a.author.display_name)}`:''}</div></div>${link(a.html_url)}</div><div class="feed-body">${escapeHtml(stripHtml(a.message||'')).slice(0,6000)}</div></article>`;}).join('')}</div>`:emptyState('No announcements match','Try a different search or course filter.')}</div>`;
}

function modulesView() {
  if(!state.snapshot)return `<div class="page-inner">${pageTitle('Modules','Modules, items, and completion state')}${noSnapshot()}</div>`;
  const blocks=[]; for(const c of state.snapshot.courses||[]){if(!coursePass(c.id))continue;const modules=(state.snapshot.courseData?.[c.id]?.modules||[]).filter(m=>matchSearch(c.course_code,c.name,m.name,...(m.items||[]).map(i=>i.title)));if(!modules.length)continue;blocks.push(`<section class="assessment-group"><h2>${escapeHtml(c.course_code||c.name)} <span class="status info">${modules.length} module${modules.length===1?'':'s'}</span></h2><div class="module-list">${modules.map(m=>`<details><summary><span><strong>${escapeHtml(m.name)}</strong> <span class="tiny">${escapeHtml(m.state||'')}</span></span><span class="status info">${m.items?.length||m.items_count||0} items</span></summary><div class="module-body">${(m.items||[]).map(i=>`<div class="module-item"><div><div class="cell-title">${escapeHtml(i.title)}</div><div class="cell-sub">${escapeHtml(i.type||'Item')}${i.completion_requirement?` · ${i.completion_requirement.completed?'completed':'not completed'}`:''}</div></div>${i.html_url||i.external_url?link(i.html_url||i.external_url):''}</div>`).join('')||'<div class="tiny">No module items returned.</div>'}</div></details>`).join('')}</div></section>`);} return `<div class="page-inner">${pageTitle('Modules','Modules, items, and completion state')}${filterToolbar()}${blocks.length?blocks.join(''):emptyState('No modules match','Try a different search or course filter.')}</div>`;
}

function genericTableView({title,subtitle,columns,rows,rowHtml}) {
  if(!state.snapshot)return `<div class="page-inner wide">${pageTitle(title,subtitle)}${noSnapshot()}</div>`;
  return `<div class="page-inner wide">${pageTitle(title,subtitle,`${rows.length} item${rows.length===1?'':'s'} in this view`)}${filterToolbar()}${rows.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr>${columns.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`:emptyState(`No ${title.toLowerCase()} match`,'Try a different search or course filter.')}</div>`;
}
function pagesView() { const rows=[]; if(state.snapshot)for(const c of state.snapshot.courses||[]){if(!coursePass(c.id))continue;const cd=state.snapshot.courseData?.[c.id]||{};for(const p of cd.pages||[]){const detail=cd.pageDetails?.[p.url]||{},text=stripHtml(detail.body||p.body||'');if(matchSearch(c.course_code,c.name,p.title,text))rows.push({c,p,text});}} return genericTableView({title:'Pages',subtitle:'Course pages and synced page content',columns:['Page','Course','Updated','State',''],rows,rowHtml:({c,p,text})=>`<tr><td><div class="cell-title">${escapeHtml(p.title||'Untitled page')}</div>${text?`<div class="cell-sub">${escapeHtml(text.slice(0,320))}</div>`:''}</td><td>${courseBadge(c)}</td><td class="nowrap">${fmtDate(p.updated_at,true)}</td><td>${p.front_page?status('Front page','info'):p.published===false?status('Unpublished','warning'):status('Published','success')}</td><td>${link(p.html_url)}</td></tr>`}); }function discussionsView() { const rows=[]; if(state.snapshot)for(const c of state.snapshot.courses||[]){if(!coursePass(c.id))continue;for(const d of state.snapshot.courseData?.[c.id]?.discussions||[]){const text=stripHtml(d.message||'');if(matchSearch(c.course_code,c.name,d.title,text))rows.push({c,d,text});}} return genericTableView({title:'Discussions',subtitle:'Discussion topics visible to your account',columns:['Discussion','Course','Posted','Activity',''],rows,rowHtml:({c,d,text})=>`<tr><td><div class="cell-title">${escapeHtml(d.title||'Untitled discussion')}</div>${text?`<div class="cell-sub">${escapeHtml(text.slice(0,260))}</div>`:''}</td><td>${courseBadge(c)}</td><td class="nowrap">${fmtDate(d.posted_at,true)}</td><td>${d.unread_count?status(`${d.unread_count} unread`,'info'):status('No unread','success')}</td><td>${link(d.html_url)}</td></tr>`}); }
function quizzesView() { const rows=[]; if(state.snapshot)for(const c of state.snapshot.courses||[]){if(!coursePass(c.id))continue;for(const q of state.snapshot.courseData?.[c.id]?.quizzes||[]){const text=stripHtml(q.description||'');if(matchSearch(c.course_code,c.name,q.title,q.quiz_type,text))rows.push({c,q,text});}} return genericTableView({title:'Quizzes',subtitle:'Quiz metadata visible through Canvas',columns:['Quiz','Course','Due','Points','Time limit',''],rows,rowHtml:({c,q,text})=>`<tr><td><div class="cell-title">${escapeHtml(q.title||`Quiz ${q.id}`)}</div>${text?`<div class="cell-sub">${escapeHtml(text.slice(0,260))}</div>`:''}</td><td>${courseBadge(c)}</td><td class="nowrap">${fmtDate(q.due_at,true)}</td><td>${escapeHtml(q.points_possible??'—')}</td><td>${q.time_limit?`${escapeHtml(q.time_limit)} min`:'—'}</td><td>${link(q.html_url)}</td></tr>`}); }
function filesView() { const rows=[]; if(state.snapshot)for(const c of state.snapshot.courses||[]){if(!coursePass(c.id))continue;for(const f of state.snapshot.courseData?.[c.id]?.files||[])if(matchSearch(c.course_code,c.name,f.display_name,f.filename,f['content-type']))rows.push({c,f});} return genericTableView({title:'Files',subtitle:'Course file metadata and direct downloads',columns:['File','Course','Type','Size','Updated',''],rows,rowHtml:({c,f})=>`<tr><td><div class="cell-title">${escapeHtml(f.display_name||f.filename||`File ${f.id}`)}</div><div class="cell-sub mono">ID ${escapeHtml(f.id)}</div></td><td>${courseBadge(c)}</td><td>${escapeHtml(f['content-type']||'—')}</td><td class="nowrap">${fmtBytes(f.size)}</td><td class="nowrap">${fmtDate(f.updated_at,true)}</td><td><a class="secondary-btn" href="/api/files/${encodeURIComponent(f.id)}/download">${icon('download',14)} Download</a></td></tr>`}); }

function messagesView() {
  if(!state.snapshot)return `<div class="page-inner wide">${pageTitle('Messages','Canvas Inbox conversations returned by your account')}${noSnapshot()}</div>`;

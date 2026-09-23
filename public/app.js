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

function navItem(route) { const meta=VIEWS.find(v=>v[0]===route),active=state.route===route; return `<button class="nav-item ${active?'active':''}" data-route="${route}" aria-current="${active?'page':'false'}"><span class="nav-icon">${icon+aeta[3])}</span><span class="nav-label">${escapeHtml(meta[1])}</span></button>`; }
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

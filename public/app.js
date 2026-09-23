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

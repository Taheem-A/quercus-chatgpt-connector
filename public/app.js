const VIEWS = [
  ['overview', '⌂', 'Overview', 'Your latest Quercus snapshot'],
  ['courses', '▦', 'Courses', 'Courses, terms, and synced coverage'],
  ['assignments', '✓', 'Assignments', 'Deadlines, status, submissions, and grades'],
  ['calendar', '◫', 'Calendar & Planner', 'Canvas calendar, planner, and to-do items'],
  ['announcements', '◉', 'Announcements', 'Announcements across all courses'],
  ['modules', '≡', 'Modules', 'Modules, items, and completion state'],
  ['pages', '▤', 'Pages', 'Course pages and synced page content'],
  ['discussions', '◌', 'Discussions', 'Discussion topics visible to your account'],
  ['quizzes', '◈', 'Quizzes', 'Classic quiz metadata visible through Canvas'],
  ['messages', '✉', 'Messages', 'Canvas inbox conversations returned by your account'],
  ['grades', '▥', 'Grades & Submissions', 'Course grade summaries and submission history'],
  ['files', '⌑', 'Files', 'Course file metadata and direct downloads'],
  ['diagnostics', '◇', 'Diagnostics', 'Endpoint coverage, failures, and sync health'],
  ['raw', '⌘', 'Raw API', 'Run a read-only Canvas GET request locally'],
  ['export', '⇩', 'Export', 'JSON, CSV bundle, Markdown, ICS, and ChatGPT context'],
  ['settings', '⚙', 'Settings', 'Local-only Quercus credentials and connection status'],
];

const state = {
  view: location.hash.replace('#', '') || 'overview',
  snapshot: null,
  settings: null,
  status: null,
  search: '',
  course: 'all',
  syncTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const content = $('#content');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stripHtml(html = '') {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
function fmtDate(v, compact = false) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('en-CA', compact
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
function fmtBytes(n) {
  const value = Number(n || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = value, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function matchSearch(...values) {
  if (!state.search) return true;
  const hay = values.flat().filter(Boolean).join(' ').toLowerCase();
  return hay.includes(state.search.toLowerCase());
}
function coursePass(id) { return state.course === 'all' || String(id) === String(state.course); }
function courseById(id) { return (state.snapshot?.courses || []).find(c => String(c.id) === String(id)) || {}; }
function courseName(id) { const c = courseById(id); return c.course_code || c.name || `Course ${id}`; }
function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastStack').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || body || `HTTP ${res.status}`);
  return body;
}
function link(url, label = 'Open') {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : '—';
}
function badge(text, kind = '') { return `<span class="badge ${kind}">${escapeHtml(text)}</span>`; }
function empty(title, detail = '') { return `<div class="empty"><div><strong>${escapeHtml(title)}</strong><div>${escapeHtml(detail)}</div></div></div>`; }

function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([id, icon, label]) => `
    <button class="nav-button ${state.view === id ? 'active' : ''}" data-view="${id}">
      <span class="nav-icon">${icon}</span><span>${escapeHtml(label)}</span>
    </button>`).join('');
  $('#nav').querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
}

function navigate(view) {
  state.view = VIEWS.some(v => v[0] === view) ? view : 'overview';
  location.hash = state.view;
  const meta = VIEWS.find(v => v[0] === state.view);
  $('#viewTitle').textContent = meta[2];
  $('#viewSubtitle').textContent = meta[3];
  renderNav();
  render();
  document.querySelector('.sidebar').classList.remove('open');
}

function populateCourseFilter() {
  const sel = $('#courseFilter');
  const old = state.course;
  sel.innerHTML = `<option value="all">All courses</option>` + (state.snapshot?.courses || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.course_code || c.name)}</option>`).join('');
  if ([...sel.options].some(o => o.value === old)) sel.value = old;
  else { state.course = 'all'; sel.value = 'all'; }
}

function updateConnection() {
  const pill = $('#connectionPill');
  if (state.settings?.configured) {
    pill.className = 'connection-pill ok';
    pill.innerHTML = `<span class="dot"></span><span>Quercus token configured</span>`;
  } else {
    pill.className = 'connection-pill bad';
    pill.innerHTML = `<span class="dot"></span><span>Token not configured</span>`;
  }
}

async function loadAll() {
  try {
    const [settings, status] = await Promise.all([api('/api/settings'), api('/api/status')]);
    state.settings = settings;
    state.status = status;
    updateConnection();
    try { state.snapshot = await api('/api/snapshot'); } catch { state.snapshot = null; }
    populateCourseFilter();
    render();
    if (status.sync?.running) beginSyncPolling();
  } catch (err) {
    content.innerHTML = `<div class="callout danger">Could not connect to the local server: ${escapeHtml(err.message)}</div>`;
  }
}

function noSnapshot() {
  if (!state.settings?.configured) return `
    <div class="callout warning"><strong>Connect Quercus first.</strong><br>Open Settings, paste your personal Canvas access token, save it locally, then run your first sync.</div>
    <div class="section">${empty('No snapshot yet', 'Once your token is configured, click Sync Quercus.')}</div>`;
  return `<div class="section">${empty('No snapshot yet', 'Click Sync Quercus to build your first local snapshot.')}</div>`;
}

function metric(label, value, meta = '') {
  return `<div class="card metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="meta">${escapeHtml(meta)}</div></div>`;
}

function statusBadge(a) {
  if (a.excused) return badge('Excused');
  if (a.missing) return badge('Missing', 'danger');
  if (a.late) return badge('Late', 'warning');
  if (a.submitted) return badge('Submitted', 'success');
  return badge('Not submitted');
}

function overviewView() {
  if (!state.snapshot) return noSnapshot();
  const s = state.snapshot, d = s.derived || {}, c = d.counts || {};
  const failures = s.meta?.failedEndpoints || 0;
  const last = fmtDate(s.meta?.completedAt || s.meta?.startedAt);
  const urgent = (d.overdueAssignments || []).filter(a => coursePass(a.courseId)).slice(0, 12);
  const upcoming = (d.upcomingAssignments || []).filter(a => coursePass(a.courseId)).slice(0, 14);
  const announcements = (d.recentAnnouncements || []).filter(a => coursePass(a.courseId)).slice(0, 10);
  return `
    <div class="grid cards-4">
      ${metric('Courses', c.courses ?? s.courses?.length ?? 0, `Last sync ${last}`)}
      ${metric('Due next 7 days', c.upcoming ?? 0, 'Across synced courses')}
      ${metric('Overdue / missing', c.overdue ?? 0, 'Derived from due dates + submissions')}
      ${metric('Synced files', c.files ?? 0, failures ? `${failures} endpoint probes unavailable` : 'No endpoint failures')}
    </div>
    <section class="section">
      <div class="section-header"><div><h2 class="section-title">Needs attention</h2><div class="section-description">Missing or overdue work detected from the latest snapshot.</div></div></div>
      <div class="card list">${urgent.length ? urgent.map(a => `<div class="list-item"><div class="list-main"><div class="list-title">${escapeHtml(a.courseCode || a.courseName)} · ${escapeHtml(a.name)}</div><div class="list-meta">Due ${fmtDate(a.dueAt)} · ${escapeHtml(a.workflowState || 'not submitted')}</div></div><div>${link(a.htmlUrl)}</div></div>`).join('') : `<div class="list-item"><div class="text-success">No overdue or missing work detected.</div></div>`}</div>
    </section>
    <div class="grid two section">
      <section>
        <div class="section-header"><div><h2 class="section-title">Due in the next 7 days</h2><div class="section-description">Sorted by due date.</div></div></div>
        <div class="card list">${upcoming.length ? upcoming.map(a => `<div class="list-item"><div class="list-main"><div class="list-title">${escapeHtml(a.name)}</div><div class="list-meta">${escapeHtml(a.courseCode || a.courseName)} · ${fmtDate(a.dueAt)}</div></div>${statusBadge(a)}</div>`).join('') : `<div class="list-item"><div class="muted">Nothing due in the next seven days.</div></div>`}</div>
      </section>
      <section>
        <div class="section-header"><div><h2 class="section-title">Recent announcements</h2><div class="section-description">Posted within the last 14 days.</div></div></div>
        <div class="card list">${announcements.length ? announcements.map(a => `<div class="list-item"><div class="list-main"><div class="list-title">${escapeHtml(a.title)}</div><div class="list-meta">${escapeHtml(a.courseName || '')} · ${fmtDate(a.postedAt)}</div></div>${link(a.htmlUrl)}</div>`).join('') : `<div class="list-item"><div class="muted">No recent announcements returned.</div></div>`}</div>
      </section>
    </div>
  `;
}

function coursesView() {
  if (!state.snapshot) return noSnapshot();
  const courses = (state.snapshot.courses || []).filter(c => coursePass(c.id) && matchSearch(c.course_code, c.name, c.term?.name));
  if (!courses.length) return empty('No courses match', 'Try a different search or course filter.');
  return `<div class="grid cards-3">${courses.map(c => {
    const cd = state.snapshot.courseData?.[c.id] || {};
    const grade = (state.snapshot.derived?.grades || []).find(g => String(g.courseId) === String(c.id));
    return `<div class="card course-card">
      <div><div class="course-code">${escapeHtml(c.course_code || `Course ${c.id}`)}</div><div class="course-name">${escapeHtml(c.name || 'Untitled course')}</div></div>
      <div class="course-stats">
        <div class="course-stat"><strong>${cd.assignments?.length || 0}</strong><span>Assignments</span></div>
        <div class="course-stat"><strong>${cd.modules?.length || 0}</strong><span>Modules</span></div>
        <div class="course-stat"><strong>${grade?.currentScore ?? '—'}</strong><span>Current %</span></div>
      </div>
      <div class="small muted">${escapeHtml(c.term?.name || cd.course?.term?.name || 'Term unavailable')}</div>
      <div class="actions">${link(c.html_url || `https://q.utoronto.ca/courses/${c.id}`, 'Open in Quercus')}</div>
    </div>`;
  }).join('')}</div>`;
}

function assignmentsView() {
  if (!state.snapshot) return noSnapshot();
  const rows = (state.snapshot.derived?.assignments || []).filter(a => coursePass(a.courseId) && matchSearch(a.courseCode, a.courseName, a.name, a.descriptionText, a.workflowState));
  if (!rows.length) return empty('No assignments match', 'Try a different search or course filter.');
  return `<div class="table-wrap"><table><thead><tr><th>Assignment</th><th>Course</th><th>Due</th><th>Status</th><th>Grade</th><th>Points</th><th></th></tr></thead><tbody>
    ${rows.map(a => `<tr><td><div class="cell-title">${escapeHtml(a.name)}</div>${a.descriptionText ? `<div class="cell-sub">${escapeHtml(a.descriptionText.slice(0, 220))}</div>` : ''}</td><td class="nowrap">${escapeHtml(a.courseCode || a.courseName)}</td><td class="nowrap">${fmtDate(a.dueAt, true)}</td><td>${statusBadge(a)}</td><td>${escapeHtml(a.grade ?? '—')}</td><td>${escapeHtml(a.pointsPossible ?? '—')}</td><td>${link(a.htmlUrl)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function calendarView() {
  if (!state.snapshot) return noSnapshot();
  const items = [];
  for (const e of state.snapshot.global?.calendarEvents || []) items.push({ kind: 'Event', title: e.title, date: e.start_at || e.end_at, course: e.context_code, url: e.html_url, text: stripHtml(e.description || '') });
  for (const e of state.snapshot.global?.calendarAssignments || []) items.push({ kind: 'Assignment', title: e.title, date: e.start_at || e.end_at, course: e.context_code, url: e.html_url, text: stripHtml(e.description || '') });
  for (const p of state.snapshot.global?.plannerItems || []) items.push({ kind: 'Planner', title: p.plannable?.title || p.plannable?.name || p.plannable_type, date: p.plannable_date, course: p.course_id ? courseName(p.course_id) : p.context_name, url: p.html_url, text: '' });
  for (const t of state.snapshot.global?.todo || []) items.push({ kind: 'Todo', title: t.assignment?.name || t.type || 'Todo item', date: t.assignment?.due_at, course: t.course_id ? courseName(t.course_id) : '', url: t.assignment?.html_url, text: '' });
  items.sort((a,b) => Date.parse(a.date || '9999') - Date.parse(b.date || '9999'));
  const filtered = items.filter(x => matchSearch(x.kind, x.title, x.course, x.text) && (state.course === 'all' || String(x.course).includes(String(state.course)) || x.course === courseName(state.course)));
  return filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Item</th><th>Course / context</th><th>Date</th><th></th></tr></thead><tbody>${filtered.map(x => `<tr><td>${badge(x.kind, x.kind === 'Assignment' ? 'info' : '')}</td><td><div class="cell-title">${escapeHtml(x.title || 'Untitled')}</div>${x.text ? `<div class="cell-sub">${escapeHtml(x.text.slice(0, 260))}</div>` : ''}</td><td>${escapeHtml(x.course || '—')}</td><td class="nowrap">${fmtDate(x.date, true)}</td><td>${link(x.url)}</td></tr>`).join('')}</tbody></table></div>` : empty('No calendar items match');
}

function announcementsView() {
  if (!state.snapshot) return noSnapshot();
  const rows = (state.snapshot.global?.announcements || []).filter(a => {
    const cid = a.course_id || String(a.context_code || '').replace('course_', '');
    return coursePass(cid) && matchSearch(a.title, stripHtml(a.message || ''), a.author?.display_name, courseName(cid));
  }).sort((a,b) => Date.parse(b.posted_at || b.created_at || 0) - Date.parse(a.posted_at || a.created_at || 0));
  return rows.length ? `<div class="grid">${rows.map(a => {
    const cid = a.course_id || String(a.context_code || '').replace('course_', '');
    return `<article class="card pad"><div class="section-header"><div><h2 class="section-title">${escapeHtml(a.title || 'Untitled announcement')}</h2><div class="section-description">${escapeHtml(courseName(cid))} · ${fmtDate(a.posted_at || a.created_at)}${a.author?.display_name ? ` · ${escapeHtml(a.author.display_name)}` : ''}</div></div><div>${link(a.html_url)}</div></div><div class="small" style="line-height:1.6;color:#c5cbd2">${escapeHtml(stripHtml(a.message || '')).slice(0, 6000)}</div></article>`;
  }).join('')}</div>` : empty('No announcements match');
}

function modulesView() {
  if (!state.snapshot) return noSnapshot();
  const blocks = [];
  for (const c of state.snapshot.courses || []) {
    if (!coursePass(c.id)) continue;
    const mods = (state.snapshot.courseData?.[c.id]?.modules || []).filter(m => matchSearch(c.course_code, c.name, m.name, ...(m.items || []).map(i => i.title)));
    if (!mods.length) continue;
    blocks.push(`<section class="section"><div class="section-header"><div><h2 class="section-title">${escapeHtml(c.course_code || c.name)}</h2><div class="section-description">${mods.length} module${mods.length === 1 ? '' : 's'}</div></div></div><div class="accordion">${mods.map(m => `<details><summary><span><strong>${escapeHtml(m.name)}</strong> <span class="muted small">${escapeHtml(m.state || '')}</span></span><span class="badge">${m.items?.length || m.items_count || 0} items</span></summary><div class="details-body">${(m.items || []).map(i => `<div class="module-item"><div><div class="cell-title">${escapeHtml(i.title)}</div><div class="cell-sub">${escapeHtml(i.type || 'Item')}${i.completion_requirement ? ` · ${i.completion_requirement.completed ? 'completed' : 'not completed'}` : ''}</div></div><div>${link(i.html_url || i.external_url)}</div></div>`).join('') || `<div class="muted small">No module items returned.</div>`}</div></details>`).join('')}</div></section>`);
  }
  return blocks.length ? blocks.join('') : empty('No modules match');
}

function pagesView() {
  if (!state.snapshot) return noSnapshot();
  const rows = [];
  for (const c of state.snapshot.courses || []) {
    if (!coursePass(c.id)) continue;
    const cd = state.snapshot.courseData?.[c.id] || {};
    for (const p of cd.pages || []) {
      const detail = cd.pageDetails?.[p.url] || {};
      const text = stripHtml(detail.body || p.body || '');
      if (!matchSearch(c.course_code, c.name, p.title, text)) continue;
      rows.push({ c, p, text });
    }
  }
  return rows.length ? `<div class="table-wrap"><table><thead><tr><th>Page</th><th>Course</th><th>Updated</th><th>Flags</th><th></th></tr></thead><tbody>${rows.map(({c,p,text}) => `<tr><td><div class="cell-title">${escapeHtml(p.title)}</div>${text ? `<div class="cell-sub">${escapeHtml(text.slice(0, 320))}</div>` : ''}</td><td>${escapeHtml(c.course_code || c.name)}</td><td class="nowrap">${fmtDate(p.updated_at, true)}</td><td>${p.front_page ? badge('Front page', 'info') : ''} ${p.published === false ? badge('Unpublished') : ''}</td><td>${link(p.html_url)}</td></tr>`).join('')}</tbody></table></div>` : empty('No pages match');
}

function discussionsView() {
  if (!state.snapshot) return noSnapshot();
  const rows = [];
  for (const c of state.snapshot.courses || []) {
    if (!coursePass(c.id)) continue;
    for (const d of state.snapshot.courseData?.[c.id]?.discussions || []) {
      const text = stripHtml(d.message || '');
      if (!matchSearch(c.course_code, c.name, d.title, text)) continue;
      rows.push({ c, d, text });
    }
  }
  return rows.length ? `<div class="table-wrap"><table><thead><tr><th>Discussion</th><th>Course</th><th>Posted</th><th>Activity</th><th></th></tr></thead><tbody>${rows.map(({c,d,text}) => `<tr><td><div class="cell-title">${escapeHtml(d.title)}</div>${text ? `<div class="cell-sub">${escapeHtml(text.slice(0, 260))}</div>` : ''}</td><td>${escapeHtml(c.course_code || c.name)}</td><td class="nowrap">${fmtDate(d.posted_at, true)}</td><td>${d.unread_count ? badge(`${d.unread_count} unread`, 'info') : badge('No unread')}</td><td>${link(d.html_url)}</td></tr>`).join('')}</tbody></table></div>` : empty('No discussions match');
}


function quizzesView() {
  if (!state.snapshot) return noSnapshot();
  const rows = [];
  for (const c of state.snapshot.courses || []) {
    if (!coursePass(c.id)) continue;
    for (const q of state.snapshot.courseData?.[c.id]?.quizzes || []) {
      const text = stripHtml(q.description || '');
      if (!matchSearch(c.course_code, c.name, q.title, q.quiz_type, text)) continue;
      rows.push({ c, q, text });
    }
  }
  return rows.length ? `<div class="table-wrap"><table><thead><tr><th>Quiz</th><th>Course</th><th>Due</th><th>Points</th><th>Time limit</th><th></th></tr></thead><tbody>${rows.map(({c,q,text}) => `<tr><td><div class="cell-title">${escapeHtml(q.title || `Quiz ${q.id}`)}</div>${text ? `<div class="cell-sub">${escapeHtml(text.slice(0,260))}</div>` : ''}</td><td>${escapeHtml(c.course_code || c.name)}</td><td class="nowrap">${fmtDate(q.due_at, true)}</td><td>${escapeHtml(q.points_possible ?? '—')}</td><td>${q.time_limit ? `${escapeHtml(q.time_limit)} min` : '—'}</td><td>${link(q.html_url)}</td></tr>`).join('')}</tbody></table></div>` : empty('No quizzes match', 'New Quizzes may appear primarily as assignments depending on Canvas configuration.');
}

function messagesView() {
  if (!state.snapshot) return noSnapshot();
  const rows = (state.snapshot.global?.conversations || []).filter(c => matchSearch(c.subject, c.workflow_state, ...(c.participants || []).map(p => p.name), c.last_message));
  return rows.length ? `<div class="table-wrap"><table><thead><tr><th>Conversation</th><th>Participants</th><th>State</th><th>Last message</th><th>Updated</th></tr></thead><tbody>${rows.map(c => `<tr><td><div class="cell-title">${escapeHtml(c.subject || '(no subject)')}</div><div class="cell-sub mono">ID ${escapeHtml(c.id)}</div></td><td>${escapeHtml((c.participants || []).map(p => p.name).filter(Boolean).join(', ') || '—')}</td><td>${badge(c.workflow_state || 'unknown', c.workflow_state === 'read' ? 'success' : '')}</td><td><div class="cell-sub">${escapeHtml(String(c.last_message || '').slice(0,320))}</div></td><td class="nowrap">${fmtDate(c.last_message_at || c.updated_at, true)}</td></tr>`).join('')}</tbody></table></div>` : empty('No conversations returned', 'Your Canvas account may not expose Inbox conversations through this token.');
}

function gradesView() {
  if (!state.snapshot) return noSnapshot();
  const grades = (state.snapshot.derived?.grades || []).filter(g => coursePass(g.courseId) && matchSearch(g.courseCode, g.courseName));
  const submissions = [];
  for (const c of state.snapshot.courses || []) {
    if (!coursePass(c.id)) continue;
    for (const s of state.snapshot.courseData?.[c.id]?.submissions || []) {
      if (!matchSearch(c.course_code, c.name, s.assignment?.name, s.grade, s.workflow_state)) continue;
      submissions.push({ c, s });
    }
  }
  return `
    <div class="grid cards-3">${grades.length ? grades.map(g => `<div class="card pad"><div class="course-code">${escapeHtml(g.courseCode || g.courseName)}</div><div style="font-size:32px;font-weight:750;margin:15px 0 5px">${escapeHtml(g.currentScore ?? '—')}${g.currentScore != null ? '%' : ''}</div><div class="muted small">Current ${escapeHtml(g.currentGrade ?? '—')} · Final ${escapeHtml(g.finalGrade ?? '—')} (${escapeHtml(g.finalScore ?? '—')}%)</div></div>`).join('') : `<div class="callout">Canvas did not return course-level grade summaries for the current filter.</div>`}</div>
    <section class="section"><div class="section-header"><div><h2 class="section-title">Submissions</h2><div class="section-description">Submission records returned by Canvas.</div></div></div>
    ${submissions.length ? `<div class="table-wrap"><table><thead><tr><th>Assignment</th><th>Course</th><th>Status</th><th>Submitted</th><th>Grade</th><th>Score</th><th>Attempt</th></tr></thead><tbody>${submissions.map(({c,s}) => `<tr><td><div class="cell-title">${escapeHtml(s.assignment?.name || `Assignment ${s.assignment_id}`)}</div></td><td>${escapeHtml(c.course_code || c.name)}</td><td>${s.missing ? badge('Missing','danger') : s.late ? badge('Late','warning') : badge(s.workflow_state || 'Unknown', s.workflow_state === 'graded' ? 'success' : '')}</td><td class="nowrap">${fmtDate(s.submitted_at, true)}</td><td>${escapeHtml(s.grade ?? '—')}</td><td>${escapeHtml(s.score ?? '—')}</td><td>${escapeHtml(s.attempt ?? '—')}</td></tr>`).join('')}</tbody></table></div>` : empty('No submission records match')}</section>`;
}

function filesView() {
  if (!state.snapshot) return noSnapshot();
  const rows = [];
  for (const c of state.snapshot.courses || []) {
    if (!coursePass(c.id)) continue;
    for (const f of state.snapshot.courseData?.[c.id]?.files || []) {
      if (!matchSearch(c.course_code, c.name, f.display_name, f.filename, f['content-type'])) continue;
      rows.push({ c, f });
    }
  }
  return rows.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Course</th><th>Type</th><th>Size</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map(({c,f}) => `<tr><td><div class="cell-title">${escapeHtml(f.display_name || f.filename || `File ${f.id}`)}</div><div class="cell-sub mono">ID ${escapeHtml(f.id)}</div></td><td>${escapeHtml(c.course_code || c.name)}</td><td>${escapeHtml(f['content-type'] || '—')}</td><td class="nowrap">${fmtBytes(f.size)}</td><td class="nowrap">${fmtDate(f.updated_at, true)}</td><td><a href="/api/files/${encodeURIComponent(f.id)}/download">Download</a></td></tr>`).join('')}</tbody></table></div>` : empty('No files match');
}

function diagnosticsView() {
  if (!state.snapshot) return noSnapshot();
  const rows = (state.snapshot.diagnostics || []).filter(d => matchSearch(d.scope, d.name, d.path, d.error, d.status));
  const failed = rows.filter(x => !x.ok).length;
  return `
    <div class="callout ${failed ? 'warning' : ''}">${failed ? `${failed} endpoint probe${failed === 1 ? '' : 's'} unavailable in this filtered view. This is usually a Canvas permission or feature-availability issue; the rest of the sync continues.` : 'All displayed endpoint probes succeeded.'}</div>
    <section class="section"><div class="table-wrap"><table><thead><tr><th>Result</th><th>Endpoint</th><th>Scope</th><th>Count</th><th>Pages</th><th>Time</th><th>Detail</th></tr></thead><tbody>${rows.map(d => `<tr><td>${d.ok ? badge('OK','success') : badge(`HTTP ${d.status || 'ERR'}`,'danger')}</td><td><div class="cell-title">${escapeHtml(d.name)}</div><div class="cell-sub mono">${escapeHtml(d.path)}</div></td><td class="mono">${escapeHtml(d.scope)}</td><td>${escapeHtml(d.count ?? 0)}</td><td>${escapeHtml(d.pages ?? 0)}</td><td>${escapeHtml(d.ms ?? 0)} ms</td><td><div class="cell-sub">${escapeHtml((d.error || d.requestId || '').slice(0, 450))}</div></td></tr>`).join('')}</tbody></table></div></section>`;
}

function rawView() {
  return `
    <div class="callout">This is a local, read-only Canvas API explorer. Use any GET path beginning with <span class="mono">/api/</span>. Your token stays on the local server.</div>
    <section class="section card pad">
      <div class="form-grid">
        <div class="field"><label>Canvas API path</label><input id="rawPath" class="input mono" value="/api/v1/users/self/profile" /><div class="field-help">Example: /api/v1/courses or /api/v1/courses/123/assignments?per_page=100</div></div>
        <div class="actions"><button id="rawOne" class="button primary">Run GET</button><button id="rawAll" class="button">Run GET + pagination</button></div>
        <pre id="rawOutput" class="codebox">No request run yet.</pre>
      </div>
    </section>`;
}

function exportView() {
  if (!state.snapshot) return noSnapshot();
  return `
    <div class="grid cards-3">
      <div class="card export-card"><h3>Export for ChatGPT</h3><p>Compact but comprehensive Markdown with workload, assignments, modules, announcements, pages, discussions, grades, planner data, links, and diagnostics.</p><a class="button primary" href="/api/export/chatgpt">Download .md</a></div>
      <div class="card export-card"><h3>Complete export bundle</h3><p>A ZIP containing the complete JSON snapshot, CSV tables, Markdown summaries, ChatGPT context, and calendar ICS.</p><a class="button primary" href="/api/export/zip">Download .zip</a></div>
      <div class="card export-card"><h3>Complete JSON</h3><p>The full local snapshot with Canvas API objects, course data, diagnostics, and derived views.</p><a class="button" href="/api/export/json">Download .json</a></div>
      <div class="card export-card"><h3>Readable Markdown</h3><p>A human-readable course and workload summary.</p><a class="button" href="/api/export/markdown">Download .md</a></div>
      <div class="card export-card"><h3>Calendar</h3><p>Assignments with due dates plus Canvas calendar events as an importable ICS calendar.</p><a class="button" href="/api/export/ics">Download .ics</a></div>
      <div class="card export-card"><h3>Save into project</h3><p>Writes the full export bundle into the local <span class="mono">exports/</span> folder as individual files plus a ZIP.</p><button id="saveExport" class="button">Save local copy</button></div>
    </div>
    <section class="section"><div class="callout">Exports never include your Canvas access token. Browser downloads normally go to your regular Downloads folder; “Save into project” writes under this app’s <span class="mono">exports/</span> directory.</div></section>`;
}

function settingsView() {
  const configured = state.settings?.configured;
  return `
    <div class="grid two">
      <section class="card pad">
        <div class="section-header"><div><h2 class="section-title">Quercus connection</h2><div class="section-description">Credentials are saved only on this computer.</div></div>${configured ? badge('Configured','success') : badge('Not configured','danger')}</div>
        <form id="settingsForm" class="form-grid">
          <div class="field"><label>Canvas / Quercus base URL</label><input id="baseUrl" class="input" value="${escapeHtml(state.settings?.baseUrl || 'https://q.utoronto.ca')}" /><div class="field-help">For U of T, leave this as https://q.utoronto.ca.</div></div>
          <div class="field"><label>Personal access token</label><input id="token" class="input" type="password" placeholder="${configured ? 'Leave blank to keep the existing token' : 'Paste your Quercus token'}" autocomplete="off" /><div class="field-help">Stored in <span class="mono">.quercus-local.json</span>, which is excluded from Git. Existing <span class="mono">.env.local</span> tokens are detected automatically.</div></div>
          <div class="actions"><button class="button primary" type="submit">Save & verify</button></div>
        </form>
      </section>
      <section class="card pad">
        <h2 class="section-title">Current state</h2>
        <div style="margin-top:14px" class="small">
          <p><strong>Credential source:</strong> ${escapeHtml(state.settings?.source || 'none')}</p>
          <p><strong>Last sync:</strong> ${escapeHtml(state.status?.snapshot?.lastSync ? fmtDate(state.status.snapshot.lastSync) : 'Never')}</p>
          <p><strong>Saved courses:</strong> ${escapeHtml(state.status?.snapshot?.courses ?? 0)}</p>
          <p><strong>Failed endpoint probes:</strong> ${escapeHtml(state.status?.snapshot?.failedEndpoints ?? 0)}</p>
        </div>
        <div class="callout" style="margin-top:16px">The token is never displayed back to the browser after saving. To rotate it, paste a new token and save again.</div>
      </section>
    </div>`;
}

function render() {
  const views = {
    overview: overviewView, courses: coursesView, assignments: assignmentsView,
    calendar: calendarView, announcements: announcementsView, modules: modulesView,
    pages: pagesView, discussions: discussionsView, quizzes: quizzesView, messages: messagesView, grades: gradesView, files: filesView,
    diagnostics: diagnosticsView, raw: rawView, export: exportView, settings: settingsView,
  };
  const fn = views[state.view] || overviewView;
  content.innerHTML = fn();
  bindViewActions();
}

function bindViewActions() {
  $('#settingsForm')?.addEventListener('submit', saveSettings);
  $('#rawOne')?.addEventListener('click', () => runRaw(false));
  $('#rawAll')?.addEventListener('click', () => runRaw(true));
  $('#saveExport')?.addEventListener('click', saveExport);
}

async function saveSettings(ev) {
  ev.preventDefault();
  const button = ev.currentTarget.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await api('/api/settings', { method: 'POST', body: JSON.stringify({ baseUrl: $('#baseUrl').value.trim(), token: $('#token').value.trim() }) });
    toast(`Connected to Quercus${result.user?.name ? ` as ${result.user.name}` : ''}.`, 'success');
    state.settings = await api('/api/settings');
    state.status = await api('/api/status');
    updateConnection();
    render();
  } catch (err) { toast(err.message, 'error'); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = 'Save & verify'; } }
}

async function runRaw(all) {
  const out = $('#rawOutput');
  const path = $('#rawPath').value.trim();
  out.textContent = 'Loading…';
  try {
    const result = await api(`/api/raw?path=${encodeURIComponent(path)}${all ? '&all=1' : ''}`);
    out.textContent = JSON.stringify(result, null, 2);
  } catch (err) { out.textContent = `ERROR\n${err.message}`; }
}

async function saveExport() {
  const btn = $('#saveExport');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const result = await api('/api/export/save', { method: 'POST', body: '{}' });
    toast(`Saved export bundle to ${result.folder}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save local copy'; }
}

async function syncNow() {
  if (!state.settings?.configured) { navigate('settings'); toast('Add your Quercus access token first.', 'error'); return; }
  $('#syncButton').disabled = true;
  try {
    await api('/api/sync', { method: 'POST', body: '{}' });
    toast('Quercus sync started.', 'success');
    beginSyncPolling();
  } catch (err) {
    toast(err.message, 'error');
    $('#syncButton').disabled = false;
  }
}

function showSyncBar(status) {
  const bar = $('#syncBar');
  if (!status.running && status.stage !== 'error') { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#syncMessage').textContent = status.error || status.message || 'Syncing…';
  $('#syncCourse').textContent = status.currentCourse ? `· ${status.currentCourse}` : '';
  $('#syncPercent').textContent = `${status.percent || 0}%`;
  $('#progressFill').style.width = `${Math.max(0, Math.min(100, status.percent || 0))}%`;
}

function beginSyncPolling() {
  if (state.syncTimer) clearInterval(state.syncTimer);
  $('#syncButton').disabled = true;
  const poll = async () => {
    try {
      const s = await api('/api/sync/status');
      showSyncBar(s);
      if (!s.running) {
        clearInterval(state.syncTimer); state.syncTimer = null;
        $('#syncButton').disabled = false;
        if (s.stage === 'done') {
          state.snapshot = await api('/api/snapshot');
          state.status = await api('/api/status');
          populateCourseFilter();
          render();
          toast('Quercus sync complete.', 'success');
        } else if (s.stage === 'error') toast(s.error || 'Sync failed.', 'error');
      }
    } catch (err) {
      clearInterval(state.syncTimer); state.syncTimer = null; $('#syncButton').disabled = false; toast(err.message, 'error');
    }
  };
  poll();
  state.syncTimer = setInterval(poll, 700);
}

$('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('#courseFilter').addEventListener('change', (e) => { state.course = e.target.value; render(); });
$('#syncButton').addEventListener('click', syncNow);
$('#mobileMenu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
window.addEventListener('hashchange', () => navigate(location.hash.replace('#','') || 'overview'));

renderNav();
navigate(state.view);
loadAll();

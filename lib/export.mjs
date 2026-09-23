import path from 'node:path';

function stripHtml(html = '') {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows, columns) {
  const header = columns.map(([key, label]) => csvCell(label || key)).join(',');
  const body = rows.map((row) => columns.map(([key]) => csvCell(row?.[key])).join(',')).join('\r\n');
  return `${header}\r\n${body}${body ? '\r\n' : ''}`;
}

function courseInfo(snapshot, id) {
  return (snapshot.courses || []).find((c) => String(c.id) === String(id)) || {};
}

function flattenAssignments(snapshot) {
  const rows = [];
  for (const course of snapshot.courses || []) {
    const cd = snapshot.courseData?.[course.id] || {};
    for (const a of cd.assignments || []) {
      const sub = a.submission || (cd.submissions || []).find((s) => String(s.assignment_id) === String(a.id)) || {};
      rows.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        assignment_id: a.id,
        name: a.name,
        due_at: a.due_at,
        unlock_at: a.unlock_at,
        lock_at: a.lock_at,
        points_possible: a.points_possible,
        submission_types: a.submission_types,
        published: a.published,
        html_url: a.html_url,
        workflow_state: sub.workflow_state,
        submitted_at: sub.submitted_at,
        score: sub.score,
        grade: sub.grade,
        missing: sub.missing,
        late: sub.late,
        excused: sub.excused,
        description: stripHtml(a.description || ''),
      });
    }
  }
  return rows;
}

function flattenSubmissions(snapshot) {
  const rows = [];
  for (const course of snapshot.courses || []) {
    for (const s of snapshot.courseData?.[course.id]?.submissions || []) {
      rows.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        assignment_id: s.assignment_id,
        user_id: s.user_id,
        workflow_state: s.workflow_state,
        submitted_at: s.submitted_at,
        graded_at: s.graded_at,
        score: s.score,
        grade: s.grade,
        entered_score: s.entered_score,
        entered_grade: s.entered_grade,
        missing: s.missing,
        late: s.late,
        excused: s.excused,
        seconds_late: s.seconds_late,
        attempt: s.attempt,
        submission_type: s.submission_type,
        url: s.url,
      });
    }
  }
  return rows;
}

function flattenAnnouncements(snapshot) {
  return (snapshot.global?.announcements || []).map((a) => ({
    id: a.id,
    context_code: a.context_code,
    course_id: a.course_id,
    title: a.title,
    posted_at: a.posted_at,
    created_at: a.created_at,
    author: a.author?.display_name || a.author?.name,
    html_url: a.html_url,
    message: stripHtml(a.message || ''),
  }));
}

function flattenModules(snapshot) {
  const modules = [];
  const items = [];
  for (const course of snapshot.courses || []) {
    for (const m of snapshot.courseData?.[course.id]?.modules || []) {
      modules.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        module_id: m.id,
        name: m.name,
        position: m.position,
        state: m.state,
        unlock_at: m.unlock_at,
        require_sequential_progress: m.require_sequential_progress,
        items_count: m.items_count ?? (m.items || []).length,
      });
      for (const item of m.items || []) {
        items.push({
          course_id: course.id,
          course_code: course.course_code,
          module_id: m.id,
          module_name: m.name,
          item_id: item.id,
          title: item.title,
          type: item.type,
          position: item.position,
          content_id: item.content_id,
          page_url: item.page_url,
          external_url: item.external_url,
          html_url: item.html_url,
          completion_requirement: item.completion_requirement,
          content_details: item.content_details,
        });
      }
    }
  }
  return { modules, items };
}

function flattenPages(snapshot) {
  const rows = [];
  for (const course of snapshot.courses || []) {
    const cd = snapshot.courseData?.[course.id] || {};
    for (const p of cd.pages || []) {
      const detail = cd.pageDetails?.[p.url] || {};
      rows.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        page_id: p.page_id,
        url: p.url,
        title: p.title,
        created_at: p.created_at,
        updated_at: p.updated_at,
        published: p.published,
        front_page: p.front_page,
        html_url: p.html_url,
        body: stripHtml(detail.body || p.body || ''),
      });
    }
  }
  return rows;
}

function flattenDiscussions(snapshot) {
  const rows = [];
  for (const course of snapshot.courses || []) {
    for (const d of snapshot.courseData?.[course.id]?.discussions || []) {
      rows.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        discussion_id: d.id,
        title: d.title,
        posted_at: d.posted_at,
        last_reply_at: d.last_reply_at,
        discussion_type: d.discussion_type,
        unread_count: d.unread_count,
        locked: d.locked,
        pinned: d.pinned,
        html_url: d.html_url,
        message: stripHtml(d.message || ''),
      });
    }
  }
  return rows;
}

function flattenFiles(snapshot) {
  const rows = [];
  for (const course of snapshot.courses || []) {
    for (const f of snapshot.courseData?.[course.id]?.files || []) {
      rows.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        file_id: f.id,
        folder_id: f.folder_id,
        display_name: f.display_name,
        filename: f.filename,
        content_type: f['content-type'],
        size: f.size,
        created_at: f.created_at,
        updated_at: f.updated_at,
        locked: f.locked,
        hidden: f.hidden,
        hidden_for_user: f.hidden_for_user,
        html_url: f.html_url,
        download_url: f.url,
      });
    }
  }
  return rows;
}

function flattenQuizzes(snapshot) {
  const rows = [];
  for (const course of snapshot.courses || []) {
    for (const q of snapshot.courseData?.[course.id]?.quizzes || []) {
      rows.push({
        course_id: course.id,
        course_code: course.course_code,
        course_name: course.name,
        quiz_id: q.id,
        title: q.title,
        quiz_type: q.quiz_type,
        assignment_id: q.assignment_id,
        time_limit: q.time_limit,
        due_at: q.due_at,
        unlock_at: q.unlock_at,
        lock_at: q.lock_at,
        points_possible: q.points_possible,
        published: q.published,
        html_url: q.html_url,
        description: stripHtml(q.description || ''),
      });
    }
  }
  return rows;
}

function flattenCalendar(snapshot) {
  const all = [...(snapshot.global?.calendarEvents || []), ...(snapshot.global?.calendarAssignments || [])];
  return all.map((e) => ({
    id: e.id,
    type: e.type,
    title: e.title,
    context_code: e.context_code,
    start_at: e.start_at,
    end_at: e.end_at,
    all_day: e.all_day,
    workflow_state: e.workflow_state,
    html_url: e.html_url,
    description: stripHtml(e.description || ''),
  }));
}

function flattenPlanner(snapshot) {
  return (snapshot.global?.plannerItems || []).map((p) => ({
    course_id: p.course_id,
    context_type: p.context_type,
    context_name: p.context_name,
    plannable_type: p.plannable_type,
    plannable_id: p.plannable_id,
    plannable_date: p.plannable_date,
    html_url: p.html_url,
    new_activity: p.new_activity,
    submissions: p.submissions,
    plannable: p.plannable,
  }));
}

function escapeIcs(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function makeIcs(snapshot) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Quercus Local//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const a of snapshot.derived?.assignments || []) {
    if (!a.dueAt) continue;
    const dt = icsDate(a.dueAt);
    if (!dt) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:assignment-${a.courseId}-${a.id}@quercus-local`);
    lines.push(`DTSTAMP:${icsDate(snapshot.meta?.completedAt || new Date())}`);
    lines.push(`DTSTART:${dt}`);
    lines.push(`DTEND:${dt}`);
    lines.push(`SUMMARY:${escapeIcs(`${a.courseCode || a.courseName || 'Course'} — ${a.name}`)}`);
    if (a.descriptionText) lines.push(`DESCRIPTION:${escapeIcs(a.descriptionText.slice(0, 2000))}`);
    if (a.htmlUrl) lines.push(`URL:${escapeIcs(a.htmlUrl)}`);
    lines.push('END:VEVENT');
  }
  for (const e of snapshot.global?.calendarEvents || []) {
    const start = icsDate(e.start_at || e.end_at);
    if (!start) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:calendar-${e.id}@quercus-local`);
    lines.push(`DTSTAMP:${icsDate(snapshot.meta?.completedAt || new Date())}`);
    lines.push(`DTSTART:${start}`);
    const end = icsDate(e.end_at);
    if (end) lines.push(`DTEND:${end}`);
    lines.push(`SUMMARY:${escapeIcs(e.title || 'Canvas event')}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeIcs(stripHtml(e.description).slice(0, 2000))}`);
    if (e.html_url) lines.push(`URL:${escapeIcs(e.html_url)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
}

export function makeMarkdown(snapshot, { chatgpt = false } = {}) {
  const d = snapshot.derived || {};
  const lines = [];
  lines.push(`# ${chatgpt ? 'Quercus Context for ChatGPT' : 'Quercus Local Snapshot'}`);
  lines.push('');
  lines.push(`Synced: ${snapshot.meta?.completedAt || snapshot.meta?.startedAt || 'unknown'}`);
  lines.push(`Courses: ${snapshot.courses?.length || 0} · Assignments: ${d.counts?.assignments || 0} · Failed endpoint probes: ${snapshot.meta?.failedEndpoints || 0}`);
  lines.push('');

  if (chatgpt) {
    lines.push('> This file was generated from the user\'s Canvas/Quercus API snapshot. Treat it as the authoritative course-state export for this sync time. Some API endpoints may be unavailable due to Canvas permissions; see Diagnostics near the end.');
    lines.push('');
  }

  lines.push('## Immediate workload');
  lines.push('');
  lines.push('### Overdue / missing');
  if (!(d.overdueAssignments || []).length) lines.push('- None detected.');
  for (const a of d.overdueAssignments || []) lines.push(`- **${a.courseCode || a.courseName}** — ${a.name} — due ${fmtDate(a.dueAt)} — status: ${a.workflowState || 'not submitted'}${a.htmlUrl ? ` — ${a.htmlUrl}` : ''}`);
  lines.push('');
  lines.push('### Due in the next 7 days');
  if (!(d.upcomingAssignments || []).length) lines.push('- None detected.');
  for (const a of d.upcomingAssignments || []) lines.push(`- **${a.courseCode || a.courseName}** — ${a.name} — due ${fmtDate(a.dueAt)} — ${a.submitted ? 'submitted' : 'not submitted'}${a.htmlUrl ? ` — ${a.htmlUrl}` : ''}`);
  lines.push('');

  lines.push('## Courses');
  lines.push('');
  for (const course of snapshot.courses || []) {
    const cd = snapshot.courseData?.[course.id] || {};
    lines.push(`### ${course.course_code || course.name}`);
    lines.push('');
    lines.push(`- Name: ${course.name || '—'}`);
    lines.push(`- Course ID: ${course.id}`);
    lines.push(`- Term: ${course.term?.name || cd.course?.term?.name || '—'}`);
    lines.push(`- Canvas URL: ${course.html_url || `https://q.utoronto.ca/courses/${course.id}`}`);
    if (cd.course?.syllabus_body) lines.push(`- Syllabus: ${stripHtml(cd.course.syllabus_body).slice(0, chatgpt ? 8000 : 3000)}`);
    lines.push('');

    lines.push('#### Assignments');
    const assignments = (d.assignments || []).filter((a) => String(a.courseId) === String(course.id));
    if (!assignments.length) lines.push('- No assignments returned.');
    for (const a of assignments) {
      lines.push(`- ${a.name} | due: ${fmtDate(a.dueAt)} | status: ${a.excused ? 'excused' : a.submitted ? 'submitted' : a.missing ? 'missing/overdue' : 'not submitted'} | grade: ${a.grade ?? '—'} / ${a.pointsPossible ?? '—'}${a.htmlUrl ? ` | ${a.htmlUrl}` : ''}`);
      if (chatgpt && a.descriptionText) lines.push(`  - Description: ${a.descriptionText.slice(0, 2500)}`);
    }
    lines.push('');

    lines.push('#### Modules');
    if (!(cd.modules || []).length) lines.push('- No modules returned.');
    for (const mod of cd.modules || []) {
      lines.push(`- **${mod.name}** (${mod.state || 'unknown'})`);
      for (const item of mod.items || []) lines.push(`  - ${item.title} [${item.type}]${item.html_url ? ` — ${item.html_url}` : ''}`);
    }
    lines.push('');

    lines.push('#### Announcements');
    if (!(cd.announcements || []).length) lines.push('- No announcements returned.');
    for (const a of cd.announcements || []) lines.push(`- ${a.title} — ${fmtDate(a.posted_at || a.created_at)} — ${stripHtml(a.message || '').slice(0, chatgpt ? 1800 : 700)}`);
    lines.push('');

    if (chatgpt) {
      lines.push('#### Pages');
      if (!(cd.pages || []).length) lines.push('- No pages returned.');
      for (const p of cd.pages || []) {
        const body = stripHtml(cd.pageDetails?.[p.url]?.body || '');
        lines.push(`- ${p.title}${p.html_url ? ` — ${p.html_url}` : ''}${body ? `\n  - ${body.slice(0, 2200)}` : ''}`);
      }
      lines.push('');

      lines.push('#### Discussions');
      if (!(cd.discussions || []).length) lines.push('- No discussions returned.');
      for (const x of cd.discussions || []) lines.push(`- ${x.title} — ${fmtDate(x.posted_at)} — ${stripHtml(x.message || '').slice(0, 1200)}${x.html_url ? ` — ${x.html_url}` : ''}`);
      lines.push('');
    }
  }

  lines.push('## Recent announcements');
  lines.push('');
  for (const a of d.recentAnnouncements || []) lines.push(`- **${a.courseName || a.courseId}** — ${a.title} — ${fmtDate(a.postedAt)} — ${a.messageText.slice(0, 1000)}${a.htmlUrl ? ` — ${a.htmlUrl}` : ''}`);
  if (!(d.recentAnnouncements || []).length) lines.push('- None returned in the last 14 days.');
  lines.push('');

  lines.push('## Grades');
  lines.push('');
  if (!(d.grades || []).length) lines.push('- Grade summaries were not returned.');
  for (const g of d.grades || []) lines.push(`- **${g.courseCode || g.courseName}** — current: ${g.currentGrade ?? '—'} (${g.currentScore ?? '—'}%) · final: ${g.finalGrade ?? '—'} (${g.finalScore ?? '—'}%)`);
  lines.push('');

  lines.push('## Calendar / planner / todo');
  lines.push('');
  for (const p of snapshot.global?.plannerItems || []) lines.push(`- Planner: ${p.context_name || p.course_id || p.context_type || 'Canvas'} — ${p.plannable?.title || p.plannable?.name || p.plannable_type || 'item'} — ${fmtDate(p.plannable_date)}${p.html_url ? ` — ${p.html_url}` : ''}`);
  for (const t of snapshot.global?.todo || []) lines.push(`- Todo: ${t.assignment?.name || t.type || 'item'} — ${fmtDate(t.assignment?.due_at)}${t.assignment?.html_url ? ` — ${t.assignment.html_url}` : ''}`);
  lines.push('');

  lines.push('## Diagnostics');
  lines.push('');
  const failures = (snapshot.diagnostics || []).filter((x) => !x.ok);
  if (!failures.length) lines.push('- No endpoint failures recorded.');
  for (const f of failures) lines.push(`- ${f.name}: HTTP ${f.status || 'error'} — ${String(f.error || 'Unavailable').slice(0, 800)}`);
  lines.push('');

  if (chatgpt) {
    lines.push('## Notes for analysis');
    lines.push('');
    lines.push('- Assignment status is derived from Canvas submission state when available.');
    lines.push('- “Overdue / missing” includes assignments whose due date passed without a detected submission, unless excused.');
    lines.push('- A failed endpoint probe usually means the student account lacks permission or that feature is not enabled; it does not invalidate other synced data.');
  }

  return lines.join('\n');
}

// Minimal uncompressed ZIP writer (STORE method). No dependencies required.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const d = new Date(date);
  const year = Math.max(1980, d.getFullYear());
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralData, end]);
}

export function exportFiles(snapshot) {
  const assignments = flattenAssignments(snapshot);
  const submissions = flattenSubmissions(snapshot);
  const announcements = flattenAnnouncements(snapshot);
  const { modules, items: moduleItems } = flattenModules(snapshot);
  const pages = flattenPages(snapshot);
  const discussions = flattenDiscussions(snapshot);
  const files = flattenFiles(snapshot);
  const quizzes = flattenQuizzes(snapshot);
  const calendar = flattenCalendar(snapshot);
  const planner = flattenPlanner(snapshot);
  const courses = (snapshot.courses || []).map((c) => ({
    id: c.id,
    course_code: c.course_code,
    name: c.name,
    workflow_state: c.workflow_state,
    enrollment_term_id: c.enrollment_term_id,
    term_name: c.term?.name,
    start_at: c.start_at,
    end_at: c.end_at,
    time_zone: c.time_zone,
    html_url: c.html_url,
  }));
  const diagnostics = snapshot.diagnostics || [];

  return [
    { name: 'snapshot.json', data: JSON.stringify(snapshot, null, 2) + '\n' },
    { name: 'summary.md', data: makeMarkdown(snapshot) + '\n' },
    { name: 'chatgpt-context.md', data: makeMarkdown(snapshot, { chatgpt: true }) + '\n' },
    { name: 'calendar.ics', data: makeIcs(snapshot) },
    { name: 'csv/courses.csv', data: toCsv(courses, [['id'], ['course_code'], ['name'], ['workflow_state'], ['term_name'], ['start_at'], ['end_at'], ['time_zone'], ['html_url']]) },
    { name: 'csv/assignments.csv', data: toCsv(assignments, [['course_id'], ['course_code'], ['course_name'], ['assignment_id'], ['name'], ['due_at'], ['unlock_at'], ['lock_at'], ['points_possible'], ['submission_types'], ['published'], ['workflow_state'], ['submitted_at'], ['score'], ['grade'], ['missing'], ['late'], ['excused'], ['html_url'], ['description']]) },
    { name: 'csv/submissions.csv', data: toCsv(submissions, [['course_id'], ['course_code'], ['course_name'], ['assignment_id'], ['workflow_state'], ['submitted_at'], ['graded_at'], ['score'], ['grade'], ['missing'], ['late'], ['excused'], ['attempt'], ['submission_type'], ['url']]) },
    { name: 'csv/announcements.csv', data: toCsv(announcements, [['id'], ['context_code'], ['course_id'], ['title'], ['posted_at'], ['created_at'], ['author'], ['html_url'], ['message']]) },
    { name: 'csv/modules.csv', data: toCsv(modules, [['course_id'], ['course_code'], ['course_name'], ['module_id'], ['name'], ['position'], ['state'], ['unlock_at'], ['require_sequential_progress'], ['items_count']]) },
    { name: 'csv/module_items.csv', data: toCsv(moduleItems, [['course_id'], ['course_code'], ['module_id'], ['module_name'], ['item_id'], ['title'], ['type'], ['position'], ['content_id'], ['page_url'], ['external_url'], ['html_url'], ['completion_requirement'], ['content_details']]) },
    { name: 'csv/pages.csv', data: toCsv(pages, [['course_id'], ['course_code'], ['course_name'], ['page_id'], ['url'], ['title'], ['created_at'], ['updated_at'], ['published'], ['front_page'], ['html_url'], ['body']]) },
    { name: 'csv/discussions.csv', data: toCsv(discussions, [['course_id'], ['course_code'], ['course_name'], ['discussion_id'], ['title'], ['posted_at'], ['last_reply_at'], ['discussion_type'], ['unread_count'], ['locked'], ['pinned'], ['html_url'], ['message']]) },
    { name: 'csv/files.csv', data: toCsv(files, [['course_id'], ['course_code'], ['course_name'], ['file_id'], ['folder_id'], ['display_name'], ['filename'], ['content_type'], ['size'], ['created_at'], ['updated_at'], ['locked'], ['hidden'], ['hidden_for_user'], ['html_url'], ['download_url']]) },
    { name: 'csv/quizzes.csv', data: toCsv(quizzes, [['course_id'], ['course_code'], ['course_name'], ['quiz_id'], ['title'], ['quiz_type'], ['assignment_id'], ['time_limit'], ['due_at'], ['unlock_at'], ['lock_at'], ['points_possible'], ['published'], ['html_url'], ['description']]) },
    { name: 'csv/calendar.csv', data: toCsv(calendar, [['id'], ['type'], ['title'], ['context_code'], ['start_at'], ['end_at'], ['all_day'], ['workflow_state'], ['html_url'], ['description']]) },
    { name: 'csv/planner.csv', data: toCsv(planner, [['course_id'], ['context_type'], ['context_name'], ['plannable_type'], ['plannable_id'], ['plannable_date'], ['html_url'], ['new_activity'], ['submissions'], ['plannable']]) },
    { name: 'csv/diagnostics.csv', data: toCsv(diagnostics, [['ok'], ['scope'], ['name'], ['path'], ['status'], ['count'], ['pages'], ['ms'], ['requestId'], ['error']]) },
  ];
}

export function filenameStamp(snapshot) {
  const date = new Date(snapshot.meta?.completedAt || Date.now());
  return date.toISOString().replace(/[:.]/g, '-');
}

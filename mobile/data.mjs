// Pure, side-effect-free helpers shared by the mobile reader and its tests.
export function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.courses) || !value.courseData || typeof value.courseData !== 'object' || Array.isArray(value.courseData)) {
    throw new Error('This is not a Quercus JSON snapshot. Use Export > Complete JSON in Quercus Local.');
  }
  if (value.courses.length > 3000) throw new Error('Unexpected number of courses.');
  return value;
}
export function htmlText(value) {
  return String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, ' ').trim();
}
export function courseName(course) { return course.course_code || course.name || 'Course ' + course.id; }
export function dateValue(value) { const n = Date.parse(value || ''); return Number.isFinite(n) ? n : Infinity; }
export function assignments(snapshot) {
  if (Array.isArray(snapshot?.derived?.assignments)) return snapshot.derived.assignments.map(a => ({ ...a }));
  return (snapshot?.courses || []).flatMap(c => (snapshot.courseData?.[c.id]?.assignments || []).map(a => ({
    courseId: c.id, courseCode: c.course_code, courseName: c.name, id: a.id,
    name: a.name, dueAt: a.due_at, htmlUrl: a.html_url, descriptionText: htmlText(a.description),
    submitted: ['submitted', 'graded', 'pending_review'].includes(a.submission?.workflow_state) || Boolean(a.submission?.submitted_at),
    excused: Boolean(a.submission?.excused), grade: a.submission?.grade,
  })));
}
export function pages(snapshot) {
  return (snapshot?.courses || []).flatMap(c => {
    const cd = snapshot.courseData?.[c.id] || {};
    return (cd.pages || []).map(p => {
      const detail = cd.pageDetails?.[p.url] || {};
      return {
        courseId: c.id, course: courseName(c), title: detail.title || p.title || p.url,
        url: detail.html_url || p.html_url, module: (p.module_names || []).join(', '),
        text: htmlText(detail.body ?? p.body ?? ''),
        status: p.content_status || (typeof detail.body === 'string' ? 'retrieved' : 'unavailable'),
      };
    });
  });
}
export function announcements(snapshot) {
  const global = snapshot?.global?.announcements;
  const list = Array.isArray(global) && global.length ? global : (snapshot?.courses || []).flatMap(c => (snapshot.courseData?.[c.id]?.announcements || []).map(a => ({ ...a, course_id: c.id })));
  return list.map(a => ({
    title: a.title || 'Announcement',
    course: snapshot?.courses?.find(c => String(c.id) === String(a.course_id || String(a.context_code || '').replace('course_', '')))?.course_code || a.context_code || 'Course',
    date: a.posted_at || a.created_at, url: a.html_url, text: htmlText(a.message || ''),
  })).sort((a,b) => dateValue(b.date) - dateValue(a.date));
}
export function files(snapshot) {
  return (snapshot?.courses || []).flatMap(c => (snapshot.courseData?.[c.id]?.files || []).map(f => ({
    id: f.id, course: courseName(c), title: f.display_name || f.filename || ('File ' + f.id),
    url: f.html_url || (f.id ? 'https://q.utoronto.ca/files/' + f.id + '/download' : ''),
    bytes: f.size || 0, date: f.updated_at,
  })));
}
export function extractMarkdownSections(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const sections = []; let active = null;
  for (const line of lines) {
    const match = /^(#{2,3}) (.+)$/.exec(line);
    if (match) { if (active) sections.push(active); active = { title: match[2].trim(), content: '' }; }
    else if (active) active.content += line + '\n';
  }
  if (active) sections.push(active);
  return sections;
}

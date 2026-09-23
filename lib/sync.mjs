import { mapLimit } from './canvas.mjs';

const iso = (d) => new Date(d).toISOString();
const daysFromNow = (days) => iso(Date.now() + days * 86400000);

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value == null ? 0 : 1;
}

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

function courseLabel(course) {
  return course?.course_code || course?.name || `Course ${course?.id ?? '?'}`;
}

function getSubmission(assignment, courseData) {
  if (assignment?.submission) return assignment.submission;
  const id = String(assignment?.id ?? '');
  return (courseData?.submissions || []).find((s) => String(s.assignment_id) === id) || null;
}

export function buildDerived(snapshot) {
  const now = Date.now();
  const next7 = now + 7 * 86400000;
  const last14 = now - 14 * 86400000;
  const assignments = [];
  const announcements = [];
  const grades = [];
  const moduleProgress = [];

  for (const course of snapshot.courses || []) {
    const cd = snapshot.courseData?.[course.id] || {};
    for (const assignment of cd.assignments || []) {
      const submission = getSubmission(assignment, cd);
      const due = assignment.due_at ? Date.parse(assignment.due_at) : NaN;
      const submitted = Boolean(submission?.submitted_at) || ['submitted', 'graded', 'pending_review'].includes(submission?.workflow_state);
      const excused = Boolean(submission?.excused);
      const missing = Boolean(submission?.missing) || (Number.isFinite(due) && due < now && !submitted && !excused);
      assignments.push({
        courseId: course.id,
        courseName: course.name,
        courseCode: course.course_code,
        id: assignment.id,
        name: assignment.name,
        dueAt: assignment.due_at || null,
        pointsPossible: assignment.points_possible ?? null,
        htmlUrl: assignment.html_url || null,
        descriptionText: stripHtml(assignment.description || ''),
        submissionTypes: assignment.submission_types || [],
        submitted,
        missing,
        late: Boolean(submission?.late),
        excused,
        workflowState: submission?.workflow_state || null,
        score: submission?.score ?? null,
        grade: submission?.grade ?? null,
        submittedAt: submission?.submitted_at || null,
      });
    }

    for (const a of cd.announcements || []) {
      announcements.push({
        courseId: course.id,
        courseName: course.name,
        id: a.id,
        title: a.title,
        postedAt: a.posted_at || a.created_at || null,
        author: a.author?.display_name || a.author?.name || null,
        htmlUrl: a.html_url || null,
        messageText: stripHtml(a.message || ''),
      });
    }

    const enrollment = (cd.enrollments || []).find((e) => e.type === 'StudentEnrollment') || (course.enrollments || [])[0] || null;
    if (enrollment?.grades || course?.enrollments?.[0]?.grades) {
      const g = enrollment?.grades || course.enrollments[0].grades;
      grades.push({
        courseId: course.id,
        courseName: course.name,
        courseCode: course.course_code,
        currentScore: g.current_score ?? null,
        currentGrade: g.current_grade ?? null,
        finalScore: g.final_score ?? null,
        finalGrade: g.final_grade ?? null,
        htmlUrl: g.html_url || null,
      });
    }

    const mods = cd.modules || [];
    let req = 0;
    let complete = 0;
    for (const mod of mods) {
      for (const item of mod.items || []) {
        if (item.completion_requirement) {
          req += 1;
          if (item.completion_requirement.completed) complete += 1;
        }
      }
    }
    moduleProgress.push({
      courseId: course.id,
      courseName: course.name,
      requirementCount: req,
      completedCount: complete,
      percent: req ? Math.round((complete / req) * 100) : null,
    });
  }

  assignments.sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.name.localeCompare(b.name);
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  });
  announcements.sort((a, b) => Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0));

  return {
    assignments,
    upcomingAssignments: assignments.filter((a) => a.dueAt && Date.parse(a.dueAt) >= now && Date.parse(a.dueAt) <= next7 && !a.excused),
    overdueAssignments: assignments.filter((a) => a.missing && !a.excused),
    recentAnnouncements: announcements.filter((a) => a.postedAt && Date.parse(a.postedAt) >= last14),
    grades,
    moduleProgress,
    counts: {
      courses: snapshot.courses?.length || 0,
      assignments: assignments.length,
      upcoming: assignments.filter((a) => a.dueAt && Date.parse(a.dueAt) >= now && Date.parse(a.dueAt) <= next7).length,
      overdue: assignments.filter((a) => a.missing && !a.excused).length,
      announcements: announcements.length,
      files: Object.values(snapshot.courseData || {}).reduce((n, cd) => n + (cd.files?.length || 0), 0),
      modules: Object.values(snapshot.courseData || {}).reduce((n, cd) => n + (cd.modules?.length || 0), 0),
      pages: Object.values(snapshot.courseData || {}).reduce((n, cd) => n + (cd.pages?.length || 0), 0),
    },
  };
}

export async function syncQuercus(client, { onProgress = () => {} } = {}) {
  const started = Date.now();
  const diagnostics = [];
  let completedSteps = 0;
  let expectedSteps = 1;

  const progress = (stage, message, extra = {}) => {
    onProgress({
      stage,
      message,
      completedSteps,
      expectedSteps,
      percent: expectedSteps ? Math.min(99, Math.round((completedSteps / expectedSteps) * 100)) : 0,
      ...extra,
    });
  };

  async function capture({ scope, name, path, query = {}, mode = 'all' }) {
    const t0 = Date.now();
    try {
      const res = mode === 'one' ? await client.getOne(path, query) : await client.getAll(path, query);
      const data = mode === 'one' ? res.data : res.items;
      diagnostics.push({
        ok: true,
        scope,
        name,
        path,
        status: 200,
        count: countValue(data),
        pages: res.pages || 1,
        ms: Date.now() - t0,
        requestId: res.requestId || null,
      });
      completedSteps += 1;
      progress(scope, `${name}: ${countValue(data)} item${countValue(data) === 1 ? '' : 's'}`);
      return data;
    } catch (error) {
      diagnostics.push({
        ok: false,
        scope,
        name,
        path,
        status: error?.status || 0,
        count: 0,
        pages: 0,
        ms: Date.now() - t0,
        error: error?.message || String(error),
      });
      completedSteps += 1;
      progress(scope, `${name}: unavailable (${error?.status || 'error'})`);
      return mode === 'one' ? null : [];
    }
  }

  const snapshot = {
    schemaVersion: 2,
    meta: {
      startedAt: new Date(started).toISOString(),
      completedAt: null,
      durationMs: null,
      baseUrl: client.baseUrl,
      app: 'Quercus Local',
    },
    user: {},
    global: {},
    courses: [],
    courseData: {},
    diagnostics,
    derived: {},
  };

  progress('account', 'Reading your Quercus account…');

  expectedSteps = 13;
  const [profile, settings, activeCourses, completedCourses, pendingCourses, enrollments, todo, upcomingEvents, activity, favorites, groups, userFiles, userFolders] = await Promise.all([
    capture({ scope: 'account', name: 'profile', path: '/api/v1/users/self/profile', mode: 'one' }),
    capture({ scope: 'account', name: 'settings', path: '/api/v1/users/self/settings', mode: 'one' }),
    capture({ scope: 'account', name: 'active courses', path: '/api/v1/courses', query: { enrollment_state: 'active', 'include[]': ['term', 'total_scores', 'current_grading_period_scores', 'favorites'] } }),
    capture({ scope: 'account', name: 'completed courses', path: '/api/v1/courses', query: { enrollment_state: 'completed', 'include[]': ['term', 'total_scores', 'current_grading_period_scores', 'favorites'] } }),
    capture({ scope: 'account', name: 'pending courses', path: '/api/v1/courses', query: { enrollment_state: 'invited_or_pending', 'include[]': ['term'] } }),
    capture({ scope: 'account', name: 'enrollments', path: '/api/v1/users/self/enrollments', query: { 'state[]': ['active', 'completed', 'invited', 'creation_pending'] } }),
    capture({ scope: 'account', name: 'todo', path: '/api/v1/users/self/todo' }),
    capture({ scope: 'account', name: 'upcoming events', path: '/api/v1/users/self/upcoming_events' }),
    capture({ scope: 'account', name: 'activity stream', path: '/api/v1/users/self/activity_stream' }),
    capture({ scope: 'account', name: 'favorite courses', path: '/api/v1/users/self/favorites/courses' }),
    capture({ scope: 'account', name: 'groups', path: '/api/v1/users/self/groups' }),
    capture({ scope: 'account', name: 'user files', path: '/api/v1/users/self/files' }),
    capture({ scope: 'account', name: 'user folders', path: '/api/v1/users/self/folders' }),
  ]);

  snapshot.user = { profile, settings, enrollments };
  snapshot.global = { todo, upcomingEvents, activity, favorites, groups, userFiles, userFolders };

  const courseMap = new Map();
  for (const course of [...activeCourses, ...completedCourses, ...pendingCourses]) {
    if (course?.id != null) courseMap.set(course.id, course);
  }
  snapshot.courses = [...courseMap.values()].sort((a, b) => String(a.course_code || a.name).localeCompare(String(b.course_code || b.name)));

  const courseIds = snapshot.courses.map((c) => c.id);
  const rangeStart = daysFromNow(-365);
  const rangeEnd = daysFromNow(548);
  expectedSteps += 7;

  const [plannerItems, plannerNotes, calendarEvents, calendarAssignments, conversations, allAnnouncements, userSubmissions] = await Promise.all([
    capture({ scope: 'global', name: 'planner items', path: '/api/v1/planner/items', query: { start_date: rangeStart, end_date: rangeEnd } }),
    capture({ scope: 'global', name: 'planner notes', path: '/api/v1/planner/notes' }),
    capture({ scope: 'global', name: 'calendar events', path: '/api/v1/calendar_events', query: { type: 'event', start_date: rangeStart, end_date: rangeEnd, all_events: true } }),
    capture({ scope: 'global', name: 'calendar assignments', path: '/api/v1/calendar_events', query: { type: 'assignment', start_date: rangeStart, end_date: rangeEnd, all_events: true } }),
    capture({ scope: 'global', name: 'conversations', path: '/api/v1/conversations', query: { scope: 'all', filter_mode: 'and' } }),
    capture({ scope: 'global', name: 'announcements', path: '/api/v1/announcements', query: { 'context_codes[]': courseIds.map((id) => `course_${id}`), active_only: false, latest_only: false } }),
    capture({ scope: 'global', name: 'all user submissions', path: '/api/v1/users/self/submissions', query: { 'include[]': ['assignment', 'course'] } }),
  ]);
  Object.assign(snapshot.global, { plannerItems, plannerNotes, calendarEvents, calendarAssignments, conversations, announcements: allAnnouncements, userSubmissions });

  const perCourseEndpoints = [
    ['course', (id) => `/api/v1/courses/${id}`, { 'include[]': ['syllabus_body', 'term', 'permissions', 'total_scores', 'current_grading_period_scores'] }, 'one'],
    ['assignments', (id) => `/api/v1/courses/${id}/assignments`, { 'include[]': ['submission', 'overrides', 'peer_review', 'academic_integrity_pledge'], all_dates: true, order_by: 'due_at' }, 'all'],
    ['assignmentGroups', (id) => `/api/v1/courses/${id}/assignment_groups`, { 'include[]': ['assignments', 'discussion_topic', 'assessment_requests'] }, 'all'],
    ['submissions', (id) => `/api/v1/courses/${id}/students/submissions`, { 'student_ids[]': ['self'], 'include[]': ['assignment', 'submission_history', 'rubric_assessment', 'visibility'], grouped: false }, 'all'],
    ['modules', (id) => `/api/v1/courses/${id}/modules`, { 'include[]': ['items', 'content_details'] }, 'all'],
    ['pages', (id) => `/api/v1/courses/${id}/pages`, {}, 'all'],
    ['discussions', (id) => `/api/v1/courses/${id}/discussion_topics`, { order_by: 'recent_activity', scope: 'all' }, 'all'],
    ['files', (id) => `/api/v1/courses/${id}/files`, { sort: 'name', order: 'asc' }, 'all'],
    ['folders', (id) => `/api/v1/courses/${id}/folders`, {}, 'all'],
    ['quizzes', (id) => `/api/v1/courses/${id}/quizzes`, {}, 'all'],
    ['tabs', (id) => `/api/v1/courses/${id}/tabs`, {}, 'all'],
    ['sections', (id) => `/api/v1/courses/${id}/sections`, { 'include[]': ['total_students'] }, 'all'],
    ['rubrics', (id) => `/api/v1/courses/${id}/rubrics`, {}, 'all'],
    ['enrollments', (id) => `/api/v1/courses/${id}/enrollments`, { user_id: 'self', 'state[]': ['active', 'completed', 'invited'] }, 'all'],
    ['progress', (id) => `/api/v1/courses/${id}/users/self/progress`, {}, 'one'],
    ['frontPage', (id) => `/api/v1/courses/${id}/front_page`, {}, 'one'],
    ['activity', (id) => `/api/v1/courses/${id}/activity_stream`, {}, 'all'],
    ['features', (id) => `/api/v1/courses/${id}/features/enabled`, {}, 'all'],
    ['rootOutcomeGroup', (id) => `/api/v1/courses/${id}/root_outcome_group`, {}, 'one'],
    ['externalTools', (id) => `/api/v1/courses/${id}/external_tools`, { include_parents: true }, 'all'],
    ['gradingPeriods', (id) => `/api/v1/courses/${id}/grading_periods`, {}, 'all'],
  ];

  expectedSteps += snapshot.courses.length * perCourseEndpoints.length;
  progress('courses', `Syncing ${snapshot.courses.length} course${snapshot.courses.length === 1 ? '' : 's'}…`, { currentCourse: null });

  await mapLimit(snapshot.courses, 3, async (course) => {
    const id = course.id;
    const cd = { courseSummary: course };
    snapshot.courseData[id] = cd;
    progress('courses', `Syncing ${courseLabel(course)}…`, { currentCourse: courseLabel(course) });
    await mapLimit(perCourseEndpoints, 4, async ([name, makePath, query, mode]) => {
      cd[name] = await capture({ scope: `course:${id}`, name: `${courseLabel(course)} · ${name}`, path: makePath(id), query, mode });
    });

    // Use the global announcements result when possible, preserving course-scoped convenience data.
    cd.announcements = (allAnnouncements || []).filter((a) => String(a.context_code || '') === `course_${id}` || String(a.course_id || '') === String(id));
  });

  // Deep content: full page bodies, module items if not embedded, and peer-review metadata.
  const deepJobs = [];
  for (const course of snapshot.courses) {
    const id = course.id;
    const cd = snapshot.courseData[id] || {};
    for (const page of cd.pages || []) {
      if (!page?.url) continue;
      deepJobs.push({
        kind: 'page',
        course,
        key: page.url,
        run: () => capture({ scope: `course:${id}:deep`, name: `${courseLabel(course)} · page · ${page.title || page.url}`, path: `/api/v1/courses/${id}/pages/${encodeURIComponent(page.url)}`, mode: 'one' }),
      });
    }
    for (const mod of cd.modules || []) {
      if (Array.isArray(mod.items) && mod.items.length) continue;
      deepJobs.push({
        kind: 'moduleItems',
        course,
        key: mod.id,
        run: () => capture({ scope: `course:${id}:deep`, name: `${courseLabel(course)} · module items · ${mod.name || mod.id}`, path: `/api/v1/courses/${id}/modules/${mod.id}/items`, query: { 'include[]': ['content_details'] } }),
      });
    }
    for (const assignment of cd.assignments || []) {
      if (!assignment?.peer_reviews) continue;
      deepJobs.push({
        kind: 'peerReviews',
        course,
        key: assignment.id,
        run: () => capture({ scope: `course:${id}:deep`, name: `${courseLabel(course)} · peer reviews · ${assignment.name || assignment.id}`, path: `/api/v1/courses/${id}/assignments/${assignment.id}/peer_reviews` }),
      });
    }
  }

  expectedSteps += deepJobs.length;
  const deepResults = await mapLimit(deepJobs, 5, async (job) => ({ ...job, data: await job.run() }));
  for (const result of deepResults) {
    const cd = snapshot.courseData[result.course.id];
    if (result.kind === 'page') {
      cd.pageDetails ||= {};
      cd.pageDetails[result.key] = result.data;
    } else if (result.kind === 'moduleItems') {
      const mod = (cd.modules || []).find((m) => String(m.id) === String(result.key));
      if (mod) mod.items = result.data;
    } else if (result.kind === 'peerReviews') {
      cd.peerReviews ||= {};
      cd.peerReviews[result.key] = result.data;
    }
  }

  snapshot.derived = buildDerived(snapshot);
  snapshot.meta.completedAt = new Date().toISOString();
  snapshot.meta.durationMs = Date.now() - started;
  snapshot.meta.successfulEndpoints = diagnostics.filter((d) => d.ok).length;
  snapshot.meta.failedEndpoints = diagnostics.filter((d) => !d.ok).length;

  onProgress({
    stage: 'done',
    message: `Sync complete: ${snapshot.courses.length} courses, ${snapshot.derived.counts.assignments} assignments`,
    completedSteps: expectedSteps,
    expectedSteps,
    percent: 100,
    currentCourse: null,
  });

  return snapshot;
}

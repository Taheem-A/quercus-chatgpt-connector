import {
  courseModulePages, readingSequence, savedPage, pageRoute,
} from './page-router.mjs';
import { renderCanvasContent, contentLinks } from './rich-content.mjs';

function escape(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const countText = n => n === 1 ? '1 page' : n + ' pages';
const courseTitle = c => c.course_code || c.name || ('Course ' + c.id);

function courseTile(course, count) {
  return '<button class="reader-course-tile" type="button" data-go-course="' +
    escape(course.id) + '"><span class="reader-course-mark">▤</span><span class="reader-course-copy"><b>' +
    escape(courseTitle(course)) + '</b><small>' + escape(course.name || 'Course') +
    '</small></span><span class="reader-count">' + countText(count) + '</span><span aria-hidden="true">›</span></button>';
}

function pageRow(courseId, item) {
  return '<button type="button" class="reader-page-row" data-open-page-course="' +
    escape(courseId) + '" data-open-page-slug="' + escape(item.slug) +
    '"><span class="reader-page-icon">▤</span><span class="reader-page-title">' +
    escape(item.title) + '</span>' +
    (item.status !== 'retrieved' ? '<span class="reader-missing">Not cached</span>' : '') +
    '<span class="reader-arrow" aria-hidden="true">›</span></button>';
}

export function buildPageCatalog(snapshot, activeCourseId = 'all', query = '') {
  if (!snapshot) return '';
  const courses = (snapshot.courses || []).filter(c => (snapshot.courseData?.[c.id]?.pages || []).length > 0);
  const needle = String(query).trim().toLowerCase();
  const matchesPage = (courseId, slug) => {
    if (!needle) return true;
    const cd = snapshot.courseData?.[courseId] || {};
    const p = (cd.pages || []).find(x => String(x.url) === String(slug));
    return String(p?.title || '').toLowerCase().includes(needle) ||
      String(cd.pageDetails?.[slug]?.body || '').toLowerCase().includes(needle);
  };
  if (activeCourseId === 'all' || !courses.some(c => String(c.id) === String(activeCourseId))) {
    const choices = courses.filter(c => !needle || [c.course_code,c.name].some(v => String(v||'').toLowerCase().includes(needle)) ||
      (snapshot.courseData?.[c.id]?.pages || []).some(p => matchesPage(c.id,p.url)));
    return '<div class="reader-section-heading"><div><div class="reader-kicker">COURSE LIBRARY</div><h2>Your course pages</h2><p>Choose a course to browse its Modules and pages.</p></div><span class="reader-overview-count">' +
      courses.length + ' courses</span></div><div class="reader-course-list">' +
      choices.map(c => courseTile(c, (snapshot.courseData?.[c.id]?.pages || []).length)).join('') +
      (choices.length ? '' : '<div class="reader-empty">No matching course pages.</div>') + '</div>';
  }

  const course = courses.find(c => String(c.id) === String(activeCourseId));
  const groups = courseModulePages(snapshot, activeCourseId);
  const total = (snapshot.courseData?.[activeCourseId]?.pages || []).length;
  const sections = groups.map((g, idx) => {
    const items = g.items.filter(item => !needle || item.title.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle) || matchesPage(activeCourseId,item.slug));
    if (!items.length) return '';
    const open = needle || idx < 2 ? ' open' : '';
    return '<details class="reader-module"'+open+'><summary><span class="reader-module-icon">▥</span><span class="reader-module-label">' +
      escape(g.name) + '</span><small>' + countText(items.length) + '</small><span class="reader-chevron" aria-hidden="true">⌄</span></summary><div class="reader-module-pages">' +
      items.map(item => pageRow(activeCourseId, item)).join('') + '</div></details>';
  }).join('');

  return '<div class="reader-library-header"><button class="reader-back-link" data-back-courses type="button">‹ All courses</button>' +
    '<div class="reader-kicker">COURSE CONTENT</div><h2>' + escape(courseTitle(course)) +
    '</h2><p>' + escape(course.name || '') + ' · ' + countText(total) +
    '</p></div><div class="reader-module-list">' + (sections || '<div class="reader-empty">No matching pages in this course.</div>') + '</div>';
}

function resourceList(html) {
  const attachments = contentLinks(html).filter(item => item.kind === 'file');
  if (!attachments.length) return '';
  const seen = new Set();
  const unique = attachments.filter(item => {
    if (seen.has(item.fileId)) return false;
    seen.add(item.fileId);
    return true;
  });
  return '<details class="reader-resources"><summary>Attachments & resources <span>' +
    unique.length + '</span></summary><div class="reader-resource-links">' +
    unique.map(item => '<a data-canvas-file="' + escape(item.fileId) + '" class="canvas-link canvas-file" target="_blank" rel="noopener noreferrer" href="' +
      escape(item.url) + '">📎 ' + escape(item.label || ('File ' + item.fileId)) + '</a>').join('') +
    '</div></details>';
}

function pageOutline(snapshot, courseId, currentSlug) {
  return '<aside class="reader-outline" aria-label="Course page outline"><div class="reader-outline-card">' +
    '<span class="reader-outline-label">COURSE CONTENTS</span>' +
    courseModulePages(snapshot, courseId).map(group =>
      '<div class="reader-outline-group"><strong>' + escape(group.name) + '</strong>' +
      group.items.map(item => '<button type="button" class="' +
        (item.slug === currentSlug ? 'current' : '') +
        '" data-open-page-course="' + escape(courseId) +
        '" data-open-page-slug="' + escape(item.slug) + '">' + escape(item.title) + '</button>').join('') +
      '</div>').join('') +
    '</div></aside>';
}

export function buildPageReader(snapshot, courseId, slug) {
  const page = savedPage(snapshot, courseId, slug);
  if (!page) return '';
  const course = (snapshot.courses || []).find(c => String(c.id) === String(courseId));
  const ordered = readingSequence(snapshot, courseId);
  const index = ordered.findIndex(p => p.slug === slug);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const moduleGroups = courseModulePages(snapshot, courseId);
  const currentGroup = moduleGroups.find(g => g.items.some(i => i.slug === slug));
  const main = page.html ? renderCanvasContent(page.html).outerHTML :
    '<div class="reader-empty">This page was discovered, but its body could not be retrieved. You can try opening the original page in Quercus.</div>';
  const resourceSection = page.html ? resourceList(page.html) : '';
  const source = page.href && /^https:\/\//.test(page.href) ?
    '<a class="reader-source" data-pocket-external href="' + escape(page.href) + '" target="_blank" rel="noopener noreferrer">Open original in Quercus ↗</a>' : '';
  const navButton = (item, direction) => item ?
    '<button type="button" class="reader-step ' + direction + '" data-open-page-course="' +
    escape(courseId) + '" data-open-page-slug="' + escape(item.slug) +
    '"><small>' + (direction === 'previous' ? '‹ Previous page' : 'Next page ›') +
    '</small><b>' + escape(item.title) + '</b></button>' : '<span></span>';
  const chapterItems = currentGroup?.items || [];
  return '<div class="reader-screen">' + pageOutline(snapshot, courseId, slug) + '<div class="reader-article-shell">' +
    '<nav class="reader-breadcrumb"><button type="button" data-back-courses>Courses</button><span>›</span><button type="button" data-go-course="' +
    escape(courseId) + '">' + escape(courseTitle(course || {id: courseId})) +
    '</button></nav><div class="reader-article-top"><div class="reader-kicker">' +
    escape(currentGroup?.name || 'COURSE PAGE') + '</div><h1>' + escape(page.title) + '</h1><p>' +
    escape(page.course) + (page.status !== 'retrieved' ? ' · Content unavailable' : ' · Saved for offline reading') +
    '</p></div>' +
    (chapterItems.length > 1 ? '<details class="reader-chapter"><summary>In this module <span>' +
      chapterItems.length + ' pages</span></summary><div class="reader-chapter-items">' +
      chapterItems.map(item => '<button type="button" class="' + (item.slug === slug ? 'current' : '') +
        '" data-open-page-course="' + escape(courseId) + '" data-open-page-slug="' +
        escape(item.slug) + '">' + escape(item.title) + '</button>').join('') + '</div></details>' : '') +
    '<article class="reader-document">' + main + resourceSection + '</article>' +
    '<div class="reader-document-footer">' + source + '</div>' +
    '<nav class="reader-pagination" aria-label="Page navigation">' +
    navButton(previous, 'previous') + navButton(next, 'next') + '</nav></div></div>';
}

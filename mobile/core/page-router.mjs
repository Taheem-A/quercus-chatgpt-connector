// Pure, testable routing & module organization for the Pocket course reader.
// Nothing is fetched here: links only open in Pocket if the corresponding
// page exists in the phone's saved Quercus snapshot.
const BASE = 'https://q.utoronto.ca';

export function pageRoute(courseId, pageSlug) {
  return '#/course/' + encodeURIComponent(String(courseId)) + '/page/' +
    encodeURIComponent(String(pageSlug));
}

export function courseRoute(courseId) {
  return '#/course/' + encodeURIComponent(String(courseId));
}

export function parseReaderRoute(hash) {
  const value = String(hash || '');
  let match = /^#\/course\/([0-9]+)\/page\/([^/?#]+)$/.exec(value);
  if (match) {
    try { return { courseId: match[1], slug: decodeURIComponent(match[2]) }; }
    catch { return null; }
  }
  match = /^#\/course\/([0-9]+)$/.exec(value);
  return match ? { courseId: match[1], slug: null } : null;
}

export function savedPage(snapshot, courseId, slug) {
  if (!snapshot || !/^\d+$/.test(String(courseId)) || !slug) return null;
  const course = (snapshot.courses || []).find(c => String(c.id) === String(courseId));
  const cd = snapshot.courseData?.[courseId] || {};
  const page = (cd.pages || []).find(p => String(p.url) === String(slug));
  if (!course || !page) return null;
  const detail = cd.pageDetails?.[page.url] || {};
  return {
    courseId: String(courseId),
    slug: String(page.url),
    title: detail.title || page.title || page.url,
    html: detail.body ?? page.body ?? '',
    href: detail.html_url || page.html_url ||
      BASE + '/courses/' + courseId + '/pages/' + encodeURIComponent(page.url),
    status: page.content_status || (typeof detail.body === 'string' ? 'retrieved' : 'unavailable'),
    course: course.course_code || course.name || ('Course ' + courseId),
  };
}

export function resolveSavedPageLink(snapshot, href, fallbackCourseId = null, endpoint = '') {
  if (!snapshot || !href) return null;
  const candidates = [endpoint, href].filter(Boolean);
  for (const candidate of candidates) {
    let url;
    try { url = new URL(candidate, BASE); }
    catch { continue; }
    if (url.origin !== BASE) continue;
    // RCE links can give API endpoint instead of browser href.
    let match = /^\/(?:api\/v1\/)?courses\/(\d+)\/pages\/([^/]+)\/?$/.exec(url.pathname);
    if (match) {
      let slug;
      try { slug = decodeURIComponent(match[2]); } catch { continue; }
      const found = savedPage(snapshot, match[1], slug);
      if (found) return found;
    }
    // Canvas sometimes links to a module-item redirect instead of a page URL.
    match = /^\/courses\/(\d+)\/modules\/items\/(\d+)\/?$/.exec(url.pathname);
    if (match) {
      const cd = snapshot.courseData?.[match[1]] || {};
      for (const mod of cd.modules || []) {
        const item = (mod.items || []).find(x => String(x.id) === match[2] && x.type === 'Page');
        if (item?.page_url) {
          const found = savedPage(snapshot, match[1], item.page_url);
          if (found) return found;
        }
      }
    }
  }
  // Some course-authored anchor links are relative to their current page,
  // e.g. href="assessment-schedule". Restrict to explicit saved slugs.
  if (fallbackCourseId && !String(href).includes('/') && !String(href).includes(':') && !String(href).startsWith('#')) {
    try { return savedPage(snapshot, fallbackCourseId, decodeURIComponent(href)); }
    catch { return null; }
  }
  return null;
}

export function courseModulePages(snapshot, courseId) {
  const cd = snapshot?.courseData?.[courseId] || {};
  const pageBySlug = new Map((cd.pages || []).map(p => [String(p.url), p]));
  const used = new Set();
  const groups = [];
  for (const module of cd.modules || []) {
    const items = [];
    for (const item of module.items || []) {
      if (item?.type !== 'Page' || !item.page_url) continue;
      const slug = String(item.page_url);
      const page = pageBySlug.get(slug);
      if (!page) continue;
      used.add(slug);
      items.push({
        slug,
        title: item.title || page.title || slug,
        status: page.content_status || 'unavailable',
        itemId: item.id,
      });
    }
    if (items.length) groups.push({ name: module.name || 'Module', id: module.id, items });
  }
  const loose = (cd.pages || []).filter(p => !used.has(String(p.url))).map(p => ({
    slug: String(p.url), title: p.title || String(p.url),
    status: p.content_status || 'unavailable',
  }));
  if (loose.length) groups.push({name:'Other course pages',id:'other',items:loose});
  return groups;
}

export function readingSequence(snapshot, courseId) {
  const seen = new Set();
  return courseModulePages(snapshot, courseId).flatMap(group => group.items).filter(item => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

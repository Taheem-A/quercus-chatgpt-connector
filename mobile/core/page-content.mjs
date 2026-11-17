// Canvas may hide the Pages tab/list while exposing individual Pages through Modules.
export function discoverCoursePages(courseData, courseId, canvasBaseUrl) {
  const byUrl = new Map();
  const base = String(canvasBaseUrl).replace(/\/+$/, '');

  function remember(candidate, source, moduleName = null) {
    // Canvas ModuleItem.url is an API URL (e.g. /api/v1/courses/123/pages/slug),
    // NOT the page slug. Only ModuleItem.page_url belongs in /pages/:url.
    const url = String(source === 'module'
      ? (candidate?.page_url || '')
      : (candidate?.url || candidate?.page_url || '')).trim();
    if (!url) return;
    let page = byUrl.get(url);
    if (!page) {
      page = {
        url,
        title: candidate.title || url,
        html_url: source === 'module'
          ? base + '/courses/' + encodeURIComponent(courseId) + '/pages/' + encodeURIComponent(url)
          : candidate.html_url || base + '/courses/' + encodeURIComponent(courseId) + '/pages/' + encodeURIComponent(url),
        sources: [],
        module_names: [],
      };
      byUrl.set(url, page);
    }
    if (!page.sources.includes(source)) page.sources.push(source);
    if (moduleName && !page.module_names.includes(moduleName)) page.module_names.push(moduleName);
    for (const field of ['page_id', 'created_at', 'updated_at', 'published', 'front_page', 'body']) {
      if (candidate[field] !== undefined && (page[field] === undefined || source === 'course_list')) {
        page[field] = candidate[field];
      }
    }
    if (source === 'course_list' || source === 'front_page') {
      page.title = candidate.title || page.title;
      page.html_url = candidate.html_url || page.html_url;
    }
  }

  for (const page of courseData.pages || []) remember(page, 'course_list');
  for (const mod of courseData.modules || []) {
    for (const item of mod.items || []) {
      if (item?.type === 'Page' && item.page_url) {
        remember(item, 'module', mod.name || ('Module ' + mod.id));
      }
    }
  }
  if (courseData.frontPage?.url) remember(courseData.frontPage, 'front_page');
  return [...byUrl.values()];
}

function decodeEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
    ldquo: '“', rdquo: '”', bull: '•', copy: '©',
  };
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (original, code) => {
    if (code.startsWith('#')) {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value) : original;
    }
    return named[code.toLowerCase()] ?? original;
  });
}

function textOnly(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function safeLink(value, baseUrl) {
  try {
    const url = new URL(decodeEntities(value).trim(), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

// Preserve useful headings, lists, links and table rows in readable Markdown.
// The unmodified source HTML remains in the JSON snapshot.
export function pageHtmlToMarkdown(html, canvasBaseUrl = 'https://q.utoronto.ca') {
  if (!html) return '';
  let value = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');

  value = value.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (original, attributes, label) => {
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const url = href && safeLink(href[1] || href[2], canvasBaseUrl);
    const labelText = textOnly(label);
    return url && labelText ? '[' + labelText + '](' + url + ')' : labelText;
  });
  value = value.replace(/<img\b([^>]*)\/?>/gi, (original, attributes) => {
    const alt = attributes.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const src = attributes.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const url = src && safeLink(src[1] || src[2], canvasBaseUrl);
    return url ? '![' + textOnly(alt?.[1] || alt?.[2] || 'Image') + '](' + url + ')' : '';
  });
  value = value
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (original, level, content) => '\n' + '#'.repeat(Number(level) + 1) + ' ' + textOnly(content) + '\n')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (original, tag, content) => '**' + textOnly(content) + '**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (original, tag, content) => '*' + textOnly(content) + '*')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|ul|ol|table|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Canvas Pages are rich HTML, not plain text. Never place raw Canvas markup into
// innerHTML. This renderer rebuilds only allowlisted elements and attributes.
const QUERCUS = 'https://q.utoronto.ca';
const TAGS = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i',
  'u', 's', 'small', 'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'sup', 'sub',
  'dl', 'dt', 'dd', 'figure', 'figcaption',
]);
const SKIP = new Set([
  'script', 'style', 'object', 'embed', 'form', 'input', 'button',
  'select', 'textarea', 'svg', 'math', 'meta', 'link', 'base', 'video', 'audio',
  'canvas', 'template',
]);

function safeHttpUrl(value, base = QUERCUS) {
  try {
    const url = new URL(String(value || '').trim(), base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function fileIdFromPath(value) {
  // Quercus links can target file previews, downloads, or Canvas file metadata.
  // Also accept API metadata URLs from Canvas's Rich Content Editor.
  if (!value) return null;
  const url = safeHttpUrl(value, QUERCUS);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.origin !== QUERCUS) return null;
  const path = parsed.pathname;
  const match = /^\/(?:api\/v1\/)?(?:courses\/\d+\/|users\/\d+\/|groups\/\d+\/)?files\/(\d+)(?:\/|$)/.exec(path);
  return match ? match[1] : null;
}

// Pure helper: classifies a Canvas-rich-content link without involving the DOM.
export function classifyCanvasLink(href, apiEndpoint = '', base = QUERCUS) {
  const id = fileIdFromPath(apiEndpoint) || fileIdFromPath(href);
  const url = safeHttpUrl(href, base);
  if (id) {
    return {
      kind: 'file',
      fileId: id,
      url: url || QUERCUS + '/files/' + id + '/download',
    };
  }
  if (!url) return null;
  const parsed = new URL(url);
  return {
    kind: parsed.origin === QUERCUS ? 'quercus' : 'external',
    fileId: null,
    url,
  };
}

function makeSafeAnchor(info) {
  const anchor = document.createElement('a');
  anchor.href = info.url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.classList.add('canvas-link');
  if (info.kind === 'file') {
    anchor.dataset.canvasFile = info.fileId;
    anchor.classList.add('canvas-file');
  } else if (info.kind === 'external') {
    anchor.classList.add('canvas-external');
  }
  return anchor;
}

export function renderCanvasContent(rawHtml) {
  const container = document.createElement('div');
  container.className = 'canvas-rich';
  if (!rawHtml) return container;
  const parsed = new DOMParser().parseFromString(String(rawHtml), 'text/html');
  let nodes = 0;

  function clone(node, parent, depth = 0) {
    nodes++;
    if (nodes > 25000 || depth > 70) return;
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent || '')); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'iframe') {
      // Canvas often embeds file previews as iframes. Keep a safe open link
      // instead of silently dropping an embedded document.
      const info = classifyCanvasLink(node.getAttribute('src'), node.getAttribute('data-api-endpoint'));
      if (info) {
        const anchor = makeSafeAnchor(info);
        anchor.textContent = 'Open embedded resource' + (info.fileId ? ' (file ' + info.fileId + ')' : '');
        parent.appendChild(anchor);
      }
      return;
    }
    if (tag === 'img') {
      const info = classifyCanvasLink(node.getAttribute('src'), node.getAttribute('data-api-endpoint'));
      const alt = node.getAttribute('alt') || 'Course image';
      const originalSrc = node.getAttribute('src');
      const source = safeHttpUrl(originalSrc, QUERCUS);
      if (!source && !info?.fileId) {
        parent.appendChild(document.createTextNode('[Image: ' + alt + ']'));
        return;
      }
      const img = document.createElement('img');
      img.className = 'course-inline-image';
      img.alt = alt;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      // The original Canvas HTML may have custom widths; our CSS constrains
      // images to the reader column so text and images do not overflow.
      const width = Number(node.getAttribute('width'));
      if (Number.isInteger(width) && width > 0 && width <= 1800) img.style.maxWidth = width + 'px';
      if (info?.fileId) img.dataset.canvasImageFile = info.fileId;
      if (source) img.src = source;
      else img.dataset.canvasImagePending = 'true';
      parent.appendChild(img);
      return;
    }
    if (tag === 'a') {
      const info = classifyCanvasLink(node.getAttribute('href'), node.getAttribute('data-api-endpoint'));
      if (info) {
        const anchor = makeSafeAnchor(info);
        const endpoint = node.getAttribute('data-api-endpoint');
        if (endpoint && endpoint.length < 2048) anchor.dataset.canvasApiEndpoint = endpoint;
        for (const child of node.childNodes) clone(child, anchor, depth + 1);
        if (!anchor.textContent.trim()) anchor.textContent = info.kind === 'file' ? 'Download attachment' : info.url;
        if (info.kind === 'file') anchor.appendChild(document.createTextNode(' ↧'));
        parent.appendChild(anchor);
      } else {
        for (const child of node.childNodes) clone(child, parent, depth + 1);
      }
      return;
    }
    const element = document.createElement(TAGS.has(tag) ? tag : 'span');
    if (tag === 'th' || tag === 'td') {
      const span = Number(node.getAttribute('colspan'));
      if (Number.isInteger(span) && span >= 1 && span <= 12) element.colSpan = span;
    }
    for (const child of node.childNodes) clone(child, element, depth + 1);
    parent.appendChild(element);
  }

  for (const child of parsed.body.childNodes) clone(child, container);
  return container;
}

export function contentLinks(rawHtml) {
  if (!rawHtml) return [];
  const doc = new DOMParser().parseFromString(String(rawHtml), 'text/html');
  const seen = new Set();
  const output = [];
  for (const node of doc.querySelectorAll('a, img, iframe')) {
    if (output.length >= 120) break;
    const resource = node.localName === 'img' || node.localName === 'iframe';
    const info = classifyCanvasLink(
      node.getAttribute(resource ? 'src' : 'href'),
      node.getAttribute('data-api-endpoint'),
    );
    if (!info) continue;
    const identity = info.kind === 'file' ? 'file:' + info.fileId : info.url;
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push({
      ...info,
      label: (
        (node.localName === 'img' ? node.getAttribute('alt') : node.textContent) ||
        node.getAttribute('title') ||
        (info.fileId ? 'File ' + info.fileId : 'Open linked resource')
      ).trim().slice(0, 160),
    });
  }
  return output;
}

// Selects an inline preview from authorized Canvas File metadata. It never
// requests an arbitrary URL. Returned links are ephemeral and not persisted.
function secure(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}

export function describeFilePreview(metadata, publicPreviewUrl = '', originalUrl = '') {
  const name = String(metadata?.display_name || metadata?.filename || 'Course attachment');
  const mime = String(metadata?.['content-type'] || metadata?.content_type || '').toLowerCase().split(';')[0];
  const lower = name.toLowerCase();
  let kind = 'unsupported';
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) kind = 'pdf';
  else if (/^image\/(?:png|jpeg|jpg|gif|webp|avif)$/.test(mime) || /\.(?:png|jpe?g|gif|webp|avif)$/.test(lower)) kind = 'image';
  else if (mime === 'text/plain' || lower.endsWith('.txt')) kind = 'text';
  else if (secure(metadata?.preview_url)) kind = 'document';

  // /public_url is the official Canvas inline preview URL. A file may have a
  // separate raw URL whose response intentionally requests download.
  const preview = kind === 'document'
    ? secure(metadata?.preview_url)
    : secure(publicPreviewUrl) || secure(metadata?.preview_url) || secure(metadata?.url);
  const download = secure(metadata?.url) || secure(originalUrl);
  const origin = secure(metadata?.html_url) || secure(originalUrl);
  return {
    kind, name, mime, preview, download, origin,
    size: typeof metadata?.size === 'number' ? metadata.size : null,
    isPreviewable: Boolean(preview && kind !== 'unsupported'),
  };
}

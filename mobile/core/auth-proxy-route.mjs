// A same-origin auth proxy must never accept a full URL or arbitrary host.
// Every route is forwarded only to the fixed, server-configured Neon Auth host.
export function authProxyRoute(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  let path=url.searchParams.get('path');
  if(path===null) {
    const match=/^\/auth(?:\/(.*))?$/.exec(url.pathname);
    if(!match)return null;
    path=match[1]||'';
  }
  if(path.length>256 || !/^[a-zA-Z0-9/_-]*$/.test(path) ||
     path.split('/').some(seg=>seg==='.'||seg==='..'))return null;
  url.searchParams.delete('path');
  // Only the original query is forwarded. Discard the routing parameter.
  return {
    path,
    query:url.searchParams.toString(),
  };
}

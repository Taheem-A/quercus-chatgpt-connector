// Neon Auth uses an opaque HTTP-only session cookie. Postgres' Data API
// requires a separate signed JWT (the Better Auth JWT plugin GET /token).
// Do NOT send a session ID or Quercus API token to the Neon Data API.
export function looksLikeJwt(value) {
  if (typeof value !== 'string' || value.length > 10000) return false;
  const parts=value.split('.');
  return parts.length===3 && parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p) && p.length>0);
}

// Pass a fetch function explicitly in unit tests; production defaults to the
// browser's fetch. Never cache, expose, persist or log the JWT.
export async function getCloudJwt(fetchFn = fetch) {
  const response=await fetchFn('/auth/token',{
    method:'GET',credentials:'same-origin',cache:'no-store',
    headers:{Accept:'application/json'},
  });
  if (!response.ok) {
    if (response.status===401 || response.status===403)
      throw new Error('Your cloud sign-in has expired. Sign out and sign back in to reconnect.');
    throw new Error('Could not obtain a signed cloud access token. Try again.');
  }
  const payload=await response.json().catch(()=>null);
  const token=payload?.token ?? payload?.data?.token;
  if (!looksLikeJwt(token))
    throw new Error('The account service returned a session value instead of a signed JWT. Please sign in again.');
  return token;
}

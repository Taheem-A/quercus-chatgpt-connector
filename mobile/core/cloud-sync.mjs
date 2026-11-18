// Pure cloud-sync safety rules. Authentication and database access live in
// cloud-client.mjs; no Quercus credentials or user data are bundled in this file.
export const MAX_CLOUD_BYTES = 22 * 1024 * 1024;
const SECRET_FIELD = /^(?:token|access_?token|api_?token|auth_?token|bearer_?token|refresh_?token|authorization|password|secret|client_?secret|cookie|private_?key)$/i;

export function captureMillis(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.courses) || !snapshot.courseData) return null;
  const value = snapshot.meta?.completedAt || snapshot.meta?.startedAt || snapshot.meta?.syncedAt;
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : null;
}

export function sanitizeForCloud(snapshot) {
  const timestamp = captureMillis(snapshot);
  if (timestamp === null) throw new Error('This export does not have a valid synchronization timestamp.');
  const allowed = ['meta','courses','courseData','global','derived','diagnostics'];
  const clean = {};
  for (const name of allowed) if (snapshot[name] !== undefined) clean[name] = snapshot[name];
  const seen = new WeakSet();
  const encoded = JSON.stringify(clean, (key,value) => {
    if (SECRET_FIELD.test(key)) return undefined;
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) throw new Error('Snapshot contains repeated or circular objects.');
      seen.add(value);
    }
    return value;
  });
  if (!encoded || new TextEncoder().encode(encoded).length > MAX_CLOUD_BYTES) {
    throw new Error('Snapshot is too large for this first cloud-sync version. Your local data is unchanged; export JSON as a backup.');
  }
  return JSON.parse(encoded);
}

export function decideUpload(localSnapshot, cloudRecord) {
  const localTime = captureMillis(localSnapshot);
  if (localTime === null) return {action:'invalid',message:'No valid local Quercus snapshot is available.'};
  if (!cloudRecord) return {action:'insert'};
  const remoteTime=Date.parse(cloudRecord.source_synced_at || '');
  if (!Number.isFinite(remoteTime)) return {action:'conflict',message:'Cloud timestamp is invalid. Upload was blocked.'};
  if (localTime < remoteTime) return {action:'remote-newer',message:'Cloud already contains newer Quercus data; download it before refreshing.'};
  if (localTime === remoteTime) return {action:'same',message:'Cloud is already at this synchronization timestamp.'};
  if (!Number.isSafeInteger(Number(cloudRecord.revision)) || Number(cloudRecord.revision)<1) return {action:'conflict',message:'Cloud revision is invalid.'};
  return {action:'update',expectedRevision:Number(cloudRecord.revision)};
}

export function shouldAdoptCloud(localSnapshot, cloudRecord, localPending = false) {
  if (!cloudRecord?.snapshot) return false;
  if (localPending) return false;
  const remoteTime=Date.parse(cloudRecord.source_synced_at || '');
  const localTime=captureMillis(localSnapshot);
  return Number.isFinite(remoteTime) && (localTime===null || remoteTime > localTime);
}

export function verifyOwnedRecord(row, userId) {
  if (!row) return null;
  if (!userId || row.user_id !== userId) throw new Error('Cloud response did not match the signed-in account.');
  if (!Number.isSafeInteger(Number(row.revision)) || Number(row.revision)<1)
    throw new Error('Invalid cloud revision.');
  if (captureMillis(row.snapshot)===null) throw new Error('Invalid cloud snapshot.');
  return row;
}

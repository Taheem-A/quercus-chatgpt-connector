import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureMillis,sanitizeForCloud,decideUpload,shouldAdoptCloud,verifyOwnedRecord,MAX_CLOUD_BYTES} from '../mobile/core/cloud-sync.mjs';

function sample(when='2026-11-18T00:00:00Z'){
  return {meta:{completedAt:when},courses:[{id:42,course_code:'APS111'}],
    courseData:{42:{pages:[{url:'lesson'}],pageDetails:{lesson:{body:'<p>Private course notes</p>'}}}},
    global:{announcements:[]},derived:{counts:{pages:1}},diagnostics:[]};
}
const record=(when='2026-11-18T00:00:00Z',revision=1,user='account-A')=>({
  user_id:user,revision,source_synced_at:when,snapshot:sample(when),updated_at:when
});

test('first cloud upload is opt-in, accepts only a complete timestamped snapshot',()=>{
  assert.deepEqual(decideUpload(sample(),null),{action:'insert'});
  assert.equal(captureMillis(sample()),Date.parse('2026-11-18T00:00:00Z'));
  assert.equal(decideUpload({courses:[],courseData:{}},null).action,'invalid');
  assert.equal(decideUpload(null,null).action,'invalid');
  assert.throws(()=>sanitizeForCloud({courses:[],courseData:{}}),/timestamp/);
});

test('never overwrite a newer cloud snapshot with old local data',()=>{
  assert.equal(decideUpload(sample('2026-11-17T00:00:00Z'),record()).action,'remote-newer');
  assert.equal(decideUpload(sample('2026-11-18T00:00:00Z'),record()).action,'same');
  assert.deepEqual(decideUpload(sample('2026-11-19T00:00:00Z'),record('2026-11-18T00:00:00Z',7)),
    {action:'update',expectedRevision:7});
  assert.equal(decideUpload(sample(),{...record(),revision:0}).action,'same');
  assert.equal(decideUpload(sample('2026-11-19T00:00:00Z'),{...record(),revision:0}).action,'conflict');
});

test('cloud pulls preserve unsynced local work and apply only newer cloud versions',()=>{
  assert.equal(shouldAdoptCloud(null,record()),true);
  assert.equal(shouldAdoptCloud(sample('2026-11-17T00:00:00Z'),record()),true);
  assert.equal(shouldAdoptCloud(sample('2026-11-19T00:00:00Z'),record()),false);
  assert.equal(shouldAdoptCloud(sample('2026-11-17T00:00:00Z'),record(),true),false);
  assert.equal(shouldAdoptCloud(sample(),null),false);
});

test('credentials and secret-like fields cannot be put into cloud snapshots',()=>{
  const unsafe=sample();
  unsafe.apiToken='secret-on-root';
  unsafe.token='bare-token-secret';
  unsafe.global.auth_token='nested-auth-secret';
  unsafe.global.refresh_token='nested-refresh-secret';
  unsafe.courseData[42].access_token='secret-on-course';
  unsafe.meta.refresh_token='secret-in-meta';
  unsafe.global.nested={password:'hidden',authorization:'bearer secret',legit:'allowed'};
  const safe=sanitizeForCloud(unsafe);
  const text=JSON.stringify(safe);
  assert.doesNotMatch(text,/secret-on-root|secret-on-course|secret-in-meta|bearer secret|hidden|bare-token-secret|nested-auth-secret|nested-refresh-secret/);
  assert.match(text,/Private course notes/);
  assert.equal(safe.global.nested.legit,'allowed');
  assert.equal(safe.apiToken,undefined);
});
test('shared references across course sections are valid JSON, not circular objects',()=>{
  const snapshot=sample();
  const commonAssignment={id:7,name:'Team Charter',submission:{workflow_state:'submitted'}};
  const sharedPage={url:'rubric',body:'<p>Assignment instructions</p>'};
  snapshot.courseData[42].assignments=[commonAssignment,commonAssignment];
  snapshot.courseData[42].pageDetails.rubric=sharedPage;
  snapshot.derived.assignments=[commonAssignment];
  snapshot.global.latestPage=sharedPage;
  const saved=sanitizeForCloud(snapshot);
  assert.equal(saved.courseData[42].assignments[0].name,'Team Charter');
  assert.deepEqual(saved.courseData[42].assignments[0],saved.derived.assignments[0]);
  assert.deepEqual(saved.courseData[42].pageDetails.rubric,saved.global.latestPage);
  assert.notStrictEqual(saved.courseData[42].assignments[0],saved.derived.assignments[0],
    'JSON correctly duplicates repeated values rather than keeping aliases');
  assert.equal(snapshot.derived.assignments[0],commonAssignment,
    'Original locally cached objects must be untouched');
});

test('real circular references are rejected without changing local snapshot',()=>{
  const snapshot=sample();
  const page={url:'test'};
  page.self=page;
  snapshot.courseData[42].pageDetails.cyclic=page;
  assert.throws(()=>sanitizeForCloud(snapshot),/circular reference/i);
  assert.strictEqual(snapshot.courseData[42].pageDetails.cyclic,page);
  assert.strictEqual(page.self,page);
});

test('secret fields are removed from every copy of shared references',()=>{
  const snapshot=sample();
  const repeated={id:1,name:'Assignment',apiToken:'sensitive-secret',nested:{refresh_token:'nope'}};
  snapshot.courseData[42].assignments=[repeated];
  snapshot.derived.assignments=[repeated];
  const saved=sanitizeForCloud(snapshot);
  assert.doesNotMatch(JSON.stringify(saved),/sensitive-secret|nope/);
  assert.equal(saved.courseData[42].assignments[0].name,'Assignment');
  assert.equal(saved.derived.assignments[0].name,'Assignment');
});

test('payload limit and record ownership are checked before cloud actions',()=>{
  const huge=sample();
  huge.courseData[42].long='x'.repeat(MAX_CLOUD_BYTES+10);
  assert.throws(()=>sanitizeForCloud(huge),/too large/);
  assert.equal(verifyOwnedRecord(record(), 'account-A').user_id,'account-A');
  assert.throws(()=>verifyOwnedRecord(record(),'account-B'),/signed-in account/);
  assert.throws(()=>verifyOwnedRecord({...record(),revision:-1},'account-A'),/revision/);
});

test('cloud implementation cannot mix storage keys or auto-upload legacy data on sign-in',()=>{
  const source=readFileSync(new URL('../mobile/core/cloud-ui.mjs',import.meta.url),'utf8');
  assert.match(source,/account:'\+id/);
  assert.match(source,/token:'\+id/);
  assert.match(source,/No existing course data is uploaded just by signing in|Upload the saved Quercus snapshot/);
  assert.match(source,/await writeAuth\('has-used-account',true\)/);
  assert.match(source,/state\.token=null;state\.cloudEnabled=false/);
  assert.match(source,/state\.cloudPending/);
  assert.match(source,/state\.cloudPending=Boolean\(state\.cloudPending\|\|/);
  assert.match(source,/conflict-backup:/);
  assert.match(source,/cloudUseRemote/);
  assert.match(source,/auth\.emailOtp\.verifyEmail|cloudAuth\.verifyEmail/);
});

test('database migration has enforced RLS and no anonymous read grants',()=>{
  const sql=readFileSync(new URL('../mobile/migrations/001_cloud_snapshots.sql',import.meta.url),'utf8');
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.match(sql,/TO authenticated/);
  assert.match(sql,/REVOKE ALL ON public\.pocket_snapshots FROM PUBLIC, anonymous/);
  assert.match(sql,/auth\.user_id\(\)/);
});

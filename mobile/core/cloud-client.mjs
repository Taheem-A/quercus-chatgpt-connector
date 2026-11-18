import { createClient } from '@neondatabase/neon-js';
import { captureMillis, decideUpload, sanitizeForCloud, verifyOwnedRecord } from './cloud-sync.mjs';

// This HTTPS endpoint contains no credentials. Neon Auth stores sessions and
// injects a short-lived, user-scoped JWT into RLS-protected Data API requests.
const DATABASE_URL='https://ep-proud-poetry-bd2f21s9.c-8.us-east-2.aws.neon.tech/quercus_pocket';
const neon=createClient(DATABASE_URL);
const TABLE='pocket_snapshots';
const FIELDS='user_id,revision,source_synced_at,updated_at,snapshot';

function check(result,action){
  if(result?.error)throw new Error(result.error.message || (action+' failed.'));
  return result?.data;
}
function validUserId(value){
  if(typeof value!=='string'||!value||value.length>256)throw new Error('You must sign in to a valid account.');
  return value;
}
export const cloudAuth={
  async current(){
    const result=await neon.auth.getSession();
    const data=check(result,'Session');
    return data?.session && data?.user ? data.user : null;
  },
  async signIn(email,password){
    const data=check(await neon.auth.signIn.email({email,password,rememberMe:true}),'Sign in');
    return data;
  },
  async signUp(email,password,name){
    return check(await neon.auth.signUp.email({email,password,name}),'Create account');
  },
  async verifyEmail(email,otp){
    return check(await neon.auth.emailOtp.verifyEmail({email,otp}),'Verify email');
  },
  async signInGoogle(){
    return check(await neon.auth.signIn.social({provider:'google',callbackURL:location.origin+'/'}),'Google sign in');
  },
  async signOut(){check(await neon.auth.signOut(),'Sign out');}
};

export const cloudStorage={
  async read(userId){
    const id=validUserId(userId);
    const data=check(await neon.from(TABLE).select(FIELDS).eq('user_id',id).limit(1),'Cloud read');
    const row=Array.isArray(data)?data[0]||null:null;
    return verifyOwnedRecord(row,id);
  },
  async push(userId,snapshot){
    const id=validUserId(userId);
    // First fetch the server's current revision. Optimistic concurrency
    // ensures a second device can't silently overwrite a newer revision.
    const current=await this.read(id);
    const decision=decideUpload(snapshot,current);
    if(!['insert','update'].includes(decision.action))return { ...decision,record:current };
    const clean=sanitizeForCloud(snapshot);
    const row={
      user_id:id,
      revision:decision.action==='insert'?1:decision.expectedRevision+1,
      source_synced_at:new Date(captureMillis(snapshot)).toISOString(),
      updated_at:new Date().toISOString(),
      snapshot:clean,
    };
    let response;
    if(decision.action==='insert'){
      response=await neon.from(TABLE).insert(row).select(FIELDS);
    }else{
      response=await neon.from(TABLE).update(row)
        .eq('user_id',id).eq('revision',decision.expectedRevision).select(FIELDS);
    }
    if(response.error){
      const code=String(response.error.code||'');
      if(['23505','409','PGRST116'].includes(code))return {action:'conflict',record:await this.read(id)};
      throw new Error(response.error.message || 'Cloud upload failed.');
    }
    const result=Array.isArray(response.data)?response.data[0]||null:null;
    if(!result)return {action:'conflict',record:await this.read(id)};
    return {action:'saved',record:verifyOwnedRecord(result,id)};
  },
  async remove(userId){
    const id=validUserId(userId);
    check(await neon.from(TABLE).delete().eq('user_id',id),'Delete cloud data');
  }
};

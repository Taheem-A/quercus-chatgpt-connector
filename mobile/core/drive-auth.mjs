import {DRIVE_SCOPES} from './drive-api.mjs';

export function validGoogleClientId(value){
  return /^\d{8,30}-[a-z0-9-]{20,}\.apps\.googleusercontent\.com$/.test(String(value||'').trim());
}
export class DriveAuthorization{
  constructor(googleObject=()=>globalThis.google){
    this.googleObject=googleObject;
    this.accessToken=null;
    this.expiresAt=0;
  }
  token(){
    return this.accessToken&&Date.now()+30000<this.expiresAt?this.accessToken:null;
  }
  isConnected(){return Boolean(this.token());}
  async connect(clientId){
    if(!validGoogleClientId(clientId))throw Error('Enter a valid Google OAuth Web client ID.');
    const auth=this.googleObject()?.accounts?.oauth2;
    if(!auth?.initTokenClient)throw Error('Google sign-in library has not loaded. Check your connection and try again.');
    // The Google SDK opens its popup from a direct user click; no browser token
    // or OAuth credential is placed in storage, cookies, or Pocket's cloud.
    const response=await new Promise((resolve,reject)=>{
      const client=auth.initTokenClient({
        client_id:clientId,scope:DRIVE_SCOPES,
        callback:r=>r?.error?reject(Error('Google declined Drive authorization.')):resolve(r),
        error_callback:()=>reject(Error('Google popup failed or was closed. Try Safari or a standard browser.')),
      });
      client.requestAccessToken({prompt:'consent'});
    });
    const granted=String(response?.scope||'').split(/\s+/);
    if(!DRIVE_SCOPES.split(' ').every(scope=>granted.includes(scope)))
      throw Error('Google did not grant both Drive file access and metadata-only access.');
    if(typeof response?.access_token!=='string'||response.access_token.length<20)
      throw Error('Google did not supply a valid access token.');
    this.accessToken=response.access_token;
    this.expiresAt=Date.now()+Math.max(30,Number(response.expires_in)||300)*1000;
    return true;
  }
  disconnect(){
    const token=this.accessToken;
    this.accessToken=null;
    this.expiresAt=0;
    if(token)this.googleObject()?.accounts?.oauth2?.revoke?.(token,()=>{});
  }
}

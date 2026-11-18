import { cloudAuth, cloudStorage } from './cloud-client.mjs';
import { captureMillis, decideUpload, shouldAdoptCloud } from './cloud-sync.mjs';

const $ = id => document.getElementById(id);
const msg = (value,success=false) => {
  $('authMessage').textContent=value||'';
  $('authMessage').classList.toggle('success',success);
};
const localKey = id => 'account:'+id;
const tokenKey = id => 'token:'+id;
const prefKey = id => 'cloud-auto:'+id;

export function setupCloud({state,readLocal,writeLocal,readAuth,writeAuth,removeAuth,updateSnapshot,render}) {
  let mode='signIn',checking=false,initialized=false,pollHandle=null;

  const userId=()=>state.cloudUser?.id||null;
  function setBanner(text,warning=false,action='',callback=null) {
    const banner=$('cloudBanner');
    const button=$('cloudBannerAction');
    if(!text){banner.hidden=true;return;}
    banner.hidden=false;
    banner.classList.toggle('cloud-warning',warning);
    $('cloudBannerText').textContent=text;
    button.hidden=!action;
    button.textContent=action;
    button.onclick=callback;
  }
  function status() {
    const id=userId();
    $('accountLabel').textContent=id ? 'Account' : 'Sign in';
    $('accountButton').classList.toggle('signed-in',Boolean(id));
    if(id){
      const email=state.cloudUser.email||'Account';
      setBanner(state.offlineSession? 'Offline mode · your account’s saved device copy is available. Sign in online to resume cloud sync.' : state.cloudError?
        'Cloud sync: '+state.cloudError :
        (state.cloudPending?
          'This device has changes that have not reached the cloud.' :
          (state.cloudRecord ? 'Cloud connected · '+email+' · Snapshot shared between devices.' :
          'Signed in · '+email+' · No cloud snapshot uploaded yet.')),
        Boolean(state.offlineSession||state.cloudError||state.cloudPending),
        state.cloudPending?'Review':'Account',openAccount);
    } else if(state.hasUsedCloudAccount){
      setBanner('Device-only mode. Sign in to restore your private cloud workspace.',false,'Sign in',openAccount);
    } else setBanner('',false);
    const logged=Boolean(id);
    $('authSignedOut').hidden=logged;
    $('authSignedIn').hidden=!logged;
    if(logged){
      $('signedInEmail').textContent=state.cloudUser.email||'Account';
      const stamp=state.cloudRecord?.source_synced_at;
      $('cloudAccountStatus').textContent=stamp
        ? 'Cloud last synced '+new Date(stamp).toLocaleString()+
          ' · revision '+state.cloudRecord.revision+
          (state.cloudPending?' · newer device copy awaiting upload':'')
        : 'No uploaded snapshot yet. You can continue to use Quercus without uploading.';
      $('cloudAutoUpload').checked=Boolean(state.cloudEnabled);
      $('cloudAutoUpload').disabled=Boolean(state.offlineSession);
      $('cloudRestoreBackup').hidden=!state.guestBackup;
      $('cloudUploadNow').disabled=Boolean(state.cloudBusy||state.offlineSession||!navigator.onLine);
      $('cloudCheckNow').disabled=Boolean(state.cloudBusy||state.offlineSession||!navigator.onLine);
      $('cloudDelete').disabled=Boolean(state.cloudBusy||!state.cloudRecord||state.offlineSession);
    }
    $('guestBackupButton').hidden=!state.guestBackup||logged;
  }
  function openAccount(){
    msg('');
    status();
    if(!$('accountDialog').open)$('accountDialog').showModal();
  }
  function setMode(next){
    mode=next;
    $('signInMode').classList.toggle('active',mode==='signIn');
    $('signUpMode').classList.toggle('active',mode==='signUp');
    $('authNameLabel').hidden=mode!=='signUp';
    $('authSubmit').textContent=mode==='signUp'?'Create account':'Sign in';
    $('authPassword').autocomplete=mode==='signUp'?'new-password':'current-password';
  }
  async function adoptAccount(user){
    if(!user?.id)throw new Error('Invalid account session.');
    const oldId=userId();
    state.cloudUser=user;
    state.offlineSession=false;
    await writeAuth('last-account',{id:user.id,email:user.email||''});
    state.hasUsedCloudAccount=true;
    await writeAuth('has-used-account',true);
    state.token=await readAuth(tokenKey(user.id))||null;
    state.cloudEnabled=Boolean(await readAuth(prefKey(user.id)));
    state.cloudRecord=null;
    state.cloudError='';
    const local=await readLocal(localKey(user.id));
    // An account can only display its own scoped cache; never transfer an
    // unscoped guest snapshot or a different user's cache automatically.
    updateSnapshot(local?.kind==='json'?local.value:null);
    state.cloudPending=false;
    status();
    await pull(true);
    if(oldId && oldId!==user.id)state.cloudError='';
  }
  async function pull(initial=false){
    if(!userId() || state.offlineSession || checking || !navigator.onLine)return;
    checking=true;state.cloudBusy=true;
    try{
      const id=userId();
      const record=await cloudStorage.read(id);
      if(id!==userId())return;
      const existing=state.snapshot;
      state.cloudRecord=record;
      if(record && shouldAdoptCloud(existing,record,state.cloudPending)){
        await writeLocal({kind:'json',value:record.snapshot},localKey(id));
        updateSnapshot(record.snapshot);
        state.cloudPending=false;
        state.cloudError='';
      } else if(record && existing){
        const localTime=captureMillis(existing);
        const remoteTime=Date.parse(record.source_synced_at||'');
        state.cloudPending=Number.isFinite(remoteTime)&&localTime>remoteTime;
        if(state.cloudPending)state.cloudError='A newer device snapshot exists locally. Review it before uploading.';
        else state.cloudError='';
      } else if(!record){
        state.cloudError='';
        if(existing)state.cloudPending=true;
      }else state.cloudError='';
    }catch(error){
      state.cloudError=(error?.message||'Cloud connection unavailable')+
        '. Local course data remains on this device.';
    }finally{
      checking=false;state.cloudBusy=false;status();render();
    }
  }
  async function upload(skipConfirm=false){
    if(!userId()||state.offlineSession){openAccount();msg('Connect to the internet and sign in again before uploading data.');return;}
    const snapshot=state.snapshot||state.guestBackup;
    if(!snapshot){msg('There is no locally saved JSON snapshot to upload. Sync Quercus or import Complete JSON first.');return;}
    const decision=decideUpload(snapshot,state.cloudRecord);
    if(['remote-newer','conflict'].includes(decision.action)){
      msg(decision.message||'The cloud version is newer. Download or sync again before uploading.');
      return;
    }
    if(!skipConfirm && !confirm('Upload the saved Quercus snapshot (courses, grades, assignments, page text and related metadata) to your private Neon cloud account? Your Quercus API token will NOT be included.'))return;
    state.cloudBusy=true;status();msg('Uploading encrypted-in-transit course data to your private workspace…');
    try{
      const id=userId();
      const result=await cloudStorage.push(id,snapshot);
      if(id!==userId())return;
      if(result.action==='saved'||result.action==='same'){
        state.cloudRecord=result.record||state.cloudRecord;
        state.cloudPending=false;
        state.cloudError='';
        if(!state.snapshot)updateSnapshot(snapshot);
        await writeLocal({kind:'json',value:snapshot},localKey(id));
        // An explicitly approved one-time upload is NOT permission for
        // future automatic uploads. The separate toggle controls that.
        msg(result.action==='saved'?'Your account now has the newest snapshot. Other devices can download it.':'Cloud already has this version.',true);
      }else{
        state.cloudError=result.message || 'Cloud was changed by another device. Nothing was overwritten.';
        msg(state.cloudError);
      }
    }catch(error){
      state.cloudError=error?.message||'Cloud upload failed';
      msg('Upload failed: '+state.cloudError+'. Your local data has been preserved.');
    }finally{state.cloudBusy=false;status();render();}
  }
  async function localChanged(snapshot,{fromQuercus=false}={}){
    if(!userId())return;
    state.cloudPending=true;
    state.cloudError='';
    status();
    if(fromQuercus && state.cloudEnabled && !state.offlineSession){
      await upload(true); // consent given by the account's explicit toggle
    }
  }
  async function submitAccount(){
    if(state.cloudBusy)return;
    const email=$('authEmail').value.trim();
    const password=$('authPassword').value;
    const name=$('authName').value.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){msg('Enter a valid email address.');return;}
    if(password.length<10){msg('Use a password with at least 10 characters.');return;}
    if(mode==='signUp' && name.length<2){msg('Enter your display name.');return;}
    state.cloudBusy=true;$('authSubmit').disabled=true;$('authGoogle').disabled=true;
    try{
      msg(mode==='signUp'?'Creating your account…':'Signing in…');
      // Account creation may return a user object BEFORE email verification:
      // never show protected data until getSession confirms authentication.
      if(mode==='signUp')await cloudAuth.signUp(email,password,name);
      else await cloudAuth.signIn(email,password);
      $('authPassword').value='';
      const user=await cloudAuth.current();
      if(user){
        msg('Signed in.',true);
        await adoptAccount(user);
        $('accountDialog').close();
      }else if(mode==='signUp'){
        $('authVerification').hidden=false;
        msg('Account created. Enter the email verification code sent to '+email+'.',true);
      }else{
        msg('Check your email verification code, then try signing in.');
        $('authVerification').hidden=false;
      }
    }catch(error){msg(error?.message||'Authentication failed.');}
    finally{state.cloudBusy=false;$('authSubmit').disabled=false;$('authGoogle').disabled=false;status();}
  }
  async function verifyEmail(){
    if(state.cloudBusy)return;
    const email=$('authEmail').value.trim();
    const otp=$('authOtp').value.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^[a-zA-Z0-9]{4,12}$/.test(otp)){
      msg('Enter the email used for sign-up and the verification code sent to it.');return;
    }
    state.cloudBusy=true;$('authVerify').disabled=true;
    try{
      msg('Verifying email…');
      await cloudAuth.verifyEmail(email,otp);
      $('authOtp').value='';
      const user=await cloudAuth.current();
      if(user){
        await adoptAccount(user);
        msg('Email verified and signed in.',true);
        $('accountDialog').close();
      }else{
        setMode('signIn');
        $('authVerification').hidden=true;
        msg('Email verified! Sign in with your password to open the private workspace.',true);
      }
    }catch(error){msg(error?.message||'Verification unsuccessful. Check the code and try again.');}
    finally{state.cloudBusy=false;$('authVerify').disabled=false;status();}
  }
  async function signOut(){
    if(!userId())return;
    if(!confirm('Sign out of Quercus Pocket on this device? Your account data stays in the cloud and your device cache is preserved but hidden.'))return;
    try{
      if(state.offlineSession){throw new Error('Reconnect to the internet to securely end your authenticated session.');}
      await cloudAuth.signOut();
      await removeAuth('last-account');
      state.offlineSession=false;
      state.cloudUser=null;state.token=null;state.cloudEnabled=false;state.cloudRecord=null;
      state.cloudPending=false;state.cloudError='';
      // Do not show the preceding account's private cached records or token
      // to the next signed-out visitor.
      updateSnapshot(null);
      msg('Signed out. Your account copy remains private.',true);
      status();render();
      $('accountDialog').close();
    }catch(error){msg(error?.message||'Sign out failed.');}
  }
  async function deleteCloud(){
    if(!userId())return;
    const email=state.cloudUser.email||'this account';
    if(!confirm('Permanently delete the cloud snapshot belonging to '+email+'? Device caches will be preserved. This does not delete your account.'))return;
    state.cloudBusy=true;
    try{
      await cloudStorage.remove(userId());
      state.cloudRecord=null;state.cloudPending=Boolean(state.snapshot);
      state.cloudEnabled=false;await writeAuth(prefKey(userId()),false);
      msg('Cloud snapshot deleted. This device’s offline copy was retained.',true);
    }catch(error){msg('Could not delete cloud snapshot: '+error.message);}
    finally{state.cloudBusy=false;status();render();}
  }
  async function initialize(){
    if(initialized)return;
    initialized=true;
    const oldSaved=await readLocal('latest');
    state.guestBackup=oldSaved?.kind==='json' ? oldSaved.value : null;
    state.hasUsedCloudAccount=Boolean(await readAuth('has-used-account'));
    const last=await readAuth('last-account');
    try{
      if(!navigator.onLine && last?.id){
        await adoptOfflineAccount(last);
      }else{
        const user=await cloudAuth.current();
        if(user)await adoptAccount(user);
        else if(state.hasUsedCloudAccount){
          state.token=null;updateSnapshot(null);
        }
      }
    }catch(error){
      if(!navigator.onLine && last?.id)await adoptOfflineAccount(last);
      else {
        state.cloudError='Account service unavailable. Device-only data has not been erased.';
        if(state.hasUsedCloudAccount){state.token=null;updateSnapshot(null);}
      }
    }
    status();render();
    pollHandle=setInterval(()=>{
      if(userId() && !state.offlineSession && document.visibilityState==='visible' && navigator.onLine)pull();
    },120000);
  }
  async function adoptOfflineAccount(last){
    if(!last?.id || typeof last.id!=='string')return;
    state.cloudUser={id:last.id,email:last.email||'Offline account'};
    state.offlineSession=true;state.cloudEnabled=false;
    state.token=null;state.cloudRecord=null;
    state.cloudError='Account session not verified while offline.';
    const local=await readLocal(localKey(last.id));
    updateSnapshot(local?.kind==='json'?local.value:null);
  }
  async function resumeOnlineAccount(){
    if(!navigator.onLine)return;
    if(state.offlineSession){
      const expected=userId();
      try {
        const user=await cloudAuth.current();
        if(user && user.id===expected){await adoptAccount(user);return;}
      }catch{return;}
      // The previous account was signed out or replaced while offline.
      state.cloudUser=null;state.offlineSession=false;state.token=null;
      state.cloudRecord=null;state.cloudPending=false;state.cloudEnabled=false;
      updateSnapshot(null);status();
      return;
    }
    if(userId())await pull();
  }
  $('accountButton').addEventListener('click',openAccount);
  $('signInMode').addEventListener('click',()=>setMode('signIn'));
  $('signUpMode').addEventListener('click',()=>setMode('signUp'));
  $('authSubmit').addEventListener('click',submitAccount);
  $('authVerify').addEventListener('click',verifyEmail);
  $('authOtp').addEventListener('keydown',e=>{if(e.key==='Enter')verifyEmail();});
  $('authShowVerification').addEventListener('click',()=>{$('authVerification').hidden=false;msg('Enter your email and the verification code.');});
  $('authPassword').addEventListener('keydown',event=>{if(event.key==='Enter')submitAccount();});
  $('authForgotPassword').addEventListener('click',()=>{
    $('authPasswordRecovery').hidden=false;
    $('authResetEmail').value=$('authEmail').value.trim();
    msg('We’ll send a password recovery code to your account email.');
  });
  $('authCancelReset').addEventListener('click',()=>{
    $('authPasswordRecovery').hidden=true;
    $('authResetOtp').value='';$('authNewPassword').value='';
    msg('');
  });
  $('authSendResetCode').addEventListener('click',async()=>{
    const email=$('authResetEmail').value.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){msg('Enter the email address for your account.');return;}
    if(state.cloudBusy)return;
    state.cloudBusy=true;$('authSendResetCode').disabled=true;
    try{
      await cloudAuth.sendResetCode(email);
      msg('If this email belongs to an account, a recovery code was sent.',true);
    }catch(error){msg(error?.message||'Recovery code could not be sent.');}
    finally{state.cloudBusy=false;$('authSendResetCode').disabled=false;}
  });
  $('authCompleteReset').addEventListener('click',async()=>{
    const email=$('authResetEmail').value.trim();
    const otp=$('authResetOtp').value.trim();
    const password=$('authNewPassword').value;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!/^[a-zA-Z0-9]{4,12}$/.test(otp)){
      msg('Enter your account email and the recovery code.');return;
    }
    if(password.length<10){msg('Your new password must be at least 10 characters.');return;}
    if(state.cloudBusy)return;
    state.cloudBusy=true;$('authCompleteReset').disabled=true;
    try{
      await cloudAuth.resetPassword(email,otp,password);
      $('authNewPassword').value='';$('authResetOtp').value='';
      $('authPasswordRecovery').hidden=true;
      $('authEmail').value=email;
      setMode('signIn');
      msg('Password reset. Sign in with your new password.',true);
    }catch(error){msg(error?.message||'Password reset failed.');}
    finally{state.cloudBusy=false;$('authCompleteReset').disabled=false;}
  });
  $('authGoogle').addEventListener('click',async()=>{
    try{msg('Redirecting to Google…');await cloudAuth.signInGoogle();}
    catch(error){msg(error?.message||'Google sign-in unavailable.');}
  });
  $('authSignOut').addEventListener('click',signOut);
  $('cloudCheckNow').addEventListener('click',()=>pull());
  $('cloudUploadNow').addEventListener('click',()=>upload(false));
  $('cloudDelete').addEventListener('click',deleteCloud);
  $('cloudRestoreBackup').addEventListener('click',async()=>{
    if(!userId()||!state.guestBackup)return;
    if(!confirm('Use the original device-only Quercus snapshot in this account? This will NOT upload it. You can review it first, then choose Upload.'))return;
    await writeLocal({kind:'json',value:state.guestBackup},localKey(userId()));
    state.cloudPending=true;updateSnapshot(state.guestBackup);
    msg('Device-only snapshot loaded into this account’s local cache. Upload separately when ready.',true);
    status();render();
  });
  $('guestBackupButton').addEventListener('click',async()=>{
    if(userId()||!state.guestBackup)return;
    if(!confirm('Open the original device-only saved snapshot? It is not protected by your cloud account password.'))return;
    updateSnapshot(state.guestBackup);
    render();
  });
  $('cloudAutoUpload').addEventListener('change',async(event)=>{
    if(!userId())return;
    if(event.target.checked && !confirm('Automatically upload future Quercus snapshots from this device to your private cloud account? Previously stored data is not uploaded until you choose Upload.')){
      event.target.checked=false;return;
    }
    state.cloudEnabled=event.target.checked;
    await writeAuth(prefKey(userId()),state.cloudEnabled);
    status();
  });
  window.addEventListener('focus',resumeOnlineAccount);
  window.addEventListener('online',resumeOnlineAccount);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeOnlineAccount();});
  return {initialize,openAccount,status,pull,upload,localChanged,
    storageKey:()=>userId()?localKey(userId()):'latest',
    tokenStorageKey:()=>userId()?tokenKey(userId()):'token',
    isSignedIn:()=>Boolean(userId())};
}

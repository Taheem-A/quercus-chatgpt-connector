// User-consented Google Drive API client. Access tokens are never persisted,
// uploaded to Neon, or sent to Quercus/Vercel. No update/delete endpoints.
import {FOLDER_MIME,isDriveId} from './drive-plan.mjs';

const API='https://www.googleapis.com/drive/v3';
const UPLOAD='https://www.googleapis.com/upload/drive/v3';
const META_FIELDS='id,name,mimeType,parents,size,md5Checksum,webViewLink,appProperties,capabilities(canAddChildren)';
const MAX_TREE_NODES=2500;
export const DRIVE_SCOPES=[
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
].join(' ');
const qs=(pairs)=>new URLSearchParams(pairs).toString();
const failMessage=status=>status===401?'Google Drive authorization expired. Reconnect Google Drive.'
  :status===403?'Google Drive denied access to this folder or request.'
  :status===429?'Google Drive API quota exceeded. Try again later.'
  :'Google Drive API returned HTTP '+status+'.';
export class DriveClient{
  constructor(getToken,fetcher=(...args)=>globalThis.fetch(...args)){
    if(typeof getToken!=='function')throw Error('Google authorization callback is required.');
    this.getToken=getToken;this.fetcher=fetcher;
  }
  async request(method,url,{headers={},body=null,signal=null}={}){
    const token=this.getToken();
    if(typeof token!=='string'||token.length<20)
      throw Error('Connect Google Drive before using this feature.');
    const target=new URL(url);
    if(target.protocol!=='https:'||target.origin!=='https://www.googleapis.com')
      throw Error('Google Drive request was blocked: invalid target.');
    let response;
    try{
      response=await this.fetcher(target.href,{
        method,headers:{Authorization:'Bearer '+token,...headers},
        ...(body!=null?{body}:{}),
        cache:'no-store',credentials:'omit',redirect:'error',signal,
      });
    }catch(error){
      // Network and CORS errors cannot generally be distinguished in browser
      // JavaScript, but a native-method receiver bug is an application error,
      // not evidence that the user's internet connection is down.
      const detail=String(error?.message||'');
      if(/illegal invocation|incompatible receiver|Window\.fetch|Window\.setTimeout|called on an object|instances of Window/i.test(detail)){
        throw Error('Google Drive browser API compatibility error. Reload Quercus Pocket and retry.');
      }
      throw Error('Google Drive browser request failed before a response. This may be a CORS restriction, blocked redirect, or network problem. Check the browser Network panel for the Google Drive request.');
    }
    if(!response.ok)throw Error(failMessage(response.status));
    return response;
  }
  async json(method,url,opts={}){
    const response=await this.request(method,url,opts);
    return response.json();
  }
  async about(){
    return this.json('GET',API+'/about?'+qs({fields:'user(displayName,emailAddress)'}));
  }
  async getFile(id){
    if(!isDriveId(id))throw Error('Invalid Google Drive folder or file ID.');
    return this.json('GET',API+'/files/'+encodeURIComponent(id)+'?'+qs({fields:META_FIELDS}));
  }
  async listChildren(folderId,{max=2000}={}){
    if(!isDriveId(folderId))throw Error('Invalid Google Drive folder ID.');
    let pageToken='',found=[],pages=0;
    do{
      const query="'"+folderId+"' in parents and trashed = false";
      const url=new URL(API+'/files');
      url.searchParams.set('q',query);
      url.searchParams.set('pageSize','1000');
      url.searchParams.set('fields','nextPageToken,incompleteSearch,files('+META_FIELDS+')');
      if(pageToken)url.searchParams.set('pageToken',pageToken);
      const response=await this.json('GET',url.href);
      if(response.incompleteSearch)throw Error('Drive reported an incomplete folder listing. Nothing will be uploaded.');
      if(!Array.isArray(response.files))throw Error('Unexpected Google Drive listing response.');
      found.push(...response.files);
      if(found.length>max)throw Error('Too many files in the selected folder; narrow the Drive root.');
      pageToken=response.nextPageToken||'';
      pages++;
      if(pages>10)throw Error('Google Drive pagination safety limit reached.');
    }while(pageToken);
    return found;
  }
  async crawlTree(rootId,{maxDepth=5,maxNodes=MAX_TREE_NODES,onProgress=()=>{}}={}){
    const root=await this.getFile(rootId);
    if(root.mimeType!==FOLDER_MIME)throw Error('The selected Google Drive item is not a folder.');
    const all=[{...root,parentId:null}],queue=[{id:rootId,depth:0}];
    let scanned=0;
    while(queue.length){
      const {id,depth}=queue.shift();
      const children=await this.listChildren(id,{max:maxNodes-all.length});
      for(const child of children){
        all.push({...child,parentId:id});
        if(all.length>maxNodes)throw Error('Drive root contains too many files to safely scan. Select a smaller folder.');
        if(child.mimeType===FOLDER_MIME && depth<maxDepth)queue.push({id:child.id,depth:depth+1});
      }
      scanned++;
      onProgress({scanned,waiting:queue.length,files:all.length,folder:root.name});
    }
    return all;
  }
  async createFolder(name,parentId){
    if(!isDriveId(parentId)||typeof name!=='string'||name.length>100)
      throw Error('Invalid destination for a new folder.');
    const data={name,mimeType:FOLDER_MIME,parents:[parentId]};
    return this.json('POST',API+'/files?'+qs({fields:META_FIELDS}),{
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
  }
  async uploadNew({name,mimeType,folderId,bytes,appProperties={},signal=null}){
    if(!isDriveId(folderId)||!name||typeof name!=='string'||name.includes('/')||name.includes('\\')||
       name==='.'||name==='..'||name.length>200)
      throw Error('Invalid file name or destination.');
    const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type:mimeType||'application/octet-stream'});
    if(blob.size>50*1024*1024)throw Error('File exceeds the safe 50 MiB in-browser Drive upload limit.');
    const meta={name,parents:[folderId],mimeType:mimeType||'application/octet-stream',
      appProperties:Object.fromEntries(Object.entries(appProperties)
        .filter(([key,value])=>/^[a-zA-Z0-9_]{1,64}$/.test(key)&&
          typeof value==='string'&&value.length<=124))};
    // A resumable create is used for ALL sizes, so a failed transfer cannot
    // overwrite anything or accidentally publish a half-written file.
    const init=await this.request('POST',UPLOAD+'/files?'+qs({
      uploadType:'resumable',fields:'id,name,mimeType,parents,webViewLink,appProperties'
    }),{
      headers:{'Content-Type':'application/json; charset=UTF-8',
        'X-Upload-Content-Type':meta.mimeType,
        'X-Upload-Content-Length':String(blob.size)},
      body:JSON.stringify(meta),signal,
    });
    const location=init.headers.get('location');
    let url;
    try{url=new URL(location);}catch{throw Error('Google Drive did not return a resumable upload URL.');}
    if(url.origin!=='https://www.googleapis.com'||url.protocol!=='https:')
      throw Error('Unsafe Google Drive upload session URL.');
    const done=await this.request('PUT',url.href,{
      headers:{'Content-Type':meta.mimeType},
      body:blob,signal,
    });
    const result=await done.json();
    if(!isDriveId(result.id))throw Error('Google Drive did not confirm the new file ID.');
    return result;
  }
}

// Quercus announcements are Canvas discussion topics with is_announcement
// enabled. Read existing snapshot records; no extra Canvas API requests.
const BASE='https://q.utoronto.ca';
const finite = value => {
  const n=Date.parse(value||'');
  return Number.isFinite(n)?n:0;
};
const validId = value => /^\d+$/.test(String(value??''));
const keyOf = (courseId,id) => String(courseId)+':'+String(id);

function contextCourse(raw){
  const id=raw.course_id??raw.courseId;
  if(validId(id))return String(id);
  const m=/^course_(\d+)$/.exec(String(raw.context_code||''));
  return m?.[1]||null;
}
function safeOriginalUrl(candidate,courseId,id){
  const fallback=BASE+'/courses/'+courseId+'/discussion_topics/'+id;
  try{
    const url=new URL(candidate||fallback,BASE);
    return url.protocol==='https:' && url.origin===BASE ? url.href : fallback;
  }catch{return fallback;}
}
function merge(existing,incoming){
  if(!existing)return incoming;
  const out={...existing};
  for(const [key,value] of Object.entries(incoming)){
    if(value==null || value==='')continue;
    if(out[key] == null || out[key] === '' ||
       (key==='message' && String(value).length>String(out[key]).length)){
      out[key]=value;
    }
  }
  return out;
}
export function announcementsByCourse(snapshot){
  const courses=(snapshot?.courses||[]).filter(c=>validId(c.id));
  const ids=new Set(courses.map(c=>String(c.id)));
  const raw=new Map();
  const add=(courseId,announcement)=>{
    if(!ids.has(String(courseId))||!validId(announcement?.id))return;
    const key=keyOf(courseId,announcement.id);
    raw.set(key,merge(raw.get(key),announcement));
  };
  for(const item of snapshot?.global?.announcements||[]){
    const courseId=contextCourse(item);
    if(courseId)add(courseId,item);
  }
  for(const course of courses){
    const cd=snapshot.courseData?.[course.id]||{};
    for(const item of cd.announcements||[])add(course.id,item);
    // Canvas's ordinary discussion collection can serve as a fallback when
    // the global /announcements endpoint is unavailable. Only true
    // announcements are eligible; do not mix in regular discussions.
    for(const item of cd.discussions||[]){
      if(item?.is_announcement===true)add(course.id,item);
    }
  }
  const output=new Map(courses.map(course=>[String(course.id),[]]));
  for(const [key,record] of raw){
    const courseId=key.split(':',1)[0];
    const course=courses.find(c=>String(c.id)===courseId);
    if(!course)continue;
    const id=String(record.id);
    const author=record.author?.display_name||record.author?.name||
      record.author?.short_name||record.user_name||record.author_name||null;
    const postedAt=record.posted_at||record.delayed_post_at||record.created_at||null;
    const readState=String(record.read_state||'').toLowerCase();
    output.get(courseId).push({
      courseId,id,
      course:course.course_code||course.name||'Course '+courseId,
      courseName:course.name||'',
      title:record.title||'Untitled announcement',
      html:typeof record.message==='string'?record.message:'',
      author,postedAt,
      updatedAt:record.updated_at||null,
      isUnread:readState==='unread',
      hasReadState:readState==='unread'||readState==='read',
      pinned:record.pinned===true,
      replyCount:typeof record.discussion_subentry_count==='number'
        ?record.discussion_subentry_count:null,
      attachment:record.attachment||null,
      attachments:Array.isArray(record.attachments)?record.attachments:[],
      url:safeOriginalUrl(record.html_url,courseId,id),
    });
  }
  for(const list of output.values())list.sort((a,b)=>
    finite(b.postedAt)-finite(a.postedAt)||Number(b.id)-Number(a.id));
  return output;
}
export function courseAnnouncements(snapshot,courseId){
  if(!validId(courseId))return [];
  return announcementsByCourse(snapshot).get(String(courseId))||[];
}
export function allAnnouncements(snapshot){
  return [...announcementsByCourse(snapshot).values()].flat().sort((a,b)=>
    finite(b.postedAt)-finite(a.postedAt)||
    a.course.localeCompare(b.course)||a.id.localeCompare(b.id));
}
export function announcementInfo(snapshot,courseId,id){
  if(!validId(courseId)||!validId(id))return null;
  return courseAnnouncements(snapshot,courseId).find(a=>a.id===String(id))||null;
}
export function announcementCourses(snapshot){
  const map=announcementsByCourse(snapshot);
  return (snapshot?.courses||[]).map(c=>({
    id:String(c.id),name:c.name||'',code:c.course_code||c.name||'Course '+c.id,
    items:map.get(String(c.id))||[],
  })).filter(c=>c.items.length>0);
}
export function announcementRoute(courseId,id){
  return '#/announcements/course/'+encodeURIComponent(String(courseId))+
    '/announcement/'+encodeURIComponent(String(id));
}
export function announcementCourseRoute(courseId){
  return '#/announcements/course/'+encodeURIComponent(String(courseId));
}
export function parseAnnouncementRoute(hash){
  const value=String(hash||'');
  const a=/^#\/announcements\/course\/(\d+)\/announcement\/(\d+)$/.exec(value);
  if(a)return {courseId:a[1],id:a[2]};
  const b=/^#\/announcements\/course\/(\d+)$/.exec(value);
  return b?{courseId:b[1],id:null}:null;
}
export function resolveSavedAnnouncementLink(snapshot,href,endpoint=''){
  for(const candidate of [endpoint,href]){
    if(!candidate)continue;
    let url;
    try{url=new URL(candidate,BASE);}catch{continue;}
    if(url.origin!==BASE || url.protocol!=='https:')continue;
    let m=/^\/(?:api\/v1\/)?courses\/(\d+)\/discussion_topics\/(\d+)\/?$/.exec(url.pathname);
    if(m?.length===3){
      const known=announcementInfo(snapshot,m[1],m[2]);
      if(known)return known;
    }
    const mod=/^\/courses\/(\d+)\/modules\/items\/(\d+)\/?$/.exec(url.pathname);
    if(!mod)continue;
    const cd=snapshot?.courseData?.[mod[1]]||{};
    for(const module of cd.modules||[]){
      const item=(module.items||[]).find(x=>
        String(x.id)===mod[2] && x.type==='Discussion');
      if(item?.content_id){
        const known=announcementInfo(snapshot,mod[1],item.content_id);
        if(known)return known;
      }
    }
  }
  return null;
}
export function announcementMatchesFilter(a,filter,now=Date.now()){
  if(filter==='recent')return finite(a.postedAt)>=now-7*86400000 && finite(a.postedAt)<=now;
  if(filter==='month')return finite(a.postedAt)>=now-30*86400000 && finite(a.postedAt)<=now;
  if(filter==='unread')return a.hasReadState && a.isUnread;
  if(filter==='pinned')return a.pinned;
  return true;
}

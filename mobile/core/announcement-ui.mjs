import { htmlText } from '../data.mjs';
import {
  allAnnouncements, announcementCourses, courseAnnouncements, announcementInfo,
  announcementMatchesFilter
} from './announcement-data.mjs';
import { renderCanvasContent, contentLinks } from './rich-content.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const countLabel=n=>n===1?'1 announcement':n+' announcements';
function dateLabel(date,short=false){
  const t=Date.parse(date||'');
  if(!Number.isFinite(t))return 'Date unavailable';
  return new Date(t).toLocaleString(undefined,short
    ?{month:'short',day:'numeric',year:'numeric'}
    :{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function matches(announcement,query){
  if(!query)return true;
  return [announcement.title,announcement.course,announcement.courseName,
    announcement.author,htmlText(announcement.html)].some(v=>
    String(v||'').toLowerCase().includes(query));
}
function filters(current){
  return '<div class="assignment-filters announcement-filters" role="group" aria-label="Announcement filters">'+
    [['all','All'],['recent','Past 7 days'],['month','Past 30 days'],
     ['unread','Unread'],['pinned','Pinned']].map(([key,title])=>
      '<button type="button" data-announcement-filter="'+key+'" class="'+
      (key===current?'active':'')+'" aria-pressed="'+String(key===current)+'">'+
      title+'</button>').join('')+'</div>';
}
function courseTile(course){
  return '<button type="button" class="reader-course-tile" data-go-announcement-course="'+
    escape(course.id)+'"><span class="reader-course-mark">◫</span>'+
    '<span class="reader-course-copy"><b>'+escape(course.code)+'</b><small>'+
    escape(course.name||'Course')+'</small></span>'+
    '<span class="assignment-course-meta">'+countLabel(course.items.length)+
    '</span><span class="reader-arrow" aria-hidden="true">›</span></button>';
}
function announcementRow(a,{showCourse=false}={}){
  const desc=htmlText(a.html).slice(0,170);
  return '<button type="button" class="reader-page-row announcement-row"'+
    ' data-open-announcement-course="'+escape(a.courseId)+
    '" data-open-announcement-id="'+escape(a.id)+'">'+
    '<span class="reader-page-icon" aria-hidden="true">◫</span>'+
    '<span class="announcement-row-content"><span class="announcement-row-title">'+
    escape(a.title)+'</span>'+
    '<span class="announcement-row-meta">'+
    (showCourse?'<b>'+escape(a.course)+'</b><span aria-hidden="true"> · </span>':'')+
    escape(dateLabel(a.postedAt,true))+
    (a.author?' · '+escape(a.author):'')+'</span>'+
    (desc?'<span class="announcement-row-preview">'+escape(desc)+'</span>':'')+
    '</span><span class="announcement-row-badges">'+
    (a.pinned?'<span class="announcement-pill">Pinned</span>':'')+
    (a.isUnread?'<span class="announcement-pill unread">Unread</span>':'')+
    '</span><span class="reader-arrow" aria-hidden="true">›</span></button>';
}
function monthGroups(items){
  const result=new Map();
  for(const item of items){
    const time=Date.parse(item.postedAt||'');
    const key=Number.isFinite(time)
      ?new Date(time).toLocaleString(undefined,{month:'long',year:'numeric'})
      :'Undated announcements';
    if(!result.has(key))result.set(key,[]);
    result.get(key).push(item);
  }
  return [...result.entries()].map(([name,records],i)=>
    '<details class="reader-module announcement-month"'+(i<2?' open':'')+'>'+
    '<summary><span class="reader-module-icon" aria-hidden="true">◫</span>'+
    '<span class="reader-module-label">'+escape(name)+'</span>'+
    '<small>'+countLabel(records.length)+'</small>'+
    '<span class="reader-chevron" aria-hidden="true">⌄</span></summary>'+
    '<div class="reader-module-pages">'+
    records.map(a=>announcementRow(a)).join('')+
    '</div></details>').join('');
}
export function buildAnnouncementCatalog(snapshot,courseId='all',query='',filter='all',now=Date.now()){
  const courses=announcementCourses(snapshot);
  const needle=String(query||'').trim().toLowerCase();
  const eligible=a=>matches(a,needle)&&announcementMatchesFilter(a,filter,now);
  const current=courses.find(c=>c.id===String(courseId));
  if(!current){
    const filteredCourses=courses.filter(c=>c.items.some(eligible)||
      (filter==='all'&&needle&&(c.name+' '+c.code).toLowerCase().includes(needle)));
    const items=allAnnouncements(snapshot).filter(eligible);
    const header='<div class="reader-section-heading"><div>'+
      '<div class="reader-kicker">ANNOUNCEMENT CENTRE</div>'+
      '<h2>Announcements</h2><p>Updates from all your Quercus courses, in one place.</p></div>'+
      '<span class="reader-overview-count">'+countLabel(allAnnouncements(snapshot).length)+'</span></div>';
    const library='<div class="announcement-section-title"><h3>Your courses</h3>'+
      '<small>'+filteredCourses.length+' matching</small></div>'+
      '<div class="reader-course-list announcement-course-list">'+
      filteredCourses.map(courseTile).join('')+'</div>';
    const feed='<div class="announcement-section-title"><h3>Latest updates</h3>'+
      '<small>'+countLabel(items.length)+'</small></div>'+
      '<div class="reader-module announcement-feed">'+
      (items.length?items.map(a=>announcementRow(a,{showCourse:true})).join(''):
        '<div class="reader-empty">No announcements match your search and filter.</div>')+
      '</div>';
    return header+filters(filter)+library+feed;
  }
  const eligibleItems=current.items.filter(eligible);
  return '<div class="reader-library-header">'+
    '<button type="button" class="reader-back-link" data-back-announcements>‹ All announcements</button>'+
    '<div class="reader-kicker">COURSE ANNOUNCEMENTS</div><h2>'+escape(current.code)+
    '</h2><p>'+escape(current.name)+' · '+countLabel(current.items.length)+'</p></div>'+
    filters(filter)+'<div class="reader-module-list announcement-timeline">'+
    (eligibleItems.length?monthGroups(eligibleItems):
      '<div class="reader-empty">No announcements match this search or filter.</div>')+'</div>';
}
function attachmentSection(a){
  const map=new Map();
  for(const item of contentLinks(a.html).filter(x=>x.kind==='file')){
    map.set(String(item.fileId),{id:String(item.fileId),label:item.label||'Course attachment'});
  }
  for(const item of [a.attachment,...a.attachments].filter(Boolean)){
    if(!/^\d+$/.test(String(item.id)))continue;
    const id=String(item.id);
    map.set(id,{id,label:item.display_name||item.filename||'Attachment '+id});
  }
  if(!map.size)return '';
  return '<details class="reader-resources" open><summary>Attachments <span>'+
    map.size+'</span></summary><div class="reader-resource-links">'+
    [...map.values()].map(x=>'<a class="canvas-link canvas-file" '+
      'data-canvas-file="'+escape(x.id)+'" '+
      'href="https://q.utoronto.ca/files/'+escape(x.id)+'/download" '+
      'target="_blank" rel="noopener noreferrer">📎 '+escape(x.label)+'</a>').join('')+
    '</div></details>';
}
function outline(items,id){
  return '<aside class="reader-outline" aria-label="Announcements in this course">'+
    '<div class="reader-outline-card"><span class="reader-outline-label">COURSE ANNOUNCEMENTS</span>'+
    '<div class="reader-outline-group">'+items.map(a=>
      '<button type="button" class="'+(a.id===id?'current':'')+
      '" data-open-announcement-course="'+escape(a.courseId)+
      '" data-open-announcement-id="'+escape(a.id)+'">'+
      escape(a.title)+'</button>').join('')+
    '</div></div></aside>';
}
function step(a,label,position){
  return a?'<button type="button" class="reader-step '+position+
    '" data-open-announcement-course="'+escape(a.courseId)+
    '" data-open-announcement-id="'+escape(a.id)+'"><small>'+label+
    '</small><b>'+escape(a.title)+'</b></button>':'<span></span>';
}
export function buildAnnouncementReader(snapshot,courseId,id){
  const a=announcementInfo(snapshot,courseId,id);
  if(!a)return '';
  const all=courseAnnouncements(snapshot,courseId);
  const index=all.findIndex(x=>x.id===a.id);
  const newer=index>0?all[index-1]:null;
  const older=index>=0&&index+1<all.length?all[index+1]:null;
  const body=a.html?renderCanvasContent(a.html).outerHTML:
    '<div class="reader-empty">No announcement body was returned by Quercus. Open the original announcement to read it.</div>';
  const original='<a data-pocket-external class="button outline" href="'+escape(a.url)+
    '" target="_blank" rel="noopener noreferrer">Open in Quercus ↗</a>';
  return '<div class="reader-screen announcement-screen">'+outline(all,a.id)+
    '<div class="reader-article-shell announcement-reader">'+
    '<nav class="reader-breadcrumb"><button type="button" data-back-announcements>Announcements</button>'+
    '<span>›</span><button type="button" data-go-announcement-course="'+escape(a.courseId)+'">'+
    escape(a.course)+'</button></nav>'+
    '<div class="reader-article-top"><div class="reader-kicker">COURSE ANNOUNCEMENT</div>'+
    '<h1>'+escape(a.title)+'</h1><p>'+escape(a.course)+' · '+
    escape(dateLabel(a.postedAt))+'</p></div>'+
    '<div class="announcement-byline">'+
    '<span class="announcement-author-avatar" aria-hidden="true">'+
    escape((a.author||a.course).trim().charAt(0).toUpperCase())+'</span>'+
    '<div><strong>'+escape(a.author||'Course instructor')+'</strong>'+
    '<small>Posted '+escape(dateLabel(a.postedAt))+
    (a.updatedAt&&a.updatedAt!==a.postedAt?' · Updated '+escape(dateLabel(a.updatedAt)):'')+
    '</small></div>'+
    (a.pinned?'<span class="announcement-pill">Pinned</span>':'')+
    (a.isUnread?'<span class="announcement-pill unread">Unread in Quercus</span>':'')+
    '</div>'+
    '<article class="reader-document announcement-document">'+body+
    attachmentSection(a)+'</article>'+
    '<div class="announcement-reader-footer">'+original+
    (a.replyCount!=null?'<p>'+a.replyCount+
      (a.replyCount===1?' discussion reply':' discussion replies')+
      ' recorded by Quercus. Open the original to participate.</p>':'')+
    '<p>Viewing an announcement here does not change its read status in Quercus.</p>'+
    '</div><nav class="reader-pagination" aria-label="Announcement navigation">'+
    step(newer,'‹ Newer announcement','previous')+
    step(older,'Older announcement ›','next')+'</nav></div></div>';
}

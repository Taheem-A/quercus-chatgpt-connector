import {
  assignmentInfo, allAssignmentCourses, courseAssignments, groupedAssignments
} from './assignment-data.mjs';
import {renderCanvasContent, contentLinks} from './rich-content.mjs';

const escape = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const countLabel = n => n===1?'1 assignment':n+' assignments';

function formatDate(value){
  const when=Date.parse(value||'');
  return Number.isFinite(when)?new Date(when).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Not specified';
}

function matches(a,query){
  if(!query)return true;
  const haystack=[a.title,a.course,a.courseName,a.groupName,...a.moduleNames,
    a.descriptionText,a.html].join(' ').toLowerCase();
  return haystack.includes(query);
}

export function assignmentMatchesFilter(a,filter){
  if(filter==='open')return ['open','overdue','missing'].includes(a.statusCode);
  if(filter==='submitted')return ['submitted','graded'].includes(a.statusCode);
  if(filter==='graded')return a.statusCode==='graded';
  return true;
}

function assignmentRow(a){
  return '<button type="button" class="reader-page-row assignment-row" data-open-assignment-course="'+escape(a.courseId)+
    '" data-open-assignment-id="'+escape(a.id)+'"><span class="reader-page-icon">☷</span>'+
    '<span class="reader-page-title"><b>'+escape(a.title)+'</b><small>'+
    (a.dueAt?'Due '+escape(formatDate(a.dueAt)):'No due date')+
    '</small></span><span class="assignment-status status-'+escape(a.statusCode)+'">'+
    escape(a.status)+'</span><span class="reader-arrow" aria-hidden="true">›</span></button>';
}

function courseTile(c){
  const upcoming=c.items.filter(a=>a.dueAt&&Date.parse(a.dueAt)>=Date.now()&&
    ['open','missing','overdue'].includes(a.statusCode)).length;
  return '<button class="reader-course-tile" type="button" data-go-assignment-course="'+escape(c.id)+
    '"><span class="reader-course-mark">☑</span><span class="reader-course-copy"><b>'+
    escape(c.code)+'</b><small>'+escape(c.name||'Course')+'</small></span>'+
    '<span class="assignment-course-meta">'+countLabel(c.items.length)+
    (upcoming?' · '+upcoming+' upcoming':'')+'</span><span aria-hidden="true">›</span></button>';
}

function filterControl(current){
  return '<div class="assignment-filters" role="group" aria-label="Assignment status filter">'+
    [['all','All'],['open','Not submitted'],['submitted','Submitted'],['graded','Graded']]
    .map(([key,label])=>'<button type="button" data-assignment-filter="'+key+
      '" class="'+(key===current?'active':'')+'" aria-pressed="'+String(key===current)+'">'+label+'</button>').join('')+
    '</div>';
}

export function buildAssignmentCatalog(snapshot,activeCourse='all',query='',filter='all'){
  const courses=allAssignmentCourses(snapshot);
  const needle=String(query||'').trim().toLowerCase();
  const eligible=a=>matches(a,needle)&&assignmentMatchesFilter(a,filter);
  const header='<div class="reader-section-heading"><div><div class="reader-kicker">ASSIGNMENT LIBRARY</div>'+
    '<h2>Assignments</h2><p>Browse your course assignments, instructions, due dates and grades.</p></div>'+
    '<span class="reader-overview-count">'+courses.reduce((n,c)=>n+c.items.length,0)+' total</span></div>';
  const selector=filterControl(filter);
  const course=courses.find(c=>String(c.id)===String(activeCourse));
  if(!course){
    const choices=courses.filter(c=>c.items.some(eligible) ||
      (!needle&&filter==='all') || (!needle&&filter!=='all'&&c.items.some(a=>assignmentMatchesFilter(a,filter))) ||
      (needle&&filter==='all'&&(c.code+' '+c.name).toLowerCase().includes(needle)));
    return header+selector+
      '<div class="reader-course-list assignment-course-list">'+choices.map(courseTile).join('')+
      (!choices.length?'<div class="reader-empty">No assignments match your search or filter.</div>':'')+'</div>';
  }
  const groups=groupedAssignments(snapshot,course.id);
  const elements=groups.map((group,i)=>{
    const items=group.items.filter(a=>
      assignmentMatchesFilter(a,filter)&&
      (matches(a,needle)||Boolean(needle&&group.name.toLowerCase().includes(needle))));
    if(!items.length)return '';
    return '<details class="reader-module"'+(needle||i<2?' open':'')+
      '><summary><span class="reader-module-icon">☷</span><span class="reader-module-label">'+
      escape(group.name)+'</span><small>'+countLabel(items.length)+'</small>'+
      '<span class="reader-chevron" aria-hidden="true">⌄</span></summary>'+
      '<div class="reader-module-pages">'+items.map(assignmentRow).join('')+'</div></details>';
  }).join('');
  return '<div class="reader-library-header"><button type="button" data-back-assignments class="reader-back-link">‹ All assignments</button>'+
    '<div class="reader-kicker">COURSE ASSIGNMENTS</div><h2>'+escape(course.code)+
    '</h2><p>'+escape(course.name)+' · '+countLabel(course.items.length)+'</p></div>'+
    selector+'<div class="reader-module-list">'+(elements||
      '<div class="reader-empty">No assignments match your search or filter.</div>')+'</div>';
}

function attachmentLinks(rawHtml,submittedAttachments){
  const body=contentLinks(rawHtml).filter(x=>x.kind==='file');
  const out=new Map();
  for(const file of body)out.set(String(file.fileId),{
    id:file.fileId,name:file.label||'Course attachment',url:file.url
  });
  for(const file of submittedAttachments||[]){
    if(!/^\d+$/.test(String(file.id)))continue;
    out.set(String(file.id),{id:String(file.id),name:file.display_name||file.filename||'Submitted file',
      url:file.html_url||'https://q.utoronto.ca/files/'+file.id+'/download'});
  }
  if(!out.size)return '';
  return '<details class="reader-resources assignment-attachments"><summary>Attachments <span>'+out.size+
    '</span></summary><div class="reader-resource-links">'+[...out.values()].map(file=>
    '<a class="canvas-link canvas-file" data-canvas-file="'+escape(file.id)+'" href="'+
    escape(file.url)+'" target="_blank" rel="noopener noreferrer">📎 '+escape(file.name)+'</a>').join('')+
    '</div></details>';
}

function meta(label,value){
  return '<div class="assignment-meta-item"><small>'+escape(label)+'</small><b>'+
    escape(String(value))+'</b></div>';
}

export function buildAssignmentReader(snapshot,courseId,id){
  const a=assignmentInfo(snapshot,courseId,id);
  if(!a)return '';
  const all=courseAssignments(snapshot,courseId);
  const index=all.findIndex(x=>x.id===String(id));
  const previous=index>0?all[index-1]:null,next=index>=0&&index<all.length-1?all[index+1]:null;
  const button=(item,position)=>item?
    '<button type="button" class="reader-step '+position+'" data-open-assignment-course="'+
    escape(item.courseId)+'" data-open-assignment-id="'+escape(item.id)+'"><small>'+
    (position==='previous'?'‹ Previous assignment':'Next assignment ›')+'</small><b>'+escape(item.title)+'</b></button>':
    '<span></span>';
  let content='';
  if(a.html && a.html.trim())content=renderCanvasContent(a.html).outerHTML;
  else if(a.descriptionText)content='<p class="assignment-plaintext">'+escape(a.descriptionText)+'</p>';
  else content='<p class="reader-empty">No assignment instructions were provided in the synced record. Open the original in Quercus to check for additional details.</p>';
  const gradeDisplay=a.grade!=null?String(a.grade):a.score!=null?String(a.score)+' points':'Not graded';
  const dueText=a.dueAt?formatDate(a.dueAt):'No due date';
  const details= [
    meta('Due',dueText),meta('Points',a.points??'Not specified'),
    meta('Submission',a.status),
    meta('Grade',gradeDisplay)
  ].join('');
  const extra=[];
  if(a.unlockAt)extra.push(meta('Available from',formatDate(a.unlockAt)));
  if(a.lockAt)extra.push(meta('Closes',formatDate(a.lockAt)));
  if(a.submittedAt)extra.push(meta('Submitted',formatDate(a.submittedAt)));
  if(a.attempt!=null)extra.push(meta('Attempt',a.attempt));
  if(a.allowedAttempts!=null&&a.allowedAttempts!==-1)extra.push(meta('Allowed attempts',a.allowedAttempts));
  if(a.submissionTypes.length)extra.push(meta('Submission types',a.submissionTypes.join(', ').replaceAll('_',' ')));
  if(a.late)extra.push(meta('Late submission','Yes (according to Quercus)'));
  if(a.moduleNames.length)extra.push(meta('Appears in Modules',a.moduleNames.join(', ')));
  const url=/^https:\/\/q\.utoronto\.ca\//.test(a.url)?a.url:'https://q.utoronto.ca/courses/'+a.courseId+'/assignments/'+a.id;
  return '<div class="reader-article-shell assignment-reader">'+
    '<nav class="reader-breadcrumb"><button type="button" data-back-assignments>Assignments</button>'+
    '<span>›</span><button type="button" data-go-assignment-course="'+escape(a.courseId)+'">'+
    escape(a.course)+'</button></nav>'+
    '<div class="reader-article-top"><div class="reader-kicker">'+escape(a.groupName||'COURSE ASSIGNMENT')+
    '</div><h1>'+escape(a.title)+'</h1><p>'+escape(a.course)+' · Synced assignment details</p></div>'+
    '<div class="assignment-state"><span class="assignment-status status-'+escape(a.statusCode)+'">'+
    escape(a.status)+'</span>'+(a.late?'<span class="assignment-status status-overdue">Late</span>':'')+
    '</div><div class="assignment-metadata">'+details+'</div>'+
    (extra.length?'<details class="assignment-extra"><summary>More assignment details</summary><div class="assignment-metadata">'+extra.join('')+'</div></details>':'')+
    '<article class="reader-document assignment-document"><h2>Instructions</h2>'+content+
    attachmentLinks(a.html,a.attachments)+'</article>'+
    '<div class="assignment-open-original"><a class="button" href="'+escape(url)+
    '" target="_blank" rel="noopener noreferrer">Open in Quercus'+(a.submitted?'':' to submit')+' ↗</a>'+
    '<p>Quercus Pocket is read-only. Submit work, edit submissions, and check final grading directly in Quercus.</p></div>'+
    '<nav class="reader-pagination" aria-label="Assignment navigation">'+
    button(previous,'previous')+button(next,'next')+'</nav></div>';
}

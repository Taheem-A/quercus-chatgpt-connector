// Pure assignment model for the on-device Quercus Pocket reader.
// The raw Canvas assignment is the source of truth for instructions, due
// dates, points and submission configuration. Derived rows are fallbacks only.

const QUERCUS = 'https://q.utoronto.ca';

const byDate = (a,b) => {
  const left=Date.parse(a.dueAt||'');
  const right=Date.parse(b.dueAt||'');
  if(Number.isFinite(left)&&Number.isFinite(right))return left-right || a.title.localeCompare(b.title);
  if(Number.isFinite(left))return -1;
  if(Number.isFinite(right))return 1;
  return a.title.localeCompare(b.title);
};

function submissionFor(cd,raw) {
  const embedded=raw?.submission;
  const separate=(cd?.submissions || []).find(x=>String(x.assignment_id)===String(raw?.id)) || null;
  if(!embedded || typeof embedded!=='object')return separate;
  if(!separate)return embedded;
  // Keep fields from the detailed submissions endpoint when the embedded
  // assignment submission lacks them; never erase values with undefined.
  return {...separate,...Object.fromEntries(Object.entries(embedded).filter(([,value])=>value!=null))};
}

export function assignmentInfo(snapshot,courseId,assignmentId) {
  if (!snapshot || !/^\d+$/.test(String(courseId)) || !/^\d+$/.test(String(assignmentId)))return null;
  const c=(snapshot.courses || []).find(x=>String(x.id)===String(courseId));
  if(!c)return null;
  const cd=snapshot.courseData?.[courseId] || {};
  const raw=(cd.assignments||[]).find(x=>String(x.id)===String(assignmentId)) || null;
  const derived=(snapshot.derived?.assignments||[]).find(x=>String(x.courseId)===String(courseId) && String(x.id)===String(assignmentId)) || null;
  if(!raw && !derived)return null;
  const submission=raw?submissionFor(cd,raw):null;
  const state=submission?.workflow_state || derived?.workflowState || null;
  const submitted=Boolean(submission?.submitted_at || derived?.submittedAt) || ['submitted','graded','pending_review'].includes(state) || (!submission && Boolean(derived?.submitted));
  const graded=Boolean((submission?.score ?? derived?.score) !== null && (submission?.score ?? derived?.score) !== undefined ||
    (submission?.grade ?? derived?.grade) != null);
  const excused=Boolean(submission?.excused ?? derived?.excused);
  // Derived "missing" can be inferred from the due date, so only label an
  // assignment Missing if Quercus explicitly marks its submission missing.
  const missing=Boolean(submission?.missing);
  const dueAt=raw?.due_at ?? derived?.dueAt ?? null;
  let status='Not submitted';
  let statusCode='open';
  if(excused){status='Excused';statusCode='excused';}
  else if(graded){status='Graded';statusCode='graded';}
  else if(submitted){status='Submitted';statusCode='submitted';}
  else if((raw?.submission_types||[]).some(t=>['none','not_graded'].includes(t))){status='No submission required';statusCode='excused';}
  else if(missing){status='Missing';statusCode='missing';}
  else if(dueAt && Date.parse(dueAt)<Date.now()){status='Past due · no submission recorded';statusCode='overdue';}
  const groupId=raw?.assignment_group_id ?? null;
  const group=(cd.assignmentGroups||[]).find(g=>String(g.id)===String(groupId)) || null;
  const moduleNames=[];
  for(const module of cd.modules||[]){
    if((module.items||[]).some(i=>i.type==='Assignment'&&String(i.content_id)===String(assignmentId)))moduleNames.push(module.name||'Module');
  }
  return {
    courseId:String(courseId),id:String(assignmentId),
    course:c.course_code||c.name||'Course '+courseId,
    courseName:c.name||'',title:raw?.name || derived?.name || 'Assignment '+assignmentId,
    dueAt,
    unlockAt:raw?.unlock_at||null,lockAt:raw?.lock_at||null,
    points:raw?.points_possible ?? derived?.pointsPossible ?? null,
    html:raw?.description ?? '',
    descriptionText:derived?.descriptionText || '',
    url:raw?.html_url || derived?.htmlUrl || QUERCUS+'/courses/'+courseId+'/assignments/'+assignmentId,
    groupId:groupId==null?null:String(groupId),
    groupName:group?.name || null, moduleNames,
    submissionTypes:raw?.submission_types || derived?.submissionTypes || [],
    allowedAttempts:raw?.allowed_attempts ?? null,
    submitted,graded,excused,missing,
    status,statusCode,
    score:submission?.score ?? derived?.score ?? null,
    grade:submission?.grade ?? derived?.grade ?? null,
    submittedAt:submission?.submitted_at ?? derived?.submittedAt ?? null,
    gradedAt:submission?.graded_at ?? null,
    late:Boolean(submission?.late ?? derived?.late),
    attempt:submission?.attempt ?? null,
    submissionUrl:submission?.url || null,
    attachments:Array.isArray(submission?.attachments)?submission.attachments:[],
    submission:submission||null,
    published:raw?.published ?? true,
    hasRaw:Boolean(raw),
  };
}

export function courseAssignments(snapshot,courseId) {
  const cd=snapshot?.courseData?.[courseId]||{};
  const ids=new Set([
    ...(cd.assignments||[]).map(x=>String(x.id)),
    ...(snapshot?.derived?.assignments||[]).filter(x=>String(x.courseId)===String(courseId)).map(x=>String(x.id))
  ]);
  return [...ids].map(id=>assignmentInfo(snapshot,courseId,id)).filter(Boolean).sort(byDate);
}

export function allAssignmentCourses(snapshot) {
  return (snapshot?.courses||[]).map(c=>({
    id:String(c.id), code:c.course_code||c.name||'Course '+c.id,name:c.name||'',
    items:courseAssignments(snapshot,c.id)
  })).filter(c=>c.items.length>0);
}

export function groupedAssignments(snapshot,courseId){
  const cd=snapshot?.courseData?.[courseId]||{};
  const all=courseAssignments(snapshot,courseId);
  const visited=new Set();
  const groups=[];
  for(const group of cd.assignmentGroups || []){
    const ordered=(group.assignments||[]).map(x=>String(x.id));
    const items=all.filter(a=>a.groupId===String(group.id));
    items.sort((a,b)=>{
      const ai=ordered.indexOf(a.id),bi=ordered.indexOf(b.id);
      return ai>=0&&bi>=0 ? ai-bi : ai>=0 ? -1 : bi>=0 ? 1 : byDate(a,b);
    });
    if(items.length){groups.push({id:String(group.id),name:group.name||'Assignment group',items});items.forEach(a=>visited.add(a.id));}
  }
  const remaining=all.filter(a=>!visited.has(a.id));
  if(remaining.length)groups.push({id:'other',name:groups.length?'Other assignments':'Assignments',items:remaining});
  return groups;
}

export function assignmentRoute(courseId,id){
  return '#/assignments/course/'+encodeURIComponent(String(courseId))+'/assignment/'+encodeURIComponent(String(id));
}
export function assignmentCourseRoute(courseId){
  return '#/assignments/course/'+encodeURIComponent(String(courseId));
}
export function parseAssignmentRoute(hash){
  const value=String(hash||'');
  const match=/^#\/assignments\/course\/(\d+)\/assignment\/(\d+)$/.exec(value);
  if(match)return {courseId:match[1],id:match[2]};
  const course=/^#\/assignments\/course\/(\d+)$/.exec(value);
  if(course)return {courseId:course[1],id:null};
  return null;
}

export function resolveSavedAssignmentLink(snapshot,href,endpoint=''){
  for(const candidate of [endpoint,href]){
    if(!candidate)continue;
    let url;
    try{url=new URL(candidate,QUERCUS);}catch{continue;}
    if(url.origin!==QUERCUS)continue;
    let match=/^\/(?:api\/v1\/)?courses\/(\d+)\/assignments\/(\d+)\/?$/.exec(url.pathname);
    if(match){
      const found=assignmentInfo(snapshot,match[1],match[2]);
      if(found)return found;
    }
    match=/^\/courses\/(\d+)\/modules\/items\/(\d+)\/?$/.exec(url.pathname);
    if(match){
      const cd=snapshot?.courseData?.[match[1]]||{};
      for(const mod of cd.modules||[]){
        const item=(mod.items||[]).find(i=>String(i.id)===match[2] && i.type==='Assignment');
        if(item?.content_id){
          const found=assignmentInfo(snapshot,match[1],item.content_id);
          if(found)return found;
        }
      }
    }
  }
  return null;
}

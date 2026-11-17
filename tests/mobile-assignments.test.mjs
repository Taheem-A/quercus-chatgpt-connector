import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentInfo,courseAssignments,allAssignmentCourses,groupedAssignments,
  assignmentRoute,assignmentCourseRoute,parseAssignmentRoute,resolveSavedAssignmentLink
} from '../mobile/core/assignment-data.mjs';
import {buildAssignmentCatalog,buildAssignmentReader,assignmentMatchesFilter} from '../mobile/core/assignment-ui.mjs';

const sample={
  courses:[
    {id:111,course_code:'APS111',name:'Engineering Strategies'},
    {id:188,course_code:'MAT188',name:'Linear Algebra'}
  ],
  courseData:{
    111:{
      assignments:[
        {id:5,name:'Team Charter Revision',description:'<h2>Instructions</h2><p>See <a href="/courses/111/pages/rubric">rubric</a> and <a href="/courses/111/files/900">PDF</a>.</p>',
          assignment_group_id:90,due_at:'2099-11-20T12:00:00Z',points_possible:25,submission_types:['online_upload'],html_url:'https://q.utoronto.ca/courses/111/assignments/5'},
        {id:6,name:'Design Report',assignment_group_id:90,due_at:'2020-11-24T12:00:00Z',points_possible:10,submission_types:['online_upload']},
        {id:7,name:'Participation',assignment_group_id:91,submission_types:['none']}
      ],
      assignmentGroups:[
        {id:90,name:'Project Deliverables',assignments:[{id:6},{id:5}]},
        {id:91,name:'Participation & Engagement'}
      ],
      submissions:[
        {assignment_id:6,workflow_state:'graded',submitted_at:'2020-11-23T20:00:00Z',
          grade:'9/10',score:9,late:false,attempt:1,attachments:[{id:440,display_name:'submission.pdf',html_url:'javascript:alert(1)'}]}
      ],
      modules:[{id:200,name:'Week 10',items:[
        {id:47,type:'Assignment',content_id:5,title:'Team Charter Revision'}
      ]}]
    },
    188:{assignments:[{
      id:10,name:'Linear Algebra Practical',description:'',
      due_at:'2020-10-15T12:00:00Z',submission_types:['online_quiz_entry']
    }],assignmentGroups:[],submissions:[]}
  },
  derived:{assignments:[]}
};

test('assignment details read raw Canvas descriptions, due dates, grades and Module references',()=>{
  const a=assignmentInfo(sample,111,5);
  assert.equal(a.title,'Team Charter Revision');
  assert.equal(a.points,25);
  assert.match(a.html,/href=/);
  assert.deepEqual(a.moduleNames,['Week 10']);
  assert.equal(a.groupName,'Project Deliverables');
  assert.equal(a.status,'Not submitted');
  assert.equal(a.submissionTypes[0],'online_upload');
  const b=assignmentInfo(sample,111,6);
  assert.equal(b.status,'Graded');
  assert.equal(b.grade,'9/10');
  assert.equal(b.score,9);
  assert.equal(b.submitted,true);
  assert.equal(b.attachments[0].id,440);
  assert.equal(assignmentInfo(sample,111,7).status,'No submission required');
  assert.equal(assignmentInfo(sample,188,10).statusCode,'overdue');
  assert.equal(assignmentInfo(sample,111,999),null);
  assert.equal(assignmentInfo(sample,0,5),null);
});

test('assignment groups follow Canvas ordering, count every assignment once and do not fabricate submission status',()=>{
  const groups=groupedAssignments(sample,111);
  assert.deepEqual(groups.map(g=>g.name),['Project Deliverables','Participation & Engagement']);
  assert.deepEqual(groups[0].items.map(a=>a.id),['6','5']);
  assert.equal(courseAssignments(sample,111).length,3);
  assert.equal(allAssignmentCourses(sample).length,2);
  assert.equal(assignmentMatchesFilter(assignmentInfo(sample,111,5),'open'),true);
  assert.equal(assignmentMatchesFilter(assignmentInfo(sample,111,6),'submitted'),true);
  assert.equal(assignmentMatchesFilter(assignmentInfo(sample,111,6),'graded'),true);
  assert.equal(assignmentMatchesFilter(assignmentInfo(sample,111,5),'graded'),false);
});

test('assignment and module-item URLs open in Pocket only if the assignment exists',()=>{
  assert.deepEqual(parseAssignmentRoute(assignmentRoute(111,5)),{courseId:'111',id:'5'});
  assert.deepEqual(parseAssignmentRoute(assignmentCourseRoute(188)),{courseId:'188',id:null});
  assert.equal(parseAssignmentRoute('#/course/111/page/abc'),null);
  assert.equal(resolveSavedAssignmentLink(sample,'https://q.utoronto.ca/courses/111/assignments/5').id,'5');
  assert.equal(resolveSavedAssignmentLink(sample,'/courses/111/modules/items/47').id,'5');
  assert.equal(resolveSavedAssignmentLink(sample,'/courses/111/modules/items/4'),null);
  assert.equal(resolveSavedAssignmentLink(sample,'https://evil.example/courses/111/assignments/5'),null);
  assert.equal(resolveSavedAssignmentLink(sample,'javascript:alert(1)'),null);
  assert.equal(resolveSavedAssignmentLink(sample,'/courses/111/assignments/999'),null);
  assert.equal(resolveSavedAssignmentLink(sample,'/courses/111/pages/rubric',
    '/api/v1/courses/111/assignments/5').id,'5');
});

test('assignment library provides course → group → assignment navigation with search and filters',()=>{
  const library=buildAssignmentCatalog(sample,'all');
  assert.match(library,/ASSIGNMENT LIBRARY/);
  assert.match(library,/data-go-assignment-course="111"/);
  assert.match(library,/data-go-assignment-course="188"/);
  const view=buildAssignmentCatalog(sample,'111');
  assert.match(view,/Project Deliverables/);
  assert.match(view,/Team Charter Revision/);
  assert.match(view,/data-open-assignment-id="5"/);
  const filtered=buildAssignmentCatalog(sample,'111','Charter');
  assert.match(filtered,/Team Charter Revision/);
  assert.doesNotMatch(filtered,/Design Report/);
  const graded=buildAssignmentCatalog(sample,'111','','graded');
  assert.match(graded,/Design Report/);
  assert.doesNotMatch(graded,/Team Charter Revision/);
});

test('assignment detail shows grading/status, Quercus submission CTA and safe attachment fallback',()=>{
  // A plain/empty HTML description can be rendered without a browser DOM.
  const graded=buildAssignmentReader(sample,111,6);
  assert.match(graded,/Design Report/);
  assert.match(graded,/Grade/);
  assert.match(graded,/9\/10/);
  assert.match(graded,/Submitted/);
  assert.match(graded,/data-open-assignment-id="5"/);
  assert.match(graded,/data-canvas-file="440"/);
  assert.doesNotMatch(graded,/javascript:alert/);
  assert.match(graded,/Open in Quercus/);
  assert.match(graded,/read-only/);
  const due=buildAssignmentReader(sample,188,10);
  assert.match(due,/no submission recorded/);
});

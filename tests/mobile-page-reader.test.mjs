import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageRoute, courseRoute, parseReaderRoute, savedPage, resolveSavedPageLink,
  courseModulePages, readingSequence,
} from '../mobile/core/page-router.mjs';
import { buildPageCatalog } from '../mobile/core/page-ui.mjs';
import { describeFilePreview } from '../mobile/core/attachment-preview.mjs';
import { allowedPath, validateTarget } from '../mobile/api/canvas.js';

const snapshot = {
  courses: [
    {id:123,course_code:'APS111',name:'Engineering Strategies'},
    {id:222,course_code:'MAT188',name:'Linear Algebra'},
  ],
  courseData: {
    123: {
      modules:[
        {id:9,name:'Week 10',items:[
          {id:40,type:'Page',page_url:'week-10-to-do',title:'Week 10 To-Do'},
          {id:41,type:'Page',page_url:'assessment-schedule',title:'Assessment Schedule'},
        ]},
        {id:10,name:'Reference',items:[
          {id:44,type:'Page',page_url:'assessment-schedule',title:'Assessment Schedule'},
          {id:48,type:'File',content_id:900,title:'Lecture Slides'},
        ]},
      ],
      pages:[
        {url:'week-10-to-do',title:'Week 10 To-Do',content_status:'retrieved'},
        {url:'assessment-schedule',title:'Assessment Schedule',content_status:'retrieved'},
        {url:'independent',title:'Independent Notes',content_status:'unavailable'},
      ],
      pageDetails:{
        'week-10-to-do':{body:'<p>Find the hidden assignment clue here</p>'},
        'assessment-schedule':{body:'<p>Midterm Thursday</p>'},
      },
    },
    222: {modules:[],pages:[{url:'vectors',title:'Vectors',content_status:'retrieved'}],
      pageDetails:{vectors:{body:'<p>Spans and bases</p>'}}},
  },
};

test('link routing prefers saved pages, including Canvas module-item redirects and API endpoints', () => {
  const a=resolveSavedPageLink(snapshot, '/courses/123/pages/assessment-schedule');
  assert.equal(a.slug,'assessment-schedule');
  assert.equal(a.courseId,'123');
  assert.equal(resolveSavedPageLink(snapshot,
    'https://q.utoronto.ca/courses/123/modules/items/40').slug,'week-10-to-do');
  assert.equal(resolveSavedPageLink(snapshot, '/courses/123/modules/items/41').slug,'assessment-schedule');
  assert.equal(resolveSavedPageLink(snapshot,'/courses/123/pages/missing-page'),null);
  assert.equal(resolveSavedPageLink(snapshot,'https://example.org/courses/123/pages/assessment-schedule'),null);
  assert.equal(resolveSavedPageLink(snapshot,'javascript:alert(1)'),null);
  assert.equal(resolveSavedPageLink(snapshot,
    'https://q.utoronto.ca/courses/123/modules/items/7', 123,
    '/api/v1/courses/123/pages/assessment-schedule').slug,'assessment-schedule');
  assert.equal(resolveSavedPageLink(snapshot,'week-10-to-do',123).slug,'week-10-to-do');
});

test('module hierarchy follows actual Canvas module item order with fallback and deduped reader navigation',()=>{
  const groups=courseModulePages(snapshot,123);
  assert.deepEqual(groups.map(g=>g.name),['Week 10','Reference','Other course pages']);
  assert.equal(groups[0].items[0].title,'Week 10 To-Do');
  assert.equal(groups[2].items[0].slug,'independent');
  assert.deepEqual(readingSequence(snapshot,123).map(x=>x.slug),[
    'week-10-to-do','assessment-schedule','independent',
  ]);
});

test('deep links preserve page identity and browser back routes',()=>{
  const hash=pageRoute(123,'week-10-to-do');
  assert.deepEqual(parseReaderRoute(hash),{courseId:'123',slug:'week-10-to-do'});
  assert.deepEqual(parseReaderRoute(courseRoute(222)),{courseId:'222',slug:null});
  assert.equal(parseReaderRoute('#/course/xx/page/nope'),null);
  assert.equal(savedPage(snapshot,123,'assessment-schedule').title,'Assessment Schedule');
  assert.equal(savedPage(snapshot,123,'missing-page'),null);
});

test('course-library search can match saved page content and preserve course selection',()=>{
  const html=buildPageCatalog(snapshot,'all','hidden assignment');
  assert.match(html,/APS111/);
  assert.doesNotMatch(html,/MAT188/);
  const moduleHtml=buildPageCatalog(snapshot,'123','hidden assignment');
  assert.match(moduleHtml,/Week 10 To-Do/);
  assert.doesNotMatch(moduleHtml,/Assessment Schedule/);
});

test('file viewers prefer Canvas public inline preview and never invent HTTP URLs',()=>{
  const pdf=describeFilePreview({
    id:12,display_name:'lecture.pdf','content-type':'application/pdf',
    url:'https://files.instructure.com/download/12',size:1000,
  },'https://files.instructure.com/inline/12','https://q.utoronto.ca/files/12');
  assert.equal(pdf.kind,'pdf');
  assert.equal(pdf.preview,'https://files.instructure.com/inline/12');
  assert.equal(pdf.download,'https://files.instructure.com/download/12');
  assert.equal(pdf.isPreviewable,true);
  const image=describeFilePreview({
    display_name:'graph.png','content-type':'image/png',url:'https://example.org/graph.png',
  });
  assert.equal(image.kind,'image');
  assert.equal(image.isPreviewable,true);
  const document=describeFilePreview({
    display_name:'handout.docx','content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    url:'https://example.org/handout.docx',preview_url:'https://example.org/doc-preview',
  });
  assert.equal(document.kind,'document');
  assert.equal(document.preview,'https://example.org/doc-preview');
  const unknown=describeFilePreview({display_name:'archive.zip',url:'https://example.org/zip'},'javascript:alert(1)');
  assert.equal(unknown.kind,'unsupported');
  assert.equal(unknown.isPreviewable,false);
});

test('Canvas API relay permits only read-only per-file metadata and official inline-preview URL',()=>{
  assert.equal(allowedPath('/api/v1/files/10'),true);
  assert.equal(allowedPath('/api/v1/files/10/public_url'),true);
  assert.equal(allowedPath('/api/v1/files/10/delete'),false);
  assert.equal(allowedPath('/api/v1/files/10/download'),false);
  assert.equal(validateTarget('/api/v1/files/10/public_url').host,'q.utoronto.ca');
  assert.equal(validateTarget('https://evil.com/api/v1/files/10/public_url'),null);
});

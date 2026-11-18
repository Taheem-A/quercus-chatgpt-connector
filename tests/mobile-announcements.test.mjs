import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  announcementsByCourse,allAnnouncements,courseAnnouncements,announcementInfo,
  announcementCourses,announcementRoute,announcementCourseRoute,
  parseAnnouncementRoute,resolveSavedAnnouncementLink,announcementMatchesFilter
} from '../mobile/core/announcement-data.mjs';
import {buildAnnouncementCatalog,buildAnnouncementReader} from '../mobile/core/announcement-ui.mjs';

const snapshot={
  courses:[
    {id:101,course_code:'APS111',name:'Engineering Strategies'},
    {id:102,course_code:'MAT188',name:'Linear Algebra'},
    {id:103,course_code:'CIV100',name:'Engineering Mechanics'},
  ],
  global:{
    announcements:[
      {id:11,context_code:'course_101',title:'<News> Read this',posted_at:'2026-11-17T12:00:00Z',
        message:'<p>Full assignment message <a href="/courses/101/pages/rubric">Rubric</a>.</p>',
        read_state:'unread',pinned:true,author:{display_name:'Dr. Example'}},
      {id:21,context_code:'course_102',title:'Midterm details',created_at:'2026-10-01T09:00:00Z',
        message:'',attachment:{id:999,display_name:'Midterm.pdf'},html_url:'javascript:alert(1)'},
      {id:300,context_code:'group_101',title:'Unrelated group announcement'}
    ]
  },
  courseData:{
    101:{
      announcements:[
        {id:11,title:'<News> Read this',message:'<p>Full assignment message <a href="/courses/101/pages/rubric">Rubric</a>. <b>More details here.</b></p>'}
      ],
      discussions:[
        {id:11,is_announcement:true,message:'Short'},
        {id:12,is_announcement:true,title:"Tomorrow's review",created_at:'2026-11-16T10:00:00Z',
          message:'<p>Revision session</p>',read_state:'read'},
        {id:90,is_announcement:false,title:'Ordinary discussion',message:'Not an announcement'}
      ],
      modules:[{id:100,name:'Week 10',items:[
        {id:400,type:'Discussion',content_id:12,title:'Tomorrow review'},
        {id:401,type:'Page',page_url:'rubric',title:'Rubric'}
      ]}]
    },
    102:{announcements:[],discussions:[]},
    103:{announcements:[],discussions:[]}
  }
};

test('deduplicates global, per-course and flagged discussion announcements without losing full HTML',()=>{
  const courses=announcementsByCourse(snapshot);
  assert.equal(courses.get('101').length,2);
  assert.equal(courses.get('102').length,1);
  assert.equal(courses.get('103').length,0);
  assert.equal(allAnnouncements(snapshot).length,3);
  assert.equal(courseAnnouncements(snapshot,101)[0].id,'11');
  const a=announcementInfo(snapshot,101,11);
  assert.match(a.html,/More details here/);
  assert.equal(a.author,'Dr. Example');
  assert.equal(a.isUnread,true);
  assert.equal(a.pinned,true);
  assert.equal(announcementInfo(snapshot,101,90),null,'ordinary discussions must be excluded');
  assert.equal(announcementInfo(snapshot,101,999),null);
});

test("uses Quercus's explicit read status only, not reply counts or inferred views",()=>{
  const unread=announcementInfo(snapshot,101,11);
  const read=announcementInfo(snapshot,101,12);
  const unknown=announcementInfo(snapshot,102,21);
  assert.equal(unread.hasReadState,true);
  assert.equal(unread.isUnread,true);
  assert.equal(read.hasReadState,true);
  assert.equal(read.isUnread,false);
  assert.equal(unknown.hasReadState,false);
  assert.equal(unknown.isUnread,false);
  assert.equal(announcementMatchesFilter(unread,'unread'),true);
  assert.equal(announcementMatchesFilter(unknown,'unread'),false);
  assert.equal(announcementMatchesFilter(unread,'pinned'),true);
  assert.equal(announcementMatchesFilter(read,'pinned'),false);
});

test('recent filters use dates and never invent posting timestamps',()=>{
  const now=Date.parse('2026-11-18T00:00:00Z');
  const latest=announcementInfo(snapshot,101,11);
  const old=announcementInfo(snapshot,102,21);
  assert.equal(announcementMatchesFilter(latest,'recent',now),true);
  assert.equal(announcementMatchesFilter(old,'recent',now),false);
  assert.equal(announcementMatchesFilter(latest,'month',now),true);
  assert.equal(announcementMatchesFilter(old,'month',now),false);
  assert.equal(announcementMatchesFilter(old,'all',now),true);
});

test('internal routes and deep links resolve only existing Quercus announcements',()=>{
  assert.deepEqual(parseAnnouncementRoute(announcementRoute(101,12)),{courseId:'101',id:'12'});
  assert.deepEqual(parseAnnouncementRoute(announcementCourseRoute(101)),{courseId:'101',id:null});
  assert.equal(parseAnnouncementRoute('#/announcements/course/invalid/announcement/12'),null);
  assert.equal(resolveSavedAnnouncementLink(snapshot,
    '/courses/101/discussion_topics/11').id,'11');
  assert.equal(resolveSavedAnnouncementLink(snapshot,
    '/api/v1/courses/101/discussion_topics/12').id,'12');
  assert.equal(resolveSavedAnnouncementLink(snapshot,
    '/courses/101/modules/items/400').id,'12');
  assert.equal(resolveSavedAnnouncementLink(snapshot,'/courses/101/modules/items/401'),null);
  assert.equal(resolveSavedAnnouncementLink(snapshot,
    'https://evil.example/courses/101/discussion_topics/11'),null);
  assert.equal(resolveSavedAnnouncementLink(snapshot,'javascript:alert(1)'),null);
  assert.equal(resolveSavedAnnouncementLink(snapshot,'/courses/101/discussion_topics/90'),null);
  assert.equal(announcementInfo(snapshot,102,21).url,
    'https://q.utoronto.ca/courses/102/discussion_topics/21','unsafe original URLs fall back to Quercus');
});

test('announcements catalogue has course entry points, timeline, full-text search and filters',()=>{
  assert.equal(announcementCourses(snapshot).length,2);
  const home=buildAnnouncementCatalog(snapshot,'all','', 'all',Date.parse('2026-11-18T00:00:00Z'));
  assert.match(home,/ANNOUNCEMENT CENTRE/);
  assert.match(home,/data-go-announcement-course="101"/);
  assert.match(home,/data-open-announcement-id="11"/);
  assert.match(home,/data-announcement-filter="unread"/);
  assert.doesNotMatch(home,/Ordinary discussion/);
  assert.doesNotMatch(home,/<News> Read this/,'untrusted title must be escaped');
  assert.match(home,/&lt;News&gt; Read this/);
  const search=buildAnnouncementCatalog(snapshot,'101','More details','all');
  assert.match(search,/&lt;News&gt; Read this/);
  assert.doesNotMatch(search,/Tomorrow&#39;s review/);
  const recent=buildAnnouncementCatalog(snapshot,'101','','recent',Date.parse('2026-11-18T00:00:00Z'));
  assert.match(recent,/November 2026/);
  assert.match(recent,/Tomorrow&#39;s review/);
  const empty=buildAnnouncementCatalog(snapshot,'103');
  assert.match(empty,/CIV100/);
  assert.match(empty,/No announcements match/);
});

test('reader shows source attribution, authorized attachment preview and original Quercus fallback',()=>{
  // The subject has no HTML body here, so this test doesn't depend on a browser DOM.
  const html=buildAnnouncementReader(snapshot,102,21);
  assert.match(html,/Midterm details/);
  assert.match(html,/Author not specified by Quercus/);
  assert.match(html,/Date unavailable|Oct/);
  assert.match(html,/data-canvas-file="999"/);
  assert.match(html,/reader-screen announcement-screen/);
  assert.match(html,/data-pocket-external/);
  assert.match(html,/Open in Quercus/);
  assert.doesNotMatch(html,/javascript:alert/);
  assert.match(html,/Viewing an announcement here does not change its read status/);
});

test('mobile + desktop app wiring preserves Pages, Assignments, More, and uses six-section navigation',()=>{
  const app=readFileSync(new URL('../mobile/app.js',import.meta.url),'utf8');
  const nav=readFileSync(new URL('../mobile/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../mobile/styles.css',import.meta.url),'utf8');
  assert.match(app,/resolveSavedAnnouncementLink/);
  assert.match(app,/navigateAnnouncement\(/);
  assert.match(app,/buildAnnouncementReader/);
  assert.match(app,/pages:snapshotPages,announcements:snapshotAnnouncements,more:snapshotMore/);
  assert.match(nav,/data-view="announcements"/);
  assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css,/\.reader-screen/);
});

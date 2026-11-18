import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLDER_MIME,parseDriveFolderId,courseCode,makeDriveTree,
  proposeCourseMappings,recommendDriveFolder,planDriveUploads
} from '../mobile/core/drive-plan.mjs';

const id=c=>c.repeat(25);
const root=id('R'),mat=id('M'),aps=id('A'),prac=id('P'),tuts=id('T'),
  lectures=id('L'),projects=id('J'),booklets=id('B');
const folder=(id,name,parentId=null)=>({id,name,parentId,mimeType:FOLDER_MIME});
function tree(){
  return makeDriveTree(root,[
    folder(root,'Fall 2026'),
    folder(mat,'MAT188 - Linear Algebra',root),
    folder(aps,'APS111 - Engineering Strategies',root),
    folder(prac,'04 Practice',mat),
    folder(booklets,'Practice Booklets',prac),
    folder(tuts,'02 Tutorials & Practicals',mat),
    folder(lectures,'01 Lectures',mat),
    folder(projects,'05 Assignments & Projects',aps),
    {id:id('X'),name:'Tutorial 03.pdf',mimeType:'application/pdf',parentId:tuts,size:'200'}
  ]);
}
const snapshot=()=>({
  courses:[
    {id:42,course_code:'MAT188H1F - Linear Algebra',name:'Linear Algebra'},
    {id:43,course_code:'APS111',name:'Engineering Strategies'},
    {id:44,course_code:'CIV100',name:'Mechanics'}
  ],
  courseData:{
    42:{
      files:[
        {id:101,display_name:'Practice Booklet 08.pdf',folder_id:70,size:120},
        {id:102,display_name:'Tutorial 03.pdf',size:200},
        {id:103,display_name:'Completely unknown handout.pdf',size:100}
      ],
      folders:[{id:70,name:'Practice Booklets',parent_folder_id:71},
        {id:71,name:'04 Practice'}],
      pages:[],pageDetails:{},assignments:[],announcements:[]
    },
    43:{files:[{id:104,display_name:'Team Charter assignment.pdf',size:300}],
      folders:[],pages:[],pageDetails:{},assignments:[],announcements:[]},
    44:{files:[{id:105,display_name:'Lecture 01.pdf'}],
      folders:[],pages:[],pageDetails:{},assignments:[],announcements:[]}
  },
  global:{}
});
test('accepts only Drive folder URLs or grounded IDs; rejects untrusted URL hosts',()=>{
  assert.equal(parseDriveFolderId('https://drive.google.com/drive/folders/'+root),root);
  assert.equal(parseDriveFolderId('https://drive.google.com/drive/u/0/folders/'+mat),mat);
  assert.equal(parseDriveFolderId(mat),mat);
  assert.equal(parseDriveFolderId('https://evil.example/folders/'+root),null);
  assert.equal(parseDriveFolderId('javascript:alert(1)'),null);
  assert.equal(parseDriveFolderId('..'),null);
});
test('keeps source tree and maps exact UofT course code without relying on full name',()=>{
  const t=tree();
  assert.equal(courseCode(snapshot().courses[0]),'MAT188');
  assert.equal(t.label(booklets),'Fall 2026 / MAT188 - Linear Algebra / 04 Practice / Practice Booklets');
  assert.equal(t.isDescendant(booksFake(),mat),false);
  assert.equal(t.isDescendant(booklets,mat),true);
  const mapping=proposeCourseMappings(snapshot(),t,{});
  assert.equal(mapping['42'].folderId,mat);
  assert.equal(mapping['43'].folderId,aps);
  assert.equal(mapping['44'].folderId,null);
  assert.equal(mapping['44'].method,'unmapped');
});
function booksFake(){return id('Z');}
test('explicit course mapping overrides algorithm but refuses out-of-tree location',()=>{
  const s=snapshot();const t=tree();
  assert.equal(proposeCourseMappings(s,t,{'44':mat})['44'].method,'manual');
  const item=recommendDriveFolder({displayName:'Lecture 01.pdf',folderNames:[],sources:[]},t,mat,lectures);
  assert.equal(item.folderId,lectures);
  assert.equal(item.confidence,'approved');
  const invalid=recommendDriveFolder({displayName:'Lecture 01.pdf'},t,mat,projects);
  assert.equal(invalid.folderId,null);
});
test('unambiguous folder source takes precedence, otherwise stricter category rules or review',()=>{
  const s=snapshot();const t=tree();const result=planDriveUploads(s,t,{});
  const byId=id=>result.rows.find(x=>x.fileId===String(id));
  assert.equal(byId(101).folderId,booklets);
  assert.equal(byId(101).why,'matching-source-folder');
  assert.equal(byId(101).status,'ready');
  assert.equal(byId(102).folderId,tuts);
  assert.equal(byId(102).status,'name-conflict',"never silently overwrite a user's same-name file");
  assert.equal(byId(103).status,'review');
  assert.equal(byId(104).folderId,projects);
  assert.equal(byId(104).status,'ready');
  assert.equal(byId(105).status,'unmapped-course');
  assert.equal(result.counts.ready,2);
  assert.equal(result.counts.review,3);
});
test('app-owned file by Canvas ID is recognized regardless of filename',()=>{
  const t=tree();
  t.nodes.set(id('Y'),{id:id('Y'),name:'old-rename.pdf',parentId:prac,mimeType:'application/pdf',
    appProperties:{quercusPocketFileId:'101'}});
  t.children.get(prac).push(t.nodes.get(id('Y')));
  const plan=planDriveUploads(snapshot(),t,{fileOverrides:{'101':prac}});
  const row=plan.rows.find(x=>x.fileId==='101');
  assert.equal(row.status,'already-uploaded');
  assert.equal(row.existingFileId,id('Y'));
});
test('folder suggestions require a single destination; conflicting title signals stay in review',()=>{
  const t=tree();
  const other={displayName:'Lecture Practice Worksheet.pdf',folderNames:[],sources:[]};
  assert.equal(recommendDriveFolder(other,t,mat).folderId,null);
  assert.equal(recommendDriveFolder(other,t,mat).reason,'multiple-categories');
});

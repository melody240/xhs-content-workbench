import test from 'node:test';
import assert from 'node:assert/strict';
import {collageLayout,preferredColumns} from '../public/collage-layout.js';

test('mixed screenshot ratios fit the 3:4 canvas without cropping, overlap or distortion',()=>{
  const sizes=[{width:1300,height:210},{width:620,height:830},{width:1210,height:185},{width:780,height:610},{width:1024,height:185},{width:1000,height:650}];
  for(const columns of [1,2])for(const title of [true,false]){
    const l=collageLayout(sizes,{columns,title});assert.equal(l.width/l.height,3/4);assert.equal(l.placements.length,sizes.length);
    for(const p of l.placements){assert.ok(p.x>=39.9&&p.y>=(title?209.9:39.9));assert.ok(p.x+p.width<=1160.1&&p.y+p.height<=1560.1);assert.ok(Math.abs(p.width/p.height-sizes[p.index].width/sizes[p.index].height)<1e-8);}
    for(const a of l.placements)for(const b of l.placements)if(a.index!==b.index)assert.ok(a.x+a.width<=b.x+.01||b.x+b.width<=a.x+.01||a.y+a.height<=b.y+.01||b.y+b.height<=a.y+.01);
  }
  assert.equal(preferredColumns([{width:1200,height:200},{width:1600,height:240}]),1);
});

test('scattered packing is repeatable per seed, varies between seeds and never overlaps complete pictures',()=>{
 const sizes=[{width:480,height:160},{width:1080,height:550},{width:600,height:1200},{width:480,height:210},{width:1170,height:1560}];
 for(const columns of [1,2])for(let seed=0;seed<100;seed++){
  const l=collageLayout(sizes,{columns,title:!!(seed%2),mode:'scattered',seed});
  for(const p of l.placements){assert.ok(p.x>=40&&p.y>=40);assert.ok(p.x+p.width<=1160.001&&p.y+p.height<=1560.001);assert.ok(Math.abs(p.width/p.height-sizes[p.index].width/sizes[p.index].height)<1e-7);}
  for(const a of l.placements)for(const b of l.placements)if(a.index!==b.index)assert.ok(a.x+a.width<=b.x+.001||b.x+b.width<=a.x+.001||a.y+a.height<=b.y+.001||b.y+b.height<=a.y+.001);
 }
 assert.deepEqual(collageLayout(sizes,{mode:'scattered',seed:7}),collageLayout(sizes,{mode:'scattered',seed:7}));assert.notDeepEqual(collageLayout(sizes,{mode:'scattered',seed:7}),collageLayout(sizes,{mode:'scattered',seed:8}));
});

const occupied=l=>l.placements.reduce((n,p)=>n+p.width*p.height,0)/(1120*(1600-40-(l.placements.some(p=>p.y<210)?40:210)));
test('Four horizontal X screenshots use mixed full rows rather than a sparse fixed two-column layout',()=>{
 const sizes=[{width:1080,height:591},{width:1080,height:505},{width:1080,height:591},{width:1080,height:548}];
 for(let seed=0;seed<100;seed++){
  const l=collageLayout(sizes,{mode:'scattered',seed,title:true});
  assert.ok(occupied(l)>.75,'screenshots occupy over 75% of the usable content region');
  assert.ok(Math.min(...l.placements.map(p=>p.y))<=234.001,'content starts directly below the title');
  assert.ok(l.placements.filter(p=>p.width>900).length>=2,'at least two screenshots become readable full rows');
 }
});

test('Wide strips get almost the whole available width, with no random half-page blank lead-in',()=>{
 const sizes=Array.from({length:4},()=>({width:1848,height:240}));
 const l=collageLayout(sizes,{mode:'scattered',title:true,seed:32});
 assert.ok(l.placements.every(p=>p.width>1050));assert.ok(Math.min(...l.placements.map(p=>p.y))<=234);
});

test('Small and maximum sets remain finite, below the title, complete, unrotated and non-overlapping',()=>{
 for(const sizes of [Array.from({length:2},()=>({width:1800,height:200})),Array.from({length:18},(_,i)=>({width:i%2?1200:500,height:i%2?250:1400}))])for(const title of [true,false])for(let seed=0;seed<12;seed++){
  const l=collageLayout(sizes,{mode:'scattered',title,seed});assert.equal(l.placements.length,sizes.length);
  for(const p of l.placements){assert.ok(Number.isFinite(p.width)&&p.width>0&&p.height>0);assert.ok(p.x>=40&&p.y>=(title?210:40));assert.ok(p.x+p.width<=1160.001&&p.y+p.height<=1560.001);assert.ok(Math.abs(p.width/p.height-sizes[p.index].width/sizes[p.index].height)<1e-7);}
  for(const a of l.placements)for(const b of l.placements)if(a.index!==b.index)assert.ok(a.x+a.width<=b.x+.001||b.x+b.width<=a.x+.001||a.y+a.height<=b.y+.001||b.y+b.height<=a.y+.001);
 }
 assert.throws(()=>collageLayout([{width:Infinity,height:1},{width:1,height:1}]),/尺寸/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorValue,creatorRangeDays,creatorSnapshot} from '../integrations/creator-metrics.mjs';
test('后台显示单位和未知数保持原意',()=>{for(const [s,n]of [['1.1万',11000],['2,269',2269],['20.9%',20.9],['0',0],['—',null],['',null]])assert.equal(creatorValue(s),n);});
test('核对日期范围，避免切换后误收旧数据',()=>{assert.equal(creatorRangeDays('10-06 至 10-12'),7);assert.equal(creatorRangeDays('09-13 至 10-12'),30);assert.equal(creatorRangeDays('12-28 至 01-03'),7);const v={profile:{redId:'a'},period:30,range:'10-06 至 10-12',metrics:[{key:'likes',display:'2'}]};assert.throws(()=>creatorSnapshot(v,{redId:'a'}),/尚未读取完整/);v.period=7;assert.throws(()=>creatorSnapshot(v,{redId:'b'}),/不一致/);assert.equal(creatorSnapshot(v,{redId:'a'}).metrics.views.value,null);});

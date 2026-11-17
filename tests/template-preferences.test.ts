import test from 'node:test';
import assert from 'node:assert/strict';
import {templateBaselines,templateOverrides} from '../src/config/prompts/templatePreferences';
const t=(template:string)=>({id:'example',name:'测试',template});
test('cached defaults upgrade, custom and unidentified legacy edits survive, retired chat prompts cannot return',()=>{
 const old={example:t('旧默认')},next={example:t('新默认')};
 assert.deepEqual(templateOverrides(next,old,templateBaselines(old)),{});
 assert.equal(templateOverrides(next,{example:t('自定义')},templateBaselines(old)).example.template,'自定义');
 assert.equal(templateOverrides(next,old).example.template,'旧默认','无来源依据不能删除用户可能修改的内容');
 assert.deepEqual(templateOverrides(next,{scriptChat:t('旧聊天'),scriptIdeation:t('旧构思')}),{});
 assert.deepEqual(templateOverrides(next,next),{});
});

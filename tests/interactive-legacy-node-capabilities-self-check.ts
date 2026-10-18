import assert from 'node:assert/strict';

import {
  hasNodeCapability,
  nodeCapabilities,
} from '../src/domains/interactive/nodeContentRequirements.ts';
import type { NarrativeNode } from '../src/domains/interactive/types/schema.ts';

const legacyNode = {
  id: 'legacy-choice',
  brief: {
    nodeId: 'legacy-choice',
    title: '旧版选择节点',
    intent: '验证旧图不会因缺失 capability 合同而白屏',
    dramaticFunction: 'choice_point',
    narrativeSummary: '旧项目保存于 capability 合同引入之前。',
  },
  contract: {
    readVariables: [],
    writeVariables: [],
    requiredFacts: [],
    producedFacts: [],
  },
  choices: [{
    id: 'legacy-choice-1',
    text: '继续',
    intent: '推进故事',
    targetNodeId: 'legacy-ending',
    effects: [],
  }],
  interaction: {},
} as unknown as NarrativeNode;

assert.deepEqual(nodeCapabilities(legacyNode), ['play_content', 'present_choice']);
assert.equal(hasNodeCapability(legacyNode, 'play_content'), true);
assert.equal(hasNodeCapability(legacyNode, 'present_choice'), true);
assert.equal(hasNodeCapability(legacyNode, 'terminal'), false);

const legacyEnding = {
  ...legacyNode,
  id: 'legacy-ending',
  brief: {
    ...legacyNode.brief,
    nodeId: 'legacy-ending',
    title: '旧版结局',
    dramaticFunction: 'ending',
  },
  choices: [],
} as NarrativeNode;

assert.deepEqual(nodeCapabilities(legacyEnding), ['play_content', 'terminal']);

console.log('interactive legacy node capability self-check passed');

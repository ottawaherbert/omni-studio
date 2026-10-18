import assert from 'node:assert/strict';
import { buildVisualPrompt, dedupePromptClauses } from '../src/lib/promptBuilder';

const portraitTags = 'vertical portrait framing, mobile-readable subject, clear face and hand action';

assert.equal(
  dedupePromptClauses([
    `A complete visual prompt, ${portraitTags}`,
    portraitTags,
  ]),
  `A complete visual prompt, ${portraitTags}`,
  'prompt clauses already supplied by the model must not be appended again',
);

const result = buildVisualPrompt({
  id: 'shot-1',
  visualAction: 'A creator enters the room',
  imagePrompt: `A creator enters the room, ${portraitTags}`,
  videoPrompt: `Camera movement: Handheld, Camera movement: Handheld, follow the creator, ${portraitTags}`,
  cameraMovement: 'Handheld',
} as any, {
  type: 'short-drama',
  aspectRatio: '9:16',
} as any);

assert.equal(
  result.imagePrompt,
  `A creator enters the room, ${portraitTags}`,
  'image prompt output must be idempotent',
);
assert.equal(
  result.videoPrompt,
  `Camera movement: Handheld, follow the creator, ${portraitTags}`,
  'video prompt output must remove exact repeated clauses without changing creative content',
);

console.log('Prompt builder self-check passed.');

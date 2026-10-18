import { Project, Shot } from '../types/project';

const normalizePromptClause = (value: string) => {
  let normalized = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replaceAll('\n', ' ')
    .replaceAll('\t', ' ');

  while (normalized.includes('  ')) {
    normalized = normalized.replaceAll('  ', ' ');
  }

  return normalized;
};

export const dedupePromptClauses = (parts: string[]) => {
  const seen = new Set<string>();
  const clauses: string[] = [];

  parts.filter(Boolean).forEach((part) => {
    part.split(',').forEach((rawClause) => {
      const clause = rawClause.trim();
      const normalized = normalizePromptClause(clause);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      clauses.push(clause);
    });
  });

  return clauses.join(', ');
};

export function buildVisualPrompt(shot: Shot, _project: Project | null, _scene?: any) {
  // 1. Extract base elements from the Cinematographer's Brain output
  const {
    imagePrompt: llmImagePrompt,
    videoPrompt: llmVideoPrompt,
    visualAction,
    cameraMovement
  } = shot;

  // 2. Construct Image Prompt
  const coreImagePrompt = llmImagePrompt || visualAction || '';

  // Scene Skill text belongs to prompt authoring, not the final media-model request.
  const finalImagePrompt = dedupePromptClauses([coreImagePrompt]);

  // 4. Construct Video Prompt
  // The LLM has already generated a complete video prompt.
  const coreVideoPrompt = llmVideoPrompt || visualAction || '';
  
  const videoPromptParts = [
    cameraMovement && cameraMovement !== 'Static' ? `Camera movement: ${cameraMovement}` : '',
    coreVideoPrompt,
  ];

  const finalVideoPrompt = dedupePromptClauses(videoPromptParts);

  return {
    imagePrompt: finalImagePrompt,
    videoPrompt: finalVideoPrompt
  };
}

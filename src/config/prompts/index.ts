import { scriptAssistTemplates } from './scriptAssist';
import { PromptTemplate } from './types';

import { bibleTemplates } from './bible';
import { diagnoseTemplates } from './diagnose';
import { episodesTemplates } from './episodes';
import { visualsTemplates } from './visuals';
import { breakdownTemplates } from './breakdown';
import { interactiveTemplates } from './interactive';
import { refineTemplates } from './refine';
import { storyboardVideoTemplates } from './storyboardVideo';
import { shotAnalysisTemplates } from './shotAnalysis';
import { productionTeamTemplates } from './productionTeam';
import { simplePreparationTemplates } from './simplePreparation';

export const defaultTemplates: Record<string, PromptTemplate> = {
  ...scriptAssistTemplates,
  ...bibleTemplates,
  ...diagnoseTemplates,
  ...episodesTemplates,
  ...visualsTemplates,
  ...breakdownTemplates,
  ...interactiveTemplates,
  ...refineTemplates,
  ...storyboardVideoTemplates,
  ...shotAnalysisTemplates,
  ...productionTeamTemplates,
  ...simplePreparationTemplates,
};

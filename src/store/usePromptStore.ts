const retiredScriptPrompts = new Set(["interactiveWritingAuthoring","generateScenes", "generateInteractiveScenes", "expandScene", "regenerateScene", "rewriteScriptBlock", "polishScriptText", "generateInteractiveScript", "showDontTell", "parseScriptBlocks", "generateScript"]);
const activeTemplates = (templates: Record<string, PromptTemplate>) => Object.fromEntries(Object.entries(templates).filter(([id, template]) => template && !retiredScriptPrompts.has(id)));
import { upgradeAppearanceTemplate } from "../config/prompts/appearanceContract";
import { upgradeDirectorPlanTemplate } from "../config/prompts/directorPlanContract";
import { upgradeDirectProductionTemplate } from "../config/prompts/directProductionContract";
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultTemplates, PromptTemplate } from '../config/prompts';
import { upgradeScenePlanSourceContract } from '../config/prompts/scenePlanSourceContract';

interface PromptStore {
  templates: Record<string, PromptTemplate>;
  updateTemplate: (id: string, template: string) => void;
  resetTemplate: (id: string) => void;
}

export const usePromptStore = create<PromptStore>()(
  persist(
    (set) => ({
      templates: defaultTemplates,
      updateTemplate: (id, template) =>
        set((state) => ({
          templates: {
            ...state.templates,
            [id]: { ...state.templates[id], template },
          },
        })),
      resetTemplate: (id) =>
        set((state) => ({
          templates: {
            ...state.templates,
            [id]: defaultTemplates[id],
          },
        })),
    }),
    {
      name: 'omni-prompt-storage',
      version: 65,
      merge: (persistedState: any, currentState: PromptStore) => {
        return {
          ...currentState,
          ...persistedState,
          templates: {
            ...currentState.templates,
            ...activeTemplates(persistedState?.templates || {}),
            planCharacterRoster: currentState.templates.planCharacterRoster,
            planLocationRoster: currentState.templates.planLocationRoster,
            planPropRoster: currentState.templates.planPropRoster,
          },
        };
      },
      migrate: (persistedState: any, version: number) => {
        const state = persistedState as PromptStore;
        let newTemplates = { ...defaultTemplates, ...(state.templates || {}) };
        if (version < 64 && newTemplates.generateShots) {
          newTemplates.generateShots = { ...newTemplates.generateShots, template: upgradeDirectorPlanTemplate(newTemplates.generateShots.template) };
        }

        if (version < 61) {
          const previous = state.templates?.productionAssetCharacterProfile?.template;
          let fingerprint = 2166136261;
          for (const c of previous || '') fingerprint = Math.imul(fingerprint ^ c.charCodeAt(0), 16777619);
          // Only replace the shipped default. Author templates remain editable;
          // the task boundary is also included in currentProfile for legacy templates.
          if (!previous || (fingerprint >>> 0) === 329721191) newTemplates.productionAssetCharacterProfile = defaultTemplates.productionAssetCharacterProfile;
        }

        if (version < 63 && newTemplates.generateShots) {
          newTemplates.generateShots = { ...newTemplates.generateShots, template: upgradeAppearanceTemplate(newTemplates.generateShots.template) };
        }
        if (version < 58) {
          for (const [id, template] of Object.entries(newTemplates)) {
            if (template.template.includes('{{productionTeamContext}}') || template.template.includes('{{filmTeamContext}}') || id === 'productionAssetPreparationBatch') {
              newTemplates[id] = { ...template, template: upgradeDirectProductionTemplate(template.template) };
            }
          }
        }

        // Upgrade only the briefly shipped default; preserve author-edited prompt templates.
        if (version < 57) {
          for (const id of ['productionSimplePlan', 'productionSimpleReview']) {
            const current = defaultTemplates[id];
            const priorDefault = current.template.replace('【相邻场次原文，仅用于承接核对，不纳入本次输出】\n{{adjacentScenes}}\n', '');
            if (!state.templates?.[id] || state.templates[id].template === priorDefault) newTemplates[id] = current;
          }
        }

        // The former combined storyboard prompt overloaded one model call and is no longer a valid workflow.
        delete newTemplates.generatePrompts;
        delete newTemplates.generateMultiGridPrompt;

        if (version < 55) {
          newTemplates['generateImage'] = defaultTemplates['generateImage'];
        }

        if (version < 54) {
          newTemplates['generateVideo'] = defaultTemplates['generateVideo'];
        }

        if (version < 53) {
          newTemplates['productionBreakdownQa'] = defaultTemplates['productionBreakdownQa'];
        }

        if (version < 51) {
          newTemplates['generateShots'] = defaultTemplates['generateShots'];
          newTemplates['generateImagePrompts'] = defaultTemplates['generateImagePrompts'];
          newTemplates['generateVideoPrompts'] = defaultTemplates['generateVideoPrompts'];
        }
        if (version < 48) {
          newTemplates['generateShots'] = defaultTemplates['generateShots'];
        }
        if (version < 47) {
          newTemplates['productionTeamGenerate'] = defaultTemplates['productionTeamGenerate'];
          newTemplates['productionTeamQa'] = defaultTemplates['productionTeamQa'];
          newTemplates['productionTeamOptimize'] = defaultTemplates['productionTeamOptimize'];
        }
        if (version < 46) {
          newTemplates['generateShots'] = defaultTemplates['generateShots'];
        }
        if (version < 45) {
          newTemplates['breakdown'] = defaultTemplates['breakdown'];
          newTemplates['productionBreakdownQa'] = defaultTemplates['productionBreakdownQa'];
          newTemplates['productionBreakdownOptimize'] = defaultTemplates['productionBreakdownOptimize'];
          newTemplates['productionScenePlan'] = defaultTemplates['productionScenePlan'];
          newTemplates['productionScenePlanQa'] = defaultTemplates['productionScenePlanQa'];
          newTemplates['productionScenePlanOptimize'] = defaultTemplates['productionScenePlanOptimize'];
        }
        if (version < 34) {
          newTemplates['productionTeamGenerate'] = defaultTemplates['productionTeamGenerate'];
          newTemplates['productionTeamQa'] = defaultTemplates['productionTeamQa'];
          newTemplates['productionTeamOptimize'] = defaultTemplates['productionTeamOptimize'];
        }
        if (version < 27) {
          newTemplates['productionTeamGenerate'] = defaultTemplates['productionTeamGenerate'];
          newTemplates['productionTeamQa'] = defaultTemplates['productionTeamQa'];
          newTemplates['productionTeamOptimize'] = defaultTemplates['productionTeamOptimize'];
        }
        if (version < 26) {
          newTemplates['productionTeamQa'] = defaultTemplates['productionTeamQa'];
        }
        if (version < 25) {
          newTemplates['productionTeamGenerate'] = defaultTemplates['productionTeamGenerate'];
          newTemplates['productionTeamQa'] = defaultTemplates['productionTeamQa'];
          newTemplates['productionTeamOptimize'] = defaultTemplates['productionTeamOptimize'];
        }
        if (version < 24) {
          newTemplates['breakdown'] = defaultTemplates['breakdown'];
        }
        if (version < 22) {
          newTemplates['productionScenePlan'] = defaultTemplates['productionScenePlan'];
        }
        if (version < 19) {
           newTemplates['generateShots'] = defaultTemplates['generateShots'];
        }
        if (version < 18) {

        }
        if (version < 14) {


        }

        if (version < 12) {
           newTemplates['planCharacterRoster'] = defaultTemplates['planCharacterRoster'];
           newTemplates['planLocationRoster'] = defaultTemplates['planLocationRoster'];
           newTemplates['planPropRoster'] = defaultTemplates['planPropRoster'];
        }

        if (version < 11) {
           newTemplates['generateInteractiveEpisodes'] = defaultTemplates['generateInteractiveEpisodes'];

        }

        // Ensure these critical multi-step templates are always present
        newTemplates['validateCharacters'] = defaultTemplates['validateCharacters'];
        newTemplates['refineCharacters'] = defaultTemplates['refineCharacters'];

        // Force update everything that changed
        if (version < 10) {
           newTemplates['compressGoldenRules'] = defaultTemplates['compressGoldenRules'];
           newTemplates['purifyVisualActions'] = defaultTemplates['purifyVisualActions'];
        }
        
        if (version < 9) {
          Object.keys(defaultTemplates).forEach(k => {
             newTemplates[k] = defaultTemplates[k];
          });
        }
        
        if (version < 7) {
          // Force update diagnose and breakdown templates to grab new context logic
          Object.keys(defaultTemplates).forEach(k => {
             if (k.startsWith('diagnose') || k === 'doctorDiagnose' || k === 'enhanceLogline' || k === 'analyzePacing' || k.startsWith('regenerate')) {
                 newTemplates[k] = defaultTemplates[k];
             }
          });
        }
        if (version < 6) {
          newTemplates['regenerateLogline'] = defaultTemplates['regenerateLogline'];
          newTemplates['regenerateConflict'] = defaultTemplates['regenerateConflict'];
          newTemplates['regenerateArc'] = defaultTemplates['regenerateArc'];
        }
        if (version < 5) {
          // Force update templates to include new ones and language changes
          // Existing ones
          newTemplates['generateSpecificPrompt'] = defaultTemplates['generateSpecificPrompt'];
          newTemplates['generatePanoramaPrompt'] = defaultTemplates['generatePanoramaPrompt'];
          newTemplates['generatePropMultiViewPrompt'] = defaultTemplates['generatePropMultiViewPrompt'];
          newTemplates['generateCharacterMultiViewPrompt'] = defaultTemplates['generateCharacterMultiViewPrompt'];

          newTemplates['generateShots'] = defaultTemplates['generateShots'];
        }
        
        if (version === 0) {
          for (const key in newTemplates) {
            if (newTemplates[key] && typeof newTemplates[key].template === 'string') {
              newTemplates[key].template = newTemplates[key].template.replace(/\\n/g, '\n');
            }
          }
        }
        if (version < 56) {
          for (const id of ['productionScenePlan', 'productionScenePlanOptimize']) {
            newTemplates[id] = { ...newTemplates[id], template: upgradeScenePlanSourceContract(newTemplates[id].template) };
          }
        }
        return {
          ...state,
          templates: activeTemplates(newTemplates),
        };
      },
    }
  )
);

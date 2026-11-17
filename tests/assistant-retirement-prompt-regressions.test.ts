import test from 'node:test';
import assert from 'node:assert/strict';
import { templateBaselines, retiredAssistantPrompts } from '../src/config/prompts/templatePreferences';

// Exercise Zustand's complete persisted hydration rather than the fingerprint helper.
// No browser profile, user library, database or provider is involved.
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
const { defaultTemplates } = await import('../src/config/prompts');
const { usePromptStore } = await import('../src/store/usePromptStore');
const { productionClient } = await import('../src/clients/productionClient');
const { loadProductionPromptTemplate } = await import('../src/services/production/templateLoader');
const key = 'omni-prompt-storage';

function clearRuntimeState() {
  usePromptStore.setState({ templates: { ...defaultTemplates }, builtinSelections: [], baselineHashes: templateBaselines(defaultTemplates) });
}

for (const version of [0, 54, 65, 66]) {
  test(`v${version} hydration preserves author templates and retires assistant templates through the next refresh`, async () => {
    clearRuntimeState();
    const customized = {
      ...defaultTemplates,
      planCharacterRoster: { ...defaultTemplates.planCharacterRoster, template: `AUTHOR_ROSTER_CUSTOM_${version}` },
      generateImage: { ...defaultTemplates.generateImage, template: `AUTHOR_IMAGE_CUSTOM_${version}\\nKeep literal escape` },
      validateCharacters: { ...defaultTemplates.validateCharacters, template: `AUTHOR_VALIDATION_CUSTOM_${version}` },
      refineCharacters: { ...defaultTemplates.refineCharacters, template: `AUTHOR_REFINEMENT_CUSTOM_${version}` },
      breakdown: { ...defaultTemplates.breakdown, template: `${defaultTemplates.breakdown.template}\nAUTHOR_BREAKDOWN_CUSTOM_${version}` },
      ...Object.fromEntries([...retiredAssistantPrompts].map(id => [id, { id, name: '旧助手模板', template: `RETIRED_${id}` }])),
    };
    memory.set(key, JSON.stringify({ version, state: { templates: customized } }));
    await usePromptStore.persist.rehydrate();
    const state = usePromptStore.getState();
    assert.equal(state.templates.validateCharacters.template, `AUTHOR_VALIDATION_CUSTOM_${version}`);
    assert.equal(state.templates.refineCharacters.template, `AUTHOR_REFINEMENT_CUSTOM_${version}`);
    assert.equal(state.templates.breakdown.template, customized.breakdown.template);
    assert.equal(state.templates.generateImage.template, customized.generateImage.template);
    assert.equal(state.templates.planCharacterRoster.template, customized.planCharacterRoster.template);
    for (const id of retiredAssistantPrompts) assert.equal(state.templates[id], undefined, id);
    const migrated = memory.get(key)!;
    assert.equal(JSON.parse(migrated).version, 67);
    assert.ok(migrated.includes(`AUTHOR_VALIDATION_CUSTOM_${version}`));
    assert.ok(migrated.includes(`AUTHOR_REFINEMENT_CUSTOM_${version}`));
    for (const id of retiredAssistantPrompts) assert.equal(JSON.parse(migrated).state.templates[id], undefined, id);
    clearRuntimeState();
    memory.set(key, migrated);
    await usePromptStore.persist.rehydrate();
    assert.equal(usePromptStore.getState().templates.validateCharacters.template, customized.validateCharacters.template);
    assert.equal(usePromptStore.getState().templates.refineCharacters.template, customized.refineCharacters.template);
    for (const id of retiredAssistantPrompts) assert.equal(usePromptStore.getState().templates[id], undefined, id);
  });
}

test('explicit reset survives real persistence and refresh, beats old server templates, and a later edit clears the selection', async () => {
  clearRuntimeState();
  let calls = 0;
  const prior = productionClient.getPromptTemplateContent;
  const serverCustom = `${defaultTemplates.breakdown.template}\nSERVER_OLD_CUSTOM`;
  productionClient.getPromptTemplateContent = async () => { calls += 1; return serverCustom; };
  try {
    // Cached defaults must still allow an actual server custom template before reset.
    assert.equal((await loadProductionPromptTemplate('breakdown', defaultTemplates.breakdown)).template, serverCustom);
    assert.equal(calls, 1);
    usePromptStore.getState().updateTemplate('breakdown', `${defaultTemplates.breakdown.template}\nAUTHOR_CUSTOM`);
    usePromptStore.getState().resetTemplate('breakdown');
    const resetPersisted = memory.get(key)!;
    assert.ok(JSON.parse(resetPersisted).state.builtinSelections.includes('breakdown'));
    clearRuntimeState();
    memory.set(key, resetPersisted);
    await usePromptStore.persist.rehydrate();
    const loaded = await loadProductionPromptTemplate('breakdown', usePromptStore.getState().templates.breakdown);
    assert.equal(loaded.template, defaultTemplates.breakdown.template);
    assert.equal(loaded.trace.source, 'config.defaultTemplates');
    assert.equal(calls, 1, 'explicit default does not read the old server template after a refresh');
    const edited = `${defaultTemplates.breakdown.template}\nAUTHOR_REVISED_AFTER_RESET`;
    usePromptStore.getState().updateTemplate('breakdown', edited);
    assert.ok(!usePromptStore.getState().builtinSelections.includes('breakdown'));
    const custom = await loadProductionPromptTemplate('breakdown', usePromptStore.getState().templates.breakdown);
    assert.equal(custom.template, edited);
    assert.equal(custom.trace.source, 'manual.custom');
    assert.equal(calls, 1);
  } finally { productionClient.getPromptTemplateContent = prior; }
});

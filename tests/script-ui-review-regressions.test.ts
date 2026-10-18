import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createScriptProject } from '../packages/script/src/project';
import { parseScriptProject, type ProjectProfile } from '../packages/script/src/schema';
import { StoryOutlineView } from '../apps/web/src/features/script/components/StoryOutlineView';
import { ScenePlanningView } from '../apps/web/src/features/script/components/ScenePlanningView';
import { ScriptAnalysisView } from '../apps/web/src/features/script/components/ScriptAnalysisView';
import { StructureAnalysisCard } from '../apps/web/src/features/script/components/StructureAnalysisCard';
import { validateStructureAnalysis } from '../packages/script/src/structureAnalysis';

const profile: ProjectProfile = {
  organization: 'standalone',
  continuity: 'mixed',
  workType: '电影',
  genres: ['剧情'],
  language: 'zh-CN',
  plannedUnits: 1,
  targetDurationMs: 60000,
  toleranceMs: 5000,
  includeCredits: false,
  aspectRatio: '16:9',
  productionMode: 'live-action',
};

function elements(node: ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<any>(node)) return [];
  const element = node as React.ReactElement<{ children?: ReactNode }>;
  return [element, ...elements(element.props.children)];
}

test('[P2 - 1] Primary buttons use accessible theme tokens and no invalid bg-primary text-white', () => {
  const indexCss = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
  assert.ok(indexCss.includes('--color-primary: var(--primary);'), 'index.css must define --color-primary in @theme');
  assert.ok(indexCss.includes('--primary: #00cae0;'), 'dark mode must define --primary');
  assert.ok(indexCss.includes('--primary: #008fa3;'), 'light mode must define accessible --primary');

  const filesToCheck = [
    'apps/web/src/features/script/components/StructureAnalysisCard.tsx',
    'apps/web/src/features/script/components/ScriptStructureEditor.tsx',
    'apps/web/src/features/script/components/ScreenplayEditor.tsx',
    'apps/web/src/features/script/components/StoryOutlineView.tsx',
    'apps/web/src/features/script/components/ScenePlanningView.tsx',
    'apps/web/src/features/script/ScriptWorkspace.tsx',
  ];

  for (const rel of filesToCheck) {
    const code = fs.readFileSync(path.resolve(rel), 'utf8');
    assert.ok(
      !code.includes('bg-primary text-white'),
      `${rel} must not use un-themed "bg-primary text-white" which disappears on light surfaces`,
    );
  }
});

test('[P2 - 2] ScriptAnalysisView is constrained by parent container rather than viewport 85vh', () => {
  const analysisCode = fs.readFileSync(path.resolve('apps/web/src/features/script/components/ScriptAnalysisView.tsx'), 'utf8');
  assert.ok(!analysisCode.includes('max-h-[85vh]'), 'ScriptAnalysisView must not use max-h-[85vh]');
  assert.ok(analysisCode.includes('max-h-full'), 'ScriptAnalysisView must use max-h-full');
  assert.ok(analysisCode.includes('h-full'), 'ScriptAnalysisView must use h-full');

  const scriptCss = fs.readFileSync(path.resolve('apps/web/src/features/script/script.css'), 'utf8');
  assert.ok(scriptCss.includes('.script-analysis-layer{position:absolute;inset:0;z-index:20;background:var(--bg-surface);display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;max-height:100%}'));
  assert.ok(scriptCss.includes('.script-analysis-view{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;max-height:100%;overflow:hidden;background:var(--bg-surface)}'));
});

test('[P2 - 3] Directory settings container preserves child component mounting across fold/unfold', () => {
  const outlineCode = fs.readFileSync(path.resolve('apps/web/src/features/script/components/StoryOutlineView.tsx'), 'utf8');
  assert.ok(
    outlineCode.includes("${isSettingsOpen ? 'block' : 'hidden'}"),
    'ScriptStructureEditor must stay mounted using block/hidden class to preserve unsubmitted inputs',
  );
  assert.ok(
    outlineCode.includes('key={`${project.id}:${unit.id}`}'),
    'ScriptStructureEditor must key on project and unit id to avoid bleeding state into other scopes',
  );

  const editorCode = fs.readFileSync(path.resolve('apps/web/src/features/script/components/ScriptStructureEditor.tsx'), 'utf8');
  assert.ok(
    editorCode.includes('setTitle("");') || editorCode.includes("setTitle('');"),
    'ScriptStructureEditor resets title on unit change',
  );
});

test('[P2 - 4] StoryOutlineView non-blocking next step copy is respectful and non-assumptive', () => {
  const outlineCode = fs.readFileSync(path.resolve('apps/web/src/features/script/components/StoryOutlineView.tsx'), 'utf8');
  assert.ok(
    outlineCode.includes('准备好后，可以将大纲事件展开为具体分场。'),
    'Copy must be: 准备好后，可以将大纲事件展开为具体分场。',
  );
  assert.ok(
    !outlineCode.includes('故事脉络已清晰'),
    'Copy must not say "故事脉络已清晰" prematurely',
  );
});

test('[P2 - 5] Primary button states preserve contrast only inside screenplay containers', () => {
  const css = fs.readFileSync(path.resolve('apps/web/src/features/script/script.css'), 'utf8');

  // 1. Generic button:hover must not match primary buttons
  assert.ok(
    !css.includes('.script-work-page button:hover{background:var(--bg-surface-hover)}'),
    'Must not have un-scoped .script-work-page button:hover overriding primary button background',
  );
  assert.ok(
    css.includes('.script-work-page button:not(.script-primary-action):not(.script-primary-btn):not([data-primary="true"]):not(.bg-text-primary):not(:disabled):hover'),
    'Generic hover must exclude primary and disabled buttons',
  );

  // These source checks complement the rendered browser contrast checks.
  const scope = ':where(.script-shared-layout, .script-work-page, .script-writing-editor, .script-analysis-view, .script-chat-shell)';
  const buttons = ':is(.script-primary-action, button.script-primary-btn, button[data-primary="true"], button.bg-text-primary)';
  const rules = Array.from(
    css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
    match => ({ selector: match[1].trim(), declarations: match[2] }),
  );
  const primaryRules = rules.filter(rule => rule.selector.includes(buttons));
  assert.deepEqual(primaryRules.map(rule => rule.selector), [
    `${scope} ${buttons}`,
    `${scope} ${buttons}:not(:disabled):hover`,
    `${scope} ${buttons}:not(:disabled):active`,
  ], 'Every primary state must be scoped, and disabled buttons must retain their opacity');

  for (const rule of primaryRules.slice(0, 2)) {
    assert.match(rule.declarations, /background:\s*var\(--text-primary\)\s*!important/);
    assert.match(rule.declarations, /color:\s*var\(--bg-surface\)\s*!important/);
  }
  assert.match(primaryRules[1].declarations, /opacity:\s*0\.88\s*!important/);
  assert.match(primaryRules[2].declarations, /opacity:\s*0\.95\s*!important/);

  for (const rule of rules.filter(rule => /button(?:\.bg-text-primary|\.script-primary-btn|\[data-primary="true"\])/.test(rule.selector))) {
    assert.ok(rule.selector.startsWith(`${scope} `),
      `Generic primary selectors must remain inside screenplay containers: ${rule.selector}`);
  }

  // 3. Scene sequence number badge must not be overridden by unlayered text-muted
  assert.ok(
    !css.includes('.script-scene-select span{color:var(--text-muted);font-variant-numeric:tabular-nums}'),
    '.script-scene-select span must not force color:var(--text-muted) over child classes',
  );
});

test('[P2 - 6] StructureNodeRow uses controlled inputs synchronized with adopted node content', () => {
  const editorCode = fs.readFileSync(path.resolve('apps/web/src/features/script/components/ScriptStructureEditor.tsx'), 'utf8');

  // 1. Must use controlled StructureNodeRow component
  assert.ok(editorCode.includes('function StructureNodeRow'), 'Must extract StructureNodeRow component');
  assert.ok(editorCode.includes('value={titleValue}'), 'Title input must be controlled with value={titleValue}');
  assert.ok(editorCode.includes('value={purposeValue}'), 'Purpose textarea must be controlled with value={purposeValue}');
  
  // 2. Must synchronize when node content updates (e.g. adopted content)
  assert.ok(
    editorCode.includes('useEffect(() => {\n    setTitleValue(node.title);\n  }, [node.id, node.title]);'),
    'Title value must sync with node.title',
  );
  assert.ok(
    editorCode.includes('useEffect(() => {\n    setPurposeValue(node.purpose || \'\');\n  }, [node.id, node.purpose]);'),
    'Purpose value must sync with node.purpose',
  );

  // 3. Must check equality before committing to prevent stale blur overwrites
  assert.ok(editorCode.includes('if (text !== node.title)'), 'handleTitleBlur must check text !== node.title');
  assert.ok(editorCode.includes('if (purposeValue !== (node.purpose || \'\'))'), 'handlePurposeBlur must check purposeValue !== node.purpose');
});

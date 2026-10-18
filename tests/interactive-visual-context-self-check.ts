import assert from "node:assert";
import {
  buildInteractiveVisualContextProjections,
  buildVisualScenarios,
  computeScenarioReuseFingerprint,
  enumerateReachableEntryStates,
  isObservableStateFact,
  validateInteractiveVisualContextProjection,
} from "../src/domains/interactive/projection/interactiveVisualContextProjection";
import { buildInteractiveSceneVisualContext } from "../src/utils/interactiveSceneVisualContext";
import { buildInteractiveStoryboardInstruction } from "../src/utils/interactiveStoryboardInstruction";
import type { NarrativeGraphVersion, StateSchema } from "../src/domains/interactive/types/schema";
import { selectRuntimeMediaScenario } from "../src/domains/interactive/media/runtimeMediaScenario";
import { stateSchemaAffectedNodeIds } from "../src/domains/interactive/projection/stateSchemaImpact";
import { createInitialStateContext } from "../src/domains/interactive/interpreter/stateInterpreter";
import { interactiveRepository } from "../src/server/interactiveRepository";
import { dbHelpers } from "../src/server/db";
import { createInteractiveProductionPrepPort } from "../src/server/interactiveProductionPrepPort";
import { mediaTakeChecksum, resolveProductionMediaTake } from "../src/server/productionMediaTakeResolver";

/**
 * Self check script for Phase 3: Interactive Visual Context Projection
 * Tests CORE-AUDIT-VISUAL-TEST-001 ~ TEST-005 requirements.
 */

async function runSelfCheck() {
  console.log("Running interactive-visual-context self check (Phase 3 tests)...");

  // TEST-001: Holding key vs not holding key generates 2 distinct scenarios
  const scKey = buildVisualScenarios({ nodeId: "node_101", facts: ["FACT_KEY_OBTAINED"] });
  const scNoKey = buildVisualScenarios({ nodeId: "node_101", facts: [] });
  console.log("[TEST-001 Key Scenarios]:", { key: scKey[0].reuseFingerprint, noKey: scNoKey[0].reuseFingerprint });
  assert.notStrictEqual(scKey[0].reuseFingerprint, scNoKey[0].reuseFingerprint, "Holding key vs no key MUST have distinct fingerprints!");

  // TEST-002: Hidden favorability score change does NOT generate extra visual scenario
  const isFavObservable = isObservableStateFact("favorability_score_50");
  assert.strictEqual(isFavObservable, false, "Internal favorability score MUST NOT be treated as an observable visual fact!");
  const scFavA = buildVisualScenarios({ nodeId: "node_102", facts: ["favorability_score_50"] });
  const scFavB = buildVisualScenarios({ nodeId: "node_102", facts: ["favorability_score_90"] });
  assert.strictEqual(scFavA[0].reuseFingerprint, scFavB[0].reuseFingerprint, "Favorability changes MUST share same fingerprint!");

  // TEST-003: Injured vs non-injured MUST NOT reuse same formal media
  const scInjured = buildVisualScenarios({ nodeId: "node_103", facts: ["CHARACTER_INJURED"] });
  const scNormal = buildVisualScenarios({ nodeId: "node_103", facts: [] });
  assert.notStrictEqual(scInjured[0].reuseFingerprint, scNormal[0].reuseFingerprint, "Injured and normal states MUST NOT reuse media!");

  // TEST-004: Two internal state sets with identical visual facts share 1 reuseFingerprint
  const fp1 = computeScenarioReuseFingerprint({ observableFacts: ["FACT_RAIN", "FACT_TORCH"] });
  const fp2 = computeScenarioReuseFingerprint({ observableFacts: ["FACT_TORCH", "FACT_RAIN"] }); // sorted
  assert.strictEqual(fp1, fp2, "Identical visual facts MUST produce identical reuseFingerprint regardless of array order!");

  // TEST-005: Shot prompt delta reflects visual state
  assert.strictEqual(scInjured[0].shotPromptDelta.includes("CHARACTER_INJURED"), true);
  assert.ok(scInjured[0].entryPredicate, "Observable state must compile to an entry predicate.");

  const studioContext = buildInteractiveSceneVisualContext({
    id: "scene_1",
    sceneNumber: "1",
    title: "伤后会合",
    description: "",
    interactiveMetadata: {
      nodeIds: ["node_103"],
      incomingContext: "主角被碎玻璃划伤左臂后进入房间",
      outgoingContext: "伤口仍在流血",
      outboundChoices: [{ label: "包扎伤口", targetNodeId: "node_104" }],
      requiredFacts: ["CHARACTER_INJURED", "favorability_score_50"],
      producedFacts: [],
    },
  } as any);
  assert.match(studioContext, /CHARACTER_INJURED/);
  assert.doesNotMatch(studioContext, /favorability_score_50/);
  const storyboardInstruction = buildInteractiveStoryboardInstruction({
    id: "scene_1",
    sceneNumber: "1",
    title: "伤后会合",
    description: "",
    interactiveMetadata: {
      nodeIds: ["node_103"],
      incomingContext: "主角被碎玻璃划伤左臂后进入房间",
      outboundChoices: [{ label: "包扎伤口", targetNodeId: "node_104" }],
    },
  } as any);
  assert.match(storyboardInstruction, /第一镜必须.*承接这个物理结果/);
  assert.match(storyboardInstruction, /最后一镜必须是“互动待机循环”/);
  assert.match(storyboardInstruction, /三分之一安全区/);

  const stateSchema: StateSchema = {
    variables: [{ key: "favorability_score", type: "number", scope: "session", defaultValue: 0 }],
    factDefinitions: ["FACT_KEY_OBTAINED", "favorability_score_50"],
    initialFactIds: [],
  };
  const graph: NarrativeGraphVersion = {
    id: "graph_visual",
    experienceId: "experience_visual",
    versionIndex: 1,
    entryNodeId: "entry",
    locked: false,
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: "entry",
        brief: {
          nodeId: "entry",
          title: "入口",
          intent: "决定是否拿钥匙",
          dramaticFunction: "choice_point",
          narrativeSummary: "钥匙放在桌上。",
        },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        interaction: {
          capabilities: ["present_choice", "apply_state_effect"],
          contentPolicy: "no_new_content",
          durationRangeSec: [5, 10],
          playerKnowledgeIn: [],
          playerKnowledgeOut: ["是否拿到钥匙"],
        },
        choices: [
          { id: "take", text: "拿钥匙", intent: "携带钥匙", effects: [{ type: "add_fact", fact: "FACT_KEY_OBTAINED" }], targetNodeId: "meeting" },
          { id: "leave", text: "不拿", intent: "空手离开", effects: [], targetNodeId: "meeting" },
        ],
      },
      {
        id: "meeting",
        brief: {
          nodeId: "meeting",
          title: "门前会合",
          intent: "在门前检查装备",
          dramaticFunction: "ending",
          narrativeSummary: "主角来到锁住的门前。",
        },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        interaction: {
          capabilities: ["play_content", "terminal"],
          contentPolicy: "compatible_state_reuse",
          durationRangeSec: [30, 45],
          playerKnowledgeIn: ["是否拿到钥匙"],
          playerKnowledgeOut: ["能否开门"],
        },
        choices: [],
      },
      {
        id: "isolated-checkpoint",
        brief: {
          nodeId: "isolated-checkpoint",
          title: "独立检查点",
          intent: "保留独立流程",
          dramaticFunction: "resolution",
          narrativeSummary: "该检查点不受门前分支影响。",
        },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        interaction: {
          capabilities: ["checkpoint"],
          contentPolicy: "no_new_content",
          durationRangeSec: [1, 1],
          playerKnowledgeIn: [],
          playerKnowledgeOut: [],
        },
        choices: [],
      },
    ],
  };
  const enumeration = enumerateReachableEntryStates({ graph, stateSchema });
  assert.strictEqual(enumeration.statesByNodeId.get("meeting")?.length, 2);
  assert.strictEqual(enumeration.truncated, false);
  assert.deepStrictEqual(
    [...stateSchemaAffectedNodeIds(graph, stateSchema, {
      ...stateSchema,
      initialFactIds: ["FACT_KEY_OBTAINED"],
    })].sort(),
    ["entry", "meeting"],
    "A state-rule change must affect its writer and downstream node without invalidating an isolated branch",
  );
  const projections = buildInteractiveVisualContextProjections({
    experienceId: graph.experienceId,
    graph,
    stateSchemaVersionId: "state_visual",
    stateSchema,
    bindings: [],
    productionProjectId: "production_visual",
    sources: [{
      productionSceneId: "scene_meeting",
      nodeIds: ["meeting"],
      continuityIn: ["承接玩家是否拿走钥匙的结果"],
      continuityOut: ["停在门锁前等待下一步"],
      canonicalAssetRefs: ["character_protagonist", "location_locked_door"],
      characterVariantRefs: ["variant_character_night_coat"],
      environmentChanges: ["门厅：应急灯闪烁"],
    }],
  });
  assert.strictEqual(projections[0].scenarios.length, 2, "Reachable key/no-key states must become two persisted scenarios");
  assert.deepStrictEqual(validateInteractiveVisualContextProjection(projections[0]), []);
  assert.deepStrictEqual(
    projections[0].scenarios[0].canonicalAssetRefs,
    ["character_protagonist", "location_locked_door"],
    "Projection must freeze canonical assets used by the production scene",
  );
  assert.match(projections[0].scenarios[0].shotPromptDelta, /应急灯闪烁/);
  const noKeyContext = createInitialStateContext(stateSchema);
  const keyContext = { ...noKeyContext, facts: new Set(["FACT_KEY_OBTAINED"]) };
  const noKeyScenario = selectRuntimeMediaScenario(projections[0].scenarios, noKeyContext);
  const keyScenario = selectRuntimeMediaScenario(projections[0].scenarios, keyContext);
  assert.ok(noKeyScenario && keyScenario);
  assert.notStrictEqual(noKeyScenario.id, keyScenario.id, "Runtime must select media from the frozen visible state");

  const aggregate = interactiveRepository.createExperience({
    title: "视觉状态持久化验收",
    genre: "悬疑",
    formatProfile: {
      format: "branching_fmv",
      aspectRatio: "16:9",
      platforms: ["web"],
      primaryLanguage: "zh-CN",
      targetSessionMinutes: 10,
      targetCompleteMinutes: 15,
    },
    experienceSpec: {
      playerRole: "调查者",
      playerPersona: "谨慎",
      interactionPromise: "选择改变可见结果",
      coreVerbs: ["选择"],
      dramaticContract: { genre: "悬疑", theme: "代价", centralConflict: "拿或不拿" },
      choiceCadence: { targetChoicesPerTenMinutes: 3, maxMinutesWithoutChoice: 4 },
      consequenceHorizon: ["immediate"],
      failStatePolicy: "rollback",
      savePolicy: "auto_checkpoint",
      accessibilitySettings: { closedCaptions: true, timedChoiceOption: "extended", colorBlindSafe: true },
    },
    storyArchitecture: {
      premise: "门前选择",
      protagonistGoal: "决定是否携带钥匙进入门后",
      thematicQuestion: "谨慎是否值得",
      mandatoryNodes: [],
      variableNodes: [],
      endings: [],
      branchBudget: { maxDepth: 2, maxParallelBranches: 2 },
    },
    storySource: { mode: "scratch" },
    productionBoundary: {
      maxBranchDepth: 2,
      maxParallelBranches: 2,
      exclusiveContentPercent: 30,
      maxAutomaticRepairAttempts: 1,
    },
  });
  try {
    const withState = interactiveRepository.saveStateSchema(aggregate.experience.id, stateSchema);
    const saved = interactiveRepository.saveGraph(aggregate.experience.id, {
      entryNodeId: graph.entryNodeId,
      nodes: graph.nodes,
    });
    const scriptRef = {
      artifactId: "script:meeting",
      versionId: "script-v1",
      kind: "script_scene" as const,
      checksum: "script-checksum",
    };
    const withBinding = interactiveRepository.saveBinding(aggregate.experience.id, {
      nodeId: "meeting",
      slot: "main",
      scriptSceneRefs: [scriptRef],
      status: "approved",
      contentFitReview: {
        verdict: "pass",
        rationale: "正式剧本覆盖门前会合节点。",
        reviewedAt: new Date().toISOString(),
        sceneChecksums: [scriptRef.checksum],
      },
    });
    const persistedProjections = buildInteractiveVisualContextProjections({
      experienceId: aggregate.experience.id,
      graph: saved.graph,
      stateSchemaVersionId: withState.stateSchema.id,
      stateSchema,
      bindings: withBinding.bindings,
      productionProjectId: aggregate.experience.projectId,
      sources: [
        {
          productionSceneId: "scene_meeting",
          nodeIds: ["meeting"],
          canonicalAssetRefs: ["character_protagonist", "location_locked_door"],
          characterVariantRefs: ["variant_character_night_coat"],
        },
        {
          productionSceneId: "scene_meeting_followup",
          nodeIds: ["meeting"],
          canonicalAssetRefs: ["character_protagonist", "location_corridor"],
          characterVariantRefs: ["variant_character_wet_coat"],
        },
        { productionSceneId: "scene_isolated", nodeIds: ["isolated-checkpoint"] },
      ],
    });
    const persistedProjection = persistedProjections.find(
      (projection) => projection.productionSceneId === "scene_meeting",
    )!;
    dbHelpers.saveProject({
      id: aggregate.experience.projectId,
      title: "视觉状态制片失效验收",
      type: "movie",
      aspectRatio: "16:9",
      characters: [],
      assets: [],
      episodes: [{
        id: "production_episode_visual",
        title: "视觉状态验收",
        scenes: [{
          id: "scene_meeting",
          sceneNumber: "1",
          title: "门前会合",
          description: "测试旧媒体失效",
          valueCharge: "neutral",
          interactiveMetadata: { nodeIds: ["meeting"] },
          shots: [{
            id: "shot_visual",
            duration: 5,
            videoMedia: {
              url: "/visual-old.mp4",
              kind: "video",
              source: "manual",
              status: "ready",
              createdAt: Date.now(),
            },
            takes: [{
              id: "take_visual",
              videoUrl: "/visual-old.mp4",
              videoMedia: {
                url: "/visual-old.mp4",
                kind: "video",
                source: "manual",
                status: "ready",
                createdAt: Date.now(),
              },
              generationAudit: {
                action: "generate_video",
                targetKind: "shot",
                shotId: "shot_visual",
                sourceHash: "source-old",
                promptHash: "prompt-old",
                modelId: "manual",
                selectedSkillIds: [],
                selectedSkillTitles: [],
                selectedContextIds: [],
                selectedAssetIds: [],
                selectedAssetBoardItemIds: [],
                referenceImageUrls: [],
                visualScenarioId: persistedProjection.scenarios[0].id,
                visualStateFingerprint: persistedProjection.scenarios[0].stateFingerprint,
                visualReuseFingerprint: persistedProjection.scenarios[0].reuseFingerprint,
                createdAt: Date.now(),
              },
              createdAt: Date.now(),
            }],
            activeTakeId: "take_visual",
          }],
          manualStoryboard: {
            schemaVersion: "manual-storyboard.v1",
            boards: [{
              id: "board_visual",
              shotId: "shot_visual",
              confirmedAt: Date.now(),
              updatedAt: Date.now(),
              strategyDecision: {
                visualTakes: [{ id: "board_take_visual", status: "adopted" }],
                activeVisualTakeId: "board_take_visual",
              },
            }],
            updatedAt: Date.now(),
          },
        }, {
          id: "scene_meeting_followup",
          sceneNumber: "2",
          title: "门后余波",
          description: "与门前会合共享可见状态的第二个制片场次",
          valueCharge: "neutral",
          interactiveMetadata: { nodeIds: ["meeting"] },
          shots: [],
        }],
      }],
      interactiveProductionPrepProfile: {
        schemaVersion: "interactive-production-prep.v2",
        experienceId: aggregate.experience.id,
        graphVersionId: saved.graph.id,
        entryNodeId: saved.graph.entryNodeId,
        sourceWritingProjectId: "writing-visual",
        sourceWritingRevision: 1,
        sourceHash: "source-visual",
        createdAt: Date.now(),
        nodes: [],
      },
    } as any);
    interactiveRepository.replaceVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
      persistedProjections,
    );
    assert.strictEqual(
      interactiveRepository.listVisualContextProjections(
        aggregate.experience.id,
        aggregate.experience.projectId,
      ).filter((projection) => projection.status !== "stale").length,
      3,
      "Visual projection must round-trip through repository storage",
    );
    const summaryOnlyGraphRevision = interactiveRepository.saveGraph(aggregate.experience.id, {
      entryNodeId: saved.graph.entryNodeId,
      nodes: saved.graph.nodes.map((node) => node.id === "entry"
        ? { ...node, brief: { ...node.brief, narrativeSummary: "钥匙仍在桌上，文字说明更清楚。" } }
        : node),
    });
    const afterSummaryOnlyChange = interactiveRepository.listVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
    );
    assert.strictEqual(
      afterSummaryOnlyChange.find((projection) => projection.productionSceneId === "scene_meeting")?.status,
      "adopted",
      "Editing an upstream title or summary must not invalidate downstream visual scenarios",
    );
    assert.strictEqual(
      afterSummaryOnlyChange.find((projection) => projection.productionSceneId === "scene_meeting")?.graphVersionId,
      summaryOnlyGraphRevision.graph.id,
      "Unaffected downstream visual scenarios should be rebased to the new graph revision",
    );

    const [firstScenario, secondScenario] = persistedProjection.scenarios;
    const sharedTake = {
      artifactId: "take:shared",
      versionId: "take-v1",
      kind: "media_take" as const,
      checksum: "take-shared",
    };
    assert.throws(() => interactiveRepository.saveBinding(aggregate.experience.id, {
      ...withBinding.bindings.find((binding) => binding.nodeId === "meeting")!,
      mediaScenarios: [
        {
          scenarioId: firstScenario.id,
          stateFingerprint: firstScenario.stateFingerprint,
          reuseFingerprint: firstScenario.reuseFingerprint,
          mediaTakeRefs: [sharedTake],
        },
        {
          scenarioId: secondScenario.id,
          stateFingerprint: secondScenario.stateFingerprint,
          reuseFingerprint: secondScenario.reuseFingerprint,
          mediaTakeRefs: [sharedTake],
        },
      ],
    }), /同一个正式视频不能用于两个可见状态不同的画面情境/);

    const meetingProjections = persistedProjections.filter((projection) => projection.nodeIds.includes("meeting"));
    const allProductionScenarios = meetingProjections.flatMap((projection) => projection.scenarios);
    const mediaProject = structuredClone(dbHelpers.getProjectById(aggregate.experience.projectId)!);
    const scenarioTakes = allProductionScenarios.map((scenario, index) => {
      const projection = meetingProjections.find((item) => item.scenarios.some((candidate) => candidate.id === scenario.id))!;
      const episode = mediaProject.episodes[0];
      const scene = episode.scenes.find((item) => item.id === projection.productionSceneId)!;
      const shotId = `shot_scenario_${index}`;
      const takeId = `take_scenario_${index}`;
      const media = { url: `/visual-scenario-${index}.mp4`, kind: 'video' as const, source: 'upload' as const, status: 'ready' as const, createdAt: Date.now() };
      scene.shots.push({
        id: shotId, duration: 5, videoMedia: media, activeTakeId: takeId,
        takes: [{ id: takeId, videoUrl: media.url, videoMedia: media, createdAt: media.createdAt,
          generationAudit: { action: 'generate_video', targetKind: 'shot', shotId,
            sourceHash: `scenario-${index}`, promptHash: `scenario-${index}`, modelId: 'manual',
            selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [], selectedAssetIds: [],
            selectedAssetBoardItemIds: [], referenceImageUrls: [],
            visualScenarioId: scenario.id, visualStateFingerprint: scenario.stateFingerprint,
            visualReuseFingerprint: scenario.reuseFingerprint, createdAt: media.createdAt } }],
      } as any);
      const checksum = mediaTakeChecksum({ projectId: mediaProject.id, episodeId: episode.id, sceneId: scene.id, shotId, takeId, media });
      return { scenario, ref: { artifactId: `production-media-take:${mediaProject.id}:${episode.id}:${scene.id}:${shotId}:${takeId}`,
        versionId: `media-${checksum.slice(0, 16)}`, kind: 'media_take' as const, checksum } };
    });
    dbHelpers.saveProject(mediaProject);
    scenarioTakes.forEach(({ ref }) => assert.ok(resolveProductionMediaTake(ref, 'meeting'), 'Scenario take must be a real resolvable production asset'));
    const ready = interactiveRepository.saveBinding(aggregate.experience.id, {
      ...withBinding.bindings.find((binding) => binding.nodeId === "meeting")!,
      mediaTakeRefs: scenarioTakes.map((item) => item.ref),
      mediaScenarios: scenarioTakes.map(({ scenario, ref }) => ({
        scenarioId: scenario.id,
        stateFingerprint: scenario.stateFingerprint,
        reuseFingerprint: scenario.reuseFingerprint,
        mediaTakeRefs: [ref],
      })),
      visibleStateSignature: allProductionScenarios.map((scenario) => scenario.reuseFingerprint).sort().join("|"),
      reusePolicy: "compatible_states_only",
      mediaFitReview: {
        verdict: "pass",
        rationale: "两种可见状态分别采用独立视频。",
        reviewedAt: new Date().toISOString(),
        mediaChecksums: scenarioTakes.map((item) => item.ref.checksum),
      },
    });
    interactiveRepository.saveProductionPrepTarget({
      experienceId: aggregate.experience.id,
      productionProjectId: aggregate.experience.projectId,
      sourceWritingProjectId: "writing-visual",
      sourceWritingRevision: 1,
      sourceHash: "source-visual",
    });
    const runtimeBuild = interactiveRepository.createRuntimeBuild(aggregate.experience.id);
    assert.strictEqual(runtimeBuild.status, "ready_for_player");
    assert.strictEqual(
      runtimeBuild.nodeManifests.find((manifest) => manifest.nodeId === "meeting")?.mediaScenarios?.length,
      2,
      "Runtime Build must group production-scene variants into two player-state alternatives",
    );
    assert.strictEqual(
      runtimeBuild.nodeManifests.find((manifest) => manifest.nodeId === "meeting")
        ?.mediaScenarios?.every((scenario) => scenario.mediaTakeRefs.length === 2),
      true,
      "Each runtime state must keep ordered media from both production scenes",
    );
    assert.strictEqual(ready.bindings.find((binding) => binding.nodeId === "meeting")?.mediaScenarios?.length, 4);

    const followupProjection = meetingProjections.find((projection) => (
      projection.productionSceneId === "scene_meeting_followup"
    ))!;
    interactiveRepository.replaceVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
      persistedProjections.filter((projection) => projection.id !== followupProjection.id),
    );
    const partiallyStaleBinding = interactiveRepository.getExperience(aggregate.experience.id).bindings
      .find((binding) => binding.nodeId === "meeting")!;
    interactiveRepository.saveBinding(aggregate.experience.id, {
      ...partiallyStaleBinding,
      mediaFitReview: {
        ...partiallyStaleBinding.mediaFitReview!,
        reviewedAt: new Date(Date.now() + 10).toISOString(),
      },
    });
    const partiallyStaleBuild = interactiveRepository.createRuntimeBuild(aggregate.experience.id);
    const partiallyStaleManifest = partiallyStaleBuild.nodeManifests
      .find((manifest) => manifest.nodeId === "meeting");
    assert.strictEqual(partiallyStaleBuild.status, "waiting_for_media");
    assert.strictEqual(
      partiallyStaleManifest?.mediaScenarios?.every((scenario) => scenario.mediaTakeRefs.length === 0),
      true,
      "One stale Production scene must block reuse even when another current scene has the same state fingerprint",
    );
    interactiveRepository.replaceVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
      persistedProjections,
    );
    const restoredProjectionBinding = interactiveRepository.getExperience(aggregate.experience.id).bindings
      .find((binding) => binding.nodeId === "meeting")!;
    interactiveRepository.saveBinding(aggregate.experience.id, {
      ...restoredProjectionBinding,
      mediaFitReview: {
        ...restoredProjectionBinding.mediaFitReview!,
        reviewedAt: new Date(Date.now() + 20).toISOString(),
      },
    });

    let generatorCalls = 0;
    const productionPort = createInteractiveProductionPrepPort({
      scriptRepository: {} as any,
      writingPort: {} as any,
      visualRefinementGenerator: async () => {
        generatorCalls += 1;
        return {
          label: "钥匙在手的警觉状态",
          environmentChanges: ["门锁反射出钥匙的冷光"],
          performanceConstraints: ["主角握紧钥匙，视线先扫过门缝再看向门锁"],
          rationale: "让玩家刚才的选择直接出现在画面和动作里。",
        };
      },
    });
    const candidate = await productionPort.createVisualRefinement(aggregate.experience.id, {
      productionSceneId: persistedProjection.productionSceneId,
      visualScenarioId: firstScenario.id,
      finalPrompt: "请让钥匙选择在环境和表演上都有明确结果。",
      selectedSkillIds: ["skill-continuity"],
      selectedSkillTitles: ["连续性导演"],
      selectedContextIds: ["scene-context"],
    });
    const sameCandidate = await productionPort.createVisualRefinement(aggregate.experience.id, {
      productionSceneId: persistedProjection.productionSceneId,
      visualScenarioId: firstScenario.id,
      finalPrompt: "请让钥匙选择在环境和表演上都有明确结果。",
    });
    assert.strictEqual(sameCandidate.id, candidate.id, "Repeated confirmation must reuse the same candidate");
    assert.strictEqual(generatorCalls, 1, "Idempotent candidate generation must not call AI twice");
    assert.strictEqual(
      interactiveRepository.listVisualContextProjections(
        aggregate.experience.id,
        aggregate.experience.projectId,
      ).find((projection) => projection.id === persistedProjection.id)
        ?.scenarios.find((scenario) => scenario.id === firstScenario.id)
        ?.environmentChanges.includes("门锁反射出钥匙的冷光"),
      false,
      "AI candidate must not overwrite an adopted visual scenario before review",
    );
    const adoptedRefinement = productionPort.adoptVisualRefinement(
      aggregate.experience.id,
      candidate.id,
    );
    assert.strictEqual(adoptedRefinement.draft.status, "adopted");
    assert.match(
      adoptedRefinement.projection.scenarios.find((scenario) => scenario.id === firstScenario.id)
        ?.shotPromptDelta || "",
      /门锁反射出钥匙的冷光/,
    );
    const refinedProject = dbHelpers.getProjectById(aggregate.experience.projectId);
    assert.strictEqual(
      refinedProject?.episodes?.[0]?.scenes?.[0]?.interactiveMetadata?.visualScenarios
        ?.find((scenario: any) => scenario.id === firstScenario.id)
        ?.performanceConstraints.includes("主角握紧钥匙，视线先扫过门缝再看向门锁"),
      true,
      "Adoption must project the author-approved performance plan back to Storyboard",
    );
    assert.strictEqual(
      refinedProject?.episodes?.[0]?.scenes?.[0]?.shots?.[0]?.videoMedia?.status,
      "ready",
      "Adopting a visible change must preserve the author-selected production media",
    );
    assert.strictEqual(
      interactiveRepository.getRuntimeBuild(aggregate.experience.id, runtimeBuild.id)?.status,
      "ready_for_player",
      "Adopting a visible change must preserve the frozen Runtime Build",
    );
    assert.strictEqual(
      refinedProject?.episodes?.[0]?.scenes?.[0]?.shots?.[0]?.takes?.[0]?.generationAudit?.sourceReview?.status,
      "review_recommended",
      "Adopting a visible change must recommend review on the related take",
    );
    assert.strictEqual(
      refinedProject?.episodes?.[0]?.scenes?.[0]?.manualStoryboard?.boards?.[0]?.confirmedAt != null,
      true,
      "Adopting a visible change must not revoke an already-confirmed Storyboard",
    );
    assert.strictEqual(
      refinedProject?.episodes?.[0]?.scenes?.[0]?.manualStoryboard?.boards?.[0]?.strategyDecision?.activeVisualTakeId,
      "board_take_visual",
      "Adopting a visible change must not clear the selected Storyboard visual take",
    );
    const reviewBuild = interactiveRepository.createRuntimeBuild(aggregate.experience.id);
    assert.strictEqual(
      reviewBuild.status,
      "waiting_for_media",
      "A new Runtime Build must not silently confirm media after its visual source changed",
    );
    assert.strictEqual(
      reviewBuild.pendingMediaReviewNodeIds.includes("meeting"),
      true,
      "Only the related node must be listed for media review in the new Runtime Build",
    );

    const projectionAfterRefinement = interactiveRepository.listVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
    ).find((projection) => projection.id === persistedProjection.id)!;
    const concurrentRefinementPort = createInteractiveProductionPrepPort({
      scriptRepository: {} as any,
      writingPort: {} as any,
      visualRefinementGenerator: async () => {
        dbHelpers.updateProjectMeta(aggregate.experience.projectId, {
          interactiveConcurrentEditMarker: "production-edit-must-survive",
        });
        return {
          label: "并发修订候选",
          environmentChanges: ["门锁旁新增作者确认的反光标记"],
          performanceConstraints: ["主角停顿后再触碰门锁"],
          rationale: "验证等待 AI 时发生的制片编辑不会被旧快照覆盖。",
        };
      },
    });
    const staleRefinementCandidate = await concurrentRefinementPort.createVisualRefinement(aggregate.experience.id, {
      productionSceneId: projectionAfterRefinement.productionSceneId,
      visualScenarioId: projectionAfterRefinement.scenarios[0].id,
      finalPrompt: "生成另一版建议，同时保留制片端并发编辑。",
    });
    assert.strictEqual(
      (dbHelpers.getProjectById(aggregate.experience.projectId) as any)?.interactiveConcurrentEditMarker,
      "production-edit-must-survive",
      "Saving an AI refinement candidate must merge into the latest Production project after the await",
    );
    const projectionBeforeConcurrentAdoption = interactiveRepository.listVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
    ).find((projection) => projection.id === projectionAfterRefinement.id)!;
    const scenarioBeforeConcurrentAdoption = projectionBeforeConcurrentAdoption.scenarios[0];
    interactiveRepository.adoptVisualContextRefinement(aggregate.experience.id, {
      projectionId: projectionBeforeConcurrentAdoption.id,
      productionSceneId: projectionBeforeConcurrentAdoption.productionSceneId,
      visualScenarioId: scenarioBeforeConcurrentAdoption.id,
      sourceFingerprint: projectionBeforeConcurrentAdoption.sourceFingerprint,
      label: scenarioBeforeConcurrentAdoption.label,
      environmentChanges: [...scenarioBeforeConcurrentAdoption.environmentChanges, "作者先采用了另一项并发画面调整"],
      performanceConstraints: scenarioBeforeConcurrentAdoption.performanceConstraints,
    });
    assert.throws(
      () => productionPort.adoptVisualRefinement(aggregate.experience.id, staleRefinementCandidate.id),
      /另一项建议更新/,
      "A refinement candidate must not overwrite a projection changed after that candidate was generated",
    );

    const graphRevision = interactiveRepository.saveGraph(aggregate.experience.id, {
      entryNodeId: saved.graph.entryNodeId,
      nodes: saved.graph.nodes.map((node) => node.id === "meeting"
        ? { ...node, brief: { ...node.brief, narrativeSummary: "主角来到锁住的门前，灯光闪烁。" } }
        : node),
    });
    const afterGraphChange = interactiveRepository.listVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
    );
    assert.strictEqual(
      afterGraphChange.find((projection) => projection.productionSceneId === "scene_meeting")?.status,
      "stale",
      "Changed nodes must stale their visual projection",
    );
    assert.strictEqual(
      afterGraphChange.find((projection) => projection.productionSceneId === "scene_meeting_followup")?.status,
      "stale",
      "Every production scene serving a changed node must become stale",
    );
    const reviewedProductionProject = dbHelpers.getProjectById(aggregate.experience.projectId);
    assert.strictEqual(
      reviewedProductionProject?.episodes?.[0]?.scenes?.[0]?.shots?.[0]?.videoMedia?.status,
      "ready",
      "A changed visual projection must preserve the affected production scene media",
    );
    assert.strictEqual(
      reviewedProductionProject?.episodes?.[0]?.scenes?.[0]?.shots?.[0]?.takes?.[0]?.videoMedia?.status,
      "ready",
      "A changed visual projection must preserve formal take media",
    );
    assert.strictEqual(
      reviewedProductionProject?.episodes?.[0]?.scenes?.[0]?.shots?.[0]?.takes?.[0]?.generationAudit?.sourceReview?.status,
      "review_recommended",
      "A changed visual projection must leave a review recommendation on the formal take",
    );
    assert.strictEqual(
      afterGraphChange.find((projection) => projection.productionSceneId === "scene_isolated")?.graphVersionId,
      graphRevision.graph.id,
      "Independent projections must be rebased instead of invalidated",
    );
    const afterGraphAggregate = interactiveRepository.getExperience(aggregate.experience.id);
    const changedMeetingBinding = afterGraphAggregate.bindings.find((binding) => binding.nodeId === "meeting")!;
    interactiveRepository.saveBinding(aggregate.experience.id, {
      ...changedMeetingBinding,
      contentFitReview: {
        verdict: "pass",
        rationale: "作者已复核更新后的节点概要，正式剧本仍满足当前节点。",
        reviewedAt: new Date(Date.now() + 10).toISOString(),
        sceneChecksums: changedMeetingBinding.scriptSceneRefs!.map((ref) => ref.checksum),
      },
    });
    const staleProjectionBuild = interactiveRepository.createRuntimeBuild(aggregate.experience.id);
    const staleMeetingManifest = staleProjectionBuild.nodeManifests.find((manifest) => manifest.nodeId === "meeting");
    assert.strictEqual(staleProjectionBuild.status, "waiting_for_media");
    assert.strictEqual(
      Boolean(staleMeetingManifest?.mediaScenarios?.length)
        && staleMeetingManifest!.mediaScenarios!.every((scenario) => scenario.mediaTakeRefs.length === 0),
      true,
      "A formal build must retain stale scenario requirements as missing instead of silently becoming ready",
    );

    const afterUnrelatedStateChange = interactiveRepository.saveStateSchema(aggregate.experience.id, {
      ...stateSchema,
      factDefinitions: [...(stateSchema.factDefinitions || []), "CHARACTER_INJURED"],
    });
    assert.strictEqual(
      interactiveRepository.listVisualContextProjections(
        aggregate.experience.id,
        aggregate.experience.projectId,
      ).find((projection) => projection.productionSceneId === "scene_isolated")?.status,
      afterGraphChange.find((projection) => projection.productionSceneId === "scene_isolated")?.status,
      "Adding an unused state definition must not stale an isolated production scene",
    );
    assert.strictEqual(
      interactiveRepository.listVisualContextProjections(
        aggregate.experience.id,
        aggregate.experience.projectId,
      ).find((projection) => projection.productionSceneId === "scene_isolated")?.stateSchemaVersionId,
      afterUnrelatedStateChange.stateSchema.id,
      "Unaffected visual projections must rebase to the new state schema version",
    );
    assert.strictEqual(
      interactiveRepository.getRuntimeBuild(aggregate.experience.id, runtimeBuild.id)?.status,
      "ready_for_player",
      "State schema changes must preserve frozen Runtime Builds",
    );

    const refreshedProjections = buildInteractiveVisualContextProjections({
      experienceId: aggregate.experience.id,
      graph: graphRevision.graph,
      stateSchemaVersionId: afterUnrelatedStateChange.stateSchema.id,
      stateSchema: afterUnrelatedStateChange.stateSchema.data,
      bindings: afterUnrelatedStateChange.bindings,
      productionProjectId: aggregate.experience.projectId,
      sources: [
        { productionSceneId: "scene_meeting", nodeIds: ["meeting"] },
        { productionSceneId: "scene_meeting_followup", nodeIds: ["meeting"] },
        { productionSceneId: "scene_isolated", nodeIds: ["isolated-checkpoint"] },
      ],
    });
    interactiveRepository.replaceVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
      refreshedProjections,
    );
    assert.notStrictEqual(
      interactiveRepository.listVisualContextProjections(
        aggregate.experience.id,
        aggregate.experience.projectId,
      ).find((projection) => projection.productionSceneId === "scene_isolated")?.status,
      "stale",
      "The current projection must sort before stale history when update timestamps tie",
    );
    const afterRelevantStateChange = interactiveRepository.saveStateSchema(aggregate.experience.id, {
      ...afterUnrelatedStateChange.stateSchema.data,
      initialFactIds: ["FACT_KEY_OBTAINED"],
    });
    const selectivelyInvalidated = interactiveRepository.listVisualContextProjections(
      aggregate.experience.id,
      aggregate.experience.projectId,
    );
    assert.strictEqual(
      selectivelyInvalidated.find((projection) => projection.productionSceneId === "scene_meeting")?.status,
      "stale",
      "A changed key rule must stale the production scene that can observe the key",
    );
    assert.strictEqual(
      selectivelyInvalidated.find((projection) => projection.productionSceneId === "scene_meeting_followup")?.status,
      "stale",
      "Every production scene serving the affected node must become stale",
    );
    assert.notStrictEqual(
      selectivelyInvalidated.find((projection) => projection.productionSceneId === "scene_isolated")?.status,
      "stale",
      "An unrelated production scene must remain usable after a targeted state-rule change",
    );
    assert.strictEqual(
      selectivelyInvalidated.find((projection) => projection.productionSceneId === "scene_isolated")?.stateSchemaVersionId,
      afterRelevantStateChange.stateSchema.id,
      "The unaffected production scene must rebase to the latest state schema",
    );
  } finally {
    dbHelpers.deleteProject(aggregate.experience.projectId);
    interactiveRepository.deleteExperience(aggregate.experience.id);
  }

  console.log("Interactive visual projection persistence, media reuse and runtime selection self-check passed.");
}

runSelfCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

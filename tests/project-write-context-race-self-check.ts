import assert from "node:assert/strict";

import { useProjectStore } from "../src/store/useProjectStore";
import { replaceCurrentProjectSnapshot } from "../apps/web/src/clients/stateClient";
import type { Episode, Project } from "../src/types/project";

const sharedAssetId = "asset-shared";
const sharedEpisodeId = "episode-shared";
const sharedSceneId = "scene-shared";

const project = (id: string, assetName: string): Project => ({
  id,
  title: id,
  characters: [],
  assets: [{
    id: sharedAssetId,
    type: "prop",
    name: assetName,
    description: assetName,
  }],
  episodes: [{ id: sharedEpisodeId, title: "Shared episode" }],
} as Project);

const episode = (sceneTitle: string): Episode => ({
  id: sharedEpisodeId,
  title: "Shared episode",
  scenes: [{ id: sharedSceneId, title: sceneTitle, shots: [] }],
} as Episode);

const originalState = useProjectStore.getState();
const projectA = project("project-a", "A asset");
const projectB = project("project-b", "B asset");
const episodeA = episode("A scene");
const episodeB = episode("B scene");

try {
  useProjectStore.setState({ projects: [projectA, projectB], currentProject: projectA });
  const { episodes: _omitted, ...metadataOnly } = projectA;
  assert.equal(replaceCurrentProjectSnapshot({ ...metadataOnly, title: "Adopted asset" } as Project), true);
  assert.deepEqual(useProjectStore.getState().currentProject?.episodes, projectA.episodes, "adopting asset metadata must retain the loaded episode index and scene usage");
  assert.deepEqual(useProjectStore.getState().projects[0].episodes, projectA.episodes);
  assert.equal(replaceCurrentProjectSnapshot({ ...projectA, episodes: [] }), true);
  assert.deepEqual(useProjectStore.getState().currentProject?.episodes, [], "an explicit empty episode list must not resurrect stale records");
  assert.equal(replaceCurrentProjectSnapshot(projectB), false, "a late candidate result must not switch projects");
  useProjectStore.setState({
    projects: [projectA, projectB],
    currentProject: projectA,
    activeEpisodeId: sharedEpisodeId,
    activeEpisode: episodeA,
    _updateProjectLock: Promise.resolve(),
    _updateSceneLock: Promise.resolve(),
  });
  const lateProjectWrite = useProjectStore.getState().updateProject({
    assets: [{
      ...projectA.assets[0],
      name: "late A result",
    }],
  }, { expectedProjectId: projectA.id });

  // Switch synchronously after enqueueing, before the resolved-lock .then callback runs.
  useProjectStore.setState({ currentProject: projectB });
  await lateProjectWrite;
  assert.equal(
    useProjectStore.getState().currentProject?.assets[0]?.name,
    "B asset",
    "a queued A project write must not mutate B, even when asset ids match",
  );

  useProjectStore.setState({
    currentProject: projectA,
    activeEpisodeId: sharedEpisodeId,
    activeEpisode: episodeA,
    _updateSceneLock: Promise.resolve(),
  });
  const lateSceneWrite = useProjectStore.getState().updateScene(
    sharedSceneId,
    { title: "late A scene result" },
    sharedEpisodeId,
    { expectedProjectId: projectA.id, expectedEpisodeId: sharedEpisodeId },
  );

  useProjectStore.setState({
    currentProject: projectB,
    activeEpisodeId: sharedEpisodeId,
    activeEpisode: episodeB,
  });
  await lateSceneWrite;
  assert.equal(
    useProjectStore.getState().activeEpisode?.scenes?.[0]?.title,
    "B scene",
    "a queued A scene write must not mutate B, even when episode and scene ids match",
  );
} finally {
  useProjectStore.setState({
    projects: originalState.projects,
    currentProject: originalState.currentProject,
    activeEpisodeId: originalState.activeEpisodeId,
    activeEpisode: originalState.activeEpisode,
    _updateProjectLock: originalState._updateProjectLock,
    _updateSceneLock: originalState._updateSceneLock,
  });
}

console.log("Project write context race self-check passed.");

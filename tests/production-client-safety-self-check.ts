import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const dom = new JSDOM('<div id="library"></div><div id="export"></div>', { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.HTMLAnchorElement.prototype.click = function () {};

const { useProjectStore } = await import("../src/clients/stateClient");
const { scriptClient } = await import("../apps/web/src/clients/scriptClient");
const { legacyProjectClient } = await import("../src/clients/legacyProjectClient");
const { assetClient } = await import("../src/clients/assetClient");
const { useProductionProjectLibrary } = await import("../src/features/production/useProductionProjectLibrary");
const { useEpisodeFilmExport } = await import("../src/hooks/useEpisodeFilmExport");
const { debouncedSaveProjectState, flushDebouncedProjectSave } = await import("../src/store/slices/projectSlice");
const previousStore = useProjectStore.getState();
const previousScriptList = scriptClient.listProjects;
const previousClient = {
  patchProject: legacyProjectClient.patchProject,
  saveEpisode: legacyProjectClient.saveEpisode,
  getEpisode: legacyProjectClient.getEpisode,
  compose: assetClient.composeEpisodeFilm,
};
const libraryRoot = createRoot(document.getElementById("library")!);
const exportRoot = createRoot(document.getElementById("export")!);
try {
  let listCalls = 0;
  let rejectWriting: (error: Error) => void = () => {};
  scriptClient.listProjects = () => { listCalls++; return new Promise((_resolve, reject) => { rejectWriting = reject; }); };
  useProjectStore.setState({
    isLoading: false,
    projects: [],
    fetchProjects: async () => useProjectStore.setState({
      isLoading: false,
      projects: [{ id: "library-project", title: "独立制片", projectModel: "linear", isFromAdaptation: true, episodes: [] }] as any,
    }),
  });
  let library: ReturnType<typeof useProductionProjectLibrary>;
  await act(async () => libraryRoot.render(React.createElement(() => { library = useProductionProjectLibrary(); return null; })));
  assert.equal(listCalls, 0, "production library must not request script list on mount");
  assert.equal(library!.productionProjects.length, 1);
  assert.equal(library!.isLoading, false);
  await act(async () => { void library!.refreshWritingProjects(); });
  assert.equal(listCalls, 1);
  assert.equal(library!.isLoading, false, "pending script list must not hide production projects");
  await act(async () => rejectWriting(new Error("script unavailable")));
  assert.equal(library!.writingLoadFailed, true);
  assert.equal(library!.isLoading, false);

  const project = { id: "export-save-project", title: "剪辑", type: "movie", projectModel: "linear", aspectRatio: "16:9", characters: [], assets: [], episodes: [] };
  let persisted = { id: "episode", title: "第一集", productionRevision: 1, scenes: [{ id: "scene", title: "第一场", shots: [{ id: "shot", duration: 4, videoUrl: "/media/clip.mp4" }] }] };
  let serverRevision = 1;
  let failSave = false;
  const submittedRevisions: number[] = [];
  const exports: number[] = [];
  legacyProjectClient.patchProject = async () => project as any;
  legacyProjectClient.getEpisode = async () => structuredClone(persisted) as any;
  legacyProjectClient.saveEpisode = async (_projectId, episode) => {
    submittedRevisions.push(episode.productionRevision!);
    if (failSave) throw new Error("模拟保存失败，本机修改已保留");
    assert.equal(episode.productionRevision, serverRevision);
    serverRevision++;
    persisted = structuredClone({ ...episode, productionRevision: serverRevision }) as typeof persisted;
    return structuredClone(persisted) as any;
  };
  assetClient.composeEpisodeFilm = async (input) => {
    exports.push(input.shots[0].durationSeconds);
    return { url: "/media/finished.mp4" } as any;
  };
  const original = structuredClone(persisted);
  let film: ReturnType<typeof useEpisodeFilmExport>;
  await act(async () => exportRoot.render(React.createElement(() => { film = useEpisodeFilmExport({ project: project as any, episode: original as any }); return null; })));
  const first = structuredClone(original);
  first.scenes[0].shots[0].duration = 7;
  await act(async () => debouncedSaveProjectState(project.id, project, [first], 10_000));
  await act(async () => { await film!.exportEpisode({ mode: "video" }); });
  assert.deepEqual(exports, [7], "export must flush the queued edit before reading the server");
  assert.deepEqual(submittedRevisions, [1]);
  const second = structuredClone(original);
  second.scenes[0].shots[0].duration = 8;
  await act(async () => debouncedSaveProjectState(project.id, project, [second], 10_000));
  await act(async () => { await flushDebouncedProjectSave(project.id); });
  assert.deepEqual(submittedRevisions, [1, 2], "same-tab serial saves use successful write receipts");
  serverRevision = 4;
  persisted = { ...persisted, productionRevision: 4 };
  const newlyRead = structuredClone(persisted);
  newlyRead.scenes[0].shots[0].duration = 9;
  await act(async () => debouncedSaveProjectState(project.id, project, [newlyRead], 10_000));
  await act(async () => { await flushDebouncedProjectSave(project.id); });
  assert.deepEqual(submittedRevisions, [1, 2, 4], "a newer explicit read supersedes this tab's older receipt");
  failSave = true;
  const third = structuredClone(original);
  third.scenes[0].shots[0].duration = 10;
  await act(async () => debouncedSaveProjectState(project.id, project, [third], 10_000));
  await act(async () => { await assert.rejects(flushDebouncedProjectSave(project.id), /模拟保存失败/); });
  assert.ok(localStorage.getItem(`save_failed_${project.id}`), "failed content remains locally recoverable");
  const attemptsAfterFailure = submittedRevisions.length;
  const laterEdit = structuredClone(original);
  laterEdit.scenes[0].shots[0].duration = 11;
  await act(async () => debouncedSaveProjectState(project.id, project, [laterEdit], 10_000));
  assert.equal(submittedRevisions.length, attemptsAfterFailure, "editing after failure must not retry in background");
  assert.equal(JSON.parse(localStorage.getItem(`save_failed_${project.id}`)!).episodesToSave[0].scenes[0].shots[0].duration, 11,
    "editing after failure refreshes the local recovery copy");
  await act(async () => { await assert.rejects(film!.exportEpisode({ mode: "video" }), /模拟保存失败/); });
  assert.deepEqual(exports, [7], "failed saves must block film synthesis");
  failSave = false;
  await act(async () => { assert.equal(await useProjectStore.getState().recoverFailedSaves(project.id, { preferQueuedProjectData: true }), 1); });
  const attemptsAfterRecovery = submittedRevisions.length;
  await flushDebouncedProjectSave(project.id);
  assert.equal(submittedRevisions.length, attemptsAfterRecovery, "successful manual recovery clears the old failed batch");
  assert.equal(persisted.scenes[0].shots[0].duration, 11);
  assert.equal(localStorage.getItem(`save_failed_${project.id}`), null);
  console.log("production client safety: independent loading, serial revisions, flush and failure block passed");
} finally {
  await act(async () => { libraryRoot.unmount(); exportRoot.unmount(); });
  scriptClient.listProjects = previousScriptList;
  Object.assign(legacyProjectClient, previousClient);
  assetClient.composeEpisodeFilm = previousClient.compose;
  useProjectStore.setState(previousStore, true);
  dom.window.close();
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a22-production-save-"));
process.env.OMNI_DB_PATH = path.join(directory, "test.db");
const { db, dbHelpers } = await import("../src/server/db");
const { registerLegacyProjectRoutes } = await import("../src/server/routes/legacyProjectRoutes");
const { registerStudioCandidateRoutes } = await import("../src/server/routes/studioCandidateRoutes");
const app = express();
app.use(express.json());
registerLegacyProjectRoutes(app);
registerStudioCandidateRoutes(app);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const port = (server.address() as import("node:net").AddressInfo).port;
const request = async (route: string, method = "GET", body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

try {
  dbHelpers.saveProject({
    id: "production-save", title: "制片保存", type: "movie", episodes: [{
      id: "episode", title: "第一集", scenes: [{ id: "scene", title: "第一场", shots: [{
        id: "shot", duration: 4, videoUrl: "/media/original.mp4", activeTakeId: "original-take",
      }] }],
    }],
  });
  const route = "/api/projects/production-save/episodes/episode";
  const a = (await request(route)).body;
  const b = (await request(route, "GET")).body;
  assert.equal(a.productionRevision, 1);
  a.scenes[0].shots[0].videoUrl = "/media/adopted.mp4";
  a.scenes[0].shots[0].activeTakeId = "adopted-take";
  const adopted = await request(route, "PUT", a);
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.productionRevision, 2);
  b.scenes[0].shots[0].duration = 7;
  const stale = await request(route, "PUT", b);
  assert.equal(stale.status, 409);
  const missingRevision = await request(route, "PUT", { ...b, productionRevision: undefined });
  assert.equal(missingRevision.status, 409);
  const after = (await request(route)).body;
  assert.equal(after.productionRevision, 2);
  assert.equal(after.scenes[0].shots[0].videoUrl, "/media/adopted.mp4");
  assert.equal(after.scenes[0].shots[0].activeTakeId, "adopted-take");
  assert.equal(after.scenes[0].shots[0].duration, 4);

  const partial = (await request(`${route}?view=storyboard&sceneId=scene`)).body;
  partial.scenes[0].shots[0].duration = 7;
  const savedPartial = await request(route, "PUT", partial);
  assert.equal(savedPartial.status, 200);
  assert.equal(savedPartial.body.productionRevision, 3);
  const secondPartial = (await request(`${route}?view=storyboard&sceneId=scene`)).body;
  assert.equal(secondPartial.productionRevision, 3);

  const candidate = await request(`${route}/scenes/scene/studio-candidates`, "POST", {
    shotId: "shot",
    take: { id: "candidate", createdAt: Date.now(), videoUrl: "/media/candidate.mp4" },
  });
  assert.equal(candidate.status, 200);
  assert.equal(candidate.body.episode.productionRevision, 4, "candidate receipt contains the complete new episode");
  assert.equal((await request(route)).body.productionRevision, 4, "server candidate write advances the version");
  assert.equal((await request(route, "PUT", secondPartial)).status, 409);

  const full = dbHelpers.getProjectById("production-save");
  const savedFull = await request("/api/projects/production-save", "PUT", full);
  assert.equal(savedFull.status, 200);
  assert.equal(savedFull.body.episodes.find((episode: any) => episode.id === "episode").productionRevision, 5,
    "full save returns the committed episode revision");
  assert.equal((await request(route)).body.productionRevision, 5, "full project write advances the version");
  const savedAgain = await request("/api/projects/production-save", "PUT", savedFull.body);
  assert.equal(savedAgain.status, 200, "immediate subsequent full save uses the returned revision");
  assert.equal(savedAgain.body.episodes.find((episode: any) => episode.id === "episode").productionRevision, 6);

  const newEpisodeRoute = "/api/projects/production-save/episodes/new-episode";
  assert.equal((await request(newEpisodeRoute, "PUT", {
    id: "new-episode", title: "另一页新增", scenes: [{ id: "new-scene", title: "新增场景", shots: [] }],
  })).status, 200);
  const staleCollectionSave = await request("/api/projects/production-save", "PUT", savedAgain.body);
  assert.equal(staleCollectionSave.status, 200);
  assert.ok(staleCollectionSave.body.episodes.some((episode: any) => episode.id === "new-episode"),
    "full save must return and preserve an episode added after the old project read");
  const beforeDeletion = await request(newEpisodeRoute);
  assert.equal(beforeDeletion.status, 200);
  assert.equal((await request(newEpisodeRoute, "DELETE")).status, 200, "explicit episode deletion remains available");
  assert.equal((await request(newEpisodeRoute)).status, 404);
  assert.equal((await request(newEpisodeRoute, "PUT", beforeDeletion.body)).status, 409,
    "old episode PUT cannot recreate a deleted episode");
  assert.equal((await request("/api/projects/production-save", "PUT", staleCollectionSave.body)).status, 409,
    "old full project PUT cannot recreate a deleted episode");
  assert.equal((await request(newEpisodeRoute)).status, 404);
  assert.equal((await request(newEpisodeRoute, "PUT", {
    id: "new-episode", title: "明确新建", scenes: [{ id: "new-scene", title: "新建场景", shots: [] }],
  })).status, 200, "new episode creation without a prior revision remains supported");
  assert.equal((await request(newEpisodeRoute, "DELETE")).status, 200);
  assert.equal((await request("/api/projects/production-save", "PUT", full)).status, 409);
  assert.equal((await request("/api/projects", "POST", full)).status, 409);
  console.log("production save guard: stale PUT, scoped save, candidate, and full save passed");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

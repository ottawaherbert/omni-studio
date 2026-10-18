import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a22-candidate-http-"));
process.env.OMNI_DB_PATH = path.join(directory, "test.db");
const { db, dbHelpers } = await import("../src/server/db");
const { registerStudioCandidateRoutes } = await import("../src/server/routes/studioCandidateRoutes");
const app = express(); app.use(express.json()); registerStudioCandidateRoutes(app);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
try {
  dbHelpers.saveProject({ id: "A", title: "A", episodes: [] });
  dbHelpers.saveProject({ id: "B", title: "B", episodes: [] });
  dbHelpers.updateEpisode("A", "epA", { id: "epA", title: "A", scenes: [{ id: "sceneA", title: "修改后的场景", shots: [{ id: "shotA", visualAction: "作者刚修改的动作", takes: [] }] }] });
  dbHelpers.updateEpisode("B", "epB", { id: "epB", title: "B", scenes: [{ id: "sceneB", title: "B", shots: [] }] });
  const candidate = { shotId: "shotA", take: { id: "late-result", imageUrl: "/media/generated.png", createdAt: 1 } };
  const url = `${base}/api/projects/A/episodes/epA/scenes/sceneA/studio-candidates`;
  for (let i = 0; i < 2; i += 1) assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidate) })).status, 200);
  const scene = dbHelpers.getEpisodeById("A", "epA")!.scenes[0];
  assert.equal(scene.title, "修改后的场景");
  assert.equal(scene.shots[0].visualAction, "作者刚修改的动作");
  assert.equal(scene.shots[0].takes.length, 1, "retries must not duplicate candidates");
  assert.equal(dbHelpers.getEpisodeById("B", "epB")!.scenes[0].shots.length, 0);
  assert.equal((await fetch(`${base}/api/projects/B/episodes/epA/scenes/sceneA/studio-candidates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidate) })).status, 404);
  console.log("Studio candidate HTTP regressions passed: original target, latest edits preserved, idempotent append, cross-project rejection.");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close(); fs.rmSync(directory, { recursive: true, force: true });
}

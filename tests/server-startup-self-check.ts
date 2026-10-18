import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Express } from "express";
import type { Server } from "node:http";

import { listenWithPortFallback } from "../src/server/listenWithPortFallback";
import { shouldServeSpaDocument } from "../src/server/productionStaticPolicy";

class FakeServer extends EventEmitter {}

const fakeApp = (outcomes: Array<"listening" | NodeJS.ErrnoException>, ports: number[]) => ({
  listen: (port: number) => {
    ports.push(port);
    const server = new FakeServer();
    const outcome = outcomes.shift() || "listening";
    queueMicrotask(() => server.emit(outcome === "listening" ? "listening" : "error", outcome));
    return server as unknown as Server;
  },
}) as unknown as Express;

const originalNodeEnv = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = "production";
  const productionPorts: number[] = [];
  const server = await listenWithPortFallback(fakeApp(["listening"], productionPorts), 4100, "127.0.0.1", false);
  assert.deepEqual(productionPorts, [4100]);
  assert.equal(server.listenerCount("error"), 0, "startup error listeners must be removed after a successful bind");

  const bindFailure = Object.assign(new Error("denied"), { code: "EPERM" });
  await assert.rejects(
    listenWithPortFallback(fakeApp([bindFailure], []), 4100, "127.0.0.1", false),
    /denied/,
  );

  process.env.NODE_ENV = "development";
  const occupied = Object.assign(new Error("occupied"), { code: "EADDRINUSE" });
  const developmentPorts: number[] = [];
  await listenWithPortFallback(
    fakeApp([occupied, "listening"], developmentPorts),
    4100,
    "127.0.0.1",
    true,
  );
  assert.deepEqual(developmentPorts, [4100, 4101]);
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}

for (const route of ["/", "/assets", "/writing", "/production/storyboard", "/interactive/playtest/one"]) {
  assert.equal(shouldServeSpaDocument(route), true, `${route} should remain an SPA deep link`);
}
for (const route of ["/assets/missing.js", "/assets/missing.css", "/favicon.ico"]) {
  assert.equal(shouldServeSpaDocument(route), false, `${route} should be treated as a static asset request`);
}

console.log("Server startup and production static policy self-check passed.");

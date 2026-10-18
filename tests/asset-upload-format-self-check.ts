import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { registerAssetRoutes } from "../src/server/routes/assetRoutes";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "asset-upload-format-"));
const app = express();
app.use(express.json());
registerAssetRoutes(app, { mediaAssetsDir: directory });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const upload = (dataUrl: string) => fetch(`${base}/api/assets/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "format-test", dataUrl }) });
try {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const response = await upload(`data:image/png;base64,${png}`);
  assert.equal(response.status, 200);
  const { url } = await response.json();
  assert.match(url, /^\/media\/format-test\/asset_[a-f0-9]+\.png$/);
  const media = await fetch(`${base}${url}`);
  assert.equal(media.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(png, "base64"));
  for (const type of ["image/svg+xml", "image/tiff", "application/octet-stream"]) {
    const unsupported = await upload(`data:${type};base64,${Buffer.from("unsupported fixture").toString("base64")}`);
    assert.equal(unsupported.status, 415);
    assert.match((await unsupported.json()).error, /PNG、JPEG 或 WebP/);
  }
  assert.deepEqual(await fs.readdir(path.join(directory, "format-test")), [url.split("/").at(-1)]);
  console.log("Asset upload HTTP checks passed: supported PNG round-trip; unsupported formats rejected without saving broken media.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await fs.rm(directory, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const storageSource = read("src/utils/storage.ts");

const assetClientSource = read("apps/web/src/clients/assetClient.ts");
const domainIndexSource = read("packages/domain/src/index.ts");
const assetDtoSource = read("packages/domain/src/asset.ts");

assert.ok(storageSource.includes("assetClient"), "storage utility should use assetClient");

assert.equal(storageSource.includes("/api/assets/upload"), false, "storage utility should not hard-code asset upload API paths");

assert.ok(assetClientSource.includes("/api/assets/upload"), "assetClient should own asset upload API paths");
assert.ok(assetClientSource.includes("/api/assets/video-last-frame"), "assetClient should own video frame extraction API paths");
assert.ok(assetClientSource.includes("/api/assets/rewrite-video-audio"), "assetClient should own explicit video audio editing API paths");
assert.ok(assetClientSource.includes("/api/assets/compose-video-segments"), "assetClient should own video segment composition API paths");
assert.ok(assetClientSource.includes("/api/assets/compose-episode-film"), "assetClient should own full-episode film composition API paths");
assert.ok(assetClientSource.includes("packages/domain/src/asset"), "assetClient should use shared asset DTOs");
assert.ok(domainIndexSource.includes("./asset"), "domain package should export asset DTOs");
assert.ok(assetDtoSource.includes("AssetUploadRequest"), "shared domain package should define asset upload request DTO");
assert.ok(assetDtoSource.includes("ComposeEpisodeFilmRequest"), "shared domain package should define full-episode film DTOs");
assert.ok(assetDtoSource.includes("RewriteVideoAudioRequest"), "shared domain package should define video audio editing DTOs");

console.log("Asset client boundary self-check passed.");

import assert from "node:assert/strict";
import { normalizeMediaDataUrlForUpload } from "../src/utils/storage";

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>雨幕</text></svg>';
const encodedSvg = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const normalized = normalizeMediaDataUrlForUpload(encodedSvg);
assert.ok(normalized?.startsWith("data:image/svg+xml;base64,"));
assert.equal(Buffer.from(normalized!.split(",")[1], "base64").toString("utf8"), svg);
assert.equal(normalizeMediaDataUrlForUpload("https://example.com/frame.png"), null);
assert.equal(normalizeMediaDataUrlForUpload("data:text/plain,hello"), null);
assert.equal(normalizeMediaDataUrlForUpload("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");

console.log("Media data URL self-check passed.");

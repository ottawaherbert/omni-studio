import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

const GRACE_MS = 24 * 60 * 60 * 1000;
const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
const trashRoot = (mediaDir: string) => `${path.resolve(mediaDir)}.recycle`;
type MediaCandidate = { relativePath: string; bytes: number };

const mediaPath = (url: string) => {
  try { return decodeURIComponent(url.split(/[?#]/)[0]).replace(/\\/g, "/"); }
  catch { return url; }
};

// Scan every persisted domain, including JSON arrays and plain URL columns.
// A failed query aborts the operation rather than trusting a partial reference set.
export const previewUnusedMedia = (db: Database.Database, mediaDir: string): MediaCandidate[] => {
  const references = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith("/media/")) references.add(mediaPath(value));
      if (value.includes("/media/")) {
        try { collect(JSON.parse(value)); }
        catch { for (const match of value.matchAll(/\/media\/[^\s"'<>\])}]+/g)) references.add(mediaPath(match[0])); }
      }
    } else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const table of tables) {
    for (const row of db.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).iterate()) collect(row);
  }
  const candidates: MediaCandidate[] = [];
  const root = path.resolve(mediaDir);
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(fullPath);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      if (Date.now() - stat.mtimeMs < GRACE_MS || references.has(`/media/${relativePath}`)) continue;
      candidates.push({ relativePath, bytes: stat.size });
    }
  };
  walk(root);
  return candidates;
};

export const quarantineUnusedMedia = (db: Database.Database, mediaDir: string): number => {
  // Synchronous scan + rename prevents an in-process write from racing the scan.
  const candidates = previewUnusedMedia(db, mediaDir);
  if (!candidates.length) return 0;
  const batch = path.join(trashRoot(mediaDir), `${Date.now()}-${randomUUID()}`);
  fs.mkdirSync(batch, { recursive: true });
  fs.writeFileSync(path.join(batch, "manifest.json"), JSON.stringify({ createdAt: Date.now(), files: candidates }, null, 2));
  for (const file of candidates) {
    const destination = path.join(batch, "files", file.relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(path.join(mediaDir, file.relativePath), destination);
  }
  return candidates.length;
};

export const restoreRecycledMedia = (mediaDir: string): number => {
  const root = trashRoot(mediaDir);
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const batch = path.join(root, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(batch, "manifest.json"), "utf8")) as { files: MediaCandidate[] };
    for (const file of manifest.files) {
      const relative = file.relativePath;
      if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Invalid recycled media path");
      const source = path.join(batch, "files", relative);
      const destination = path.join(mediaDir, relative);
      if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(source, destination);
      count += 1;
    }
  }
  return count;
};

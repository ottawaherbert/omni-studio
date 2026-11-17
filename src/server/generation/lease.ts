import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/** A short, renewable dispatch lease shared by server processes on this database. */
export class GenerationLease {
  readonly owner = randomUUID();
  constructor(readonly db: Database.Database) { db.exec('CREATE TABLE IF NOT EXISTS generation_dispatch_leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)'); }
  acquire(id: string) {
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT owner,expires_at FROM generation_dispatch_leases WHERE id=?').get(id) as { owner: string; expires_at: number } | undefined;
      if (prior && prior.expires_at > Date.now()) return undefined;
      this.db.prepare('INSERT INTO generation_dispatch_leases(id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at').run(id, this.owner, Date.now() + 180000);
      const timer = setInterval(() => { this.db.prepare('UPDATE generation_dispatch_leases SET expires_at=? WHERE id=? AND owner=?').run(Date.now() + 180000, id, this.owner); }, 30000); timer.unref();
      return () => { clearInterval(timer); this.db.prepare('UPDATE generation_dispatch_leases SET expires_at=0 WHERE id=? AND owner=?').run(id, this.owner); };
    })();
  }
  active(id: string) { return !!this.db.prepare('SELECT id FROM generation_dispatch_leases WHERE id=? AND expires_at>?').get(id, Date.now()); }
}

import type Database from 'better-sqlite3';
import { GenerationError, type GenerationPolicy } from '../../../packages/domain/src/generation';

export class GenerationStore {
  constructor(readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS generation_records (kind TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS generation_project_idx ON generation_records(project_id,kind,updated_at);`);
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM generation_records WHERE kind=? AND id=?').get(kind, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  list<T>(kind: string, projectId?: string): T[] {
    const rows = (projectId ? this.db.prepare('SELECT data FROM generation_records WHERE kind=? AND project_id=? ORDER BY updated_at DESC').all(kind, projectId) : this.db.prepare('SELECT data FROM generation_records WHERE kind=? ORDER BY updated_at DESC').all(kind)) as Array<{ data: string }>;
    return rows.map(row => JSON.parse(row.data) as T);
  }
  put<T>(kind: string, id: string, projectId: string, value: T, expectedRevision?: number) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT revision FROM generation_records WHERE kind=? AND id=?').get(kind, id) as { revision: number } | undefined;
      if (expectedRevision !== undefined && (row?.revision ?? 0) !== expectedRevision) throw new GenerationError('DRAFT_CONFLICT', '此内容已在其他页面更新，草稿仍保留，请重新读取后核对。', 409);
      if (kind === 'plan' && row) throw new GenerationError('IMMUTABLE_PLAN', '固定计划不可覆盖，请建立新版本。', 409);
      this.db.prepare('INSERT INTO generation_records(kind,id,project_id,revision,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at').run(kind, id, projectId, (row?.revision ?? 0) + 1, JSON.stringify(value), Date.now());
      return value;
    })();
  }
  policy(projectId: string): GenerationPolicy {
    const prior = this.get<GenerationPolicy>('policy', projectId);
    if (prior) return prior;
    // Explicit migration of the author's still-active pause; never inferred from task success.
    const knownPause = projectId === 'prod_cidibutong_ep01_20261021';
    const policy: GenerationPolicy = { projectId, revision: 1, imagePaused: false, videoPaused: knownPause, reason: knownPause ? '作者已暂停视频生成；仅明确解除后恢复。' : undefined, allowedCoreFamilies: knownPause ? ['yz_h3'] : [], allowExperimental: false, updatedAt: Date.now() };
    return this.put('policy', projectId, projectId, policy, 0);
  }
}

/** Read-only scene outcome index. No engine, policy creation or media inspection. */
export function readSceneMediaProgress(db: Database.Database, projectId: string, episodeId: string, sceneId: string) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_records'").get())return {executionsUsed:0,inFlight:0,results:[],hasMore:false};
  const query="FROM generation_records e JOIN generation_records p ON p.kind='plan' AND p.id=json_extract(e.data,'$.planId') WHERE e.kind='execution' AND e.project_id=? AND json_extract(p.data,'$.target.episodeId')=? AND json_extract(p.data,'$.target.sceneId')=?";
  const totals=db.prepare(`SELECT count(*) AS used, sum(CASE WHEN json_extract(e.data,'$.status') IN ('queued','held','submitting','running','reconciling') THEN 1 ELSE 0 END) AS flight ${query}`).get(projectId,episodeId,sceneId) as {used:number;flight:number};
  const rows=db.prepare(`SELECT e.data ${query} ORDER BY e.updated_at DESC LIMIT 50`).all(projectId,episodeId,sceneId) as {data:string}[];
  return {executionsUsed:totals.used,inFlight:totals.flight || 0,hasMore:totals.used>50,results:rows.flatMap(row=>{
    const execution=JSON.parse(row.data);
    return execution.results.map((result:any)=>({executionId:execution.id,resultId:result.id,mediaUrl:result.mediaUrl,savedReview:result.review,observations:result.observations || [],technicalIssues:result.technicalIssues || []}));
  })};
}

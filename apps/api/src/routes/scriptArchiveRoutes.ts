import type {Express} from 'express';
import type Database from 'better-sqlite3';

// Read-only access to user content left by retired engines. Never creates their schema.
const sources = {
  workspaces: 'script_workspaces', drafts: 'script_agent_drafts', candidates: 'script_draft_candidates',
  conversations: 'assistant_threads', messages: 'assistant_messages', jobs: 'script_jobs',
  writing_conversations:'agent_conversations', writing_turns:'agent_turns', writing_sources:'agent_conversation_sources',
  workspace_revisions:'script_workspace_revisions', preparation:'production_preparation_batch_runs',
  plans:'assistant_plans', changes:'assistant_change_sets',
} as const;
export function registerScriptArchiveRoutes(app:Express, db:Database.Database) {
  const exists=(table:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  app.get('/api/script-archives',(_req,res)=>res.json({readOnly:true,sources:Object.entries(sources).map(([id,table])=>({id,count:exists(table)?(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {count:number}).count:0,exportUrl:`/api/script-archives/${id}`}))}));
  app.get('/api/script-archives/:source',(req,res)=>{
    const table=Object.hasOwn(sources,req.params.source)?sources[req.params.source as keyof typeof sources]:undefined;
    if(!table)return res.status(404).json({error:'未知存档类型'});
    const offset=Number(req.query.offset||0);
    if(!Number.isSafeInteger(offset)||offset<0)return res.status(400).json({error:'分页位置无效'});
    const rows=exists(table)?db.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT 201 OFFSET ?`).all(offset):[];
    const more=rows.length>200;
    res.attachment(`writing-archive-${req.params.source}-${offset}.json`).json({readOnly:true,source:req.params.source,offset,rows:rows.slice(0,200),next:more?`/api/script-archives/${req.params.source}?offset=${offset+200}`:null});
  });
}

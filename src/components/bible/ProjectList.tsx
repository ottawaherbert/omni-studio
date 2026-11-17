import { useProjectStore } from "../../clients/stateClient";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { legacyProjectClient } from "../../clients/legacyProjectClient";
import type { Project } from "../../clients/domainTypes";
import { FolderOpen, Calendar, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "../ui/Card";

export function ProjectList({ onProjectSelect }: { onProjectSelect?: (id: string) => void }) {
  const { loadProject } = useProjectStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search,setSearch]=useState('');
  const visibleProjects=projects.filter(p=>`${p.title||''} ${p.logline||''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void legacyProjectClient.listProjects().then(items => { if (active) setProjects(items); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '项目读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  const navigate = useNavigate();

  const handleLoadProject = async (id: string) => {
    try { await loadProject(id); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : '项目读取失败'); return; }
    if (useProjectStore.getState().currentProject?.id !== id) { toast.error('项目尚未读取，请重试'); return; }
    if (onProjectSelect) {
      onProjectSelect(id);
    } else {
      navigate(`/production/assets?${new URLSearchParams({ projectId: id })}`);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <h2 className="text-sm font-bold text-text-primary uppercase tracking-widest">所有项目 PROJECTS</h2>
        <input aria-label="搜索项目" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索项目名称或简介" className="w-72 rounded-lg border border-border-soft/30 bg-bg-surface px-3 py-2 text-xs" />
      </div>

      {!loading&&projects.length>0&&!visibleProjects.length&&<p className="py-6 text-sm text-text-muted">没有匹配的项目，请换个关键词。</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
        {visibleProjects.map((project) => (
          <Card
            key={project.id}
            onClick={() => handleLoadProject(project.id)}
            className="hover:bg-bg-surface-soft/80 p-6 cursor-pointer transition-all group flex flex-col h-[280px] rounded-2xl border border-border-soft/15 bg-bg-surface shadow-sm"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-bg-surface-soft text-text-muted rounded-xl transition-colors border border-border-soft/10">
                <FolderOpen className="w-5 h-5" />
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted bg-bg-surface-soft px-2.5 py-1 rounded-lg border border-border-soft/10">
                {project.type}
              </span>
            </div>
            
            <h3 className="text-md font-bold text-text-primary mb-2 line-clamp-1 tracking-tight">{project.title || "未命名项目"}</h3>
            <p className="text-xs text-text-secondary line-clamp-3 mb-auto leading-relaxed">{project.logline || "暂无简介"}</p>
            
            <div className="flex items-center gap-4 text-[10px] text-text-muted font-mono mt-4 pt-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-text-muted opacity-60" />
                <span className="font-bold">{project.episodes?.length || 0} EPISODES</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-text-muted opacity-60" />
                <span className="font-bold">{project.characters?.length || 0} CAST</span>
              </div>
            </div>
          </Card>
        ))}
        {loading && <p role="status" className="col-span-full text-sm text-text-muted">正在读取项目…</p>}
        {error && <div role="alert" className="col-span-full text-sm text-text-muted">{error}<button className="ml-3 text-gold" onClick={() => setRetry(n => n + 1)}>重新读取</button></div>}
        {!loading && !error && projects.length === 0 && (
          <div className="col-span-full py-12 text-center text-text-muted text-sm">
            暂无项目，请先在首页创建
          </div>
        )}
      </div>
    </div>
  );
}

function Users(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

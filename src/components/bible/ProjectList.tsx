import { useProjectStore } from "../../clients/stateClient";
import { FolderOpen, Calendar, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "../ui/Card";

export function ProjectList({ onProjectSelect }: { onProjectSelect?: (id: string) => void }) {
  const { projects, loadProject } = useProjectStore();
  const navigate = useNavigate();

  const handleLoadProject = async (id: string) => {
    await loadProject(id);
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
        {projects.map((project) => (
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
        {projects.length === 0 && (
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

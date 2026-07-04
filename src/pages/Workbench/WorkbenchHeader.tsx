import { Loader2, Play, RefreshCw, X } from "lucide-react";
import { Project } from "../../types";

interface WorkbenchHeaderProps {
  activeProject: Project;
  activeProjectId: string | null;
  projects: Project[];
  onProjectChange: (projectId: string) => void;
  onGenerateReport: () => void;
  onGoProjects: () => void;
}

function isRunning(project: Project) {
  return (
    project.status === "downloading" ||
    project.status === "uploading" ||
    project.status === "parsing" ||
    project.status === "querying" ||
    project.status === "synthesizing"
  );
}

export function WorkbenchHeader({
  activeProject,
  activeProjectId,
  projects,
  onProjectChange,
  onGenerateReport,
  onGoProjects,
}: WorkbenchHeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0 select-none">
      <div className="truncate flex-1 mr-4">
        <p className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
          Active Project Workbench / 尽调详情工作台
        </p>
        <div className="flex items-center gap-2 mt-1 truncate">
          <span className="text-base font-black text-slate-900 truncate" title={activeProject.name}>
            {activeProject.name}
          </span>
          <span className="text-slate-300">|</span>

          <select
            value={activeProjectId || ""}
            onChange={(event) => {
              if (event.target.value) {
                onProjectChange(event.target.value);
              }
            }}
            className="bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[11px] rounded px-2 py-0.5 focus:outline-none cursor-pointer"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                切换: {project.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {activeProject.files.length > 0 && activeProject.status === "idle" && (
          <button
            onClick={onGenerateReport}
            className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 shadow-md shadow-blue-600/10 cursor-pointer active:scale-98 transition-all"
          >
            <Play className="h-3.5 w-3.5" />
            <span>一键重算全量报告</span>
          </button>
        )}

        {isRunning(activeProject) && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-1.5 flex items-center gap-2 text-xs font-bold text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span>AIDDA 流程执行中...</span>
          </div>
        )}

        {activeProject.status === "completed" && (
          <button
            onClick={onGenerateReport}
            className="bg-slate-100 hover:bg-blue-600 hover:text-white border border-slate-200 hover:border-blue-500 text-slate-700 font-extrabold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer active:scale-98"
            title="重新执行分析"
          >
            <RefreshCw className="h-3.5 w-3.5 text-blue-500 group-hover:text-white" />
            <span>一键重算分析</span>
          </button>
        )}

        <button
          onClick={onGoProjects}
          className="bg-slate-50 hover:bg-slate-100 border border-slate-200 p-2 rounded-xl text-slate-500 hover:text-slate-900 transition-all cursor-pointer"
          title="返回大厅"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

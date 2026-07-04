import { MouseEvent } from "react";
import { FileText, Trash2 } from "lucide-react";
import { Project } from "../../types";

interface ProjectCardProps {
  project: Project;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string, event: MouseEvent) => void;
}

function getStatusMeta(project: Project) {
  if (project.files.length === 0) {
    return {
      color: "bg-slate-100 text-slate-600 border-slate-200",
      label: "无任何底稿",
    };
  }

  if (project.status === "idle") {
    return {
      color: "bg-indigo-50 text-indigo-700 border-indigo-200",
      label: "就绪待诊断",
    };
  }

  if (project.status === "completed") {
    return {
      color: "bg-emerald-50 text-emerald-700 border-emerald-200",
      label: "已汇编完备报告",
    };
  }

  if (project.status === "failed") {
    return {
      color: "bg-rose-50 text-rose-700 border-rose-200",
      label: "流程异常中断",
    };
  }

  return {
    color: "bg-blue-50 text-blue-700 border-blue-200 animate-pulse",
    label: "AI 深度计算中...",
  };
}

export function ProjectCard({ project, isActive, onSelect, onDelete }: ProjectCardProps) {
  const status = getStatusMeta(project);

  return (
    <div
      onClick={() => onSelect(project.id)}
      className={`bg-white border rounded-2xl p-5 flex flex-col justify-between hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/50 transition-all gap-4 relative group cursor-pointer ${
        isActive ? "ring-2 ring-blue-500/10 border-blue-200" : "border-slate-200"
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.color}`}>
            {status.label}
          </span>

          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete(project.id, event);
            }}
            className="text-slate-400 hover:text-red-500 p-1 rounded-lg hover:bg-slate-50 transition-colors shrink-0 cursor-pointer"
            title="物理删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <h4
          className="text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1"
          title={project.name}
        >
          {project.name}
        </h4>
        <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed line-clamp-2">
          {project.id === "default-proj"
            ? "科创板上市前置性法律合规审查及商誉大客户等财务敏感要项检索。"
            : "暂无背景说明。您可以进入该项目详情面板维护底稿资产。"}
        </p>
      </div>

      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-bold">
        <span className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5 text-slate-400" />
          {project.files.length} 份官方底稿
        </span>
        <span className="text-[10px] text-slate-400 font-normal">
          {new Date(project.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

import { Check, ChevronRight } from "lucide-react";
import { Project } from "../../types";

interface StepMeterProps {
  activeProject: Project;
}

export function StepMeter({ activeProject }: StepMeterProps) {
  return (
    <div className="bg-white border-b border-slate-200 px-8 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs font-bold select-none text-slate-400">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
          执行状态:
        </span>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
              activeProject.files.length > 0
                ? "bg-emerald-500 text-white"
                : "bg-slate-200 text-slate-500"
            }`}
          >
            {activeProject.files.length > 0 ? <Check className="h-3 w-3" /> : "1"}
          </span>
          <span className={activeProject.files.length > 0 ? "text-slate-800" : ""}>
            底稿储备 ({activeProject.files.length} 份)
          </span>
        </div>

        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />

        <div className="flex items-center gap-1.5">
          <span
            className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
              activeProject.status === "completed"
                ? "bg-emerald-500 text-white"
                : activeProject.status === "querying"
                  ? "bg-blue-600 text-white animate-pulse"
                  : "bg-slate-200 text-slate-500"
            }`}
          >
            {activeProject.status === "completed" ? <Check className="h-3 w-3" /> : "2"}
          </span>
          <span
            className={
              activeProject.status === "completed"
                ? "text-slate-800"
                : activeProject.status === "querying"
                  ? "text-blue-600 font-black"
                  : ""
            }
          >
            NotebookLM 逐轮提问
          </span>
        </div>

        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />

        <div className="flex items-center gap-1.5">
          <span
            className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
              activeProject.status === "completed"
                ? "bg-emerald-500 text-white"
                : "bg-slate-200 text-slate-500"
            }`}
          >
            3
          </span>
          <span className={activeProject.status === "completed" ? "text-slate-800" : ""}>
            报告综合汇编
          </span>
        </div>
      </div>

      <div className="text-[10px] text-slate-400 font-mono">PROJECT_ID: {activeProject.id}</div>
    </div>
  );
}

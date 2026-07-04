import { Briefcase, Home } from "lucide-react";

interface EmptyWorkbenchStateProps {
  onGoProjects: () => void;
}

export function EmptyWorkbenchState({ onGoProjects }: EmptyWorkbenchStateProps) {
  return (
    <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center p-8 text-center select-none">
      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-300 shadow-sm mb-4">
        <Briefcase className="h-8 w-8 text-slate-400" />
      </div>
      <h2 className="text-lg font-extrabold text-slate-800">暂未选定或建立任何尽职调查标的项目</h2>
      <p className="text-sm text-slate-500 max-w-sm mt-1.5 leading-relaxed">
        请先前往项目管理大厅选择一个已有标的，或快速创建新的审查项目载入官方年报底稿。
      </p>
      <button
        onClick={onGoProjects}
        className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 px-6 rounded-xl mt-5 shadow-md shadow-blue-600/10 transition-all cursor-pointer active:scale-98 flex items-center gap-2"
      >
        <Home className="h-4 w-4" />
        <span>前往项目管理大厅</span>
      </button>
    </div>
  );
}

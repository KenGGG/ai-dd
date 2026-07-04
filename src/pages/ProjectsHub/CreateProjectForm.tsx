import { FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";

interface CreateProjectFormProps {
  newProjectName: string;
  isCreatingAiddaProject: boolean;
  onProjectNameChange: (value: string) => void;
  onCreateProject: (event: FormEvent) => void;
}

export function CreateProjectForm({
  newProjectName,
  isCreatingAiddaProject,
  onProjectNameChange,
  onCreateProject,
}: CreateProjectFormProps) {
  return (
    <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between gap-4">
      <div>
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
          <Plus className="h-4 w-4 text-blue-500" />
          快速创建全新尽调标的
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          输入 A 股股票代码后，系统自动生成规范项目名称，并同步创建 NotebookLM 笔记。
        </p>
      </div>

      <form onSubmit={onCreateProject} className="grid grid-cols-1 gap-4 items-end">
        <div>
          <label className="text-[10px] uppercase font-extrabold text-slate-500 block mb-1">
            A 股股票代码
          </label>
          <input
            type="text"
            placeholder="例：300750 / 300750.SZ / SZ300750"
            value={newProjectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold"
          />
        </div>
        <div>
          <button
            type="submit"
            disabled={!newProjectName.trim() || isCreatingAiddaProject}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-600/10 active:scale-98 cursor-pointer"
          >
            {isCreatingAiddaProject ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>
              {isCreatingAiddaProject ? "正在创建 NotebookLM 项目..." : "确认创建并进入详情"}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

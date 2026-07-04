import { Database } from "lucide-react";

interface StatsPanelProps {
  projectsCount: number;
  totalFilesCount: number;
  totalCompletedReports: number;
}

export function StatsPanel({
  projectsCount,
  totalFilesCount,
  totalCompletedReports,
}: StatsPanelProps) {
  return (
    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between gap-4">
      <div>
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-500" />
          尽调项目与底稿资产总览
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          当前工作空间内所有正在分析和管理的尽职调查底稿规模与审结概况。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="总项目数" value={projectsCount} unit="个" />
        <StatTile label="底稿汇总" value={totalFilesCount} unit="份" />
        <StatTile label="已审结报告" value={totalCompletedReports} unit="份" accent />
      </div>

      <div className="text-[11px] text-slate-400 font-medium bg-slate-50 rounded-lg px-3 py-2 border border-slate-100/50">
        友情提示：NotebookLM 未登录时无法创建项目，请先执行 notebooklm login 和 notebooklm auth
        check --test。
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center flex flex-col justify-center items-center">
      <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
        {label}
      </span>
      <span
        className={`text-xl font-black mt-1 block ${accent ? "text-emerald-600" : "text-slate-800"}`}
      >
        {value} <span className="text-[10px] font-medium text-slate-500">{unit}</span>
      </span>
    </div>
  );
}

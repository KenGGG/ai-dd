import { Briefcase, Search } from "lucide-react";
import { ProjectStatusFilter } from "../../hooks/useProjectDashboard";

interface ProjectFiltersProps {
  projectSearchQuery: string;
  projectStatusFilter: ProjectStatusFilter;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: ProjectStatusFilter) => void;
}

const FILTERS: Array<{ value: ProjectStatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "empty", label: "无底稿" },
  { value: "idle", label: "待运行" },
  { value: "running", label: "分析中" },
  { value: "completed", label: "已完成" },
];

export function ProjectFilters({
  projectSearchQuery,
  projectStatusFilter,
  onSearchChange,
  onStatusFilterChange,
}: ProjectFiltersProps) {
  return (
    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
      <div>
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-blue-500" />
          证券标的项目检索浏览
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          请选择或搜索您想开展、查阅或审查工作的标的项目。
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索标的公司或项目名称..."
            value={projectSearchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="w-full bg-white border border-slate-200 hover:border-slate-300 text-slate-900 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-blue-500 transition-all font-semibold"
          />
        </div>

        <div className="flex bg-slate-200/60 rounded-xl p-1 text-[10px] font-bold justify-between sm:justify-start">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => onStatusFilterChange(filter.value)}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                projectStatusFilter === filter.value
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-950"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

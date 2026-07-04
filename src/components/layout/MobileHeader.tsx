import { FileSearch, Menu } from "lucide-react";
import { AppTab } from "../../types";

interface MobileHeaderProps {
  currentTab: AppTab;
  onOpenMenu: () => void;
}

const TAB_LABELS: Record<AppTab, string> = {
  projects: "项目管理中心",
  details: "尽调详情工作台",
  settings: "提问模板设置中心",
};

export function MobileHeader({ currentTab, onOpenMenu }: MobileHeaderProps) {
  return (
    <div className="flex md:hidden bg-slate-900 text-white px-4 py-3 items-center justify-between border-b border-slate-800 shrink-0 select-none">
      <div className="flex items-center gap-2.5">
        <div className="bg-blue-600/15 text-blue-400 p-2 rounded-xl border border-blue-500/20">
          <FileSearch className="h-4.5 w-4.5" />
        </div>
        <div>
          <span className="text-xs font-extrabold text-white block uppercase">AI 自动化尽调</span>
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">
            {TAB_LABELS[currentTab]}
          </span>
        </div>
      </div>

      <button
        onClick={onOpenMenu}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        title="展开工作区菜单"
      >
        <Menu className="h-5 w-5" />
      </button>
    </div>
  );
}

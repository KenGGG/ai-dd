import { Briefcase, FileSearch, Home, Sliders, X } from "lucide-react";
import { AppTab, Project } from "../../types";
import { TransferWidget } from "./TransferWidget";

interface TransferStats {
  hasActiveSystemTransfers: boolean;
  totalSystemDownloading: number;
  avgSystemDownloadProgress: number;
  totalSystemUploading: number;
  avgSystemUploadProgress: number;
  totalSystemDownloadedCount: number;
  totalSystemUploadedCount: number;
}

interface SidebarProps extends TransferStats {
  currentTab: AppTab;
  isMobileMenuOpen: boolean;
  projectsCount: number;
  questionsCount: number;
  activeProject: Project | null;
  onTabChange: (tab: AppTab) => void;
  onCloseMobileMenu: () => void;
}

export function Sidebar({
  currentTab,
  isMobileMenuOpen,
  projectsCount,
  questionsCount,
  activeProject,
  onTabChange,
  onCloseMobileMenu,
  hasActiveSystemTransfers,
  totalSystemDownloading,
  avgSystemDownloadProgress,
  totalSystemUploading,
  avgSystemUploadProgress,
  totalSystemDownloadedCount,
  totalSystemUploadedCount,
}: SidebarProps) {
  const switchTab = (tab: AppTab) => {
    onTabChange(tab);
    onCloseMobileMenu();
  };

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden cursor-pointer"
          onClick={onCloseMobileMenu}
        />
      )}

      <nav
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 text-slate-400 select-none transition-transform duration-300 md:static md:translate-x-0 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-5 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600/15 text-blue-400 p-2 rounded-xl border border-blue-500/20">
              <FileSearch className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-white font-extrabold text-sm tracking-tight leading-tight uppercase">
                AI 自动化尽调
              </h1>
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5 block">
                Diligence Platform
              </span>
            </div>
          </div>

          <button
            onClick={onCloseMobileMenu}
            className="md:hidden p-1 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-2 pb-2">
            <span className="text-[9px] uppercase font-bold text-slate-600 tracking-wider">
              WORKSPACE MENU / 核心菜单
            </span>
          </div>

          <button
            onClick={() => switchTab("projects")}
            className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between transition-all font-semibold text-xs cursor-pointer ${
              currentTab === "projects"
                ? "bg-blue-600 text-white shadow-md shadow-blue-900/10"
                : "hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Home className="h-4 w-4 shrink-0" />
              <span>项目管理中心</span>
            </div>
            <span className="bg-slate-800 text-[10px] text-slate-400 px-2 py-0.5 rounded-full font-bold">
              {projectsCount}
            </span>
          </button>

          <button
            onClick={() => switchTab("details")}
            className={`w-full text-left px-3.5 py-3 rounded-xl flex flex-col gap-1 transition-all font-semibold text-xs cursor-pointer ${
              currentTab === "details"
                ? "bg-blue-600 text-white shadow-md shadow-blue-900/10"
                : "hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2.5">
                <Briefcase className="h-4 w-4 shrink-0" />
                <span>尽调详情工作台</span>
              </div>
              {activeProject && (
                <span
                  className={`h-2 w-2 rounded-full ${
                    activeProject.status === "completed"
                      ? "bg-emerald-400"
                      : activeProject.status === "idle"
                        ? "bg-yellow-400"
                        : "bg-blue-400 animate-pulse"
                  }`}
                />
              )}
            </div>
            {activeProject ? (
              <span
                className={`text-[10px] font-medium block truncate pl-6 ${
                  currentTab === "details" ? "text-blue-100" : "text-slate-500"
                }`}
              >
                当前: {activeProject.name}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-slate-600 block pl-6">
                暂未加载标的
              </span>
            )}
          </button>

          <button
            onClick={() => switchTab("settings")}
            className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between transition-all font-semibold text-xs cursor-pointer ${
              currentTab === "settings"
                ? "bg-blue-600 text-white shadow-md shadow-blue-900/10"
                : "hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sliders className="h-4 w-4 shrink-0" />
              <span>提问模板设置中心</span>
            </div>
            <span className="bg-slate-800 text-[10px] text-slate-400 px-2 py-0.5 rounded-full font-bold">
              {questionsCount}个
            </span>
          </button>
        </div>

        <TransferWidget
          hasActiveSystemTransfers={hasActiveSystemTransfers}
          totalSystemDownloading={totalSystemDownloading}
          avgSystemDownloadProgress={avgSystemDownloadProgress}
          totalSystemUploading={totalSystemUploading}
          avgSystemUploadProgress={avgSystemUploadProgress}
          totalSystemDownloadedCount={totalSystemDownloadedCount}
          totalSystemUploadedCount={totalSystemUploadedCount}
        />

        <div className="p-4 border-t border-slate-800 bg-slate-950/60 shrink-0 text-center text-[10px] text-slate-600 font-bold">
          <p>ENGINE: NOTEBOOKLM + CNINFO</p>
          <p className="text-[8px] text-slate-700 tracking-widest uppercase mt-0.5">
            AIDDA COMPLIANCE WORKFLOW
          </p>
        </div>
      </nav>
    </>
  );
}

import { RotateCcw } from "lucide-react";

interface AnnouncementFilterSettingsProps {
  announcementFilterInput: string;
  announcementFilterTerms: string[];
  onAnnouncementFilterChange: (value: string) => void;
  onResetAnnouncementFilters: () => void;
}

export function AnnouncementFilterSettings({
  announcementFilterInput,
  announcementFilterTerms,
  onAnnouncementFilterChange,
  onResetAnnouncementFilters,
}: AnnouncementFilterSettingsProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-black text-slate-800">公告名称过滤词</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            下载最近公告时，标题命中过滤词的公告会记录为已过滤，不下载也不上传 NotebookLM。
          </p>
        </div>
        <button
          type="button"
          onClick={onResetAnnouncementFilters}
          className="bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 font-extrabold text-[10px] px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>重置</span>
        </button>
      </div>

      <textarea
        value={announcementFilterInput}
        onChange={(event) => onAnnouncementFilterChange(event.target.value)}
        rows={4}
        placeholder={"每行一个过滤词，例如：\n开会通知\n会议通知"}
        className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-800 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold resize-none leading-relaxed"
      />

      <div className="flex flex-wrap gap-1.5">
        {announcementFilterTerms.length === 0 ? (
          <span className="text-[10px] text-slate-400 font-bold">当前未启用公告标题过滤</span>
        ) : (
          announcementFilterTerms.map((term) => (
            <span
              key={term}
              className="bg-amber-50 border border-amber-100 text-amber-700 rounded-full px-2 py-1 text-[10px] font-black"
            >
              {term}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

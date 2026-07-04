/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WorkbenchTabs — 尽调详情工作台二级页签。
 *
 * 将工作台拆为两个独立页面：
 *   - 公告 PDF 对齐（数据源管理）
 *   - 分次提问与报告（提问 + 报告展示）
 */

export type WorkbenchView = "sources" | "report";

interface WorkbenchTabsProps {
  currentView: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
}

const TABS: { key: WorkbenchView; label: string; description: string }[] = [
  {
    key: "sources",
    label: "公告 PDF 对齐",
    description: "资料池管理、公告下载、NotebookLM 上传与来源匹配",
  },
  {
    key: "report",
    label: "分次提问与报告",
    description: "逐轮提问、答案查看与尽调报告合成",
  },
];

export function WorkbenchTabs({ currentView, onViewChange }: WorkbenchTabsProps) {
  return (
    <div className="bg-white border-b border-slate-200 px-6 flex shrink-0 select-none">
      {TABS.map((tab) => {
        const isActive = currentView === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onViewChange(tab.key)}
            className={`px-5 py-3 text-xs font-extrabold border-b-2 transition-all cursor-pointer ${
              isActive
                ? "border-blue-600 text-blue-700 bg-blue-50/30"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
            title={tab.description}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

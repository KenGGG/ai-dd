/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SourceAlignmentPage — 公告 PDF 对齐全页。
 *
 * 把公告资料准备从左侧窄栏提升为全宽页面：
 *   - NotebookLM 笔记已有附件展示区
 *   - 公告资料关系矩阵（目标公告 → 本地下载 → NotebookLM 匹配状态）
 *   - 下载/上传操作区
 */

import { MouseEvent } from "react";
import { DownloadCloud, Loader2 } from "lucide-react";
import { Project } from "../../types";
import { NotebookSourcesPanel } from "./NotebookSourcesPanel";
import { SourceRelationshipMatrix } from "./SourceRelationshipMatrix";

interface SourceAlignmentPageProps {
  activeProject: Project;
  isRunningAiddaDownload: boolean;
  onDownloadAndUpload: () => void;
  onDeleteFile: (fileId: string, event: MouseEvent) => void;
}

export function SourceAlignmentPage({
  activeProject,
  isRunningAiddaDownload,
  onDownloadAndUpload,
}: SourceAlignmentPageProps) {
  const isTransferRunning =
    isRunningAiddaDownload ||
    activeProject.status === "downloading" ||
    activeProject.status === "uploading";

  const uploadedCount = activeProject.files.filter(
    (f) => f.uploadStatus === "uploaded",
  ).length;
  const existingCount = activeProject.files.filter(
    (f) => f.uploadStatus === "existing",
  ).length;
  const failedCount = activeProject.files.filter(
    (f) => f.downloadStatus === "failed" || f.uploadStatus === "failed",
  ).length;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
      {/* Top bar: stock identity + download/upload controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
              当前标的
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-base font-black text-slate-900">
                {(activeProject.stockName || activeProject.stockCode || "未命名").toUpperCase()}
              </span>
              <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full text-[10px] font-black">
                {activeProject.stockCode || "无代码"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs font-bold">
            <Metric label="新上传" value={uploadedCount} />
            <Metric label="已存在" value={existingCount} />
            <Metric label="异常" value={failedCount} tone={failedCount > 0 ? "rose" : "slate"} />
          </div>

          <button
            type="button"
            onClick={onDownloadAndUpload}
            disabled={isTransferRunning}
            className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isTransferRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            <span>
              {isTransferRunning ? "正在下载并上传..." : "下载公告 PDF 并同步上传"}
            </span>
          </button>
        </div>
      </div>

      {/* NotebookLM current sources panel */}
      <NotebookSourcesPanel
        projectId={activeProject.id}
        notebookId={activeProject.notebookId}
      />

      {/* Source alignment matrix */}
      <SourceRelationshipMatrix activeProject={activeProject} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "rose";
}) {
  const classes =
    tone === "rose"
      ? "bg-rose-50 border-rose-100 text-rose-700"
      : "bg-white border-slate-100 text-slate-700";
  return (
    <div className={`border rounded-lg px-3 py-2 ${classes}`}>
      <span className="block text-[10px] font-black text-slate-400">{label}</span>
      <span className="block mt-0.5 text-sm font-black">{value}</span>
    </div>
  );
}

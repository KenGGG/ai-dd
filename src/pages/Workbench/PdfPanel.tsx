/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MouseEvent } from "react";
import { DownloadCloud, Loader2 } from "lucide-react";
import { Project } from "../../types";
import { SourceRelationshipMatrix } from "./SourceRelationshipMatrix";

interface PdfPanelProps {
  activeProject: Project;
  isRunningAiddaDownload: boolean;
  onDownloadAndUpload: () => void;
  onDeleteFile: (fileId: string, event: MouseEvent) => void;
}

export function PdfPanel({
  activeProject,
  isRunningAiddaDownload,
  onDownloadAndUpload,
}: PdfPanelProps) {
  const isTransferRunning =
    isRunningAiddaDownload ||
    activeProject.status === "downloading" ||
    activeProject.status === "uploading";
  const uploadedCount = activeProject.files.filter(
    (file) => file.uploadStatus === "uploaded",
  ).length;
  const existingCount = activeProject.files.filter(
    (file) => file.uploadStatus === "existing",
  ).length;
  const failedCount = activeProject.files.filter(
    (file) => file.downloadStatus === "failed" || file.uploadStatus === "failed",
  ).length;

  return (
    <div className="w-[420px] bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 shrink-0 flex items-center justify-between">
        <span className="text-[10px] uppercase font-extrabold text-slate-500 tracking-wider">
          巨潮公告 PDF 入口
        </span>
        <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full text-[9px] font-black">
          {activeProject.stockCode || "未绑定代码"}
        </span>
      </div>

      <div className="p-4 border-b border-slate-100 shrink-0">
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-3 text-xs font-bold">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-white border border-slate-100 rounded-lg p-2">
              <span className="block text-slate-400 font-black">第一遍</span>
              <span className="block text-slate-800 mt-0.5">近三年定期报告</span>
            </div>
            <div className="bg-white border border-slate-100 rounded-lg p-2">
              <span className="block text-slate-400 font-black">第二遍</span>
              <span className="block text-slate-800 mt-0.5">最近 200 个公告</span>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-lg p-2 text-[10px] text-slate-500 leading-relaxed">
            下载成功的 PDF 会立即上传到当前项目绑定的 NotebookLM 笔记：
            <span className="block mt-1 font-mono text-slate-700 break-all">
              {activeProject.notebookId || "未创建 NotebookLM 笔记"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <Metric label="新上传" value={uploadedCount} />
            <Metric label="已存在" value={existingCount} />
            <Metric label="异常" value={failedCount} tone={failedCount > 0 ? "rose" : "slate"} />
          </div>

          <button
            type="button"
            onClick={onDownloadAndUpload}
            disabled={isTransferRunning}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer active:scale-98 transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTransferRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            <span>{isTransferRunning ? "正在下载并上传..." : "下载公告 PDF 并同步上传"}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/30">
        <SourceRelationshipMatrix activeProject={activeProject} />
      </div>
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
    <div className={`border rounded-lg p-2 ${classes}`}>
      <span className="block text-slate-400 font-black">{label}</span>
      <span className="block mt-0.5 text-sm font-black">{value}</span>
    </div>
  );
}

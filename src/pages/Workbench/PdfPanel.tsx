/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  Trash2,
  FileText,
  DownloadCloud,
  Loader2,
} from "lucide-react";
import { Project } from "../../types";

interface PdfPanelProps {
  activeProject: Project;
  isRunningAiddaDownload: boolean;
  onDownloadAndUpload: () => void;
  onDeleteFile: (fileId: string, e: React.MouseEvent) => void;
}

export function PdfPanel({
  activeProject,
  isRunningAiddaDownload,
  onDownloadAndUpload,
  onDeleteFile,
}: PdfPanelProps) {
  return (
    <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
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

          <button
            type="button"
            onClick={onDownloadAndUpload}
            disabled={
              isRunningAiddaDownload ||
              activeProject.status === "downloading" ||
              activeProject.status === "uploading"
            }
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer active:scale-98 transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunningAiddaDownload || activeProject.status === "downloading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            <span>
              {isRunningAiddaDownload || activeProject.status === "downloading"
                ? "正在下载并上传..."
                : "下载公告 PDF 并同步上传"}
            </span>
          </button>
        </div>
      </div>

      {/* Files loaded list */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/20 shrink-0 flex items-center justify-between text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
          <span>公告 PDF 与上传状态</span>
          <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono font-bold">
            {activeProject.files.length} 个
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {activeProject.files.length === 0 ? (
            <div className="text-center py-16 border border-slate-200/50 border-dashed rounded-xl bg-slate-50/50 flex flex-col items-center justify-center gap-2">
              <FileText className="h-6 w-6 text-slate-300 animate-pulse" />
              <div>
                <p className="text-xs font-bold text-slate-600">尚未下载公告 PDF</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  请点击上方按钮启动巨潮下载
                </p>
              </div>
            </div>
          ) : (
            activeProject.files.map((file) => {
              const isDownloading =
                file.source === "download" && file.downloadStatus === "downloading";
              const isCompleted =
                file.downloadStatus === "completed" || !file.downloadStatus;
              const isPending = file.downloadStatus === "pending";

              return (
                <div
                  key={file.id}
                  className={`border rounded-xl p-3 flex flex-col gap-2 transition-all relative ${
                    isDownloading
                      ? "bg-blue-50/30 border-blue-300 shadow-xs"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                      <FileText
                        className={`h-4.5 w-4.5 shrink-0 ${file.source === "download" ? "text-indigo-500" : "text-emerald-500"}`}
                      />
                      <div className="truncate flex-1 min-w-0">
                        <p
                          className="text-xs font-bold text-slate-800 truncate"
                          title={file.name}
                        >
                          {file.name}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5 flex items-center gap-1">
                          <span>
                            {isCompleted
                              ? `${(file.size / 1024).toFixed(1)} KB`
                              : "官方渠道传输中"}
                          </span>
                          <span className="text-slate-200">|</span>
                          <span
                            className={`px-1 rounded-sm uppercase text-[8px] font-black tracking-widest ${
                              file.source === "download"
                                ? "bg-indigo-50 text-indigo-600 border border-indigo-100"
                                : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                            }`}
                          >
                            {file.source === "download" ? "巨潮" : "本地"}
                          </span>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => onDeleteFile(file.id, e)}
                      className="text-slate-400 hover:text-red-500 p-0.5 rounded transition-colors shrink-0 cursor-pointer"
                      title="移出知识库"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {!isCompleted && (
                    <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                      <div
                        className="bg-blue-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${file.downloadProgress || 0}%` }}
                      />
                    </div>
                  )}
                  {!isCompleted && (
                    <div className="flex justify-between items-center text-[9px] font-bold">
                      <span className="text-blue-600 flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                        {isPending ? "排队连接官方..." : "自动解析 PDF 字符流中..."}
                      </span>
                      <span className="text-slate-500 font-mono">
                        {file.downloadProgress || 0}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

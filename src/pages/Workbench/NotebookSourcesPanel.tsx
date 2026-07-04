/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NotebookSourcesPanel — 展示 NotebookLM 笔记当前已有附件（sources）。
 * 进入工作台时自动加载，支持手动刷新。
 */

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Loader2, FileText, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { NotebookSource } from "../../types";
import { aiddaApi } from "../../api/aidda";

interface NotebookSourcesPanelProps {
  projectId: string;
  notebookId?: string;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; sources: NotebookSource[]; note: string }
  | { status: "error"; message: string };

export function NotebookSourcesPanel({ projectId, notebookId }: NotebookSourcesPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  const fetchSources = useCallback(async () => {
    if (!notebookId) {
      setLoadState({ status: "error", message: "项目未绑定 NotebookLM 笔记" });
      return;
    }
    setLoadState({ status: "loading" });
    try {
      const result = await aiddaApi.getNotebookSources(projectId);
      if (result.status === "error") {
        setLoadState({ status: "error", message: result.errorMessage || "获取 NotebookLM 附件失败" });
      } else {
        const note = `NotebookLM 笔记 ${result.notebookId}，共 ${result.sources.length} 个附件`;
        setLoadState({ status: "loaded", sources: result.sources, note });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "网络请求失败";
      setLoadState({ status: "error", message });
    }
  }, [projectId, notebookId]);

  // Auto-load on mount
  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-black text-slate-800">NotebookLM 笔记附件区</span>
          {loadState.status === "loaded" && (
            <span className="text-[10px] text-slate-500">{loadState.note}</span>
          )}
        </div>
        <button
          onClick={fetchSources}
          disabled={loadState.status === "loading"}
          className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loadState.status === "loading" ? "animate-spin" : ""}`} />
          <span>刷新</span>
        </button>
      </div>

      <div className="p-4">
        {loadState.status === "idle" || loadState.status === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs font-bold">获取 NotebookLM 附件列表中...</span>
          </div>
        ) : loadState.status === "error" ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-xs font-bold">{loadState.message}</span>
            </div>
            <button
              onClick={fetchSources}
              className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
            >
              重试
            </button>
          </div>
        ) : loadState.sources.length === 0 ? (
          <div className="py-8 text-center">
            <FileText className="h-6 w-6 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500">NotebookLM 笔记中尚无附件</p>
            <p className="text-[10px] text-slate-400 mt-1">请在公告对齐页下载并上传公告 PDF</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {loadState.sources.map((source) => (
              <div
                key={source.sourceId}
                className="border border-slate-200 rounded-xl p-3 flex flex-col gap-2 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <FileText className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                  {source.isReady ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  )}
                </div>
                <p className="text-[11px] font-bold text-slate-800 line-clamp-2 leading-relaxed" title={source.title}>
                  {source.title}
                </p>
                <div className="flex items-center gap-2 text-[9px] text-slate-400 mt-auto">
                  <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                    {source.kind}
                  </span>
                  <span className={source.isReady ? "text-emerald-600" : "text-amber-600"}>
                    {source.isReady ? "ready" : source.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

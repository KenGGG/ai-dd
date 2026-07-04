/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReportWorkspace — 分次提问与报告页。
 *
 * 专注处理 NotebookLM 逐轮提问、每轮答案、最终报告展示。
 * 从 ReportViewer 中提取出纯报告工作区，去掉 PDF 下载/上传相关状态。
 */

import {
  Sparkles,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Check,
  Copy,
  ChevronRight,
  Download,
  FileCode,
  AlertTriangle,
} from "lucide-react";
import { Project } from "../../types";
import MarkdownRenderer from "../../components/MarkdownRenderer";

interface ReportWorkspaceProps {
  activeProject: Project;
  reportTab: "compiled" | "individual";
  selectedIndividualQId: string | null;
  copySuccess: boolean;
  moduleCopySuccess: string | null;
  onReportTabChange: (tab: "compiled" | "individual") => void;
  onSelectIndividualQId: (id: string | null) => void;
  onGenerateReport: () => void;
  onCopyReport: () => void;
  onDownloadMarkdown: () => void;
  onCopyModuleAnswer: (questionId: string, answer: string) => void;
  onRetry: () => void;
}

export function ReportWorkspace({
  activeProject,
  reportTab,
  selectedIndividualQId,
  copySuccess,
  moduleCopySuccess,
  onReportTabChange,
  onSelectIndividualQId,
  onGenerateReport,
  onCopyReport,
  onDownloadMarkdown,
  onCopyModuleAnswer,
  onRetry,
}: ReportWorkspaceProps) {
  // Running states (parsing/querying/synthesizing) — show report in progress
  if (activeProject.status !== "idle" && activeProject.reports) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Monitor header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold select-none">
            <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
              子任务状态监听:
            </span>

            {activeProject.reports.answers.map((ans) => {
              const isRunning = ans.status === "running";
              const isCompleted = ans.status === "completed";
              const isFailed = ans.status === "failed";

              return (
                <div
                  key={ans.questionId}
                  className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                    isRunning
                      ? "bg-blue-50 border-blue-200 text-blue-700 animate-pulse"
                      : isCompleted
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : isFailed
                          ? "bg-rose-50 border-rose-200 text-rose-700"
                          : "bg-slate-50 border-slate-100 text-slate-400"
                  }`}
                >
                  {isRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
                  {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                  {isFailed && <AlertCircle className="h-3.5 w-3.5 text-rose-600" />}
                  <span>{ans.title}</span>
                </div>
              );
            })}
          </div>

          {activeProject.status === "completed" && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onCopyReport}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
              >
                {copySuccess ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copySuccess ? "复制成功" : "复制报告"}</span>
              </button>
              <button
                onClick={onDownloadMarkdown}
                className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>下载 MD 报告</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab toggle */}
        <div className="bg-white border-b border-slate-100 px-6 py-2 flex items-center justify-between shrink-0 select-none text-xs font-bold">
          <div className="flex bg-slate-100 p-0.5 rounded-lg">
            <button
              onClick={() => onReportTabChange("compiled")}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                reportTab === "compiled"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              汇编综合报告
            </button>
            <button
              onClick={() => onReportTabChange("individual")}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                reportTab === "individual"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              逐轮回答记录
            </button>
          </div>

          <div className="text-[10px] text-slate-400 font-mono">
            ENGINE_STATUS: {activeProject.status.toUpperCase()}
          </div>
        </div>

        {/* Tab A: Compiled Report */}
        {reportTab === "compiled" && (
          <div className="flex-1 overflow-y-auto p-8 min-h-0 bg-white">
            {activeProject.status === "parsing" && (
              <div className="py-24 flex flex-col items-center justify-center text-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <h4 className="text-sm font-extrabold text-slate-800">
                  第一步：正在对 A股 年报/公告底稿进行分章节结构化解析...
                </h4>
                <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                  正在将 Base64 文档及 PDF 数据流转化为可检索字符索引，剔除排版噪音。
                </p>
              </div>
            )}

            {activeProject.status === "querying" && !activeProject.reports.fullReport && (
              <div className="py-24 flex flex-col items-center justify-center text-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <h4 className="text-sm font-extrabold text-slate-800">
                  第二步：投行核心审计提词穿透并行检索中...
                </h4>
                <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                  正在调用大语言模型对已索引条款开展多轮比对、摘录及来源页码标注。
                </p>
              </div>
            )}

            {activeProject.status === "synthesizing" && (
              <div className="py-24 flex flex-col items-center justify-center text-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <h4 className="text-sm font-extrabold text-slate-800">
                  第三步：工作底稿格式合规及条款综合汇编...
                </h4>
                <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                  正在进行前后文数据一致性交叉核验，排除虚假信息，组装最终报告。
                </p>
              </div>
            )}

            {activeProject.reports.fullReport ? (
              <div className="max-w-3xl mx-auto">
                <MarkdownRenderer content={activeProject.reports.fullReport} />
              </div>
            ) : null}
          </div>
        )}

        {/* Tab B: Individual Answers */}
        {reportTab === "individual" && (
          <div className="flex-1 overflow-hidden flex min-h-0">
            <div className="w-60 bg-white border-r border-slate-200 shrink-0 overflow-y-auto p-3 space-y-1 select-none">
              <span className="text-[9px] uppercase font-extrabold text-slate-400 block px-2.5 py-1">
                选择审查维度
              </span>
              {activeProject.reports.answers.map((ans) => {
                const isSelected = ans.questionId === selectedIndividualQId;
                return (
                  <button
                    key={ans.questionId}
                    onClick={() => onSelectIndividualQId(ans.questionId)}
                    className={`w-full text-left p-2.5 rounded-xl font-bold text-xs flex items-center justify-between transition-all cursor-pointer ${
                      isSelected
                        ? "bg-blue-50 border border-blue-200/50 text-blue-700"
                        : "hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-transparent"
                    }`}
                  >
                    <div className="truncate flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          ans.status === "completed"
                            ? "bg-emerald-500"
                            : ans.status === "running"
                              ? "bg-blue-500 animate-pulse"
                              : "bg-slate-300"
                        }`}
                      />
                      <span className="truncate">{ans.title}</span>
                    </div>
                    <ChevronRight
                      className={`h-3 w-3 shrink-0 ${isSelected ? "text-blue-500" : "text-slate-300"}`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto bg-white p-8 min-h-0">
              {(() => {
                const ans = activeProject.reports.answers.find(
                  (a) => a.questionId === selectedIndividualQId,
                );
                if (!ans) {
                  return (
                    <p className="text-xs text-slate-400 text-center py-12">
                      请在左侧栏选择一个审查维度查看。
                    </p>
                  );
                }

                if (ans.status === "pending") {
                  return (
                    <div className="py-24 text-center text-slate-500 flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 text-slate-300 animate-pulse" />
                      <p className="text-xs font-bold">该维度处于排队等待分析中</p>
                    </div>
                  );
                }

                if (ans.status === "running") {
                  return (
                    <div className="py-24 text-center text-slate-500 flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                      <p className="text-xs font-bold text-blue-600">
                        正在该模块中检索官方公告关键条款...
                      </p>
                    </div>
                  );
                }

                if (ans.status === "failed") {
                  return (
                    <div className="py-16 text-center text-rose-600 flex flex-col items-center gap-2 bg-rose-50 rounded-2xl p-6 max-w-md mx-auto my-6 border border-rose-100">
                      <AlertCircle className="h-8 w-8 text-rose-500" />
                      <p className="font-extrabold text-sm">该模块提取审计任务失败</p>
                      <p className="text-xs text-rose-500 font-medium leading-relaxed mt-1">
                        {ans.error || "发生了未知内部接口或认证报错"}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="max-w-2xl mx-auto flex flex-col gap-6">
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <FileCode className="h-4 w-4 text-blue-600" />
                          <span className="text-xs uppercase font-extrabold text-slate-400 tracking-wider">
                            系统提词参数及 Prompt 指令
                          </span>
                        </div>
                        <p className="text-xs font-extrabold text-slate-700 mt-2">
                          模块名称：{ans.title}
                        </p>
                        <p className="text-xs font-semibold text-slate-500 mt-1 leading-relaxed">
                          Prompt 指令: {ans.prompt}
                        </p>
                      </div>
                      <button
                        onClick={() => onCopyModuleAnswer(ans.questionId, ans.answer)}
                        className="bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 text-slate-700 font-extrabold text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                        title="复制本单页成果"
                      >
                        {moduleCopySuccess === ans.questionId ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {moduleCopySuccess === ans.questionId ? "复制成功" : "复制单章"}
                        </span>
                      </button>
                    </div>
                    <div className="border-t border-slate-100 pt-4">
                      <MarkdownRenderer content={ans.answer} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Failed state
  if (activeProject.status === "failed" && activeProject.error) {
    return (
      <div className="flex-1 p-8 overflow-y-auto flex items-center justify-center select-none">
        <div className="max-w-md w-full bg-rose-50 border border-rose-100 rounded-2xl p-8 text-center shadow-xs flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-rose-600" />
          </div>
          <div>
            <h3 className="text-sm font-black text-rose-800">AIDDA 流程异常中断</h3>
            <p className="text-xs text-rose-600 font-medium leading-relaxed mt-1.5">
              {activeProject.error}
            </p>
          </div>
          <div className="w-full bg-white border border-rose-100 rounded-xl p-3 text-left text-xs font-medium text-slate-500 space-y-2">
            <p className="font-extrabold text-slate-800">处理建议：</p>
            <p>1. 请确认 NotebookLM 已登录，并执行过 notebooklm auth check --test。</p>
            <p>2. 请确认项目已完成公告 PDF 下载和 NotebookLM 上传。</p>
          </div>
          <button
            onClick={onRetry}
            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>重新尝试连接并重算</span>
          </button>
        </div>
      </div>
    );
  }

  // Idle state with files = ready to generate
  if (activeProject.files.length > 0 && activeProject.status === "idle") {
    return (
      <div className="flex-1 p-8 overflow-y-auto flex items-center justify-center select-none">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-xs flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-indigo-600 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-800">
              标的知识库储备已就绪，等待计算
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">
              当前已载入{" "}
              <strong className="text-indigo-600 font-bold">
                {activeProject.files.length} 份
              </strong>{" "}
              公告年报。系统将按 10 轮问题逐个向 NotebookLM 提问，并合并所有答案形成最终报告。
            </p>
          </div>

          <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-left">
            <span className="text-[9px] uppercase font-extrabold text-slate-400 block mb-1">
              即将执行的 NotebookLM 任务:
            </span>
            <ul className="space-y-1">
              {[
                "资料目录与可填列范围识别",
                "商业模式与大客户分析",
                "核心财务指标诊断",
                "合规与司法风险排查",
                "股权结构与实际控制人",
                "募集资金与募投项目",
                "行业与竞争格局分析",
                "关联交易与独立性分析",
                "董监高与公司治理",
                "尽调综合结论与风险提示",
              ].map((title, idx) => (
                <li
                  key={title}
                  className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span>
                    {idx + 1}. {title}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={onGenerateReport}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/10 transition-all active:scale-98 cursor-pointer"
          >
            <Play className="h-4 w-4" />
            <span>生成报告：逐轮提问并汇编</span>
          </button>
        </div>
      </div>
    );
  }

  // Fallback: no files yet, need to download first
  return (
    <div className="flex-1 p-8 overflow-y-auto flex items-center justify-center select-none">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-xs flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-indigo-600 animate-pulse" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-800">尽调报告工作台</h3>
          <p className="text-xs text-slate-500 leading-relaxed mt-1">
            请先在「公告 PDF 对齐」页下载公告 PDF 并上传到 NotebookLM，然后在此生成报告。
          </p>
        </div>
      </div>
    </div>
  );
}

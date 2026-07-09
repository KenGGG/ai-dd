import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Filter,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import MarkdownRenderer from "./components/MarkdownRenderer";

type RunMode = "lite" | "standard" | "deep";
type QuestionMethod = "chat" | "report";
type WorkbenchTab = "dashboard" | "questions" | "filters";
type FeedbackKind = "info" | "success" | "warning" | "error";
type ProjectStatus = "idle" | "downloading" | "uploading" | "querying" | "completed" | "failed";

type Project = {
  id: string;
  name: string;
  stockCode: string;
  stockName?: string;
  notebookId?: string;
  status: ProjectStatus;
  currentStep: number;
  downloadSuccess?: number;
  uploadSuccess?: number;
  error?: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
};

type ProjectStatusPayload = {
  project: Project;
  sourceStats?: {
    total: number;
    downloaded: number;
    uploaded: number;
    failed: number;
    filtered?: number;
  };
  sourceDetails?: {
    required: number;
    ready: number;
    missing: number;
    records: SourceRecord[];
  };
  answersManifest?: {
    total_rounds?: number;
    success_rounds?: number;
    failed_rounds?: number;
    pending_rounds?: number;
    running_rounds?: number;
    results?: AnswerResult[];
  } | null;
  runLog?: {
    path: string;
    content: string;
  };
  hasReport?: boolean;
};

type SourceRecord = {
  id: string;
  title: string;
  date: string;
  announcementType: string;
  sourceLayer: string;
  downloadStatus: string;
  uploadStatus: string;
  readyStatus: string;
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  localPath: string;
  errorMessage: string;
};

type AnswerResult = {
  round_id: string;
  round_no: number;
  round_name: string;
  prompt: string;
  question_method?: QuestionMethod;
  artifact_id?: string;
  task_id?: string;
  status: "pending" | "submitted" | "running" | "success" | "skipped" | "failed";
  answer_file?: string;
  answer?: string;
  error_message?: string;
};

type QuestionRound = {
  round_id: string;
  round_no: number;
  round_name: string;
  prompt: string;
  enabled?: boolean;
};

const MODES: Array<{
  id: RunMode;
  name: string;
  source: string;
  tone: string;
}> = [
  {
    id: "lite",
    name: "精简",
    source: "近三年定期报告",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  {
    id: "standard",
    name: "标准",
    source: "近三年定期报告",
    tone: "border-blue-200 bg-blue-50 text-blue-800",
  },
  {
    id: "deep",
    name: "深度",
    source: "近三年定期报告 + 最近 200 个公告",
    tone: "border-violet-200 bg-violet-50 text-violet-800",
  },
];

async function requestJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败：${res.status}`);
  return data as T;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [stockCode, setStockCode] = useState("");
  const [mode, setMode] = useState<RunMode>("standard");
  const [questionMethod, setQuestionMethod] = useState<QuestionMethod>("chat");
  const [status, setStatus] = useState<ProjectStatusPayload | null>(null);
  const [report, setReport] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("dashboard");
  const [isSavingQuestions, setIsSavingQuestions] = useState(false);
  const [isSavingFilters, setIsSavingFilters] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [filterText, setFilterText] = useState("");
  const [authMessage, setAuthMessage] = useState<{ text: string; kind: FeedbackKind } | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: FeedbackKind } | null>(null);
  const [questions, setQuestions] = useState<QuestionRound[]>([]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [projects, activeProjectId],
  );
  const selectedMode = MODES.find((item) => item.id === mode) || MODES[1];
  const enabledQuestionCount = questions.filter((question) => question.enabled !== false).length;
  const selectedQuestion =
    questions.find((question) => question.round_id === selectedQuestionId) || questions[0] || null;
  const busy =
    isRunning || ["downloading", "uploading", "querying"].includes(activeProject?.status || "");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const data = await requestJSON<{ projects: Project[] }>("/api/aidda/projects");
      if (cancelled) return;
      setProjects(data.projects || []);
      setActiveProjectId((current) => current || data.projects?.[0]?.id || "");
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const data = await requestJSON<{ terms: string[] }>("/api/aidda/announcement-filters");
      if (!cancelled) setFilterText((data.terms || []).join("\n"));
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const data = await requestJSON<{ questions: QuestionRound[] }>("/api/aidda/question-rounds");
      if (!cancelled) setQuestions(data.questions || []);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    async function run() {
      const data = await requestJSON<{ status: ProjectStatusPayload }>(
        `/api/aidda/projects/${activeProjectId}/status`,
      );
      if (cancelled) return;
      setStatus(data.status);
      setProjects((current) =>
        current.map((project) =>
          project.id === data.status.project.id ? data.status.project : project,
        ),
      );
      if (data.status.hasReport) {
        const reportData = await requestJSON<{ content: string }>(
          `/api/aidda/projects/${activeProjectId}/report`,
        );
        if (!cancelled) setReport(reportData.content || "");
      } else {
        setReport("");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  async function refreshStatus(projectId = activeProjectId, showLoading = true) {
    if (!projectId) return;
    if (showLoading) setIsRefreshing(true);
    try {
      const data = await requestJSON<{ status: ProjectStatusPayload }>(
        `/api/aidda/projects/${projectId}/status`,
      );
      setStatus(data.status);
      setProjects((current) =>
        current.map((project) =>
          project.id === data.status.project.id ? data.status.project : project,
        ),
      );
      if (data.status.hasReport) {
        const reportData = await requestJSON<{ content: string }>(
          `/api/aidda/projects/${projectId}/report`,
        );
        setReport(reportData.content || "");
      } else {
        setReport("");
      }
    } finally {
      if (showLoading) setIsRefreshing(false);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const value = stockCode.trim().toUpperCase();
    if (!value) return;
    setIsCreating(true);
    try {
      const data = await requestJSON<{ project: Project }>("/api/aidda/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockCode: value }),
      });
      setProjects((current) => [
        data.project,
        ...current.filter((item) => item.id !== data.project.id),
      ]);
      setActiveProjectId(data.project.id);
      setActiveTab("dashboard");
      setStockCode("");
      const sourceCount = Number(data.project.meta?.notebookSourceCount || 0);
      setToast({
        kind: "success",
        text:
          sourceCount > 0
            ? `项目已绑定存量 NotebookLM 笔记，已有 ${sourceCount} 个附件。`
            : "项目已创建，并已绑定 NotebookLM。",
      });
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "创建项目失败" });
    } finally {
      setIsCreating(false);
    }
  }

  async function runProject(restartQuestions: boolean) {
    if (!activeProject) return;
    setIsRunning(true);
    setReport("");
    setActiveTab("dashboard");
    setToast({
      kind: "info",
      text: restartQuestions ? "已清空旧报告和旧答案，正在从头问询。" : "正在从断点继续问询。",
    });
    try {
      await requestJSON(`/api/aidda/projects/${activeProject.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, questionMethod, restartQuestions }),
      });
      await pollUntilDone(activeProject.id);
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "尽调运行失败" });
      await refreshStatus(activeProject.id, false).catch(() => undefined);
    } finally {
      setIsRunning(false);
    }
  }

  async function retryQuestion(roundId: string) {
    if (!activeProject) return;
    setIsRunning(true);
    setReport("");
    setActiveTab("dashboard");
    setToast({ kind: "info", text: "正在重问失败问题。" });
    try {
      await requestJSON(
        `/api/aidda/projects/${activeProject.id}/question-rounds/${encodeURIComponent(roundId)}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      await pollUntilDone(activeProject.id);
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "单题重试失败" });
      await refreshStatus(activeProject.id, false).catch(() => undefined);
    } finally {
      setIsRunning(false);
    }
  }

  async function pollUntilDone(projectId: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 60 * 60 * 1000) {
      const data = await requestJSON<{ status: ProjectStatusPayload }>(
        `/api/aidda/projects/${projectId}/status`,
      );
      const project = data.status.project;
      setStatus(data.status);
      setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
      if (project.status === "completed") {
        const reportData = await requestJSON<{ content: string }>(
          `/api/aidda/projects/${projectId}/report`,
        );
        setReport(reportData.content || "");
        setToast({ kind: "success", text: "尽调报告已生成。" });
        return;
      }
      if (project.status === "failed") {
        throw new Error(project.error || "尽调任务失败");
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("任务等待超时，请稍后刷新状态。");
  }

  async function deleteActiveProject() {
    if (!activeProject) return;
    if (!window.confirm(`确定删除 ${activeProject.name}？`)) return;
    await requestJSON(`/api/aidda/projects/${activeProject.id}`, { method: "DELETE" });
    const next = projects.filter((project) => project.id !== activeProject.id);
    setProjects(next);
    setActiveProjectId(next[0]?.id || "");
    setStatus(null);
    setReport("");
  }

  async function checkNotebookLm() {
    setAuthMessage({ kind: "info", text: "正在检查 NotebookLM 登录状态..." });
    try {
      const data = await requestJSON<{ status: { authenticated?: boolean; message?: string } }>(
        "/api/aidda/notebooklm/status",
      );
      setAuthMessage(
        data.status?.authenticated
          ? { kind: "success", text: "NotebookLM 已登录，可以运行尽调。" }
          : {
              kind: "error",
              text: data.status?.message || "NotebookLM 未登录，请先执行 notebooklm login。",
            },
      );
    } catch (err) {
      setAuthMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "NotebookLM 登录状态检查失败",
      });
    }
  }

  async function copyReport() {
    if (!report) return;
    await navigator.clipboard.writeText(report);
    setToast({ kind: "success", text: "报告已复制。" });
  }

  function downloadReport() {
    if (!report || !activeProject) return;
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeProject.stockCode || activeProject.id}_dd_report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function updateQuestion(roundId: string, patch: Partial<QuestionRound>) {
    setQuestions((current) =>
      current.map((question) =>
        question.round_id === roundId ? { ...question, ...patch } : question,
      ),
    );
  }

  function addQuestion() {
    const now = Date.now();
    const nextNo = questions.length;
    const roundId = `q-custom-${now}`;
    setQuestions((current) => [
      ...current,
      {
        round_id: roundId,
        round_no: nextNo,
        round_name: `问题 ${nextNo + 1}：新问题`,
        prompt:
          "请根据本 Notebook 中的全部材料回答这个问题。\n\n请给出结论、关键证据和需要继续核实的事项。",
        enabled: true,
      },
    ]);
    setSelectedQuestionId(roundId);
    setActiveTab("questions");
  }

  function deleteQuestion(roundId: string) {
    const question = questions.find((item) => item.round_id === roundId);
    if (!question) return;
    if (questions.length <= 1) {
      setToast({ kind: "warning", text: "至少需要保留 1 个问题，精简模式会使用它。" });
      return;
    }
    if (!window.confirm(`确定删除「${question.round_name}」？`)) return;
    setQuestions((current) =>
      current
        .filter((item) => item.round_id !== roundId)
        .map((item, index) => ({ ...item, round_no: index })),
    );
    if (selectedQuestionId === roundId) {
      setSelectedQuestionId(questions.find((item) => item.round_id !== roundId)?.round_id || "");
    }
  }

  async function saveQuestions() {
    setIsSavingQuestions(true);
    try {
      const data = await requestJSON<{ questions: QuestionRound[] }>("/api/aidda/question-rounds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions }),
      });
      setQuestions(data.questions || []);
      setToast({
        kind: "success",
        text: "问题模板已保存。精简模式使用第 1 个问题，标准/深度使用当前全部问题。",
      });
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "问题模板保存失败" });
    } finally {
      setIsSavingQuestions(false);
    }
  }

  async function saveAnnouncementFilters() {
    setIsSavingFilters(true);
    try {
      const terms = filterText
        .replace(/，/g, ",")
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const data = await requestJSON<{ terms: string[] }>("/api/aidda/announcement-filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms }),
      });
      setFilterText((data.terms || []).join("\n"));
      setToast({ kind: "success", text: "公告标题过滤词已保存。" });
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "公告过滤词保存失败" });
    } finally {
      setIsSavingFilters(false);
    }
  }

  return (
    <main className="min-h-dvh bg-slate-100 text-slate-900">
      <div className="grid min-h-dvh lg:grid-cols-[340px_1fr]">
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          stockCode={stockCode}
          isCreating={isCreating}
          authMessage={authMessage}
          onStockCodeChange={setStockCode}
          onCreateProject={createProject}
          onSelectProject={(projectId) => {
            setActiveProjectId(projectId);
            setActiveTab("dashboard");
          }}
          onCheckNotebookLm={checkNotebookLm}
        />

        <section className="min-w-0 px-4 py-5 lg:px-7">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-700">当前项目</p>
                <h1 className="mt-1 truncate text-2xl font-bold tracking-normal text-slate-950">
                  {activeProject ? activeProject.name : "请选择或创建一个项目"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  {activeProject
                    ? `NotebookLM：${activeProject.notebookId || "未绑定"}`
                    : "从左侧创建项目后，即可运行公告尽调。"}
                </p>
              </div>
              {activeProject && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => refreshStatus()}
                    disabled={isRefreshing}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                    刷新
                  </button>
                  <button
                    type="button"
                    onClick={deleteActiveProject}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </button>
                </div>
              )}
            </header>

            {toast && <FeedbackBanner feedback={toast} />}

            <WorkbenchTabs activeTab={activeTab} onChange={setActiveTab} />

            {activeTab === "dashboard" && (
              <DashboardPanel
                activeProject={activeProject}
                status={status}
                report={report}
                mode={mode}
                questionMethod={questionMethod}
                enabledQuestionCount={enabledQuestionCount}
                selectedMode={selectedMode}
                busy={busy}
                onModeChange={setMode}
                onQuestionMethodChange={setQuestionMethod}
                onRunProject={runProject}
                onRetryQuestion={retryQuestion}
                onCopyReport={copyReport}
                onDownloadReport={downloadReport}
              />
            )}

            {activeTab === "questions" && (
              <QuestionSettingsPanel
                questions={questions}
                selectedQuestion={selectedQuestion}
                selectedQuestionId={selectedQuestionId}
                isSavingQuestions={isSavingQuestions}
                onSelectQuestion={setSelectedQuestionId}
                onAddQuestion={addQuestion}
                onDeleteQuestion={deleteQuestion}
                onSaveQuestions={saveQuestions}
                onUpdateQuestion={updateQuestion}
              />
            )}

            {activeTab === "filters" && (
              <AnnouncementFiltersPanel
                filterText={filterText}
                isSavingFilters={isSavingFilters}
                onFilterTextChange={setFilterText}
                onSaveFilters={saveAnnouncementFilters}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Sidebar({
  projects,
  activeProjectId,
  stockCode,
  isCreating,
  authMessage,
  onStockCodeChange,
  onCreateProject,
  onSelectProject,
  onCheckNotebookLm,
}: {
  projects: Project[];
  activeProjectId: string;
  stockCode: string;
  isCreating: boolean;
  authMessage: { text: string; kind: FeedbackKind } | null;
  onStockCodeChange: (value: string) => void;
  onCreateProject: (event: FormEvent) => void;
  onSelectProject: (projectId: string) => void;
  onCheckNotebookLm: () => void;
}) {
  return (
    <aside className="flex min-h-dvh flex-col border-r border-slate-200 bg-white px-4 py-5 lg:sticky lg:top-0">
      <div>
        <p className="text-sm font-semibold text-blue-700">AIDDA 尽调</p>
        <h2 className="mt-1 text-xl font-bold tracking-normal text-slate-950">公告尽调工作台</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          下载公告、同步 NotebookLM、逐轮问询并汇编报告。
        </p>
      </div>

      <form onSubmit={onCreateProject} className="mt-6 rounded-lg border border-slate-200 p-3">
        <label className="text-sm font-semibold text-slate-800" htmlFor="stock-code">
          创建新项目
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="stock-code"
            value={stockCode}
            onChange={(event) => onStockCodeChange(event.target.value)}
            placeholder="例如 300750"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={isCreating || !stockCode.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            创建
          </button>
        </div>
      </form>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">项目列表</h3>
          <span className="text-xs font-medium text-slate-500">{projects.length} 个</span>
        </div>
        <div className="flex min-h-[220px] flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {projects.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
              还没有项目，先输入股票代码创建。
            </p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject(project.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  project.id === activeProjectId
                    ? "border-blue-400 bg-blue-50 shadow-sm"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{project.name}</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      {project.stockName || project.stockCode} · {project.stockCode}
                    </p>
                  </div>
                  <StatusBadge status={project.status} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={onCheckNotebookLm}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          <RefreshCw className="h-4 w-4" />
          检查 NotebookLM
        </button>
        {authMessage && (
          <div className="mt-3">
            <FeedbackBanner feedback={authMessage} compact />
          </div>
        )}
      </div>
    </aside>
  );
}

function FeedbackBanner({
  feedback,
  compact = false,
}: {
  feedback: { text: string; kind: FeedbackKind };
  compact?: boolean;
}) {
  const classes =
    feedback.kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : feedback.kind === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : feedback.kind === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm font-medium ${classes} ${compact ? "text-xs" : ""}`}
    >
      {feedback.text}
    </div>
  );
}

function WorkbenchTabs({
  activeTab,
  onChange,
}: {
  activeTab: WorkbenchTab;
  onChange: (tab: WorkbenchTab) => void;
}) {
  const tabs: Array<{ id: WorkbenchTab; label: string; icon: ReactNode }> = [
    { id: "dashboard", label: "尽调看板", icon: <FileText className="h-4 w-4" /> },
    { id: "questions", label: "问题设置", icon: <Settings className="h-4 w-4" /> },
    { id: "filters", label: "公告过滤", icon: <Filter className="h-4 w-4" /> },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition ${
            activeTab === tab.id
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function DashboardPanel({
  activeProject,
  status,
  report,
  mode,
  questionMethod,
  enabledQuestionCount,
  selectedMode,
  busy,
  onModeChange,
  onQuestionMethodChange,
  onRunProject,
  onRetryQuestion,
  onCopyReport,
  onDownloadReport,
}: {
  activeProject: Project | null;
  status: ProjectStatusPayload | null;
  report: string;
  mode: RunMode;
  questionMethod: QuestionMethod;
  enabledQuestionCount: number;
  selectedMode: (typeof MODES)[number];
  busy: boolean;
  onModeChange: (mode: RunMode) => void;
  onQuestionMethodChange: (method: QuestionMethod) => void;
  onRunProject: (restartQuestions: boolean) => void;
  onRetryQuestion: (roundId: string) => void;
  onCopyReport: () => void;
  onDownloadReport: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <ProgressPanel status={status} project={activeProject} />
      <SourceDetailsPanel status={status} />
      <RunControls
        activeProject={activeProject}
        status={status}
        mode={mode}
        questionMethod={questionMethod}
        enabledQuestionCount={enabledQuestionCount}
        selectedMode={selectedMode}
        busy={busy}
        report={report}
        onModeChange={onModeChange}
        onQuestionMethodChange={onQuestionMethodChange}
        onRunProject={onRunProject}
      />
      <FailureAlert project={activeProject} />
      <CommandLog status={status} />
      <QuestionProgress status={status} isBusy={busy} onRetryQuestion={onRetryQuestion} />
      <ReportPanel
        report={report}
        onCopyReport={onCopyReport}
        onDownloadReport={onDownloadReport}
      />
    </section>
  );
}

function SourceDetailsPanel({ status }: { status: ProjectStatusPayload | null }) {
  const details = status?.sourceDetails;
  const records = details?.records || [];
  if (!details || records.length === 0) return null;

  const missingRecords = records.filter(
    (record) =>
      record.downloadStatus !== "skipped_filter" &&
      record.downloadStatus !== "skipped_duplicate" &&
      !["uploaded", "skipped_existing_source"].includes(record.uploadStatus),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">NotebookLM 资料明细</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            当前尽调要求 {details.required} 个 PDF，NotebookLM 已就绪 {details.ready} 个，还差{" "}
            {details.missing} 个。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="要求" value={details.required} />
          <Metric label="已就绪" value={details.ready} />
          <Metric label="缺口" value={details.missing} />
        </div>
      </div>

      {missingRecords.length > 0 && (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {missingRecords.map((record) => record.title).join("、")} 未成功上传到 NotebookLM。
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              <th className="px-4 py-3">公告</th>
              <th className="px-3 py-3">日期</th>
              <th className="px-3 py-3">资料层级</th>
              <th className="px-3 py-3">本地 PDF</th>
              <th className="px-3 py-3">NotebookLM</th>
              <th className="px-3 py-3">Source ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((record) => (
              <tr key={record.id} className="align-top">
                <td className="max-w-[240px] px-4 py-3">
                  <p className="font-bold text-slate-900">{record.title || "未命名公告"}</p>
                  {record.errorMessage && (
                    <p className="mt-1 text-xs leading-5 text-rose-700">{record.errorMessage}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{record.date || "-"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                  {sourceLayerLabel(record.sourceLayer)}
                </td>
                <td className="max-w-[220px] px-3 py-3 text-xs text-slate-500">
                  <SourceStatusBadge status={record.downloadStatus} kind="download" />
                  <p className="mt-1 break-all">{record.localPath || "-"}</p>
                </td>
                <td className="px-3 py-3">
                  <SourceStatusBadge status={record.uploadStatus} kind="upload" />
                  {record.sourceTitle && (
                    <p className="mt-1 max-w-[180px] break-words text-xs text-slate-500">
                      {record.sourceTitle}
                    </p>
                  )}
                </td>
                <td className="max-w-[180px] break-all px-3 py-3 text-xs text-slate-500">
                  {record.sourceId || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function sourceLayerLabel(layer: string) {
  return layer === "periodic_report_3y"
    ? "近三年定期报告"
    : layer === "recent_200"
      ? "最近公告"
      : layer === "both"
        ? "定期+最近"
        : layer || "-";
}

function SourceStatusBadge({ status, kind }: { status: string; kind: "download" | "upload" }) {
  const ready =
    kind === "upload"
      ? ["uploaded", "skipped_existing_source"]
      : ["downloaded", "skipped_existing_source"];
  const skipped = ["skipped_filter", "skipped_duplicate", "skipped"].includes(status);
  const failed = status.includes("failed") || status === "upload_failed";
  const label =
    status === "uploaded"
      ? "已上传"
      : status === "skipped_existing_source"
        ? "已存在"
        : status === "downloaded"
          ? "已下载"
          : status === "skipped_filter"
            ? "已过滤"
            : status === "skipped_duplicate"
              ? "重复跳过"
              : failed
                ? "失败"
                : status || "等待";
  const classes = ready.includes(status)
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : failed
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : skipped
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold ${classes}`}>
      {label}
    </span>
  );
}

function RunControls({
  activeProject,
  status,
  mode,
  questionMethod,
  enabledQuestionCount,
  selectedMode,
  busy,
  report,
  onModeChange,
  onQuestionMethodChange,
  onRunProject,
}: {
  activeProject: Project | null;
  status: ProjectStatusPayload | null;
  mode: RunMode;
  questionMethod: QuestionMethod;
  enabledQuestionCount: number;
  selectedMode: (typeof MODES)[number];
  busy: boolean;
  report: string;
  onModeChange: (mode: RunMode) => void;
  onQuestionMethodChange: (method: QuestionMethod) => void;
  onRunProject: (restartQuestions: boolean) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-950">运行设置</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            选择资料范围和 NotebookLM 回复方式后启动尽调。
          </p>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {[
            { id: "chat" as const, label: "对话回复" },
            { id: "report" as const, label: "生成报告" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onQuestionMethodChange(item.id)}
              className={`min-h-10 rounded-md px-3 text-sm font-bold transition ${
                questionMethod === item.id
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onModeChange(item.id)}
            className={`rounded-lg border p-4 text-left transition ${
              mode === item.id
                ? `${item.tone} border-current ring-2 ring-blue-100`
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-bold">{item.name}</span>
              {mode === item.id && <CheckCircle2 className="h-5 w-5" />}
            </div>
            <p className="mt-3 text-sm font-medium leading-6">{item.source}</p>
            <p className="mt-1 text-sm font-medium leading-6">
              {item.id === "lite" ? "1 个问题" : `${enabledQuestionCount} 个问题`}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <RunSummary status={status} project={activeProject} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRunProject(false)}
            disabled={!activeProject || busy}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {busy
              ? "正在运行..."
              : `${report ? "再次" : "继续"}${selectedMode.name}${questionMethod === "report" ? "报告式" : ""}尽调`}
          </button>
          <button
            type="button"
            onClick={() => onRunProject(true)}
            disabled={!activeProject || busy}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            从头问询
          </button>
        </div>
      </div>
    </section>
  );
}

function FailureAlert({ project }: { project: Project | null }) {
  if (project?.status !== "failed") return null;
  return (
    <details className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <summary className="flex cursor-pointer items-start gap-3 font-bold">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        任务执行失败：{project.error ? "运行过程出现异常" : "请检查登录状态或网络。"}
      </summary>
      {project.error && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-rose-900">
          {project.error}
        </pre>
      )}
    </details>
  );
}

function ReportPanel({
  report,
  onCopyReport,
  onDownloadReport,
}: {
  report: string;
  onCopyReport: () => void;
  onDownloadReport: () => void;
}) {
  return (
    <section className="min-h-[520px] rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-950">尽调报告</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopyReport}
            disabled={!report}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Clipboard className="h-4 w-4" />
            复制
          </button>
          <button
            type="button"
            onClick={onDownloadReport}
            disabled={!report}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            下载 Markdown
          </button>
        </div>
      </div>
      <div className="px-4 py-5 lg:px-8">
        {report ? (
          <div className="mx-auto max-w-4xl">
            <MarkdownRenderer content={report} />
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
            <FileText className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              报告会在任务完成后显示在这里。
            </p>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
              推荐先用标准模式跑通流程；需要更完整事件覆盖时再选择深度模式。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function QuestionSettingsPanel({
  questions,
  selectedQuestion,
  isSavingQuestions,
  onSelectQuestion,
  onAddQuestion,
  onDeleteQuestion,
  onSaveQuestions,
  onUpdateQuestion,
}: {
  questions: QuestionRound[];
  selectedQuestion: QuestionRound | null;
  selectedQuestionId: string;
  isSavingQuestions: boolean;
  onSelectQuestion: (roundId: string) => void;
  onAddQuestion: () => void;
  onDeleteQuestion: (roundId: string) => void;
  onSaveQuestions: () => void;
  onUpdateQuestion: (roundId: string, patch: Partial<QuestionRound>) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">问题设置</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            第 1 个问题用于精简模式；标准和深度会按当前列表顺序执行全部问题。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddQuestion}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" />
            新增问题
          </button>
          <button
            type="button"
            onClick={onSaveQuestions}
            disabled={isSavingQuestions}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSavingQuestions ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存问题
          </button>
        </div>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
        {questions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 lg:col-span-2">
            正在读取问题模板，或模板文件为空。
          </div>
        ) : selectedQuestion ? (
          <>
            <div className="max-h-[620px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {questions.map((question, index) => (
                <button
                  key={question.round_id}
                  type="button"
                  onClick={() => onSelectQuestion(question.round_id)}
                  className={`mb-2 w-full rounded-lg border px-3 py-2 text-left transition last:mb-0 ${
                    selectedQuestion.round_id === question.round_id
                      ? "border-blue-400 bg-white shadow-sm"
                      : "border-transparent hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  <p className="text-xs font-bold text-slate-500">问题 {index + 1}</p>
                  <p className="mt-1 truncate text-sm font-bold text-slate-900">
                    {question.round_name}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">{question.round_id}</p>
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-500">{selectedQuestion.round_id}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {questions[0]?.round_id === selectedQuestion.round_id
                      ? "精简模式默认问题"
                      : "标准/深度模式问题"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteQuestion(selectedQuestion.round_id)}
                  disabled={questions.length <= 1}
                  className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
              <input
                value={selectedQuestion.round_name}
                onChange={(event) =>
                  onUpdateQuestion(selectedQuestion.round_id, { round_name: event.target.value })
                }
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <label className="mt-3 block text-xs font-bold text-slate-500">Prompt 内容</label>
              <textarea
                value={selectedQuestion.prompt}
                onChange={(event) =>
                  onUpdateQuestion(selectedQuestion.round_id, { prompt: event.target.value })
                }
                rows={14}
                className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function AnnouncementFiltersPanel({
  filterText,
  isSavingFilters,
  onFilterTextChange,
  onSaveFilters,
}: {
  filterText: string;
  isSavingFilters: boolean;
  onFilterTextChange: (value: string) => void;
  onSaveFilters: () => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Filter className="h-5 w-5 text-blue-600" />
        <h2 className="text-base font-bold text-slate-950">公告过滤</h2>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        命中标题过滤词的最近公告不会下载；定期报告仍按报告规则筛选。
      </p>
      <textarea
        value={filterText}
        onChange={(event) => onFilterTextChange(event.target.value)}
        rows={12}
        placeholder="每行一个词，例如：\n会议通知\n股票交易异常波动"
        className="mt-4 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="button"
        onClick={onSaveFilters}
        disabled={isSavingFilters}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSavingFilters ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        保存过滤词
      </button>
    </section>
  );
}

function QuestionProgress({
  status,
  isBusy,
  onRetryQuestion,
}: {
  status: ProjectStatusPayload | null;
  isBusy: boolean;
  onRetryQuestion: (roundId: string) => void;
}) {
  const results = status?.answersManifest?.results || [];
  if (results.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-bold text-slate-950">问询进度</h2>
        <p className="mt-1 text-sm text-slate-500">
          每成功回复一个问题，答案会立即显示在这里；失败后可点击继续从断点重试。
        </p>
      </div>
      <div className="grid gap-3 p-4">
        {results.map((answer, index) => (
          <article key={answer.round_id} className="rounded-lg border border-slate-200 bg-slate-50">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  {index + 1}. {answer.round_name}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">{answer.round_id}</p>
                {answer.artifact_id && (
                  <p className="mt-1 break-all text-xs font-medium text-blue-600">
                    NotebookLM report：{answer.artifact_id}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AnswerBadge status={answer.status} />
                {answer.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => onRetryQuestion(answer.round_id)}
                    disabled={isBusy}
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重问本题
                  </button>
                )}
              </div>
            </div>
            <div className="bg-white px-3 py-3">
              {answer.answer ? (
                <div className="max-h-[360px] overflow-y-auto rounded-lg border border-slate-100 px-3 py-2">
                  <MarkdownRenderer content={answer.answer} />
                </div>
              ) : answer.error_message ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
                  {answer.error_message}
                </p>
              ) : (
                <p className="text-sm text-slate-500">等待 NotebookLM 回复。</p>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProgressPanel({
  status,
  project,
}: {
  status: ProjectStatusPayload | null;
  project: Project | null;
}) {
  if (!project && !status) return null;
  const source = status?.sourceStats;
  const answers = status?.answersManifest;
  const sourceTotal = source?.total || 0;
  const sourceDone = source?.uploaded || project?.uploadSuccess || 0;
  const answerTotal = answers?.total_rounds || 0;
  const answerDone = answers?.success_rounds || 0;
  const sourceProgress = sourceTotal > 0 ? sourceDone / sourceTotal : project?.currentStep ? 1 : 0;
  const answerProgress = answerTotal > 0 ? answerDone / answerTotal : 0;
  const stepWeight =
    project?.status === "completed"
      ? 1
      : project?.status === "querying"
        ? 0.65 + answerProgress * 0.35
        : project?.status === "downloading" || project?.status === "uploading"
          ? sourceProgress * 0.6
          : 0;
  const progress = Math.max(0, Math.min(100, Math.round(stepWeight * 100)));
  const notebookSourceCount = Number(project?.meta?.notebookSourceCount || 0);
  const steps = [
    {
      label: "公告下载",
      value: `${source?.downloaded || 0}/${sourceTotal}`,
      done: sourceTotal > 0 && (source?.downloaded || 0) >= sourceTotal,
      active: project?.status === "downloading",
    },
    {
      label: "NotebookLM 上传",
      value: `${sourceDone}/${sourceTotal}`,
      done: sourceTotal > 0 && sourceDone >= sourceTotal,
      active: project?.status === "uploading",
    },
    {
      label: "AI 问答",
      value: `${answerDone}/${answerTotal}`,
      done: answerTotal > 0 && answerDone >= answerTotal,
      active: project?.status === "querying",
    },
    {
      label: "报告生成",
      value: project?.status === "completed" ? "已生成" : status?.hasReport ? "可查看" : "等待",
      done: project?.status === "completed" || Boolean(status?.hasReport),
      active: false,
    },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project?.status} />
            <p className="text-sm font-bold text-slate-950">调查工作进度</p>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            NotebookLM 存量附件 {notebookSourceCount}{" "}
            个；资料、问答和报告生成进度会在任务运行时持续更新。
          </p>
        </div>
        <div className="text-left lg:text-right">
          <p className="text-2xl font-bold text-slate-950">{progress}%</p>
          <p className="text-xs font-semibold text-slate-500">整体完成度</p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                step.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : step.active
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              {step.done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">{step.label}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{step.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
        <Metric label="过滤" value={String(source?.filtered || 0)} />
        <Metric label="资料异常" value={String(source?.failed || 0)} />
        <Metric label="问答异常" value={String(answers?.failed_rounds || 0)} />
      </div>
    </section>
  );
}

function CommandLog({ status }: { status: ProjectStatusPayload | null }) {
  const content = status?.runLog?.content || "";
  if (!content) return null;

  return (
    <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">运行日志</h2>
          <p className="mt-1 text-sm text-slate-500">默认折叠，仅在需要排查时展开。</p>
        </div>
        <span className="text-xs font-bold text-slate-500">查看详情</span>
      </summary>
      <div className="border-t border-slate-200">
        {status?.runLog?.path && (
          <p className="px-4 py-2 text-xs font-medium text-slate-500">{status.runLog.path}</p>
        )}
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap bg-slate-950 p-4 text-xs leading-5 text-slate-100">
          {content}
        </pre>
      </div>
    </details>
  );
}

function AnswerBadge({ status }: { status?: AnswerResult["status"] }) {
  const label =
    status === "success" || status === "skipped"
      ? "已回答"
      : status === "failed"
        ? "失败"
        : status === "submitted"
          ? "已提交"
          : status === "running"
            ? "问询中"
            : "等待";
  const classes =
    status === "success" || status === "skipped"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : status === "running" || status === "submitted"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`w-fit shrink-0 rounded-md border px-2 py-1 text-xs font-bold ${classes}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status?: ProjectStatus }) {
  const label =
    status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : status === "downloading"
          ? "采集中"
          : status === "uploading"
            ? "上传中"
            : status === "querying"
              ? "提问中"
              : "待运行";
  const classes =
    status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : ["downloading", "uploading", "querying"].includes(status || "")
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-bold ${classes}`}>
      {label}
    </span>
  );
}

function RunSummary({
  status,
  project,
}: {
  status: ProjectStatusPayload | null;
  project: Project | null;
}) {
  const source = status?.sourceStats;
  const answers = status?.answersManifest;
  return (
    <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-4 lg:flex lg:flex-wrap">
      <Metric label="状态" value={<StatusBadge status={project?.status} />} />
      <Metric
        label="PDF"
        value={`${source?.uploaded || project?.uploadSuccess || 0}/${source?.total || 0}`}
      />
      <Metric
        label="问题"
        value={`${answers?.success_rounds || 0}/${answers?.total_rounds || 0}`}
      />
      <Metric label="异常" value={String(source?.failed || answers?.failed_rounds || 0)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

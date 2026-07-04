import { AlertCircle, CheckCircle2, Database, Loader2, RefreshCw } from "lucide-react";
import { NotebookLmAuthState } from "../../hooks/useNotebookLmAuth";

interface NotebookLmStatusProps {
  notebookLmAuth: NotebookLmAuthState;
  notebookLmAuthMessage: string;
  onCheckNotebookLmAuth: () => void;
}

export function NotebookLmStatus({
  notebookLmAuth,
  notebookLmAuthMessage,
  onCheckNotebookLmAuth,
}: NotebookLmStatusProps) {
  const statusClass =
    notebookLmAuth === "ok"
      ? "bg-emerald-50 border-emerald-100 text-emerald-600"
      : notebookLmAuth === "failed"
        ? "bg-rose-50 border-rose-100 text-rose-600"
        : "bg-slate-50 border-slate-100 text-slate-500";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center border ${statusClass}`}
        >
          {notebookLmAuth === "checking" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : notebookLmAuth === "ok" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : notebookLmAuth === "failed" ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <Database className="h-5 w-5" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-800">NotebookLM / notebooklm-py 登录状态</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{notebookLmAuthMessage}</p>
          <p className="text-[10px] text-slate-400 mt-1 font-mono">
            conda activate openclaw && notebooklm auth check --test
          </p>
        </div>
      </div>
      <button
        onClick={onCheckNotebookLmAuth}
        disabled={notebookLmAuth === "checking"}
        className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {notebookLmAuth === "checking" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        <span>检查登录状态</span>
      </button>
    </div>
  );
}

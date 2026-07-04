import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Link2,
  RotateCw,
} from "lucide-react";
import { Project, ProjectFile } from "../../types";

interface SourceRelationshipMatrixProps {
  activeProject: Project;
}

export function SourceRelationshipMatrix({ activeProject }: SourceRelationshipMatrixProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-800">公告资料关系矩阵</p>
          <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
            一行对应一条目标公告：目标 PDF、本地下载、NotebookLM 附件/source 关系在这里对齐。
          </p>
        </div>
        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-full text-[10px] font-black shrink-0">
          {activeProject.files.length} 条
        </span>
      </div>

      <div className="max-h-[34rem] overflow-auto">
        {activeProject.files.length === 0 ? (
          <div className="px-3 py-8 text-center text-[10px] font-bold text-slate-400">
            尚未形成公告关系表
          </div>
        ) : (
          <table className="w-full text-left text-[10px] min-w-[760px]">
            <thead className="sticky top-0 bg-white border-b border-slate-100 text-slate-400 uppercase z-10">
              <tr>
                <th className="px-3 py-2 font-black w-24">资料池</th>
                <th className="px-3 py-2 font-black">目标公告 PDF</th>
                <th className="px-3 py-2 font-black w-28">本地下载</th>
                <th className="px-3 py-2 font-black">NotebookLM 附件</th>
                <th className="px-3 py-2 font-black w-32">续传依据</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeProject.files.map((file) => (
                <RelationshipRow key={file.id} file={file} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RelationshipRow({ file }: { file: ProjectFile }) {
  return (
    <tr className="align-top hover:bg-slate-50/70">
      <td className="px-3 py-3">
        <SourceLayerBadge sourceLayer={file.sourceLayer} />
      </td>
      <td className="px-3 py-3 min-w-0">
        <div className="flex items-start gap-2">
          <FileText className="h-3.5 w-3.5 text-indigo-500 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-slate-800 line-clamp-2" title={file.name}>
              {file.name}
            </p>
            <p className="text-[9px] text-slate-400 mt-0.5">
              {file.date || "未知日期"}
              {file.announcementType ? ` · ${file.announcementType}` : ""}
            </p>
            {file.downloadUrl && (
              <p className="text-[9px] text-slate-400 mt-0.5 truncate max-w-72">
                {file.downloadUrl}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <StatusPill kind={file.downloadStatus || "pending"} label={downloadLabel(file)} />
        {file.localPath && (
          <p className="text-[9px] text-slate-400 mt-1 truncate max-w-28">{file.localPath}</p>
        )}
      </td>
      <td className="px-3 py-3 min-w-0">
        <div className="flex flex-col gap-1">
          <StatusPill kind={file.uploadStatus || "pending"} label={uploadLabel(file)} />
          {(file.sourceId || file.sourceTitle) && (
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-2 max-w-64">
              <p className="text-[9px] text-emerald-800 font-black truncate">
                {file.sourceTitle || "NotebookLM source"}
              </p>
              <p className="text-[9px] text-emerald-600 font-mono truncate mt-0.5">
                {file.sourceId || "source id pending"}
              </p>
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-3">
        <ResumeHint file={file} />
      </td>
    </tr>
  );
}

function SourceLayerBadge({ sourceLayer }: { sourceLayer?: ProjectFile["sourceLayer"] }) {
  const label =
    sourceLayer === "periodic_report_3y"
      ? "定期报告"
      : sourceLayer === "recent_200"
        ? "最近公告"
        : sourceLayer === "both"
          ? "双资料池"
          : "未知";
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-1 font-black">
      {label}
    </span>
  );
}

function StatusPill({ kind, label }: { kind: string; label: string }) {
  const isOk = ["completed", "uploaded", "skipped", "existing"].includes(kind);
  const isFailed = kind === "failed";
  const Icon = isOk
    ? CheckCircle2
    : isFailed
      ? AlertCircle
      : kind === "pending"
        ? Clock3
        : RotateCw;
  const classes = isOk
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : isFailed
      ? "bg-rose-50 text-rose-700 border-rose-100"
      : "bg-blue-50 text-blue-700 border-blue-100";

  return (
    <span
      className={`inline-flex items-center gap-1 border rounded-full px-2 py-1 font-black ${classes}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ResumeHint({ file }: { file: ProjectFile }) {
  if (file.uploadStatus === "uploaded" || file.uploadStatus === "existing") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
        <Database className="h-3 w-3" />
        可复用 source
      </span>
    );
  }
  if (file.downloadStatus === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-blue-700 font-bold">
        <Link2 className="h-3 w-3" />
        从本地 PDF 续传
      </span>
    );
  }
  if (file.downloadStatus === "failed") {
    return <span className="text-rose-600 font-bold">重新下载该公告</span>;
  }
  return <span className="text-slate-400 font-bold">等待处理</span>;
}

function downloadLabel(file: ProjectFile) {
  if (file.downloadStatus === "completed") return "已下载";
  if (file.downloadStatus === "failed")
    return file.downloadError?.includes("过滤词") ? "已过滤" : "失败";
  if (file.downloadStatus === "downloading") return "下载中";
  return "等待";
}

function uploadLabel(file: ProjectFile) {
  if (file.uploadStatus === "uploaded") return "已上传";
  if (file.uploadStatus === "existing") return "笔记已存在";
  if (file.uploadStatus === "skipped") return "跳过";
  if (file.uploadStatus === "failed") return "失败";
  return "等待";
}

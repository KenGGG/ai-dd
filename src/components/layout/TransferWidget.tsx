import { CheckCircle, DownloadCloud, UploadCloud } from "lucide-react";

interface TransferWidgetProps {
  hasActiveSystemTransfers: boolean;
  totalSystemDownloading: number;
  avgSystemDownloadProgress: number;
  totalSystemUploading: number;
  avgSystemUploadProgress: number;
  totalSystemDownloadedCount: number;
  totalSystemUploadedCount: number;
}

export function TransferWidget({
  hasActiveSystemTransfers,
  totalSystemDownloading,
  avgSystemDownloadProgress,
  totalSystemUploading,
  avgSystemUploadProgress,
  totalSystemDownloadedCount,
  totalSystemUploadedCount,
}: TransferWidgetProps) {
  return (
    <div className="mx-3 my-2 p-3 bg-slate-950/30 rounded-xl border border-slate-800/80 flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider">
        <span className="text-slate-400">传输引擎网络状态</span>
        <span className="flex items-center gap-1 font-mono text-[9px]">
          {hasActiveSystemTransfers ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
              <span className="text-blue-400">进行中</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-slate-500">就绪</span>
            </>
          )}
        </span>
      </div>

      {hasActiveSystemTransfers ? (
        <div className="space-y-2">
          {totalSystemDownloading > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-300 font-bold flex items-center gap-1">
                  <DownloadCloud className="h-3 w-3 text-indigo-400 animate-pulse" />
                  正在下载 ({totalSystemDownloading} 份 PDF)
                </span>
                <span className="text-slate-400 font-mono font-bold">
                  {avgSystemDownloadProgress}%
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-blue-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${avgSystemDownloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {totalSystemUploading > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-300 font-bold flex items-center gap-1">
                  <UploadCloud className="h-3 w-3 text-emerald-400 animate-pulse" />
                  正在上传 ({totalSystemUploading} 份 PDF)
                </span>
                <span className="text-slate-400 font-mono font-bold">
                  {avgSystemUploadProgress}%
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${avgSystemUploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 leading-relaxed font-semibold">
          <div className="flex items-center gap-2 mb-1.5 text-slate-400">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span>所有底稿传输任务已同步</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-slate-800/40 text-[10px] text-slate-400">
            <div>
              <span className="text-slate-600 block text-[9px] uppercase tracking-wide">
                累计已下载
              </span>
              <span className="text-indigo-400 font-black text-xs font-mono">
                {totalSystemDownloadedCount} 份 PDF
              </span>
            </div>
            <div>
              <span className="text-slate-600 block text-[9px] uppercase tracking-wide">
                累计已上传
              </span>
              <span className="text-emerald-400 font-black text-xs font-mono">
                {totalSystemUploadedCount} 份 PDF
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

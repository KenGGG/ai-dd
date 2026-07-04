import { NotebookSource, Project, ProjectFile } from "../types";

export interface AiddaBackendProject {
  id: string;
  name: string;
  stockCode?: string;
  stockName?: string;
  notebookId?: string;
  notebookTitle?: string;
  manifestPath?: string;
  pdfDir?: string;
  reportPath?: string;
  downloadSuccess?: number;
  uploadSuccess?: number;
  status?: Project["status"];
  currentStep?: number;
  error?: string;
  createdAt?: string;
}

async function requestJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export function backendProjectToUi(project: AiddaBackendProject): Project {
  return {
    id: project.id,
    name: project.name,
    stockCode: project.stockCode,
    stockName: project.stockName,
    notebookId: project.notebookId,
    notebookTitle: project.notebookTitle,
    manifestPath: project.manifestPath,
    pdfDir: project.pdfDir,
    downloadSuccess: project.downloadSuccess,
    uploadSuccess: project.uploadSuccess,
    createdAt: project.createdAt || new Date().toISOString(),
    files: [],
    reports: null,
    status: (project.status || "idle") as Project["status"],
    currentStep: project.currentStep || 0,
    error: project.error || null,
  };
}

export function manifestRecordsToFiles(records: any[]): ProjectFile[] {
  return records.map((record, index) => ({
    id: record.announcement_id || `announcement-${index}`,
    name: record.title ? `${record.title}.pdf` : `公告文件_${index + 1}.pdf`,
    size: 0,
    type: "application/pdf",
    base64: "",
    source: "download" as const,
    downloadUrl: record.adjunct_url,
    downloadStatus:
      record.download_status === "downloaded" || record.download_status === "skipped_duplicate"
        ? ("completed" as const)
        : record.download_status === "pending"
          ? ("pending" as const)
          : ("failed" as const),
    downloadProgress:
      record.download_status === "downloaded" || record.download_status === "skipped_duplicate"
        ? 100
        : 0,
    downloadError: record.error_message,
    ticker: record.stock_code,
    uploadStatus:
      record.upload_status === "uploaded"
        ? ("uploaded" as const)
        : record.upload_status === "skipped_existing_source"
          ? ("existing" as const)
          : record.upload_status === "upload_failed"
            ? ("failed" as const)
            : record.download_status === "skipped_duplicate"
              ? ("skipped" as const)
              : ("pending" as const),
    sourceLayer: record.source_layer,
    date: record.date,
    announcementType: record.announcement_type,
    localPath: record.local_path,
    sha256: record.sha256,
    sourceId: record.source_id,
    sourceTitle: record.source_title,
    readyStatus: record.ready_status,
  }));
}

export const aiddaApi = {
  async listProjects() {
    return requestJSON<{ projects: AiddaBackendProject[] }>("/api/aidda/projects");
  },

  async createProject(stockCode: string) {
    return requestJSON<{ project: any; record: AiddaBackendProject }>("/api/aidda/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stockCode }),
    });
  },

  async deleteProject(id: string) {
    return requestJSON<{ ok: true }>(`/api/aidda/projects/${id}`, { method: "DELETE" });
  },

  async checkNotebookLmStatus() {
    return requestJSON<{ status: any }>("/api/aidda/notebooklm/status");
  },

  async startDownloadAndUpload(project: Project, excludeTitleKeywords: string[] = []) {
    return requestJSON<{ message: string; jobId: number; project: AiddaBackendProject }>(
      `/api/aidda/projects/${project.id}/download-and-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockCode: project.stockCode,
          notebookId: project.notebookId,
          periodicYears: 3,
          recentLimit: 200,
          excludeTitleKeywords,
        }),
      },
    );
  },

  async startComposeReport(project: Project) {
    return requestJSON<{ message: string; jobId: number; project: AiddaBackendProject }>(
      `/api/aidda/projects/${project.id}/compose-report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: project.name,
          stockCode: project.stockCode,
          stockName: project.stockName || "",
          notebookId: project.notebookId,
        }),
      },
    );
  },

  async getProjectStatus(projectId: string) {
    return requestJSON<{ status: any }>(`/api/aidda/projects/${projectId}/status`);
  },

  async getManifest(projectId: string) {
    return requestJSON<{ records: any[]; total: number }>(
      `/api/aidda/projects/${projectId}/manifest`,
    );
  },

  async getNotebookSources(projectId: string) {
    const data = await requestJSON<{
      status: string;
      notebook_id: string;
      sources: Array<{
        source_id: string;
        title: string;
        kind: string;
        status: string;
        is_ready: boolean;
      }>;
      error_message?: string;
    }>(`/api/aidda/projects/${projectId}/notebook-sources`);

    return {
      status: data.status,
      notebookId: data.notebook_id,
      sources: (data.sources || []).map(
        (source): NotebookSource => ({
          sourceId: source.source_id,
          title: source.title,
          kind: source.kind,
          status: source.status,
          isReady: source.is_ready,
        }),
      ),
      errorMessage: data.error_message,
    };
  },

  async getReport(projectId: string) {
    return requestJSON<{ content: string; path: string }>(
      `/api/aidda/projects/${projectId}/report`,
    );
  },
};

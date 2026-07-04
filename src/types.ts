/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ProjectFile {
  id: string;
  name: string;
  size: number;
  type: string;
  base64: string; // Base64 representation of the file
  source: "upload" | "download";
  downloadUrl?: string;
  downloadStatus?: "pending" | "downloading" | "completed" | "failed";
  downloadProgress?: number; // 0-100
  downloadError?: string;
  ticker?: string; // associated stock ticker if any
  uploadStatus?: "pending" | "uploaded" | "failed" | "skipped";
  sourceLayer?: "periodic_report_3y" | "recent_200" | "both";
}

export interface QuestionAnswer {
  questionId: string;
  title: string;
  prompt: string;
  answer: string;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
}

export interface ProjectReports {
  answers: QuestionAnswer[];
  fullReport: string; // combined markdown report
}

export interface Project {
  id: string;
  name: string;
  stockCode?: string;
  stockName?: string;
  notebookId?: string;
  notebookTitle?: string;
  manifestPath?: string;
  pdfDir?: string;
  downloadSuccess?: number;
  uploadSuccess?: number;
  createdAt: string;
  files: ProjectFile[];
  reports: ProjectReports | null;
  status:
    | "idle"
    | "downloading"
    | "uploading"
    | "parsing"
    | "querying"
    | "synthesizing"
    | "completed"
    | "failed";
  currentStep: number; // 0, 1, 2, 3 etc.
  error: string | null;
}

export interface SystemQuestion {
  id: string;
  title: string;
  prompt: string;
  systemInstruction: string;
}

export type AppTab = "projects" | "details" | "settings";

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { Project, QuestionAnswer } from "../types";
import { aiddaApi, backendProjectToUi, manifestRecordsToFiles } from "../api/aidda";
import { LOCAL_STORAGE_KEY } from "../constants/storage-keys";

export function useProjects() {
  // Projects Lists States
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Custom Create Inputs
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingAiddaProject, setIsCreatingAiddaProject] = useState(false);
  const [isRunningAiddaDownload, setIsRunningAiddaDownload] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  // Track individual question tab focus on report generation
  const [selectedIndividualQId, setSelectedIndividualQId] = useState<string | null>(null);

  useEffect(() => {
    if (activeProject?.reports?.answers && activeProject.reports.answers.length > 0) {
      if (
        !selectedIndividualQId ||
        !activeProject.reports.answers.some((a) => a.questionId === selectedIndividualQId)
      ) {
        setSelectedIndividualQId(activeProject.reports.answers[0].questionId);
      }
    }
  }, [activeProject, selectedIndividualQId]);

  // Load projects from backend database first; localStorage is only a UI cache fallback.
  useEffect(() => {
    aiddaApi
      .listProjects()
      .then((data) => {
        const loaded = (data.projects || []).map(backendProjectToUi);
        setProjects(loaded);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(loaded));
        if (loaded.length > 0) {
          setActiveProjectId(loaded[0].id);
        }
      })
      .catch((e) => {
        console.error("Failed to load projects from backend", e);
        const storedProjects = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (storedProjects) {
          try {
            const parsed = JSON.parse(storedProjects) as Project[];
            setProjects(parsed);
            if (parsed.length > 0) {
              setActiveProjectId(parsed[0].id);
            }
          } catch (err) {
            console.error("Failed to load cached projects", err);
          }
        }
      });
  }, []);

  const saveProjects = (updatedProjects: Project[]) => {
    setProjects(updatedProjects);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedProjects));
  };

  const syncProjectFilesFromManifest = async (projectId: string) => {
    const manifestData = await aiddaApi
      .getManifest(projectId)
      .catch(() => ({ records: [], total: 0 }));
    const files = manifestRecordsToFiles(manifestData.records || []);
    if (files.length === 0) return;

    setProjects((current) => {
      const next = current.map((p) => (p.id === projectId ? { ...p, files } : p));
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const syncProjectFromBackend = (project: any) => {
    if (!project) return;
    setProjects((current) => {
      const base = backendProjectToUi(project);
      const existing = current.find((p) => p.id === base.id);
      const merged: Project = {
        ...base,
        files: existing?.files || [],
        reports: existing?.reports || null,
      };
      const next = current.some((p) => p.id === base.id)
        ? current.map((p) => (p.id === base.id ? merged : p))
        : [merged, ...current];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const pollProjectStatus = async (
    projectId: string,
    isDone: (project: Project, status: any) => boolean,
    timeoutMs = 30 * 60 * 1000,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const data = await aiddaApi.getProjectStatus(projectId);
      const backendProject = data.status?.project;
      syncProjectFromBackend(backendProject);
      await syncProjectFilesFromManifest(projectId);
      const uiProject = backendProjectToUi(backendProject);
      if (isDone(uiProject, data.status)) {
        return data.status;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("任务等待超时，请稍后在项目状态中继续查看。");
  };

  // ---------------------------------------------------------
  // Project Action Handlers
  // ---------------------------------------------------------
  const handleCreateProject = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault();
    if (!newProjectName.trim()) return false;

    const stockCode = newProjectName.trim().toUpperCase();
    setIsCreatingAiddaProject(true);

    try {
      const data = await aiddaApi.createProject(stockCode);

      const project = data.project;
      const normalizedCode = project.stock_code || stockCode;
      const stockName = project.stock_name || normalizedCode;
      const newProj: Project = {
        id: project.project_id,
        name: project.project_name || `AIDDA-${normalizedCode}-${stockName}-公告尽调`,
        stockCode: normalizedCode,
        stockName,
        notebookId: project.notebook_id,
        notebookTitle: project.notebook_title,
        createdAt: new Date().toISOString(),
        files: [],
        reports: null,
        status: "idle",
        currentStep: 0,
        error: null,
      };

      const updated = [...projects, newProj];
      saveProjects(updated);
      setActiveProjectId(newProj.id);
      setNewProjectName("");
      return true;
    } catch (err: any) {
      alert(err.message || "创建项目失败，请确认 NotebookLM 已登录。");
      return false;
    } finally {
      setIsCreatingAiddaProject(false);
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("确定要删除该项目以及关联的所有报告与知识库文件吗？")) return;

    const updated = projects.filter((p) => p.id !== id);
    saveProjects(updated);

    if (activeProjectId === id) {
      if (updated.length > 0) {
        setActiveProjectId(updated[0].id);
      } else {
        setActiveProjectId(null);
      }
    }

    try {
      await aiddaApi.deleteProject(id);
    } catch (err) {
      console.error("Failed to delete project from backend", err);
    }
  };

  const handleDeleteFile = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeProject) return;

    const updatedProjects = projects.map((p) => {
      if (p.id === activeProject.id) {
        return {
          ...p,
          files: p.files.filter((f) => f.id !== fileId),
        };
      }
      return p;
    });
    saveProjects(updatedProjects);
  };

  const handleAiddaDownloadAndUpload = async (excludeTitleKeywords: string[] = []) => {
    if (!activeProject) return;
    if (!activeProject.stockCode || !activeProject.notebookId) {
      alert("当前项目缺少股票代码或 NotebookLM 笔记 ID，请从项目管理中心重新创建。");
      return;
    }

    setIsRunningAiddaDownload(true);
    setProjects((current) => {
      const next = current.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              status: "downloading" as const,
              currentStep: 1,
              error: null,
            }
          : p,
      );
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    try {
      await aiddaApi.startDownloadAndUpload(activeProject, excludeTitleKeywords);

      const finishedStatus = await pollProjectStatus(
        activeProject.id,
        (project) => project.status === "idle" || project.status === "failed",
      );
      if (finishedStatus.project?.status === "failed") {
        throw new Error(finishedStatus.project?.error || "公告下载或上传失败");
      }

      const manifestData = await aiddaApi.getManifest(activeProject.id).catch(() => ({
        records: [],
        total: 0,
      }));
      const files = manifestRecordsToFiles(manifestData.records || []);

      setProjects((current) => {
        const next = current.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                files,
                status: p.status === "failed" ? ("failed" as const) : ("idle" as const),
                currentStep: 1,
                manifestPath: p.manifestPath,
                pdfDir: p.pdfDir,
                downloadSuccess: p.downloadSuccess,
                uploadSuccess: p.uploadSuccess,
                error: null,
              }
            : p,
        );
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err: any) {
      setProjects((current) => {
        const next = current.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                status: "failed" as const,
                error: err.message || "公告下载或上传失败",
              }
            : p,
        );
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    } finally {
      setIsRunningAiddaDownload(false);
    }
  };

  // ---------------------------------------------------------
  // Core AI Due Diligence Multi-step Process Orchestration
  // ---------------------------------------------------------
  const handleGenerateReport = async () => {
    if (!activeProject) return;

    if (activeProject.files.length === 0) {
      alert("请先在左侧巨潮公告 PDF 入口下载并上传公告底稿。");
      return;
    }
    if (!activeProject.stockCode || !activeProject.notebookId) {
      alert("当前项目缺少股票代码或 NotebookLM 笔记 ID，请从项目管理中心重新创建。");
      return;
    }

    const initialAnswers: QuestionAnswer[] = Array.from({ length: 10 }).map((_, idx) => ({
      questionId: `round-${idx}`,
      title: `第 ${idx + 1} 轮 NotebookLM 提问`,
      prompt: "使用 templates/question_rounds.json 中的固化问题清单",
      answer: "",
      status: "pending",
    }));

    // Update state to stage 1: parsing
    setProjects((current) => {
      const next = current.map((p) => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            status: "parsing" as const,
            currentStep: 1,
            error: null,
            reports: {
              answers: initialAnswers,
              fullReport: "",
            },
          };
        }
        return p;
      });
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    try {
      setProjects((current) => {
        const next = current.map((p) => {
          if (p.id === activeProject.id) {
            return {
              ...p,
              status: "querying" as const,
              currentStep: 2,
            };
          }
          return p;
        });
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      await aiddaApi.startComposeReport(activeProject);

      setProjects((current) => {
        const next = current.map((p) => {
          if (p.id === activeProject.id) {
            return {
              ...p,
              status: "synthesizing" as const,
              currentStep: 3,
            };
          }
          return p;
        });
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      const finishedStatus = await pollProjectStatus(
        activeProject.id,
        (project) => project.status === "completed" || project.status === "failed",
      );
      if (finishedStatus.project?.status === "failed") {
        throw new Error(finishedStatus.project?.error || "NotebookLM 提问或报告拼接失败");
      }

      const rounds = finishedStatus?.answersManifest?.rounds || [];
      const completedAnswers: QuestionAnswer[] =
        rounds.length > 0
          ? rounds.map((round: any, idx: number) => ({
              questionId: `round-${round.round ?? idx}`,
              title: round.module || `第 ${idx + 1} 轮 NotebookLM 提问`,
              prompt: round.prompt || "templates/question_rounds.json",
              answer: round.answer_path ? `答案已保存：${round.answer_path}` : "",
              status: round.status === "completed" ? ("completed" as const) : ("failed" as const),
              error: round.error_message,
            }))
          : initialAnswers.map((ans) => ({ ...ans, status: "completed" as const }));

      const reportData = await aiddaApi
        .getReport(activeProject.id)
        .catch(() => ({ content: "", path: "" }));

      setProjects((current) => {
        const next = current.map((p) => {
          if (p.id === activeProject.id) {
            return {
              ...p,
              status: "completed" as const,
              currentStep: 3,
              reports: {
                answers: completedAnswers,
                fullReport: reportData.content || "",
              },
            };
          }
          return p;
        });
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err: any) {
      console.error("AIDDA report generation error:", err);

      setProjects((current) => {
        const next = current.map((p) => {
          if (p.id === activeProject.id) {
            const errorAnswers =
              p.reports?.answers.map((ans) => {
                if (ans.status === "running" || ans.status === "pending") {
                  return {
                    ...ans,
                    status: "failed" as const,
                    error: err.message || "由于主工序外部冲突导致失败",
                  };
                }
                return ans;
              }) || [];

            return {
              ...p,
              status: "failed" as const,
              error:
                err.message || "执行 NotebookLM 提问或报告拼接时失败，请检查 NotebookLM 登录状态。",
              reports: p.reports
                ? {
                    ...p.reports,
                    answers: errorAnswers,
                  }
                : null,
            };
          }
          return p;
        });
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    }
  };

  return {
    // State
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    activeProject,
    newProjectName,
    setNewProjectName,
    isCreatingAiddaProject,
    isRunningAiddaDownload,
    selectedIndividualQId,
    setSelectedIndividualQId,

    // Actions
    handleCreateProject,
    handleDeleteProject,
    handleDeleteFile,
    handleAiddaDownloadAndUpload,
    handleGenerateReport,
  };
}

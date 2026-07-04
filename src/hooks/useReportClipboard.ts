import { useState } from "react";
import { Project } from "../types";

export function useReportClipboard(activeProject: Project | null) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [moduleCopySuccess, setModuleCopySuccess] = useState<string | null>(null);

  const handleDownloadMarkdown = () => {
    if (!activeProject || !activeProject.reports) return;

    const element = document.createElement("a");
    const file = new Blob([activeProject.reports.fullReport], {
      type: "text/markdown;charset=utf-8",
    });
    element.href = URL.createObjectURL(file);
    element.download = `尽职调查报告_${activeProject.name}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleCopyReport = () => {
    if (!activeProject || !activeProject.reports) return;
    navigator.clipboard.writeText(activeProject.reports.fullReport);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleCopyModuleAnswer = (questionId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setModuleCopySuccess(questionId);
    setTimeout(() => setModuleCopySuccess(null), 2000);
  };

  return {
    copySuccess,
    moduleCopySuccess,
    handleDownloadMarkdown,
    handleCopyReport,
    handleCopyModuleAnswer,
  };
}

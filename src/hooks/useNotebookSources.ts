import { useEffect, useState } from "react";
import { aiddaApi } from "../api/aidda";
import { NotebookSource, Project } from "../types";

export function useNotebookSources(activeProject: Project | null) {
  const [notebookSources, setNotebookSources] = useState<NotebookSource[]>([]);
  const [isLoadingNotebookSources, setIsLoadingNotebookSources] = useState(false);
  const [notebookSourcesError, setNotebookSourcesError] = useState<string | null>(null);

  const refreshNotebookSources = async () => {
    if (!activeProject?.id || !activeProject.notebookId) {
      setNotebookSources([]);
      setNotebookSourcesError(null);
      return;
    }

    setIsLoadingNotebookSources(true);
    setNotebookSourcesError(null);
    try {
      const data = await aiddaApi.getNotebookSources(activeProject.id);
      setNotebookSources(data.sources);
    } catch (error) {
      setNotebookSources([]);
      setNotebookSourcesError(error instanceof Error ? error.message : "读取 NotebookLM 附件失败");
    } finally {
      setIsLoadingNotebookSources(false);
    }
  };

  useEffect(() => {
    refreshNotebookSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.notebookId]);

  return {
    notebookSources,
    isLoadingNotebookSources,
    notebookSourcesError,
    refreshNotebookSources,
  };
}

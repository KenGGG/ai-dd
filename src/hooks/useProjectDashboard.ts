import { Project } from "../types";

export type ProjectStatusFilter = "all" | "empty" | "idle" | "running" | "completed";

function isRunningProject(project: Project) {
  return (
    project.status === "downloading" ||
    project.status === "uploading" ||
    project.status === "parsing" ||
    project.status === "querying" ||
    project.status === "synthesizing"
  );
}

export function useProjectDashboard(
  projects: Project[],
  projectSearchQuery: string,
  projectStatusFilter: ProjectStatusFilter,
) {
  const filteredProjects = projects.filter((project) => {
    const matchesSearch = project.name.toLowerCase().includes(projectSearchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (projectStatusFilter === "all") return true;
    if (projectStatusFilter === "empty") return project.files.length === 0;
    if (projectStatusFilter === "idle") {
      return project.files.length > 0 && project.status === "idle";
    }
    if (projectStatusFilter === "running") return isRunningProject(project);
    if (projectStatusFilter === "completed") return project.status === "completed";
    return true;
  });

  const totalFilesCount = projects.reduce((acc, project) => acc + project.files.length, 0);
  const totalCompletedReports = projects.filter((project) => project.status === "completed").length;
  const allSystemFiles = projects.flatMap((project) => project.files);

  const systemDownloadingFiles = allSystemFiles.filter(
    (file) => file.source === "download" && file.downloadStatus !== "completed",
  );
  const totalSystemDownloading = systemDownloadingFiles.length;
  const avgSystemDownloadProgress =
    totalSystemDownloading > 0
      ? Math.round(
          systemDownloadingFiles.reduce((sum, file) => sum + (file.downloadProgress || 0), 0) /
            totalSystemDownloading,
        )
      : 0;

  const systemUploadingFiles = allSystemFiles.filter(
    (file) => file.source === "upload" && file.downloadStatus !== "completed",
  );
  const totalSystemUploading = systemUploadingFiles.length;
  const avgSystemUploadProgress =
    totalSystemUploading > 0
      ? Math.round(
          systemUploadingFiles.reduce((sum, file) => sum + (file.downloadProgress || 0), 0) /
            totalSystemUploading,
        )
      : 0;

  const totalSystemDownloadedCount = allSystemFiles.filter(
    (file) => file.source === "download" && file.downloadStatus === "completed",
  ).length;
  const totalSystemUploadedCount = allSystemFiles.filter(
    (file) => file.source === "upload" && file.downloadStatus === "completed",
  ).length;

  return {
    filteredProjects,
    totalFilesCount,
    totalCompletedReports,
    totalSystemDownloading,
    avgSystemDownloadProgress,
    totalSystemUploading,
    avgSystemUploadProgress,
    totalSystemDownloadedCount,
    totalSystemUploadedCount,
    hasActiveSystemTransfers: totalSystemDownloading > 0 || totalSystemUploading > 0,
  };
}

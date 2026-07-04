/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { AppTab } from "./types";
import { MobileHeader } from "./components/layout/MobileHeader";
import { Sidebar } from "./components/layout/Sidebar";
import { useNotebookLmAuth } from "./hooks/useNotebookLmAuth";
import { ProjectStatusFilter, useProjectDashboard } from "./hooks/useProjectDashboard";
import { useProjects } from "./hooks/useProjects";
import { useQuestions } from "./hooks/useQuestions";
import { useReportClipboard } from "./hooks/useReportClipboard";
import { ProjectsHub } from "./pages/ProjectsHub/ProjectsHub";
import { Settings } from "./pages/Settings/Settings";
import { EmptyWorkbenchState } from "./pages/Workbench/EmptyWorkbenchState";
import { StepMeter } from "./pages/Workbench/StepMeter";
import { WorkbenchHeader } from "./pages/Workbench/WorkbenchHeader";
import { PdfPanel } from "./pages/Workbench/PdfPanel";
import { ReportViewer } from "./pages/Workbench/ReportViewer";

export default function App() {
  // Navigation
  const [currentTab, setCurrentTab] = useState<AppTab>("projects");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Workbench sub-navigation
  const [reportTab, setReportTab] = useState<"compiled" | "individual">("compiled");

  // Projects list filters
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatusFilter>("all");

  // Project state and CRUD operations
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    activeProject,
    newProjectName,
    setNewProjectName,
    isCreatingAiddaProject,
    isRunningAiddaDownload,
    selectedIndividualQId,
    setSelectedIndividualQId,
    handleCreateProject,
    handleDeleteProject,
    handleDeleteFile,
    handleAiddaDownloadAndUpload,
    handleGenerateReport,
  } = useProjects();

  // NotebookLM authentication status
  const { notebookLmAuth, notebookLmAuthMessage, handleCheckNotebookLmAuth } =
    useNotebookLmAuth();

  // Custom questions management
  const {
    systemQuestions,
    newQuestionTitle,
    setNewQuestionTitle,
    newQuestionPrompt,
    setNewQuestionPrompt,
    handleAddQuestion,
    handleDeleteQuestion,
    handleUpdateQuestionInline,
    handleMoveQuestion,
    handleResetQuestions,
  } = useQuestions();

  // Report copy/download helpers
  const {
    copySuccess,
    moduleCopySuccess,
    handleDownloadMarkdown,
    handleCopyReport,
    handleCopyModuleAnswer,
  } = useReportClipboard(activeProject);

  // Dashboard computed values (filtered projects + aggregated transfer stats)
  const {
    filteredProjects,
    totalFilesCount,
    totalCompletedReports,
    totalSystemDownloading,
    avgSystemDownloadProgress,
    totalSystemUploading,
    avgSystemUploadProgress,
    totalSystemDownloadedCount,
    totalSystemUploadedCount,
    hasActiveSystemTransfers,
  } = useProjectDashboard(projects, projectSearchQuery, projectStatusFilter);

  const onCreateProject = async (e: React.FormEvent) => {
    const created = await handleCreateProject(e);
    if (created) setCurrentTab("details");
  };

  const onSelectProject = (id: string) => {
    setActiveProjectId(id);
    setCurrentTab("details");
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-800 font-sans relative">
      <Sidebar
        currentTab={currentTab}
        isMobileMenuOpen={isMobileMenuOpen}
        projectsCount={projects.length}
        questionsCount={systemQuestions.length}
        activeProject={activeProject}
        onTabChange={setCurrentTab}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        hasActiveSystemTransfers={hasActiveSystemTransfers}
        totalSystemDownloading={totalSystemDownloading}
        avgSystemDownloadProgress={avgSystemDownloadProgress}
        totalSystemUploading={totalSystemUploading}
        avgSystemUploadProgress={avgSystemUploadProgress}
        totalSystemDownloadedCount={totalSystemDownloadedCount}
        totalSystemUploadedCount={totalSystemUploadedCount}
      />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <MobileHeader currentTab={currentTab} onOpenMenu={() => setIsMobileMenuOpen(true)} />

        {/* VIEW 1: Projects Hub */}
        {currentTab === "projects" && (
          <ProjectsHub
            projects={projects}
            filteredProjects={filteredProjects}
            activeProjectId={activeProjectId}
            newProjectName={newProjectName}
            isCreatingAiddaProject={isCreatingAiddaProject}
            projectSearchQuery={projectSearchQuery}
            projectStatusFilter={projectStatusFilter}
            totalFilesCount={totalFilesCount}
            totalCompletedReports={totalCompletedReports}
            onProjectNameChange={setNewProjectName}
            onCreateProject={onCreateProject}
            onSearchChange={setProjectSearchQuery}
            onStatusFilterChange={setProjectStatusFilter}
            onSelectProject={onSelectProject}
            onDeleteProject={handleDeleteProject}
          />
        )}

        {/* VIEW 2: Workbench (project details) */}
        {currentTab === "details" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {!activeProject ? (
              <EmptyWorkbenchState onGoProjects={() => setCurrentTab("projects")} />
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                <WorkbenchHeader
                  activeProject={activeProject}
                  activeProjectId={activeProjectId}
                  projects={projects}
                  onProjectChange={setActiveProjectId}
                  onGenerateReport={handleGenerateReport}
                  onGoProjects={() => setCurrentTab("projects")}
                />

                <StepMeter activeProject={activeProject} />

                <div className="flex-1 flex overflow-hidden min-h-0">
                  <PdfPanel
                    activeProject={activeProject}
                    isRunningAiddaDownload={isRunningAiddaDownload}
                    onDownloadAndUpload={handleAiddaDownloadAndUpload}
                    onDeleteFile={handleDeleteFile}
                  />

                  <ReportViewer
                    activeProject={activeProject}
                    reportTab={reportTab}
                    selectedIndividualQId={selectedIndividualQId}
                    copySuccess={copySuccess}
                    moduleCopySuccess={moduleCopySuccess}
                    onReportTabChange={setReportTab}
                    onSelectIndividualQId={setSelectedIndividualQId}
                    onGenerateReport={handleGenerateReport}
                    onCopyReport={handleCopyReport}
                    onDownloadMarkdown={handleDownloadMarkdown}
                    onCopyModuleAnswer={handleCopyModuleAnswer}
                    onRetry={handleGenerateReport}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: Settings */}
        {currentTab === "settings" && (
          <Settings
            systemQuestions={systemQuestions}
            newQuestionTitle={newQuestionTitle}
            setNewQuestionTitle={setNewQuestionTitle}
            newQuestionPrompt={newQuestionPrompt}
            setNewQuestionPrompt={setNewQuestionPrompt}
            notebookLmAuth={notebookLmAuth}
            notebookLmAuthMessage={notebookLmAuthMessage}
            onAddQuestion={handleAddQuestion}
            onDeleteQuestion={handleDeleteQuestion}
            onUpdateQuestionInline={handleUpdateQuestionInline}
            onMoveQuestion={handleMoveQuestion}
            onResetQuestions={handleResetQuestions}
            onCheckNotebookLmAuth={handleCheckNotebookLmAuth}
          />
        )}
      </div>
    </div>
  );
}

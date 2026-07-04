import { FormEvent, MouseEvent } from "react";
import { FileText, Layers } from "lucide-react";
import { Project } from "../../types";
import { ProjectStatusFilter } from "../../hooks/useProjectDashboard";
import { CreateProjectForm } from "./CreateProjectForm";
import { ProjectCard } from "./ProjectCard";
import { ProjectFilters } from "./ProjectFilters";
import { StatsPanel } from "./StatsPanel";

interface ProjectsHubProps {
  projects: Project[];
  filteredProjects: Project[];
  activeProjectId: string | null;
  newProjectName: string;
  isCreatingAiddaProject: boolean;
  projectSearchQuery: string;
  projectStatusFilter: ProjectStatusFilter;
  totalFilesCount: number;
  totalCompletedReports: number;
  onProjectNameChange: (value: string) => void;
  onCreateProject: (event: FormEvent) => void;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: ProjectStatusFilter) => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string, event: MouseEvent) => void;
}

export function ProjectsHub({
  projects,
  filteredProjects,
  activeProjectId,
  newProjectName,
  isCreatingAiddaProject,
  projectSearchQuery,
  projectStatusFilter,
  totalFilesCount,
  totalCompletedReports,
  onProjectNameChange,
  onCreateProject,
  onSearchChange,
  onStatusFilterChange,
  onSelectProject,
  onDeleteProject,
}: ProjectsHubProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-8 flex flex-col gap-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-blue-600" />
            项目管理中心
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            建立、检索并审查多标的公司，一键调度核心底稿，利用多模块大模型深入剖析披露要件。
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <CreateProjectForm
          newProjectName={newProjectName}
          isCreatingAiddaProject={isCreatingAiddaProject}
          onProjectNameChange={onProjectNameChange}
          onCreateProject={onCreateProject}
        />
        <StatsPanel
          projectsCount={projects.length}
          totalFilesCount={totalFilesCount}
          totalCompletedReports={totalCompletedReports}
        />
      </div>

      <div className="flex flex-col gap-4 mt-2">
        <ProjectFilters
          projectSearchQuery={projectSearchQuery}
          projectStatusFilter={projectStatusFilter}
          onSearchChange={onSearchChange}
          onStatusFilterChange={onStatusFilterChange}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProjects.length === 0 ? (
            <div className="col-span-full bg-white border border-slate-200 rounded-2xl py-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
              <FileText className="h-8 w-8 text-slate-300 animate-pulse" />
              <div>
                <p className="font-semibold text-sm text-slate-700">没有查找到相符的调查项目</p>
                <p className="text-xs text-slate-400 mt-1">
                  您可以试着输入其他关键词，或在上方建立全新的项目。
                </p>
              </div>
            </div>
          ) : (
            filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                onSelect={onSelectProject}
                onDelete={onDeleteProject}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

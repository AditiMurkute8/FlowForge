import React, { useState, useEffect, useCallback } from 'react';
import { MOCK_PROJECTS, MOCK_STATS } from '../mockData';
import type { Project, PipelineHealth, ProjectResponseDto } from '../types';
import {
  fetchProjects as defaultFetchProjects,
  createProject as defaultCreateProject,
  FlowForgeApiError,
} from '../api/flowForgeApi';
import { StatCard } from '../components/ui/StatCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import {
  FolderKanban,
  GitFork,
  Activity,
  CheckCircle,
  Plus,
  Search,
  ExternalLink,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export interface ProjectsDashboardProps {
  onOpenWorkflow: (projectId: string) => void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  fetchProjectsFn?: typeof defaultFetchProjects;
  createProjectFn?: typeof defaultCreateProject;
}

export const ProjectsDashboard: React.FC<ProjectsDashboardProps> = ({
  onOpenWorkflow,
  onShowToast,
  fetchProjectsFn = defaultFetchProjects,
  createProjectFn = defaultCreateProject,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // New Project Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectTag, setNewProjectTag] = useState('Production');
  const [formError, setFormError] = useState<string | null>(null);

  const filterTabs = ['All', 'Production', 'Staging', 'Data Pipeline', 'Security'];

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const page = await fetchProjectsFn({ page: 0, size: 50 });
      const loaded: Project[] = (page.content || []).map((dto: ProjectResponseDto) => ({
        id: dto.id,
        name: dto.name,
        slug: dto.slug,
        description: dto.description || 'Workflow pipeline workspace.',
        workflowCount: 1,
        lastExecutionAt: 'Never',
        lastExecutionStatus: 'QUEUED',
        tags: ['Production'],
        owner: 'current.user@flowforge.internal',
        isMock: false,
        version: 'v1.0.0',
        updatedAt: dto.updatedAt,
      }));
      setProjects(loaded);
    } catch (err) {
      let msg = 'Failed to load projects from server.';
      if (err instanceof FlowForgeApiError) {
        msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setLoadError(msg);
      // Graceful fallback to mock data when backend is not running or unreachable
      setProjects(MOCK_PROJECTS);
    } finally {
      setIsLoading(false);
    }
  }, [fetchProjectsFn]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const filteredProjects = projects.filter((proj) => {
    const matchesSearch =
      proj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag =
      selectedTag === 'All' || proj.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;

    if (!newProjectName.trim()) {
      setFormError('Project name is required');
      return;
    }

    setIsCreating(true);
    setFormError(null);

    try {
      const createdDto = await createProjectFn({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
      });

      const newProj: Project = {
        id: createdDto.id,
        name: createdDto.name,
        slug: createdDto.slug,
        description: createdDto.description || 'Workflow pipeline workspace.',
        workflowCount: 0,
        lastExecutionAt: 'Never',
        lastExecutionStatus: 'QUEUED',
        tags: [newProjectTag],
        owner: 'current.user@flowforge.internal',
        isMock: false,
        version: 'v0.1.0',
        updatedAt: createdDto.updatedAt,
      };

      setProjects((prev) => [newProj, ...prev]);
      setIsCreateModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      setFormError(null);
      if (onShowToast) {
        onShowToast(
          'Project Created',
          `Created project "${createdDto.name}" (${createdDto.slug}).`,
          'success'
        );
      }
    } catch (err) {
      let msg = 'Failed to create project';
      if (err instanceof FlowForgeApiError) {
        msg = err.details && err.details.length > 0
          ? `${err.message}: ${err.details.join(', ')}`
          : err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setFormError(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const renderHealthIndicator = (health: PipelineHealth) => {
    switch (health) {
      case 'HEALTHY':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--status-green-text)] font-mono">
            <span className="h-2 w-2 rounded-full bg-[var(--status-green-text)]" />
            operational
          </span>
        );
      case 'DEGRADED':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--status-yellow-text)] font-mono">
            <span className="h-2 w-2 rounded-full bg-[var(--status-yellow-text)]" />
            degraded
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--status-red-text)] font-mono">
            <span className="h-2 w-2 rounded-full bg-[var(--status-red-text)]" />
            failing
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono">
            <span className="h-2 w-2 rounded-full bg-[var(--text-muted)]" />
            idle
          </span>
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[var(--border-default)] pb-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
            Projects Inventory
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Orchestration workspaces, pipeline schedules, and execution health.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />}
            onClick={() => void loadProjects()}
            disabled={isLoading}
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              setFormError(null);
              setIsCreateModalOpen(true);
            }}
          >
            New Project
          </Button>
        </div>
      </div>

      {/* Backend Connectivity / Load Error Banner */}
      {loadError && (
        <div
          role="alert"
          className="rounded-[6px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-3 text-xs text-[var(--status-yellow-text)] flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0 text-[var(--status-yellow-text)]" />
            <span>
              Backend notice: {loadError} Displaying fallback projects for offline inspection.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadProjects()}
            disabled={isLoading}
          >
            Retry Connection
          </Button>
        </div>
      )}

      {/* Operational Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Projects"
          value={projects.length}
          subtext="Configured tenants"
          icon={<FolderKanban size={15} />}
        />
        <StatCard
          label="Active DAGs"
          value={MOCK_STATS.activeWorkflows}
          subtext="Total topologies"
          icon={<GitFork size={15} />}
        />
        <StatCard
          label="24h Runs"
          value={MOCK_STATS.executions24h.toLocaleString()}
          trend="+14%"
          subtext="Total executions"
          icon={<Activity size={15} />}
        />
        <StatCard
          label="Success Rate"
          value={`${MOCK_STATS.successRatePercent}%`}
          subtext="30-day window"
          icon={<CheckCircle size={15} />}
        />
      </div>

      {/* Search and Tab Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Filter projects by name or key..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            icon={<Search size={13} />}
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTag(tab)}
              className={`rounded-[5px] px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                selectedTag === tab
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)] border border-transparent font-medium shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-default)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && projects.length === 0 ? (
        <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-12 flex flex-col items-center justify-center gap-2">
          <Loader2 size={24} className="animate-spin text-[var(--accent-blue)]" />
          <p className="text-xs font-mono text-[var(--text-secondary)]">
            Loading project inventory from server...
          </p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={20} />}
          title={projects.length === 0 ? 'No Projects Found' : 'No Projects Match Query'}
          description={
            projects.length === 0
              ? 'No projects exist on the server yet. Create your first project workspace to begin.'
              : `No projects found matching "${searchQuery}".`
          }
          actionLabel={projects.length === 0 ? 'Create Project' : 'Clear Filters'}
          onAction={() => {
            if (projects.length === 0) {
              setFormError(null);
              setIsCreateModalOpen(true);
            } else {
              setSearchQuery('');
              setSelectedTag('All');
            }
          }}
        />
      ) : (
        <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-xs">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-[var(--border-default)] bg-[var(--bg-subsurface)] text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            <div className="col-span-5">Project Name & Key</div>
            <div className="col-span-2">Health</div>
            <div className="col-span-2">Pipelines</div>
            <div className="col-span-2">Last Run</div>
            <div className="col-span-1 text-right">Action</div>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[var(--bg-hover)]/70 transition-colors group"
              >
                {/* Project Details */}
                <div className="col-span-5 min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors truncate">
                      {project.name}
                    </span>
                    <Badge variant="outline" size="sm">
                      {project.version}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                      {project.slug}
                    </span>
                    <span className="text-[var(--border-emphasis)]">•</span>
                    <span className="text-[11px] text-[var(--text-secondary)] truncate">
                      {project.description}
                    </span>
                  </div>
                </div>

                {/* Status Indicator */}
                <div className="col-span-2">
                  {renderHealthIndicator(project.lastExecutionStatus)}
                </div>

                {/* Workflows Count & Tags */}
                <div className="col-span-2">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-[var(--text-primary)]">
                    <GitFork size={12} className="text-[var(--text-muted)]" />
                    <span>{project.workflowCount} DAGs</span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {project.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-subsurface)] px-1.5 py-0.2 rounded border border-[var(--border-default)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Last Execution Timestamp */}
                <div className="col-span-2 text-xs font-mono text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Clock size={11} className="text-[var(--text-muted)]" />
                  <span>{project.lastExecutionAt}</span>
                </div>

                {/* Action Button */}
                <div className="col-span-1 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<ExternalLink size={11} />}
                    onClick={() => onOpenWorkflow(project.id)}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Project Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          if (!isCreating) {
            setIsCreateModalOpen(false);
          }
        }}
        title="Initialize New Project"
        description="Create an orchestration workspace for DAG workflows."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateProject}
              disabled={isCreating}
              isLoading={isCreating}
            >
              {isCreating ? 'Creating...' : 'Create Project'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateProject} className="space-y-3">
          {formError && (
            <div
              role="alert"
              className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2.5 text-xs text-[var(--status-red-text)] flex items-center gap-2"
            >
              <AlertTriangle size={14} className="shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Input
            label="Project Name"
            placeholder="e.g. Fraud Detection Engine"
            value={newProjectName}
            onChange={(e) => {
              setNewProjectName(e.target.value);
              if (formError) setFormError(null);
            }}
            disabled={isCreating}
            autoFocus
          />

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--text-secondary)] block">
              Operational Description
            </label>
            <textarea
              rows={2}
              placeholder="Describe the workflows coordinated by this project..."
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              disabled={isCreating}
              className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] transition-colors disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--text-secondary)] block">
              Environment Classification
            </label>
            <select
              value={newProjectTag}
              onChange={(e) => setNewProjectTag(e.target.value)}
              disabled={isCreating}
              className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] transition-colors disabled:opacity-50"
            >
              <option value="Production">Production</option>
              <option value="Staging">Staging</option>
              <option value="Data Pipeline">Data Pipeline</option>
              <option value="Security">Security</option>
            </select>
          </div>
        </form>
      </Modal>
    </div>
  );
};

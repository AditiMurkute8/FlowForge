import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { MOCK_PROJECTS, MOCK_STATS } from '../mockData';
import type { Project, PipelineHealth, ProjectResponseDto, ProjectRole } from '../types';
import {
  fetchProjects as defaultFetchProjects,
  createProject as defaultCreateProject,
  deleteProject as defaultDeleteProject,
  fetchProjectMembers as defaultFetchProjectMembers,
  FlowForgeApiError,
} from '../api/flowForgeApi';
import { AuthContext } from '../context/AuthContext';
import { resolveUserRoleFromMembers } from '../utils/rbacPermissions';
import { ProjectMembersModal } from '../components/project/ProjectMembersModal';
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
  Loader2,
  AlertTriangle,
  RefreshCw,
  Users,
  Trash2,
  ShieldAlert,
} from 'lucide-react';

export interface ProjectsDashboardProps {
  onOpenWorkflow: (projectId: string) => void;
  onShowToast?: (
    title: string,
    message?: string,
    type?: 'success' | 'info' | 'warning' | 'error'
  ) => void;
  fetchProjectsFn?: typeof defaultFetchProjects;
  createProjectFn?: typeof defaultCreateProject;
  deleteProjectFn?: typeof defaultDeleteProject;
  fetchProjectMembersFn?: typeof defaultFetchProjectMembers;
  isAuthenticated?: boolean;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
  user?: { id?: string; email?: string; fullName?: string } | null;
  initialRoles?: Record<string, ProjectRole | null>;
}

export const ProjectsDashboard: React.FC<ProjectsDashboardProps> = ({
  onOpenWorkflow,
  onShowToast,
  fetchProjectsFn = defaultFetchProjects,
  createProjectFn = defaultCreateProject,
  deleteProjectFn = defaultDeleteProject,
  fetchProjectMembersFn = defaultFetchProjectMembers,
  isAuthenticated,
  onOpenAuth,
  user: propUser,
  initialRoles = {},
}) => {
  const authContext = useContext(AuthContext);
  const effectiveIsAuthenticated =
    isAuthenticated !== undefined ? isAuthenticated : (authContext?.isAuthenticated ?? true);
  const effectiveUser = propUser !== undefined ? propUser : authContext?.user;

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRoles, setProjectRoles] = useState<Record<string, ProjectRole | null>>(initialRoles);
  const [rolesLoading, setRolesLoading] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(effectiveIsAuthenticated);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Membership & Administration Modal States
  const [managingMembersProject, setManagingMembersProject] = useState<Project | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // New Project Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectTag, setNewProjectTag] = useState('Production');
  const [formError, setFormError] = useState<string | null>(null);

  const filterTabs = ['All', 'Production', 'Staging', 'Data Pipeline', 'Security'];
  const activeLoadIdRef = useRef<number>(0);

  const loadProjectRoles = useCallback(
    async (projectList: Project[]) => {
      if (!effectiveIsAuthenticated || projectList.length === 0) return;

      const persistentProjects = projectList.filter((p) => !p.isMock);
      if (persistentProjects.length === 0) return;

      // Mark all as loading
      setRolesLoading((prev) => {
        const next = { ...prev };
        persistentProjects.forEach((p) => {
          if (initialRoles[p.id] === undefined) {
            next[p.id] = true;
          }
        });
        return next;
      });

      const roleResults: Record<string, ProjectRole | null> = {};

      await Promise.all(
        persistentProjects.map(async (p) => {
          if (initialRoles[p.id] !== undefined) {
            roleResults[p.id] = initialRoles[p.id];
            return;
          }
          try {
            const members = await fetchProjectMembersFn(p.id);
            const resolvedRole = resolveUserRoleFromMembers(members, effectiveUser);
            roleResults[p.id] = resolvedRole;
          } catch {
            // Fail closed: non-members, 404, 403, or network errors result in null role
            roleResults[p.id] = null;
          }
        })
      );

      setProjectRoles((prev) => ({ ...prev, ...roleResults }));
      setRolesLoading((prev) => {
        const next = { ...prev };
        persistentProjects.forEach((p) => {
          next[p.id] = false;
        });
        return next;
      });
    },
    [effectiveIsAuthenticated, fetchProjectMembersFn, effectiveUser, initialRoles]
  );

  const loadProjects = useCallback(async () => {
    if (!effectiveIsAuthenticated) {
      setIsLoading(false);
      setProjects([]);
      setLoadError(null);
      return;
    }

    const currentLoadId = ++activeLoadIdRef.current;
    setIsLoading(true);
    setLoadError(null);

    try {
      const page = await fetchProjectsFn({ page: 0, size: 50 });
      if (currentLoadId !== activeLoadIdRef.current) return;

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
      void loadProjectRoles(loaded);
    } catch (err) {
      if (currentLoadId !== activeLoadIdRef.current) return;

      let msg = 'Failed to load projects from server.';
      const isAuthError =
        err instanceof FlowForgeApiError && (err.isUnauthorized || err.status === 401);
      if (err instanceof FlowForgeApiError) {
        msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }

      if (isAuthError) {
        setLoadError('Authentication required to view project inventory. Please sign in.');
        setProjects([]); // Never fall back to mock data on 401
        if (onOpenAuth) {
          onOpenAuth('login');
        }
      } else if (err instanceof FlowForgeApiError && err.status === 0) {
        // Backend unreachable (offline): graceful fallback with explicit notice
        setLoadError(`${msg} Displaying fallback projects for offline inspection.`);
        setProjects(MOCK_PROJECTS);
      } else {
        // 5xx or other server failure: report error, do not disguise mock data as real
        setLoadError(msg);
        setProjects([]);
      }
    } finally {
      if (currentLoadId === activeLoadIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [fetchProjectsFn, effectiveIsAuthenticated, onOpenAuth, loadProjectRoles]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const filteredProjects = projects.filter((proj) => {
    const matchesSearch =
      proj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = selectedTag === 'All' || proj.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;

    if (!effectiveIsAuthenticated) {
      setFormError('Authentication required to create a project.');
      if (onShowToast) {
        onShowToast('Authentication Required', 'Please sign in to create a project.', 'warning');
      }
      if (onOpenAuth) {
        onOpenAuth('login');
      }
      return;
    }

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
        owner: effectiveUser?.email || 'current.user@flowforge.internal',
        isMock: false,
        version: 'v0.1.0',
        updatedAt: createdDto.updatedAt,
      };

      // Backend assigns project creator as initial ProjectRole.ADMIN
      setProjectRoles((prev) => ({ ...prev, [newProj.id]: 'ADMIN' }));
      setProjects((prev) => [newProj, ...prev]);
      setIsCreateModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      setFormError(null);

      if (onShowToast) {
        onShowToast(
          'Project Created',
          `Created project "${createdDto.name}" (${createdDto.slug}). You are assigned as Administrator.`,
          'success'
        );
      }
    } catch (err) {
      let msg = 'Failed to create project';
      if (err instanceof FlowForgeApiError) {
        msg =
          err.details && err.details.length > 0
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

  const handleConfirmDeleteProject = async () => {
    if (!projectToDelete || isDeleting) return;

    // Fail closed: only ADMIN can delete
    const role = projectRoles[projectToDelete.id];
    if (role !== 'ADMIN') {
      const msg = 'Access denied: Only project administrators can delete projects.';
      setDeleteError(msg);
      if (onShowToast) {
        onShowToast('Action Forbidden', msg, 'error');
      }
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteProjectFn(projectToDelete.id);
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      setProjectRoles((prev) => {
        const next = { ...prev };
        delete next[projectToDelete.id];
        return next;
      });

      if (onShowToast) {
        onShowToast(
          'Project Deleted',
          `Successfully deleted project "${projectToDelete.name}".`,
          'success'
        );
      }
      setProjectToDelete(null);
    } catch (err) {
      let msg = 'Failed to delete project';
      if (err instanceof FlowForgeApiError) {
        if (err.isConflict || err.status === 409) {
          msg = 'Cannot delete project because dependent workflows exist. Please delete all workflows first.';
        } else if (err.isForbidden || err.status === 403) {
          msg = 'Access denied: Only project administrators can delete projects.';
        } else if (err.isNotFound || err.status === 404) {
          msg = 'Project not found or already deleted.';
        } else {
          msg = err.message;
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setDeleteError(msg);
      if (onShowToast) {
        onShowToast('Deletion Failed', msg, 'error');
      }
    } finally {
      setIsDeleting(false);
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

  const renderRoleBadge = (projectId: string, isMock: boolean) => {
    if (isMock) {
      return (
        <Badge variant="outline" size="sm" data-testid={`project-role-badge-${projectId}`}>
          Demo Template
        </Badge>
      );
    }

    if (rolesLoading[projectId]) {
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)]"
          data-testid={`project-role-loading-${projectId}`}
        >
          <Loader2 size={10} className="animate-spin text-[var(--accent-blue)]" />
          Verifying...
        </span>
      );
    }

    const role = projectRoles[projectId];

    switch (role) {
      case 'ADMIN':
        return (
          <Badge variant="cyan" size="sm" data-testid={`project-role-badge-${projectId}`}>
            ADMIN
          </Badge>
        );
      case 'DEVELOPER':
        return (
          <Badge variant="default" size="sm" data-testid={`project-role-badge-${projectId}`}>
            DEVELOPER
          </Badge>
        );
      case 'VIEWER':
        return (
          <Badge variant="outline" size="sm" data-testid={`project-role-badge-${projectId}`}>
            VIEWER
          </Badge>
        );
      default:
        // Fail closed for unverified/absent role
        return (
          <Badge variant="warning" size="sm" data-testid={`project-role-badge-${projectId}`}>
            Non-Member
          </Badge>
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
              if (!effectiveIsAuthenticated) {
                if (onShowToast) {
                  onShowToast(
                    'Authentication Required',
                    'Please sign in to create a project.',
                    'warning'
                  );
                }
                if (onOpenAuth) {
                  onOpenAuth('login');
                }
                return;
              }
              setFormError(null);
              setIsCreateModalOpen(true);
            }}
            data-testid="new-project-button"
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
            <span>{loadError}</span>
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

      {/* Unauthenticated State */}
      {!effectiveIsAuthenticated ? (
        <div
          className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-12 flex flex-col items-center justify-center text-center gap-3 shadow-xs"
          data-testid="unauthenticated-prompt"
        >
          <div className="h-10 w-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent-blue)]">
            <FolderKanban size={20} />
          </div>
          <div className="max-w-md space-y-1">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Authentication Required
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Sign in to your FlowForge account to access orchestration workspaces, pipeline
              inventory, and execution telemetry.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Button variant="primary" size="sm" onClick={() => onOpenAuth?.('login')}>
              Sign In
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenAuth?.('register')}>
              Create Account
            </Button>
          </div>
        </div>
      ) : isLoading && projects.length === 0 ? (
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
            <div className="col-span-4">Project Name & Key</div>
            <div className="col-span-2">Your Role</div>
            <div className="col-span-2">Health</div>
            <div className="col-span-2">Pipelines</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {filteredProjects.map((project) => {
              const userRole = projectRoles[project.id];
              const isAdmin = userRole === 'ADMIN';

              return (
                <div
                  key={project.id}
                  className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-[var(--bg-hover)]/70 transition-colors group"
                  data-testid={`project-row-${project.id}`}
                >
                  {/* Project Details */}
                  <div className="col-span-4 min-w-0 pr-2">
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

                  {/* Role Indicator */}
                  <div className="col-span-2">{renderRoleBadge(project.id, project.isMock)}</div>

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

                  {/* Role-Aware Action Buttons */}
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<ExternalLink size={11} />}
                      onClick={() => onOpenWorkflow(project.id)}
                      data-testid={`open-project-button-${project.id}`}
                    >
                      Open
                    </Button>

                    {/* Admin Only: Membership Management */}
                    {isAdmin && !project.isMock && (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Users size={11} />}
                        onClick={() => setManagingMembersProject(project)}
                        data-testid={`manage-members-button-${project.id}`}
                        title="Manage project members and roles"
                      >
                        Members
                      </Button>
                    )}

                    {/* Admin Only: Project Deletion */}
                    {isAdmin && !project.isMock && (
                      <button
                        onClick={() => {
                          setDeleteError(null);
                          setProjectToDelete(project);
                        }}
                        className="flex items-center justify-center h-7 w-7 rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] text-[var(--text-secondary)] hover:text-[var(--status-red-text)] hover:border-[var(--status-red-border)] transition-colors cursor-pointer"
                        data-testid={`delete-project-button-${project.id}`}
                        title={`Delete project ${project.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
              data-testid="confirm-create-project-button"
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

      {/* Project Membership Management Modal (Admin Only) */}
      {managingMembersProject && (
        <ProjectMembersModal
          isOpen={Boolean(managingMembersProject)}
          onClose={() => setManagingMembersProject(null)}
          projectId={managingMembersProject.id}
          projectName={managingMembersProject.name}
          currentUserRole={projectRoles[managingMembersProject.id]}
          fetchMembersFn={fetchProjectMembersFn}
          onShowToast={onShowToast}
        />
      )}

      {/* Delete Project Confirmation Modal (Admin Only) */}
      {projectToDelete && (
        <Modal
          isOpen={Boolean(projectToDelete)}
          onClose={() => {
            if (!isDeleting) {
              setProjectToDelete(null);
              setDeleteError(null);
            }
          }}
          title="Delete Project Workspace"
          description={`Permanently remove "${projectToDelete.name}" and all associated metadata.`}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setProjectToDelete(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDeleteProject}
                disabled={isDeleting}
                isLoading={isDeleting}
                data-testid="confirm-delete-project-button"
              >
                {isDeleting ? 'Deleting...' : 'Delete Project'}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            {deleteError && (
              <div
                role="alert"
                className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2.5 text-xs text-[var(--status-red-text)] flex items-center gap-2"
                data-testid="delete-project-error"
              >
                <AlertTriangle size={14} className="shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="rounded-[5px] border border-[var(--status-red-border)]/40 bg-[var(--status-red-bg)]/20 p-3 text-xs text-[var(--status-red-text)] flex items-start gap-2.5">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Destructive Operation Warning</p>
                <p className="text-[11px] leading-relaxed">
                  Deleting a project requires administrator authority. Note: If this project contains
                  active workflows or executions, the backend will reject deletion with a conflict
                  error (409).
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

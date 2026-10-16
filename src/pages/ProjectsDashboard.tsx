import React, { useState } from 'react';
import { MOCK_PROJECTS, MOCK_STATS } from '../mockData';
import type { Project, PipelineHealth } from '../types';
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
} from 'lucide-react';

interface ProjectsDashboardProps {
  onOpenWorkflow: (projectId: string) => void;
}

export const ProjectsDashboard: React.FC<ProjectsDashboardProps> = ({
  onOpenWorkflow,
}) => {
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // New Project Form State
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectTag, setNewProjectTag] = useState('Production');
  const [formError, setFormError] = useState<string | null>(null);

  const filterTabs = ['All', 'Production', 'Staging', 'Data Pipeline', 'Security'];

  const filteredProjects = projects.filter((proj) => {
    const matchesSearch =
      proj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag =
      selectedTag === 'All' || proj.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) {
      setFormError('Project name is required');
      return;
    }

    const newProj: Project = {
      id: `proj-${Date.now()}`,
      name: newProjectName.trim(),
      slug: newProjectName.trim().toLowerCase().replace(/\s+/g, '-'),
      description: newProjectDesc.trim() || 'Workflow pipeline workspace.',
      workflowCount: 1,
      lastExecutionAt: 'Just now',
      lastExecutionStatus: 'HEALTHY',
      tags: [newProjectTag],
      owner: 'current.user@flowforge.internal',
      isMock: true,
      version: 'v0.1.0',
      updatedAt: new Date().toISOString(),
    };

    setProjects([newProj, ...projects]);
    setIsCreateModalOpen(false);
    setNewProjectName('');
    setNewProjectDesc('');
    setFormError(null);
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

        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => setIsCreateModalOpen(true)}
        >
          New Project
        </Button>
      </div>

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

      {/* High-Density Project Inventory List */}
      {filteredProjects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={20} />}
          title="No Projects Match Query"
          description={`No projects found matching "${searchQuery}".`}
          actionLabel="Clear Filters"
          onAction={() => {
            setSearchQuery('');
            setSelectedTag('All');
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
        onClose={() => setIsCreateModalOpen(false)}
        title="Initialize New Project"
        description="Create an orchestration workspace for DAG workflows."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreateProject}>
              Create Project
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateProject} className="space-y-3">
          <Input
            label="Project Name"
            placeholder="e.g. Fraud Detection Engine"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            error={formError || undefined}
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
              className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--text-secondary)] block">
              Environment Classification
            </label>
            <select
              value={newProjectTag}
              onChange={(e) => setNewProjectTag(e.target.value)}
              className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] transition-colors"
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

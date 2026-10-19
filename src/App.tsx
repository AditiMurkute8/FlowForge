import React, { useState, useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { ProjectsDashboard } from './pages/ProjectsDashboard';
import { WorkflowBuilder } from './pages/WorkflowBuilder';
import { Toast, type ToastMessage } from './components/ui/Toast';
import { Modal } from './components/ui/Modal';
import { Input } from './components/ui/Input';
import { MOCK_PROJECTS, MOCK_WORKFLOWS } from './mockData';
import { Search, FolderKanban, GitFork } from 'lucide-react';

function isEditableElement(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<'projects' | 'builder'>('projects');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Dual-theme state with persistent storage and system preference fallback
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('flowforge-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('flowforge-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showToast = (
    title: string,
    message?: string,
    type: 'success' | 'info' | 'warning' | 'error' = 'info'
  ) => {
    setToast({
      id: `toast-${Date.now()}`,
      title,
      message,
      type,
    });
  };

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (!isEditableElement(e)) {
          e.preventDefault();
          setIsSearchOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredProjects = MOCK_PROJECTS.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredWorkflows = MOCK_WORKFLOWS.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppShell
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      onOpenSearch={() => setIsSearchOpen(true)}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {currentTab === 'projects' ? (
        <ProjectsDashboard
          onOpenWorkflow={(projectId) => {
            setSelectedProjectId(projectId);
            setCurrentTab('builder');
          }}
          onShowToast={showToast}
        />
      ) : (
        <WorkflowBuilder
          projectId={selectedProjectId || undefined}
          onBackToProjects={() => setCurrentTab('projects')}
          onShowToast={showToast}
          theme={theme}
        />
      )}

      {/* Global Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Global Command Palette Modal (Cmd+K) */}
      <Modal
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          setSearchQuery('');
        }}
        title="Quick Navigation & Command Palette"
        description="Search projects, workflows, and task pipelines across FlowForge"
      >
        <div className="space-y-4">
          <Input
            placeholder="Search projects or pipelines..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            icon={<Search size={14} />}
            autoFocus
          />

          <div className="space-y-3 max-h-64 overflow-y-auto">
            {/* Projects Section */}
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Projects
              </span>
              <div className="space-y-1">
                {filteredProjects.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)] p-2">No matching projects found.</p>
                ) : (
                  filteredProjects.map((proj) => (
                    <button
                      key={proj.id}
                      onClick={() => {
                        setIsSearchOpen(false);
                        setCurrentTab('projects');
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-[5px] hover:bg-[var(--bg-hover)] text-left transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderKanban size={14} className="text-[var(--accent-blue)] shrink-0" />
                        <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors truncate">
                          {proj.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                        {proj.slug}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Workflows Section */}
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Workflows
              </span>
              <div className="space-y-1">
                {filteredWorkflows.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)] p-2">No matching workflows found.</p>
                ) : (
                  filteredWorkflows.map((wf) => (
                    <button
                      key={wf.id}
                      onClick={() => {
                        setIsSearchOpen(false);
                        setCurrentTab('builder');
                        showToast('Navigated', `Opened workflow ${wf.name}`);
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-[5px] hover:bg-[var(--bg-hover)] text-left transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitFork size={14} className="text-[var(--accent-blue)] shrink-0" />
                        <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors truncate">
                          {wf.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                        {wf.version}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
};

export default App;

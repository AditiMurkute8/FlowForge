import React from 'react';
import {
  GitFork,
  Layers,
  BookOpen,
  Search,
  Command,
  AlertCircle,
  Sun,
  Moon,
  LogIn,
  LogOut,
} from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  currentTab: 'projects' | 'builder';
  onTabChange: (tab: 'projects' | 'builder') => void;
  onOpenSearch?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  user?: { fullName: string; email: string } | null;
  isAuthenticated?: boolean;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
  onLogout?: () => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  currentTab,
  onTabChange,
  onOpenSearch,
  theme = 'dark',
  onToggleTheme,
  user,
  isAuthenticated = false,
  onOpenAuth,
  onLogout,
}) => {
  return (
    <div className="h-full min-h-0 flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Simulation Boundary Banner */}
      <div className="w-full bg-[var(--bg-surface)] border-b border-[var(--border-default)] px-4 py-1.5 flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2 mx-auto">
          <AlertCircle size={13} className="text-[var(--status-yellow-text)] shrink-0" />
          <span>
            <strong className="text-[var(--text-primary)] font-medium">Phase 0 Architecture Boundary:</strong> Simulated pipeline telemetry active. Backend scheduler, database, and workers offline.
          </span>
        </div>
      </div>

      {/* Top Application Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2">
        <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto w-full">
          {/* Brand & Context */}
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-xs">
                <GitFork size={13} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
                  FlowForge
                </span>
                <span className="rounded px-1.5 py-0.2 text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-subsurface)] border border-[var(--border-default)]">
                  v0.1.0-alpha
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1 border-l border-[var(--border-default)] pl-4">
              <button
                onClick={() => onTabChange('projects')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                  currentTab === 'projects'
                    ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-default)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/60 border border-transparent'
                }`}
              >
                <Layers size={13} />
                <span>Projects</span>
              </button>
              <button
                onClick={() => onTabChange('builder')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                  currentTab === 'builder'
                    ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-default)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/60 border border-transparent'
                }`}
              >
                <GitFork size={13} />
                <span>Workflow Builder</span>
              </button>
            </nav>
          </div>

          {/* Global Search, Theme Toggle & Docs Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenSearch}
              className="flex items-center gap-2 rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--border-emphasis)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <Search size={12} />
              <span className="hidden sm:inline text-[11px]">Search pipelines...</span>
              <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-1 text-[10px] font-mono text-[var(--text-secondary)]">
                <Command size={9} />K
              </kbd>
            </button>

            {/* Theme Toggle Button */}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                className="flex items-center justify-center h-7 w-7 rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-emphasis)] transition-colors cursor-pointer"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              </button>
            )}

            <a
              href="https://github.com/AditiMurkute8/FlowForge"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-emphasis)] transition-colors"
            >
              <BookOpen size={12} />
              <span className="hidden sm:inline text-[11px]">Docs</span>
            </a>

            <div className="hidden md:flex items-center gap-1.5 rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-green-text)]" />
              <span className="font-mono text-[var(--text-primary)]">env:default-prod</span>
            </div>

            {/* Auth Actions: Sign In or User Profile / Sign Out */}
            {isAuthenticated && user ? (
              <div className="flex items-center gap-2 pl-2 border-l border-[var(--border-default)]">
                <div
                  className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]"
                  title={`${user.fullName} (${user.email})`}
                >
                  <div className="h-6 w-6 rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] flex items-center justify-center text-[10px] font-semibold select-none">
                    {user.fullName ? user.fullName.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <span className="hidden xl:inline text-[11px] font-medium max-w-[120px] truncate">
                    {user.fullName}
                  </span>
                </div>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="flex items-center gap-1 rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--status-red-text)] hover:border-[var(--status-red-border)] transition-colors cursor-pointer"
                    data-testid="header-sign-out-button"
                  >
                    <LogOut size={12} />
                    <span className="hidden sm:inline text-[11px]">Sign Out</span>
                  </button>
                )}
              </div>
            ) : onOpenAuth ? (
              <div className="flex items-center gap-1 pl-2 border-l border-[var(--border-default)]">
                <button
                  onClick={() => onOpenAuth('login')}
                  className="flex items-center gap-1.5 rounded-[5px] bg-[var(--accent)] text-[var(--accent-contrast)] px-2.5 py-1 text-xs font-medium hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer shadow-xs"
                  data-testid="header-sign-in-button"
                >
                  <LogIn size={12} />
                  <span>Sign In</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
};

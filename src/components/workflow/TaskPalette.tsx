import React, { useState } from 'react';
import { TASK_PALETTE_ITEMS, type TaskPaletteItem } from '../../mockData';
import type { TaskType } from '../../types';
import {
  Globe,
  Terminal,
  Code2,
  Database,
  Sparkles,
  Clock,
  Search,
  Plus,
} from 'lucide-react';

const iconComponents: Record<string, React.ReactNode> = {
  Globe: <Globe size={13} className="text-[var(--accent-blue)]" />,
  Terminal: <Terminal size={13} className="text-[var(--status-green-text)]" />,
  Code2: <Code2 size={13} className="text-[var(--status-yellow-text)]" />,
  Database: <Database size={13} className="text-[#A855F7]" />,
  Sparkles: <Sparkles size={13} className="text-[#EC4899]" />,
  Clock: <Clock size={13} className="text-[var(--text-muted)]" />,
};

interface TaskPaletteProps {
  onAddTask: (taskType: TaskType, label: string) => void;
}

export const TaskPalette: React.FC<TaskPaletteProps> = ({ onAddTask }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = ['All', 'Network', 'Compute', 'Storage', 'Logic'];

  const filteredTasks = TASK_PALETTE_ITEMS.filter((item) => {
    const matchesSearch =
      item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All' ||
      item.category === selectedCategory ||
      (selectedCategory === 'Logic' && item.category === 'AI & Logic');
    return matchesSearch && matchesCategory;
  });

  return (
    <aside className="w-56 border-r border-[var(--border-default)] bg-[var(--bg-surface)] flex flex-col shrink-0 select-none">
      {/* Palette Header */}
      <div className="p-3 border-b border-[var(--border-default)]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Task Library
          </span>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {filteredTasks.length} types
          </span>
        </div>

        {/* Search Input */}
        <div className="relative mt-2">
          <Search
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] pl-6 pr-2 py-1 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] transition-colors"
          />
        </div>

        {/* Categories Tabs */}
        <div className="flex gap-1 overflow-x-auto mt-2 pb-0.5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-[4px] px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap transition-colors cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)] border border-transparent font-medium shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-default)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filteredTasks.map((item: TaskPaletteItem) => (
          <button
            key={item.type}
            onClick={() => onAddTask(item.type, item.label)}
            className="w-full group flex items-center justify-between rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2 text-left hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer shadow-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0">{iconComponents[item.iconName]}</span>
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-[var(--text-primary)] block truncate">
                  {item.label}
                </span>
                <span className="text-[9px] font-mono text-[var(--text-muted)] block truncate">
                  {item.defaultTimeoutMs / 1000}s • {item.defaultMaxRetries} retries
                </span>
              </div>
            </div>
            <Plus
              size={12}
              className="text-[var(--text-muted)] group-hover:text-[var(--accent-blue)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </button>
        ))}
      </div>
    </aside>
  );
};

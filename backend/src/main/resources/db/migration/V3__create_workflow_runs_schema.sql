-- FlowForge Phase 1.3: Durable Run Persistence Schema
-- Tables: workflow_runs, task_runs

-- 1. Workflow Runs Table
CREATE TABLE workflow_runs (
    id UUID PRIMARY KEY,
    workflow_version_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms BIGINT,
    triggered_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workflow_runs_version FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE RESTRICT,
    CONSTRAINT chk_workflow_runs_status CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    CONSTRAINT chk_workflow_runs_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT chk_workflow_runs_timestamps CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX idx_workflow_runs_version_id ON workflow_runs (workflow_version_id, created_at DESC);
CREATE INDEX idx_workflow_runs_status ON workflow_runs (status);

-- 2. Task Runs Table
CREATE TABLE task_runs (
    id UUID PRIMARY KEY,
    workflow_run_id UUID NOT NULL,
    task_id VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms BIGINT,
    error_message VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_runs_workflow_run FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE RESTRICT,
    CONSTRAINT uq_task_runs_workflow_task UNIQUE (workflow_run_id, task_id),
    CONSTRAINT chk_task_runs_status CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    CONSTRAINT chk_task_runs_attempt_count CHECK (attempt_count >= 1),
    CONSTRAINT chk_task_runs_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT chk_task_runs_timestamps CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX idx_task_runs_workflow_run_id ON task_runs (workflow_run_id);
CREATE INDEX idx_task_runs_lookup ON task_runs (workflow_run_id, status);

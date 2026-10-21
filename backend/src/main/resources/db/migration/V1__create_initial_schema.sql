-- FlowForge Phase 1.2: Core Resource Model Initial Schema
-- Tables: projects, workflows, workflow_versions

-- 1. Projects Table
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_slug UNIQUE (slug)
);

-- 2. Workflows Table
CREATE TABLE workflows (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workflows_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    CONSTRAINT uq_workflows_project_slug UNIQUE (project_id, slug)
);

CREATE INDEX idx_workflows_project_id ON workflows (project_id);

-- 3. Workflow Versions Table (Immutable Snapshots)
CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL,
    version_number INTEGER NOT NULL,
    version_tag VARCHAR(30),
    description VARCHAR(500),
    graph_payload JSONB NOT NULL,
    task_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    is_valid_dag BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workflow_versions_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE RESTRICT,
    CONSTRAINT uq_workflow_versions_number UNIQUE (workflow_id, version_number)
);

CREATE INDEX idx_workflow_versions_lookup ON workflow_versions (workflow_id, version_number DESC);

-- 4. Version Immutability Protection Trigger
CREATE OR REPLACE FUNCTION enforce_workflow_version_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Workflow versions are immutable. UPDATE operations are forbidden on workflow_versions.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workflow_version_immutable
BEFORE UPDATE ON workflow_versions
FOR EACH ROW
EXECUTE FUNCTION enforce_workflow_version_immutability();

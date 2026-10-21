-- FlowForge Phase 1.5.1: Authentication & RBAC Foundation Schema
-- Tables: users, project_members

-- 1. Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT chk_users_email_non_empty CHECK (LENGTH(TRIM(email)) > 0),
    CONSTRAINT chk_users_password_hash_non_empty CHECK (LENGTH(TRIM(password_hash)) > 0),
    CONSTRAINT chk_users_full_name_non_empty CHECK (LENGTH(TRIM(full_name)) > 0)
);

-- 2. Project Members Table (RBAC Mapping)
CREATE TABLE project_members (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_project_members_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_project_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_project_members_user UNIQUE (project_id, user_id),
    CONSTRAINT chk_project_members_role CHECK (role IN ('ADMIN', 'DEVELOPER', 'VIEWER'))
);

CREATE INDEX idx_project_members_user ON project_members (user_id);


package com.flowforge.domain;

/**
 * Project-level Role-Based Access Control (RBAC) roles within FlowForge.
 */
public enum ProjectRole {
    ADMIN,
    DEVELOPER,
    VIEWER;

    public boolean canExecute() {
        return this == ADMIN || this == DEVELOPER;
    }

    public boolean canEdit() {
        return this == ADMIN || this == DEVELOPER;
    }

    public boolean canManageMembers() {
        return this == ADMIN;
    }

    public boolean canDeleteProject() {
        return this == ADMIN;
    }

    public boolean canRead() {
        return true;
    }
}

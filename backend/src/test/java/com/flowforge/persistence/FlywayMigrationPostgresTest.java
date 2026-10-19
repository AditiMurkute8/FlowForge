package com.flowforge.persistence;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.*;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Authoritative PostgreSQL migration and constraint acceptance test using Testcontainers.
 * Verifies that Flyway V1 applies cleanly to a clean database, creates required tables,
 * enforces ON DELETE RESTRICT on foreign keys, and prevents UPDATEs on workflow_versions via trigger.
 */
@Testcontainers(disabledWithoutDocker = true)
class FlywayMigrationPostgresTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("flowforge_acceptance_test")
            .withUsername("flowforge_user")
            .withPassword("flowforge_pass");

    @BeforeAll
    static void applyMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load();

        int applied = flyway.migrate().migrationsExecuted;
        assertThat(applied).isGreaterThanOrEqualTo(2);

        MigrationInfo current = flyway.info().current();
        assertThat(current).isNotNull();
        assertThat(current.getVersion().getVersion()).isEqualTo("2");
        assertThat(current.getDescription()).isEqualTo("prevent workflow version deletion");

        assertThat(flyway.info().applied()).hasSize(2);
        assertThat(flyway.info().applied()[0].getVersion().getVersion()).isEqualTo("1");
        assertThat(flyway.info().applied()[0].getDescription()).isEqualTo("create initial schema");
        assertThat(flyway.info().applied()[1].getVersion().getVersion()).isEqualTo("2");
        assertThat(flyway.info().applied()[1].getDescription()).isEqualTo("prevent workflow version deletion");
    }


    private Connection getConnection() throws SQLException {
        return DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    @Test
    @DisplayName("1. Flyway successfully creates projects, workflows, and workflow_versions tables")
    void tablesCreatedSuccessfully() throws Exception {
        try (Connection conn = getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();

            try (ResultSet rs = metaData.getTables(null, "public", "projects", null)) {
                assertThat(rs.next()).as("projects table must exist").isTrue();
            }

            try (ResultSet rs = metaData.getTables(null, "public", "workflows", null)) {
                assertThat(rs.next()).as("workflows table must exist").isTrue();
            }

            try (ResultSet rs = metaData.getTables(null, "public", "workflow_versions", null)) {
                assertThat(rs.next()).as("workflow_versions table must exist").isTrue();
            }
        }
    }

    @Test
    @DisplayName("2. Foreign-key RESTRICT prevents deleting a project when workflows exist")
    void foreignKeyRestrictsProjectDeletion() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();

        try (Connection conn = getConnection()) {
            // Insert project
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug, description) VALUES (?, ?, ?, ?)")) {
                stmt.setObject(1, projectId);
                stmt.setString(2, "Test Project Restrict");
                stmt.setString(3, "test-project-restrict-" + UUID.randomUUID());
                stmt.setString(4, "Testing FK restriction");
                stmt.executeUpdate();
            }

            // Insert workflow referencing project
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflows (id, project_id, name, slug, description) VALUES (?, ?, ?, ?, ?)")) {
                stmt.setObject(1, workflowId);
                stmt.setObject(2, projectId);
                stmt.setString(3, "Test Workflow");
                stmt.setString(4, "test-workflow");
                stmt.setString(5, "Testing workflow");
                stmt.executeUpdate();
            }

            // Attempt to delete project -> MUST FAIL with foreign key violation (ON DELETE RESTRICT)
            try (PreparedStatement stmt = conn.prepareStatement("DELETE FROM projects WHERE id = ?")) {
                stmt.setObject(1, projectId);
                assertThatThrownBy(stmt::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("fk_workflows_project");
            }
        }
    }

    @Test
    @DisplayName("3. Foreign-key RESTRICT prevents deleting a workflow when versions exist")
    void foreignKeyRestrictsWorkflowDeletion() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();

        try (Connection conn = getConnection()) {
            // Insert project
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, projectId);
                stmt.setString(2, "Test Project For Workflow Restrict");
                stmt.setString(3, "test-proj-wf-restrict-" + UUID.randomUUID());
                stmt.executeUpdate();
            }

            // Insert workflow
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflows (id, project_id, name, slug) VALUES (?, ?, ?, ?)")) {
                stmt.setObject(1, workflowId);
                stmt.setObject(2, projectId);
                stmt.setString(3, "Workflow with versions");
                stmt.setString(4, "wf-with-versions");
                stmt.executeUpdate();
            }

            // Insert version referencing workflow
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version_number, version_tag, graph_payload, task_count, edge_count) " +
                            "VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)")) {
                stmt.setObject(1, versionId);
                stmt.setObject(2, workflowId);
                stmt.setInt(3, 1);
                stmt.setString(4, "v1.0.0");
                stmt.setString(5, "{\"nodes\": [], \"edges\": []}");
                stmt.setInt(6, 0);
                stmt.setInt(7, 0);
                stmt.executeUpdate();
            }

            // Attempt to delete workflow -> MUST FAIL with foreign key violation (ON DELETE RESTRICT)
            try (PreparedStatement stmt = conn.prepareStatement("DELETE FROM workflows WHERE id = ?")) {
                stmt.setObject(1, workflowId);
                assertThatThrownBy(stmt::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("fk_workflow_versions_workflow");
            }
        }
    }

    @Test
    @DisplayName("4. Database trigger enforces immutability and forbids UPDATE on workflow_versions")
    void triggerForbidsWorkflowVersionUpdate() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();

        try (Connection conn = getConnection()) {
            // Setup project and workflow
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, projectId);
                stmt.setString(2, "Immutability Project");
                stmt.setString(3, "immutability-proj-" + UUID.randomUUID());
                stmt.executeUpdate();
            }

            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflows (id, project_id, name, slug) VALUES (?, ?, ?, ?)")) {
                stmt.setObject(1, workflowId);
                stmt.setObject(2, projectId);
                stmt.setString(3, "Immutable Workflow");
                stmt.setString(4, "immutable-wf");
                stmt.executeUpdate();
            }

            // Insert version 1
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version_number, version_tag, graph_payload, task_count, edge_count) " +
                            "VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)")) {
                stmt.setObject(1, versionId);
                stmt.setObject(2, workflowId);
                stmt.setInt(3, 1);
                stmt.setString(4, "v1.0.0");
                stmt.setString(5, "{\"nodes\": [{\"id\": \"t1\"}], \"edges\": []}");
                stmt.setInt(6, 1);
                stmt.setInt(7, 0);
                stmt.executeUpdate();
            }

            // Attempt to UPDATE workflow version -> MUST FAIL with trigger exception
            try (PreparedStatement stmt = conn.prepareStatement(
                    "UPDATE workflow_versions SET version_tag = 'modified-tag' WHERE id = ?")) {
                stmt.setObject(1, versionId);
                assertThatThrownBy(stmt::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("Workflow versions are immutable. UPDATE operations are forbidden on workflow_versions.");
            }
        }
    }

    @Test
    @DisplayName("5. Database trigger enforces immutability and forbids direct DELETE on workflow_versions")
    void triggerForbidsWorkflowVersionDelete() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();

        try (Connection conn = getConnection()) {
            // Setup project and workflow
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, projectId);
                stmt.setString(2, "Delete Immutability Project");
                stmt.setString(3, "del-immutability-proj-" + UUID.randomUUID());
                stmt.executeUpdate();
            }

            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflows (id, project_id, name, slug) VALUES (?, ?, ?, ?)")) {
                stmt.setObject(1, workflowId);
                stmt.setObject(2, projectId);
                stmt.setString(3, "Delete Immutable Workflow");
                stmt.setString(4, "del-immutable-wf");
                stmt.executeUpdate();
            }

            // Insert version 1
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version_number, version_tag, graph_payload, task_count, edge_count) " +
                            "VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)")) {
                stmt.setObject(1, versionId);
                stmt.setObject(2, workflowId);
                stmt.setInt(3, 1);
                stmt.setString(4, "v1.0.0");
                stmt.setString(5, "{\"nodes\": [{\"id\": \"t1\"}], \"edges\": []}");
                stmt.setInt(6, 1);
                stmt.setInt(7, 0);
                stmt.executeUpdate();
            }

            // Attempt to directly DELETE workflow version -> MUST FAIL with trigger exception
            try (PreparedStatement stmt = conn.prepareStatement(
                    "DELETE FROM workflow_versions WHERE id = ?")) {
                stmt.setObject(1, versionId);
                assertThatThrownBy(stmt::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("Workflow versions are immutable and permanent. DELETE operations are forbidden on workflow_versions.");
            }

            // Verify row still exists after failed deletion attempt
            try (PreparedStatement stmt = conn.prepareStatement(
                    "SELECT count(*) FROM workflow_versions WHERE id = ?")) {
                stmt.setObject(1, versionId);
                try (ResultSet rs = stmt.executeQuery()) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getInt(1)).isEqualTo(1);
                }
            }
        }
    }

    @Test
    @DisplayName("6. Uniqueness constraint rejects duplicate project slugs")
    void uniqueConstraintRejectsDuplicateProjectSlugs() throws Exception {
        UUID id1 = UUID.randomUUID();
        UUID id2 = UUID.randomUUID();
        String duplicateSlug = "unique-slug-" + UUID.randomUUID();

        try (Connection conn = getConnection()) {
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, id1);
                stmt.setString(2, "Project Alpha");
                stmt.setString(3, duplicateSlug);
                stmt.executeUpdate();
            }

            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, id2);
                stmt.setString(2, "Project Beta");
                stmt.setString(3, duplicateSlug);
                assertThatThrownBy(stmt::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("uq_projects_slug");
            }
        }
    }

    @Test
    @DisplayName("7. Uniqueness constraint rejects duplicate version numbers for the same workflow")
    void uniqueConstraintRejectsDuplicateVersionNumbers() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID v1 = UUID.randomUUID();
        UUID v2 = UUID.randomUUID();

        try (Connection conn = getConnection()) {
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, projectId);
                stmt.setString(2, "Duplicate Version Project");
                stmt.setString(3, "dup-version-proj-" + UUID.randomUUID());
                stmt.executeUpdate();
            }

            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflows (id, project_id, name, slug) VALUES (?, ?, ?, ?)")) {
                stmt.setObject(1, workflowId);
                stmt.setObject(2, projectId);
                stmt.setString(3, "Duplicate Version Workflow");
                stmt.setString(4, "dup-ver-wf");
                stmt.executeUpdate();
            }

            // Insert version 1
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version_number, graph_payload, task_count, edge_count) " +
                            "VALUES (?, ?, ?, ?::jsonb, ?, ?)")) {
                stmt.setObject(1, v1);
                stmt.setObject(2, workflowId);
                stmt.setInt(3, 1);
                stmt.setString(4, "{}");
                stmt.setInt(5, 0);
                stmt.setInt(6, 0);
                stmt.executeUpdate();
            }

            // Insert another record with version_number = 1 for the SAME workflow -> MUST FAIL
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version_number, graph_payload, task_count, edge_count) " +
                            "VALUES (?, ?, ?, ?::jsonb, ?, ?)")) {
                stmt.setObject(1, v2);
                stmt.setObject(2, workflowId);
                stmt.setInt(3, 1);
                stmt.setString(4, "{}");
                stmt.setInt(5, 0);
                stmt.setInt(6, 0);
                assertThatThrownBy(stmt::executeUpdate)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("uq_workflow_versions_number");
            }
        }
    }

    @Test
    @DisplayName("8. JSONB graph_payload stores and queries structured canvas data accurately")
    void jsonbGraphPayloadRoundTrip() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();

        String sampleGraphJson = """
                {
                  "nodes": [
                    {
                      "id": "node-1",
                      "type": "customTask",
                      "position": { "x": 100, "y": 200 },
                      "data": {
                        "label": "Ingest Stream",
                        "taskType": "HTTP_REQUEST",
                        "timeoutMs": 15000,
                        "maxRetries": 3,
                        "parameters": { "endpoint": "https://api.example.com/events" }
                      }
                    }
                  ],
                  "edges": [],
                  "concurrency": 2
                }
                """;

        try (Connection conn = getConnection()) {
            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)")) {
                stmt.setObject(1, projectId);
                stmt.setString(2, "JSONB Test Project");
                stmt.setString(3, "jsonb-proj-" + UUID.randomUUID());
                stmt.executeUpdate();
            }

            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflows (id, project_id, name, slug) VALUES (?, ?, ?, ?)")) {
                stmt.setObject(1, workflowId);
                stmt.setObject(2, projectId);
                stmt.setString(3, "JSONB Workflow");
                stmt.setString(4, "jsonb-wf");
                stmt.executeUpdate();
            }

            try (PreparedStatement stmt = conn.prepareStatement(
                    "INSERT INTO workflow_versions (id, workflow_id, version_number, version_tag, graph_payload, task_count, edge_count, is_valid_dag) " +
                            "VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?)")) {
                stmt.setObject(1, versionId);
                stmt.setObject(2, workflowId);
                stmt.setInt(3, 1);
                stmt.setString(4, "v1.0.0");
                stmt.setString(5, sampleGraphJson);
                stmt.setInt(6, 1);
                stmt.setInt(7, 0);
                stmt.setBoolean(8, true);
                stmt.executeUpdate();
            }

            // Query JSONB field and query JSONB operator (->>)
            try (PreparedStatement stmt = conn.prepareStatement(
                    "SELECT version_number, version_tag, is_valid_dag, graph_payload->'nodes'->0->'data'->>'label' AS first_label, " +
                            "graph_payload->>'concurrency' AS concurrency " +
                            "FROM workflow_versions WHERE id = ?")) {
                stmt.setObject(1, versionId);
                try (ResultSet rs = stmt.executeQuery()) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getInt("version_number")).isEqualTo(1);
                    assertThat(rs.getString("version_tag")).isEqualTo("v1.0.0");
                    assertThat(rs.getBoolean("is_valid_dag")).isTrue();
                    assertThat(rs.getString("first_label")).isEqualTo("Ingest Stream");
                    assertThat(rs.getString("concurrency")).isEqualTo("2");
                }
            }
        }
    }
}

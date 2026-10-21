package com.flowforge.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.flowforge.domain.Project;
import com.flowforge.domain.Workflow;
import com.flowforge.domain.WorkflowVersion;
import com.flowforge.domain.User;
import com.flowforge.persistence.repository.ProjectMemberRepository;
import com.flowforge.persistence.repository.ProjectRepository;
import com.flowforge.persistence.repository.UserRepository;
import com.flowforge.persistence.repository.WorkflowRepository;
import com.flowforge.persistence.repository.WorkflowVersionRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import com.flowforge.api.RestExceptionHandler;
import com.flowforge.service.ProjectAuthorizationService;
import com.flowforge.service.ProjectService;
import com.flowforge.service.WorkflowService;
import com.flowforge.service.WorkflowVersionService;
import com.flowforge.service.WorkflowSnapshotConverter;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.SQLException;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import com.flowforge.service.exception.ResourceConflictException;
import org.springframework.data.domain.PageRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authoritative PostgreSQL integration test verifying Substep 2.1 entities, repositories,
 * JSONB graph_payload mapping, foreign key RESTRICT rules, immutability triggers,
 * service concurrency, and persistence hardening.
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({ProjectService.class, WorkflowService.class, WorkflowVersionService.class, WorkflowSnapshotConverter.class, ProjectAuthorizationService.class})
class ProjectWorkflowPersistencePostgresTest {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("flowforge_entities_test")
            .withUsername("flowforge_user")
            .withPassword("flowforge_pass");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 20);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.jpa.properties.hibernate.dialect", () -> "org.hibernate.dialect.PostgreSQLDialect");
    }

    @BeforeAll
    static void applyMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load();
        flyway.migrate();
    }

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private WorkflowRepository workflowRepository;

    @Autowired
    private WorkflowVersionRepository workflowVersionRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private WorkflowService workflowService;

    @Autowired
    private WorkflowVersionService workflowVersionService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ProjectMemberRepository projectMemberRepository;

    private User testUser;

    @BeforeEach
    void setUpSecurity() {
        testUser = userRepository.save(new User(
                "persistence_tester_" + UUID.randomUUID() + "@flowforge.internal",
                "pw_hash",
                "Persistence Tester"
        ));
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(testUser, null, Collections.emptyList())
        );
    }

    @AfterEach
    void tearDownSecurity() {
        SecurityContextHolder.clearContext();
    }

    private JsonNode createSampleGraphPayload() {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("schemaVersion", 1);
        root.put("concurrency", 4);

        ArrayNode nodes = root.putArray("nodes");
        ObjectNode node1 = nodes.addObject();
        node1.put("id", "node-1");
        node1.put("type", "customTask");

        ObjectNode pos = node1.putObject("position");
        pos.put("x", 100.0);
        pos.put("y", 200.0);

        ObjectNode data = node1.putObject("data");
        data.put("label", "Ingest Stream");
        data.put("taskType", "HTTP_REQUEST");
        data.put("timeoutMs", 15000);
        data.put("maxRetries", 3);

        ObjectNode params = data.putObject("parameters");
        params.put("endpoint", "https://api.example.com/events");
        params.put("method", "GET");

        ObjectNode sim = params.putObject("simulation");
        sim.put("action", "DELAY");
        sim.put("delayMs", 500);

        root.putArray("edges");
        return root;
    }

    @Test
    @DisplayName("1. Persist Project, Workflow, and WorkflowVersion with auto-generated UUIDs and timestamps")
    void testEntityPersistenceAndRelationships() {
        Project project = new Project("Analytics Project", "analytics-proj-" + UUID.randomUUID(), "Real-time analytics");
        Project savedProject = projectRepository.saveAndFlush(project);

        assertThat(savedProject.getId()).isNotNull();
        assertThat(savedProject.getCreatedAt()).isNotNull();
        assertThat(savedProject.getUpdatedAt()).isNotNull();

        Workflow workflow = new Workflow(savedProject, "Ingestion Pipeline", "ingest-pipe", "Pipeline description");
        Workflow savedWorkflow = workflowRepository.saveAndFlush(workflow);

        assertThat(savedWorkflow.getId()).isNotNull();
        assertThat(savedWorkflow.getProject().getId()).isEqualTo(savedProject.getId());
        assertThat(savedWorkflow.getCreatedAt()).isNotNull();
        assertThat(savedWorkflow.getUpdatedAt()).isNotNull();

        JsonNode payload = createSampleGraphPayload();
        WorkflowVersion version = new WorkflowVersion(
                savedWorkflow,
                1,
                "v1.0.0",
                "Initial snapshot",
                payload,
                1,
                0,
                true
        );
        WorkflowVersion savedVersion = workflowVersionRepository.saveAndFlush(version);

        assertThat(savedVersion.getId()).isNotNull();
        assertThat(savedVersion.getVersionNumber()).isEqualTo(1);
        assertThat(savedVersion.getWorkflow().getId()).isEqualTo(savedWorkflow.getId());
        assertThat(savedVersion.getCreatedAt()).isNotNull();
        assertThat(savedVersion.getIsValidDag()).isTrue();
    }

    @Test
    @DisplayName("2. JSONB graph_payload is persisted natively as a JSON object, not a quoted string")
    void testJsonbPayloadNativeObjectVerification() {
        Project project = projectRepository.saveAndFlush(new Project("JSONB Project", "jsonb-proj-" + UUID.randomUUID(), "Testing JSONB"));
        Workflow workflow = workflowRepository.saveAndFlush(new Workflow(project, "JSONB Workflow", "jsonb-wf", "Testing JSONB"));

        JsonNode payload = createSampleGraphPayload();
        WorkflowVersion version = workflowVersionRepository.saveAndFlush(new WorkflowVersion(
                workflow,
                1,
                "v1.0.0",
                "JSONB Verification",
                payload,
                1,
                0,
                true
        ));

        // Native PostgreSQL query checking jsonb_typeof and property extraction
        jdbcTemplate.query(
                "SELECT jsonb_typeof(graph_payload) AS payload_type, " +
                        "jsonb_typeof(graph_payload->'nodes') AS nodes_type, " +
                        "graph_payload->'nodes'->0->'data'->>'label' AS first_label " +
                        "FROM workflow_versions WHERE id = ?",
                rs -> {
                    assertThat(rs.getString("payload_type"))
                            .as("graph_payload must be stored natively as a JSON object")
                            .isEqualTo("object");
                    assertThat(rs.getString("nodes_type"))
                            .as("nodes array inside graph_payload must be recognized as an array")
                            .isEqualTo("array");
                    assertThat(rs.getString("first_label"))
                            .as("Nested label property must be retrievable via JSON operators")
                            .isEqualTo("Ingest Stream");
                },
                version.getId()
        );

        // JPA entity retrieval
        WorkflowVersion reloaded = workflowVersionRepository.findById(version.getId()).orElseThrow();
        assertThat(reloaded.getGraphPayload().isObject()).isTrue();
        assertThat(reloaded.getGraphPayload().isTextual()).isFalse();
        assertThat(reloaded.getGraphPayload().path("nodes").isArray()).isTrue();
        assertThat(reloaded.getGraphPayload().path("nodes").get(0).path("data").path("label").asText())
                .isEqualTo("Ingest Stream");
    }

    @Test
    @DisplayName("3. Foreign key ON DELETE RESTRICT prevents deleting Project with Workflows, or Workflow with Versions")
    void testForeignKeyRestrictPolicy() {
        Project project = projectRepository.saveAndFlush(new Project("Restrict Project", "restrict-proj-" + UUID.randomUUID(), "FK Restrict test"));
        Workflow workflow = workflowRepository.saveAndFlush(new Workflow(project, "Restrict Workflow", "restrict-wf", "Testing FK"));

        WorkflowVersion version = workflowVersionRepository.saveAndFlush(new WorkflowVersion(
                workflow,
                1,
                "v1.0.0",
                "Snapshot",
                createSampleGraphPayload(),
                1,
                0,
                true
        ));

        // 1. Attempting to delete workflow that has a version via SQL must be blocked by fk_workflow_versions_workflow
        assertThatThrownBy(() -> jdbcTemplate.update("DELETE FROM workflows WHERE id = ?", workflow.getId()))
                .hasCauseInstanceOf(SQLException.class)
                .hasMessageContaining("fk_workflow_versions_workflow");

        // 2. Attempting to delete project that has a workflow via SQL must be blocked by fk_workflows_project
        assertThatThrownBy(() -> jdbcTemplate.update("DELETE FROM projects WHERE id = ?", project.getId()))
                .hasCauseInstanceOf(SQLException.class)
                .hasMessageContaining("fk_workflows_project");
    }

    @Test
    @DisplayName("4. Database triggers and repository guards strictly prevent UPDATE and DELETE on workflow_versions")
    void testWorkflowVersionImmutability() {
        Project project = projectRepository.saveAndFlush(new Project("Immutable Project", "immutable-proj-" + UUID.randomUUID(), "Trigger test"));
        Workflow workflow = workflowRepository.saveAndFlush(new Workflow(project, "Immutable Workflow", "immutable-wf", "Trigger test"));

        WorkflowVersion version = workflowVersionRepository.saveAndFlush(new WorkflowVersion(
                workflow,
                1,
                "v1.0.0",
                "Immutable Snapshot",
                createSampleGraphPayload(),
                1,
                0,
                true
        ));

        // 1. Direct SQL UPDATE rejected by trigger trg_workflow_version_immutable
        assertThatThrownBy(() -> jdbcTemplate.update("UPDATE workflow_versions SET description = 'modified' WHERE id = ?", version.getId()))
                .hasCauseInstanceOf(SQLException.class)
                .hasMessageContaining("Workflow versions are immutable");

        // 2. Direct SQL DELETE rejected by trigger trg_workflow_version_no_delete
        assertThatThrownBy(() -> jdbcTemplate.update("DELETE FROM workflow_versions WHERE id = ?", version.getId()))
                .hasCauseInstanceOf(SQLException.class)
                .hasMessageContaining("Workflow versions are immutable and permanent");

        // 3. All 8 Repository delete methods throw UnsupportedOperationException
        assertThatThrownBy(() -> workflowVersionRepository.delete(version))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteById(version.getId()))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteAll())
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteAll(java.util.List.of(version)))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteAllById(java.util.List.of(version.getId())))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteAllInBatch())
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteAllByIdInBatch(java.util.List.of(version.getId())))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");

        assertThatThrownBy(() -> workflowVersionRepository.deleteInBatch(java.util.List.of(version)))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("Workflow versions are immutable");
    }

    @Test
    @DisplayName("5. Unique constraints reject duplicate project slug, workflow scoped slug, and duplicate version numbers")
    void testUniqueConstraints() {
        String sharedSlug = "unique-slug-" + UUID.randomUUID();
        projectRepository.saveAndFlush(new Project("Proj 1", sharedSlug, "First project"));

        // Duplicate project slug
        assertThatThrownBy(() -> projectRepository.saveAndFlush(new Project("Proj 2", sharedSlug, "Second project")))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_projects_slug");

        Project project = projectRepository.saveAndFlush(new Project("Project for WFs", "wf-proj-" + UUID.randomUUID(), "Test"));
        workflowRepository.saveAndFlush(new Workflow(project, "WF 1", "same-slug", "First WF"));

        // Duplicate workflow slug within same project
        assertThatThrownBy(() -> workflowRepository.saveAndFlush(new Workflow(project, "WF 2", "same-slug", "Second WF")))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_workflows_project_slug");

        Workflow workflow = workflowRepository.saveAndFlush(new Workflow(project, "WF for Versions", "version-wf", "Test"));
        workflowVersionRepository.saveAndFlush(new WorkflowVersion(workflow, 1, "v1", "First", createSampleGraphPayload(), 1, 0, true));

        // Duplicate version number for same workflow
        assertThatThrownBy(() -> workflowVersionRepository.saveAndFlush(
                new WorkflowVersion(workflow, 1, "v1-dup", "Duplicate", createSampleGraphPayload(), 1, 0, true)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_workflow_versions_number");
    }

    @Test
    @DisplayName("6. RestExceptionHandler correctly classifies PostgreSQL triggers, FK missing parents, FK restrictions, and unique constraints")
    void testRestExceptionHandlerConstraintClassification() {
        RestExceptionHandler handler = new RestExceptionHandler();
        Project project = projectRepository.saveAndFlush(new Project("Handler Test Proj", "handler-proj-" + UUID.randomUUID(), "Desc"));
        Workflow workflow = workflowRepository.saveAndFlush(new Workflow(project, "Handler WF", "handler-wf", "Desc"));
        WorkflowVersion version = workflowVersionRepository.saveAndFlush(new WorkflowVersion(workflow, 1, "v1", "Desc", createSampleGraphPayload(), 1, 0, true));

        // A. Trigger UPDATE violation -> 409 Conflict with immutable message
        Exception exA = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class,
                () -> jdbcTemplate.update("UPDATE workflow_versions SET description = 'mod' WHERE id = ?", version.getId())
        );
        DataIntegrityViolationException diveA = new DataIntegrityViolationException("Trigger failure", exA);
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> responseA = handler.handleDataIntegrity(diveA);
        assertThat(responseA.getStatusCode().value()).isEqualTo(409);
        assertThat(responseA.getBody().message()).isEqualTo("Workflow versions are permanent and immutable");

        // B. Trigger DELETE violation -> 409 Conflict with immutable message
        Exception exB = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class,
                () -> jdbcTemplate.update("DELETE FROM workflow_versions WHERE id = ?", version.getId())
        );
        DataIntegrityViolationException diveB = new DataIntegrityViolationException("Trigger failure", exB);
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> responseB = handler.handleDataIntegrity(diveB);
        assertThat(responseB.getStatusCode().value()).isEqualTo(409);
        assertThat(responseB.getBody().message()).isEqualTo("Workflow versions are permanent and immutable");

        // C. Missing parent on INSERT (FK violation) -> 404 Not Found
        UUID nonExistentProjectId = UUID.randomUUID();
        Exception exC = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class,
                () -> jdbcTemplate.update("INSERT INTO workflows (id, project_id, name, slug) VALUES (?, ?, ?, ?)",
                        UUID.randomUUID(), nonExistentProjectId, "Orphan WF", "orphan-wf-" + UUID.randomUUID())
        );
        DataIntegrityViolationException diveC = new DataIntegrityViolationException("FK missing parent", exC);
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> responseC = handler.handleDataIntegrity(diveC);
        assertThat(responseC.getStatusCode().value()).isEqualTo(404);
        assertThat(responseC.getBody().message()).isEqualTo("Referenced parent resource does not exist");

        // D. Restricted deletion of parent with active child (FK restriction) -> 409 Conflict
        Exception exD = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class,
                () -> jdbcTemplate.update("DELETE FROM projects WHERE id = ?", project.getId())
        );
        DataIntegrityViolationException diveD = new DataIntegrityViolationException("FK restrict", exD);
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> responseD = handler.handleDataIntegrity(diveD);
        assertThat(responseD.getStatusCode().value()).isEqualTo(409);
        assertThat(responseD.getBody().message()).isEqualTo("Cannot delete or modify resource because active dependent records exist");

        // E. Unique slug violation -> 409 Conflict
        Exception exE = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class,
                () -> jdbcTemplate.update("INSERT INTO projects (id, name, slug) VALUES (?, ?, ?)",
                        UUID.randomUUID(), "Duplicate", project.getSlug())
        );
        DataIntegrityViolationException diveE = new DataIntegrityViolationException("Unique collision", exE);
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> responseE = handler.handleDataIntegrity(diveE);
        assertThat(responseE.getStatusCode().value()).isEqualTo(409);
        assertThat(responseE.getBody().message()).isEqualTo("A project with this slug already exists");

        // F. Schema NOT NULL constraint violation -> 400 Bad Request
        Exception exF = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class,
                () -> jdbcTemplate.update("INSERT INTO projects (id, name, slug) VALUES (?, NULL, ?)",
                        UUID.randomUUID(), "null-name-slug-" + UUID.randomUUID())
        );
        DataIntegrityViolationException diveF = new DataIntegrityViolationException("Not null check", exF);
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> responseF = handler.handleDataIntegrity(diveF);
        assertThat(responseF.getStatusCode().value()).isEqualTo(400);
        assertThat(responseF.getBody().message()).isEqualTo("Database constraint validation failed");

        // G. Unrecognized persistence exception -> 500 Internal Server Error
        DataIntegrityViolationException unknownDive = new DataIntegrityViolationException("Unknown DB error", new SQLException("Some unmapped internal driver error", "99999"));
        ResponseEntity<com.flowforge.api.dto.ApiErrorResponse> unknownResponse = handler.handleDataIntegrity(unknownDive);
        assertThat(unknownResponse.getStatusCode().value()).isEqualTo(500);
        assertThat(unknownResponse.getBody().message()).isEqualTo("A persistence error occurred while processing the request");
    }

    @Test
    @DisplayName("7. Service layer executes transactional row-locked version creation, slug generation, and metrics against PostgreSQL")
    void testServiceLayerPersistenceAndVersionAllocation() {
        // 1. Create project with auto-generated slug
        Project project = projectService.createProject("E2E Test Project " + UUID.randomUUID(), null, "Testing service layer");
        assertThat(project.getId()).isNotNull();
        assertThat(project.getSlug()).startsWith("e2e-test-project-");

        // 2. Create workflow with auto-generated slug
        Workflow workflow = workflowService.createWorkflow(project.getId(), "Data Cleaning Pipeline", null, "ETL workflow");
        assertThat(workflow.getId()).isNotNull();
        assertThat(workflow.getSlug()).isEqualTo("data-cleaning-pipeline");

        // 3. Create version 1 with valid DAG payload
        JsonNode v1Payload = createSampleGraphPayload();
        WorkflowVersion v1 = workflowVersionService.createVersion(workflow.getId(), null, "First Version", v1Payload);
        assertThat(v1.getId()).isNotNull();
        assertThat(v1.getVersionNumber()).isEqualTo(1);
        assertThat(v1.getVersionTag()).isEqualTo("v1");
        assertThat(v1.getTaskCount()).isEqualTo(1);
        assertThat(v1.getEdgeCount()).isEqualTo(0);
        assertThat(v1.getIsValidDag()).isTrue();

        // 4. Create version 2 with cyclic draft
        ObjectNode cyclicPayload = objectMapper.createObjectNode();
        ArrayNode nodes = cyclicPayload.putArray("nodes");
        nodes.addObject().put("id", "step-1");
        nodes.addObject().put("id", "step-2");
        ArrayNode edges = cyclicPayload.putArray("edges");
        edges.addObject().put("source", "step-1").put("target", "step-2");
        edges.addObject().put("source", "step-2").put("target", "step-1");

        WorkflowVersion v2 = workflowVersionService.createVersion(workflow.getId(), "v2-draft", "Cyclic draft", cyclicPayload);
        assertThat(v2.getId()).isNotNull();
        assertThat(v2.getVersionNumber()).isEqualTo(2);
        assertThat(v2.getVersionTag()).isEqualTo("v2-draft");
        assertThat(v2.getTaskCount()).isEqualTo(2);
        assertThat(v2.getEdgeCount()).isEqualTo(2);
        assertThat(v2.getIsValidDag()).isFalse();

        // 5. Query latest and specific versions via service
        WorkflowVersion latest = workflowVersionService.getLatestVersion(workflow.getId());
        assertThat(latest.getId()).isEqualTo(v2.getId());
        assertThat(latest.getVersionNumber()).isEqualTo(2);

        WorkflowVersion fetchedV1 = workflowVersionService.getVersionByNumber(workflow.getId(), 1);
        assertThat(fetchedV1.getId()).isEqualTo(v1.getId());
        assertThat(fetchedV1.getVersionNumber()).isEqualTo(1);
    }

    @Test
    @DisplayName("8. Concurrency: 10 parallel threads allocating versions for the same workflow produce contiguous, unique 1..10 version numbers")
    void testConcurrentVersionNumberAllocationUnderPessimisticLock() throws Exception {
        Project project = projectService.createProject("Concurrent Test Proj " + UUID.randomUUID(), null, "Testing concurrency");
        Workflow workflow = workflowService.createWorkflow(project.getId(), "Concurrent WF", null, "Testing concurrency");

        int threadCount = 10;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch readyLatch = new CountDownLatch(threadCount);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(threadCount);

        List<WorkflowVersion> createdVersions = new CopyOnWriteArrayList<>();
        List<Throwable> errors = new CopyOnWriteArrayList<>();

        for (int i = 0; i < threadCount; i++) {
            final int index = i;
            executor.submit(() -> {
                SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(testUser, null, Collections.emptyList())
                );
                readyLatch.countDown();
                try {
                    startLatch.await();
                    WorkflowVersion version = workflowVersionService.createVersion(
                            workflow.getId(),
                            "concurrent-tag-" + index,
                            "Concurrent version description " + index,
                            createSampleGraphPayload()
                    );
                    createdVersions.add(version);
                } catch (Throwable t) {
                    errors.add(t);
                } finally {
                    SecurityContextHolder.clearContext();
                    doneLatch.countDown();
                }
            });
        }

        // Wait for all threads to reach the gate
        assertThat(readyLatch.await(10, TimeUnit.SECONDS)).as("All threads must reach ready state").isTrue();

        // Release all threads simultaneously
        startLatch.countDown();

        // Wait for all threads to complete
        boolean finished = doneLatch.await(30, TimeUnit.SECONDS);
        executor.shutdown();
        assertThat(finished).as("All concurrent tasks must complete within timeout").isTrue();

        // Verify zero errors occurred (no deadlocks, no duplicate key conflicts)
        assertThat(errors).as("Concurrent version allocations should succeed without errors").isEmpty();
        assertThat(createdVersions).hasSize(threadCount);

        // Fetch all versions from database ordered by version_number ASC
        List<WorkflowVersion> persistedVersions = workflowVersionRepository
                .findByWorkflowIdOrderByVersionNumberDesc(workflow.getId(), PageRequest.of(0, 50))
                .getContent()
                .stream()
                .sorted(Comparator.comparingInt(WorkflowVersion::getVersionNumber))
                .toList();

        assertThat(persistedVersions).hasSize(threadCount);

        // Verify version numbers are contiguous 1..10 with NO duplicates and NO gaps
        List<Integer> versionNumbers = persistedVersions.stream()
                .map(WorkflowVersion::getVersionNumber)
                .toList();
        assertThat(versionNumbers)
                .as("Version numbers must be strictly sequential 1..10 without gaps or duplicates")
                .containsExactly(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

        // Verify that every persisted version has valid server-derived metrics and stored snapshot
        for (WorkflowVersion v : persistedVersions) {
            assertThat(v.getId()).isNotNull();
            assertThat(v.getCreatedAt()).isNotNull();
            assertThat(v.getTaskCount()).isEqualTo(1);
            assertThat(v.getEdgeCount()).isEqualTo(0);
            assertThat(v.getIsValidDag()).isTrue();
            assertThat(v.getGraphPayload()).isNotNull();
            assertThat(v.getGraphPayload().isObject()).isTrue();
            assertThat(v.getGraphPayload().path("nodes").size()).isEqualTo(1);
        }

        // Verify latest version is version 10
        WorkflowVersion latest = workflowVersionService.getLatestVersion(workflow.getId());
        assertThat(latest.getVersionNumber()).isEqualTo(10);
    }

    @Test
    @DisplayName("9. Transaction rollback: A failed version creation does not leave a partial record or advance the version sequence")
    void testFailedVersionCreationRollsBackCleanly() {
        Project project = projectService.createProject("Rollback Test Proj " + UUID.randomUUID(), null, "Desc");
        Workflow workflow = workflowService.createWorkflow(project.getId(), "Rollback WF", null, "Desc");

        // Create version 1 successfully
        WorkflowVersion v1 = workflowVersionService.createVersion(workflow.getId(), "v1", "Initial", createSampleGraphPayload());
        assertThat(v1.getVersionNumber()).isEqualTo(1);

        // Attempt to create version 2 with structurally malformed snapshot
        ObjectNode malformedPayload = objectMapper.createObjectNode();
        malformedPayload.put("nodes", "not-an-array");

        assertThatThrownBy(() -> workflowVersionService.createVersion(workflow.getId(), "v2-bad", "Bad", malformedPayload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'nodes' field must be a JSON array");

        // Verify database state: max version is still 1, total count is still 1
        assertThat(workflowVersionRepository.findMaxVersionNumber(workflow.getId())).contains(1);
        assertThat(workflowVersionRepository.countByWorkflowId(workflow.getId())).isEqualTo(1);

        // Subsequent valid creation receives version number 2 (counter was not prematurely incremented)
        WorkflowVersion v2 = workflowVersionService.createVersion(workflow.getId(), "v2", "Recovered", createSampleGraphPayload());
        assertThat(v2.getVersionNumber()).isEqualTo(2);
        assertThat(workflowVersionRepository.countByWorkflowId(workflow.getId())).isEqualTo(2);
    }

    @Test
    @DisplayName("10. Deletion restrictions: Service layer blocks deleting Project with Workflows or Workflow with Versions")
    void testServiceDeletionRestrictions() {
        Project project = projectService.createProject("Delete Restrict Proj " + UUID.randomUUID(), null, "Desc");
        Workflow workflow = workflowService.createWorkflow(project.getId(), "Delete Restrict WF", null, "Desc");
        WorkflowVersion version = workflowVersionService.createVersion(workflow.getId(), "v1", "Desc", createSampleGraphPayload());

        // 1. Deleting workflow with active versions throws ResourceConflictException
        assertThatThrownBy(() -> workflowService.deleteWorkflow(workflow.getId()))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("Cannot delete workflow because dependent versions exist");

        // Verify workflow still exists in PostgreSQL
        assertThat(workflowRepository.existsById(workflow.getId())).isTrue();

        // 2. Deleting project with active workflows throws ResourceConflictException
        assertThatThrownBy(() -> projectService.deleteProject(project.getId()))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("Cannot delete project because dependent workflows exist");

        // Verify project still exists in PostgreSQL
        assertThat(projectRepository.existsById(project.getId())).isTrue();

        // 3. For an empty project (no workflows), deletion succeeds
        Project emptyProject = projectService.createProject("Empty Proj " + UUID.randomUUID(), null, "Desc");
        projectService.deleteProject(emptyProject.getId());
        assertThat(projectRepository.existsById(emptyProject.getId())).isFalse();
    }

    @Test
    @DisplayName("11. Slug conflicts: Service layer classifies duplicate project/workflow slugs as ResourceConflictException without corrupting state")
    void testServiceSlugConflictClassificationAndStateIntegrity() {
        String sharedProjectSlug = "conflict-proj-" + UUID.randomUUID();
        Project p1 = projectService.createProject("First Project", sharedProjectSlug, "Desc");
        assertThat(p1.getSlug()).isEqualTo(sharedProjectSlug);

        // Duplicate project slug throws ResourceConflictException
        assertThatThrownBy(() -> projectService.createProject("Second Project", sharedProjectSlug, "Desc"))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("A project with slug '" + sharedProjectSlug + "' already exists");

        // Verify only 1 project exists with that slug
        assertThat(projectRepository.findBySlug(sharedProjectSlug)).isPresent();

        // Project-scoped workflow duplicate slug
        Workflow wf1 = workflowService.createWorkflow(p1.getId(), "WF One", "shared-wf-slug", "Desc");
        assertThat(wf1.getSlug()).isEqualTo("shared-wf-slug");

        assertThatThrownBy(() -> workflowService.createWorkflow(p1.getId(), "WF Two", "shared-wf-slug", "Desc"))
                .isInstanceOf(ResourceConflictException.class)
                .hasMessageContaining("A workflow with slug 'shared-wf-slug' already exists in this project");

        // Verify only 1 workflow exists with that slug in this project
        assertThat(workflowRepository.countByProjectId(p1.getId())).isEqualTo(1);
    }
}

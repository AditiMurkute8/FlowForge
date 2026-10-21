# ADR-001: Adoption of Directed Acyclic Graphs (DAGs) and PostgreSQL as the Core Orchestration and Persistence Model

* **Status:** Accepted
* **Date:** 2026-10-21
* **Scope:** Phase 1 Single-Node Engine Architecture Baseline

---

## 1. Context and Problem Statement

A distributed visual workflow orchestration platform must model, schedule, validate, and persist multi-step task execution pipelines. When architecting FlowForge, two fundamental design decisions were required:

1. **Workflow Pipeline Modeling and Execution Topology:** How should workflow pipelines and task dependencies be represented, validated, and ordered for safe concurrent execution?
2. **State Authority and Persistence Layer:** Where and how should project hierarchies, immutable workflow versions, and execution histories be stored with transactional consistency and concurrency controls?

Without explicit architectural constraints, workflow orchestration platforms encounter common structural failures:
* **Cyclic Dependencies:** Circular references between tasks cause infinite execution loops or resource exhaustion.
* **Non-Deterministic Execution:** Arbitrary execution ordering of independent task branches produces non-reproducible runs and hard-to-diagnose race conditions.
* **State Mutation of Historical Runs:** In-place mutation of workflow definitions corrupts the audit trail of past executions.
* **Concurrent Race Conditions:** Concurrent membership changes, workflow version creation, or task execution runs without transactional isolation can lead to orphaned records or permission inconsistencies.

---

## 2. Decision

We chose to build FlowForge around two foundational architectural components:

1. **Directed Acyclic Graphs (DAGs)** as the computational model for workflow pipelines and task dependency management.
2. **PostgreSQL** as the single transactional source of truth for relational resources, immutable workflow versions, and durable execution history, managed through Flyway migrations.

---

## 3. Detailed Architectural Design

### 3.1 Directed Acyclic Graph (DAG) Model

* **Explicit Dependency Semantics:** Task dependencies are modeled as directed edges in [`TaskGraph`](../../backend/src/main/java/com/flowforge/core/TaskGraph.java) via [`DependencyEdge`](../../backend/src/main/java/com/flowforge/core/DependencyEdge.java), where `source -> target` explicitly denotes that `source` is a mandatory prerequisite that must successfully complete before `target` can be scheduled.
* **Strict Pre-Execution Cycle Validation:** The [`DagEngine`](../../backend/src/main/java/com/flowforge/core/DagEngine.java) validates workflow graphs before version creation or execution using a 3-color Depth-First Search (DFS) algorithm (`WHITE` = unvisited, `GRAY` = visiting, `BLACK` = visited). The validator:
  * Rejects duplicate task IDs and duplicate dependency edges.
  * Rejects edges referencing unknown or missing task IDs.
  * Rejects self-loops (`source == target`).
  * Rejects multi-node cycles and returns the exact cycle paths.
  * Identifies isolated/disconnected task nodes.
* **Deterministic Topological Ordering:** When sequential ordering or ready-set evaluation is performed, `DagEngine.topologicalSort()` uses Kahn's algorithm with a lexicographical `PriorityQueue` for deterministic tie-breaking among independent tasks with equal in-degrees.
* **In-Process Concurrent Execution (`WorkflowScheduler`):** In the Phase 1 single-node engine, [`WorkflowScheduler`](../../backend/src/main/java/com/flowforge/scheduler/WorkflowScheduler.java) executes ready tasks in parallel using a bounded worker `ExecutorService`, manages retry delays via a `ScheduledExecutorService`, and unlocks dependent tasks dynamically as prerequisites complete.

### 3.2 PostgreSQL as the Transactional Source of Truth

* **Relational Integrity and Foreign Key Constraints:** The domain model ([`Project`](../../backend/src/main/java/com/flowforge/domain/Project.java), [`Workflow`](../../backend/src/main/java/com/flowforge/domain/Workflow.java), [`WorkflowVersion`](../../backend/src/main/java/com/flowforge/domain/WorkflowVersion.java), [`WorkflowRun`](../../backend/src/main/java/com/flowforge/domain/WorkflowRun.java), [`TaskRun`](../../backend/src/main/java/com/flowforge/domain/TaskRun.java), [`User`](../../backend/src/main/java/com/flowforge/domain/User.java), [`ProjectMember`](../../backend/src/main/java/com/flowforge/domain/ProjectMember.java)) enforces referential integrity through foreign keys with explicit delete rules (`ON DELETE RESTRICT` for workflows, versions, and runs; `ON DELETE CASCADE` for project memberships upon project deletion).
* **Flyway-Managed Migrations:** Database schema evolution is strictly versioned through Flyway migration scripts in [`backend/src/main/resources/db/migration/`](../../backend/src/main/resources/db/migration/):
  * `V1__create_initial_schema.sql`: Projects, workflows, and workflow versions with immutability trigger.
  * `V2__prevent_workflow_version_deletion.sql`: Triggers preventing deletion of workflow versions.
  * `V3__create_workflow_runs_schema.sql`: Workflow runs and task execution records with status check constraints.
  * `V4__create_auth_and_rbac_schema.sql`: Users and project membership RBAC tables.
* **Engine-Level Version Immutability:** Historical workflow definitions must remain permanent for auditing. PostgreSQL triggers (`enforce_workflow_version_immutability` and `enforce_workflow_version_no_delete`) reject all `UPDATE` and `DELETE` queries on `workflow_versions` at the database level.
* **Durable Run and Task Audit History:** Every execution creates a durable [`WorkflowRun`](../../backend/src/main/java/com/flowforge/domain/WorkflowRun.java) and individual [`TaskRun`](../../backend/src/main/java/com/flowforge/domain/TaskRun.java) rows tracking status (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`), attempt counts, timestamps, execution durations, and sanitized error messages.
* **Concurrency and Transaction Guarantees:**
  * **Pessimistic Locking on Membership:** [`ProjectMemberService`](../../backend/src/main/java/com/flowforge/service/ProjectMemberService.java) acquires pessimistic write locks (`@Lock(LockModeType.PESSIMISTIC_WRITE)`) on the parent `Project` entity to serialize concurrent membership modifications and prevent removing or demoting the last remaining project administrator.
  * **Unique Constraints:** PostgreSQL unique indexes prevent duplicate slugs (`slug`, `(project_id, slug)`), version collisions (`(workflow_id, version_number)`), duplicate memberships (`(project_id, user_id)`), and duplicate task runs per workflow run (`(workflow_run_id, task_id)`).
  * **Bounded Execution Capacity:** [`WorkflowExecutionService`](../../backend/src/main/java/com/flowforge/api/WorkflowExecutionService.java) limits in-flight execution runs via a bounded `Semaphore`, quarantining permits if scheduler termination cannot be positively verified.

---

## 4. Alternatives Considered

### Alternative 1: Imperative / Step-Function Script Chains
* *Description:* Defining workflows as sequential procedural scripts or nested conditional state machines.
* *Why Rejected:* Imperative script chains obscure structural dependencies between tasks, make automatic parallel branch identification difficult, prevent pre-execution cycle detection, and complicate visual representation in the user interface.

### Alternative 2: Document / NoSQL Datastore (e.g., MongoDB, DynamoDB)
* *Description:* Storing projects, workflows, versions, and execution runs as denormalized documents in a NoSQL store.
* *Why Rejected:* Document databases lack native multi-table foreign key constraints and transactional integrity guarantees across projects, memberships, and version trees. PostgreSQL offers relational integrity, ACID transactional guarantees, and native `JSONB` support for storing validated task graph payloads in [`workflow_versions.graph_payload`](../../backend/src/main/resources/db/migration/V1__create_initial_schema.sql).

### Alternative 3: In-Memory / Broker-Only State (e.g., Redis-Only Coordination)
* *Description:* Relying entirely on in-memory data structures or message brokers for workflow execution state without a relational persistence layer.
* *Why Rejected:* Memory-only state risks data loss on service restart, lacks comprehensive SQL query capabilities for historical run analytics, and fails auditability requirements for durable enterprise workflow execution.

---

## 5. Consequences and Trade-offs

### Positive Consequences
* **Cycle Prevention by Construction:** Workflows with circular dependencies are rejected prior to execution.
* **Guaranteed Auditability:** Versions and historical execution telemetry cannot be overwritten or silently deleted.
* **Deterministic Execution Ordering:** Kahn's algorithm with tie-breaking ensures identical topological ordering across repeated evaluations.
* **Operational Simplicity:** A single PostgreSQL database hosts relational data, authentication, RBAC, version snapshots, and durable run records during Phase 1.

### Trade-offs and Operational Considerations
* **Schema Rigidity:** Relational schema evolution requires strictly tested Flyway migrations validated against real PostgreSQL instances.
* **Storage Footprint:** Permanent version snapshots and per-task execution rows accumulate data over time, which will require future retention and archiving policies.
* **Single-Process Execution Scope:** In the Phase 1 implementation, task execution is bounded within the single JVM application process.

---

## 6. Implementation Status vs. Future Work

### Implemented and Substantiated in Phase 1
* [x] Framework-independent pure Java DAG validation and Kahn's topological sort ([`DagEngine`](../../backend/src/main/java/com/flowforge/core/DagEngine.java)).
* [x] PostgreSQL relational schema managed via Flyway migrations `V1`–`V4` ([`db/migration/`](../../backend/src/main/resources/db/migration/)).
* [x] Database triggers enforcing version snapshot immutability ([`V1`](../../backend/src/main/resources/db/migration/V1__create_initial_schema.sql), [`V2`](../../backend/src/main/resources/db/migration/V2__prevent_workflow_version_deletion.sql)).
* [x] In-process concurrent task execution and retry engine ([`WorkflowScheduler`](../../backend/src/main/java/com/flowforge/scheduler/WorkflowScheduler.java)).
* [x] Durable workflow and task execution logging ([`WorkflowRunService`](../../backend/src/main/java/com/flowforge/service/WorkflowRunService.java)).
* [x] Pessimistic write locking on project membership mutations ([`ProjectMemberService`](../../backend/src/main/java/com/flowforge/service/ProjectMemberService.java)).
* [x] Permit quarantine on unconfirmed scheduler termination ([`WorkflowExecutionService`](../../backend/src/main/java/com/flowforge/api/WorkflowExecutionService.java)).

### Explicitly Deferred to Future Phases (Not Claimed as Current)
* **Distributed Worker Processes (Phase 2):** Dispatching task execution across network boundaries (HTTP/gRPC) to independent worker nodes.
* **Lease-Based Worker Execution (Phase 2):** Worker heartbeats, task lease acquisition, lease renewal, and orphaned task reclamation upon worker failure.
* **Distributed Dead-Lettering and Worker Crash Recovery (Phase 2):** Automated task reassignment upon worker failure.
* **Durable Event Streaming (Phase 4):** Decoupling scheduler and workers via Apache Kafka topics.
* **Distributed Leader Election & Multi-Scheduler Coordination (Phase 7):** Active-passive or active-active multi-node schedulers using Redis or database locks.

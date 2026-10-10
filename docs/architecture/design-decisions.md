# FlowForge Architectural Design Decisions & Domain Mapping

This document captures key Architecture Decision Records (ADRs), maps proposed API contracts and persistence schemas to the existing Java domain model, documents schema/domain discrepancies, and outlines open decisions for upcoming milestones.

---

## 1. Architecture Decision Records (ADRs)

### ADR-001: Separation of Workflow Definition vs. Execution Runtime
- **Context**: Orchestration platforms must balance static workflow authoring against dynamic execution lifecycles across multiple concurrent executions.
- **Decision**: Strictly separate static DAG models (`Workflow`, `WorkflowVersion`, `Task`, `TaskDependency`) from dynamic execution models (`WorkflowRun`, `TaskRun`, `TaskAttempt`, `Scheduler`).
- **Rationale**: A static graph definition can be executed hundreds of times under varying runtime conditions. Coupling task execution states (such as `attemptCount`, `workerId`, `status`) into the task definition class would corrupt execution isolation and destroy reproducibility.
- **Consequences**: Runtime states are tracked in independent entities (`task_runs`, `task_attempts`, and `workflow_runs`), referencing the static definitions via foreign keys.

---

### ADR-002: Workflow Version Immutability and Atomic Sealing Strategy
- **Context**: Workflows evolve as business logic changes. Modifying a workflow in-place causes past runs to reflect definitions they were never executed against, making debugging and auditing impossible.
- **Decision**: 
  - Every workflow contains one or more `WorkflowVersion` snapshots.
  - While unexecuted, a version is a **Draft** (`is_immutable = FALSE`). Its tasks and dependency edges may be replaced via `PUT /api/versions/{versionId}` or deleted via `DELETE /api/versions/{versionId}`.
  - The moment its first `WorkflowRun` is created, the version is **Atomically Sealed** (`is_immutable = TRUE`) in the same database transaction.
  - Subsequent mutations to tasks, dependencies, or the version record are rejected with HTTP `409 Conflict` (`VERSION_IMMUTABLE`). Further topology adjustments require creating a new version (`version_number = N + 1`).
- **Enforcement Strategy**:
  1. *Application Transaction*: When triggering a run, execute `SELECT is_immutable FROM workflow_versions WHERE id = :versionId FOR UPDATE;`. If `FALSE`, execute `UPDATE workflow_versions SET is_immutable = TRUE WHERE id = :versionId;` before inserting `workflow_runs`.
  2. *Database Triggers*: Triggers `trg_tasks_immutability` and `trg_deps_immutability` execute `BEFORE INSERT OR UPDATE OR DELETE ON tasks` and `task_dependencies`. If `workflow_versions.is_immutable = TRUE`, the trigger aborts the transaction with `SQLSTATE '55000'`.
  3. *Foreign Key Protection*: `workflow_runs.workflow_version_id` specifies `ON DELETE RESTRICT`. Note that `ON DELETE RESTRICT` alone only prevents deleting the version record; the application lock and database triggers are required to guarantee that tasks and dependencies cannot be altered.
- **Consequences**: Concurrency races between editing a draft version and executing it are resolved deterministically: the run-creation transaction holds an exclusive row lock, sealing the version and blocking concurrent edits.

---

### ADR-003: Distinct State Enums & Workflow Run Lifecycle Resolution
- **Context**: Orchestrators risk conflating the status of an overall workflow run with the status of individual tasks within the workflow.
- **Decision**: Define separate state spaces:
  - **WorkflowRunState**: `CREATED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`
  - **TaskState**: `PENDING`, `READY`, `RUNNING`, `SUCCESS`, `FAILED`, `RETRYING`, `DEAD_LETTER`, `CANCELLED` (matches [TaskState.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/state/TaskState.java))
- **Terminal State Determination Rules**:
  - `CREATED`: Run inserted, task runs initialized to `PENDING` (with 0-indegree tasks transitioning to `READY`).
  - `RUNNING`: Active execution where at least one task is in `READY`, `RUNNING`, or `RETRYING`.
  - `SUCCESS`: Resolves if and only if **ALL** tasks in the workflow reach `TaskState.SUCCESS`.
  - `FAILED`: Resolves as soon as any task reaches `TaskState.DEAD_LETTER` or fails permanently with no retries remaining, blocking downstream progression. Any concurrently executing tasks are sent cooperative cancellation signals, and remaining pending tasks transition to `CANCELLED`.
  - `CANCELLED`: Resolves immediately when cancelled by operator request (`POST /api/runs/{runId}/cancel`). All `PENDING` and `READY` tasks transition to `CANCELLED`, and workers executing active tasks are instructed to abort.
- **Consequences**: [TaskStateMachine.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/state/TaskStateMachine.java) governs task lifecycle transitions exclusively. A separate workflow-level coordinator evaluates when all tasks achieve terminal state to resolve the overall run status.

---

### ADR-004: Pure Java Domain Authority for DAG Validation
- **Context**: Verifying that a graph is acyclic and structurally sound can be performed at the UI layer, in database triggers, or in backend application code.
- **Decision**: Entrust graph validation exclusively to the pure Java domain component [DagEngine.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/engine/DagEngine.java).
- **Rationale**: 
  - The UI is untrusted and can be bypassed.
  - Cycle detection in SQL (recursive CTEs or procedural PL/pgSQL triggers) is complex, hard to test, and database-vendor coupled.
  - [DagEngine.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/engine/DagEngine.java) already has 100% verified test coverage for cycle detection, self-loops, and topological sorting.
- **Consequences**: Incoming workflow versions are constructed into in-memory [WorkflowDag](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/model/WorkflowDag.java) instances and validated by `DagEngine.validate()` before any database insert.

---

### ADR-005: Composite Relational Integrity Across Workflow Versions
- **Context**: In a versioned workflow schema, simple foreign keys to `tasks(id)` allow edges or task runs to accidentally mix tasks across different workflow versions.
- **Decision**: 
  - Add composite unique constraints `tasks(version_id, id)` and `workflow_runs(id, workflow_version_id)`.
  - Enforce composite foreign keys on:
    - `task_dependencies(version_id, source_task_id) -> tasks(version_id, id)`
    - `task_dependencies(version_id, target_task_id) -> tasks(version_id, id)`
    - `task_runs(workflow_run_id, workflow_version_id) -> workflow_runs(id, workflow_version_id)`
    - `task_runs(workflow_version_id, task_id) -> tasks(version_id, id)`
- **Rationale**: Completely prevents database corruption where a dependency connects tasks from different versions, or where a task run references a task outside of the executed workflow run's version.
- **Consequences**: Invariants are guaranteed by the database engine at the relational level, complementing domain-level checks.

---

### ADR-006: Logical Task Lifecycle vs. Discrete Execution Attempt History
- **Context**: When a task fails and is retried, the system must maintain the current task lifecycle state while preserving the history, logs, and diagnostics of every prior execution attempt.
- **Decision**: Separate the model into `task_runs` and `task_attempts`:
  - `task_runs`: Represents the logical task in a workflow run. Has `UNIQUE (workflow_run_id, task_id)`. Holds current lifecycle state (`TaskState`), current attempt count, active worker lease, and aggregate duration.
  - `task_attempts`: Represents each physical execution attempt. Has `UNIQUE (task_run_id, attempt_number)`. Records worker ID, attempt status (`RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`), output payload, error messages, stack traces, and attempt timings.
  - `task_attempt_logs`: Retains execution logs linked to the specific `task_attempt_id`.
- **Rationale**: Resolves the contradiction between `UNIQUE (workflow_run_id, task_id)` and attempt history. Allows callers to inspect both the current overall state of a task and the granular failure diagnostics of each historical retry attempt (`GET /api/task-runs/{id}/logs?attempt=1`).
- **Consequences**: Retry handling inserts a new `task_attempts` row upon each retry dispatch while updating `task_runs.status = 'RUNNING'` and `task_runs.current_attempt = attempt_number`.

---

### ADR-007: Two-Tier Authorization Architecture (Global vs. Project RBAC)
- **Context**: FlowForge requires tenant isolation, fine-grained access control, and distinction between administrative platform operators and project participants.
- **Decision**: Implement a two-tier authorization model:
  - **Global Roles** (`users.global_role`):
    - `SYSTEM_ADMIN`: Platform superuser with access across all projects, system diagnostics, and tenant management.
    - `STANDARD_USER`: Standard authenticated user whose project access is determined by project membership.
  - **Project Roles** (`project_members.role`):
    - `OWNER`: Full project control, project deletion, ownership transfer, member management.
    - `ADMIN`: Manage workflows, versions, runs, and add/remove members (except owner).
    - `DEVELOPER`: Create/edit workflows and draft versions, trigger/cancel runs. Read-only access to project settings.
    - `VIEWER`: Read-only access to workflows, versions, execution runs, task metrics, and logs.
  - Project membership is explicitly represented via `project_members(project_id, user_id, role)`.
- **Rationale**: The UI cannot be trusted to restrict access. All entities (`workflows`, `runs`, `versions`) cascade their authorization checks to their parent `project`.
- **Consequences**: Every project-scoped REST endpoint verifies `(project_id, user_id)` server-side.

---

### ADR-008: Canonical Retry Semantics (`maxAttempts`)
- **Context**: In orchestration systems, "max attempts" and "max retries" are frequently confused. In the FlowForge Java domain model, [FixedRetryPolicy.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/retry/FixedRetryPolicy.java) is implemented with `maxAttempts >= 1` representing total allowed executions including the initial attempt.
- **Decision**: Standardize on **`maxAttempts`** (in API: `maxAttempts`, in DB: `max_attempts`) as the canonical term across all layers.
- **Rationale**: Directly aligns with Java domain `FixedRetryPolicy.getMaxAttempts()` without semantic translation layers:
  $$\text{maxRetries} = \text{maxAttempts} - 1$$
  - `maxAttempts = 1`: Runs once, 0 retries.
  - `maxAttempts = 3`: Runs initial attempt (1), up to 2 retries (attempts 2 and 3).
- **Consequences**: API documentation, database schemas, and Java domain models share identical vocabulary and constraints (`max_attempts >= 1`).

---

### ADR-009: Idempotency Key Handling & Request Fingerprinting
- **Context**: Network retries or repeated user submissions can accidentally trigger duplicate workflow runs.
- **Decision**: Support optional `Idempotency-Key: <UUID>` header on `POST /api/versions/{versionId}/runs`. Store both `idempotency_key` (unique) and `request_hash` (SHA-256 fingerprint of normalized request body + version ID) in `workflow_runs`.
- **Behavior**:
  - If a matching `idempotency_key` is found:
    - **Identical `request_hash`**: Return existing run with HTTP `200 OK` and header `Idempotent-Replay: true`.
    - **Mismatched `request_hash`**: Reject with HTTP `409 Conflict` (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
  - If no matching key is found: Insert new run. Concurrent races are caught by the PostgreSQL unique constraint on `idempotency_key`.
- **Consequences**: Safe, reliable execution triggering without accidental duplicates or payload tampering.

---

### ADR-010: PostgreSQL as Single Durable Source of Truth
- **Context**: Distributed architectures often prematurely adopt Redis or Kafka, risking split-brain state or synchronization drift.
- **Decision**: The relational database (PostgreSQL) is the sole durable authority for workflow definitions, execution records, worker leases, and state logs. Redis and Kafka are strictly deferred to later milestones.
- **Rationale**: Workflow state requires transactional consistency (ACID), strong relational integrity, and historical querying. Introducing brokers prior to stable domain persistence creates operational friction without added value.
- **Consequences**: No message queues or cache layers are added in this milestone.

---

## 2. Mapping to Existing Java Domain Model

| Relational / API Concept | Current Java Class | Alignment Assessment |
| :--- | :--- | :--- |
| `tasks.task_key` & `name` | [com.flowforge.dag.model.Task](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/model/Task.java) | **Exact Match**: `Task(id, name)` corresponds directly to `task_key` and `name`. |
| `task_dependencies` | [com.flowforge.dag.model.TaskDependency](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/model/TaskDependency.java) | **Exact Match**: `TaskDependency(sourceTaskId, targetTaskId)` matches `source_task_id -> target_task_id`. |
| `workflow_versions` (DAG graph) | [com.flowforge.dag.model.WorkflowDag](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/model/WorkflowDag.java) | **Exact Match**: `WorkflowDag` holds tasks and dependencies, calculates indegrees and initial ready tasks. |
| Graph Cycle Validation | [com.flowforge.dag.engine.DagEngine](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/engine/DagEngine.java) | **Exact Match**: Validates DAG acyclicity and computes topological ordering. |
| `task_runs.status` | [com.flowforge.execution.state.TaskState](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/state/TaskState.java) | **Exact Match**: All 8 states (`PENDING`, `READY`, `RUNNING`, `SUCCESS`, `FAILED`, `RETRYING`, `DEAD_LETTER`, `CANCELLED`) exist in domain enum. |
| Task State Transitions | [com.flowforge.execution.state.TaskStateMachine](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/state/TaskStateMachine.java) | **Exact Match**: Enforces valid transitions and rejects invalid state hops. |
| `tasks.max_attempts` & Retry Policy | [com.flowforge.execution.retry.FixedRetryPolicy](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/retry/FixedRetryPolicy.java) | **Exact Match**: Domain `FixedRetryPolicy(maxAttempts)` mirrors `tasks.max_attempts`. |
| Backoff Strategies | [com.flowforge.execution.retry.*](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/retry/BackoffStrategy.java) | **Exact Match**: `FixedBackoff`, `ExponentialBackoff`, and `FullJitterBackoff` mirror DB `backoff_strategy` configurations. |

---

## 3. Genuine Gaps & Identified Discrepancies

The following differences between the proposed schema/API and current domain classes are noted:

1. **Per-Task Execution Metadata**:
   - *Current State*: [Task.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/model/Task.java) is a minimal node model containing only `id` and `name`. [RetryPolicy](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/retry/RetryPolicy.java) and [BackoffStrategy](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/retry/BackoffStrategy.java) instances are configured externally.
   - *Design Proposal*: The database schema stores `task_type`, `parameters`, `max_attempts`, and backoff parameters directly per task.
   - *Action Plan*: In future milestones, domain task models can either encapsulate execution configuration or be wrapped by persistence entity adapters without altering the core DAG validation interface.

2. **Workflow Run State Enum**:
   - *Current State*: The Java backend currently contains [TaskState](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/state/TaskState.java), but does not yet declare a `WorkflowRunState` enum.
   - *Design Proposal*: API and persistence specifications define `WorkflowRunState` (`CREATED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`).
   - *Action Plan*: Introduce a `WorkflowRunState` enum when implementing the workflow run entity in Milestone 2.

3. **In-Memory vs. Persistent Scheduler**:
   - *Current State*: [Scheduler.java](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/scheduler/Scheduler.java) operates entirely in-memory with an injected [TaskExecutor](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/scheduler/TaskExecutor.java).
   - *Design Proposal*: In future milestones, scheduling operations will read `READY` task runs from PostgreSQL and persist state updates transactionally.
   - *Action Plan*: The existing in-memory scheduler logic serves as the algorithm reference for state transitions and dependency unlocking.

---

## 4. Unresolved Decisions & Open Questions for Future Milestones

1. **Inter-Task Output Passing**:
   - *Question*: How should outputs from upstream tasks be routed into downstream task parameters?
   - *Options*: (a) Store JSON payload in `task_attempts.output_payload` and support template expressions (e.g., `{{tasks.extract.output.id}}`), or (b) Treat tasks as side-effect only with shared external storage.
   - *Recommendation*: Introduce a simple JSON pointer extraction model in Phase 2.

2. **Worker Registration and Dynamic Leases**:
   - *Question*: Should worker instances be tracked in a distinct `worker_instances` table with heartbeat timestamps, or handled via dynamic leases on `task_runs`?
   - *Options*: (a) Dynamic leases on `task_runs` (`worker_id`, `lease_token`, `lease_expires_at`), or (b) Dedicated `worker_instances` table with periodic heartbeating.
   - *Recommendation*: Start with dynamic leases on `task_runs`. Add a `worker_instances` table in Milestone 2 when worker heartbeat loss recovery is implemented.

3. **Execution Log Storage**:
   - *Question*: How should verbose task logs be stored long-term?
   - *Options*: (a) Dedicated `task_attempt_logs` table in PostgreSQL, or (b) Filesystem / Object Storage (S3/GCS).
   - *Recommendation*: Use `task_attempt_logs` in PostgreSQL for local development and initial phases, migrating to object storage if log volume becomes large.

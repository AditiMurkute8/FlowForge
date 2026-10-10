# FlowForge REST API Contract Specification

This document defines the REST API contract for **FlowForge**, a learning-first distributed workflow orchestration platform. It covers endpoint paths, HTTP verbs, payload schemas, query parameters, status codes, and error representations for core entities prior to database and service implementation.

---

## 1. Architectural Foundations & Invariants

1. **Server-Side Authorization & Project Tenancy**:
   - Client applications (including the React frontend) are completely untrusted for authorization.
   - FlowForge defines two distinct authorization scopes:
     - **Global Roles** (`users.global_role`):
       - `SYSTEM_ADMIN`: Platform-wide superuser with access across all projects, system diagnostics, and tenant management.
       - `STANDARD_USER`: Standard authenticated identity requiring project-specific permissions.
     - **Project Roles** (`project_members.role`):
       - `OWNER`: Full project control, project deletion, ownership transfer, member management.
       - `ADMIN`: Manage workflows, versions, runs, and add/remove members (except owner).
       - `DEVELOPER`: Create/edit workflows and versions, trigger/cancel runs. Read-only access to project settings.
       - `VIEWER`: Read-only access to workflows, versions, execution runs, task metrics, and logs.
   - Authorization checks evaluate `(project_id, user_id)` on every project-scoped endpoint.

2. **Workflow Version Lifecycle & Immutability**:
   - A workflow definition has a stable identity (`Workflow`), while its topology and task configurations exist as discrete `WorkflowVersion` snapshots.
   - **Draft Versions** (`is_immutable = FALSE`): Unexecuted versions may have their graph definitions updated via `PUT /api/versions/{versionId}` or deleted via `DELETE /api/versions/{versionId}`.
   - **Executed Versions** (`is_immutable = TRUE`): Atomically sealed upon triggering the version's first `WorkflowRun`. Subsequent mutations to tasks, dependencies, or the version record are rejected with HTTP `409 Conflict` (`VERSION_IMMUTABLE`). Future topology adjustments require creating a new version (`version_number = N + 1`).

3. **Deterministic DAG Validation**:
   - All proposed workflow versions undergo graph validation by the Java domain engine ([DagEngine](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/engine/DagEngine.java)) before persistence.
   - Cycles, self-loops, orphaned dependency edges, or duplicate task identifiers are rejected with HTTP `400 Bad Request`.

4. **Logical Task State vs. Execution Attempt History**:
   - A logical task execution within a workflow run is tracked as a single `task_run` entity, maintaining `UNIQUE (workflow_run_id, task_id)` and current lifecycle state (`TaskState`).
   - Every physical execution attempt is recorded as a discrete `task_attempt` entity with attempt number (1-indexed), timing, worker ID, output payload, and failure diagnostics.
   - `WorkflowRunState` (`CREATED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`) and `TaskState` (`PENDING`, `READY`, `RUNNING`, `SUCCESS`, `FAILED`, `RETRYING`, `DEAD_LETTER`, `CANCELLED`) are distinct operational state spaces.

5. **Canonical Retry Semantics (`maxAttempts`)**:
   - The canonical external and persistence term is **`maxAttempts`** (integer >= 1).
   - Maps directly to the Java domain [FixedRetryPolicy](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/execution/retry/FixedRetryPolicy.java).
   - Relationship: $\text{maxRetries} = \text{maxAttempts} - 1$. An initial execution with zero retries has `maxAttempts = 1`.

6. **Workflow Run Lifecycle Resolution**:
   - **`CREATED`**: Initial run record inserted; tasks initialized in `PENDING` (with 0-indegree tasks transitioning to `READY`).
   - **`RUNNING`**: Active execution with at least one task in `READY`, `RUNNING`, or `RETRYING`.
   - **`SUCCESS`**: Resolved when and only when **ALL** tasks in the workflow reach `TaskState.SUCCESS`.
   - **`FAILED`**: Resolved when any task reaches `TaskState.DEAD_LETTER` or fails permanently without eligible retries, preventing downstream execution. In-flight tasks receive cooperative cancellation.
   - **`CANCELLED`**: Triggered via operator request (`POST /api/runs/{runId}/cancel`), transitioning uncompleted tasks to `CANCELLED`.

7. **Idempotent Run Triggering**:
   - Client requests may supply an `Idempotency-Key: <UUID>` header.
   - **Same key + identical request payload**: Returns existing run with HTTP `200 OK` (and response header `Idempotent-Replay: true`).
   - **Same key + mismatched request payload**: Rejects request with HTTP `409 Conflict` (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).

---

## 2. Standard Error Format (RFC 7807 / RFC 9457)

All non-2xx responses return an `application/problem+json` payload:

```json
{
  "type": "https://flowforge.io/errors/cycle-detected",
  "title": "Invalid Workflow DAG",
  "status": 400,
  "detail": "Cycle detected in workflow graph: task-A -> task-B -> task-A",
  "instance": "/api/workflows/c8a2b16a-7df6-4b2a-8d19-45e0a0f0a101/versions",
  "errorCode": "CYCLE_DETECTED",
  "timestamp": "2026-10-10T12:00:00Z",
  "invalidParams": [
    {
      "name": "dependencies",
      "reason": "Cycle involves tasks: ['task-A', 'task-B']"
    }
  ]
}
```

### Standard Error Codes

| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_FAILED` | Request body or parameters failed schema validation |
| `400 Bad Request` | `CYCLE_DETECTED` | Dependency graph contains a cycle or self-loop |
| `400 Bad Request` | `INVALID_DAG` | Dependency references unknown tasks or contains invalid edges |
| `401 Unauthorized` | `AUTHENTICATION_REQUIRED` | Missing, expired, or invalid JWT credentials |
| `403 Forbidden` | `ACCESS_DENIED` | Insufficient project-level permissions (e.g. VIEWER attempting mutation) |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Specified project, workflow, version, run, or task does not exist |
| `409 Conflict` | `VERSION_IMMUTABLE` | Attempted mutation of an already-executed workflow version |
| `409 Conflict` | `DUPLICATE_RESOURCE` | Resource with the same unique identifier or name already exists |
| `409 Conflict` | `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | Idempotency key already used with different request parameters |
| `409 Conflict` | `INVALID_STATE_TRANSITION` | Operation not permitted in current execution state |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR` | Unexpected server fault |

---

## 3. Projects & Membership API

### 3.1 Create Project
- **Method**: `POST`
- **Path**: `/api/projects`
- **Success Status**: `201 Created`

**Request Body**:
```json
{
  "name": "Data Ingestion Pipeline",
  "slug": "data-ingestion-pipeline",
  "description": "Daily batch ingestion and enrichment workflows"
}
```

**Response Body (`201 Created`)**:
```json
{
  "id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
  "name": "Data Ingestion Pipeline",
  "slug": "data-ingestion-pipeline",
  "description": "Daily batch ingestion and enrichment workflows",
  "ownerUserId": "a1111111-2222-3333-4444-555555555555",
  "currentUserRole": "OWNER",
  "createdAt": "2026-10-10T12:00:00Z",
  "updatedAt": "2026-10-10T12:00:00Z"
}
```

---

### 3.2 List Projects
- **Method**: `GET`
- **Path**: `/api/projects`
- **Query Parameters**: `page` (default `0`), `size` (default `20`)
- **Success Status**: `200 OK`

---

### 3.3 Get Project
- **Method**: `GET`
- **Path**: `/api/projects/{projectId}`
- **Success Status**: `200 OK`

---

### 3.4 Update Project
- **Method**: `PATCH`
- **Path**: `/api/projects/{projectId}`
- **Permissions**: Requires project `OWNER` or `ADMIN`.
- **Success Status**: `200 OK`

---

### 3.5 Delete Project
- **Method**: `DELETE`
- **Path**: `/api/projects/{projectId}`
- **Permissions**: Requires project `OWNER` or global `SYSTEM_ADMIN`.
- **Success Status**: `204 No Content`

---

### 3.6 List Project Members
- **Method**: `GET`
- **Path**: `/api/projects/{projectId}/members`
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "projectId": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
  "members": [
    {
      "userId": "a1111111-2222-3333-4444-555555555555",
      "email": "lead@flowforge.io",
      "fullName": "Engineering Lead",
      "role": "OWNER",
      "joinedAt": "2026-10-10T12:00:00Z"
    },
    {
      "userId": "b2222222-3333-4444-5555-666666666666",
      "email": "dev@flowforge.io",
      "fullName": "Workflow Engineer",
      "role": "DEVELOPER",
      "joinedAt": "2026-10-10T12:05:00Z"
    }
  ]
}
```

---

### 3.7 Add Project Member
- **Method**: `POST`
- **Path**: `/api/projects/{projectId}/members`
- **Permissions**: Requires project `OWNER` or `ADMIN`.
- **Success Status**: `201 Created`

**Request Body**:
```json
{
  "userId": "c3333333-4444-5555-6666-777777777777",
  "role": "DEVELOPER"
}
```

---

### 3.8 Update Member Role
- **Method**: `PATCH`
- **Path**: `/api/projects/{projectId}/members/{userId}`
- **Permissions**: Requires project `OWNER` or `ADMIN` (cannot modify project `OWNER`).
- **Success Status**: `200 OK`

**Request Body**:
```json
{
  "role": "ADMIN"
}
```

---

### 3.9 Remove Project Member
- **Method**: `DELETE`
- **Path**: `/api/projects/{projectId}/members/{userId}`
- **Permissions**: Requires project `OWNER` or `ADMIN` (cannot remove project `OWNER`).
- **Success Status**: `204 No Content`

---

## 4. Workflows API

### 4.1 Create Workflow
- **Method**: `POST`
- **Path**: `/api/projects/{projectId}/workflows`
- **Permissions**: Requires project `OWNER`, `ADMIN`, or `DEVELOPER`.
- **Success Status**: `201 Created`

**Request Body**:
```json
{
  "name": "nightly-etl-sync",
  "description": "Synchronizes customer records and triggers downstream analytics"
}
```

---

### 4.2 List Workflows in Project
- **Method**: `GET`
- **Path**: `/api/projects/{projectId}/workflows`
- **Success Status**: `200 OK`

---

### 4.3 Get Workflow by ID
- **Method**: `GET`
- **Path**: `/api/workflows/{workflowId}`
- **Success Status**: `200 OK`

---

### 4.4 Update Workflow Metadata
- **Method**: `PATCH`
- **Path**: `/api/workflows/{workflowId}`
- **Success Status**: `200 OK`

---

### 4.5 Delete Workflow
- **Method**: `DELETE`
- **Path**: `/api/workflows/{workflowId}`
- **Success Status**: `204 No Content`
- **Validation**: Rejects deletion with `409 Conflict` if any active runs exist.

---

## 5. Workflow Versions API

### 5.1 Create Workflow Version (Draft)
- **Method**: `POST`
- **Path**: `/api/workflows/{workflowId}/versions`
- **Success Status**: `201 Created`
- **Server Behavior**: Validates graph acyclicity via [DagEngine](file:///c:/Users/Ms.%20Aditi/OneDrive/Desktop/FlowForge/backend/src/main/java/com/flowforge/dag/engine/DagEngine.java) before persisting.

**Request Body**:
```json
{
  "changeSummary": "Initial ETL ingestion DAG",
  "tasks": [
    {
      "taskKey": "extract-postgres",
      "name": "Extract DB Records",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/extract", "method": "POST" },
      "maxAttempts": 3,
      "backoffStrategy": "EXPONENTIAL",
      "initialBackoffMs": 1000,
      "maxBackoffMs": 10000,
      "backoffMultiplier": 2.0
    },
    {
      "taskKey": "extract-s3",
      "name": "Extract S3 Files",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/s3-extract", "method": "POST" },
      "maxAttempts": 3,
      "backoffStrategy": "FULL_JITTER",
      "initialBackoffMs": 500,
      "maxBackoffMs": 5000,
      "backoffMultiplier": 2.0
    },
    {
      "taskKey": "transform-data",
      "name": "Clean and Join Records",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/transform", "method": "POST" },
      "maxAttempts": 2,
      "backoffStrategy": "FIXED",
      "initialBackoffMs": 2000,
      "maxBackoffMs": 2000,
      "backoffMultiplier": 1.0
    },
    {
      "taskKey": "load-warehouse",
      "name": "Load to Analytics Warehouse",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/load", "method": "POST" },
      "maxAttempts": 3,
      "backoffStrategy": "EXPONENTIAL",
      "initialBackoffMs": 1000,
      "maxBackoffMs": 8000,
      "backoffMultiplier": 2.0
    }
  ],
  "dependencies": [
    { "sourceTaskKey": "extract-postgres", "targetTaskKey": "transform-data" },
    { "sourceTaskKey": "extract-s3", "targetTaskKey": "transform-data" },
    { "sourceTaskKey": "transform-data", "targetTaskKey": "load-warehouse" }
  ]
}
```

**Response Body (`201 Created`)**:
```json
{
  "id": "f51d8b67-628d-42e7-9d7a-112233445566",
  "workflowId": "c8a2b16a-7df6-4b2a-8d19-45e0a0f0a101",
  "versionNumber": 1,
  "changeSummary": "Initial ETL ingestion DAG",
  "isImmutable": false,
  "taskCount": 4,
  "dependencyCount": 3,
  "createdAt": "2026-10-10T12:10:00Z"
}
```

---

### 5.2 Update Draft Workflow Version
- **Method**: `PUT`
- **Path**: `/api/versions/{versionId}`
- **Success Status**: `200 OK`
- **Server Behavior**: Replaces the draft version's tasks and dependencies after validating the updated graph via `DagEngine`.
- **Validation**: Rejects with `409 Conflict` (`VERSION_IMMUTABLE`) if `is_immutable = TRUE`.

---

### 5.3 Delete Draft Workflow Version
- **Method**: `DELETE`
- **Path**: `/api/versions/{versionId}`
- **Success Status**: `204 No Content`
- **Validation**: Rejects with `409 Conflict` (`VERSION_IMMUTABLE`) if `is_immutable = TRUE`.

---

### 5.4 List Workflow Versions
- **Method**: `GET`
- **Path**: `/api/workflows/{workflowId}/versions`
- **Success Status**: `200 OK`

---

### 5.5 Get Workflow Version Details (with Full DAG)
- **Method**: `GET`
- **Path**: `/api/versions/{versionId}`
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "id": "f51d8b67-628d-42e7-9d7a-112233445566",
  "workflowId": "c8a2b16a-7df6-4b2a-8d19-45e0a0f0a101",
  "versionNumber": 1,
  "changeSummary": "Initial ETL ingestion DAG",
  "isImmutable": true,
  "createdAt": "2026-10-10T12:10:00Z",
  "tasks": [
    {
      "id": "11111111-aaaa-bbbb-cccc-000000000001",
      "taskKey": "extract-postgres",
      "name": "Extract DB Records",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/extract", "method": "POST" },
      "maxAttempts": 3,
      "backoffStrategy": "EXPONENTIAL",
      "initialBackoffMs": 1000,
      "maxBackoffMs": 10000,
      "backoffMultiplier": 2.0
    },
    {
      "id": "11111111-aaaa-bbbb-cccc-000000000002",
      "taskKey": "extract-s3",
      "name": "Extract S3 Files",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/s3-extract", "method": "POST" },
      "maxAttempts": 3,
      "backoffStrategy": "FULL_JITTER",
      "initialBackoffMs": 500,
      "maxBackoffMs": 5000,
      "backoffMultiplier": 2.0
    },
    {
      "id": "11111111-aaaa-bbbb-cccc-000000000003",
      "taskKey": "transform-data",
      "name": "Clean and Join Records",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/transform", "method": "POST" },
      "maxAttempts": 2,
      "backoffStrategy": "FIXED",
      "initialBackoffMs": 2000,
      "maxBackoffMs": 2000,
      "backoffMultiplier": 1.0
    },
    {
      "id": "11111111-aaaa-bbbb-cccc-000000000004",
      "taskKey": "load-warehouse",
      "name": "Load to Analytics Warehouse",
      "taskType": "HTTP",
      "parameters": { "endpoint": "https://service.internal/load", "method": "POST" },
      "maxAttempts": 3,
      "backoffStrategy": "EXPONENTIAL",
      "initialBackoffMs": 1000,
      "maxBackoffMs": 8000,
      "backoffMultiplier": 2.0
    }
  ],
  "dependencies": [
    {
      "sourceTaskId": "11111111-aaaa-bbbb-cccc-000000000001",
      "sourceTaskKey": "extract-postgres",
      "targetTaskId": "11111111-aaaa-bbbb-cccc-000000000003",
      "targetTaskKey": "transform-data"
    },
    {
      "sourceTaskId": "11111111-aaaa-bbbb-cccc-000000000002",
      "sourceTaskKey": "extract-s3",
      "targetTaskId": "11111111-aaaa-bbbb-cccc-000000000003",
      "targetTaskKey": "transform-data"
    },
    {
      "sourceTaskId": "11111111-aaaa-bbbb-cccc-000000000003",
      "sourceTaskKey": "transform-data",
      "targetTaskId": "11111111-aaaa-bbbb-cccc-000000000004",
      "targetTaskKey": "load-warehouse"
    }
  ]
}
```

---

## 6. Workflow Runs API

### 6.1 Trigger Workflow Run
- **Method**: `POST`
- **Path**: `/api/versions/{versionId}/runs`
- **Header**: `Idempotency-Key: <UUID>` (optional)
- **Success Status**: `201 Created` (or `200 OK` on idempotent replay with `Idempotent-Replay: true`)
- **Server Behavior**: Atomically seals the version (`is_immutable = TRUE`) in the same transaction.

**Request Body**:
```json
{
  "triggerType": "MANUAL",
  "inputParameters": {
    "batchDate": "2026-10-10",
    "dryRun": false
  }
}
```

**Response Body (`201 Created`)**:
```json
{
  "id": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
  "workflowVersionId": "f51d8b67-628d-42e7-9d7a-112233445566",
  "workflowId": "c8a2b16a-7df6-4b2a-8d19-45e0a0f0a101",
  "versionNumber": 1,
  "status": "CREATED",
  "triggerType": "MANUAL",
  "triggeredByUserId": "a1111111-2222-3333-4444-555555555555",
  "inputParameters": {
    "batchDate": "2026-10-10",
    "dryRun": false
  },
  "startedAt": null,
  "completedAt": null,
  "durationMs": null,
  "createdAt": "2026-10-10T12:15:00Z"
}
```

---

### 6.2 List Runs for Workflow
- **Method**: `GET`
- **Path**: `/api/workflows/{workflowId}/runs`
- **Query Parameters**: `status`, `versionId`, `page`, `size`
- **Success Status**: `200 OK`

---

### 6.3 Get Workflow Run Details
- **Method**: `GET`
- **Path**: `/api/runs/{runId}`
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "id": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
  "workflowVersionId": "f51d8b67-628d-42e7-9d7a-112233445566",
  "workflowId": "c8a2b16a-7df6-4b2a-8d19-45e0a0f0a101",
  "versionNumber": 1,
  "status": "RUNNING",
  "triggerType": "MANUAL",
  "triggeredByUserId": "a1111111-2222-3333-4444-555555555555",
  "startedAt": "2026-10-10T12:15:01Z",
  "completedAt": null,
  "durationMs": null,
  "taskSummary": {
    "totalTasks": 4,
    "pending": 1,
    "ready": 0,
    "running": 2,
    "success": 1,
    "failed": 0,
    "retrying": 0,
    "deadLetter": 0,
    "cancelled": 0
  },
  "createdAt": "2026-10-10T12:15:00Z"
}
```

---

### 6.4 Cancel Workflow Run
- **Method**: `POST`
- **Path**: `/api/runs/{runId}/cancel`
- **Success Status**: `200 OK`

---

## 7. Task-Run & Attempt Inspection API

### 7.1 List Task Runs for Workflow Run
- **Method**: `GET`
- **Path**: `/api/runs/{runId}/tasks`
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "workflowRunId": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
  "tasks": [
    {
      "taskRunId": "99999999-0000-1111-2222-333333333301",
      "taskId": "11111111-aaaa-bbbb-cccc-000000000001",
      "taskKey": "extract-postgres",
      "name": "Extract DB Records",
      "status": "SUCCESS",
      "currentAttempt": 1,
      "maxAttempts": 3,
      "workerId": "worker-node-1",
      "startedAt": "2026-10-10T12:15:02Z",
      "completedAt": "2026-10-10T12:15:05Z",
      "durationMs": 3000
    },
    {
      "taskRunId": "99999999-0000-1111-2222-333333333302",
      "taskId": "11111111-aaaa-bbbb-cccc-000000000002",
      "taskKey": "extract-s3",
      "name": "Extract S3 Files",
      "status": "RUNNING",
      "currentAttempt": 1,
      "maxAttempts": 3,
      "workerId": "worker-node-2",
      "startedAt": "2026-10-10T12:15:02Z",
      "completedAt": null,
      "durationMs": null
    },
    {
      "taskRunId": "99999999-0000-1111-2222-333333333303",
      "taskId": "11111111-aaaa-bbbb-cccc-000000000003",
      "taskKey": "transform-data",
      "name": "Clean and Join Records",
      "status": "PENDING",
      "currentAttempt": 0,
      "maxAttempts": 2,
      "workerId": null,
      "startedAt": null,
      "completedAt": null,
      "durationMs": null
    },
    {
      "taskRunId": "99999999-0000-1111-2222-333333333304",
      "taskId": "11111111-aaaa-bbbb-cccc-000000000004",
      "taskKey": "load-warehouse",
      "name": "Load to Analytics Warehouse",
      "status": "PENDING",
      "currentAttempt": 0,
      "maxAttempts": 3,
      "workerId": null,
      "startedAt": null,
      "completedAt": null,
      "durationMs": null
    }
  ]
}
```

---

### 7.2 Get Detailed Task Run
- **Method**: `GET`
- **Path**: `/api/task-runs/{taskRunId}`
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "id": "99999999-0000-1111-2222-333333333301",
  "workflowRunId": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
  "taskId": "11111111-aaaa-bbbb-cccc-000000000001",
  "taskKey": "extract-postgres",
  "status": "SUCCESS",
  "currentAttempt": 1,
  "maxAttempts": 3,
  "workerId": "worker-node-1",
  "leaseExpiresAt": "2026-10-10T12:15:32Z",
  "startedAt": "2026-10-10T12:15:02Z",
  "completedAt": "2026-10-10T12:15:05Z",
  "durationMs": 3000,
  "latestAttempt": {
    "attemptNumber": 1,
    "status": "SUCCESS",
    "workerId": "worker-node-1",
    "outputPayload": { "recordsProcessed": 14500, "checksum": "sha256-abcdef12345" },
    "errorMessage": null,
    "startedAt": "2026-10-10T12:15:02Z",
    "completedAt": "2026-10-10T12:15:05Z",
    "durationMs": 3000
  }
}
```

---

### 7.3 List Task Execution Attempts
- **Method**: `GET`
- **Path**: `/api/task-runs/{taskRunId}/attempts`
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "taskRunId": "99999999-0000-1111-2222-333333333301",
  "totalAttempts": 2,
  "attempts": [
    {
      "attemptNumber": 1,
      "workerId": "worker-node-1",
      "status": "FAILED",
      "outputPayload": null,
      "errorMessage": "Connection timeout after 3000ms",
      "errorDetails": { "errorCode": "ETIMEDOUT", "retryable": true },
      "startedAt": "2026-10-10T12:15:02Z",
      "completedAt": "2026-10-10T12:15:05Z",
      "durationMs": 3000
    },
    {
      "attemptNumber": 2,
      "workerId": "worker-node-2",
      "status": "SUCCESS",
      "outputPayload": { "recordsProcessed": 14500 },
      "errorMessage": null,
      "errorDetails": null,
      "startedAt": "2026-10-10T12:15:07Z",
      "completedAt": "2026-10-10T12:15:09Z",
      "durationMs": 2000
    }
  ]
}
```

---

### 7.4 Retrieve Task Execution Logs
- **Method**: `GET`
- **Path**: `/api/task-runs/{taskRunId}/logs`
- **Query Parameters**:
  - `attempt` (optional integer, defaults to `currentAttempt`)
  - `limit` (default `1000`)
- **Success Status**: `200 OK`

**Response Body (`200 OK`)**:
```json
{
  "taskRunId": "99999999-0000-1111-2222-333333333301",
  "attemptNumber": 2,
  "totalLines": 2,
  "lines": [
    {
      "timestamp": "2026-10-10T12:15:07.102Z",
      "level": "INFO",
      "message": "Attempt 2: Re-establishing connection..."
    },
    {
      "timestamp": "2026-10-10T12:15:09.001Z",
      "level": "INFO",
      "message": "Attempt 2: Extraction completed successfully."
    }
  ]
}
```

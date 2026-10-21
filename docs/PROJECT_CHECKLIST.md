# FlowForge — Project Roadmap & Verification Checklist

**Project Name:** FlowForge — Distributed Visual Workflow Orchestration Platform
**Repository Source:** `c:/Users/Ms. Aditi/OneDrive/Desktop/FlowForge`
**Current Milestone:** Phase 1: Single-Node Core Engine (Completed)
**Status:** Verified & Approved — All Backend Unit/PostgreSQL Integration & Frontend CI Checks Passed
**Last Updated:** 2026-10-21

---

## Status Legend
- `[ ]` Not started
- `[/]` In progress / awaiting verification or approval
- `[x]` Completed with verified evidence

---

## Phase 0: Product Design & UI Foundation (Current Milestone)
**Target:** Visual application shell, design system, and developer workflow foundation (No backend/database/worker dependencies)

- [x] **Step 1: Repository Inspection & Architectural Baseline**
  - [x] Inspect Git repository state (clean initial repo initialized on `main` tracking `origin/main`)
  - [x] Inspect clean workspace state (fresh start executed and confirmed)
  - [x] Inspect tool availability (Node `v22.16.0`, npm `10.9.2`, Git `2.55.0.windows.2`, Java JRE 8 runtime detected)
  - [x] Check Stitch MCP accessibility (verified active tool access via `call_mcp_tool` on `StitchMCP`; project `projects/1127009169010254249`)
  - [x] Establish canonical `docs/PROJECT_CHECKLIST.md` with complete Phase 0–7 roadmap

- [x] **Step 2: Product Experience Definition & Stitch Design System**
  - [x] Establish Cloud Core Architecture design system in Stitch (`projects/1127009169010254249`)
  - [x] Screen A designed in Stitch: Production Projects Console (`projects/1127009169010254249/screens/bdafb2f6125a44e7b04940cc79557a33`)
  - [x] Screen B designed in Stitch: Utilitarian DAG Workflow Builder (`projects/1127009169010254249/screens/1d7cbb82cbd94b8fb603f8c62bbb356f`)
  - [x] Explicit user approval confirmed for Cloud Core Architecture design system, Screen A, Screen B, and implementation scope

- [x] **Step 3: Frontend Foundation Implementation & Vercel-Precision Redesign**
  - [x] Implement cohesive dual-theme design system (`src/index.css`) with shared CSS variables for Light (`:root`) and Dark (`.dark`) themes
  - [x] Add working Sun/Moon theme toggle in `src/components/AppShell.tsx` with persistent preference storage in `localStorage` and system media query fallback
  - [x] Remove hardcoded color values across all components to eliminate theme clashes
  - [x] Establish single sources of truth: `src/types.ts` (all interfaces) and `src/mockData.ts` (all mock stores)
  - [x] Build compact, restrained UI kit (`src/components/ui/`): Button, Input, Modal, Badge, Card, StatCard, EmptyState, Toast
  - [x] Redesign Projects Dashboard (`src/pages/ProjectsDashboard.tsx`): Balanced density, elegant hierarchy, 4 operational summaries (`StatCard`), readable project inventory table, compact status dots, search, create modal
  - [x] Redesign Workflow Builder (`src/pages/WorkflowBuilder.tsx`): Centered and immediately visible initial DAG with `ReactFlowProvider`, `useReactFlow`, `defaultViewport`, Fit View action, compact task library (`TaskPalette`), practical inspector (`TaskInspector`)
  - [x] Implement DAG validation engine (`src/utils/dagValidation.ts`): 3-color DFS cycle detection, self-loops, disconnected nodes
  - [x] Implement simulated Run action with explicit Phase 0 architecture boundary dialog and dry-run telemetry
  - [x] Ensure all metrics are explicitly labeled as mock data (`isMock: true`, `[Sample]`)

- [x] **Step 4: Tests, Engineering Review & Dev Server Verification**
  - [x] TypeScript type checks (`tsc --noEmit` passed with 0 errors)
  - [x] Code linting checks (`oxlint` passed: 0 warnings, 0 errors across 21 files in 10ms)
  - [x] Unit tests for DAG validation logic (`vitest run` passed: 6 of 6 tests passed in `src/utils/dagValidation.test.ts`)
  - [x] Production build verification (`npm run build` passed: 1765 modules transformed, built in 3.15s)
  - [x] Live development server verified: running at `http://localhost:5173/` with active HMR
  - [x] Clean workspace inspection (all temporary and build artifacts excluded via `.gitignore`)
  - [x] Accessibility review: WCAG 2.1 AA contrast, keyboard navigation (`Cmd+K`/`Ctrl+K`), input guard (`isEditableElement`)
  - [x] Responsive behavior verification (desktop and tablet layouts)

- [/] **Step 5: Git Workflow & Milestone Sign-off**
  - [x] Present comprehensive implementation report and diff explanation
  - [x] UI Approval: Approved by user for Milestone 0.1 initial commit
  - [/] Create approved commit with conventional message
  - [ ] Push to upstream remote and record verified commit hash

---

## Phase 1: Single-Node Core Engine
**Goal:** Build a correct, testable workflow engine in one process. No distributed components yet.

- [x] **Phase 1.1: Backend Foundation + DAG Core**
  - [x] Java 22 Spring Boot Maven foundation under `backend/`
  - [x] Maven Wrapper (`mvnw`, `mvnw.cmd`) checked into source control
  - [x] Pure framework-independent DAG domain model (`TaskNode`, `Edge`, `DirectedGraph`)
  - [x] Explicit edge semantics: `prerequisite -> dependent`
  - [x] Duplicate task rejection and unknown node edge reference rejection
  - [x] Iterative 3-color DFS cycle detection with deep-graph stack safety and reconstructed cycle paths (`DagValidator`)
  - [x] Deterministic topological ordering using Kahn's algorithm with tie-breaking (`TopologicalSorter`)
  - [x] Deep immutability of validation results and deterministic diagnostic messages (`ValidationResult`)
  - [x] Disconnected task node identification
  - [x] Comprehensive unit test suite covering linear, branching, diamond, cyclic, self-loop, immutability, and 10,000-node graphs

- [x] **Phase 1.2: Core Resource Model & Persistence**
  - [x] Projects CRUD
  - [x] Workflows CRUD
  - [x] Workflow Versions CRUD (immutable version snapshots)
  - [x] PostgreSQL Flyway migrations
  - [x] Architectural Decision Record (ADR-001): Why DAGs and PostgreSQL as source of truth

- [x] **Phase 1.3: In-Process Scheduler & Concurrency**
  - [x] Ready-task calculation and dependency resolution
  - [x] ExecutorService / thread pool task execution
  - [x] Parallel execution of independent tasks
  - [x] State transitions: PENDING -> RUNNING -> COMPLETED / FAILED
  - [x] Unlocking dependents on prerequisite completion

- [x] **Phase 1.4: Retry Engine & API Endpoints**
  - [x] Fixed delay and exponential backoff with jitter
  - [x] Configurable maximum attempt thresholds
  - [x] Connect React frontend to Spring Boot REST endpoints

- [x] **Phase 1.5: Authentication & Authorization (RBAC)**
  - [x] JWT authentication (login / registration)
  - [x] Secure password hashing (BCrypt)
  - [x] Server-side RBAC (Admin, Developer, Viewer)

---

## Phase 2: Real Workers & Failure Recovery
**Goal:** Move task execution outside API process with real worker failure handling.

- [ ] **Worker Service**
  - [ ] Worker process registration and capability advertisement
  - [ ] Heartbeat mechanism (Redis / PostgreSQL)
  - [ ] Direct task dispatch (HTTP / gRPC)
- [ ] **Lease-Based Execution**
  - [ ] Task lease acquisition with worker ID and expiration
  - [ ] Background lease renewal by active workers
  - [ ] Lease expiration and orphaned task reclamation
- [ ] **Failure Recovery & Dead-Lettering**
  - [ ] Worker crash detection via missed heartbeats
  - [ ] Automatic task reassignment upon lease timeout
  - [ ] Dead-letter state after max retries with audit history
  - [ ] Authorized manual retry triggering in UI
- [ ] **Real-Time Updates & Concurrency**
  - [ ] Server-Sent Events (SSE) or WebSockets for live status updates
  - [ ] Concurrency tests ensuring single-worker lease ownership

---

## Phase 3: Dockerization, Integration Testing & CI
**Goal:** Make system reproducible, testable, and provable on any clean machine.

- [ ] Docker Compose orchestrating frontend, backend, N workers, PostgreSQL, Redis
- [ ] Integration tests using Testcontainers for PostgreSQL and Redis
- [ ] Failure simulation test suite (worker crash, task timeout, network partition)
- [ ] GitHub Actions CI pipeline (lint, unit tests, integration tests, container builds)

---

## Phase 4: Kafka / Event-Driven Core
**Goal:** Durable asynchronous message streaming between scheduler and workers.

- [ ] Kafka topic topology: `task-commands`, `task-results`, `worker-events`, `dead-letter-events`
- [ ] Idempotency keys and duplicate message handling
- [ ] Durable result reconciliation and explicit state transitions
- [ ] ADR-002: Architectural justification for Kafka durability semantics

---

## Phase 5: Observability & Load Testing
**Goal:** Quantifiable evidence of scalability and fault tolerance.

- [ ] Distributed tracing with OpenTelemetry across API, Scheduler, Kafka, and Workers
- [ ] Prometheus metrics (queue depth, task throughput, retry rate, worker utilization, duration)
- [ ] Grafana operational dashboards
- [ ] Load testing with k6 / Gatling (1,000 tasks, N workers, concurrent workflows)
- [ ] Documented empirical latency (P50, P95, P99) and recovery benchmarks

---

## Phase 6: AI Layer (Bounded Assistant)
**Goal:** Intelligent workflow drafting and diagnosis without compromising deterministic execution.

- [ ] Decoupled Python / FastAPI / Pydantic service
- [ ] Feature 1: Natural Language to DAG workflow draft generation (with strict human approval gate)
- [ ] Feature 2: Automated failure analysis from sanitized task logs and stack traces
- [ ] Feature 3: Workflow optimization suggestions from historical telemetry
- [ ] Feature 4: Historical incident search
- [ ] Resilience verification: deterministic core functions seamlessly when AI service is offline

---

## Phase 7: Polish & Cloud Deployment
**Goal:** Multi-scheduler high availability, cloud deployment, and portfolio-grade documentation.

- [ ] Redis-based leader election for multiple active schedulers
- [ ] GCP deployment configuration and infrastructure-as-code
- [ ] Comprehensive documentation (architecture diagrams, sequence diagrams, ER schemas, OpenAPI specs)
- [ ] Reproducible end-to-end demo and video walkthrough

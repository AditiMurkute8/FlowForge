import type { Node, Edge } from '@xyflow/react';
import type {
  Project,
  ProjectStats,
  TaskNodeData,
  TaskType,
  WorkflowDefinition,
} from './types';

/**
 * ============================================================================
 * FLOWFORGE PHASE 0 MOCK DATA STORE
 * ============================================================================
 * Strictly isolated mock data with isMock: true and [Sample Data] labels.
 * Execution engine, real database, and backend services are offline in Phase 0.
 */

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-001',
    name: 'Customer Analytics Ingestion',
    slug: 'customer-analytics-ingestion',
    description: 'High-throughput real-time clickstream processing, event deduplication, and BigQuery warehouse sync.',
    workflowCount: 6,
    lastExecutionAt: '3 mins ago',
    lastExecutionStatus: 'HEALTHY',
    tags: ['Production', 'Data Pipeline', 'GCP'],
    owner: 'alex.rivera@flowforge.internal',
    isMock: true,
    version: 'v2.1.0',
    updatedAt: '2026-10-15T18:20:00Z',
  },
  {
    id: 'proj-002',
    name: 'Order Fulfillment Saga',
    slug: 'order-fulfillment-saga',
    description: 'Distributed transactional saga coordinating inventory reservation, payment gateway charging, and shipping dispatch.',
    workflowCount: 4,
    lastExecutionAt: '12 mins ago',
    lastExecutionStatus: 'HEALTHY',
    tags: ['Production', 'Saga', 'Payments'],
    owner: 'sam.chen@flowforge.internal',
    isMock: true,
    version: 'v1.8.4',
    updatedAt: '2026-10-15T17:45:00Z',
  },
  {
    id: 'proj-003',
    name: 'ML Fraud Detection Pipeline',
    slug: 'ml-fraud-detection-pipeline',
    description: 'Nightly batch feature extraction, model retraining, validation evaluation, and shadow deployment.',
    workflowCount: 5,
    lastExecutionAt: '1 hour ago',
    lastExecutionStatus: 'DEGRADED',
    tags: ['Staging', 'MLOps', 'PyTorch'],
    owner: 'elena.rostova@flowforge.internal',
    isMock: true,
    version: 'v0.9.2',
    updatedAt: '2026-10-15T16:10:00Z',
  },
  {
    id: 'proj-004',
    name: 'Identity & Access Audit Sync',
    slug: 'identity-access-audit-sync',
    description: 'Automated SOC2 compliance verification, IAM policy drift scanner, and Slack alerting bot.',
    workflowCount: 3,
    lastExecutionAt: '6 hours ago',
    lastExecutionStatus: 'HEALTHY',
    tags: ['Internal', 'Security', 'Compliance'],
    owner: 'security-team@flowforge.internal',
    isMock: true,
    version: 'v1.2.0',
    updatedAt: '2026-10-15T11:00:00Z',
  },
];

export const MOCK_STATS: ProjectStats = {
  totalProjects: 4,
  activeWorkflows: 18,
  executions24h: 1420,
  successRatePercent: 99.2,
};

export interface TaskPaletteItem {
  type: TaskType;
  label: string;
  category: 'Network' | 'Compute' | 'Storage' | 'AI & Logic';
  description: string;
  defaultTimeoutMs: number;
  defaultMaxRetries: number;
  iconName: string;
}

export const TASK_PALETTE_ITEMS: TaskPaletteItem[] = [
  {
    type: 'HTTP_REQUEST',
    label: 'HTTP Request',
    category: 'Network',
    description: 'Execute REST, GraphQL, or webhook invocation with retry backoff',
    defaultTimeoutMs: 15000,
    defaultMaxRetries: 3,
    iconName: 'Globe',
  },
  {
    type: 'PYTHON_SCRIPT',
    label: 'Python Script',
    category: 'Compute',
    description: 'Run arbitrary Python script in isolated sandboxed runtime',
    defaultTimeoutMs: 60000,
    defaultMaxRetries: 2,
    iconName: 'Terminal',
  },
  {
    type: 'BASH_COMMAND',
    label: 'Bash Command',
    category: 'Compute',
    description: 'Execute shell commands or container CLI scripts',
    defaultTimeoutMs: 30000,
    defaultMaxRetries: 1,
    iconName: 'Code2',
  },
  {
    type: 'SQL_QUERY',
    label: 'SQL Query',
    category: 'Storage',
    description: 'Execute transactional SQL query or batch warehouse migration',
    defaultTimeoutMs: 45000,
    defaultMaxRetries: 2,
    iconName: 'Database',
  },
  {
    type: 'LLM_PROMPT',
    label: 'LLM Prompt',
    category: 'AI & Logic',
    description: 'Call LLM endpoint for structured reasoning or text processing',
    defaultTimeoutMs: 30000,
    defaultMaxRetries: 2,
    iconName: 'Sparkles',
  },
  {
    type: 'DELAY_WAIT',
    label: 'Delay / Wait',
    category: 'AI & Logic',
    description: 'Pause execution for configured duration or external webhook signal',
    defaultTimeoutMs: 600000,
    defaultMaxRetries: 0,
    iconName: 'Clock',
  },
];

export const INITIAL_DAG_NODES: Node<TaskNodeData>[] = [
  {
    id: 'node-1',
    type: 'customTask',
    position: { x: 40, y: 150 },
    data: {
      label: 'Fetch Clickstream API',
      taskType: 'HTTP_REQUEST',
      timeoutMs: 15000,
      maxRetries: 3,
      parameters: {
        endpoint: 'https://telemetry.flowforge.internal/v1/stream',
        method: 'GET',
        headers: '{"Authorization": "Bearer $TOKEN"}',
      },
      status: 'COMPLETED',
      executionDurationMs: 420,
    },
  },
  {
    id: 'node-2',
    type: 'customTask',
    position: { x: 300, y: 60 },
    data: {
      label: 'Deduplicate & Cleanse',
      taskType: 'PYTHON_SCRIPT',
      timeoutMs: 45000,
      maxRetries: 2,
      parameters: {
        scriptPath: 'scripts/cleanse_events.py',
        runtimeVersion: 'python3.11',
      },
      status: 'COMPLETED',
      executionDurationMs: 1850,
    },
  },
  {
    id: 'node-3',
    type: 'customTask',
    position: { x: 300, y: 240 },
    data: {
      label: 'Verify Schema Hash',
      taskType: 'BASH_COMMAND',
      timeoutMs: 10000,
      maxRetries: 1,
      parameters: {
        command: 'avro-tools compile schema /schemas/event.avsc',
      },
      status: 'COMPLETED',
      executionDurationMs: 610,
    },
  },
  {
    id: 'node-4',
    type: 'customTask',
    position: { x: 560, y: 150 },
    data: {
      label: 'Load to Data Warehouse',
      taskType: 'SQL_QUERY',
      timeoutMs: 60000,
      maxRetries: 3,
      parameters: {
        connection: 'dw-postgres-prod',
        query: 'INSERT INTO raw_events SELECT * FROM staging_events;',
      },
      status: 'IDLE',
    },
  },
];

export const INITIAL_DAG_EDGES: Edge[] = [
  {
    id: 'e1-2',
    source: 'node-1',
    target: 'node-2',
    type: 'smoothstep',
    animated: true,
  },
  {
    id: 'e1-3',
    source: 'node-1',
    target: 'node-3',
    type: 'smoothstep',
    animated: true,
  },
  {
    id: 'e2-4',
    source: 'node-2',
    target: 'node-4',
    type: 'smoothstep',
  },
  {
    id: 'e3-4',
    source: 'node-3',
    target: 'node-4',
    type: 'smoothstep',
  },
];

export const MOCK_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'wf-001',
    projectId: 'proj-001',
    name: 'Clickstream Ingestion & Deduplication',
    version: 'v1.4.0',
    description: 'Polls ingestion buffer, performs sliding-window deduplication, and loads partition to BigQuery.',
    status: 'PUBLISHED',
    updatedAt: '2026-10-15T18:00:00Z',
  },
  {
    id: 'wf-002',
    projectId: 'proj-001',
    name: 'Real-time Anomaly Alerting',
    version: 'v0.8.2',
    description: 'Computes rolling z-score on purchase velocity and dispatches PagerDuty alerts on deviation.',
    status: 'DRAFT',
    updatedAt: '2026-10-15T17:15:00Z',
  },
  {
    id: 'wf-003',
    projectId: 'proj-002',
    name: 'Order Fulfillment Distributed Saga',
    version: 'v2.0.1',
    description: 'Compensating transaction pipeline coordinating payment auth, stock reservation, and courier label dispatch.',
    status: 'PUBLISHED',
    updatedAt: '2026-10-15T16:30:00Z',
  },
];

package com.flowforge.domain;

import com.flowforge.scheduler.TaskState;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * JPA entity representing the execution of an individual task within a WorkflowRun.
 * Mapped to table `task_runs` defined in Flyway V3 migration.
 */
@Entity
@Table(
    name = "task_runs",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_task_runs_workflow_task", columnNames = {"workflow_run_id", "task_id"})
    },
    indexes = {
        @Index(name = "idx_task_runs_workflow_run_id", columnList = "workflow_run_id"),
        @Index(name = "idx_task_runs_lookup", columnList = "workflow_run_id, status")
    }
)
public class TaskRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(
        name = "workflow_run_id",
        nullable = false,
        updatable = false,
        foreignKey = @ForeignKey(name = "fk_task_runs_workflow_run"))
    private WorkflowRun workflowRun;

    @Column(name = "task_id", nullable = false, length = 100, updatable = false)
    private String taskId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private TaskState status = TaskState.PENDING;

    @Column(name = "attempt_count", nullable = false)
    private Integer attemptCount = 1;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "error_message", length = 1000)
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public TaskRun() {
        // Required default JPA constructor
    }

    public TaskRun(WorkflowRun workflowRun, String taskId) {
        this.workflowRun = workflowRun;
        this.taskId = taskId;
        this.status = TaskState.PENDING;
        this.attemptCount = 1;
    }

    public TaskRun(
        UUID id,
        WorkflowRun workflowRun,
        String taskId,
        TaskState status,
        Integer attemptCount,
        Instant startedAt,
        Instant completedAt,
        Long durationMs,
        String errorMessage
    ) {
        this.id = id;
        this.workflowRun = workflowRun;
        this.taskId = taskId;
        this.status = status;
        this.attemptCount = attemptCount != null ? attemptCount : 1;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.durationMs = durationMs;
        this.errorMessage = errorMessage;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public WorkflowRun getWorkflowRun() {
        return workflowRun;
    }

    public void setWorkflowRun(WorkflowRun workflowRun) {
        this.workflowRun = workflowRun;
    }

    public String getTaskId() {
        return taskId;
    }

    public void setTaskId(String taskId) {
        this.taskId = taskId;
    }

    public TaskState getStatus() {
        return status;
    }

    public void setStatus(TaskState status) {
        this.status = status;
    }

    public Integer getAttemptCount() {
        return attemptCount;
    }

    public void setAttemptCount(Integer attemptCount) {
        this.attemptCount = attemptCount;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(Instant completedAt) {
        this.completedAt = completedAt;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(Long durationMs) {
        this.durationMs = durationMs;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TaskRun taskRun = (TaskRun) o;
        return Objects.equals(id, taskRun.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public String toString() {
        return "TaskRun{" +
                "id=" + id +
                ", taskId='" + taskId + '\'' +
                ", status=" + status +
                ", attemptCount=" + attemptCount +
                ", durationMs=" + durationMs +
                ", createdAt=" + createdAt +
                '}';
    }
}

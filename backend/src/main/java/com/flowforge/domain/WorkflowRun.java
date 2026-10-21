package com.flowforge.domain;

import com.flowforge.scheduler.WorkflowRunState;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * JPA entity representing an execution run of a specific WorkflowVersion.
 * Mapped to table `workflow_runs` defined in Flyway V3 migration.
 */
@Entity
@Table(
    name = "workflow_runs",
    indexes = {
        @Index(name = "idx_workflow_runs_version_id", columnList = "workflow_version_id, created_at DESC"),
        @Index(name = "idx_workflow_runs_status", columnList = "status")
    }
)
public class WorkflowRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(
        name = "workflow_version_id",
        nullable = false,
        updatable = false,
        foreignKey = @ForeignKey(name = "fk_workflow_runs_version")
    )
    private WorkflowVersion workflowVersion;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private WorkflowRunState status = WorkflowRunState.PENDING;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "triggered_by", length = 100)
    private String triggeredBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "workflowRun", fetch = FetchType.LAZY)
    private List<TaskRun> taskRuns = new ArrayList<>();

    public WorkflowRun() {
        // Required default JPA constructor
    }

    public WorkflowRun(WorkflowVersion workflowVersion, String triggeredBy) {
        this.workflowVersion = workflowVersion;
        this.triggeredBy = triggeredBy;
        this.status = WorkflowRunState.PENDING;
    }

    public WorkflowRun(
        UUID id,
        WorkflowVersion workflowVersion,
        WorkflowRunState status,
        Instant startedAt,
        Instant completedAt,
        Long durationMs,
        String triggeredBy
    ) {
        this.id = id;
        this.workflowVersion = workflowVersion;
        this.status = status;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.durationMs = durationMs;
        this.triggeredBy = triggeredBy;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public WorkflowVersion getWorkflowVersion() {
        return workflowVersion;
    }

    public void setWorkflowVersion(WorkflowVersion workflowVersion) {
        this.workflowVersion = workflowVersion;
    }

    public WorkflowRunState getStatus() {
        return status;
    }

    public void setStatus(WorkflowRunState status) {
        this.status = status;
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

    public String getTriggeredBy() {
        return triggeredBy;
    }

    public void setTriggeredBy(String triggeredBy) {
        this.triggeredBy = triggeredBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public List<TaskRun> getTaskRuns() {
        return taskRuns;
    }

    public void setTaskRuns(List<TaskRun> taskRuns) {
        this.taskRuns = taskRuns;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        WorkflowRun that = (WorkflowRun) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public String toString() {
        return "WorkflowRun{" +
                "id=" + id +
                ", status=" + status +
                ", startedAt=" + startedAt +
                ", completedAt=" + completedAt +
                ", durationMs=" + durationMs +
                ", triggeredBy='" + triggeredBy + '\'' +
                ", createdAt=" + createdAt +
                '}';
    }
}

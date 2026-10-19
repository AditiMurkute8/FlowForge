package com.flowforge.domain;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * JPA entity representing an immutable workflow version snapshot.
 * Mapped to table `workflow_versions` defined in Flyway V1 migration and protected by V1/V2 triggers.
 * Annotated with `@Immutable` to ensure Hibernate omits dirty-checking and never generates UPDATE statements.
 */
@Entity
@Immutable
@Table(
    name = "workflow_versions",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_workflow_versions_number", columnNames = {"workflow_id", "version_number"})
    },
    indexes = {
        @Index(name = "idx_workflow_versions_lookup", columnList = "workflow_id, version_number DESC")
    }
)
public class WorkflowVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "workflow_id", nullable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_workflow_versions_workflow"))
    private Workflow workflow;

    @Column(name = "version_number", nullable = false, updatable = false)
    private Integer versionNumber;

    @Column(name = "version_tag", length = 30, updatable = false)
    private String versionTag;

    @Column(name = "description", length = 500, updatable = false)
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "graph_payload", nullable = false, updatable = false)
    private JsonNode graphPayload;

    @Column(name = "task_count", nullable = false, updatable = false)
    private Integer taskCount;

    @Column(name = "edge_count", nullable = false, updatable = false)
    private Integer edgeCount;

    @Column(name = "is_valid_dag", nullable = false, updatable = false)
    private Boolean isValidDag;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public WorkflowVersion() {
        // Required default JPA constructor
    }

    public WorkflowVersion(
        Workflow workflow,
        Integer versionNumber,
        String versionTag,
        String description,
        JsonNode graphPayload,
        Integer taskCount,
        Integer edgeCount,
        Boolean isValidDag
    ) {
        this.workflow = workflow;
        this.versionNumber = versionNumber;
        this.versionTag = versionTag;
        this.description = description;
        this.graphPayload = graphPayload;
        this.taskCount = taskCount;
        this.edgeCount = edgeCount;
        this.isValidDag = isValidDag;
    }

    public WorkflowVersion(
        UUID id,
        Workflow workflow,
        Integer versionNumber,
        String versionTag,
        String description,
        JsonNode graphPayload,
        Integer taskCount,
        Integer edgeCount,
        Boolean isValidDag
    ) {
        this.id = id;
        this.workflow = workflow;
        this.versionNumber = versionNumber;
        this.versionTag = versionTag;
        this.description = description;
        this.graphPayload = graphPayload;
        this.taskCount = taskCount;
        this.edgeCount = edgeCount;
        this.isValidDag = isValidDag;
    }

    public UUID getId() {
        return id;
    }

    public Workflow getWorkflow() {
        return workflow;
    }

    public Integer getVersionNumber() {
        return versionNumber;
    }

    public String getVersionTag() {
        return versionTag;
    }

    public String getDescription() {
        return description;
    }

    public JsonNode getGraphPayload() {
        return graphPayload;
    }

    public Integer getTaskCount() {
        return taskCount;
    }

    public Integer getEdgeCount() {
        return edgeCount;
    }

    public Boolean getIsValidDag() {
        return isValidDag;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        WorkflowVersion that = (WorkflowVersion) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    @Override
    public String toString() {
        return "WorkflowVersion{" +
                "id=" + id +
                ", versionNumber=" + versionNumber +
                ", versionTag='" + versionTag + '\'' +
                ", taskCount=" + taskCount +
                ", edgeCount=" + edgeCount +
                ", isValidDag=" + isValidDag +
                ", createdAt=" + createdAt +
                '}';
    }
}

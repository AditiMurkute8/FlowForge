package com.flowforge.api.dto;

import com.flowforge.domain.ProjectMember;
import com.flowforge.domain.ProjectRole;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO exposing safe project member details without sensitive user data.
 */
public record ProjectMemberResponse(
    UUID id,
    UUID projectId,
    UUID userId,
    String email,
    String fullName,
    ProjectRole role,
    Instant createdAt
) {
    public static ProjectMemberResponse fromEntity(ProjectMember member) {
        if (member == null) {
            return null;
        }
        return new ProjectMemberResponse(
            member.getId(),
            member.getProject().getId(),
            member.getUser().getId(),
            member.getUser().getEmail(),
            member.getUser().getFullName(),
            member.getRole(),
            member.getCreatedAt()
        );
    }
}

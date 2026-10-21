package com.flowforge.api.dto;

import com.flowforge.domain.User;

import java.time.Instant;
import java.util.UUID;

public record UserResponse(
    UUID id,
    String email,
    String fullName,
    boolean active,
    Instant createdAt,
    Instant updatedAt
) {
    public static UserResponse fromUser(User user) {
        if (user == null) {
            return null;
        }
        return new UserResponse(
            user.getId(),
            user.getEmail(),
            user.getFullName(),
            user.isActive(),
            user.getCreatedAt(),
            user.getUpdatedAt()
        );
    }
}

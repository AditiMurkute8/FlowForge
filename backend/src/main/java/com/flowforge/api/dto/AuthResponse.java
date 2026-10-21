package com.flowforge.api.dto;

public record AuthResponse(
    String token,
    UserResponse user
) {
}

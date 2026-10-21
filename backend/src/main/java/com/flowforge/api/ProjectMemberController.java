package com.flowforge.api;

import com.flowforge.api.dto.AddProjectMemberRequest;
import com.flowforge.api.dto.ProjectMemberResponse;
import com.flowforge.service.ProjectMemberService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * REST controller for managing project membership and role assignments.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/members")
public class ProjectMemberController {

    private final ProjectMemberService projectMemberService;

    public ProjectMemberController(ProjectMemberService projectMemberService) {
        this.projectMemberService = Objects.requireNonNull(projectMemberService, "ProjectMemberService must not be null");
    }

    @GetMapping
    public ResponseEntity<List<ProjectMemberResponse>> listMembers(@PathVariable UUID projectId) {
        List<ProjectMemberResponse> members = projectMemberService.listMembers(projectId);
        return ResponseEntity.ok(members);
    }

    @PostMapping
    public ResponseEntity<ProjectMemberResponse> addOrUpdateMember(
            @PathVariable UUID projectId,
            @Valid @RequestBody AddProjectMemberRequest request) {
        ProjectMemberResponse response = projectMemberService.addOrUpdateMember(projectId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @DeleteMapping("/{userId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable UUID projectId,
            @PathVariable UUID userId) {
        projectMemberService.removeMember(projectId, userId);
        return ResponseEntity.noContent().build();
    }
}

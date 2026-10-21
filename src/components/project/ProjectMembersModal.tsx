import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ProjectRole,
  ProjectMemberResponseDto,
  AddProjectMemberRequest,
} from '../../types';
import {
  fetchProjectMembers as defaultFetchMembers,
  addOrUpdateProjectMember as defaultAddOrUpdateMember,
  removeProjectMember as defaultRemoveMember,
  FlowForgeApiError,
} from '../../api/flowForgeApi';
import {
  countProjectAdmins,
  canSafelyDemoteOrRemove,
  KNOWN_PROJECT_ROLES,
} from '../../utils/rbacPermissions';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import {
  Users,
  UserPlus,
  ShieldAlert,
  Trash2,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle,
} from 'lucide-react';

export interface ProjectMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  currentUserRole?: ProjectRole | null;
  fetchMembersFn?: typeof defaultFetchMembers;
  addOrUpdateFn?: typeof defaultAddOrUpdateMember;
  removeFn?: typeof defaultRemoveMember;
  onShowToast?: (
    title: string,
    message?: string,
    type?: 'success' | 'info' | 'warning' | 'error'
  ) => void;
}

interface PendingConfirmation {
  type: 'REMOVE' | 'DEMOTE';
  member: ProjectMemberResponseDto;
  targetRole?: ProjectRole;
}

export const ProjectMembersModal: React.FC<ProjectMembersModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  currentUserRole: _currentUserRole,
  fetchMembersFn = defaultFetchMembers,
  addOrUpdateFn = defaultAddOrUpdateMember,
  removeFn = defaultRemoveMember,
  onShowToast,
}) => {
  const [members, setMembers] = useState<ProjectMemberResponseDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Add Member form state
  const [identifier, setIdentifier] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('DEVELOPER');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Confirmation dialog for destructive actions
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);

  // In-flight request guards
  const activeRequestIdRef = useRef<number>(0);
  const isMutatingRef = useRef<boolean>(false);

  const loadMembers = useCallback(async () => {
    if (!isOpen || !projectId) {
      return;
    }

    const currentReqId = ++activeRequestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const fetched = await fetchMembersFn(projectId);
      if (currentReqId !== activeRequestIdRef.current) {
        return;
      }
      setMembers(fetched);
    } catch (err) {
      if (currentReqId !== activeRequestIdRef.current) {
        return;
      }
      setMembers([]);

      if (err instanceof FlowForgeApiError) {
        if (err.isForbidden || err.status === 403) {
          setError('Access denied: Administrator privileges required to manage members.');
        } else if (err.isNotFound || err.status === 404) {
          setError('Project not found or you are not a member of this project.');
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to load project members from server.');
      }
    } finally {
      if (currentReqId === activeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [isOpen, projectId, fetchMembersFn]);

  useEffect(() => {
    if (isOpen) {
      void loadMembers();
      setFormError(null);
      setFormSuccess(null);
      setIdentifier('');
      setSelectedRole('DEVELOPER');
      setConfirmation(null);
    }
  }, [isOpen, loadMembers]);

  const adminCount = countProjectAdmins(members);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMutatingRef.current || isMutating) {
      return;
    }

    const trimmed = identifier.trim();
    if (!trimmed) {
      setFormError('Member email or user ID is required');
      return;
    }

    setFormError(null);
    setFormSuccess(null);
    isMutatingRef.current = true;
    setIsMutating(true);

    const isUuid = /^[0-9a-fA-F-]{36}$/.test(trimmed);
    const request: AddProjectMemberRequest = isUuid
      ? { userId: trimmed, role: selectedRole }
      : { email: trimmed, role: selectedRole };

    try {
      const added = await addOrUpdateFn(projectId, request);
      setIdentifier('');
      setSelectedRole('DEVELOPER');
      setFormSuccess(`Added "${added.fullName || added.email}" with role ${added.role}.`);
      if (onShowToast) {
        onShowToast('Member Added', `Successfully added ${added.email} as ${added.role}.`, 'success');
      }
      await loadMembers();
    } catch (err) {
      let msg = 'Failed to add project member';
      if (err instanceof FlowForgeApiError) {
        if (err.isForbidden || err.status === 403) {
          msg = 'Access denied: Only project administrators can add members.';
        } else if (err.isNotFound || err.status === 404) {
          msg = `User not found: No active account matching "${trimmed}".`;
        } else if (err.isConflict || err.status === 409) {
          msg = 'User is already a member of this project.';
        } else {
          msg = err.message;
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setFormError(msg);
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
    }
  };

  const handleInitiateRoleChange = (member: ProjectMemberResponseDto, newRole: ProjectRole) => {
    if (member.role === newRole) return;

    // Check last-admin demotion safeguard
    if (member.role === 'ADMIN' && newRole !== 'ADMIN') {
      const safeguard = canSafelyDemoteOrRemove(members, member.userId, newRole);
      if (!safeguard.allowed) {
        if (onShowToast) {
          onShowToast('Action Blocked', safeguard.reason, 'warning');
        }
        return;
      }
      // Require explicit confirmation for demoting an administrator
      setConfirmation({
        type: 'DEMOTE',
        member,
        targetRole: newRole,
      });
      return;
    }

    void executeRoleChange(member, newRole);
  };

  const executeRoleChange = async (member: ProjectMemberResponseDto, newRole: ProjectRole) => {
    if (isMutatingRef.current || isMutating) {
      return;
    }

    isMutatingRef.current = true;
    setIsMutating(true);
    setError(null);

    try {
      await addOrUpdateFn(projectId, {
        userId: member.userId,
        role: newRole,
      });
      if (onShowToast) {
        onShowToast('Role Updated', `Changed role for ${member.fullName || member.email} to ${newRole}.`, 'success');
      }
      await loadMembers();
    } catch (err) {
      let msg = 'Failed to update member role';
      if (err instanceof FlowForgeApiError) {
        msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      if (onShowToast) {
        onShowToast('Role Update Failed', msg, 'error');
      }
      setError(msg);
      await loadMembers();
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
      setConfirmation(null);
    }
  };

  const handleInitiateRemoveMember = (member: ProjectMemberResponseDto) => {
    // Check last-admin removal safeguard
    const safeguard = canSafelyDemoteOrRemove(members, member.userId);
    if (!safeguard.allowed) {
      if (onShowToast) {
        onShowToast('Action Blocked', safeguard.reason, 'warning');
      }
      return;
    }

    setConfirmation({
      type: 'REMOVE',
      member,
    });
  };

  const executeRemoveMember = async (member: ProjectMemberResponseDto) => {
    if (isMutatingRef.current || isMutating) {
      return;
    }

    isMutatingRef.current = true;
    setIsMutating(true);
    setError(null);

    try {
      await removeFn(projectId, member.userId);
      if (onShowToast) {
        onShowToast('Member Removed', `Removed ${member.fullName || member.email} from project.`, 'success');
      }
      await loadMembers();
    } catch (err) {
      let msg = 'Failed to remove member';
      if (err instanceof FlowForgeApiError) {
        msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      if (onShowToast) {
        onShowToast('Removal Failed', msg, 'error');
      }
      setError(msg);
      await loadMembers();
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
      setConfirmation(null);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          if (!isMutating) {
            onClose();
          }
        }}
        title="Project Members & Access Control"
        description={`Manage team membership and role permissions for "${projectName}".`}
        maxWidth="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              {members.length} member{members.length === 1 ? '' : 's'} ({adminCount} Admin{adminCount === 1 ? '' : 's'})
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isMutating}
            >
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Safeguard & Policy Banner */}
          <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] p-2.5 text-[11px] text-[var(--text-secondary)] flex items-start gap-2 shadow-xs">
            <Info size={14} className="text-[var(--accent-blue)] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-medium text-[var(--text-primary)]">
                Role Permissions & Safety Constraints:
              </span>
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                <strong>ADMIN:</strong> Project settings, membership, workflows & durable runs.
                <br />
                <strong>DEVELOPER:</strong> Workflow creation, editing, saving & durable runs.
                <br />
                <strong>VIEWER:</strong> Read-only access to DAG topologies and execution logs.
              </p>
              <p className="text-[10px] text-[var(--text-muted)] italic">
                Usability safeguard: FlowForge requires at least one active administrator per project.
              </p>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="rounded-[5px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2.5 text-xs text-[var(--status-red-text)] flex items-center justify-between gap-2 shadow-xs"
              data-testid="members-modal-error-banner"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMembers()}
                disabled={isLoading}
              >
                Retry
              </Button>
            </div>
          )}

          {/* Add Member Section (Admin Only) */}
          <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <UserPlus size={13} className="text-[var(--accent-blue)]" />
                Add Team Member
              </span>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                Admin Privilege
              </span>
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-[4px] border border-[var(--status-red-border)] bg-[var(--status-red-bg)] p-2 text-xs text-[var(--status-red-text)] flex items-center gap-2"
                data-testid="add-member-form-error"
              >
                <AlertTriangle size={13} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div
                role="status"
                className="rounded-[4px] border border-[var(--status-green-border)] bg-[var(--status-green-bg)] p-2 text-xs text-[var(--status-green-text)] flex items-center gap-2"
                data-testid="add-member-form-success"
              >
                <CheckCircle size={13} className="shrink-0" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddMember} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
              <div className="flex-1">
                <Input
                  label="User Email or ID"
                  placeholder="e.g. engineer@flowforge.io"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (formError) setFormError(null);
                    if (formSuccess) setFormSuccess(null);
                  }}
                  disabled={isMutating}
                />
              </div>

              <div className="w-full sm:w-36 space-y-1">
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block">
                  Assigned Role
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as ProjectRole)}
                  disabled={isMutating}
                  className="w-full rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] focus:border-[var(--accent-blue)] transition-colors disabled:opacity-50"
                  data-testid="add-member-role-select"
                >
                  <option value="DEVELOPER">DEVELOPER</option>
                  <option value="VIEWER">VIEWER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>

              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={isMutating || !identifier.trim()}
                isLoading={isMutating}
                icon={<UserPlus size={12} />}
                data-testid="add-member-submit-button"
              >
                Add
              </Button>
            </form>
          </div>

          {/* Members Inventory Table */}
          <div className="rounded-[5px] border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-xs">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] bg-[var(--bg-subsurface)]">
              <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Users size={13} className="text-[var(--text-secondary)]" />
                Current Members ({members.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadMembers()}
                disabled={isLoading}
                icon={<RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />}
              >
                Refresh
              </Button>
            </div>

            {isLoading && members.length === 0 ? (
              <div className="p-8 flex flex-col items-center justify-center gap-2">
                <Loader2 size={20} className="animate-spin text-[var(--accent-blue)]" />
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  Loading project members...
                </span>
              </div>
            ) : members.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                No members found for this project.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)] max-h-72 overflow-y-auto">
                {members.map((member) => {
                  const isSoleAdmin = member.role === 'ADMIN' && adminCount <= 1;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)]/60 transition-colors"
                      data-testid={`member-row-${member.userId}`}
                    >
                      {/* Member Info */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-7 w-7 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center text-xs font-semibold shrink-0 select-none border border-[var(--border-default)]">
                          {member.fullName ? member.fullName.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                              {member.fullName || 'Member'}
                            </span>
                            {isSoleAdmin && (
                              <span title="Sole administrator of project">
                                <Badge variant="warning" size="sm">
                                  Sole Admin
                                </Badge>
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-[var(--text-muted)] truncate block">
                            {member.email}
                          </span>
                        </div>
                      </div>

                      {/* Role Selector & Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={member.role}
                          onChange={(e) =>
                            handleInitiateRoleChange(member, e.target.value as ProjectRole)
                          }
                          disabled={isMutating || isSoleAdmin}
                          title={
                            isSoleAdmin
                              ? 'Sole administrator cannot be demoted'
                              : 'Change member role'
                          }
                          className="rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-subsurface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                          data-testid={`member-role-select-${member.userId}`}
                        >
                          {KNOWN_PROJECT_ROLES.map((r) => (
                            <option
                              key={r}
                              value={r}
                              disabled={isSoleAdmin && r !== 'ADMIN'}
                            >
                              {r}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => handleInitiateRemoveMember(member)}
                          disabled={isMutating || isSoleAdmin}
                          title={
                            isSoleAdmin
                              ? 'Cannot remove the sole administrator of the project'
                              : `Remove ${member.fullName || member.email}`
                          }
                          className="flex items-center justify-center h-6 w-6 rounded text-[var(--text-muted)] hover:text-[var(--status-red-text)] hover:bg-[var(--status-red-bg)]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                          data-testid={`remove-member-button-${member.userId}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Destructive Action Confirmation Modal */}
      {confirmation && (
        <Modal
          isOpen={true}
          onClose={() => {
            if (!isMutating) setConfirmation(null);
          }}
          title={
            confirmation.type === 'REMOVE'
              ? 'Confirm Member Removal'
              : 'Confirm Administrator Demotion'
          }
          description="This action will alter project access permissions immediately."
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmation(null)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (confirmation.type === 'REMOVE') {
                    void executeRemoveMember(confirmation.member);
                  } else if (confirmation.targetRole) {
                    void executeRoleChange(confirmation.member, confirmation.targetRole);
                  }
                }}
                disabled={isMutating}
                isLoading={isMutating}
                data-testid="confirm-destructive-action-button"
              >
                {confirmation.type === 'REMOVE'
                  ? 'Remove Member'
                  : `Demote to ${confirmation.targetRole}`}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="rounded-[5px] border border-[var(--status-yellow-border)] bg-[var(--status-yellow-bg)] p-3 text-xs text-[var(--status-yellow-text)] flex items-start gap-2.5">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {confirmation.type === 'REMOVE'
                    ? `Are you sure you want to remove ${confirmation.member.fullName} (${confirmation.member.email})?`
                    : `Are you sure you want to change ${confirmation.member.fullName}'s role from ADMIN to ${confirmation.targetRole}?`}
                </p>
                <p className="text-[11px] mt-1 text-[var(--status-yellow-text)]/90">
                  {confirmation.type === 'REMOVE'
                    ? 'They will immediately lose all read, write, and execution privileges for this project workspace.'
                    : 'They will immediately lose administrative privileges including member management and project deletion.'}
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

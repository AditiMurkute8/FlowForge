-- FlowForge Phase 1.2: Enforce full deletion immutability on workflow_versions

CREATE OR REPLACE FUNCTION enforce_workflow_version_no_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Workflow versions are immutable and permanent. DELETE operations are forbidden on workflow_versions.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workflow_version_no_delete
BEFORE DELETE ON workflow_versions
FOR EACH ROW
EXECUTE FUNCTION enforce_workflow_version_no_delete();

-- What drizzle-kit cannot express for Postgres: the append-only audit log. Not tracked by
-- drizzle-kit: `pnpm db:generate` neither sees nor removes it.

-- A trigger refuses every update, delete and truncate, so dropping it is a deliberate,
-- visible act rather than a stray statement. Deletes pass only inside
-- `audit_entries_prune`, which sets a transaction-local flag; `audit.pruned` anchors never pass.
CREATE FUNCTION audit_entries_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('manablox.audit_prune', true) = 'on' THEN
    IF OLD.action <> 'audit.pruned' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_entries is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_entries_immutable
  BEFORE UPDATE OR DELETE ON "audit_entries"
  FOR EACH ROW EXECUTE FUNCTION audit_entries_immutable();--> statement-breakpoint
CREATE TRIGGER audit_entries_no_truncate
  BEFORE TRUNCATE ON "audit_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_immutable();--> statement-breakpoint
CREATE FUNCTION audit_entries_prune(ids uuid[]) RETURNS bigint
  SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  removed bigint;
BEGIN
  PERFORM set_config('manablox.audit_prune', 'on', true);
  DELETE FROM audit_entries WHERE id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('manablox.audit_prune', 'off', true);
  RETURN removed;
END;
$$ LANGUAGE plpgsql;

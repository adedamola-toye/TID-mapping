-- Hand-written hardening migration: extensions, search indexes, reference sequences,
-- extra foreign keys and the append-only audit trail.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_agent_name_trgm" ON "requests" USING gin ("agent_name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terminals_serial_trgm" ON "terminals" USING gin ("serial_number" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terminal_mappings_agent_trgm" ON "terminal_mappings" USING gin ("agent_name" gin_trgm_ops);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "request_ref_seq" START 1000;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "import_ref_seq" START 100;
--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_current_mapping_fk" FOREIGN KEY ("current_mapping_id") REFERENCES "terminal_mappings"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_import_batch_fk" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id");
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id");
--> statement-breakpoint
ALTER TABLE "terminal_mappings" ADD CONSTRAINT "terminal_mappings_request_fk" FOREIGN KEY ("request_id") REFERENCES "requests"("id");
--> statement-breakpoint
ALTER TABLE "terminal_mappings" ADD CONSTRAINT "terminal_mappings_version_pos" CHECK ("version" > 0);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_vendor_scope" CHECK (("role" = 'VENDOR_USER') = ("vendor_id" IS NOT NULL));
--> statement-breakpoint
-- Audit trail is append-only: block UPDATE / DELETE / TRUNCATE at the database level.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint
-- Workflow history is also immutable.
CREATE TRIGGER workflow_events_no_update BEFORE UPDATE OR DELETE ON "workflow_events" FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TYPE "public"."exception_reason" AS ENUM('TID_UNAVAILABLE', 'TMS_ERROR', 'ACCOUNT_INVALID', 'DUPLICATE_TERMINAL', 'TERMINAL_NOT_FOUND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('UPLOADED', 'VALIDATED', 'IMPORTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('TERMINAL_STOCK', 'MAPPING', 'REMAPPING');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('PENDING', 'VALID', 'ERROR', 'DUPLICATE', 'IMPORTED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('DRAFT', 'READY_FOR_REVIEW', 'SUBMITTED', 'IN_PROGRESS', 'TREATED', 'EXCEPTION', 'RETURNED', 'CANCELLED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('MAPPING', 'REMAPPING');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'WAKEEL_ADMIN', 'FIELD_SUBMITTER', 'VENDOR_USER');--> statement-breakpoint
CREATE TYPE "public"."terminal_status" AS ENUM('AVAILABLE', 'MAPPING_PENDING', 'MAPPED', 'REMAPPING_PENDING', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"account_enc" text NOT NULL,
	"account_hash" varchar(64) NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"email" varchar(200),
	"phone" varchar(32),
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_email" varchar(200),
	"actor_role" varchar(32),
	"action" varchar(64) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" varchar(64),
	"entity_label" varchar(120),
	"old_value" jsonb,
	"new_value" jsonb,
	"ip" varchar(64),
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" varchar(64),
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(32) NOT NULL,
	"kind" "import_kind" NOT NULL,
	"status" "import_batch_status" DEFAULT 'UPLOADED' NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"sheet_name" varchar(120),
	"headers" jsonb NOT NULL,
	"column_mapping" jsonb,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"imported_by" uuid,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_enc" text NOT NULL,
	"normalized" jsonb,
	"status" "import_row_status" DEFAULT 'PENDING' NOT NULL,
	"errors" jsonb,
	"warnings" jsonb,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"link" varchar(300),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(32) NOT NULL,
	"type" "request_type" NOT NULL,
	"status" "request_status" DEFAULT 'DRAFT' NOT NULL,
	"priority" "request_priority" DEFAULT 'NORMAL' NOT NULL,
	"terminal_id" uuid NOT NULL,
	"serial_number" varchar(40) NOT NULL,
	"tid" varchar(16) NOT NULL,
	"isw_tid" varchar(16),
	"agent_name" varchar(150) NOT NULL,
	"account_enc" text NOT NULL,
	"account_hash" varchar(64) NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"state" varchar(40) NOT NULL,
	"area" varchar(120),
	"anm_id" uuid NOT NULL,
	"anm_name" varchar(150) NOT NULL,
	"previous_mapping_id" uuid,
	"result_mapping_id" uuid,
	"reason" text,
	"internal_comment" text,
	"vendor_id" uuid NOT NULL,
	"batch_id" uuid,
	"created_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"first_submitted_at" timestamp with time zone,
	"vendor_opened_at" timestamp with time zone,
	"vendor_assignee_id" uuid,
	"started_at" timestamp with time zone,
	"treated_by" uuid,
	"treated_at" timestamp with time zone,
	"treatment_comment" text,
	"exception_reason" "exception_reason",
	"exception_comment" text,
	"exception_by" uuid,
	"exception_at" timestamp with time zone,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"returned_by" uuid,
	"returned_at" timestamp with time zone,
	"return_comment" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_token" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_passed" boolean DEFAULT true NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "terminal_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_name" varchar(150) NOT NULL,
	"account_enc" text NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"state" varchar(40) NOT NULL,
	"area" varchar(120),
	"anm_id" uuid NOT NULL,
	"anm_name" varchar(150) NOT NULL,
	"request_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" varchar(40) NOT NULL,
	"tid" varchar(16),
	"isw_tid" varchar(16),
	"vendor_id" uuid,
	"status" "terminal_status" DEFAULT 'AVAILABLE' NOT NULL,
	"current_mapping_id" uuid,
	"mapped_at" timestamp with time zone,
	"last_remapped_at" timestamp with time zone,
	"stock_location" varchar(120),
	"legacy_status" varchar(60),
	"legacy_comment" text,
	"extra_identifiers" jsonb,
	"import_batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(200) NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"vendor_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"contact_email" varchar(200),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"action" varchar(40) NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status",
	"actor_id" uuid,
	"actor_name" varchar(150),
	"actor_role" "user_role",
	"comment" text,
	"details" jsonb,
	"vendor_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_anm_id_anms_id_fk" FOREIGN KEY ("anm_id") REFERENCES "public"."anms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_previous_mapping_id_terminal_mappings_id_fk" FOREIGN KEY ("previous_mapping_id") REFERENCES "public"."terminal_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_result_mapping_id_terminal_mappings_id_fk" FOREIGN KEY ("result_mapping_id") REFERENCES "public"."terminal_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_vendor_assignee_id_users_id_fk" FOREIGN KEY ("vendor_assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_treated_by_users_id_fk" FOREIGN KEY ("treated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_exception_by_users_id_fk" FOREIGN KEY ("exception_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_mappings" ADD CONSTRAINT "terminal_mappings_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_mappings" ADD CONSTRAINT "terminal_mappings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_mappings" ADD CONSTRAINT "terminal_mappings_anm_id_anms_id_fk" FOREIGN KEY ("anm_id") REFERENCES "public"."anms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_account_name_uq" ON "agents" USING btree ("account_hash","name");--> statement-breakpoint
CREATE INDEX "agents_name_idx" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "anms_active_idx" ON "anms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_uq" ON "import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_batch_status_idx" ON "import_rows" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_one_open_per_terminal_uq" ON "requests" USING btree ("terminal_id") WHERE "requests"."status" in ('DRAFT','READY_FOR_REVIEW','SUBMITTED','IN_PROGRESS','EXCEPTION','RETURNED');--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_type_status_idx" ON "requests" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "requests_vendor_status_idx" ON "requests" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "requests_created_by_idx" ON "requests" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "requests_terminal_idx" ON "requests" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "requests_anm_idx" ON "requests" USING btree ("anm_id");--> statement-breakpoint
CREATE INDEX "requests_state_idx" ON "requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "requests_account_hash_idx" ON "requests" USING btree ("account_hash");--> statement-breakpoint
CREATE INDEX "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_submitted_at_idx" ON "requests" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "requests_treated_at_idx" ON "requests" USING btree ("treated_at");--> statement-breakpoint
CREATE INDEX "requests_serial_idx" ON "requests" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "requests_tid_idx" ON "requests" USING btree ("tid");--> statement-breakpoint
CREATE INDEX "requests_batch_idx" ON "requests" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_mappings_version_uq" ON "terminal_mappings" USING btree ("terminal_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_mappings_current_uq" ON "terminal_mappings" USING btree ("terminal_id") WHERE "terminal_mappings"."is_current";--> statement-breakpoint
CREATE INDEX "terminal_mappings_anm_idx" ON "terminal_mappings" USING btree ("anm_id");--> statement-breakpoint
CREATE INDEX "terminal_mappings_state_idx" ON "terminal_mappings" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_serial_uq" ON "terminals" USING btree ("serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_tid_uq" ON "terminals" USING btree ("tid") WHERE "terminals"."tid" is not null;--> statement-breakpoint
CREATE INDEX "terminals_isw_tid_idx" ON "terminals" USING btree ("isw_tid");--> statement-breakpoint
CREATE INDEX "terminals_status_idx" ON "terminals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "workflow_events_request_idx" ON "workflow_events" USING btree ("request_id","created_at");
CREATE TYPE "public"."region" AS ENUM('NORTH_BANK', 'SOUTH_BANK');--> statement-breakpoint
CREATE TABLE "state_regions" (
	"state" varchar(40) PRIMARY KEY NOT NULL,
	"region" "region" NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "state_regions" ADD CONSTRAINT "state_regions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Default split (administrators can reassign any state in the app).
INSERT INTO "state_regions" ("state", "region") VALUES
('Abia','SOUTH_BANK'),
('Adamawa','NORTH_BANK'),
('Akwa Ibom','SOUTH_BANK'),
('Anambra','SOUTH_BANK'),
('Bauchi','NORTH_BANK'),
('Bayelsa','SOUTH_BANK'),
('Benue','NORTH_BANK'),
('Borno','NORTH_BANK'),
('Cross River','SOUTH_BANK'),
('Delta','SOUTH_BANK'),
('Ebonyi','SOUTH_BANK'),
('Edo','SOUTH_BANK'),
('Ekiti','SOUTH_BANK'),
('Enugu','SOUTH_BANK'),
('FCT','NORTH_BANK'),
('Gombe','NORTH_BANK'),
('Imo','SOUTH_BANK'),
('Jigawa','NORTH_BANK'),
('Kaduna','NORTH_BANK'),
('Kano','NORTH_BANK'),
('Katsina','NORTH_BANK'),
('Kebbi','NORTH_BANK'),
('Kogi','NORTH_BANK'),
('Kwara','NORTH_BANK'),
('Lagos','SOUTH_BANK'),
('Nasarawa','NORTH_BANK'),
('Niger','NORTH_BANK'),
('Ogun','SOUTH_BANK'),
('Ondo','SOUTH_BANK'),
('Osun','SOUTH_BANK'),
('Oyo','SOUTH_BANK'),
('Plateau','NORTH_BANK'),
('Rivers','SOUTH_BANK'),
('Sokoto','NORTH_BANK'),
('Taraba','NORTH_BANK'),
('Yobe','NORTH_BANK'),
('Zamfara','NORTH_BANK')
ON CONFLICT ("state") DO NOTHING;

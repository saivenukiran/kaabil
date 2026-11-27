CREATE TABLE "voice_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"lang" text NOT NULL,
	"text_hash" text NOT NULL,
	"message_key" text NOT NULL,
	"text" text NOT NULL,
	"content_type" text NOT NULL,
	"audio" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"recorded_by" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_clips" ADD CONSTRAINT "voice_clips_group_id_care_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."care_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_group_lang_hash_idx" ON "voice_clips" USING btree ("group_id","lang","text_hash");
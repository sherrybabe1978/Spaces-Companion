ALTER TABLE "transcriptions" ADD COLUMN "user_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

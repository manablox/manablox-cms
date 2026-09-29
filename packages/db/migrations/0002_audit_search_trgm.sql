CREATE INDEX "audit_entries_actor_label_trgm_idx" ON "audit_entries" USING gin ("actor_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_entries_target_label_trgm_idx" ON "audit_entries" USING gin ("target_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_entries_action_trgm_idx" ON "audit_entries" USING gin ("action" gin_trgm_ops);
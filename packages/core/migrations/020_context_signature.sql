ALTER TABLE memories ADD COLUMN context_signature TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_context_signature ON memories(context_signature);

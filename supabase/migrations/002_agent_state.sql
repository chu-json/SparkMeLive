-- Add agent_state column to interviews table
-- Persists the SparkMe 3-agent pipeline state across turns:
--   - portrait:           running participant portrait (key-value facts)
--   - coverage:           per-probe coverage notes and status
--   - sessionSummary:     rolling summary of what has been covered
--   - strategicQuestions: last planner output (re-injected next turn)
--   - lastUpdatedTurn:    turn index of last agent state update

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS agent_state jsonb;

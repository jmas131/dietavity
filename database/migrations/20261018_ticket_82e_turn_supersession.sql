-- Ticket 82E: retain superseded inbound turns as durable, terminal audit rows.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_processing_outcome_check,
  ADD CONSTRAINT messages_processing_outcome_check CHECK (
    processing_outcome IS NULL OR processing_outcome IN (
      'historical_completed', 'completed', 'reconciliation', 'superseded'
    )
  );

-- Ticket 10B: synchronize the persisted Sales Engine vocabularies with the
-- current runtime while preserving the existing funnel contract.

BEGIN;

ALTER TABLE public.sales_funnel_events
  DROP CONSTRAINT IF EXISTS sales_funnel_events_buyer_signal_check,
  ADD CONSTRAINT sales_funnel_events_buyer_signal_check CHECK (
    buyer_signal IS NULL OR buyer_signal IN (
      'information_request', 'broad_information_request', 'positive_interest',
      'question', 'objection_price', 'objection_trust', 'objection_timing',
      'deferred_interest', 'explicit_purchase', 'contextual_affirmation',
      'ambiguous_acknowledgement', 'gratitude', 'rejection',
      'ai_value_objection', 'support_issue', 'other'
    )
  ),
  DROP CONSTRAINT IF EXISTS sales_funnel_events_strategy_check,
  ADD CONSTRAINT sales_funnel_events_strategy_check CHECK (
    strategy IS NULL OR strategy IN (
      'direct_purchase', 'purchase_confirmation', 'clarify',
      'answer_question', 'handle_objection', 'discovery', 'show_example',
      'explain_offer', 'deferred', 'reminder', 'graceful_close',
      'acknowledgement', 'conversational', 'answer_objection',
      'broad_information'
    )
  ),
  DROP CONSTRAINT IF EXISTS sales_funnel_events_type_check,
  ADD CONSTRAINT sales_funnel_events_type_check CHECK (
    event_type IN (
      'lead_started', 'meaningful_engagement', 'offer_presented',
      'purchase_intent', 'checkout_sent', 'purchase_completed',
      'setup_completed', 'program_ready', 'price_question',
      'payment_method_question', 'timing_objection', 'price_objection',
      'trust_objection', 'health_question', 'deferred_interest',
      'reminder_requested', 'reminder_sent', 'rejection',
      'ai_value_objection'
    )
  );

COMMIT;

'use strict';

const { fullyAcceptedSql } = require('./logical-reply');

const turnAnchorId = "COALESCE(NULLIF(inbound.metadata->>'turn_anchor_id', '')::uuid, inbound.id)";

const ERROR_HANDLER_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), released_claims AS (
  UPDATE public.messages AS inbound
  SET processing_owner = NULL,
      processing_lease_until = NULL,
      processing_completed_at = CASE
        WHEN ${fullyAcceptedSql(turnAnchorId)} THEN NOW()
        ELSE NULL
      END,
      processing_outcome = CASE
        WHEN EXISTS (SELECT 1 FROM public.messages AS outbound WHERE outbound.in_reply_to_id = ${turnAnchorId} AND outbound.direction = 'outbound')
          THEN 'reconciliation'
        ELSE NULL
      END,
      metadata = inbound.metadata || jsonb_build_object(
        'session_ordering_state', CASE
          WHEN EXISTS (SELECT 1 FROM public.messages AS outbound WHERE outbound.in_reply_to_id = ${turnAnchorId} AND outbound.direction = 'outbound')
            THEN 'reconciliation'
          ELSE 'queued'
        END,
        'claim_released_by_error_handler_at', NOW()
      )
  FROM input
  WHERE inbound.direction = 'inbound'
    AND inbound.processing_order IS NOT NULL
    AND inbound.processing_completed_at IS NULL
    AND inbound.processing_owner = input.payload->>'execution_id'
  RETURNING inbound.session_id, inbound.processing_outcome
), reset_commercial_context AS (
  UPDATE public.onboarding_sessions AS session
  SET last_question_type = NULL, last_question_at = NULL,
      commercial_context_expires_at = NULL, checkout_authorization_type = NULL,
      checkout_authorized_at = NULL, updated_at = NOW()
  WHERE session.session_id IN (SELECT session_id FROM released_claims WHERE processing_outcome = 'reconciliation')
  RETURNING session.session_id
)
INSERT INTO public.logs (event, severity, error_message, error_context)
SELECT 'global_workflow_error', 'error',
  LEFT(COALESCE(input.payload->>'error_message', 'Unknown workflow error'), 500),
  jsonb_strip_nulls(jsonb_build_object(
    'workflow', NULLIF(input.payload->>'workflow', ''),
    'workflow_id', NULLIF(input.payload->>'workflow_id', ''),
    'lastNodeExecuted', NULLIF(input.payload->>'last_node_executed', ''),
    'execution_id', NULLIF(input.payload->>'execution_id', ''),
    'execution_url', NULLIF(input.payload->>'execution_url', ''),
    'session_claims_released', (SELECT COUNT(*) FROM released_claims),
    'commercial_contexts_reset', (SELECT COUNT(*) FROM reset_commercial_context)
  ))
FROM input;`;

module.exports = { ERROR_HANDLER_SQL };

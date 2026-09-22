-- Ticket 9 read-only preflight. Run and retain the output before migration.
WITH message_summary AS (
  SELECT
    count(*) AS total_messages,
    count(*) FILTER (WHERE direction = 'inbound') AS inbound_messages,
    count(*) FILTER (WHERE direction = 'outbound') AS outbound_messages,
    count(*) FILTER (WHERE user_id IS NULL) AS missing_user_id,
    count(*) FILTER (
      WHERE CASE
        WHEN direction = 'inbound' THEN NULLIF(user_message, '')
        WHEN direction = 'outbound' THEN NULLIF(assistant_response, '')
      END IS NULL
    ) AS missing_reconstructable_body,
    count(*) FILTER (WHERE user_id IS NOT NULL) AS messages_linked_to_users,
    count(*) FILTER (
      WHERE NULLIF(to_jsonb(message)->>'provider_message_sid', '') IS NOT NULL
    ) AS existing_provider_sid_values
  FROM public.messages AS message
), duplicate_legacy_candidates AS (
  SELECT count(*) AS duplicate_candidate_groups
  FROM (
    SELECT user_id, direction, "timestamp", user_message, assistant_response
    FROM public.messages
    GROUP BY user_id, direction, "timestamp", user_message, assistant_response
    HAVING count(*) > 1
  ) AS duplicates
), schema_state AS (
  SELECT
    count(*) FILTER (WHERE column_name = 'provider_message_sid') AS provider_sid_column_exists,
    count(*) FILTER (WHERE column_name = 'idempotency_key') AS idempotency_key_column_exists,
    count(*) FILTER (WHERE column_name = 'body') AS body_column_exists,
    count(*) FILTER (WHERE column_name = 'session_id') AS session_id_column_exists
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'messages'
), legacy_blockers AS (
  SELECT jsonb_build_object(
    'messages_table_exists', to_regclass('public.messages') IS NOT NULL,
    'users_table_exists', to_regclass('public.users') IS NOT NULL,
    'direction_values_valid', NOT EXISTS (
      SELECT 1 FROM public.messages WHERE direction NOT IN ('inbound', 'outbound')
    ),
    'message_ids_unique', NOT EXISTS (
      SELECT 1 FROM public.messages GROUP BY id HAVING count(*) > 1
    )
  ) AS checks
)
SELECT
  message_summary.*,
  duplicate_legacy_candidates.duplicate_candidate_groups,
  schema_state.*,
  legacy_blockers.checks AS legacy_schema_checks
FROM message_summary
CROSS JOIN duplicate_legacy_candidates
CROSS JOIN schema_state
CROSS JOIN legacy_blockers;

-- If a prior/partial Ticket 9 migration already added provider_message_sid,
-- run this additional read-only query before retrying the migration:
-- SELECT provider, provider_message_sid, count(*)
-- FROM public.messages
-- WHERE provider_message_sid IS NOT NULL
-- GROUP BY provider, provider_message_sid
-- HAVING count(*) > 1;

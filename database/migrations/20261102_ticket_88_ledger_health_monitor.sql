-- Ticket 88: independent, privacy-safe ledger health alerts. The monitor's
-- public.messages query is SELECT-only; this table only coordinates alerts.
BEGIN;

CREATE TABLE public.ledger_health_alerts (
  alert_key text PRIMARY KEY,
  inbound_message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE RESTRICT,
  category text NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  last_alerted_at timestamptz,
  reservation_token uuid,
  reservation_expires_at timestamptz,
  delivery_count integer NOT NULL DEFAULT 0,
  CONSTRAINT ledger_health_alerts_category_check CHECK (category IN ('operator_required', 'missing_lease_expiration', 'expired_lease', 'stale_unclaimed_head')),
  CONSTRAINT ledger_health_alerts_key_check CHECK (alert_key = inbound_message_id::text || ':' || category),
  CONSTRAINT ledger_health_alerts_reservation_check CHECK (
    (reservation_token IS NULL AND reservation_expires_at IS NULL)
    OR (reservation_token IS NOT NULL AND reservation_expires_at IS NOT NULL)
  ),
  CONSTRAINT ledger_health_alerts_delivery_count_check CHECK (delivery_count >= 0)
);

ALTER TABLE public.ledger_health_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_health_alerts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ledger_health_alerts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_ledger_health_alert(p jsonb)
RETURNS TABLE (alert_key text, reservation_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  target_key text;
  target_inbound_id uuid;
  target_category text;
  row public.ledger_health_alerts%ROWTYPE;
  token uuid;
BEGIN
  IF jsonb_typeof(p) <> 'object'
     OR NOT (p ?& ARRAY['inbound_message_id', 'category'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) AS supplied(key)
                WHERE supplied.key NOT IN ('inbound_message_id', 'category'))
     OR p->>'inbound_message_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p->>'category' NOT IN ('operator_required', 'missing_lease_expiration', 'expired_lease', 'stale_unclaimed_head') THEN
    RAISE EXCEPTION 'LEDGER_HEALTH_ALERT_INVALID';
  END IF;
  target_inbound_id := (p->>'inbound_message_id')::uuid;
  target_category := p->>'category';
  target_key := target_inbound_id::text || ':' || target_category;
  INSERT INTO public.ledger_health_alerts (alert_key, inbound_message_id, category)
  VALUES (target_key, target_inbound_id, target_category)
  ON CONFLICT (alert_key) DO NOTHING;
  SELECT * INTO row FROM public.ledger_health_alerts WHERE ledger_health_alerts.alert_key = target_key FOR UPDATE;
  UPDATE public.ledger_health_alerts SET last_detected_at = now() WHERE ledger_health_alerts.alert_key = target_key;
  IF (row.reservation_expires_at IS NOT NULL AND row.reservation_expires_at > now())
     OR (row.last_alerted_at IS NOT NULL AND row.last_alerted_at > now() - interval '60 minutes') THEN
    RETURN;
  END IF;
  token := gen_random_uuid();
  UPDATE public.ledger_health_alerts
  SET reservation_token = token, reservation_expires_at = now() + interval '10 minutes'
  WHERE ledger_health_alerts.alert_key = target_key;
  RETURN QUERY SELECT target_key, token;
END;
$$;

CREATE FUNCTION public.confirm_ledger_health_alert_delivery(p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF jsonb_typeof(p) <> 'object'
     OR NOT (p ?& ARRAY['alert_key', 'reservation_token'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) AS supplied(key)
                WHERE supplied.key NOT IN ('alert_key', 'reservation_token'))
     OR NULLIF(btrim(p->>'alert_key'), '') IS NULL
     OR p->>'reservation_token' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'LEDGER_HEALTH_ALERT_CONFIRM_INVALID';
  END IF;
  UPDATE public.ledger_health_alerts
  SET last_alerted_at = now(), reservation_token = NULL, reservation_expires_at = NULL,
      delivery_count = delivery_count + 1
  WHERE alert_key = p->>'alert_key'
    AND reservation_token = (p->>'reservation_token')::uuid
    AND reservation_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_HEALTH_ALERT_RESERVATION_LOST'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ledger_health_alert(jsonb), public.confirm_ledger_health_alert_delivery(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ledger_health_alert(jsonb), public.confirm_ledger_health_alert_delivery(jsonb) TO service_role;
COMMENT ON TABLE public.ledger_health_alerts IS 'Ticket 88 alert reservation and confirmed-delivery deduplication only; never a message-processing queue.';
COMMENT ON FUNCTION public.reserve_ledger_health_alert(jsonb) IS 'Reserves one privacy-safe ledger-health email; abandoned reservations expire after ten minutes.';
COMMENT ON FUNCTION public.confirm_ledger_health_alert_delivery(jsonb) IS 'Starts Ticket 88 deduplication only after n8n email send succeeds.';

COMMIT;

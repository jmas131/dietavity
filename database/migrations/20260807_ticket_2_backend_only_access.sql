-- Ticket 2: make Dietavity application data backend-only.
--
-- DEPLOYMENT GATE:
-- Apply only after n8n credential B3vHRjTvOwuRSoIw ("Supabase account")
-- has been confirmed to use a service-role/trusted backend key and the updated
-- Global Error Handler has been imported with SUPABASE_SERVICE_ROLE_KEY set.
-- The repository export intentionally does not contain n8n credential secrets,
-- so this prerequisite must be verified in the target n8n instance.

BEGIN;

-- Every current public application table contains backend-only customer,
-- payment, nutrition, onboarding, program-state, or internal operational data.
REVOKE ALL ON TABLE
  public.users,
  public.profiles,
  public.programs,
  public.weeks,
  public.meal_plans,
  public.purchases,
  public.messages,
  public.onboarding_chat_memory,
  public.onboarding_sessions,
  public.logs,
  public.unsubscribed_metrics,
  public.shopping_lists,
  public.shopping_items,
  public.subscriptions
FROM anon, authenticated;

-- Make the trusted REST path explicit instead of relying only on historical
-- grants. Direct PostgreSQL owner/admin roles are not changed by this block.
GRANT ALL ON TABLE
  public.users,
  public.profiles,
  public.programs,
  public.weeks,
  public.meal_plans,
  public.purchases,
  public.messages,
  public.onboarding_chat_memory,
  public.onboarding_sessions,
  public.logs,
  public.unsubscribed_metrics,
  public.shopping_lists,
  public.shopping_items,
  public.subscriptions
TO service_role;

-- Remove the historical allow-all API policies. With no replacement policies,
-- RLS remains deny-by-default for non-bypass roles even if a table grant is
-- accidentally reintroduced later.
DROP POLICY IF EXISTS error_logs ON public.logs;
DROP POLICY IF EXISTS messages ON public.messages;
DROP POLICY IF EXISTS metrics ON public.unsubscribed_metrics;
DROP POLICY IF EXISTS onboarding ON public.onboarding_chat_memory;
DROP POLICY IF EXISTS policy_meal_plans ON public.meal_plans;
DROP POLICY IF EXISTS policy_users ON public.users;
DROP POLICY IF EXISTS subscriptions ON public.subscriptions;

-- Preserve/enable the second layer of protection on every backend-only table.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_chat_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unsubscribed_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Trigger helpers and the state-changing program-start RPC are not public API.
-- Trigger execution does not require callers to have EXECUTE on the trigger
-- function. The service role's existing privileges are intentionally untouched.
REVOKE ALL ON FUNCTION public.set_updated_at()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.start_program_week_one(uuid, uuid, date, date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION
  public.start_program_week_one(uuid, uuid, date, date)
TO service_role;

-- Avoid silently recreating the same exposure on future postgres-owned public
-- objects. These statements do not alter service_role, owner, or admin access.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;

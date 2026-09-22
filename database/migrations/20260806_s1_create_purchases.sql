BEGIN;

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    program_id uuid,
    stripe_checkout_session_id text NOT NULL,
    stripe_payment_intent_id text,
    stripe_customer_id text,
    stripe_product_id text,
    stripe_price_id text NOT NULL,
    purchase_type text DEFAULT '28_day_program'::text NOT NULL,
    payment_status text NOT NULL,
    amount_total integer NOT NULL,
    currency text DEFAULT 'mxn'::text NOT NULL,
    purchased_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT purchases_pkey PRIMARY KEY (id),
    CONSTRAINT purchases_checkout_session_key UNIQUE (stripe_checkout_session_id),
    CONSTRAINT purchases_payment_intent_key UNIQUE (stripe_payment_intent_id),
    CONSTRAINT purchases_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
    CONSTRAINT purchases_program_id_fkey
        FOREIGN KEY (program_id) REFERENCES public.programs(id) ON DELETE SET NULL,
    CONSTRAINT purchases_purchase_type_check
        CHECK (purchase_type = '28_day_program'::text),
    CONSTRAINT purchases_payment_status_check
        CHECK (payment_status = ANY (ARRAY[
            'unpaid'::text,
            'paid'::text,
            'failed'::text,
            'refunded'::text,
            'partially_refunded'::text
        ])),
    CONSTRAINT purchases_amount_total_check CHECK (amount_total >= 0),
    CONSTRAINT purchases_currency_check CHECK (currency = lower(currency))
);

CREATE INDEX purchases_user_id_idx
    ON public.purchases USING btree (user_id);

CREATE INDEX purchases_program_id_idx
    ON public.purchases USING btree (program_id);

CREATE INDEX purchases_created_at_idx
    ON public.purchases USING btree (created_at DESC);

CREATE INDEX purchases_payment_status_idx
    ON public.purchases USING btree (payment_status);

CREATE TRIGGER purchases_set_updated_at
    BEFORE UPDATE ON public.purchases
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMIT;

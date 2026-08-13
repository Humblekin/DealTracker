-- ============================================
-- Paystack Migration
-- Adds Paystack columns to deals, payments, and
-- merchant_transactions. Additive — preserves all
-- existing data. Moolre columns are dropped after
-- backfilling their values into the Paystack columns.
-- ============================================

-- ---- DEALS ----
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'INITIALIZED'
  CHECK (payment_status IN (
    'INITIALIZED', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED'
  ));

-- Backfill paystack_reference from the legacy moolre_reference (historical data)
UPDATE public.deals SET paystack_reference = moolre_reference
  WHERE moolre_reference IS NOT NULL AND paystack_reference IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_paystack_reference ON public.deals(paystack_reference);

-- ---- PAYMENTS ----
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paystack_status TEXT;

UPDATE public.payments SET paystack_reference = moolre_reference
  WHERE moolre_reference IS NOT NULL AND paystack_reference IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_paystack_reference ON public.payments(paystack_reference);

-- ---- MERCHANT TRANSACTIONS ----
ALTER TABLE public.merchant_transactions ADD COLUMN IF NOT EXISTS payment_url TEXT;
ALTER TABLE public.merchant_transactions ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

UPDATE public.merchant_transactions SET payment_url = moolre_payment_url
  WHERE moolre_payment_url IS NOT NULL AND payment_url IS NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_transactions_paystack_reference ON public.merchant_transactions(paystack_reference);

-- ---- DROP LEGACY MOOLRE COLUMNS ----
ALTER TABLE public.deals DROP COLUMN IF EXISTS moolre_reference;
ALTER TABLE public.payments DROP COLUMN IF EXISTS moolre_reference;
ALTER TABLE public.merchant_transactions DROP COLUMN IF EXISTS moolre_payment_url;

-- ---- PROFILES ----
-- Paystack transfer recipient codes are cached here so payouts can reuse
-- them instead of creating a new recipient per payout.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS recipient_code TEXT;

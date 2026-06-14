-- Add status column to merchants for application flow
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED'));

-- Allow public INSERT for merchant applications (service role or anon)
-- We'll use a dedicated edge function that uses service role, so the existing
-- admin-only INSERT policy remains. This migration adds a separate policy
-- for the edge function flow.

-- For the merchant-apply edge function (uses service role, bypasses RLS),
-- no additional policy is needed since service-role bypasses RLS entirely.

-- Allow admins to filter by status
CREATE INDEX IF NOT EXISTS idx_merchants_status ON public.merchants(status);

-- Update existing merchants to ACTIVE
UPDATE public.merchants SET status = 'ACTIVE' WHERE status = 'PENDING' AND is_active = TRUE;

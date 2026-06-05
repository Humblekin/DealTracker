-- ============================================
-- SecureTrade – Supabase Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. PROFILES TABLE (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
  wallet_balance DECIMAL(12,2) DEFAULT 0,
  phone TEXT,
  network TEXT CHECK (network IN ('mtn', 'vodafone', 'tigo')),
  recipient_code TEXT,
  is_flagged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DEALS TABLE
CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  buyer_id UUID NOT NULL REFERENCES public.profiles(id),
  seller_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN (
    'PENDING_PAYMENT', 'IN_ESCROW', 'COMPLETED',
    'DISPUTE_OPEN', 'REFUNDED'
  )),
  fee_breakdown JSONB,
  payment_reference TEXT,
  moolre_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id),
  moolre_reference TEXT,
  amount DECIMAL(12,2) NOT NULL,
  fee_breakdown JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. DISPUTES TABLE
CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id),
  opened_by UUID REFERENCES public.profiles(id),
  reason TEXT NOT NULL,
  evidence TEXT[],
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'CLOSED')),
  admin_decision TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  deal_id UUID REFERENCES public.deals(id),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. AUDIT LOGS TABLE (immutable)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.deals(id),
  action TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'buyer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- AUTO-UPDATE updated_at TIMESTAMP
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- PROFILES POLICIES ----
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- ---- DEALS POLICIES ----
CREATE POLICY "Users can view own deals" ON public.deals
  FOR SELECT USING (
    auth.uid() = buyer_id OR
    auth.uid() = seller_id OR
    public.get_user_role() = 'admin'
  );

CREATE POLICY "Buyers can create deals" ON public.deals
  FOR INSERT WITH CHECK (
    auth.uid() = buyer_id AND
    public.get_user_role() IN ('buyer', 'admin')
  );

CREATE POLICY "Authorized users can update deals" ON public.deals
  FOR UPDATE USING (
    auth.uid() = buyer_id OR
    auth.uid() = seller_id OR
    public.get_user_role() = 'admin'
  );

-- ⚠️ STATUS TRANSITIONS are enforced by Edge Functions (service role key).
-- The frontend can only update deals via edge functions for critical transitions:
--   PENDING_PAYMENT → IN_ESCROW (moolre-webhook, system)
--   IN_ESCROW → COMPLETED (confirm-delivery, auto payout)
--   IN_ESCROW → DISPUTE_OPEN (frontend via RLS)
--   DISPUTE_OPEN → REFUNDED (admin only via RLS)
-- The service role key bypasses RLS, so edge functions can perform any transition.

-- ---- PAYMENTS POLICIES ----
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = payments.deal_id
      AND (deals.buyer_id = auth.uid() OR deals.seller_id = auth.uid())
    ) OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Buyers can insert payments" ON public.payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = deal_id AND deals.buyer_id = auth.uid()
    ) OR public.get_user_role() = 'admin'
  );

-- ---- DISPUTES POLICIES ----
CREATE POLICY "Users can view own disputes" ON public.disputes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = disputes.deal_id
      AND (deals.buyer_id = auth.uid() OR deals.seller_id = auth.uid())
    ) OR public.get_user_role() = 'admin'
  );

CREATE POLICY "Users can create disputes" ON public.disputes
  FOR INSERT WITH CHECK (
    auth.uid() = opened_by
  );

CREATE POLICY "Admins can update disputes" ON public.disputes
  FOR UPDATE USING (
    public.get_user_role() = 'admin'
  );

-- ---- NOTIFICATIONS POLICIES ----
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ---- AUDIT LOGS POLICIES ----
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
  FOR SELECT USING (
    public.get_user_role() = 'admin' OR
    EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = audit_logs.deal_id
      AND (deals.buyer_id = auth.uid() OR deals.seller_id = auth.uid())
    )
  );

CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- Prevent updates/deletes on audit logs (immutable)
CREATE POLICY "No updates on audit logs" ON public.audit_logs
  FOR UPDATE USING (false);

CREATE POLICY "No deletes on audit logs" ON public.audit_logs
  FOR DELETE USING (false);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_deals_buyer ON public.deals(buyer_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON public.deals(seller_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON public.deals(status);
CREATE INDEX IF NOT EXISTS idx_payments_deal ON public.payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_disputes_deal ON public.disputes(deal_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_deal ON public.audit_logs(deal_id);

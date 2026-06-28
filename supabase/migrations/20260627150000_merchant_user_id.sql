-- Add missing user_id column to merchants table
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Add updated_at column if missing
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- RLS policies for merchants (created if not already present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can view merchants') THEN
    CREATE POLICY "Admins can view merchants" ON public.merchants
      FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Merchants can view own') THEN
    CREATE POLICY "Merchants can view own" ON public.merchants
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can insert merchants') THEN
    CREATE POLICY "Admins can insert merchants" ON public.merchants
      FOR INSERT WITH CHECK (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can update merchants') THEN
    CREATE POLICY "Admins can update merchants" ON public.merchants
      FOR UPDATE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Merchants can update own') THEN
    CREATE POLICY "Merchants can update own" ON public.merchants
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'Admins can delete merchants') THEN
    CREATE POLICY "Admins can delete merchants" ON public.merchants
      FOR DELETE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

-- API Key policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can view API keys') THEN
    CREATE POLICY "Admins can view API keys" ON public.merchant_api_keys
      FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Merchants can view own API keys') THEN
    CREATE POLICY "Merchants can view own API keys" ON public.merchant_api_keys
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.merchants
          WHERE merchants.id = merchant_api_keys.merchant_id
          AND merchants.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can manage API keys') THEN
    CREATE POLICY "Admins can manage API keys" ON public.merchant_api_keys
      FOR INSERT WITH CHECK (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can update API keys') THEN
    CREATE POLICY "Admins can update API keys" ON public.merchant_api_keys
      FOR UPDATE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_api_keys' AND policyname = 'Admins can delete API keys') THEN
    CREATE POLICY "Admins can delete API keys" ON public.merchant_api_keys
      FOR DELETE USING (public.get_user_role() = 'admin');
  END IF;
END $$;

-- Transaction & webhook log policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_transactions' AND policyname = 'Admins can view merchant transactions') THEN
    CREATE POLICY "Admins can view merchant transactions" ON public.merchant_transactions
      FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_webhook_logs' AND policyname = 'Admins can view webhook logs') THEN
    CREATE POLICY "Admins can view webhook logs" ON public.merchant_webhook_logs
      FOR SELECT USING (public.get_user_role() = 'admin');
  END IF;
END $$;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS update_merchants_updated_at ON public.merchants;
CREATE TRIGGER update_merchants_updated_at BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Index
CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON public.merchants(user_id);

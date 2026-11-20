-- ============================================================================
-- Migration: 20261119010000_fix-privilege-escalation.sql
-- Purpose: Fix administrator privilege escalation vulnerabilities in the profiles table.
--
-- Vulnerabilities addressed:
--   1. handle_new_user() trusted raw_user_meta_data->>'role', allowing attackers to
--      assign themselves role='admin' at signup.
--   2. The "Users can update own profile" RLS policy allowed users to update any column,
--      including `role`, enabling instant privilege escalation via client update.
--   3. The "Users can create own profile" INSERT policy allowed users to INSERT a profile
--      row with role='admin'.
--
-- Defense-in-depth Strategy:
--   1. Helper function `is_service_role()`: accurately detects trusted server-side execution.
--   2. Hardened `handle_new_user()` trigger: always assigns safe default 'buyer'.
--   3. BEFORE UPDATE trigger `enforce_role_protection`: rejects any client attempts
--      to modify `role`, `wallet_balance`, `is_flagged`, or `recipient_code`.
--   4. BEFORE INSERT trigger `enforce_role_on_insert`: forces role='buyer' for non-service-role.
--   5. Recreated RLS update policy with explicit WITH CHECK.
-- ============================================================================

-- 1. Helper function to safely detect service_role / server-side administrative execution
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    current_user IN ('service_role', 'postgres', 'supabase_admin')
    OR coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role'
    OR coalesce(nullif(current_setting('role', true), ''), '') = 'service_role'
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.is_service_role() IS
  'Returns true if the current execution context is the trusted service_role or database admin.';

-- 2. Hardened handle_new_user() — safe default role assigned by backend; client metadata role ignored
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NEW.email,
    'buyer'  -- HARDCODED: never trust client-supplied role from signup metadata
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a profile row for new users. Role is always hardcoded to buyer to prevent privilege escalation via signup metadata.';

-- 3. BEFORE UPDATE trigger function — protect system-managed columns
CREATE OR REPLACE FUNCTION public.enforce_role_protection()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role (used by trusted edge functions / server-side administrative operations) bypasses guards
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Block any non-service-role attempt to modify sensitive columns
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Unauthorized: Role modification requires a trusted server-side administrative process';
  END IF;

  IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
    RAISE EXCEPTION 'Unauthorized: wallet_balance cannot be modified directly';
  END IF;

  IF NEW.is_flagged IS DISTINCT FROM OLD.is_flagged THEN
    RAISE EXCEPTION 'Unauthorized: is_flagged cannot be modified directly';
  END IF;

  IF NEW.recipient_code IS DISTINCT FROM OLD.recipient_code THEN
    RAISE EXCEPTION 'Unauthorized: recipient_code cannot be modified directly';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_role_protection ON public.profiles;
CREATE TRIGGER enforce_role_protection
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_protection();

-- 4. BEFORE INSERT trigger function — force role='buyer' for non-service-role callers
CREATE OR REPLACE FUNCTION public.enforce_role_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role can insert any role
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Force safe default role and system-managed defaults for all non-service-role callers
  NEW.role := 'buyer';
  NEW.wallet_balance := 0;
  NEW.is_flagged := FALSE;
  NEW.recipient_code := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_role_on_insert ON public.profiles;
CREATE TRIGGER enforce_role_on_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_on_insert();

-- 5. Recreate "Users can update own profile" policy with WITH CHECK
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Note: "Admins can update any profile" policy remains intact for general user fields.
-- Role modifications must be executed via the server-side admin-update-role edge function.

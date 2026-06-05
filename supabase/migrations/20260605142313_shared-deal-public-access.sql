CREATE POLICY "Anyone can view shared deals" ON public.deals
  FOR SELECT USING (share_token IS NOT NULL);

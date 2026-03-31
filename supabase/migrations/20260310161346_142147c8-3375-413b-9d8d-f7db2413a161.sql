
-- Create the backups storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service role full access (edge function uses service role)
-- No public access needed
CREATE POLICY "Service role manages backups" ON storage.objects
  FOR ALL
  USING (bucket_id = 'backups')
  WITH CHECK (bucket_id = 'backups');

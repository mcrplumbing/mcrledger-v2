
CREATE TABLE public.user_page_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, page_key)
);

ALTER TABLE public.user_page_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all permissions"
  ON public.user_page_permissions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can read own permissions"
  ON public.user_page_permissions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

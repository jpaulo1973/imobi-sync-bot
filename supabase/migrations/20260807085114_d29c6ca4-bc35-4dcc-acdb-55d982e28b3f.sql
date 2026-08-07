CREATE TABLE public.match_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pair_key text NOT NULL,
  buyer_source text NOT NULL,
  buyer_ref uuid NOT NULL,
  property_id uuid NOT NULL,
  buyer_label text,
  property_label text,
  score integer NOT NULL DEFAULT 0,
  reason_summary text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_notifications_pair_unique UNIQUE (user_id, pair_key)
);

CREATE INDEX match_notifications_user_created_idx ON public.match_notifications (user_id, created_at DESC);
CREATE INDEX match_notifications_unread_idx ON public.match_notifications (user_id) WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_notifications TO authenticated;
GRANT ALL ON public.match_notifications TO service_role;

ALTER TABLE public.match_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own match notifications"
ON public.match_notifications
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
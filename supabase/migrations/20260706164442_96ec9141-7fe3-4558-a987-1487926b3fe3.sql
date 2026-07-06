ALTER TABLE public.buyer_clients REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.buyer_clients;
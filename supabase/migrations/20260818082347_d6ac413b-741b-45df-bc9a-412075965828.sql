-- Novas contas ficam sem acesso até um administrador as ativar
ALTER TABLE public.profiles ALTER COLUMN ativo SET DEFAULT false;

-- Impede que um utilizador ative a sua própria conta (só admin pode mexer em `ativo`)
CREATE OR REPLACE FUNCTION public.profiles_guard_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ativo IS TRUE AND NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.ativo := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.ativo IS DISTINCT FROM OLD.ativo
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.ativo := OLD.ativo;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_ativo_ins ON public.profiles;
CREATE TRIGGER profiles_guard_ativo_ins
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_ativo();

DROP TRIGGER IF EXISTS profiles_guard_ativo_upd ON public.profiles;
CREATE TRIGGER profiles_guard_ativo_upd
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_ativo();

-- Aprovisionamento atómico de contas criadas pelo administrador
CREATE OR REPLACE FUNCTION public.admin_provision_user(p_user_id uuid, p_role app_role, p_ativo boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role);
  UPDATE public.profiles SET ativo = p_ativo WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provision_user(uuid, app_role, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_user(uuid, app_role, boolean) TO authenticated;
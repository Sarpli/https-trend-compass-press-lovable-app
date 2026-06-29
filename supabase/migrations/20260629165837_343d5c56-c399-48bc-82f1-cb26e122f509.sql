ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'username'
  );
  INSERT INTO public.subscriptions (user_id, tier) VALUES (NEW.id, 'free');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END
$function$;

GRANT UPDATE (username, display_name) ON public.profiles TO authenticated;

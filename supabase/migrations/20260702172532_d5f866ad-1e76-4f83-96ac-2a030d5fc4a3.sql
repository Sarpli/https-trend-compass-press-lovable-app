
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dup_count int;
BEGIN
  IF NEW.email IS NOT NULL THEN
    SELECT COUNT(*) INTO v_dup_count
      FROM auth.users
     WHERE id <> NEW.id
       AND lower(email) = lower(NEW.email);
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION 'DUPLICATE_EMAIL: An account with this email already exists. Please sign in instead.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

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
$$;

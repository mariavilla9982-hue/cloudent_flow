-- Only service_role may execute these functions; Auth user lookups require the
-- function owner's privileges. Public/authenticated execution remains revoked.
alter function public.configure_x_invite(uuid,text,text,uuid[]) security definer;
alter function public.accept_x_invite(uuid,text,text) security definer;

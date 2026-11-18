begin;
do $test$
declare p public.instagram_private_pilot; session_id uuid; state jsonb; claimed jsonb; expiry timestamptz:=now()+interval '5 minutes';
begin
 select * into p from public.instagram_private_pilot where id=true;
 select id into session_id from auth.sessions where user_id=p.user_id and (not_after is null or not_after>now()) order by created_at desc limit 1;
 if session_id is null then raise exception 'test requires existing owner session';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p.user_id,'role','authenticated','session_id',session_id)::text,true);
 update public.instagram_private_pilot set phase='blocked',login_at=now()-interval '1 hour',challenge_hint='{}',settings_cipher='fixture-simulated-only' where id=true;
 state:=public.instagram_private_pilot_control('diagnostic_read','{"confirm_username":"sahryjapah"}');
 if state->>'settings_cipher'<>'fixture-simulated-only' then raise exception 'diagnostic unavailable';end if;
 if (select phase from public.instagram_private_pilot where id=true)<>'blocked' then raise exception 'diagnostic mutated phase';end if;
 begin perform public.instagram_private_pilot_control('diagnostic_read','{}');raise exception 'unexpected diagnostic';exception when others then if sqlerrm<>'diagnostic_not_available' then raise;end if;end;
 state:=public.instagram_private_pilot_control('status');
 if coalesce((state->'challenge'->>'expired')::boolean,false)<>true or state?'settings_cipher' then raise exception 'expired status unsafe';end if;
 begin perform public.instagram_private_pilot_control('resume_claim');raise exception 'unexpected resume';exception when others then if sqlerrm<>'challenge_not_resumable' then raise;end if;end;
 update public.instagram_private_pilot set phase='blocked',login_at=now()-interval '2 minutes',challenge_hint=jsonb_build_object('matching_number','19','can_resume',true,'kind','app_approval','expires_at',expiry) where id=true;
 state:=public.instagram_private_pilot_control('status');
 if state->'challenge'->>'matching_number'<>'19' or state->'challenge'->>'can_resume'<>'true' then raise exception 'lost hint';end if;
 claimed:=public.instagram_private_pilot_control('resume_claim');
 perform public.instagram_private_pilot_control('login_finish',jsonb_build_object('lease',claimed->>'lease','phase','blocked','settings_cipher','fixture-simulated-only','is_resume',true,'error_code','resume_password_required','challenge',jsonb_build_object('matching_number','19','can_resume',true,'kind','app_approval','needs_password',true,'raw_secret','must-not-survive')));
 state:=public.instagram_private_pilot_control('status');
 if (state->'challenge'->>'expires_at')::timestamptz<>expiry or state->'challenge'?'raw_secret' then raise exception 'expiry extended or raw hint persisted';end if;
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.instagram_private_pilot_control('status');raise exception 'unexpected anonymous access';exception when insufficient_privilege then null;end;
end $test$;
select 'PASS sanitized persisted hints, expiry, resume CAS, no extension or ciphertext in status, anonymous denial; all fixture changes rolled back' as result;
rollback;

-- Preserve existing RPCs, privileges and locks; switch only the authorized workflow.
DO $migration$
DECLARE r record; definition text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('genjutsu_serial_head','claim_genjutsu_prompt_job','claim_genjutsu_job','request_genjutsu_auto_retry','wake_genjutsu_queue')
 LOOP
  definition:=pg_get_functiondef(r.oid);
  definition:=replace(definition,'2117411301344411649','2124648844280733698');
  -- GENJUTSU 0 keeps one turn across LLM and RunningHub generation.
  definition:=replace(definition,
   'greatest(1,least(4,coalesce((value->>''prompt_concurrency'')::integer,2)))', '1');
  definition:=replace(definition,'cap:=coalesce(cap,2)','cap:=1');
  EXECUTE definition;
 END LOOP;
END $migration$;

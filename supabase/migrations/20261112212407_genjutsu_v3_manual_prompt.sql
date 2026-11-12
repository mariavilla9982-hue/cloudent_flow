alter table public.genjutsu_v3_jobs add column manual_prompt text;
alter table public.genjutsu_v3_jobs add constraint genjutsu_v3_manual_prompt_check
check (manual_prompt is null or (input_video_path is null and char_length(btrim(manual_prompt)) between 1 and 8000));
set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.evaluate_smart_time_validation() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  cfg jsonb;
  v_min_samples integer;
  v_min_conf integer;
  v_validation_cycles integer;
  v_margin numeric;
  v_challenger_cycles integer;
  v_reject_cycles integer;
  v_degrade numeric;
  v_rollback_cycles integer;
  r record;
  v public.smart_time_validation%rowtype;
  evidence boolean;
  strong boolean;
  advantage boolean;
  new_streak integer;
  new_fail integer;
  new_decline integer;
  old_state text;
  old_champion time;
  summary jsonb;
begin
  select value into cfg from public.app_settings where key='smart_scheduler';
  cfg:=coalesce(cfg,'{}'::jsonb);

  if coalesce((cfg->>'validationEnabled')::boolean,true)=false then
    return jsonb_build_object('enabled',false);
  end if;

  v_min_samples:=greatest(1,coalesce((cfg->>'validationMinSamples')::integer,4));
  v_min_conf:=greatest(1,least(100,coalesce((cfg->>'validationMinConfidence')::integer,80)));
  v_validation_cycles:=greatest(1,coalesce((cfg->>'validationEvidenceCycles')::integer,2));
  v_margin:=greatest(0,coalesce((cfg->>'challengerMarginPct')::numeric,12))/100;
  v_challenger_cycles:=greatest(1,coalesce((cfg->>'challengerEvidenceCycles')::integer,2));
  v_reject_cycles:=greatest(1,coalesce((cfg->>'challengerRejectCycles')::integer,2));
  v_degrade:=greatest(0,least(0.9,coalesce((cfg->>'degradePct')::numeric,20)/100));
  v_rollback_cycles:=greatest(1,coalesce((cfg->>'rollbackEvidenceCycles')::integer,2));

  for r in
    select weekday,rank,recommended_time,score,confidence,sample_count,recommendation_type
    from public.smart_recommendations
    order by weekday,rank
  loop
    select * into v
    from public.smart_time_validation
    where weekday=r.weekday and rank=r.rank
    for update;

    if not found then
      insert into public.smart_time_validation(
        weekday,rank,state,candidate_time,candidate_score,candidate_confidence,candidate_sample_count,
        last_observed_time,last_observed_sample_count,last_evidence_at,last_decision_at
      ) values (
        r.weekday,r.rank,
        case when r.sample_count>0 then 'testing' else 'new' end,
        r.recommended_time,r.score,r.confidence,r.sample_count,
        r.recommended_time,r.sample_count,now(),now()
      )
      returning * into v;

      insert into public.smart_time_history(
        validation_id,weekday,rank,event_type,to_state,to_time,candidate_score,confidence,sample_count,reason
      ) values (
        v.id,r.weekday,r.rank,'created',v.state,r.recommended_time,r.score,r.confidence,r.sample_count,
        'Novo slot entrou no ciclo de validação.'
      );
      continue;
    end if;

    evidence :=
      r.sample_count > coalesce(v.last_observed_sample_count,0)
      or r.recommended_time is distinct from v.last_observed_time;

    strong :=
      coalesce(r.recommendation_type,'') <> 'test'
      and r.sample_count >= v_min_samples
      and r.confidence >= v_min_conf;

    old_state:=v.state;
    old_champion:=v.champion_time;

    -- NEW / TESTING -> VALIDATED only after strong evidence.
    if v.state in ('new','testing') then
      new_streak:=v.validation_streak;
      if strong and evidence then
        new_streak:=new_streak+1;
      elsif evidence and not strong then
        new_streak:=0;
      end if;

      if strong and new_streak >= v_validation_cycles then
        update public.smart_time_validation set
          state='validated',
          champion_time=r.recommended_time,
          champion_score=r.score,
          champion_confidence=r.confidence,
          champion_sample_count=r.sample_count,
          candidate_time=r.recommended_time,
          candidate_score=r.score,
          candidate_confidence=r.confidence,
          candidate_sample_count=r.sample_count,
          validation_streak=new_streak,
          challenger_streak=0,
          challenger_fail_streak=0,
          decline_streak=0,
          rollback_time=null,
          rollback_score=null,
          rollback_confidence=null,
          rollback_sample_count=null,
          validated_at=now(),
          revalidate_started_at=null,
          last_decision_at=now(),
          last_evidence_at=case when evidence then now() else last_evidence_at end,
          last_observed_time=r.recommended_time,
          last_observed_sample_count=r.sample_count,
          updated_at=now()
        where id=v.id;

        insert into public.smart_time_history(
          validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
          champion_score,candidate_score,confidence,sample_count,reason
        ) values (
          v.id,r.weekday,r.rank,'validated',old_state,'validated',old_champion,r.recommended_time,
          r.score,r.score,r.confidence,r.sample_count,
          'Horário atingiu amostras e confiança suficientes e foi congelado como campeão.'
        );
      else
        update public.smart_time_validation set
          state=case when r.sample_count>0 then 'testing' else 'new' end,
          candidate_time=r.recommended_time,
          candidate_score=r.score,
          candidate_confidence=r.confidence,
          candidate_sample_count=r.sample_count,
          validation_streak=new_streak,
          last_evidence_at=case when evidence then now() else last_evidence_at end,
          last_observed_time=r.recommended_time,
          last_observed_sample_count=r.sample_count,
          updated_at=now()
        where id=v.id;
      end if;

      continue;
    end if;

    -- VALIDATED: champion is frozen. A different raw recommendation is only a challenger.
    if v.state='validated' then
      if r.recommended_time = v.champion_time then
        new_decline:=v.decline_streak;
        if evidence then
          if v.champion_score>0 and r.score < v.champion_score*(1-v_degrade) then
            new_decline:=new_decline+1;
          else
            new_decline:=0;
          end if;
        end if;

        if new_decline >= v_rollback_cycles and v.rollback_time is not null then
          update public.smart_time_validation set
            champion_time=v.rollback_time,
            champion_score=coalesce(v.rollback_score,v.champion_score),
            champion_confidence=coalesce(v.rollback_confidence,v.champion_confidence),
            champion_sample_count=coalesce(v.rollback_sample_count,v.champion_sample_count),
            candidate_time=v.rollback_time,
            candidate_score=coalesce(v.rollback_score,v.champion_score),
            candidate_confidence=coalesce(v.rollback_confidence,v.champion_confidence),
            candidate_sample_count=coalesce(v.rollback_sample_count,v.champion_sample_count),
            rollback_time=null,rollback_score=null,rollback_confidence=null,rollback_sample_count=null,
            decline_streak=0,challenger_streak=0,challenger_fail_streak=0,
            state='validated',validated_at=now(),last_decision_at=now(),
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;

          insert into public.smart_time_history(
            validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
            champion_score,candidate_score,confidence,sample_count,reason
          ) values (
            v.id,r.weekday,r.rank,'rollback','validated','validated',
            v.champion_time,v.rollback_time,v.champion_score,r.score,r.confidence,r.sample_count,
            'O novo campeão caiu além do limite; o último horário validado foi restaurado automaticamente.'
          );
        elsif new_decline >= v_rollback_cycles then
          update public.smart_time_validation set
            state='revalidate',
            candidate_time=null,
            candidate_score=0,
            candidate_confidence=0,
            candidate_sample_count=0,
            challenger_streak=0,
            challenger_fail_streak=0,
            decline_streak=new_decline,
            revalidate_started_at=now(),
            last_decision_at=now(),
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;

          insert into public.smart_time_history(
            validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
            champion_score,confidence,sample_count,reason
          ) values (
            v.id,r.weekday,r.rank,'revalidate_due_drop','validated','revalidate',
            v.champion_time,v.champion_time,v.champion_score,r.confidence,r.sample_count,
            'O campeão caiu de desempenho em evidências consecutivas e precisa ser revalidado.'
          );
        else
          update public.smart_time_validation set
            candidate_time=r.recommended_time,
            candidate_score=r.score,
            candidate_confidence=r.confidence,
            candidate_sample_count=r.sample_count,
            decline_streak=new_decline,
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;
        end if;
      else
        advantage:=strong and v.champion_score>0 and r.score >= v.champion_score*(1+v_margin);
        if advantage then
          new_streak:=case
            when v.candidate_time=r.recommended_time then v.challenger_streak
            else 0
          end;
          if evidence then new_streak:=new_streak+1; end if;

          update public.smart_time_validation set
            state='revalidate',
            candidate_time=r.recommended_time,
            candidate_score=r.score,
            candidate_confidence=r.confidence,
            candidate_sample_count=r.sample_count,
            challenger_streak=new_streak,
            challenger_fail_streak=0,
            revalidate_started_at=coalesce(v.revalidate_started_at,now()),
            last_decision_at=case when v.state<>'revalidate' then now() else last_decision_at end,
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;

          insert into public.smart_time_history(
            validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
            champion_score,candidate_score,confidence,sample_count,reason
          )
          select
            v.id,r.weekday,r.rank,'challenger_started','validated','revalidate',
            v.champion_time,r.recommended_time,v.champion_score,r.score,r.confidence,r.sample_count,
            'Um horário diferente superou o campeão pela margem mínima e entrou em comparação.'
          where v.candidate_time is distinct from r.recommended_time or v.state<>'revalidate';
        else
          update public.smart_time_validation set
            candidate_time=r.recommended_time,
            candidate_score=r.score,
            candidate_confidence=r.confidence,
            candidate_sample_count=r.sample_count,
            challenger_streak=0,
            challenger_fail_streak=0,
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;
        end if;
      end if;
      continue;
    end if;

    -- REVALIDATE: challenger gets temporary exposure; promote only after repeated new evidence.
    if v.state='revalidate' then
      if v.candidate_time is null then
        if r.recommended_time is distinct from v.champion_time and strong then
          update public.smart_time_validation set
            candidate_time=r.recommended_time,
            candidate_score=r.score,
            candidate_confidence=r.confidence,
            candidate_sample_count=r.sample_count,
            challenger_streak=case when evidence then 1 else 0 end,
            challenger_fail_streak=0,
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;
        else
          update public.smart_time_validation set
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;
        end if;
        continue;
      end if;

      if r.recommended_time = v.champion_time then
        new_fail:=v.challenger_fail_streak + case when evidence then 1 else 0 end;
        if new_fail >= v_reject_cycles then
          update public.smart_time_validation set
            state='validated',
            candidate_time=v.champion_time,
            candidate_score=v.champion_score,
            candidate_confidence=v.champion_confidence,
            candidate_sample_count=v.champion_sample_count,
            challenger_streak=0,challenger_fail_streak=0,decline_streak=0,
            revalidate_started_at=null,last_decision_at=now(),
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;

          insert into public.smart_time_history(
            validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
            champion_score,candidate_score,confidence,sample_count,reason
          ) values (
            v.id,r.weekday,r.rank,'challenger_rejected','revalidate','validated',
            v.candidate_time,v.champion_time,v.champion_score,v.candidate_score,
            r.confidence,r.sample_count,'O desafiante perdeu consistência; o campeão foi mantido.'
          );
        else
          update public.smart_time_validation set
            challenger_fail_streak=new_fail,
            last_evidence_at=case when evidence then now() else last_evidence_at end,
            last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
          where id=v.id;
        end if;
        continue;
      end if;

      if r.recommended_time is distinct from v.candidate_time then
        advantage:=strong and v.champion_score>0 and r.score >= v.champion_score*(1+v_margin);
        update public.smart_time_validation set
          candidate_time=r.recommended_time,
          candidate_score=r.score,
          candidate_confidence=r.confidence,
          candidate_sample_count=r.sample_count,
          challenger_streak=case when advantage and evidence then 1 else 0 end,
          challenger_fail_streak=case when advantage then 0 else 1 end,
          last_evidence_at=case when evidence then now() else last_evidence_at end,
          last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
        where id=v.id;
        continue;
      end if;

      advantage:=strong and v.champion_score>0 and r.score >= v.champion_score*(1+v_margin);
      new_streak:=v.challenger_streak;
      new_fail:=v.challenger_fail_streak;

      if evidence then
        if advantage then
          new_streak:=new_streak+1;
          new_fail:=0;
        else
          new_fail:=new_fail+1;
        end if;
      end if;

      if advantage and new_streak >= v_challenger_cycles then
        update public.smart_time_validation set
          state='validated',
          rollback_time=v.champion_time,
          rollback_score=v.champion_score,
          rollback_confidence=v.champion_confidence,
          rollback_sample_count=v.champion_sample_count,
          champion_time=r.recommended_time,
          champion_score=r.score,
          champion_confidence=r.confidence,
          champion_sample_count=r.sample_count,
          candidate_time=r.recommended_time,
          candidate_score=r.score,
          candidate_confidence=r.confidence,
          candidate_sample_count=r.sample_count,
          challenger_streak=0,challenger_fail_streak=0,decline_streak=0,
          validated_at=now(),revalidate_started_at=null,last_decision_at=now(),
          last_evidence_at=case when evidence then now() else last_evidence_at end,
          last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
        where id=v.id;

        insert into public.smart_time_history(
          validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
          champion_score,candidate_score,confidence,sample_count,reason
        ) values (
          v.id,r.weekday,r.rank,'champion_promoted','revalidate','validated',
          v.champion_time,r.recommended_time,v.champion_score,r.score,r.confidence,r.sample_count,
          'O desafiante venceu o campeão em evidências consecutivas e virou o novo horário validado.'
        );
      elsif new_fail >= v_reject_cycles then
        update public.smart_time_validation set
          state='validated',
          candidate_time=v.champion_time,
          candidate_score=v.champion_score,
          candidate_confidence=v.champion_confidence,
          candidate_sample_count=v.champion_sample_count,
          challenger_streak=0,challenger_fail_streak=0,decline_streak=0,
          revalidate_started_at=null,last_decision_at=now(),
          last_evidence_at=case when evidence then now() else last_evidence_at end,
          last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
        where id=v.id;

        insert into public.smart_time_history(
          validation_id,weekday,rank,event_type,from_state,to_state,from_time,to_time,
          champion_score,candidate_score,confidence,sample_count,reason
        ) values (
          v.id,r.weekday,r.rank,'challenger_rejected','revalidate','validated',
          v.candidate_time,v.champion_time,v.champion_score,r.score,r.confidence,r.sample_count,
          'O desafiante não sustentou vantagem suficiente; o campeão foi mantido.'
        );
      else
        update public.smart_time_validation set
          candidate_score=r.score,
          candidate_confidence=r.confidence,
          candidate_sample_count=r.sample_count,
          challenger_streak=new_streak,
          challenger_fail_streak=new_fail,
          last_evidence_at=case when evidence then now() else last_evidence_at end,
          last_observed_time=r.recommended_time,last_observed_sample_count=r.sample_count,updated_at=now()
        where id=v.id;
      end if;
    end if;
  end loop;

  select jsonb_build_object(
    'new',count(*) filter(where state='new'),
    'testing',count(*) filter(where state='testing'),
    'validated',count(*) filter(where state='validated'),
    'revalidate',count(*) filter(where state='revalidate')
  )
  into summary
  from public.smart_time_validation;

  return coalesce(summary,'{}'::jsonb);
end;
$$;


ALTER FUNCTION public.evaluate_smart_time_validation() OWNER TO postgres;
revoke all on function public.evaluate_smart_time_validation() from public,anon,authenticated; grant execute on function public.evaluate_smart_time_validation() to service_role;

set check_function_bodies=true;

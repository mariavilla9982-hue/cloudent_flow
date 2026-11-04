-- Read-only regression cases for the eligibility predicate.
with fixtures(stage,status,uncertain,expected) as (
  values ('control_motion','waiting',false,true),
         ('control_motion','running',false,true),
         ('face_swap','waiting',false,false),
         ('upscale','running',false,false),
         ('upscale','failed',true,false),
         ('upscale','failed',false,true),
         ('upload','waiting',false,true)
)
select *, not (stage not in ('upload','control_motion') and
  (status in ('waiting','uploading','queued','running') or uncertain))=expected as passed
from fixtures;

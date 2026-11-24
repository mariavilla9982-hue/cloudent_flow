// Supported offline regressions. SQL generators and historical fixtures are tracked separately.
import {spawnSync} from 'node:child_process';
import process from 'node:process';
const tests=[
  "scripts/test-production-worker-boot.mjs",
  "scripts/test-account-summary.mjs",
  "scripts/test-admin-panel.cjs",
  "scripts/test-auth-recovery.cjs",
  "scripts/test-calendar-cover-retries.mjs",
  "scripts/test-calendar-interaction.cjs",
  "scripts/test-calendar-policy.cjs",
  "scripts/test-calendar-trial-ui.cjs",
  "scripts/test-calendar-trial.cjs",
  "scripts/test-dashboard-overview.cjs",
  "scripts/test-focused-refresh.mjs",
  "scripts/test-genjutsu-capture.mjs",
  "scripts/test-genjutsu-diagnostics.mjs",
  "scripts/test-genjutsu-direct-recovery.mjs",
  "scripts/test-genjutsu-dispatch.mjs",
  "scripts/test-genjutsu-display.mjs",
  "scripts/test-genjutsu-gemini.mjs",
  "scripts/test-genjutsu-labels.cjs",
  "scripts/test-genjutsu-manual.mjs",
  "scripts/test-genjutsu-preparation.mjs",
  "scripts/test-genjutsu-readiness.mjs",
  "scripts/test-genjutsu-stale-capture.mjs",
  "scripts/test-genjutsu-ui.mjs",
  "scripts/test-instagram-feed.mjs",
  "scripts/test-motion-automatic-ui.cjs",
  "scripts/test-motion-dispatch.cjs",
  "scripts/test-motion-failure-repair.cjs",
  "scripts/test-motion-missing-task.mjs",
  "scripts/test-motion-previous-failure.cjs",
  "scripts/test-motion-provider-capacity.cjs",
  "scripts/test-motion-recovery-gate.cjs",
  "scripts/test-motion-storage-cancel.cjs",
  "scripts/test-motion-ultra-authorization.cjs",
  "scripts/test-motion-video-integrity.mjs",
  "scripts/test-pipeline-motion-retry.mjs",
  "scripts/test-points-statement.mjs",
  "scripts/test-publish-media-guard.mjs",
  "scripts/test-route-guard.cjs",
  "scripts/test-runninghub-points.mjs",
  "scripts/test-runninghub-ui-auth.mjs",
  "scripts/test-trial-overdue-recovery.mjs",
  "scripts/test-trial-publish-reconcile.mjs",
  "scripts/test-upload-retry.cjs",
  "scripts/test-upload-verification.mjs",
  "scripts/test-validation-batch.mjs",
  "scripts/test-x-media-mirroring.cjs",
  "scripts/test-x-own-account-oauth.cjs",
  "scripts/test-x-studio-buffer.cjs",
  "scripts/test-x-studio-gallery-schedule.cjs",
  "scripts/test-x-studio-isolation.cjs",
  "scripts/test-x-studio-media.cjs",
  "scripts/test-x-studio-ui.cjs",
  "supabase/tests/face-swap-character.test.mjs",
  "supabase/tests/production-schedule-account.test.mjs",
  "supabase/tests/trial-failures.test.mjs",
  "scripts/test-calendar-reliability.mjs",
  "scripts/test-genjutsu-cache.mjs",
  "scripts/test-instagram-scale-edge.mjs",
  "supabase/tests/calendar-accounts.test.mjs",
  "supabase/tests/metrics-core.test.mjs"
];
let failed=0;
for(const file of tests){
 const result=spawnSync(process.execPath,['--experimental-strip-types','--experimental-vm-modules','--import',new URL('./offline-test-guard.mjs',import.meta.url).pathname,file],{encoding:'utf8',timeout:30000});
 if(result.status!==0){failed++;console.error('FAIL '+file+'\n'+(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));}
 else console.log('PASS '+file);
}
console.log(`${tests.length-failed}/${tests.length} supported regressions passed`);
if(failed)process.exitCode=1;

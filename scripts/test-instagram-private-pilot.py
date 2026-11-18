"""No credentials, network, or real posts. Run with installed runtime dependencies."""
import base64
import importlib.util
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).resolve().parents[1]/'api/instagram-private-pilot.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
os.environ['INSTAGRAM_PILOT_KEY'] = base64.urlsafe_b64encode(os.urandom(32)).decode()
settings = {'authorization_data':{'sessionid':'fixture-only'},'uuids':{'device_id':'stable-device'}}
sealed = p.seal(settings, 'owner')
assert p.unseal(sealed, 'owner') == settings
for value, owner in [(sealed, 'someone-else'), (sealed[:-4]+'AAAA', 'owner')]:
    try:
        p.unseal(value, owner)
        raise AssertionError('must reject tampering or other owner')
    except (ValueError, KeyError):
        pass

for headers in [{}, {'Authorization':'Bearer fixture','Origin':'https://evil.invalid'}]:
    with patch.object(p, 'backend', side_effect=AssertionError('must not call backend')):
        try:
            p.dispatch(headers, {'action':'login','password':'fixture'})
            raise AssertionError('must reject unauthenticated or foreign origin')
        except p.PilotError:
            pass
with patch.object(p,'backend',return_value={'role':'x_user','user_id':'owner'}), patch.object(p,'login',side_effect=AssertionError('must not login')):
    try:
        p.dispatch({'Authorization':'Bearer fixture'}, {'action':'login'})
        raise AssertionError('must reject non-admin')
    except p.PilotError as e:
        assert e.code == 'admin_required'

class Client:
    def __init__(self, name='sahryjapah', error=None):
        self.name, self.error = name,error
    def login(self, username, password, verification_code=''):
        assert username == 'sahryjapah'
        if self.error:
            raise self.error
    def get_settings(self):
        return settings
    def account_info(self):
        return SimpleNamespace(username=self.name)

events=[]
def control(token, action, payload=None):
    events.append((action,payload))
    if action == 'status':
        return {'phase':'blocked','challenge':{'can_resume':True,'expired':False}}
    if action.endswith('_claim'):
        return {'lease':'fixture-lease','settings_cipher':sealed,'video_id':'fixture-video'}
    return {'ok':True}

for client, expected in [(Client(),'connected'),(Client('japahsahry'),'blocked'),(Client(error=type('TwoFactorRequired',(Exception,),{})()),'two_factor')]:
    events.clear()
    with patch.object(p,'instagram',return_value=client),patch.object(p,'control',side_effect=control):
        result=p.login('fixture','owner',{'password':'fixture-only'})
        assert result['phase'] == expected
        assert events[-1][0] == 'login_finish'
        assert 'password' not in events[-1][1]
        if expected == 'connected':
            assert p.unseal(events[-1][1]['settings_cipher'],'owner') == settings

# Publish once, only after the SQL lease; wrong account/invalid media cannot upload.
events.clear()
with patch.object(p,'control',side_effect=control),patch.object(p,'instagram',return_value=Client('japahsahry')):
    result=p.publish('fixture','owner',{'confirm_username':'sahryjapah'})
    assert result['phase']=='uncertain'
    assert [x[0] for x in events]==['publish_claim','publish_finish']
    assert events[-1][1]['error_code']=='instagram_account_mismatch'
with patch.object(p,'control',side_effect=AssertionError('must not claim')):
    try:
        p.publish('fixture','owner',{'confirm_username':'japahsahry'})
        raise AssertionError('explicit target required')
    except p.PilotError:
        pass
for url in ['http://localhost/x','https://evil.invalid/x','https://127.0.0.1/x']:
    with patch.object(p.requests,'get',side_effect=AssertionError('must not download')):
        try:
            p.download_video(url,Path('/tmp/unused'))
            raise AssertionError('source must be existing trusted storage')
        except p.PilotError:
            pass
class PublishingClient(Client):
    def __init__(self,error=None):
        super().__init__();self.uploads=0;self.error=error
    def clip_upload(self,path,caption,thumbnail):
        self.uploads+=1
        assert caption=='' and path.exists()
        if self.error:
            raise self.error
        return SimpleNamespace(pk='12345')
    def media_info(self,pk):
        return SimpleNamespace(pk=pk,user=SimpleNamespace(username='sahryjapah'),code='fixtureCode')
for error,phase in [(None,'published'),(TimeoutError('fixture'),'uncertain')]:
    client=PublishingClient(error);events.clear()
    with patch.object(p,'control',side_effect=control),patch.object(p,'instagram',return_value=client),patch.object(p,'backend',return_value={'url':'fixture'}),patch.object(p,'download_video',side_effect=lambda url,path:path.write_bytes(b'fixture')),patch.object(p.subprocess,'run'),patch.dict(sys.modules,{'imageio_ffmpeg':SimpleNamespace(get_ffmpeg_exe=lambda:'fixture-ffmpeg')}):
        result=p.publish('fixture','owner',{'confirm_username':'sahryjapah'})
        assert result['phase']==phase
        assert client.uploads==1
        assert events[-1][0]=='publish_finish'
        assert ('media_id' in events[-1][1]) == (phase=='published')
print('PASS: encryption/tampering/owner, auth/origin/admin, login/2FA/account, durable claim/failure/no retry, source allowlist')

assert p.challenge_hint({'step_data':{'phone_number':'59','choices':[59,19,40]}})['matching_number'] is None
assert p.challenge_hint({'title':'Tap the number 19 on your other device'})['matching_number']=='19'
assert p.challenge_hint({'matching_number':40})['matching_number']=='40'
assert p.challenge_hint({'matching_number':40,'nested':{'challenge_number':59}})['matching_number'] is None
assert p.challenge_hint({'code':'123456','description':'Account 19 has 40 photos'})['matching_number'] is None
raw={'bloks_action':'com.bloks.www.ig.challenge.redirect.async','challenge_context':'fixture-private-context'}
assert p.challenge_hint(raw)=={'matching_number':None,'can_resume':True,'kind':'app_approval'}
assert not p.challenge_hint({'challenge':{'native_flow':True}})['can_resume']
client=Client();client.last_json=raw
saved=p.challenge_state(client)
assert saved['_cloudent_pending']['last_json']==raw
assert p.unseal(p.seal(saved,'owner'),'owner')['_cloudent_pending']['last_json']==raw
class ResumeClient(Client):
    def __init__(self,expired=False):
        super().__init__();self.cloudent_pending={'created_at':0 if expired else p.time.time(),'last_json':raw};self.resumes=0
    def login(self,*args,**kwargs):
        raise AssertionError('resume must never start a new login')
    def challenge_bloks_redirect_dismiss(self):
        self.resumes+=1
for expired in [False,True]:
    client=ResumeClient(expired);events.clear()
    with patch.object(p,'instagram',return_value=client),patch.object(p,'control',side_effect=control):
        result=p.login('fixture','owner',{'action':'resume'})
        assert result['phase']==('blocked' if expired else 'connected')
        assert client.resumes==(0 if expired else 1)
print('PASS: no guessed number, explicit labels only, conflicting/OTP/phone rejected, encrypted checkpoint, resume without relogin, checkpoint expiry')

# Expired/unsupported checkpoints stop before claim, decrypt or provider traffic.
for hint,expected in [({'expired':True,'can_resume':True},'challenge_expired'),({'expired':False,'can_resume':False},'challenge_not_resumable')]:
    events.clear()
    with patch.object(p,'control',return_value={'phase':'blocked','challenge':hint}) as calls,patch.object(p,'unseal',side_effect=AssertionError('must not decrypt')),patch.object(p,'instagram',side_effect=AssertionError('must not call provider')):
        try:p.login('fixture','owner',{'action':'resume'})
        except p.PilotError as error:assert error.code==expected
        else:raise AssertionError('must reject checkpoint')
        assert calls.call_count==1

class FinalizeClient(ResumeClient):
    def __init__(self):
        super().__init__();self.logins=0;self.ready=False
    def login(self,username,password,verification_code=''):
        assert username=='sahryjapah' and password=='fixture-only';self.logins+=1;self.ready=True
    def account_info(self):
        if not self.ready:raise type('LoginRequired',(Exception,),{})()
        return super().account_info()

client=FinalizeClient();events.clear()
with patch.object(p,'instagram',return_value=client),patch.object(p,'control',side_effect=control):
    result=p.login('fixture','owner',{'action':'resume'})
    assert result['error_code']=='resume_password_required' and result['challenge']['needs_password']
    assert client.logins==0 and client.resumes==1
    saved=p.unseal(events[-1][1]['settings_cipher'],'owner')
    assert saved['_cloudent_pending']['created_at']==client.cloudent_pending['created_at']
client=FinalizeClient();events.clear()
with patch.object(p,'instagram',return_value=client),patch.object(p,'control',side_effect=control):
    result=p.login('fixture','owner',{'action':'resume','password':'fixture-only'})
    assert result['phase']=='connected' and client.logins==1 and client.resumes==1
    assert 'fixture-only' not in str(events[-1][1])
print('PASS: expired checkpoint stops before decrypt/claim, same-client password finalization, missing-password continuation, no password persistence, fixed checkpoint lifetime')

# Authorized diagnostic returns structure only; no provider requests or state writes.
raw={'message':'do not echo fixture-secret','challenge':{'api_path':'/challenge/fixture-secret','step_name':'auth_platform','challenge_context':'fixture-secret','data':{'matching_number':'27','email':'fixture-secret@example.test'}},'fixture-secret':'private'}
state={**settings,'_cloudent_pending':{'created_at':p.time.time()-700,'last_json':raw}}
with patch.object(p,'control',return_value={'settings_cipher':p.seal(state,'owner')}) as rpc, patch.object(p,'instagram',side_effect=AssertionError('no client')), patch.object(p.requests,'request',side_effect=AssertionError('no network')):
    result=p.verification_diagnostic('fixture','owner',{'confirm_username':'sahryjapah'})
    assert result['diagnostic']['expired'] and result['diagnostic']['instagram_requests']==0
    assert result['diagnostic']['hint']['matching_number']=='27'
    assert 'fixture-secret' not in p.json.dumps(result)
    assert 'settings_cipher' not in p.json.dumps(result)
    assert result['diagnostic']['step']=='auth_platform'
    assert rpc.call_count==1 and rpc.call_args.args[1]=='diagnostic_read'
with patch.object(p,'control',side_effect=AssertionError('confirmation required')):
    try:p.verification_diagnostic('fixture','owner',{});raise AssertionError('must reject')
    except p.PilotError as e:assert e.code=='confirmation_required'
print('PASS: read-only diagnostic, exact account, no login/client/network, expired response inspection, allowlisted schema, no raw fields/secrets in output')

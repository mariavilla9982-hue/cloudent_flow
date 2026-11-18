import ast
import pathlib
import subprocess
import tempfile

source=pathlib.Path('api/media_cleaner.py').read_text()
module=ast.parse(source)
function=next(n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='_preserves_streams')
namespace={}
exec(compile(ast.Module(body=[function],type_ignores=[]),'fidelity','exec'),namespace)
preserves=namespace['_preserves_streams']
before={'width':832,'height':1472,'video_codec':'h264','audio_codec':'aac','has_audio':True,'duration_seconds':10.7,'fps':30}
assert preserves(before,before.copy())
for change in [{'width':720},{'height':1280},{'video_codec':'hevc'},{'has_audio':False},{'fps':24},{'duration_seconds':9.0}]:
    assert not preserves(before,{**before,**change}),change
assert not preserves({}, {})
# A synthetic clip is generated locally; no user media is downloaded.
with tempfile.TemporaryDirectory() as tmp:
    original=tmp+'/source.mp4';cleaned=tmp+'/clean.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=128x224:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.5','-c:v','libx264','-c:a','aac',original],check=True)
    subprocess.run(['ffmpeg','-v','error','-i',original,'-map','0:v?','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-metadata','encoder=','-c','copy',cleaned],check=True)
    def digest(path,stream):
        return subprocess.check_output(['ffmpeg','-v','error','-i',path,'-map',stream,'-c','copy','-f','hash','-hash','sha256','-'])
    for stream in ['0:v:0','0:a:0']:assert digest(original,stream)==digest(cleaned,stream),stream
assert source.index('if not _preserves_streams(before, after)')<source.index('if thumbnail_target:')
print('PASS fidelity: degraded geometry/fps/codecs/audio/duration rejected before upload; synthetic video and audio packet hashes identical after metadata removal')

from pathlib import Path
import urllib.request, zipfile, subprocess, sys, hashlib, json, base64, time
root=Path(__file__).resolve().parents[1]; cache=root/'cache'; target=root/'resources/python'; cache.mkdir(exist_ok=True); target.mkdir(exist_ok=True)
(root/'checks').mkdir(exist_ok=True)
version='3.13.16'; name=f'python-{version}-embed-amd64.zip'; url=f'https://www.python.org/ftp/python/{version}/{name}'
def get(url,dst):
 if dst.exists():return
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=90) as r:dst.write_bytes(r.read())
   return
  except Exception:
   if attempt==2:raise
   time.sleep(2)
archive=cache/name; get(url,archive)
sig=cache/(name+'.sigstore');get(url+'.sigstore',sig)
bundle=json.loads(sig.read_text()); digest=bundle.get('messageSignature',{}).get('messageDigest',{}).get('digest')
actual=hashlib.sha256(archive.read_bytes()).digest()
if not digest or base64.b64decode(digest)!=actual:raise RuntimeError('Python archive digest does not match official Sigstore bundle')
with zipfile.ZipFile(archive) as z:z.extractall(target)
wheels=cache/'wheels';wheels.mkdir(exist_ok=True)
subprocess.run([sys.executable,'-m','pip','download','--disable-pip-version-check','--only-binary=:all:','--platform','win_amd64','--python-version','313','--implementation','cp','--abi','cp313','--dest',str(wheels),'-r',str(root/'resources/workbench/skills-requirements.txt')],check=True)
site=target/'Lib/site-packages';site.mkdir(parents=True,exist_ok=True)
wheel_records=[]
for whl in sorted(wheels.glob('*.whl')):
 with zipfile.ZipFile(whl) as z:
  for item in z.infolist():
   p=Path(item.filename)
   if p.is_absolute() or '..' in p.parts:raise RuntimeError('Invalid wheel path')
   if '.data' in item.filename and '/purelib/' in item.filename:item.filename=item.filename.split('/purelib/',1)[1]
   if '.data' in item.filename and '/platlib/' in item.filename:item.filename=item.filename.split('/platlib/',1)[1]
   z.extract(item,site)
 wheel_records.append({'file':whl.name,'sha256':hashlib.sha256(whl.read_bytes()).hexdigest()})
(target/'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../workbench/integrations\nimport site\n')
(root/'checks/python-runtime.json').write_text(json.dumps({'version':version,'architecture':'win-amd64','source':url,'sha256':actual.hex(),'digestMatchedOfficialBundle':True,'signatureIdentityVerified':False,'wheels':wheel_records},indent=2))
print('Bundled Python and all Windows wheels',flush=True)

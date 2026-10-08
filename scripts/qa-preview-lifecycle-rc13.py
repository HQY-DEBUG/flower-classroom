import hashlib,json,os,re,socket,subprocess,tempfile,threading,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
out=Path(os.environ.get('FLOWER_PREVIEW_OUT',root/'artifacts/rc13/ui-review/preview'))
out.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
data=Path(tempfile.mkdtemp(prefix='flower-preview-ui-rc10-'))/'classroom.json'
log=open(out/'server.log','w');proc=subprocess.Popen(['node','scripts/preview.cjs'],cwd=root,env={**os.environ,'PORT':str(port),'FLOWER_PREVIEW_DATA':str(data)},stdout=log,stderr=subprocess.STDOUT)
checks=[]
def request(p,body=None):
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+p,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=5) as r:return r.status,r.read()
try:
 for _ in range(100):
  try: _,body=request('/api/state'); break
  except urllib.error.URLError:time.sleep(.03)
 state=json.loads(body)['state']
 _,html=request('/')
 for route in re.findall(r'(?:href|src)="([\w-]+\.(?:css|js))"',html.decode()):
  try:status,body=request('/'+route)
  except urllib.error.HTTPError as e:status=e.code;body=e.read()
  checks.append({'name':'Linked asset '+route,'status':'passed' if status==200 else 'failed','httpStatus':status,'bytes':len(body)})
 stream=urllib.request.urlopen(f'http://127.0.0.1:{port}/api/events',timeout=5)
 assert stream.readline().startswith(b': connected')
 stream.readline()
 status,body=request('/api/restore',{'state':state,'expectedRevision':state['revision']})
 event=json.loads(stream.readline().decode().removeprefix('data: '));stream.close()
 assert event['change']['type']=='data' and event['change']['restored'] is True,event['change']
 assert event['change']['restoreGeneration']==1,event['change']
 assert json.loads(request('/api/state')[1])['restoreGeneration']==1
 checks.append({'name':'Restore broadcasts explicit metadata with exact committed state','status':'passed','change':event['change']})
 assert event['state']==json.loads(body)==json.loads(data.read_text())
 checks.append({'name':'Stream, response and disk agree after synthetic restore','status':'passed'})
except Exception as e:checks.append({'name':'Preview harness','status':'failed','error':repr(e)})
finally:
 proc.terminate();proc.wait(timeout=5);log.close()
 result={'syntheticOnly':True,'windowsExecuted':False,'surface':'localhost source preview only; not production ASAR','scriptSha256':hashlib.sha256((root/'scripts/preview.cjs').read_bytes()).hexdigest(),'checks':checks}
 (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps({'passed':sum(c['status']=='passed' for c in checks),'failed':[c for c in checks if c['status']=='failed']},ensure_ascii=False))
 raise SystemExit(any(c['status']=='failed' for c in checks))

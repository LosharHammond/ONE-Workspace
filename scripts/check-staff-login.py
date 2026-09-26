"""Read-only login checks against the local portal; does not change passwords."""
import json,sys,urllib.request,urllib.error
base='http://localhost:5173';password=sys.stdin.readline().strip()
def request(path,data=None,cookie=None,origin=base):
    headers={'Origin':origin,'Content-Type':'application/json'}
    if cookie:headers['Cookie']=cookie
    req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
    try:r=urllib.request.urlopen(req,timeout=30)
    except urllib.error.HTTPError as e:r=e
    raw=r.read()
    try:body=json.loads(raw)
    except ValueError:body={}
    return r.status,body,r.headers.get('Set-Cookie','').split(';')[0]
assert request('/api/company-data')[0]==401
assert request('/api/auth/login',{'login':'hammond@procusghana.com','password':password},origin='https://untrusted.example')[0]==403
assert request('/api/auth/login',{'login':'hammond@procusghana.com','password':'incorrect'})[0]==401
status,body,cookie=request('/api/auth/login',{'login':'hammond@procusghana.com','password':password})
assert status==200,(status,body)
assert body['mustChange'] is True
status,body,_=request('/api/workspace',cookie=cookie)
assert status==200 and body['user']['role']=='admin' and body['user']['mustChange'] and body['records']==[]
assert request('/api/company-data',cookie=cookie)[0]==403
assert request('/api/members',cookie=cookie)[0]==403
print('PASS: anonymous denial, origin check, wrong-password denial, administrator login and mandatory password-change gate.')


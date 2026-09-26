"""Provision local staff accounts from the private archive. Password arrives on stdin.
Existing passwords are never overwritten. Login permissions are explicit here,
not copied from Asset Infinity roles. Inactive source staff remain disabled.
"""
import collections,hashlib,json,pathlib,re,secrets,sqlite3,sys,datetime
root=pathlib.Path(__file__).resolve().parents[1];private=root/'work/company-data'
if len(sys.argv)!=2:raise SystemExit('Provide an approved account-list JSON file containing staff email addresses or source row IDs.')
approved=set(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')))
approved.add('hammond@procusghana.com')
password=sys.stdin.readline().rstrip('\r\n')
if len(password)<8:raise SystemExit('Initial password is required on stdin.')
db=sqlite3.connect(private/'procus.sqlite')
db.executescript('''CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,department TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passwords(member_id TEXT PRIMARY KEY REFERENCES members(id),username TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,iterations INTEGER NOT NULL,must_change INTEGER NOT NULL DEFAULT 1);''')
rows=[(rid,json.loads(p)) for rid,p in db.execute("SELECT r.id,r.payload_json FROM source_rows r JOIN import_batches b ON b.id=r.batch_id WHERE b.dataset='staff' ORDER BY r.row_number")]
def email(p):
    s=str(p.get('E Mail') or '').strip().lower()
    return s if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',s) else ''
counts=collections.Counter(email(p) for _,p in rows); report=[]
if not any(email(p)=='hammond@procusghana.com' for _,p in rows):rows.append(('primary-admin',{'Full Name':'Hammond','E Mail':'hammond@procusghana.com','Staff Department':'IT','Is Active':'true'}))
for rid,p in rows:
    if rid not in approved and email(p) not in approved:continue
    mid='staff:'+rid;name=str(p.get('Full Name') or 'Staff member').strip();em=email(p)
    username=re.sub(r'[^a-z0-9]+','.',name.lower()).strip('.')[:50] or 'staff'
    username+='.'+rid[:6]
    admin=em=='hammond@procusghana.com';role='admin' if admin else 'employee'
    if admin:username='hammond'
    active=1 if admin or str(p.get('Is Active')).lower() not in ('false','0','no') else 0
    issues=[]
    if not em:issues.append('Missing or invalid email; use username')
    elif counts[em]>1:issues.append('Duplicate email; use username')
    if em.endswith('@pr0cusghana.com'):issues.append('Possible email domain typo; use username pending review')
    if not active:issues.append('Inactive in staff source; account disabled')
    if db.execute('SELECT 1 FROM members WHERE id=?',(mid,)).fetchone():continue
    salt=secrets.token_hex(32);hashed=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),100000).hex()
    with db:
        db.execute('INSERT INTO members VALUES(?,?,?,?,?,?,?)',(mid,name,em,role,str(p.get('Staff Department') or 'Unassigned'),active,datetime.datetime.now(datetime.timezone.utc).isoformat()))
        db.execute('INSERT INTO passwords VALUES(?,?,?,?,?,1)',(mid,username,salt,hashed,100000))
    report.append({'name':name,'email':em,'username':username,'role':role,'enabled':bool(active),'issues':issues})
(private/'staff-accounts.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'created':len(report),'enabled':sum(x['enabled'] for x in report),'review_required':sum(bool(x['issues']) for x in report),'administrators':[x['email'] for x in report if x['role']=='admin']}))

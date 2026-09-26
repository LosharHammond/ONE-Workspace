"""Read approved XLSX exports into a private, provenance-preserving SQLite archive.
Never evaluates formulas, downloads attachments, or grants login permissions.
Usage: python scripts/import-company-data.py manifest.json
"""
import argparse, collections, datetime, hashlib, json, pathlib, shutil, sqlite3
import openpyxl

def digest(value):
    return hashlib.sha256(value).hexdigest()

def run(manifest_path):
    manifest = json.loads(pathlib.Path(manifest_path).read_text(encoding='utf-8-sig'))
    root = pathlib.Path(__file__).resolve().parents[1]
    private = root / 'work' / 'company-data'
    private.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(private / 'procus.sqlite')
    db.executescript('''
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY,source TEXT NOT NULL,dataset TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL,imported_at TEXT NOT NULL,row_count INTEGER NOT NULL,headers_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_rows(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES import_batches(id),source_key TEXT,sheet TEXT NOT NULL,row_number INTEGER NOT NULL,payload_json TEXT NOT NULL,UNIQUE(batch_id,sheet,row_number));
      CREATE INDEX IF NOT EXISTS source_rows_batch ON source_rows(batch_id);
      CREATE TABLE IF NOT EXISTS links(from_id TEXT NOT NULL REFERENCES source_rows(id),to_id TEXT NOT NULL REFERENCES source_rows(id),kind TEXT NOT NULL,PRIMARY KEY(from_id,to_id,kind));
      CREATE TABLE IF NOT EXISTS quality_issues(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,kind TEXT NOT NULL,detail_json TEXT NOT NULL);
    ''')
    results=[]
    for spec in manifest:
        path=pathlib.Path(spec['path']); raw=path.read_bytes(); sha=digest(raw)
        bid=digest((spec['source']+':'+spec['dataset']+':'+sha).encode())
        shutil.copy2(path,private / (sha[:16]+'-'+path.name))
        wb=openpyxl.load_workbook(path,read_only=True,data_only=True)
        ws=wb[spec['sheet']] if spec.get('sheet') else wb.active
        values=list(ws.values); header_row=spec.get('header_row',1)
        original=[str(v).strip() if v is not None else '' for v in values[header_row-1]]
        seen=collections.Counter(); headers=[]
        for i,h in enumerate(original):
            h=h or f'Unnamed column {i+1}';seen[h]+=1
            headers.append(h if seen[h]==1 else f'{h} [{seen[h]}]')
        missing=set(spec.get('keys',[]))-set(headers)
        if missing:raise ValueError(f'{path.name}: missing key columns {missing}')
        rows=[]; keys=collections.defaultdict(list)
        for n,vs in enumerate(values[header_row:],header_row+1):
            if not any(v is not None for v in vs):continue
            payload=dict(zip(headers,vs)); key=' | '.join(str(payload.get(k) or '').strip() for k in spec.get('keys',[]))
            rid=digest(f'{bid}:{ws.title}:{n}'.encode())
            rows.append((rid,bid,key,ws.title,n,json.dumps(payload,default=str,ensure_ascii=False)))
            if key:keys[key.casefold()].append(n)
        now=datetime.datetime.now(datetime.timezone.utc).isoformat()
        with db:
            db.execute('INSERT OR IGNORE INTO import_batches VALUES (?,?,?,?,?,?,?,?)',(bid,spec['source'],spec['dataset'],path.name,sha,now,len(rows),json.dumps(headers)))
            db.executemany('INSERT INTO source_rows VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_key=excluded.source_key',rows)
            duplicates={k:v for k,v in keys.items() if len(v)>1}
            if duplicates:db.execute('INSERT OR REPLACE INTO quality_issues VALUES (?,?,?,?)',(bid+':duplicates',bid,'Duplicate source keys',json.dumps(duplicates)))
        expected=spec.get('expected_rows')
        results.append({'dataset':spec['dataset'],'source':spec['source'],'rows':len(rows),'expected_rows':expected,'count_matches':expected is None or expected==len(rows),'columns':len(headers),'duplicate_keys':len(duplicates),'sha256':sha})
        wb.close()
    # Link only unambiguous staff IDs; retain ambiguous records for review.
    staff=collections.defaultdict(list); emails=collections.defaultdict(list); names=collections.defaultdict(list); assets=[]
    for rid,ds,payload in db.execute('SELECT r.id,b.dataset,r.payload_json FROM source_rows r JOIN import_batches b ON b.id=r.batch_id'):
        p=json.loads(payload); key=str(p.get('Staff ID') or '').strip().casefold()
        if ds=='staff':
            if key:staff[key].append(rid)
            email=str(p.get('E Mail') or '').strip().casefold()
            name=str(p.get('Full Name') or '').strip().casefold()
            if '@' in email:emails[email].append(rid)
            if name:names[name].append(rid)
        if ds=='it-assets':assets.append((rid,key,p))
    with db:
        for rid,key,p in assets:
            email=str(p.get('E Mail') or '').strip().casefold();name=str(p.get('Full Name') or '').strip().casefold()
            candidates=staff[key] if key and len(staff[key])==1 else emails[email] if '@' in email and len(emails[email])==1 else names[name]
            kind='assigned_staff_id' if candidates==staff[key] and len(candidates)==1 else 'assigned_staff_email' if candidates==emails[email] and len(candidates)==1 else 'assigned_staff_exact_name'
            if len(candidates)==1:db.execute('INSERT OR IGNORE INTO links VALUES (?,?,?)',(rid,candidates[0],kind))
    report={'datasets':results,'verified_links':db.execute('SELECT count(*) FROM links').fetchone()[0],'database':str(private/'procus.sqlite'),'note':'Private source archive. Not a live sync. Source roles grant no portal access. Attachment URLs are preserved only.'}
    (private/'import-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2));db.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('manifest');args=parser.parse_args();run(args.manifest)

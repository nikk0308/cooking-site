#!/usr/bin/python3
import os,sys,json,hashlib,subprocess,datetime,tarfile,uuid,fcntl,logging,re,time,urllib.request,urllib.error,shutil
from pathlib import Path
import contextlib
import offsite_retention as retention
import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
logging.disable(logging.CRITICAL)
ROOT=Path("/opt/docker-stacks/recipes/backup/offsite")
PRIVATE=ROOT/"private"; STATE=ROOT/"state"
LOCAL=Path("/opt/docker-backups/recipes/daily")
STAGING=Path("/opt/docker-backups/recipes/offsite-staging")
EXPORTS=Path("/opt/docker-backups/recipes/offsite-recovery-export")
AGE=ROOT/"bin/age"
BUCKET="culinote-backups"; ENDPOINT="https://fra1.digitaloceanspaces.com"
ORIGIN="https://culinote-backups.fra1.digitaloceanspaces.com"
APP="culinote-backup-v1"
os.umask(0o077)
class GateError(Exception):pass
def now():return datetime.datetime.now(datetime.timezone.utc)
def sha(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for b in iter(lambda:f.read(1048576),b""):h.update(b)
 return h.hexdigest()
def atomic(path,data):
 path=Path(path);tmp=path.with_name(path.name+".new-"+uuid.uuid4().hex[:8])
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,"w") as f:json.dump(data,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
def read_json(path):
 with open(path) as f:return json.load(f)
def load_config():
 p=PRIVATE/"config.json"
 if not p.exists():raise GateError("OWNER_CONFIGURATION_REQUIRED")
 d=read_json(p)
 if not d.get("recovery_saved_off_server") or not re.fullmatch(r"age1[0-9a-z]{58}",d.get("recipient","")):
  raise GateError("RECOVERY_CUSTODY_CONFIRMATION_REQUIRED")
 return d
def credentials():
 p=Path(os.environ.get("CREDENTIALS_DIRECTORY",str(PRIVATE)))/"spaces"
 if not p.exists():raise GateError("SPACES_CREDENTIALS_REQUIRED")
 return read_json(p)
def client(values=None):
 c=credentials() if values is None else values
 return boto3.session.Session(aws_access_key_id=c["access_key_id"],aws_secret_access_key=c["secret_access_key"],region_name="fra1").client("s3",endpoint_url=ENDPOINT,verify=True,config=Config(signature_version="s3v4",s3={"addressing_style":"virtual"},retries={"mode":"standard","total_max_attempts":3},connect_timeout=10,read_timeout=120,request_checksum_calculation="when_required",response_checksum_validation="when_required"))
def safe_code(exc):
 if isinstance(exc,(GateError,retention.RetentionError)):return str(exc)
 code=getattr(exc,"response",{}).get("Error",{}).get("Code",type(exc).__name__)
 return re.sub(r"[^A-Za-z0-9_-]","",str(code))[:80]
def anonymous_denied(url):
 try:
  with urllib.request.urlopen(url,timeout=20) as r:return False
 except urllib.error.HTTPError as e:return e.code in (403,404)
def probe(s3):
 s3.list_objects_v2(Bucket=BUCKET,Prefix="culinote/",MaxKeys=1)
 if not anonymous_denied(ORIGIN+"/?list-type=2&max-keys=1"):raise GateError("REMOTE_BUCKET_LISTING_PUBLIC")
 return {"authentication":"PASS","anonymous_listing":"DENIED","deletion_enabled":False}
def latest_local():
 result=subprocess.check_output(["systemctl","show","recipes-backup.service","-p","Result","--value"],text=True).strip()
 if result!="success":raise GateError("LOCAL_BACKUP_SERVICE_NOT_SUCCESSFUL")
 candidates=sorted(p for p in LOCAL.iterdir() if p.is_dir() and (p/"COMPLETE").is_file())
 if not candidates:raise GateError("NO_COMPLETE_LOCAL_BACKUP")
 p=candidates[-1];m=read_json(p/"manifest.json")
 stamp=datetime.datetime.fromisoformat(m["completed_utc"])
 if (now()-stamp).total_seconds()>36*3600:raise GateError("LOCAL_BACKUP_OLDER_THAN_36_HOURS")
 app=json.loads(subprocess.check_output(["docker","inspect","recipes-app-1"]))[0]
 if m["source_sha"]!=app["Config"]["Labels"]["org.opencontainers.image.revision"]:raise GateError("LOCAL_BACKUP_DEPLOYED_SHA_MISMATCH")
 for name in ("recipes.dump","media.tar.gz","manifest.json","database-state.json","media-manifest.json","restore-list.txt","SHA256SUMS"):
  q=p/name
  if q.is_symlink() or not q.is_file():raise GateError("UNSAFE_OR_MISSING_LOCAL_BACKUP_FILE")
 checked=set()
 for line in (p/"SHA256SUMS").read_text().splitlines():
  digest,name=line.split("  ",1)
  if name not in {"recipes.dump","media.tar.gz","manifest.json","database-state.json","media-manifest.json","restore-list.txt"} or name in checked or sha(p/name)!=digest:raise GateError("LOCAL_CHECKSUM_MISMATCH")
  checked.add(name)
 if checked!={"recipes.dump","media.tar.gz","manifest.json","database-state.json","media-manifest.json","restore-list.txt"}:raise GateError("LOCAL_CHECKSUM_INVENTORY_INCOMPLETE")
 for name,item in m["files"].items():
  if name not in checked or (p/name).stat().st_size!=item["bytes"] or sha(p/name)!=item["sha256"]:raise GateError("LOCAL_MANIFEST_FILE_MISMATCH")
 return p,m
def encrypt(source,target,recipient):
 if target.exists():raise GateError("ENCRYPTED_TARGET_ALREADY_EXISTS")
 temp=target.with_name(target.name+".partial")
 if temp.exists():raise GateError("ENCRYPTION_PARTIAL_REQUIRES_REVIEW")
 r=subprocess.run([str(AGE),"-r",recipient,"-o",str(temp),str(source)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if r.returncode:raise GateError("AGE_ENCRYPTION_FAILED")
 with open(temp,"rb") as f:
  if f.read(22)!=b"age-encryption.org/v1\n":raise GateError("AGE_HEADER_INVALID")
 os.replace(temp,target)
def prepare(local,manifest,cfg):
 fingerprint=hashlib.sha256(cfg["recipient"].encode()).hexdigest()
 sid=local.name+"-"+fingerprint[:12]
 STAGING.mkdir(mode=0o700,exist_ok=True);dest=STAGING/sid
 if dest.exists():
  if not (dest/"staging.json").is_file():raise GateError("STAGING_INCOMPLETE_REQUIRES_REVIEW")
  marker=read_json(dest/"staging.json")
  if marker["local_manifest_sha256"]!=sha(local/"manifest.json") or marker["recipient_fingerprint"]!=fingerprint:raise GateError("STAGING_IDENTITY_MISMATCH")
  for name,data in marker["objects"].items():
   if sha(dest/name)!=data["sha256"] or (dest/name).stat().st_size!=data["bytes"]:raise GateError("STAGING_CIPHERTEXT_CORRUPT")
  return dest,marker
 dest.mkdir(mode=0o700)
 pack=dest/"recovery-manifest.tar"
 with tarfile.open(pack,"w") as archive:
  for name in ("manifest.json","database-state.json","media-manifest.json","SHA256SUMS","restore-list.txt"):
   archive.add(local/name,arcname=name,recursive=False)
 objects={}
 for name,source in (("database.encrypted",local/"recipes.dump"),("media.encrypted",local/"media.tar.gz"),("manifest.encrypted",pack)):
  encrypt(source,dest/name,cfg["recipient"])
  objects[name]={"sha256":sha(dest/name),"bytes":(dest/name).stat().st_size,"key":"culinote/blobs/"+sid+"/"+name}
 marker={"application":APP,"format":1,"snapshot":sid,"source_sha":manifest["source_sha"],"backup_created_utc":manifest["completed_utc"],"recipient_fingerprint":fingerprint,"local_manifest_sha256":sha(local/"manifest.json"),"objects":objects,"verification":"ciphertext-size-and-full-download-sha256","private_identity_on_server":False}
 atomic(dest/"staging.json",marker)
 return dest,marker
def object_exists(s3,key):
 try:return s3.head_object(Bucket=BUCKET,Key=key)
 except Exception as e:
  if getattr(e,"response",{}).get("Error",{}).get("Code") in ("404","NoSuchKey","NotFound"):return None
  raise
def verify_object(s3,key,expected):
 head=s3.head_object(Bucket=BUCKET,Key=key)
 if head["ContentLength"]!=expected["bytes"]:raise GateError("REMOTE_OBJECT_SIZE_MISMATCH")
 obj=s3.get_object(Bucket=BUCKET,Key=key)["Body"];h=hashlib.sha256();size=0
 try:
  while True:
   b=obj.read(1048576)
   if not b:break
   h.update(b);size+=len(b)
 finally:obj.close()
 if size!=expected["bytes"] or h.hexdigest()!=expected["sha256"]:raise GateError("REMOTE_DOWNLOAD_SHA256_MISMATCH")
def get_marker(s3,key):
 body=s3.get_object(Bucket=BUCKET,Key=key)["Body"]
 try:data=body.read(1048577)
 finally:body.close()
 if len(data)>1048576:raise GateError("REMOTE_MARKER_TOO_LARGE")
 return json.loads(data)
def validate_marker(d):
 if d.get("application")!=APP or not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{12}",d.get("snapshot","")):raise GateError("UNRECOGNIZED_REMOTE_POINT")
 if set(d["objects"])!={"database.encrypted","media.encrypted","manifest.encrypted"}:raise GateError("INCOMPLETE_REMOTE_POINT")
 for name,item in d["objects"].items():
  if item["key"]!="culinote/blobs/"+d["snapshot"]+"/"+name or not re.fullmatch(r"[a-f0-9]{64}",item["sha256"]):raise GateError("UNSAFE_REMOTE_OBJECT_REFERENCE")
 return d
def publish(s3,dest,marker):
 validate_marker(marker)
 sid=marker["snapshot"];key="culinote/daily/"+sid+"/COMPLETE"
 if object_exists(s3,key):
  old=validate_marker(get_marker(s3,key))
  if old!=marker:raise GateError("IMMUTABLE_REMOTE_POINT_CONFLICT")
 for name,item in marker["objects"].items():
  exists=object_exists(s3,item["key"])
  if not exists:
   s3.upload_file(str(dest/name),BUCKET,item["key"],ExtraArgs={"ACL":"private","ContentType":"application/octet-stream","Metadata":{"sha256":item["sha256"],"application":APP}},Config=TransferConfig(multipart_threshold=64*1024**2,multipart_chunksize=64*1024**2,max_concurrency=2))
  verify_object(s3,item["key"],item)
  if not anonymous_denied(ORIGIN+"/"+item["key"]):raise GateError("REMOTE_ENCRYPTED_OBJECT_PUBLIC")
 payload=json.dumps(marker,sort_keys=True,separators=(",",":")).encode()
 if not object_exists(s3,key):
  s3.put_object(Bucket=BUCKET,Key=key,Body=payload,ACL="private",ContentType="application/json")
 if get_marker(s3,key)!=marker:raise GateError("REMOTE_COMPLETE_MARKER_MISMATCH")
 if not anonymous_denied(ORIGIN+"/"+key):raise GateError("REMOTE_COMPLETE_MARKER_PUBLIC")
 month=marker["backup_created_utc"][:7]
 monthly="culinote/monthly/"+month+"/COMPLETE"
 if not object_exists(s3,monthly):
  s3.put_object(Bucket=BUCKET,Key=monthly,Body=payload,ACL="private",ContentType="application/json")
 validate_marker(get_marker(s3,monthly))
 if not anonymous_denied(ORIGIN+"/"+monthly):raise GateError("REMOTE_MONTHLY_MARKER_PUBLIC")
 retention.ensure_periods(sys.modules[__name__],s3,marker)
 return key
@contextlib.contextmanager
def retention_lock():
 with open(STATE/"upload.lock","a") as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  yield

def retention_inputs():
 failure=STATE/"last-upload-failure.json"
 return (read_json(STATE/"remote-restore-proof.json"),read_json(STATE/"last-success.json"),read_json(failure) if failure.exists() else None)

def retention_dry_run(s3,pending_success=None):
 latest_local()  # Failed, stale or incompatible local backups block retention.
 proof=read_json(STATE/"remote-restore-proof.json")
 success=pending_success or read_json(STATE/"last-success.json")
 failure_path=STATE/"last-upload-failure.json"
 failure=read_json(failure_path) if failure_path.exists() else None
 plan=retention.plan(sys.modules[__name__],s3,proof,success,failure)
 atomic(STATE/"retention-dry-run.json",plan)
 return plan
def export_remote(s3):
 state=read_json(STATE/"last-success.json")
 marker=validate_marker(get_marker(s3,state["complete_key"]))
 EXPORTS.mkdir(mode=0o700,exist_ok=True);dest=EXPORTS/marker["snapshot"]
 dest.mkdir(mode=0o700,exist_ok=True)
 for name,item in marker["objects"].items():
  q=dest/name
  if q.exists():
   if sha(q)!=item["sha256"]:raise GateError("EXPORTED_CIPHERTEXT_MISMATCH")
  else:
   body=s3.get_object(Bucket=BUCKET,Key=item["key"])["Body"]
   try:
    with open(q,"xb") as f:
     while True:
      b=body.read(1048576)
      if not b:break
      f.write(b)
   finally:body.close()
   if sha(q)!=item["sha256"] or q.stat().st_size!=item["bytes"]:raise GateError("REMOTE_EXPORT_CHECKSUM_FAILED")
 atomic(dest/"REMOTE-COMPLETE.json",marker)
 print(str(dest))
def watchdog():
 load_config()
 p=STATE/"last-success.json"
 if not p.exists():raise GateError("NO_SUCCESSFUL_OFFSITE_BACKUP")
 s=read_json(p)
 if (now()-datetime.datetime.fromisoformat(s["backup_created_utc"])).total_seconds()>36*3600:raise GateError("OFFSITE_RECOVERY_POINT_OLDER_THAN_36_HOURS")
 failure=STATE/"last-upload-failure.json"
 if failure.exists() and read_json(failure)["utc"]>s["verified_utc"]:raise GateError("LATEST_OFFSITE_UPLOAD_FAILED")
 s3=client()
 marker=validate_marker(get_marker(s3,s["complete_key"]))
 if s["complete_key"]!="culinote/daily/"+s["snapshot"]+"/COMPLETE" or marker["snapshot"]!=s["snapshot"]:raise GateError("REMOTE_COMPLETE_STATE_MISMATCH")
 for item in marker["objects"].values():verify_object(s3,item["key"],item)
 for period_key in retention.period_keys(marker):
  period_marker=validate_marker(get_marker(s3,period_key))
  if period_key not in retention.period_keys(period_marker):raise GateError("PERIOD_REFERENCE_MISMATCH")
  for item in period_marker["objects"].values():verify_object(s3,item["key"],item)
 print("CULINOTE_OFFSITE_WATCHDOG_PASS snapshot="+s["snapshot"]+"; complete-and-full-ciphertext-sha256=PASS")
def main(mode="upload"):
 if mode=="watchdog":return watchdog()
 cfg=load_config();s3=client()
 if mode=="export":return export_remote(s3)
 if mode not in ("upload","retention-dry-run"):raise GateError("UNSUPPORTED_OFFSITE_MODE")
 lock=open(STATE/"upload.lock","a")
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print("OFFSITE_SKIPPED_ALREADY_RUNNING");return
 if mode=="retention-dry-run":
  retention_dry_run(s3);print("RETENTION_DRY_RUN_ONLY; deletion disabled");return
 probe_result=probe(s3)
 local,m=latest_local()
 if shutil.disk_usage(STAGING.parent).free<10*1024**3:raise GateError("OFFSITE_FREE_SPACE_BELOW_10_GIB")
 dest,marker=prepare(local,m,cfg)
 key=publish(s3,dest,marker)
 success={"snapshot":marker["snapshot"],"complete_key":key,"backup_created_utc":marker["backup_created_utc"],"verified_utc":now().isoformat(),"source_sha":marker["source_sha"],"remote_ciphertext_verification":"PASS","decryption_restore":("PASS" if (STATE/"remote-restore-proof.json").exists() and read_json(STATE/"remote-restore-proof.json").get("snapshot")==marker["snapshot"] and read_json(STATE/"remote-restore-proof.json").get("status")=="PASS" else "PENDING_OWNER_DRILL"),"probe":probe_result}
 retention_dry_run(s3,success)
 atomic(STATE/"last-success.json",success)
 print("CULINOTE_ENCRYPTED_OFFSITE_UPLOAD_VERIFIED snapshot="+marker["snapshot"]+"; ciphertext verified; consult remote-restore-proof for owner restore coverage")
if __name__=="__main__":
 try:main(sys.argv[1] if len(sys.argv)>1 else "upload")
 except Exception as e:
  code=safe_code(e)
  atomic(STATE/"last-failure.json",{"utc":now().isoformat(),"code":code,"mode":sys.argv[1] if len(sys.argv)>1 else "upload"})
  if len(sys.argv)==1 or sys.argv[1]=="upload":atomic(STATE/"last-upload-failure.json",{"utc":now().isoformat(),"code":code})
  print("CULINOTE_OFFSITE_FAILURE code="+code,file=sys.stderr);sys.exit(1)

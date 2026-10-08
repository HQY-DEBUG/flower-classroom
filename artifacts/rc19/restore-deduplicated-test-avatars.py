import json,shutil,hashlib
from pathlib import Path
for row in json.loads(Path(__file__).with_name("temp-avatar-dedup-plan.json").read_text()):
 p=Path(row["path"]);src=Path(row["canonical"]);assert hashlib.sha256(src.read_bytes()).hexdigest()==row["sha256"]
 if not p.exists():p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,p)

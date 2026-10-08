from pathlib import Path
import functools,http.server,threading,subprocess,os
base=Path(__file__).resolve().parent
root=base/'cloud-pristine-extraction'
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root))
server=http.server.ThreadingHTTPServer(('127.0.0.1',40897),handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 result=subprocess.run(['node_modules/.bin/electron','--no-sandbox','--ozone-platform=headless','--disable-gpu',str(base/'capture-cloud-directory-listings.cjs')],env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-cloud-directory-cache'})
 raise SystemExit(result.returncode)
finally:server.shutdown();server.server_close()

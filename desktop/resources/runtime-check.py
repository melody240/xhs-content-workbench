"""Offline runtime self-check. Does not connect to any platform."""
import sys,ssl,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'workbench/vendor/xiaohongshu-skills/scripts'))
import requests,websockets.sync.client,python_socks,cli
# Python-socks publishes python_socks, not the unrelated PySocks package.
print(json.dumps({'ok':True,'python':sys.version.split()[0],'ssl':ssl.OPENSSL_VERSION,'cli':'available'}))

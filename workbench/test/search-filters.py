import sys, unittest
sys.path.insert(0, 'integrations')
from search_filters import apply_filters, SNAPSHOT
from unittest.mock import patch
class Page:
 def __init__(self, changed=True): self.calls=[]; self.changed=changed; self.snapshots=0
 def evaluate(self, script):
  self.calls.append(script)
  if script==SNAPSHOT:
   self.snapshots+=1
   return '[new]' if self.changed and self.snapshots>1 else '[old]'
  if "const b=document" in script: return True
  if script.startswith('!!'): return True
  return {'already':False}
class Tests(unittest.TestCase):
 def test_normal(self):
  p=Page();done=[];apply_filters(p,[(1,'最新')],lambda _:done.append(True));self.assertEqual(done,[True]);self.assertFalse(any('setInterval' in s or 'new Promise' in s for s in p.calls))
 def test_stale(self):
  p=Page(False)
  with patch('search_filters.time.monotonic',side_effect=[0,0,0,100]):
   with self.assertRaisesRegex(ValueError,'未刷新'): apply_filters(p,[(1,'最新')],lambda _:self.fail('stale accepted'))
unittest.main()

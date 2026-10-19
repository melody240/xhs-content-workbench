import sys, unittest
from unittest.mock import patch
sys.path.insert(0, 'integrations')
from detail_comments import wait_visible_comments, VISIBLE_COMMENTS

class Page:
    def __init__(self, results):
        self.results = iter(results)
        self.calls = 0
    def evaluate(self, script):
        if script == VISIBLE_COMMENTS:
            self.calls += 1
            return next(self.results)

class Tests(unittest.TestCase):
    def test_waits_past_empty_snapshot_for_stable_real_comment(self):
        comment = {'id':'real-id','content':'真实页面评论','likeCount':'17'}
        p = Page([{'comments':[]}, {'comments':[comment]}, {'comments':[comment]}])
        with patch('detail_comments.time.sleep'):
            self.assertEqual(wait_visible_comments(p), [comment])
        self.assertEqual(p.calls, 3)
    def test_real_empty_state_returns_without_retry_loop(self):
        p = Page([{'comments':[], 'empty':True}])
        self.assertEqual(wait_visible_comments(p), [])
        self.assertEqual(p.calls, 1)
    def test_deadline_returns_empty_instead_of_inventing_comments(self):
        p = Page([{'comments':[]}])
        with patch('detail_comments.time.monotonic', side_effect=[0,0,7]), patch('detail_comments.time.sleep'):
            self.assertEqual(wait_visible_comments(p), [])
        self.assertEqual(p.calls, 1)

unittest.main()

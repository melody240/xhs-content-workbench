import sys, unittest
from unittest.mock import patch
sys.path.insert(0,'integrations')
from diandian import read_summary, matches_query, search_url

class Page:
    def __init__(self,values):
        self.values=iter(values)
        self.calls=0
    def evaluate(self,script):
        self.calls+=1
        return next(self.values)

class Tests(unittest.TestCase):
    def value(self,**overrides):
        return {'url':search_url('微习惯'),'status':'candidate','content':'从一个可以完成的小行动开始。','platformNoteCount':83,**overrides}
    def test_query_bound_and_normal_unicode_url(self):
        self.assertTrue(matches_query(search_url('微习惯'),'微习惯'))
        self.assertTrue(matches_query('https://www.xiaohongshu.com/search_result?keyword=%E5%BE%AE%E4%B9%A0%E6%83%AF','微习惯'))
        self.assertFalse(matches_query(search_url('减肥'),'微习惯'))
        self.assertFalse(matches_query('https://evil.test/search_result_ai?keyword=微习惯','微习惯'))
    def test_streaming_is_not_saved_before_stable_complete_content(self):
        values=[self.value(status='loading',content='不完整'),self.value(content='一部分'),self.value(),self.value(),self.value(),self.value()]
        p=Page(values)
        with patch('diandian.time.sleep'):
            result=read_summary(p,'微习惯')
        self.assertEqual(result['status'],'ready')
        self.assertEqual(result['content'],'从一个可以完成的小行动开始。')
        self.assertEqual(result['platformNoteCount'],83)
        self.assertEqual(p.calls,6)
    def test_changed_keyword_rejected_and_missing_summary_is_optional(self):
        p=Page([self.value(url=search_url('减肥'))])
        self.assertEqual(read_summary(p,'微习惯')['status'],'unavailable')
        p=Page([self.value(status='unavailable',content='')])
        with patch('diandian.time.monotonic',side_effect=[0,0,16]),patch('diandian.time.sleep'):
            result=read_summary(p,'微习惯')
        self.assertEqual(result['status'],'unavailable')
        self.assertNotIn('content',result)
    def test_browser_error_does_not_invent_summary(self):
        p=Page([])
        self.assertEqual(read_summary(p,'微习惯')['status'],'unavailable')

unittest.main()

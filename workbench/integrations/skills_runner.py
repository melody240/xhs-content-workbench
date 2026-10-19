"""Execute the bundled CLI with the workbench's authenticated, pinned connection.
No Cookie import/export or auto-launch fallback. The bridge is owned by Node.
"""
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'vendor' / 'xiaohongshu-skills'
sys.path.insert(0, str(root / 'scripts'))
from xhs.bridge import BridgePage
import websockets.sync.client as websocket

def call(self, method, params=None):
    message = {'role': 'cli', 'token': os.environ['XHS_WORKBENCH_TOKEN'],
               'session': os.environ['XHS_WORKBENCH_SESSION'], 'method': method, 'params': params or {}}
    with websocket.connect(os.environ['XHS_WORKBENCH_BRIDGE'], open_timeout=5, proxy=None,
                           max_size=50 * 1024 * 1024) as ws:
        ws.send(json.dumps(message, ensure_ascii=False))
        result = json.loads(ws.recv(timeout=95))
    if result.get('error'):
        raise RuntimeError(result['error'])
    return result.get('result')

BridgePage._call = call
BridgePage.is_server_running = lambda self: bool(self._call("ping_server"))
BridgePage.is_extension_connected = lambda self: bool(self._call("ping_server").get("extension_connected"))
# Importing the CLI doesn't run its parser. Disable its unauthenticated fallback server.
import cli

def ensure_ready(url):
    if not BridgePage().is_extension_connected():
        raise RuntimeError('浏览器扩展已断开，请重新连接后核实账号。')
cli._ensure_bridge_ready = ensure_ready

# Use the platform's explicit image route for image composition. Its generic
# publish URL otherwise reopens the video uploader on some editor sessions.
if sys.argv[1:2] == ['fill-publish']:
    import xhs.publish as image_publish_module
    image_publish_module.PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image'


# The upstream detail reader retries verification through other pages.
# Keep the extraction implementation, but require a human for access challenges.
import xhs.feed_detail as detail_module
from xhs.errors import PageNotAccessibleError
from xhs.urls import make_feed_detail_url
from xhs.selectors import ACCESS_ERROR_WRAPPER

def check_access_once(page, url="", keyword=""):
    message = page.get_element_text(ACCESS_ERROR_WRAPPER)
    if message and message.strip():
        raise PageNotAccessibleError('页面需要人工处理：' + message.strip())

def read_detail_once(page, feed_id, xsec_token, load_all_comments=False, config=None, keyword=""):
    page.navigate(make_feed_detail_url(feed_id, xsec_token))
    page.wait_for_load()
    page.wait_dom_stable()
    check_access_once(page)
    if load_all_comments:
        detail_module._load_all_comments(page, config or detail_module.CommentLoadConfig(max_comment_items=50))
        check_access_once(page)
    detail = detail_module._extract_feed_detail(page, feed_id)
    if not detail.comments.list_ and not load_all_comments:
        from detail_comments import wait_visible_comments
        from xhs.types import Comment
        visible = wait_visible_comments(page)
        check_access_once(page)
        # The original reader may take its state snapshot before comments render.
        # Only fall back to actual rendered comment cards with platform IDs.
        detail.comments.list_ = [Comment.from_dict(c) for c in visible]
    return detail

detail_module._check_page_accessible = check_access_once
detail_module.get_feed_detail = read_detail_once

# Site timers may remain suspended when another tab is in front. Keep the
# original visible filter controls, but run bounded waiting in this process.
import xhs.search as search_module
from search_filters import apply_filters
search_module._apply_filters = lambda page, filters: apply_filters(page, filters, search_module._wait_for_search_feeds)

# Research reads the website's native summary once, in the existing search tab.
# No new login, hidden endpoint, extra browser or additional public UI control.
if '--diandian' in sys.argv and sys.argv[1] == 'search-feeds':
    sys.argv.remove('--diandian')
    from diandian import read_summary, search_url
    from xhs.errors import NoFeedsError
    normal_search = search_module.search_feeds
    normal_url = search_module.make_search_url
    summary = {'status':'unavailable','reason':'点点暂不可用，继续使用笔记资料。'}
    def search_with_summary(page, keyword, filter_option=None):
        global summary
        search_module.make_search_url = search_url
        try:
            feeds = normal_search(page, keyword, filter_option)
            check_access_once(page)
            summary = read_summary(page, keyword)
        except (NoFeedsError, ValueError):
            # Feature availability varies by account/site version. Do not make
            # optional AI summaries a prerequisite for the original search.
            search_module.make_search_url = normal_url
            feeds = normal_search(page, keyword, filter_option)
            summary = {'status':'unavailable','keyword':keyword,'reason':'站内点点搜索未返回笔记，已使用普通搜索。'}
        finally:
            search_module.make_search_url = normal_url
        return feeds
    search_module.search_feeds = search_with_summary
    normal_output = cli._output
    def output_with_summary(value):
        if isinstance(value,dict) and 'feeds' in value:
            value = {**value,'diandian':summary}
        normal_output(value)
    cli._output = output_with_summary

# Internal research option; leave the bundled upstream CLI unchanged.
if '--list-only' in sys.argv and sys.argv[1] == 'search-feeds':
    sys.argv.remove('--list-only')
    import xhs.search as search_module
    from list_search import collect_lists
    original_search = search_module.search_feeds
    def search_lists(page, keyword, filter_option=None):
        return collect_lists(page, keyword, filter_option, original_search,
                             search_module._EXTRACT_SEARCH_JS, check_access_once,
                             search_module.Feed.from_dict)
    search_module.search_feeds = search_lists
def monitor_self():
    # Follow the actual logged-in sidebar link; never guess a token or import a session.
    from urllib.parse import urljoin, urlparse
    import re
    from xhs.user_profile import _extract_user_profile_data
    page = BridgePage()
    page.navigate('https://www.xiaohongshu.com/explore')
    page.wait_for_load()
    page.wait_dom_stable()
    check_access_once(page)
    href = page.evaluate("""(() => {
      const legacy = document.querySelector('.main-container .user a[href*="/user/profile/"],.side-bar .user a[href*="/user/profile/"]')?.getAttribute('href');
      if (legacy) return legacy;
      const own = [...document.querySelectorAll('a[href*="/user/profile/"]')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && (e.innerText || e.textContent || '').trim() === '我');
      return own.length === 1 ? own[0].getAttribute('href') : '';
    })()""")
    url = urljoin('https://www.xiaohongshu.com', href or '')
    parsed = urlparse(url)
    match = re.fullmatch(r'/user/profile/([a-zA-Z0-9]+)/?', parsed.path)
    if parsed.scheme != 'https' or parsed.hostname != 'www.xiaohongshu.com' or not match:
        raise RuntimeError('账号入口未读取完整，本次采集停止；这不能证明账号退出，请在 Edge 核查页面。')
    page.navigate(url)
    page.wait_for_load()
    page.wait_dom_stable()
    check_access_once(page)
    result = _extract_user_profile_data(page).to_dict()
    result['userId'] = match.group(1)
    return result

try:
    if sys.argv[1:] == ['workbench-monitor-self']:
        print(json.dumps(monitor_self(), ensure_ascii=False))
    else:
        cli.main()
except Exception as error:
    print(json.dumps({'error': str(error)}, ensure_ascii=False))
    sys.exit(2)

"""Wait briefly for rendered comments, without private requests or endless scrolling."""
import time

VISIBLE_COMMENTS = r"""(() => {
 const area=document.querySelector('.comments-container');
 if(!area)return {comments:[],empty:false};
 const rendered=e=>{const r=e?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const comments=[...area.querySelectorAll('.parent-comment[id^="comment-"]')].filter(rendered).slice(0,30).map(root=>{
  const card=root.querySelector(':scope > .comment-item')||root;
  const content=card.querySelector('.content .note-text,.content')?.innerText?.trim()||'';
  const like=card.querySelector('.like-wrapper .count,.like .count,.interactions .like span');
  return {id:root.id.slice(8),content,likeCount:like?.innerText?.trim()||'',userInfo:{nickname:card.querySelector('.name,.user-name,.author')?.innerText?.trim()||''}};
 }).filter(c=>c.id&&c.content);
 const empty=[...area.querySelectorAll('.no-comments,.empty-container')].some(e=>rendered(e)&&/暂无评论|这是一片荒地/.test(e.innerText));
 return {comments,empty};
})()"""

REVEAL_COMMENTS = "document.querySelector('.comments-container')?.scrollIntoView({block:'nearest',behavior:'instant'})"

def wait_visible_comments(page, timeout=6):
    page.evaluate(REVEAL_COMMENTS)
    deadline = time.monotonic() + timeout
    previous = None
    latest = []
    while time.monotonic() < deadline:
        result = page.evaluate(VISIBLE_COMMENTS)
        if isinstance(result, dict):
            latest = result.get('comments') or []
            if latest and latest == previous:
                return latest
            if result.get('empty') and not latest:
                return []
            previous = latest
        time.sleep(.3)
    return latest

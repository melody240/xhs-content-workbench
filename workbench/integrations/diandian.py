"""Read only the rendered, keyword-bound XHS search summary in the same Edge tab."""
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlparse, parse_qs, unquote

def search_url(keyword):
    # This is the route exposed by the current website search UI, not a private API.
    return 'https://www.xiaohongshu.com/search_result_ai?keyword=' + quote(quote(keyword, safe=''), safe='') + '&source=unknown'

SUMMARY_DOM = r"""(() => {
 const rendered=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const marker=/ai\s*总结\s*(\d+)\s*篇笔记生成/i;
 const label=[...document.querySelectorAll('span,p,div')].filter(rendered).find(e=>{
   const t=e.innerText?.trim()||'';return t.length<80&&marker.test(t)&&![...e.children].some(c=>marker.test(c.innerText||''));
 });
 const url=location.href;
 if(!label)return {url,status:'unavailable'};
 // Select the smallest rendered ancestor containing the label and the answer,
 // never the whole page, sidebar, search cards or private application state.
 let area=label,answer='';
 for(let i=0;i<7&&area&&area!==document.body;i++,area=area.parentElement){
   const t=area.innerText?.trim()||'';
   if(t.length>(label.innerText?.length||0)+30&&area.querySelector('h1,h2,h3,h4,p,li')){answer=t;break;}
 }
 if(!answer||!area||area===document.body||area.querySelector('input,textarea,.note-item'))return {url,status:'unavailable'};
 // The footer is a sibling of the answer. A temporary streaming pause must
 // never be mistaken for completion just because the current text is stable.
 let panel=area,finished=false,busy=false;
 for(let i=0;i<4&&panel&&panel!==document.body;i++,panel=panel.parentElement){
   if(panel.querySelector('input,textarea,.note-item'))break;
   const controls=[...panel.querySelectorAll('button,[role="button"]')].filter(rendered);
   busy ||= controls.some(e=>/停止生成|停止回答/.test((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')));
   finished ||= controls.some(e=>/继续与点点对话/.test((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')));
   if(finished||busy)break;
 }
 const text=answer.replace(marker,'').replace(/^(?:点点\s*ai)\s*/i,'').replace(/继续与点点对话\s*$/,'').trim();
 return {url,status:busy||!finished?'loading':'candidate',content:text.slice(0,8000),platformNoteCount:Number(label.innerText.match(marker)[1])};
})()"""

def matches_query(url, keyword):
    try:
        parsed=urlparse(url)
        value=parse_qs(parsed.query).get('keyword',[''])[0]
        return parsed.scheme=='https' and parsed.hostname in ('www.xiaohongshu.com','xiaohongshu.com') and parsed.path in ('/search_result','/search_result_ai') and (value==keyword or unquote(value)==keyword)
    except (ValueError, TypeError):
        return False

def read_summary(page, keyword, timeout=20):
    deadline=time.monotonic()+timeout
    previous=None
    stable=0
    while time.monotonic()<deadline:
        try:
            value=page.evaluate(SUMMARY_DOM)
        except Exception:
            return {'status':'unavailable','keyword':keyword,'reason':'点点总结暂未读到，继续使用笔记资料。'}
        if not isinstance(value,dict) or not matches_query(value.get('url',''),keyword):
            return {'status':'unavailable','keyword':keyword,'reason':'点点页面与本轮关键词不一致，未采用总结。'}
        content=value.get('content','').strip()
        if value.get('status')=='candidate' and content:
            stable=stable+1 if content==previous else 0
            if stable>=3:
                return {'status':'ready','keyword':keyword,'content':content,'url':value['url'],
                        'platformNoteCount':value.get('platformNoteCount'),
                        'collectedAt':datetime.now(timezone.utc).isoformat(),
                        'scope':'平台AI归纳，仅供方向参考；所称笔记数量不是工作台实际阅读数量。'}
            previous=content
        else:
            stable=0
            previous=None
        time.sleep(.5)
    return {'status':'unavailable','keyword':keyword,'reason':'点点未在等待时间内完成总结，继续使用笔记资料。'}

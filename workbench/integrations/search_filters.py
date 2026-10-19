"""Apply normal visible search filters with polling outside the page's timers."""
import json
import time

SNAPSHOT = "JSON.stringify(window.__INITIAL_STATE__?.search?.feeds?.value ?? window.__INITIAL_STATE__?.search?.feeds?._value ?? null)"

def apply_filters(page, filters, wait_feeds, timeout=8):
    snapshot = page.evaluate(SNAPSHOT)
    if not page.evaluate("(() => {const b=document.querySelector('div.filter');if(!b)return false;for(const name of ['mouseover','mouseenter'])b.dispatchEvent(new MouseEvent(name,{bubbles:true}));return true;})()"):
        raise ValueError('筛选入口尚未显示，请在实际页面核查。')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if page.evaluate("!!document.querySelector('div.filters-wrapper')"):
            break
        time.sleep(.25)
    else:
        raise ValueError('筛选面板未打开；登录保留。')
    items = json.dumps(filters, ensure_ascii=False)
    result = page.evaluate("""(() => {
      const wrapper=document.querySelector('div.filters-wrapper');
      if(!wrapper)return {error:'筛选面板已关闭'};
      const targets=ITEMS.map(([index,text]) => {
        const group=wrapper.querySelectorAll('div.filters')[index-1];
        return group && [...group.querySelectorAll('div.tags')].find(e=>e.textContent.trim()===text);
      });
      if(targets.some(e=>!e))return {error:'所需筛选选项未显示'};
      const already=targets.every(e=>/(^|\\s)(active|selected)(\\s|$)/.test(e.className));
      targets.forEach(e=>e.click());return {already};
    })()""".replace('ITEMS', items))
    if not isinstance(result, dict) or result.get('error'):
        raise ValueError((result or {}).get('error', '筛选结果未读取完整'))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = page.evaluate(SNAPSHOT)
        if current and current != 'null' and (current != snapshot or result.get('already')):
            wait_feeds(page)
            return
        time.sleep(.25)
    raise ValueError('筛选结果未刷新，本轮材料已保留；未将旧列表冒充新排序。')

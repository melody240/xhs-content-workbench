// MCP-shaped workbench tools backed exclusively by the connected Edge profile.
// Never silently fall back to the upstream server's separate browser.
const string=description=>({type:'string',description});
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const tool=(name,description,inputSchema=schema())=>({name,description,inputSchema});
const note={feed_id:string('笔记 ID'),xsec_token:string('完整来源链接中的 xsec_token')};
const post={title:string('标题，最多20字'),content:string('正文，最多1000字符'),tags:{type:'array',items:{type:'string'},description:'相关正式话题'},schedule_at:string('ISO8601 定时发布时间'),visibility:string('可见范围'),is_original:{type:'boolean'},products:{type:'array',items:{type:'string'}}};
export const BROWSER_TOOLS=[
 tool('check_login_status','核实当前 Edge 小红书账号；创作后台还需单独检查。'),
 tool('get_my_profile','读取 Edge 当前账号的主页与笔记。',schema({tab:string('当前支持 note')})),
 tool('get_login_qrcode','在 Edge 打开真实登录页面，二维码与验证码均在原页面完成。'),
 tool('check_publish_page','只检查 Edge 创作后台身份和上传控件，不上传或提交。',schema({mode:string('image 或 video')})),
 tool('publish_content','通过 Edge 填写图文并提交；结果以真实页面为证。',schema({...post,images:{type:'array',items:{type:'string'}}},['title','content','images'])),
 tool('publish_with_video','通过 Edge 填写视频并提交；结果以真实页面为证。',schema({...post,video:string('本机视频路径')},['title','content','video'])),
 tool('search_feeds','搜索 Edge 中的真实笔记。',schema({keyword:string('关键词'),filters:schema({sort_by:string('综合、最新、最多点赞、最多评论、最多收藏'),note_type:string('不限、图文、视频')})},['keyword'])),
 tool('list_feeds','读取当前 Edge 首页推荐。'),
 tool('get_feed_detail','读取笔记及可见评论。',schema({...note,load_all_comments:{type:'boolean'}},['feed_id','xsec_token'])),
 tool('user_profile','查看指定用户主页。',schema({user_id:string('用户 ID'),xsec_token:string('完整链接中的 xsec_token')},['user_id','xsec_token'])),
 tool('post_comment_to_feed','发表评论。',schema({...note,content:string('评论内容')},['feed_id','xsec_token','content'])),
 tool('reply_comment_in_feed','回复指定评论。',schema({...note,comment_id:string('评论 ID'),content:string('回复内容')},['feed_id','xsec_token','comment_id','content'])),
 tool('like_feed','点赞或取消点赞。',schema({...note,unlike:{type:'boolean'}},['feed_id','xsec_token'])),
 tool('favorite_feed','收藏或取消收藏。',schema({...note,unfavorite:{type:'boolean'}},['feed_id','xsec_token'])),
];
export function browserCommand(name,args={}) {
 const ref={feedId:args.feed_id,xsecToken:args.xsec_token};
 const map={search_feeds:['search-feeds',{keyword:args.keyword,sortBy:args.filters?.sort_by,noteType:args.filters?.note_type}],list_feeds:['list-feeds',{}],get_feed_detail:['get-feed-detail',{...ref,loadAllComments:args.load_all_comments}],user_profile:['user-profile',{userId:args.user_id,xsecToken:args.xsec_token}],post_comment_to_feed:['post-comment',{...ref,content:args.content}],reply_comment_in_feed:['reply-comment',{...ref,commentId:args.comment_id,content:args.content}],like_feed:['like-feed',{...ref,unlike:args.unlike}],favorite_feed:['favorite-feed',{...ref,unfavorite:args.unfavorite}]};
 if(!map[name])throw Object.assign(new Error('该工具没有 Edge 适配，不能自动改用独立 MCP 浏览器。'),{status:400});
 const [command,input]=map[name];return {command,input:Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined))};
}
export const browserResult=(value,isError=false)=>({isError,content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});

// Measured from the user's 1080px-wide saved X detail screenshot.
// Only the text block's height changes. All coordinates, fonts and icons share one scale.
export const QUOTE_TEMPLATE=Object.freeze({width:1080,left:30,right:30,avatar:72,avatarY:24,nameX:116,nameY:50,nameSize:28,handleY:85,handleSize:26,sourceY:149,bodyY:196,bodySize:30,lineHeight:43,metaSize:26,iconSize:34});
export const QUOTE_EXPORT=Object.freeze({width:1080});
const integer=(a,b,rng)=>Math.floor(a+rng()*(b-a+1));
export function normalizeQuoteMetrics(input={}){const m={};for(const key of ['views','likes','bookmarks','comments','reposts'])m[key]=Math.max(0,Math.min(1e9,Math.floor(Number(input[key])||0)));m.views=Math.max(m.views,m.likes,m.bookmarks,m.comments,m.reposts);return m;}
export function randomQuoteMetrics(rng=Math.random){
 const views=integer(150000,6000000,rng),likes=Math.floor(views*(.04+rng()*.12));
 return {views,likes,bookmarks:Math.floor(likes*(.10+rng()*.55)),comments:Math.floor(likes*(.003+rng()*.047)),reposts:Math.floor(likes*(.02+rng()*.23))};
}
export const quoteCount=n=>Number(n)>=10000?`${(Number(n)/10000).toFixed(1)}万`:Number(n).toLocaleString('en-US');
export function quoteLines(text,measure,width=1020){
 const lines=[];
 for(const paragraph of String(text).replace(/\r\n?/g,'\n').split('\n')){
  if(!paragraph){lines.push('');continue;}
  let line='';
  for(const char of (typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(paragraph)].map(v=>v.segment):Array.from(paragraph))){if(line&&measure(line+char)>width){lines.push(line);line=char;}else line+=char;}
  lines.push(line);
 }
 return lines;
}
export function quoteGeometry(lines,{zoom=100}={}){
 const bodyHeight=Math.max(1,lines.length)*QUOTE_TEMPLATE.lineHeight;
 const feedbackY=QUOTE_TEMPLATE.bodyY+bodyHeight+20,dateY=feedbackY+70,lineY=dateY+38,iconsY=lineY+45,height=iconsY+93;
 const scale=Math.max(.5,Math.min(1,(Number(zoom)||100)/100));
 return {bodyHeight,feedbackY,dateY,lineY,iconsY,height,scale,x:0,y:0,width:Math.round(QUOTE_EXPORT.width*scale),outputHeight:Math.ceil(height*scale)};
}
// Static chrome comes directly from the user-supplied screenshot, without its
// author, body or engagement numbers. Do not approximate X's icons with glyphs.
const sprites={badge:[296,23,34,34],grok:[965,23,40,38],more:[1018,31,34,20],translation:[28,123,302,34],feedback:[28,276,244,34],comment:[37,433,43,42],repost:[277,435,46,38],heart:[519,433,43,41],bookmark:[765,432,35,43],share:[1003,433,40,41],related:[28,495,80,32]};
function drawChrome(c,chrome,kind,dx,dy){const [x,y,w,h]=sprites[kind];c.drawImage(chrome,x,y,w,h,dx??x,dy??y,w,h);}
const count=quoteCount,views=quoteCount;
export function drawQuoteCard(canvas,{text,author,avatar,chrome,metrics,stamp,zoom=100}){
 canvas.width=QUOTE_EXPORT.width;canvas.height=548;const c=canvas.getContext('2d');
 const font=(size,weight=400)=>`${weight} ${size}px Arial,"PingFang SC","Microsoft YaHei",sans-serif`;
 c.font=font(QUOTE_TEMPLATE.bodySize);const lines=quoteLines(text,v=>c.measureText(v).width),g=quoteGeometry(lines,{zoom});
 canvas.width=g.width;canvas.height=g.outputHeight;
 c.fillStyle='#000';c.fillRect(0,0,canvas.width,canvas.height);
 c.save();c.translate(g.x,g.y);c.scale(g.scale,g.scale);c.textBaseline='alphabetic';
 c.save();c.beginPath();c.arc(66,60,36,0,Math.PI*2);c.clip();
 const side=Math.min(avatar.naturalWidth,avatar.naturalHeight);c.drawImage(avatar,(avatar.naturalWidth-side)/2,(avatar.naturalHeight-side)/2,side,side,30,24,72,72);c.restore();
 c.fillStyle='#e7e9ea';c.font=font(QUOTE_TEMPLATE.nameSize,700);let name=author.name;while(c.measureText(name).width>800)name=name.slice(0,-2)+'…';c.fillText(name,116,QUOTE_TEMPLATE.nameY);
 drawChrome(c,chrome,'badge',116+c.measureText(name).width+5,23);
 c.font=font(QUOTE_TEMPLATE.handleSize);c.fillStyle='#71767b';c.fillText(author.handle,116,QUOTE_TEMPLATE.handleY);
 drawChrome(c,chrome,'grok');drawChrome(c,chrome,'more');drawChrome(c,chrome,'translation');
 c.font=font(QUOTE_TEMPLATE.bodySize);c.fillStyle='#e7e9ea';lines.forEach((line,i)=>c.fillText(line,30,196+i*43));
 drawChrome(c,chrome,'feedback',28,g.feedbackY-26);
 c.font=font(QUOTE_TEMPLATE.metaSize);c.fillStyle='#71767b';c.fillText(stamp,30,g.dateY);
 const x=30+c.measureText(stamp+' · ').width;c.fillText(' · ',30+c.measureText(stamp).width,g.dateY);c.font=font(QUOTE_TEMPLATE.metaSize,700);c.fillStyle='#e7e9ea';const v=views(metrics.views);c.fillText(v,x,g.dateY);c.fillStyle='#71767b';c.font=font(QUOTE_TEMPLATE.metaSize);c.fillText(' 查看',x+c.measureText(v).width,g.dateY);
 c.strokeStyle='#2f3336';c.lineWidth=1;c.beginPath();c.moveTo(30,g.lineY);c.lineTo(1050,g.lineY);c.stroke();
 const entries=[['comment','comments',84],['repost','reposts',326],['heart','likes',568],['bookmark','bookmarks',809]];
 c.font=font(24);c.fillStyle='#71767b';
 for(const [kind,key,nx] of entries){const [sx,sy]=sprites[kind];drawChrome(c,chrome,kind,sx,sy+g.iconsY-455);c.fillText(count(metrics[key]),nx,g.iconsY+8);}
 drawChrome(c,chrome,'share',1003,433+g.iconsY-455);drawChrome(c,chrome,'related',28,495+g.iconsY-455);
 c.restore();return {...g,lines};
}

export const COLLAGE_SIZE={width:1200,height:1600};

// Ordered modes use explicit columns. Scattered mode compares compact mixed
// rows and masonry before adding bounded offsets; every source stays complete.
export function collageLayout(sizes,{columns=1,title=false,mode='ordered',seed=1}={}) {
  if(!Array.isArray(sizes)||sizes.length<2||sizes.length>18)throw Error('请选择 2–18 张图片。');
  if(sizes.some(s=>!Number.isFinite(s.width)||!Number.isFinite(s.height)||!(s.width>0&&s.height>0)))throw Error('图片尺寸尚未读取完整。');
  if(![1,2].includes(columns))throw Error('请选择纵向或双列排版。');
  const {width,height}=COLLAGE_SIZE,padding=40,gap=18,top=title?210:padding;
  const availableWidth=width-padding*2,availableHeight=height-top-padding;
  const unitWidth=(availableWidth-gap*(columns-1))/columns;
  if(mode==='scattered')return scatteredLayout(sizes,{title,seed});
  const stacks=Array.from({length:columns},()=>[]),heights=Array(columns).fill(0);
  sizes.forEach((s,index)=>{
    const col=heights.indexOf(Math.min(...heights)),h=unitWidth*s.height/s.width;
    stacks[col].push({index,height:h});heights[col]+=h+(stacks[col].length>1?gap:0);
  });
  const scale=Math.min(1,availableHeight/Math.max(...heights)),result=[];
  for(let col=0;col<columns;col++){
    let y=top+(availableHeight-heights[col]*scale)/2;
    for(const item of stacks[col]){
      const w=unitWidth*scale,h=item.height*scale;
      result.push({index:item.index,x:padding+col*(unitWidth+gap)+(unitWidth-w)/2,y,width:w,height:h});y+=h+gap*scale;
    }
  }
  return {width,height,columns,placements:result.sort((a,b)=>a.index-b.index)};
}

export function preferredColumns(sizes){
  const ratios=sizes.map(s=>s.width/s.height).sort((a,b)=>a-b);
  return ratios[Math.floor(ratios.length/2)]>2.4?1:2;
}

function scatteredLayout(sizes,{title,seed}){
  const {width,height}=COLLAGE_SIZE,padding=40,top=title?210:padding;
  const spaceWidth=width-padding*2,spaceHeight=height-top-padding;
  let state=Number(seed)>>>0;
  const random=()=>{state+=0x6d2b79f5;let t=Math.imul(state^state>>>15,1|state);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
  const order=sizes.map((_,index)=>index);
  for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  const ratios=sizes.map(s=>s.width/s.height);
  let best=null;
  const consider=(plan,scale,area,minWidth)=>{
    // Favor readable image area; a small minimum-width weight prevents a large
    // hero plus tiny remnants from winning. No image is cropped or stretched.
    const score=area*scale*scale*(.9+.1*Math.min(1,minWidth*scale/spaceWidth));
    if(!best||score>best.score)best={...plan,scale,score};
  };
  const row=(start,count)=>{
    const indices=order.slice(start,start+count),w=spaceWidth*(.965+random()*.035),gap=18;
    const h=(w-gap*(count-1))/indices.reduce((n,i)=>n+ratios[i],0);
    return {indices,width:w,height:h,gap,after:16+random()*8,offset:random(),area:(w-gap*(count-1))*h,minWidth:Math.min(...indices.map(i=>h*ratios[i]))};
  };
  const singles=order.map((_,i)=>row(i,1)),pairs=order.map((_,i)=>i+1<order.length?row(i,2):null);
  // There are at most 4181 single/pair partitions for the 18-image limit.
  // Evaluate without allocating placements for rejected candidates.
  const search=(at,rows,totalHeight,totalGap,area,minWidth)=>{
    if(at===order.length){
      const scale=Math.min(1,(spaceHeight-totalGap)/totalHeight);
      consider({kind:'rows',rows:[...rows],totalHeight,totalGap},scale,area,minWidth);return;
    }
    for(const item of [singles[at],pairs[at]])if(item){
      const gap=rows.length?rows.at(-1).after:0;rows.push(item);
      search(at+item.indices.length,rows,totalHeight+item.height,totalGap+gap,area+item.area,Math.min(minWidth,item.minWidth));rows.pop();
    }
  };
  search(0,[],0,0,0,Infinity);
  // Mixed portrait/landscape sets also get compact masonry candidates. Each
  // stack begins just below the title; leftover height is never random drift.
  for(const fraction of [.44,.5,.56]){
    const gap=20,stacks=[[],[]],widths=[(spaceWidth-gap)*fraction,(spaceWidth-gap)*(1-fraction)],heights=[0,0],gaps=[0,0];
    let area=0,minWidth=Infinity;
    for(const index of order){
      const col=heights[0]+gaps[0]<=heights[1]+gaps[1]?0:1,w=widths[col]*(.965+random()*.035),h=w/ratios[index],after=16+random()*8;
      if(stacks[col].length)gaps[col]+=stacks[col].at(-1).after;
      stacks[col].push({index,width:w,height:h,after,offset:random()});heights[col]+=h;area+=w*h;minWidth=Math.min(minWidth,w);
    }
    const scale=Math.min(1,...heights.map((h,i)=>h?(spaceHeight-gaps[i])/h:1));
    consider({kind:'stacks',stacks,widths,gap,heights,gaps},scale,area,minWidth);
  }
  const placements=[],scale=best.scale;
  if(best.kind==='rows'){
    const slack=spaceHeight-best.totalHeight*scale-best.totalGap;let y=top+Math.min(24,Math.max(0,slack)/2);
    for(const r of best.rows){let x=padding+(spaceWidth-r.width*scale)*r.offset;
      for(const index of r.indices){const w=r.height*ratios[index]*scale,h=r.height*scale;placements.push({index,x,y,width:w,height:h});x+=w+r.gap*scale;}
      y+=r.height*scale+r.after;
    }
  }else{
    let left=padding;
    for(let col=0;col<2;col++){
      const slack=spaceHeight-best.heights[col]*scale-best.gaps[col];let y=top+Math.min(24,Math.max(0,slack)/2);
      for(const item of best.stacks[col]){const w=item.width*scale,h=item.height*scale;placements.push({index:item.index,x:left+(best.widths[col]-w)*item.offset,y,width:w,height:h});y+=h+item.after;}
      left+=best.widths[col]+best.gap;
    }
  }
  const columns=best.kind==='stacks'||best.rows.some(r=>r.indices.length>1)?2:1;
  return {width,height,columns,mode:'scattered',seed,placements:placements.sort((a,b)=>a.index-b.index)};
}

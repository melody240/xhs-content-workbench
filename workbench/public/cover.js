// Fit only the cover. Preserve the original upload and all inner images.
export async function coverBlob(url){
 const image=new Image();image.src=url;await image.decode();
 if(!image.naturalWidth||!image.naturalHeight)throw Error('封面图片尚未读取完整。');
 if(Math.abs(image.naturalWidth/image.naturalHeight-4/3)<.001)return null;
 const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1200;
 const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1600,1200);
 const ratio=Math.min(1600/image.naturalWidth,1200/image.naturalHeight),w=image.naturalWidth*ratio,h=image.naturalHeight*ratio;c.drawImage(image,(1600-w)/2,(1200-h)/2,w,h);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('封面生成失败。')),'image/png'));
}

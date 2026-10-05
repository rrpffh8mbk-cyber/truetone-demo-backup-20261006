let faceMesh=null;
const OUTER=[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const INNER=[78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
function initFaceMesh(){if(faceMesh)return faceMesh;if(!window.FaceMesh)throw new Error('Face Mesh 未加载');faceMesh=new window.FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});faceMesh.setOptions({maxNumFaces:2,refineLandmarks:true,minDetectionConfidence:.55,minTrackingConfidence:.5});return faceMesh}
function detectOnce(img){return new Promise(async(resolve,reject)=>{try{const fm=initFaceMesh();fm.onResults(r=>resolve(r));await fm.send({image:img})}catch(e){reject(e)}})}
export function polygon(ctx,pts,w,h,landmarks){pts.forEach((id,i)=>{const p=landmarks[id];const x=p.x*w,y=p.y*h;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.closePath()}

// FaceMesh has one results callback; serialize requests from analysis and try-on.
let detectionQueue=Promise.resolve();
export function detectLipLandmarks(image){
 const task=detectionQueue.then(()=>detectOnce(image));
 detectionQueue=task.catch(()=>{});
 return task.then(result=>{
  const faces=result.multiFaceLandmarks||[];
  const area=f=>{const xs=f.map(p=>p.x),ys=f.map(p=>p.y);return (Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys))};
  return {landmarks:faces.slice().sort((a,b)=>area(b)-area(a))[0]||null,faces:faces.length};
 });
}
export function createLipMask(landmarks,w,h){
 const mask=document.createElement('canvas');mask.width=w;mask.height=h;
 const ctx=mask.getContext('2d');ctx.fillStyle='#fff';ctx.beginPath();
 polygon(ctx,OUTER,w,h,landmarks);polygon(ctx,INNER,w,h,landmarks);ctx.fill('evenodd');
 return mask;
}
export {OUTER,INNER};

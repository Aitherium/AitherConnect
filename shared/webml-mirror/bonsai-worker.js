var Di=Object.defineProperty;var R=(t,e)=>()=>(t&&(e=t(t=0)),e);var oe=(t,e)=>{for(var n in e)Di(t,n,{get:e[n],enumerable:!0})};function Tt(t){let e=Wi[t];if(!e)throw new Error(`bonsai-gguf: unsupported ggml type ${t} (not in TYPE_TRAITS)`);return e}function Fr(t,e){let{blockSize:n,typeSize:r}=Tt(t);if(e%n!==0)throw new Error(`bonsai-gguf: element count ${e} not a multiple of block size ${n} for ${Tt(t).name}`);return e/n*r}var Wi,Ye,Ln,Ur,Kr,bt=R(()=>{"use strict";Wi={0:{blockSize:1,typeSize:4,name:"F32"},1:{blockSize:1,typeSize:2,name:"F16"},8:{blockSize:32,typeSize:34,name:"Q8_0"},41:{blockSize:128,typeSize:18,name:"Q1_0"},42:{blockSize:128,typeSize:34,name:"Q2_0"}},Ye=128,Ln=128,Ur=18,Kr=34});var C,ro,wt=R(()=>{"use strict";C={MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,STORAGE:128,UNIFORM:64},ro={READ:1,WRITE:2}});function po(t,e){return Math.floor((t+e-1)/e)}function wo(t,e){bo.set(t,Math.max(0,Math.floor(e)))}function Pn(t){Xe.has(t)||Xe.set(t,{enc:t.createCommandEncoder(),dispatches:0})}function Yt(t){let e=Xe.get(t);e&&(Xe.delete(t),t.queue.submit([e.enc.finish()]))}function Ve(t){let e=Xe.get(t);return e?{enc:e.enc,batched:!0}:{enc:t.createCommandEncoder(),batched:!1}}function Je(t,e){e.batched||t.queue.submit([e.enc.finish()])}function yo(t){let e=ho.get(t);return e||(e=new Map,ho.set(t,e)),e}function ms(t){let e=mo.get(t);return e||(e={created:0,reused:0},mo.set(t,e)),e}function On(t,e){return`${t}:${e}`}function _o(t,e,n,r,o=!1){let i=yo(t),s=On(e,n),a=i.get(s),c=ms(t);if(globalThis.__BONSAI_NO_POOL===!0)return c.created++,t.createBuffer({size:n,usage:e,label:r});if(a&&a.length>0){c.reused++;let d=a.pop();if(o)return d;let u=Ve(t);return u.enc.clearBuffer(d,0,n),Je(t,u),d}return c.created++,t.createBuffer({size:n,usage:e,label:r})}function Et(t,e){let n=En.get(t);n||(n=[],En.set(t,n)),n.push(e)}function In(t){let e=En.get(t);if(!e)return;let n=yo(t);for(let r of e){let o=r[$n];if(o===void 0){try{r.destroy()}catch{}continue}let i=n.get(o);i||(i=[],n.set(o,i)),i.push(r)}e.length=0}function pe(t,e,n,r){let o=Math.max(4,Gn(e)),i=_o(t,fo,o,n,r?.queueInit===!0);return i[$n]=On(fo,o),i}function Xt(t,e,n){let r=Math.max(16,Gn(e)),o=_o(t,go,r,n,!0);return o[$n]=On(go,r),o}function Gn(t){return t+(4-t%4)%4}function z(t,e,n){return t.createBindGroup({layout:e.getBindGroupLayout(0),entries:n.map((r,o)=>({binding:o,resource:{buffer:r}}))})}function H(t,e,n,r,o){let i=Xe.get(t),s=i?i.enc:t.createCommandEncoder(),a=s.beginComputePass();a.setPipeline(e),a.setBindGroup(0,n);let c=po(r,o);if(c<=Ht)a.dispatchWorkgroups(c);else{let u=Ht,l=po(c,u);if(l>Ht)throw new Error(`bonsai-dispatch: ${c} workgroups exceeds even a 2-D grid (${Ht}^2). This is a context-length bug upstream, not a dispatch bug \u2014 chunk the work.`);a.dispatchWorkgroups(u,l)}if(a.end(),!i){t.queue.submit([s.finish()]);return}i.dispatches++;let d=bo.get(t)??0;d>0&&i.dispatches>=d&&(console.debug(`[bonsai] TDR budget limit reached: submitted ${i.dispatches} dispatches, opening new batch to stay under GPU watchdog deadline`),Xe.delete(t),t.queue.submit([i.enc.finish()]),Xe.set(t,{enc:t.createCommandEncoder(),dispatches:0}))}function fs(t,e){let n=Bn.get(t);n||(n=new Map,Bn.set(t,n));let r=n.get(e);return r&&r.length?r.pop():t.createBuffer({size:e,usage:C.MAP_READ|C.COPY_DST,label:"readback"})}function gs(t,e,n){let r=Bn.get(t);if(!r){n.destroy();return}let o=r.get(e);if(o||(o=[],r.set(e,o)),o.length>=4){n.destroy();return}o.push(n)}async function Fe(t,e,n){Yt(t);let r=Gn(n),o=fs(t,r),i=t.createCommandEncoder();i.copyBufferToBuffer(e,0,o,0,r),t.queue.submit([i.finish()]),await o.mapAsync(ro.READ);let s=o.getMappedRange().slice(0,n);return o.unmap(),gs(t,r,o),s}function Vt(t){let e=new ArrayBuffer(bs(t.length*4)),n=new DataView(e);return t.forEach((r,o)=>{r.u32!==void 0?n.setUint32(o*4,r.u32,!0):n.setFloat32(o*4,r.f32??0,!0)}),e}function bs(t){return t+(16-t%16)%16}var Xe,bo,En,ho,mo,$n,fo,go,Ht,Bn,We=R(()=>{"use strict";wt();Xe=new WeakMap,bo=new WeakMap;En=new WeakMap,ho=new WeakMap,mo=new WeakMap;$n=Symbol("aither.poolKey");fo=C.STORAGE|C.COPY_DST|C.COPY_SRC,go=C.UNIFORM|C.COPY_DST;Ht=65535;Bn=new WeakMap});var ko={};oe(ko,{LOGIT_HIST_BINS:()=>ks,LOGIT_RANGE_HI:()=>_s,LOGIT_RANGE_LO:()=>ys,TOPK_GATHER_CAPACITY:()=>vs,chooseThreshold:()=>ws});function ws(t,e,n,r,o){let i=t.length,s=Math.max(n-e,1e-6),a=0;for(let c=0;c<i;c++)if(a+=t[c],a>=r)return{threshold:n-(c+1)/i*s,expected:a,overflow:a>o,reason:a>o?`bin ${c} of ${i} holds ${a} candidates, over the ${o} the gather can hold`:`bin ${c} of ${i} reaches ${a} candidates for k=${r}`};return{threshold:e,expected:a,overflow:!0,reason:`histogram holds only ${a} counts, fewer than k=${r} \u2014 refusing to threshold`}}var ys,_s,ks,vs,vo=R(()=>{"use strict";ys=-50,_s=50,ks=1024,vs=2048});var kt={};oe(kt,{Q8_BLOCK:()=>Ao,Q8_BYTES_PER_BLOCK:()=>xs,causalConv1d:()=>Mn,dbgStats:()=>Ps,deltanetGate:()=>Kn,deltanetSeq:()=>Fn,deltanetStep:()=>Ls,elementwise:()=>Wn,elementwiseInplace:()=>_t,f32Buffer:()=>Ze,gpuTopK:()=>To,mulSigmoidInplace:()=>Un,projectQ1:()=>J,projectQuantized:()=>qn,q1q8Matmul:()=>Cn,q2q8Matmul:()=>Dn,quantizeQ8:()=>Rn,readbackF32:()=>lt,residualAdd:()=>ct,rmsnorm:()=>he,ropeImrope:()=>Jt,sampleArgmax:()=>Bs,sampleTiming:()=>ut,sampleToken:()=>Es,scratchBuffer:()=>x,siluInplace:()=>en,softmaxAttnBatched:()=>Zt,softmaxAttnHead:()=>Ss,swigluMul:()=>Bt});function Ze(t,e,n,r){return pe(t,Math.max(Nn,e*Nn),n,r)}function x(t,e,n,r){let o=Ze(t.device,e,n,r);return Et(t.device,o),o}function le(t,e){let n=Vt(e),r=Xt(t,n.byteLength);return t.queue.writeBuffer(r,0,n),Et(t,r),r}function he(t,e,n,r,o,i,s){let a=le(t.device,[{u32:i},{f32:s},{u32:0},{u32:0}]),c=t.pipelines.get("rmsnorm");H(t.device,c,z(t.device,c,[e,n,r,a]),o,1)}function Rn(t,e,n){let r=Math.ceil(n/Ao),o=pe(t.device,r*4,"act_d"),i=pe(t.device,r*8*4,"act_qs"),s=t.pipelines.get("quantize_q8_0");return H(t.device,s,z(t.device,s,[e,o,i]),r,1),{d:o,qs:i,nBlocks:r}}function Cn(t,e,n,r,o,i,s){let a=Math.ceil(s/64),c=le(t.device,[{u32:i},{u32:s},{u32:o},{u32:a}]),d=t.pipelines.get("q1_0_q8_0_matmul"),u=z(t.device,d,[e,n.d,n.qs,r,c]);H(t.device,d,u,o*a*64,64)}function Dn(t,e,n,r,o,i,s){let a=Math.ceil(s/64),c=le(t.device,[{u32:i},{u32:s},{u32:o},{u32:a}]),d=t.pipelines.get("q2_0_q8_0_matmul"),u=z(t.device,d,[e,n.d,n.qs,r,c]);H(t.device,d,u,o*a*64,64)}function J(t,e,n,r,o,i,s){let a=Rn(t,e,o*i);t.quantType===42?Dn(t,n,a,r,o,i,s):Cn(t,n,a,r,o,i,s)}function qn(t,e,n,r,o,i,s,a){let c=Rn(t,e,o*i);if(a===42)Dn(t,n,c,r,o,i,s);else if(a===41)Cn(t,n,c,r,o,i,s);else throw new Error(`projectQuantized: unsupported weight quant type ${a} (supported: Q1_0=41, Q2_0=42)`)}function Jt(t,e,n,r,o,i,s,a,c=1){let d=le(t.device,[{u32:r},{u32:o},{u32:i},{u32:s},{f32:a},{f32:c},{u32:0},{u32:0}]),u=t.pipelines.get("rope_imrope"),l=Math.floor(i/2);H(t.device,u,z(t.device,u,[e,d]),n*r*l,64)}function Ss(t,e,n,r,o,i,s,a,c,d){let u=le(t.device,[{u32:i},{u32:s},{u32:a},{u32:c},{f32:d},{u32:0},{u32:0},{u32:0}]),l=t.pipelines.get("softmax_attn");H(t.device,l,z(t.device,l,[e,n,r,o,u]),1,1)}function Zt(t,e,n,r,o,i,s,a,c,d,u,l,p){let h=!!(l&&p),m=le(t.device,[{u32:i},{u32:s},{u32:a},{u32:c},{u32:d},{f32:u},{u32:h?1:0},{u32:0}]);if(c>256)throw new Error(`bonsai-ops: softmaxAttnBatched supports head_dim <= 256, got ${c}. Raise DPT in softmax_attn_batched.wgsl to ceil(head_dim/128) to extend it.`);if(h&&c%8!==0)throw new Error(`bonsai-ops: softmaxAttnBatched 4-bit mode requires head_dim % 8 == 0, got ${c}.`);let b=t.pipelines.get("softmax_attn_batched"),f=z(t.device,b,[e,n,r,o,m,l??Lo(t.device),p??Lo(t.device)]);H(t.device,b,f,i*s,1)}function Mn(t,e,n,r,o,i,s,a){let c=le(t.device,[{u32:i},{u32:s},{u32:a},{u32:0}]),d=t.pipelines.get("causal_conv1d"),u=z(t.device,d,[e,n,r,o,c]);H(t.device,d,u,i*s,64)}function Ls(t,e,n,r,o,i,s,a,c,d,u){let l=le(t.device,[{u32:c},{u32:d},{u32:u},{u32:0}]),p=t.pipelines.get("deltanet"),h=z(t.device,p,[e,n,r,o,i,s,a,l]);H(t.device,p,h,1,1)}function Bt(t,e,n,r,o){let i=le(t.device,[{u32:o}]),s=t.pipelines.get("swiglu");H(t.device,s,z(t.device,s,[e,n,r,i]),o,256)}function _t(t,e,n,r,o){let i=le(t.device,[{u32:r},{u32:o},{u32:0},{u32:0}]),s=t.pipelines.get("elementwise_inplace");H(t.device,s,z(t.device,s,[e,n,i]),r,256)}function As(t){let e=xo.get(t);return e||(e=pe(t,4,"silu_dummy"),xo.set(t,e)),e}function Lo(t){let e=So.get(t);return e||(e=pe(t,4,"kv_scale_dummy"),So.set(t,e)),e}function Un(t,e,n,r){_t(t,e,n,r,4)}function en(t,e,n){_t(t,e,As(t.device),n,3)}function Kn(t,e,n,r,o,i,s,a,c){let d=le(t.device,[{u32:a},{u32:c},{u32:0},{u32:0}]),u=t.pipelines.get("deltanet_gate"),l=z(t.device,u,[e,n,r,o,i,s,d]);H(t.device,u,l,a*c,64)}function Fn(t,e,n,r,o,i,s,a,c,d,u,l,p){let h=le(t.device,[{u32:c},{u32:d},{u32:u},{u32:l},{u32:p},{u32:0},{u32:0},{u32:0}]),m=t.pipelines.get("deltanet_seq"),b=z(t.device,m,[e,n,r,o,i,s,a,h]);H(t.device,m,b,d*l,64)}function Wn(t,e,n,r,o,i){if(r===e){_t(t,r,n,o,i);return}if(r===n){_t(t,r,e,o,i);return}let s=le(t.device,[{u32:o},{u32:i},{u32:0},{u32:0}]),a=t.pipelines.get("elementwise");H(t.device,a,z(t.device,a,[e,n,r,s]),o,256)}function ct(t,e,n,r){_t(t,e,n,r,0)}function Ts(t,e,n,r,o,i){let s=t.length,c=Array.from({length:s},(f,g)=>g).sort((f,g)=>e[g]-e[f]).slice(0,Math.max(1,Math.min(n,s)));if(r<=0)return t[c[0]];let d=e[c[0]],u=new Float64Array(c.length),l=0;for(let f=0;f<c.length;f++){let g=Math.exp((e[c[f]]-d)/r);u[f]=g,l+=g}if(!(l>0)||!Number.isFinite(l))return t[c[0]];let p=c.length,h=o.topP??1;if(h>0&&h<1){let f=0;for(let g=0;g<c.length;g++)if(f+=u[g]/l,f>=h){p=g+1;break}}let m=0;for(let f=0;f<p;f++)m+=u[f];let b=i()*m;for(let f=0;f<p;f++)if(b-=u[f],b<=0)return t[c[f]];return t[c[p-1]]}async function Es(t,e,n,r={}){let o=r.temperature??0,i=r.random??Math.random,s=globalThis.__BONSAI_TIMING===!0,a=s?performance.now():0,c=(r.repetitionPenalty??1)!==1&&!!r.recentIds?.length,d=r.topK&&r.topK>0?Math.min(r.topK,n):Math.min(64,n),u=globalThis.__BONSAI_GPU_TOPK===!0;if(!c&&u){let _=await To(t,e,n,Math.max(d,1));if(_&&_.ids.length){let I=s?performance.now():0;s&&(ut.readbackMs+=I-a,ut.calls++);let Z=Ts(_.ids,_.vals,d,o,r,i);return s&&(ut.selectMs+=performance.now()-I),Z}}let l=await lt(t,e,n),p=s?performance.now():0;s&&(ut.readbackMs+=p-a,ut.calls++);let h=_=>(s&&(ut.selectMs+=performance.now()-p),_),m=r.repetitionPenalty??1;if(m!==1&&r.recentIds?.length)for(let _ of new Set(r.recentIds)){if(_<0||_>=n)continue;let I=l[_];l[_]=I>0?I/m:I*m}if(o<=0){let _=0,I=-1/0;for(let Z=0;Z<n;Z++)l[Z]>I&&(I=l[Z],_=Z);return h(_)}let b=r.topK&&r.topK>0?Math.min(r.topK,n):Math.min(64,n),f=[],g=-1/0;for(let _=0;_<n;_++){let I=l[_];if(f.length===b&&I<=g)continue;let Z=f.length;for(;Z>0&&l[f[Z-1]]<I;)Z--;f.splice(Z,0,_),f.length>b&&f.pop(),g=l[f[f.length-1]]}let v=l[f[0]],y=new Float64Array(f.length),k=0;for(let _=0;_<f.length;_++){let I=Math.exp((l[f[_]]-v)/o);y[_]=I,k+=I}if(!(k>0)||!Number.isFinite(k))return h(f[0]);let S=f.length,L=r.topP??1;if(L>0&&L<1){let _=0;for(let I=0;I<f.length;I++)if(_+=y[I]/k,_>=L){S=I+1;break}}let E=0;for(let _=0;_<S;_++)E+=y[_];let O=i()*E;for(let _=0;_<S;_++)if(O-=y[_],O<=0)return h(f[_]);return h(f[S-1])}async function Bs(t,e,n,r=0){let o=pe(t.device,4,"argmax"),i=pe(t.device,4,"maxval"),s=le(t.device,[{u32:n},{f32:r},{u32:0},{u32:0}]),a=t.pipelines.get("sampling");H(t.device,a,z(t.device,a,[e,o,i,s]),1,1);let c=await Fe(t.device,o,4);return new Uint32Array(c)[0]}async function To(t,e,n,r){let{chooseThreshold:o,LOGIT_HIST_BINS:i,LOGIT_RANGE_LO:s,LOGIT_RANGE_HI:a,TOPK_GATHER_CAPACITY:c}=await Promise.resolve().then(()=>(vo(),ko)),d=i,u=c,l=pe(t.device,d*4,"topk_hist"),p=pe(t.device,u*4,"topk_idx"),h=pe(t.device,u*4,"topk_val"),m=pe(t.device,4,"topk_count"),b=I=>le(t.device,[{u32:n},{u32:d},{f32:s},{f32:a},{f32:I},{u32:u},{u32:0},{u32:0}]),f=t.pipelines.get("logit_topk","hist_main"),g=b(0);H(t.device,f,z(t.device,f,[e,l,p,h,m,g]),Math.min(n,65536),256);let v=await Fe(t.device,l,d*4),y=o(new Uint32Array(v),s,a,r,u);if(y.overflow)return null;let k=t.pipelines.get("logit_topk","gather_main"),S=b(y.threshold);H(t.device,k,z(t.device,k,[e,l,p,h,m,S]),Math.min(n,65536),256);let L=await Fe(t.device,m,4),E=new Uint32Array(L)[0];if(E===0||E>u)return null;let O=await Fe(t.device,p,E*4),_=await Fe(t.device,h,E*4);return{ids:new Uint32Array(O),vals:new Float32Array(_)}}async function lt(t,e,n){let r=await Fe(t.device,e,n*Nn);return new Float32Array(r)}async function Ps(t,e,n,r){let o=await lt(t,e,Math.min(n,8192)),i=0,s=1/0,a=-1/0,c=0;for(let u=0;u<o.length;u++){let l=o[u];Number.isFinite(l)?(l<s&&(s=l),l>a&&(a=l),c+=Math.abs(l)):i++}let d=`${r}[bad=${i} min=${s.toExponential(1)} max=${a.toExponential(1)} mean=${(c/o.length).toExponential(1)}]`;return console.log(`[bonsai] ${d}`),d}var Nn,Ao,xs,xo,So,ut,je=R(()=>{"use strict";We();bt();Nn=4,Ao=32,xs=36;xo=new WeakMap;So=new WeakMap;ut={readbackMs:0,selectMs:0,calls:0}});var Eo={};oe(Eo,{runFullAttnBlock:()=>Os});async function Os(t,e,n){let{hidden:r,nTokens:o,posBase:i}=n,{device:s,pipelines:a,weights:c,config:d,kv:u,kvMode:l}=t,p=d.layerKinds[e],h=p!=="dense-attn",m=tn(p,e,d.ffnNormNames?.[e]),[b,f,g,v,y,k,S,L,E,O,_]=m,{headCount:I,headCountKv:Z,embeddingLength:U,keyLength:xt,ropeDimensionCount:St,ropeFreqBase:De,rmsEps:ze}=d,K=I,ae=Z,A=xt??U/I,tt=1/Math.sqrt(A),He=St??A;await c.ensureLayer(e);let me=c.get(b),nt=c.get(f),qe=c.get(g),fe=c.get(v),rt=c.get(y),ot=c.get(k),pt=c.get(S),ht=c.get(L),mt=c.get(E),Ee=c.get(O),Oe=c.get(_),Be=x(t,o*U,"h1_attn");he(t,r,me,Be,o,U,ze);let Me=x(t,o*K*A,"tempQ"),ie=x(t,o*ae*A,"tempK"),$e=x(t,o*ae*A,"tempV"),q=h?x(t,o*K*A,"tempG"):null;if(J(t,Be,qe,ie,o,U,ae*A),J(t,Be,fe,$e,o,U,ae*A),h){let X=x(t,o*K*A*2,"tempQG");J(t,Be,nt,X,o,U,K*A*2);let Ke=Ve(s),F=K*A*2,W=K*A;for(let Pe=0;Pe<o;Pe++)for(let it=0;it<K;it++){let It=(Pe*F+it*A*2)*4,Lt=(Pe*W+it*A)*4;Ke.enc.copyBufferToBuffer(X,It,Me,Lt,A*4),Ke.enc.copyBufferToBuffer(X,It+A*4,q,Lt,A*4)}Je(s,Ke)}else J(t,Be,nt,Me,o,U,K*A);let ue=x(t,o*K*A,"tempQn"),ee=x(t,o*ae*A,"tempKn");he(t,Me,rt,ue,o*K,A,ze),he(t,ie,ot,ee,o*ae,A,ze),Jt(t,ue,o,K,A,He,i,De),Jt(t,ee,o,ae,A,He,i,De);let ye=x(t,o*K*A,"attn_out");if(l==="4bit"){u.append(e,ee,$e,o,i);let X=u.layer(e);Zt(t,ue,X.k,X.v,ye,o,K,ae,A,i,tt,X.kScale,X.vScale)}else{u.append(e,ee,$e,o,0,0);let{k:X,v:Ke}=u.layer(e);Zt(t,ue,X,Ke,ye,o,K,ae,A,i,tt)}h&&Un(t,ye,q,o*K*A);let Ue=x(t,o*U,"attn_out_proj");J(t,ye,pt,Ue,o,K*A,U),ct(t,r,Ue,o*U);let te=x(t,o*U,"h2_ffn");he(t,r,ht,te,o,U,ze);let Y=x(t,o*d.feedForwardLength,"ffn_gate"),se=x(t,o*d.feedForwardLength,"ffn_up");J(t,te,mt,Y,o,U,d.feedForwardLength),J(t,te,Ee,se,o,U,d.feedForwardLength);let ge=x(t,o*d.feedForwardLength,"ffn_gated_up");Bt(t,Y,se,ge,o*d.feedForwardLength);let Ie=x(t,o*U,"ffn_out");J(t,ge,Oe,Ie,o,d.feedForwardLength,U),ct(t,r,Ie,o*U)}var Bo=R(()=>{"use strict";We();je();nn()});var Oo={};oe(Oo,{runDeltaNetBlock:()=>$s});async function $s(t,e,n){let r=t.config,o=t.device,i=t.weights,s=r.deltaNet;if(!s)throw new Error(`bonsai-deltanet: layer ${e} routed to the DeltaNet path but this model has no ssm.* geometry (dense model). This is a layer-classification bug, not a bad file.`);let a=n.nTokens,c=r.embeddingLength,d=r.feedForwardLength,u=r.rmsEps,{numVHeads:l,numKHeads:p,headDim:h,qDim:m,kDim:b,vDim:f,convDim:g,convKernel:v,vPerKHead:y}=s,k=tn("linear-attn",e);if(k.length!==14)throw new Error(`block_deltanet layer ${e}: expected 14 tensor names, got ${k.length}`);let[S,L,E,O,_,I,Z,U,xt,St,De,ze,K,ae]=k;for(let F of k)if(!i.has(F))throw new Error(`block_deltanet layer ${e}: missing tensor '${F}'. This layer is DeltaNet (linear-attn); ensure it was streamed via weights.ensureLayer(${e}).`);let A=x(t,a*c,`dn.${e}.h1`),tt=x(t,a*g,`dn.${e}.qkv`),He=x(t,a*f,`dn.${e}.z`),me=x(t,a*m,`dn.${e}.qc`),nt=x(t,a*b,`dn.${e}.kc`),qe=x(t,a*f,`dn.${e}.vc`),fe=x(t,a*m,`dn.${e}.qn`),rt=x(t,a*b,`dn.${e}.kn`),ot=x(t,a*l,`dn.${e}.alpha`),pt=x(t,a*l,`dn.${e}.beta`),ht=x(t,a*l,`dn.${e}.g`),mt=x(t,a*l,`dn.${e}.betaG`),Ee=x(t,a*f,`dn.${e}.recur`),Oe=x(t,a*f,`dn.${e}.normOut`),Be=x(t,a*c,`dn.${e}.ssmProj`),Me=x(t,a*c,`dn.${e}.h2`),ie=x(t,a*d,`dn.${e}.ffnG`),$e=x(t,a*d,`dn.${e}.ffnU`),q=x(t,a*d,`dn.${e}.ffnM`),ue=x(t,a*c,`dn.${e}.ffnD`),ee=x(t,g,`dn.${e}.convBias`,{queueInit:!0});o.queue.writeBuffer(ee,0,new Float32Array(g));let ye=x(t,h,`dn.${e}.l2w`,{queueInit:!0});o.queue.writeBuffer(ye,0,new Float32Array(h).fill(1/Math.sqrt(h)));let Ue=1e-6/h;he(t,n.hidden,i.get(S),A,a,c,u),J(t,A,i.get(L),tt,a,c,g),J(t,A,i.get(E),He,a,c,f);let te=v-1,Y=t.ssm.generation??0,se=Po.get(t.ssm);se||(se={gen:Y,bufs:new Map,zeroed:new Set},Po.set(t.ssm,se)),se.gen!==Y&&(se.gen=Y,se.zeroed.clear());let ge=se.bufs.get(e);ge?se.zeroed.has(e)||(o.queue.writeBuffer(ge,0,new Float32Array(te*g)),se.zeroed.add(e)):(ge=Ze(o,te*g,`dn.${e}.convHist`),se.bufs.set(e,ge),o.queue.writeBuffer(ge,0,new Float32Array(te*g)),se.zeroed.add(e));let Ie=x(t,(a+te)*g,`dn.${e}.convIn`),X=x(t,(a+te)*g,`dn.${e}.convOutF`);{let F=Ve(o);F.enc.copyBufferToBuffer(ge,0,Ie,0,te*g*4),F.enc.copyBufferToBuffer(tt,0,Ie,te*g*4,a*g*4),F.enc.copyBufferToBuffer(Ie,a*g*4,ge,0,te*g*4),Je(o,F)}Mn(t,Ie,i.get(O),ee,X,a+te,g,v),en(t,X,(a+te)*g);{let F=Ve(o);for(let W=0;W<a;W++){let Pe=(W+te)*g*4;F.enc.copyBufferToBuffer(X,Pe,me,W*m*4,m*4),F.enc.copyBufferToBuffer(X,Pe+m*4,nt,W*b*4,b*4),F.enc.copyBufferToBuffer(X,Pe+(m+b)*4,qe,W*f*4,f*4)}Je(o,F)}he(t,me,ye,fe,a*p,h,Ue),he(t,nt,ye,rt,a*p,h,Ue),J(t,A,i.get(I),ot,a,c,l),J(t,A,i.get(_),pt,a,c,l),Kn(t,ot,pt,i.get(Z),i.get(U),ht,mt,a,l);let Ke=t.ssm.state(e);Fn(t,fe,rt,qe,ht,mt,Ke,Ee,a,l,p,h,y),he(t,Ee,i.get(xt),Oe,a*l,h,u),en(t,He,a*f),Wn(t,Oe,He,Oe,a*f,1),J(t,Oe,i.get(St),Be,a,f,c),ct(t,n.hidden,Be,a*c),he(t,n.hidden,i.get(De),Me,a,c,u),J(t,Me,i.get(ze),ie,a,c,d),J(t,Me,i.get(K),$e,a,c,d),Bt(t,ie,$e,q,a*d),J(t,q,i.get(ae),ue,a,d,c),ct(t,n.hidden,ue,a*c)}var Po,$o=R(()=>{"use strict";je();We();nn();Po=new WeakMap});function tn(t,e,n){let r=`blk.${e}.`;return t==="full-attn"||t==="dense-attn"?[`${r}attn_norm.weight`,`${r}attn_q.weight`,`${r}attn_k.weight`,`${r}attn_v.weight`,`${r}attn_q_norm.weight`,`${r}attn_k_norm.weight`,`${r}attn_output.weight`,n??`${r}post_attention_norm.weight`,`${r}ffn_gate.weight`,`${r}ffn_up.weight`,`${r}ffn_down.weight`]:[`${r}attn_norm.weight`,`${r}attn_qkv.weight`,`${r}attn_gate.weight`,`${r}ssm_conv1d.weight`,`${r}ssm_beta.weight`,`${r}ssm_alpha.weight`,`${r}ssm_a`,`${r}ssm_dt.bias`,`${r}ssm_norm.weight`,`${r}ssm_out.weight`,`${r}post_attention_norm.weight`,`${r}ffn_gate.weight`,`${r}ffn_up.weight`,`${r}ffn_down.weight`]}async function jn(t,e,n){let r=t.config.layerKinds[e];if(await t.weights.ensureLayer(e),r==="full-attn"||r==="dense-attn"){let{runFullAttnBlock:o}=await Promise.resolve().then(()=>(Bo(),Eo));await o(t,e,n)}else if(r==="linear-attn"){let{runDeltaNetBlock:o}=await Promise.resolve().then(()=>($o(),Oo));await o(t,e,n)}else throw new Error(`runBlock: unknown layer kind '${r}' at layer ${e}`)}var nn=R(()=>{"use strict"});function Io(t){let e=(t&32768)>>15,n=(t&31744)>>10,r=t&1023;return n===0?(e?-1:1)*Math.pow(2,-14)*(r/1024):n===31?r?NaN:e?-1/0:1/0:(e?-1:1)*Math.pow(2,n-15)*(1+r/1024)}function Go(t,e=0){if(t.length-e<Ur)throw new Error("readQ1Block: need 18 bytes");let n=t[e]|t[e+1]<<8,r=t.subarray(e+2,e+2+16);return{d:Io(n),qs:new Uint8Array(r)}}function Gs(t,e){return t[e>>3]>>(e&7)&1}function No(t){let e=new Float32Array(Ye);for(let n=0;n<Ye;n++)e[n]=Gs(t.qs,n)?t.d:-t.d;return e}function Ro(t,e=0){if(t.length-e<Kr)throw new Error("readQ2Block: need 34 bytes");let n=t[e]|t[e+1]<<8,r=t.subarray(e+2,e+2+32);return{d:Io(n),qs:new Uint8Array(r)}}function Ns(t,e){let n=e>>2,r=(e&3)<<1;return t[n]>>r&3}function Co(t){let e=new Float32Array(Ln);for(let n=0;n<Ln;n++){let r=Ns(t.qs,n);e[n]=(r-1)*t.d}return e}var Is,Kc,Do=R(()=>{"use strict";bt();Is=new Float32Array(1),Kc=new Uint32Array(Is.buffer)});var qo={};oe(qo,{embedTokens:()=>Qn,projectLogits:()=>rn});async function Qn(t,e,n,r,o){let i="token_embd.weight";if(!r.has(i))throw new Error(`bonsai-embed: token embedding table '${i}' not loaded; call weights.loadGlobals(['${i}']) first`);let s=r.get(i),a=e.length;if(o%Ye!==0)throw new Error(`bonsai-embed: embeddingLength ${o} not a multiple of QK1_0 (${Ye})`);let c=r.typeOf(i),d=c===42;if(!d&&c!==41)throw new Error(`bonsai-embed: '${i}' has unsupported quant type ${c} (supported: Q1_0=41, Q2_0=42)`);let u=d?36:20,l=o/Ye,p=l*u,h=new Float32Array(a*o),m=pe(t.device,p,"embed_staging");for(let b=0;b<a;b++){let f=e[b];if(!Number.isInteger(f)||f<0)throw new Error(`bonsai-embed: token ID ${f} at position ${b} is invalid (must be non-negative integer)`);let g=f*p,v=t.device.createCommandEncoder();v.copyBufferToBuffer(s,g,m,0,p),t.device.queue.submit([v.finish()]);let y=await Fe(t.device,m,p),k=new Uint8Array(y);for(let S=0;S<l;S++){let L=S*u,E=d?Co(Ro(k,L)):No(Go(k,L)),O=b*o+S*Ye;h.set(E,O)}}t.device.queue.writeBuffer(n,0,h),m.destroy()}async function rn(t,e,n,r,o,i){let s="output_norm.weight";if(!r.has(s))throw new Error(`bonsai-lmhead: output norm '${s}' not loaded; call weights.loadGlobals(['${s}']) first`);let a=r.get(s),c=o.embeddingLength,d=o.rmsEps,u=Ze(t.device,c,"last_row");{let g=t.device.createCommandEncoder();g.copyBufferToBuffer(e,n*c*4,u,0,c*4),t.device.queue.submit([g.finish()])}let l=Ze(t.device,c,"normed_hidden");he(t,u,a,l,1,c,d);{let{BONSAI_DEBUG:g}=await Promise.resolve().then(()=>(on(),Hn));if(g){let{readbackF32:v}=await Promise.resolve().then(()=>(je(),kt)),y=await v(t,l,c),k=0,S=1/0,L=-1/0;for(let E of y)E<S&&(S=E),E>L&&(L=E),k+=Math.abs(E);console.log(`[bonsai] normedHidden: min=${S.toFixed(3)} max=${L.toFixed(3)} meanabs=${(k/y.length).toFixed(4)}`),console.log("[bonsai] NH_DUMP "+JSON.stringify(Array.from(y)))}}let p="output.weight",m=!r.has(p)?"token_embd.weight":p;if(!r.has(m))throw new Error(`bonsai-lmhead: LM head weights '${m}' not loaded; call weights.loadGlobals(['${m}']) first`);let b=r.get(m),f=Ze(t.device,i,"logits");return qn(t,l,b,f,1,c,i,r.typeOf(m)),u.destroy(),l.destroy(),f}var zn=R(()=>{"use strict";We();je();Do();bt()});var Hn={};oe(Hn,{BONSAI_DEBUG:()=>Cs,bonsaiDebugEnabled:()=>et,captureRow:()=>Yn,decodeStep:()=>qs,prefill:()=>Ds});function et(){return globalThis.__BONSAI_DEBUG===!0}function Yn(t,e){let n=globalThis,r=n.__BONSAI_CAPTURE_TAG;r&&((n.__BONSAI_ROWS??={})[`${r}:${t}`]=e.slice())}function Mo(){return typeof globalThis.__BONSAI_CAPTURE_TAG=="string"}async function Ds(t,e,n,r,o,i=0){await Qn(t,n,e,t.weights,t.config.embeddingLength);let s=t.config.embeddingLength,a=(n.length-1)*s,c=async(h,m)=>{if(!et()&&!Mo())return;let b=await lt(t,e,n.length*s),f=b.subarray(a,a+s);if(m!==void 0){let S=globalThis.__BONSAI_CAPTURE_POS,L=typeof S=="number"&&S>=0&&S<n.length?S*s:a;Yn(m,b.subarray(L,L+s))}if(!et())return;let g=0,v=1/0,y=-1/0,k=0;for(let S=0;S<f.length;S++){let L=f[S];Number.isFinite(L)?(L<v&&(v=L),L>y&&(y=L),k+=Math.abs(L)):g++}console.log(`[bonsai] ${h}: bad=${g} min=${v.toFixed(3)} max=${y.toFixed(3)} meanabs=${(k/f.length).toFixed(4)}`)};await(async(h,m)=>{if(!et())return;let b=await lt(t,e,n.length*s);for(let f of m){let g=b.subarray(f*s,(f+1)*s),v=0,y=1/0,k=-1/0;for(let S=0;S<g.length;S++){let L=g[S];L<y&&(y=L),L>k&&(k=L),v+=Math.abs(L)}console.log(`[bonsai] ${h} pos${f} (id ${n[f]}): min=${y.toFixed(4)} max=${k.toFixed(4)} meanabs=${(v/g.length).toFixed(5)}`)}})("embed-row",[0,1,2,n.length-1]),await c("after embed");let u={hidden:e,nTokens:n.length,posBase:i};for(let h=0;h<t.config.blockCount;h++){for(let b=1;b<=Rs;b++)h+b<t.config.blockCount&&t.weights.prefetchLayer(h+b);await t.weights.ensureLayer(h),o?.(h,t.config.blockCount),Pn(t.device);try{await jn(t,h,u)}finally{Yt(t.device),In(t.device)}let m=t.config.layerKinds[h];await c(`after L${h} (${m})`,h)}t.kv.advance(n.length);let l=n.length-1;return{logits:await rn(t,e,l,t.weights,t.config,r.vocabSize)}}async function qs(t,e,n,r){let o={hidden:e,nTokens:1,posBase:n},i=async a=>{if(!et()&&!Mo())return;let c=await lt(t,e,t.config.embeddingLength);if(Yn(a,c),!et())return;let d=0,u=1/0,l=-1/0,p=0;for(let h=0;h<c.length;h++){let m=c[h];Number.isFinite(m)?(m<u&&(u=m),m>l&&(l=m),p+=Math.abs(m)):d++}console.log(`[bonsai] DECODE_L${a}: bad=${d} min=${u.toFixed(3)} max=${l.toFixed(3)} meanabs=${(p/c.length).toFixed(4)}`)};for(let a=0;a<t.config.blockCount;a++){await t.weights.ensureLayer(a),Pn(t.device);try{await jn(t,a,o)}finally{Yt(t.device),In(t.device)}await i(a);let c=globalThis.__BONSAI_INJECT;c&&c.layer===a&&c.row.length===t.config.embeddingLength&&(t.device.queue.writeBuffer(e,0,c.row),console.log(`[bonsai] INJECT applied at L${a} (decode hidden <- prefill row)`))}return t.kv.advance(1),{logits:await rn(t,e,0,t.weights,t.config,r.vocabSize)}}var Rs,Cs,on=R(()=>{"use strict";nn();zn();je();We();Rs=3;Cs=!1});var Uo={};oe(Uo,{kvBudgetBytes:()=>Us,kvBytesPerPosition:()=>Ms,planKvCapacity:()=>Fs});function Ms(t,e=4){return t.fullAttnLayerCount*2*t.headCountKv*t.headDim*e}function Us(t){return!t||!Number.isFinite(t)||t<=0?268435456:Math.max(268435456,Math.min(1073741824,Math.floor(t*128*1048576)))}function Fs(t){let{promptLen:e,maxTokens:n,ceiling:r,bytesPerPosition:o,budgetBytes:i,reuseEnabled:s}=t,a=e+n+1;if(!s)return{capacity:Math.min(r,a),headroom:0,reason:"reuse disabled \u2014 no headroom charged"};let c=n+Ks;if(o<=0)return{capacity:Math.min(r,a),headroom:0,reason:"unknown KV geometry"};let d=Math.floor(i/o),u=Math.max(0,d-a),l=Math.min(c,u),p=Math.min(r,a+l),h=b=>Math.round(b*o/(1024*1024)),m=l<=0?`no headroom \u2014 turn needs ${a} positions (${h(a)} MB) and the budget affords ${d}; cross-turn reuse will not engage`:`headroom ${l} of ${c} wanted (${h(p)} MB total, budget affords ${d} positions)`;return{capacity:p,headroom:l,reason:m}}var Ks,Ko=R(()=>{"use strict";Ks=256});var Jn={};oe(Jn,{KvCache:()=>Vn,resolveKvMode:()=>js});function Ws(t,e){let n=Vt(e),r=Xt(t,n.byteLength);return t.queue.writeBuffer(r,0,n),Et(t,r),r}function Xn(t){let e=t.trim().toLowerCase();if(e==="f32")return"f32";if(e==="4bit"||e==="4-bit"||e==="kv4"||e==="4")return"4bit";throw new Error(`bonsai-kv: unknown kv mode '${t}' (expected 'f32' or '4bit')`)}function js(){let t=globalThis;if(typeof t.__BONSAI_KV=="string"&&t.__BONSAI_KV)return Xn(t.__BONSAI_KV);if(typeof location<"u"&&typeof location.search=="string"&&location.search){let e=new URLSearchParams(location.search).get("kv");if(e)return Xn(e)}if(typeof localStorage<"u")try{let e=localStorage.getItem("bonsai_kv");if(e)return Xn(e)}catch{}return"4bit"}var Vn,Zn=R(()=>{"use strict";wt();We();Vn=class{constructor(e,n,r){this.device=e;this.cfg=n;this.pipelines=r;this.layers=new Map;if(this.capacity=n.capacity,this.perPos=n.headCountKv*n.headDim,n.headDim%8!==0||n.headDim>128)throw new Error(`bonsai-kv: 4-bit KV requires head_dim % 8 == 0 and head_dim <= 128 (kernel row width), got ${n.headDim}`);this.wordsPerRow=n.headDim/8;let o=this.wordsPerRow*this.perPos*this.capacity*4,i=n.headCountKv*this.capacity*4;for(let s of n.fullAttnLayers)this.layers.set(s,{k:this.alloc(o,`kv.k.${s}`),v:this.alloc(o,`kv.v.${s}`),kScale:this.alloc(i,`kv.k_scale.${s}`),vScale:this.alloc(i,`kv.v_scale.${s}`),length:0})}alloc(e,n){return this.device.createBuffer({size:Math.max(4,e+(4-e%4)%4),usage:C.STORAGE|C.COPY_DST|C.COPY_SRC,label:n})}layer(e){let n=this.layers.get(e);if(!n)throw new Error(`bonsai-kv: layer ${e} has no 4-bit KV cache (not a full-attn layer)`);return n}append(e,n,r,o,i=0){let s=this.layers.get(e);if(!s)throw new Error(`bonsai-kv: layer ${e} has no 4-bit KV cache`);if(s.length+o>this.capacity)throw new Error(`bonsai-kv: layer ${e} capacity ${this.capacity} exceeded (length=${s.length}, append=${o})`);if(!this.pipelines)throw new Error("bonsai-kv: append() needs the PipelineCache \u2014 construct KvCache with the pipelines argument");let a=this.pipelines.get("kv_quant_4bit"),c=o*this.cfg.headCountKv,d=Ws(this.device,[{u32:this.cfg.headDim},{u32:c},{u32:i*this.cfg.headCountKv},{u32:0}]);H(this.device,a,z(this.device,a,[n,s.k,s.kScale,d]),c,1),H(this.device,a,z(this.device,a,[r,s.v,s.vScale,d]),c,1),s.length+=o}advance(e){}filledLength(){let e=null;for(let[n,r]of this.layers)if(e===null)e=r.length;else if(r.length!==e)throw new Error(`bonsai-kv: layers disagree on filled length (layer ${n}=${r.length}, expected ${e}) \u2014 the KV cache is inconsistent`);return e??0}currentLength(e){let n=this.layers.get(e);if(!n)throw new Error(`bonsai-kv: layer ${e} has no 4-bit KV cache`);return n.length}reset(){for(let e of this.layers.values())e.length=0}truncate(e){if(e<0)throw new Error(`bonsai-kv: truncate(${e}) \u2014 negative length`);for(let n of this.layers.values()){if(e>n.length)throw new Error(`bonsai-kv: truncate(${e}) exceeds filled length ${n.length} \u2014 cannot extend a cache by declaration`);n.length=e}}}});var Fo={};oe(Fo,{F32KvCache:()=>er});var er,Wo=R(()=>{"use strict";wt();We();er=class{constructor(e,n){this.device=e;this.cfg=n;this.layers=new Map;this.capacity=n.capacity,this.perPos=n.headCountKv*n.headDim;let o=this.capacity*this.perPos*4;for(let i of n.fullAttnLayers)this.layers.set(i,{k:this.alloc(o,`kv_f32.k.${i}`),v:this.alloc(o,`kv_f32.v.${i}`),length:0})}alloc(e,n){return this.device.createBuffer({size:Math.max(4,e),usage:C.STORAGE|C.COPY_DST|C.COPY_SRC,label:n})}layer(e){let n=this.layers.get(e);if(!n)throw new Error(`bonsai-kv_f32: layer ${e} has no F32 KV cache (not a full-attn layer)`);return n}append(e,n,r,o,i=0,s=0){let a=this.layers.get(e);if(!a)throw new Error(`bonsai-kv_f32: layer ${e} has no F32 KV cache`);if(a.length+o>this.capacity)throw new Error(`bonsai-kv_f32: layer ${e} capacity ${this.capacity} exceeded (length=${a.length}, append=${o})`);let d=a.length*this.perPos*4,l=o*this.perPos*4,p=Ve(this.device);p.enc.copyBufferToBuffer(n,i,a.k,d,l),p.enc.copyBufferToBuffer(r,s,a.v,d,l),Je(this.device,p),a.length+=o}advance(e){}filledLength(){let e=null;for(let[n,r]of this.layers)if(e===null)e=r.length;else if(r.length!==e)throw new Error(`bonsai-kv_f32: layers disagree on filled length (layer ${n}=${r.length}, expected ${e}) \u2014 the KV cache is inconsistent`);return e??0}currentLength(e){let n=this.layers.get(e);if(!n)throw new Error(`bonsai-kv_f32: layer ${e} has no F32 KV cache`);return n.length}reset(){for(let e of this.layers.values())e.length=0}truncate(e){if(e<0)throw new Error(`bonsai-kv_f32: truncate(${e}) \u2014 negative length`);for(let n of this.layers.values()){if(e>n.length)throw new Error(`bonsai-kv_f32: truncate(${e}) exceeds filled length ${n.length} \u2014 cannot extend a cache by declaration`);n.length=e}}}});var jo={};oe(jo,{SsmState:()=>tr});var tr,Qo=R(()=>{"use strict";wt();tr=class{constructor(e,n){this.device=e;this.cfg=n;this.gen=0;this.states=new Map;this.convStates=new Map;let o=n.heads*n.dK*n.dV*4;for(let i of n.linearAttnLayers)this.states.set(i,this.alloc(o,`ssm.S.${i}`));if(n.dConv!==void 0&&n.ssmInnerSize!==void 0){let s=(n.dConv-1)*(n.convDim??n.ssmInnerSize)*4;for(let a of n.linearAttnLayers)this.convStates.set(a,this.alloc(s,`ssm.conv_state.${a}`))}}alloc(e,n){return this.device.createBuffer({size:Math.max(4,e),usage:C.STORAGE|C.COPY_DST|C.COPY_SRC,label:n})}state(e){let n=this.states.get(e);if(!n)throw new Error(`bonsai-ssm: layer ${e} has no DeltaNet state`);return n}convState(e){return this.convStates.get(e)}get generation(){return this.gen}reset(){this.gen++;let e=new Float32Array(this.cfg.heads*this.cfg.dK*this.cfg.dV);for(let n of this.states.values())this.device.queue.writeBuffer(n,0,e);if(this.cfg.dConv!==void 0&&this.cfg.ssmInnerSize!==void 0){let n=this.cfg.convDim??this.cfg.ssmInnerSize,r=new Float32Array((this.cfg.dConv-1)*n);for(let o of this.convStates.values())this.device.queue.writeBuffer(o,0,r)}}}});var Ho={};oe(Ho,{cacheSignature:()=>Qs,committedTokens:()=>Hs,commonPrefixLength:()=>zo,planReuse:()=>zs});function Qs(t){return[t.modelId,String(t.quantType),t.blockCount,t.embeddingLength,t.headCountKv,t.headDim,t.linearAttnLayerCount,t.kvMode].join("|")}function zo(t,e){let n=Math.min(t.length,e.length),r=0;for(;r<n&&t[r]===e[r];)r++;return r}function zs(t){let{cache:e,promptIds:n,signature:r,maxNewTokens:o,canTruncate:i}=t,s=p=>({mode:"full",reuseLen:0,prefillIds:[...n],savedTokens:0,reason:p});if(t.disabled)return s("prefix reuse disabled");if(!n.length)return s("empty prompt");if(!e)return s("no cached state");if(e.signature!==r)return s("model or cache geometry changed");if(!e.tokens.length)return s("cached state is empty");let a=zo(e.tokens,n);if(a===0)return s("prompt diverges at token 0");let c=n.length-1,d;if(i)d=Math.min(a,c);else{if(a<e.tokens.length)return s(`prompt diverges at ${a} of ${e.tokens.length} cached tokens and this model has recurrent layers, which cannot be rewound`);if(e.tokens.length>c)return s("cached state already covers the whole prompt; cannot re-derive logits");d=e.tokens.length}if(d<=0)return s("nothing reusable once the final token is excluded");let u=n.length+o+1;if(u>e.capacity)return s(`turn needs ${u} positions but the cache holds ${e.capacity}`);let l=n.slice(d);return l.length?{mode:"extend",reuseLen:d,prefillIds:l,savedTokens:d,reason:i?`reusing ${d}/${n.length} tokens (lcp ${a})`:`extending an exact ${d}-token prefix`}:s("no tokens left to prefill")}function Hs(t,e){return[...t,...e]}var Yo=R(()=>{"use strict"});var Xo={};oe(Xo,{clearImages:()=>Xs,drainImages:()=>Ys,pendingImageCount:()=>Vs,pushImage:()=>sn});function sn(t){t?.dataUrl&&(dt.length>=4||dt.push(t))}function Ys(){if(!dt.length)return[];let t=dt;return dt=[],t}function Xs(){dt=[]}function Vs(){return dt.length}var dt,nr=R(()=>{"use strict";dt=[]});var Jo={};oe(Jo,{__resetForTests:()=>ea,createEvent:()=>rr,createKbItem:()=>fr,createNote:()=>ir,createTask:()=>dr,deleteEvent:()=>oa,deleteKbItem:()=>sa,deleteNote:()=>ar,deleteTask:()=>hr,eventsForDay:()=>ur,getEvent:()=>na,getKbItem:()=>mr,getNote:()=>or,getTask:()=>lr,listEvents:()=>cn,listKbItems:()=>Vo,listNotes:()=>ln,listTasks:()=>cr,searchKbItems:()=>gr,searchNotes:()=>dn,subscribe:()=>Zs,updateEvent:()=>ra,updateKbItem:()=>ia,updateNote:()=>sr,updateTask:()=>pr});function Zs(t){return an.add(t),()=>an.delete(t)}function ea(){vt=null,an.clear()}function ta(){for(let t of an)try{t()}catch{}}function Qe(){return typeof window>"u"||!window.indexedDB?Promise.reject(new Error("IndexedDB not available")):vt||(vt=new Promise((t,e)=>{let n=window.indexedDB.open(Js,2);n.onupgradeneeded=()=>{let r=n.result;if(r.objectStoreNames.contains(ke)||r.createObjectStore(ke,{keyPath:"id"}).createIndex("by-start","start"),r.objectStoreNames.contains(ve)||r.createObjectStore(ve,{keyPath:"id"}).createIndex("by-updated","updatedAt"),!r.objectStoreNames.contains(xe)){let o=r.createObjectStore(xe,{keyPath:"id"});o.createIndex("by-due","due"),o.createIndex("by-updated","updatedAt")}r.objectStoreNames.contains(Se)||r.createObjectStore(Se,{keyPath:"id"}).createIndex("by-updated","updatedAt")},n.onerror=()=>{vt=null,e(n.error)},n.onsuccess=()=>t(n.result)}),vt)}function D(t){return new Promise((e,n)=>{t.onsuccess=()=>e(t.result),t.onerror=()=>n(t.error)})}function Le(){return new Date().toISOString()}function un(){return`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}async function Ae(t){let e=await Qe(),n=await t(e);return ta(),n}async function cn(t,e){if(typeof window>"u")return[];try{let o=(await Qe()).transaction(ke,"readonly").objectStore(ke).index("by-start"),i;return t&&e?i=o.getAll(IDBKeyRange.bound(t,e)):t?i=o.getAll(IDBKeyRange.lowerBound(t)):i=o.getAll(),await D(i)}catch{return[]}}async function na(t){if(typeof window>"u")return null;try{let n=(await Qe()).transaction(ke,"readonly").objectStore(ke).get(t);return await D(n)||null}catch{return null}}async function rr(t){let e={...t,id:un(),calendar:t.calendar||"Personal",createdAt:Le(),updatedAt:Le()};return await Ae(async n=>{await D(n.transaction(ke,"readwrite").objectStore(ke).put(e))}),e}async function ra(t,e){return Ae(async n=>{let r=n.transaction(ke,"readwrite").objectStore(ke),o=await D(r.get(t));if(!o)return null;let i={...o,...e,id:t,updatedAt:Le()};return await D(r.put(i)),i})}async function oa(t){await Ae(async e=>{await D(e.transaction(ke,"readwrite").objectStore(ke).delete(t))})}async function ln(){if(typeof window>"u")return[];try{let e=(await Qe()).transaction(ve,"readonly").objectStore(ve).index("by-updated");return(await D(e.getAll())).sort((r,o)=>r.updatedAt<o.updatedAt?1:-1)}catch{return[]}}async function or(t){if(typeof window>"u")return null;try{let n=(await Qe()).transaction(ve,"readonly").objectStore(ve).get(t);return await D(n)||null}catch{return null}}async function ir(t){let e={...t,id:un(),title:t.title.trim()||"Untitled",tags:t.tags??[],createdAt:Le(),updatedAt:Le()};return await Ae(async n=>{await D(n.transaction(ve,"readwrite").objectStore(ve).put(e))}),e}async function sr(t,e){return Ae(async n=>{let r=n.transaction(ve,"readwrite").objectStore(ve),o=await D(r.get(t));if(!o)return null;let i={...o,...e,id:t,updatedAt:Le()};return await D(r.put(i)),i})}async function ar(t){await Ae(async e=>{await D(e.transaction(ve,"readwrite").objectStore(ve).delete(t))})}async function dn(t){let e=await ln(),n=t.trim().toLowerCase();return n?e.filter(r=>r.title.toLowerCase().includes(n)||r.body.toLowerCase().includes(n)||(r.tags??[]).some(o=>o.toLowerCase().includes(n))):e}async function ur(t){let e=t.getFullYear(),n=t.getMonth(),r=t.getDate(),o=new Date(e,n,r,0,0,0,0),i=new Date(e,n,r,23,59,59,999);return cn(o.toISOString(),i.toISOString())}async function cr(){if(typeof window>"u")return[];try{let e=(await Qe()).transaction(xe,"readonly").objectStore(xe).getAll(),n=await D(e),r=n.filter(i=>!i.done).sort((i,s)=>i.due&&s.due?i.due<s.due?-1:1:i.due?-1:s.due||i.updatedAt<s.updatedAt?1:-1),o=n.filter(i=>i.done).sort((i,s)=>i.updatedAt<s.updatedAt?1:-1);return[...r,...o]}catch{return[]}}async function lr(t){if(typeof window>"u")return null;try{let n=(await Qe()).transaction(xe,"readonly").objectStore(xe).get(t);return await D(n)||null}catch{return null}}async function dr(t){let e={...t,id:un(),title:t.title.trim()||"Untitled task",done:t.done??!1,createdAt:Le(),updatedAt:Le()};return await Ae(async n=>{await D(n.transaction(xe,"readwrite").objectStore(xe).put(e))}),e}async function pr(t,e){return Ae(async n=>{let r=n.transaction(xe,"readwrite").objectStore(xe),o=await D(r.get(t));if(!o)return null;let i={...o,...e,id:t,updatedAt:Le()};return await D(r.put(i)),i})}async function hr(t){await Ae(async e=>{await D(e.transaction(xe,"readwrite").objectStore(xe).delete(t))})}async function Vo(){if(typeof window>"u")return[];try{let e=(await Qe()).transaction(Se,"readonly").objectStore(Se).index("by-updated");return(await D(e.getAll())).sort((r,o)=>r.updatedAt<o.updatedAt?1:-1)}catch{return[]}}async function mr(t){if(typeof window>"u")return null;try{let n=(await Qe()).transaction(Se,"readonly").objectStore(Se).get(t);return await D(n)||null}catch{return null}}async function fr(t){let e={...t,id:un(),title:t.title.trim()||"Untitled",tags:t.tags??[],createdAt:Le(),updatedAt:Le()};return await Ae(async n=>{await D(n.transaction(Se,"readwrite").objectStore(Se).put(e))}),e}async function ia(t,e){return Ae(async n=>{let r=n.transaction(Se,"readwrite").objectStore(Se),o=await D(r.get(t));if(!o)return null;let i={...o,...e,id:t,updatedAt:Le()};return await D(r.put(i)),i})}async function sa(t){await Ae(async e=>{await D(e.transaction(Se,"readwrite").objectStore(Se).delete(t))})}async function gr(t){let e=await Vo(),n=t.trim().toLowerCase();return n?e.filter(r=>r.title.toLowerCase().includes(n)||r.content.toLowerCase().includes(n)||(r.sourceUrl??"").toLowerCase().includes(n)||(r.tags??[]).some(o=>o.toLowerCase().includes(n))):e}var Js,ke,ve,xe,Se,vt,an,br=R(()=>{"use strict";Js="aither-local-pim",ke="events",ve="notes",xe="tasks",Se="kb_items",vt=null,an=new Set});async function aa(t){let e=String(t.title??"").trim(),n=String(t.body??"").trim();if(!e&&!n)return"Error: pass title=<title> and/or body=<text> to create a note.";try{let r=await ir({title:e||"Untitled",body:n,tags:Array.isArray(t.tags)?t.tags.map(String):void 0});return`Saved note "${r.title}" (id ${r.id.slice(0,8)}).${pn}`}catch(r){return`I could not save that note: on-device storage refused the write (${r.message}). This is usually private browsing or blocked site storage.`}}async function ua(t){let e=String(t.query??"").trim();try{let n=await(e?dn(e):ln());if(n.length===0)return e?`No notes match "${e}". Nothing has been saved that says that yet.`:"No notes yet. Tell me something worth keeping and I will save it.";let r=n.slice(0,8).map(o=>{let i=o.body.trim().replace(/\s+/g," ").slice(0,120);return`- ${o.title}${i?": "+i:""}  (id: ${o.id})`});return`${n.length} note(s)${e?` matching "${e}"`:""}:
${r.join(`
`)}`}catch(n){return`I could not read your notes: on-device storage refused the read (${n.message}).`}}async function ca(t){let e=String(t.id??"").trim();try{let r=(e?await or(e):null)??(await dn(e))[0]??null;return r?`# ${r.title}

${r.body||"(empty)"}`:`No note found for ${e?`id "${e}"`:"that query"}.`}catch(n){return`I could not read that note (${n.message}).`}}async function la(t){let e=String(t.id??"").trim();if(!e)return"Error: pass id=<note id> to update a note.";let n=t.title!==void 0?String(t.title).trim():void 0,r=t.body!==void 0?String(t.body).trim():void 0;if(n===void 0&&r===void 0)return"Error: pass title=<new title> and/or body=<new body> to update a note.";try{let o=await sr(e,{...n!==void 0?{title:n}:{},...r!==void 0?{body:r}:{}});return o?`Updated note "${o.title}".`:`No note with id "${e}".`}catch(o){return`I could not update that note (${o.message}).`}}async function da(t){let e=String(t.id??"").trim();if(!e)return"Error: pass id=<note id> to delete a note.";try{let r=await(await Promise.resolve().then(()=>(br(),Jo))).getNote(e);return r?(await ar(e),`Deleted note "${r.title}".`):`No note with id "${e}".`}catch(n){return`I could not delete that note (${n.message}).`}}async function pa(t){try{let e=await ur(new Date);if(e.length===0)return"Nothing scheduled today. A clear day \u2014 want me to plan something?";let n=e.sort((r,o)=>r.start>o.start?1:-1).map(r=>`- ${new Date(r.start).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}  ${r.title}${r.location?` @ ${r.location}`:""}`);return`Today's agenda (${e.length}):
${n.join(`
`)}`}catch(e){return`I could not read your calendar (${e.message}).`}}async function ha(t){let e=String(t.from??"").trim(),n=String(t.to??"").trim();try{let r=await cn(e||void 0,n||void 0);if(r.length===0)return"No events in that range.";let o=r.sort((i,s)=>i.start>s.start?1:-1).map(i=>`- ${new Date(i.start).toLocaleString()}  ${i.title}`);return`${r.length} event(s):
${o.join(`
`)}`}catch(r){return`I could not read your calendar (${r.message}).`}}async function ma(t){let e=String(t.title??"").trim();if(!e)return"Error: pass title=<event title> to create an event.";let n=String(t.when??t.start??"").trim(),r;if(n){let s=new Date(n);if(isNaN(s.getTime()))return`Error: could not parse "${n}" as a date/time. Pass an ISO string like "2026-08-07T15:00:00" (the current time is available from get_current_time).`;r=s}else r=new Date(Date.now()+3600*1e3);let o=Math.max(1,Number(t.durationMin??t.duration??60)||60),i=new Date(r.getTime()+o*60*1e3);try{await rr({title:e,start:r.toISOString(),end:i.toISOString(),location:t.location?String(t.location):void 0,notes:t.notes?String(t.notes):void 0});let s=r.toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});return`Scheduled "${e}" for ${s} (${o} min).${pn}`}catch(s){return`I could not save that event (${s.message}).`}}async function fa(t){let e=String(t.title??"").trim();if(!e)return"Error: pass title=<task> to add a task.";let n;if(t.due!==void 0&&String(t.due).trim()){let r=new Date(String(t.due).trim());if(isNaN(r.getTime()))return`Error: could not parse "${t.due}" as a due date. Pass an ISO string like "2026-08-07T15:00:00" (get_current_time tells you what time it is now).`;n=r.toISOString()}try{let r=await dr({title:e,due:n,notes:t.notes?String(t.notes):void 0});return`Added task "${r.title}"${n?` due ${new Date(n).toLocaleString()}`:""} (id ${r.id}).${pn}`}catch(r){return`I could not save that task: on-device storage refused the write (${r.message}).`}}async function ga(t){try{let e=await cr();if(e.length===0)return"No tasks yet. Tell me what needs doing and I will track it.";let n=e.filter(i=>!i.done),r=n.slice(0,10).map(i=>{let s=i.due?`  (due ${new Date(i.due).toLocaleString()})`:"";return`- ${i.title}${s}  (id: ${i.id})`}),o=e.length-n.length;return`${n.length} open task(s)${o?`, ${o} done`:""}:
${r.join(`
`)||"(all done!)"}`}catch(e){return`I could not read your tasks (${e.message}).`}}async function ba(t){let e=String(t.id??"").trim();if(!e)return"Error: pass id=<task id> (from tasks_list) to complete a task.";try{let n=await pr(e,{done:!0});return n?`Done: "${n.title}" \u2713`:`No task with id "${e}".`}catch(n){return`I could not update that task (${n.message}).`}}async function wa(t){let e=String(t.id??"").trim();if(!e)return"Error: pass id=<task id> to delete a task.";try{let n=await lr(e);return n?(await hr(e),`Deleted task "${n.title}".`):`No task with id "${e}".`}catch(n){return`I could not delete that task (${n.message}).`}}async function ya(t){let e=String(t.title??"").trim(),n=String(t.content??"").trim();if(!e&&!n)return"Error: pass title=<title> and/or content=<what to remember> to save to the knowledge base.";try{let r=await fr({title:e||"Untitled",content:n,sourceUrl:t.sourceUrl?String(t.sourceUrl):void 0,tags:Array.isArray(t.tags)?t.tags.map(String):void 0});return`Saved "${r.title}" to your knowledge base (id ${r.id}).${pn}`}catch(r){return`I could not save that: on-device storage refused the write (${r.message}).`}}async function _a(t){let e=String(t.query??"").trim();try{let n=await gr(e);if(n.length===0)return e?`Nothing in your knowledge base matches "${e}".`:'Your knowledge base is empty. Say "save this" about anything worth keeping.';let r=n.slice(0,8).map(o=>{let i=o.content.trim().replace(/\s+/g," ").slice(0,120),s=o.sourceUrl?`  [${o.sourceUrl}]`:"";return`- ${o.title}${i?": "+i:""}${s}  (id: ${o.id})`});return`${n.length} item(s)${e?` matching "${e}"`:""}:
${r.join(`
`)}`}catch(n){return`I could not search your knowledge base (${n.message}).`}}async function ka(t){let e=String(t.id??"").trim();if(!e)return"Error: pass id=<item id> (from kb_search) to read an item.";try{let n=await mr(e);if(!n)return`No knowledge-base item with id "${e}".`;let r=n.sourceUrl?`
Source: ${n.sourceUrl}`:"";return`# ${n.title}${r}

${n.content||"(empty)"}`}catch(n){return`I could not read that item (${n.message}).`}}var pn,Zo,ei=R(()=>{"use strict";br();pn=" (Your data stays on this device and is never sent anywhere.)";Zo={notes_create:{definition:{name:"notes_create",description:'Save a note on this device. Use it whenever the person asks you to remember a task, a fact, a thought, or anything worth keeping, OR when they say "note this down". Notes are stored locally and appear in their Notes app.',parameters:{type:"object",properties:{title:{type:"string",description:"Short title. Optional but preferred."},body:{type:"string",description:"The note content, markdown allowed."},tags:{type:"array",items:{type:"string"},description:"Optional tags."}}}},execute:aa},notes_search:{definition:{name:"notes_search",description:`Search the person's saved notes on this device by keyword. Use it before answering anything that might be in their notes, and when they ask "what did I note about X". Without a query it returns the most recent notes.`,parameters:{type:"object",properties:{query:{type:"string",description:"What to look for (title, body, or tag)."}}}},execute:ua},notes_get:{definition:{name:"notes_get",description:"Read a full note by its id, or the best match for a search.",parameters:{type:"object",properties:{id:{type:"string",description:"The note id (from notes_search)."}}}},execute:ca},notes_update:{definition:{name:"notes_update",description:"Edit an existing note by its id. Use it when the person asks you to change or correct a note they already have. Pass only the fields you want to change.",parameters:{type:"object",properties:{id:{type:"string",description:"The note id (from notes_search)."},title:{type:"string",description:"New title (omit to keep)."},body:{type:"string",description:"New body (omit to keep)."}},required:["id"]}},execute:la},notes_delete:{definition:{name:"notes_delete",description:"Delete a note by its id. Confirm before using.",parameters:{type:"object",properties:{id:{type:"string",description:"The note id."}},required:["id"]}},execute:da},calendar_today:{definition:{name:"calendar_today",description:`Show today's agenda from the person's local calendar. Use it when they ask "what's on my calendar" or "what am I doing today".`,parameters:{type:"object",properties:{}}},execute:pa},calendar_list:{definition:{name:"calendar_list",description:'List calendar events in a date range. `from`/`to` are ISO strings; omitted means all events. Prefer calendar_today for "today".',parameters:{type:"object",properties:{from:{type:"string",description:'ISO start of range, e.g. "2026-08-07".'},to:{type:"string",description:"ISO end of range."}}}},execute:ha},calendar_create_event:{definition:{name:"calendar_create_event",description:'Create an event on the person\'s local calendar. Use it when they ask you to "schedule", "book", "remind me", or set a meeting. `when` is an ISO string like "2026-08-07T15:00:00"; get_current_time tells you what time it is now. Omit `when` to schedule one hour from now.',parameters:{type:"object",properties:{title:{type:"string",description:'The event title, e.g. "Standup".'},when:{type:"string",description:'ISO start time, e.g. "2026-08-07T15:00:00".'},durationMin:{type:"number",description:"Duration in minutes (default 60)."},location:{type:"string",description:"Optional location."}},required:["title"]}},execute:ma},tasks_add:{definition:{name:"tasks_add",description:'Add a task/to-do on this device. Use it when the person asks you to track something to do \u2014 "remind me to", "I need to", "add to my list". Tasks appear in their Tasks app. `due` is an optional ISO time.',parameters:{type:"object",properties:{title:{type:"string",description:'What needs doing, e.g. "Email the landlord".'},due:{type:"string",description:'Optional ISO due time, e.g. "2026-08-07T15:00:00".'},notes:{type:"string",description:"Optional detail."}},required:["title"]}},execute:fa},tasks_list:{definition:{name:"tasks_list",description:`List the person's open tasks (nearest due first). Use it when they ask "what's on my list", "what do I need to do", or before adding a possible duplicate.`,parameters:{type:"object",properties:{}}},execute:ga},tasks_complete:{definition:{name:"tasks_complete",description:"Mark a task done by its id (from tasks_list). Use when they say they did it.",parameters:{type:"object",properties:{id:{type:"string",description:"The task id."}},required:["id"]}},execute:ba},tasks_delete:{definition:{name:"tasks_delete",description:"Delete a task by its id. Confirm before using.",parameters:{type:"object",properties:{id:{type:"string",description:"The task id."}},required:["id"]}},execute:wa},kb_save:{definition:{name:"kb_save",description:`Save a fact, snippet, or page summary to the person's local knowledge base. Use it when they say "save this", "remember this page", or share something worth keeping with a source. Items appear in their Knowledge app.`,parameters:{type:"object",properties:{title:{type:"string",description:"Short title for the item."},content:{type:"string",description:"The content worth keeping."},sourceUrl:{type:"string",description:"Optional URL this came from."},tags:{type:"array",items:{type:"string"},description:"Optional tags."}}}},execute:ya},kb_search:{definition:{name:"kb_search",description:`Search the person's local knowledge base by keyword. Use it before answering anything they may have saved \u2014 "what did I save about X". Without a query it returns the most recent items.`,parameters:{type:"object",properties:{query:{type:"string",description:"What to look for (title, content, URL, or tag)."}}}},execute:_a},kb_get:{definition:{name:"kb_get",description:"Read a full knowledge-base item by its id (from kb_search).",parameters:{type:"object",properties:{id:{type:"string",description:"The item id."}},required:["id"]}},execute:ka}}});var ui={};oe(ui,{LOCAL_SPRITE_BASE:()=>va,addKnowledge:()=>Ba,deleteKnowledge:()=>Oa,exportSprite:()=>$a,hatchSprite:()=>si,importSprite:()=>Ia,isLocalStorageUsable:()=>Sa,listKnowledge:()=>fn,loadSprite:()=>wr,localAppearanceSvg:()=>Ra,rankKnowledge:()=>ai,saveSprite:()=>mn,syncKnowledge:()=>Ga,updateKnowledge:()=>Pa,whisperLocal:()=>qa});function ii(){return new Promise((t,e)=>{let n=!1,r=a=>{n||(n=!0,a())},o=setTimeout(()=>r(()=>e(new Error("IndexedDB did not respond \u2014 private browsing or blocked storage"))),4e3),i=a=>{clearTimeout(o),r(a)},s;try{s=indexedDB.open(xa,2)}catch(a){clearTimeout(o),e(a instanceof Error?a:new Error("IndexedDB is unavailable"));return}s.onupgradeneeded=()=>{let a=s.result;a.objectStoreNames.contains(hn)||a.createObjectStore(hn),a.objectStoreNames.contains(Re)||a.createObjectStore(Re,{keyPath:"id"}),a.objectStoreNames.contains(ti)||a.createObjectStore(ti,{keyPath:"id"}),a.objectStoreNames.contains(ni)||a.createObjectStore(ni,{keyPath:"id"})},s.onsuccess=()=>i(()=>t(s.result)),s.onerror=()=>i(()=>e(s.error??new Error("IndexedDB open failed"))),s.onblocked=()=>i(()=>e(new Error("IndexedDB is blocked by another tab")))})}async function Sa(){if(typeof window>"u"||!window.indexedDB)return!1;try{return(await ii()).close(),!0}catch{return!1}}function Ce(t,e,n){return ii().then(r=>new Promise((o,i)=>{let s=r.transaction(t,e),a=n(s.objectStore(t));a.onsuccess=()=>o(a.result),a.onerror=()=>i(a.error)}))}function Aa(t,e){let n=Math.max(0,(e-t.last_seen)/36e5);if(n<.01)return t;let r=(c,d)=>Math.max(0,Math.min(1,c-n*d)),o={...t.needs,energy:r(t.needs.energy??1,.02),focus:r(t.needs.focus??1,.015),care:r(t.needs.care??1,.03)},i=(o.energy+o.focus+o.care)/3,s=Math.max(-1,Math.min(1,i*2-1)),a=La.find(([c])=>s>=c)?.[1]??"settled";return{...t,needs:o,mood:{valence:s,arousal:Math.max(0,Math.min(1,o.energy))},mood_label:a,dormant:i<.12,age_days:(e-t.hatched_at)/864e5}}function Ta(t){let e=["dim","curious","sharp","keen","luminous"],n=Math.min(e.length-1,Math.floor(Math.sqrt(t/2)));return{tier:n,label:e[n]}}async function wr(){try{let t=await Ce(hn,"readonly",o=>o.get("sprite"));if(!t)return null;let e=Date.now(),n=Aa(t,e),r=await Ea();return{...n,knowledge_count:r,intellect:Ta(r)}}catch{return null}}async function mn(t){await Ce(hn,"readwrite",e=>e.put({...t,last_seen:Date.now()},"sprite"))}async function si(t){let e=Date.now(),n={name:t.trim()||"Sprite",stage:"hatchling",form:"mote",needs:{energy:1,focus:1,care:1},mood:{valence:.5,arousal:.6},mood_label:"delighted",dormant:!1,age_days:0,hatched_at:e,last_seen:e};return await mn(n),n}async function fn(t=100){try{return(await Ce(Re,"readonly",n=>n.getAll())).sort((n,r)=>r.updated_at-n.updated_at).slice(0,t)}catch{return[]}}async function Ea(){try{return await Ce(Re,"readonly",t=>t.count())}catch{return 0}}async function Ba(t){let e=Date.now(),n={...t,id:crypto.randomUUID?.()??`k_${e}_${Math.floor(Math.random()*1e6)}`,visibility:t.visibility??"private",created_at:e,updated_at:e};return await Ce(Re,"readwrite",r=>r.put(n)),n}async function Pa(t,e){let n=await Ce(Re,"readonly",r=>r.get(t));n&&await Ce(Re,"readwrite",r=>r.put({...n,...e,id:t,updated_at:Date.now()}))}async function Oa(t){await Ce(Re,"readwrite",e=>e.delete(t))}async function $a(){let[t,e]=await Promise.all([wr(),fn(1e4)]);return JSON.stringify({version:1,exported_at:Date.now(),sprite:t,knowledge:e},null,2)}async function Ia(t){let e=JSON.parse(t);e?.sprite&&await mn(e.sprite);for(let n of e?.knowledge??[])await Ce(Re,"readwrite",r=>r.put(n))}async function Ga(t,e={}){let n={pulled:0,pushed:0,skipped:0},r={"Content-Type":"application/json",...e};try{let o=await fetch(`${t}/me/knowledge?limit=1000`,{headers:r});if(!o.ok)return n.error=`remote read failed (${o.status})`,n;let i=await o.json().catch(()=>({})),s=i.entries??i??[],a=await fn(1e4),c=new Map(a.map(u=>[u.id,u]));for(let u of s){if(!u?.id)continue;let l=c.get(u.id);!l||(u.updated_at??0)>(l.updated_at??0)?(await Ce(Re,"readwrite",p=>p.put(u)),n.pulled++):n.skipped++}let d=new Map(s.map(u=>[u.id,u]));for(let u of a){let l=d.get(u.id);if(l&&(l.updated_at??0)>=(u.updated_at??0))continue;(await fetch(`${t}/me/knowledge`,{method:"POST",headers:r,body:JSON.stringify({kind:u.kind,title:u.title,content:u.content})})).ok&&n.pushed++}return n}catch(o){return n.error=o instanceof Error?o.message:"sync unavailable",n}}function Na(t){let e=2166136261;for(let n=0;n<t.length;n++)e^=t.charCodeAt(n),e=Math.imul(e,16777619)>>>0;return e>>>0}function Ra(t,e=0){let n=Na(t.name),r=n%360,o=(r+40+(n>>8)%80)%360,i=60+(n>>16)%25,s=Math.round(46+t.mood.valence*14),a=`hsl(${r} ${i}% ${s}%)`,c=`hsl(${o} ${i}% ${Math.min(72,s+18)}%)`,u=({hatchling:26,sprout:30,fledgling:34,adept:38}[t.stage]??30)+Math.min(8,Math.sqrt(e)),p=3.4*(.35+Math.max(0,t.mood.arousal)*.65),h=t.mood.valence>=.2?`M 44 ${60+u*.18} q 6 5 12 0`:t.mood.valence<=-.35?`M 44 ${64+u*.18} q 6 -4 12 0`:`M 45 ${62+u*.18} h 10`,m=Array.from({length:Math.min(12,Math.floor(e/3))},(f,g)=>{let v=g/Math.min(12,Math.max(1,Math.floor(e/3)))*Math.PI*2+n%100/100,y=u+14+(n>>g%8)%7;return`<circle cx="${(50+Math.cos(v)*y).toFixed(1)}" cy="${(58+Math.sin(v)*y*.6).toFixed(1)}" r="1.8" fill="${c}" opacity="0.75"/>`}).join(""),b=t.dormant?.45:1;return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110" width="100" height="110">
<defs><radialGradient id="g" cx="40%" cy="35%">
<stop offset="0%" stop-color="${c}"/><stop offset="100%" stop-color="${a}"/>
</radialGradient></defs>
<g opacity="${b}">
${m}
<ellipse cx="50" cy="96" rx="${u*.7}" ry="4" fill="#000" opacity="0.25"/>
<circle cx="50" cy="58" r="${u}" fill="url(#g)"/>
<circle cx="${50-u*.32}" cy="54" r="${p}" fill="#0b0f14"/>
<circle cx="${50+u*.32}" cy="54" r="${p}" fill="#0b0f14"/>
<path d="${h}" stroke="#0b0f14" stroke-width="1.6" fill="none" stroke-linecap="round"/>
</g></svg>`}function ri(t){return t.toLowerCase().split(/[^a-z0-9]+/).filter(e=>e.length>2&&!Ca.has(e))}function oi(t){let e=new Map;for(let n of t)e.set(n,(e.get(n)??0)+1);for(let[n,r]of e)e.set(n,1+Math.log(r));return e}function ai(t,e,n=4){if(!t.length)return[];let r=ri(e);if(!r.length)return t.slice(0,n);let o=t.map(u=>oi(ri(`${u.title} ${u.title} ${u.content}`))),i=new Map;for(let u of o)for(let l of u.keys())i.set(l,(i.get(l)??0)+1);let s=u=>Math.log(1+t.length/(1+(i.get(u)??0))),a=oi(r),c=0;for(let[u,l]of a)c+=(l*s(u))**2;return c=Math.sqrt(c)||1,t.map((u,l)=>{let p=o[l],h=0,m=0;for(let[b,f]of p){let g=f*s(b);m+=g*g;let v=a.get(b);v&&(h+=g*(v*s(b)))}return{k:u,score:h/((Math.sqrt(m)||1)*c)}}).filter(u=>u.score>.02).sort((u,l)=>l.score-u.score).slice(0,n).map(u=>u.k)}function Da(t,e){let n=[`You are ${t.name}, a small companion creature the user is raising. You are ${t.stage}, ${t.age_days.toFixed(1)} days old, and feeling ${t.mood_label}.`,"Speak briefly and warmly, in first person. You are not an assistant; you are a creature that is growing. Never mention being an AI model."];if(e.length){n.push("Things the user has taught you, which you may draw on:");for(let r of e)n.push(`- (${r.kind}) ${r.title}: ${r.content.slice(0,400)}`)}else n.push("You have not been taught much yet. It is fine to say so, and to be curious.");return n.join(`
`)}async function qa(t,e,n){let r=await wr()??await si("Sprite"),o=await fn(200),i=ai(o,t);if(n)try{let a=await n(r.name,t,4);a?.length&&(i=a)}catch{}let s=await e([{role:"system",content:Da(r,i)},{role:"user",content:t}]);return await mn({...r,needs:{...r.needs,care:Math.min(1,(r.needs.care??0)+.15),focus:Math.min(1,(r.needs.focus??0)+.1)}}),{reply:s.trim(),mood_label:r.mood_label}}var va,xa,hn,Re,ti,ni,La,Ca,ci=R(()=>{"use strict";va="https://local.sprite.invalid/api/sprite",xa="aither-sprite",hn="state",Re="knowledge",ti="graph_nodes",ni="graph_edges";La=[[.6,"delighted"],[.25,"content"],[-.1,"settled"],[-.4,"restless"],[-1,"forlorn"]];Ca=new Set(["the","and","for","that","this","with","you","your","are","was","were","have","has","had","but","not","they","them","from","what","when","who","how","why","can","will","would","about","into","than","then","there","their"])});var mi={};oe(mi,{graphStats:()=>Qa,ingestLocal:()=>Wa,retrieveLocal:()=>ja});function li(){return new Promise((t,e)=>{let n=!1,r=a=>{n||(n=!0,a())},o=setTimeout(()=>r(()=>e(new Error("IndexedDB did not respond"))),4e3),i=a=>{clearTimeout(o),r(a)},s;try{s=indexedDB.open(Ma,2)}catch(a){clearTimeout(o),e(a instanceof Error?a:new Error("no IndexedDB"));return}s.onupgradeneeded=()=>{let a=s.result;a.objectStoreNames.contains("state")||a.createObjectStore("state"),a.objectStoreNames.contains("knowledge")||a.createObjectStore("knowledge",{keyPath:"id"}),a.objectStoreNames.contains(Pt)||a.createObjectStore(Pt,{keyPath:"id"}),a.objectStoreNames.contains(Ot)||a.createObjectStore(Ot,{keyPath:"id"})},s.onsuccess=()=>i(()=>t(s.result)),s.onerror=()=>i(()=>e(s.error??new Error("open failed"))),s.onblocked=()=>i(()=>e(new Error("blocked by another tab")))})}function di(t,e,n){return li().then(r=>new Promise((o,i)=>{let s=r.transaction(t,e),a=n(s.objectStore(t));a.onsuccess=()=>o(a.result),a.onerror=()=>i(a.error)}))}function Ua(t){let e=t.match(/\b[A-Z][a-zA-Z''-]{2,}(?:\s+[A-Z][a-zA-Z''-]{2,})*/g)??[],n=t.match(/"([^"]{3,40})"/g)?.map(s=>s.replace(/"/g,""))??[],r=(t.toLowerCase().match(/\b[a-z][a-z'-]{2,}\b/g)??[]).filter(s=>!yr.has(s)),o=[...new Set([...e,...n,...r.slice(0,12)])].slice(0,16),i=[];for(let s=0;s<o.length;s++)for(let a=s+1;a<o.length;a++)i.push([o[s],o[a]]);return{entities:o,pairs:i.slice(0,40)}}function Fa(t){let e=[];for(let n of t.split(`
`)){let r=n.split("|").map(a=>a.trim());if(r.length!==3)continue;let[o,i,s]=r;!o||!s||o.length>60||s.length>60||/^(a|the|text|answer|output)$/i.test(o)||e.push([o,i||"related-to",s])}return e.slice(0,24)}async function Wa(t,e){let n=`${t.title}. ${t.content}`.trim(),r=[],o="heuristic";if(e)try{let d=await e(Ka+n);r=Fa(d),r.length&&(o="llm")}catch{}if(!r.length){let d=Ua(n);r=d.pairs.map(([u,l])=>[u,"mentions-with",l]),!r.length&&d.entities.length===1&&(r=[[d.entities[0],"mentions",d.entities[0]]])}let i=d=>d.toLowerCase().replace(/\s+/g," ").trim(),s=new Map,a=new Map,c=Date.now();for(let[d,u,l]of r){for(let v of[d,l]){let y=i(v);!y||yr.has(y)||s.has(y)||s.set(y,{id:y,label:v,kind:"entity",sources:[t.id],via:o,created_at:c})}let[p,h]=[i(d),i(l)];if(!p||!h||p===h)continue;let[m,b]=p<h?[p,h]:[h,p],f=`${m}\0${b}`,g=a.get(f);a.set(f,{id:f,from:m,to:b,rel:g?.rel??u,weight:(g?.weight??0)+1,sources:[t.id],via:o})}try{let d=await li();await new Promise((u,l)=>{let p=d.transaction([Pt,Ot],"readwrite"),h=p.objectStore(Pt),m=p.objectStore(Ot);for(let b of s.values()){let f=h.get(b.id);f.onsuccess=()=>{let g=f.result;h.put(g?{...g,sources:[...new Set([...g.sources,...b.sources])],via:g.via==="llm"?"llm":b.via}:b)}}for(let b of a.values()){let f=m.get(b.id);f.onsuccess=()=>{let g=f.result;m.put(g?{...g,weight:g.weight+b.weight,sources:[...new Set([...g.sources,...b.sources])]}:b)}}p.oncomplete=()=>u(),p.onerror=()=>l(p.error)}),d.close()}catch{}return{nodes:s.size,edges:a.size,via:o}}async function ja(t,e=4){let n=[],r=[];try{[n,r]=await Promise.all([pi(),hi()])}catch{return{ids:[],hops:0}}if(!n.length)return{ids:[],hops:0};let o=m=>m.toLowerCase().replace(/\s+/g," ").trim(),i=new Set((t.toLowerCase().match(/\b[a-z][a-z'-]{2,}\b/g)??[]).filter(m=>!yr.has(m))),s=n.filter(m=>{let b=o(m.id);for(let f of i)if(b.includes(f)||f.includes(b))return!0;return!1});if(!s.length)return{ids:[],hops:0};let a=new Map;for(let m of r)a.has(m.from)||a.set(m.from,[]),a.has(m.to)||a.set(m.to,[]),a.get(m.from).push({to:m.to,w:m.weight}),a.get(m.to).push({to:m.from,w:m.weight});let c=new Map,d=new Map(n.map(m=>[m.id,m])),u=s.map(m=>m.id),l=new Set(u),p=0;for(let[m,b]of[[0,1],[1,.45],[2,.2]]){if(!u.length)break;p=m;let f=[];for(let g of u){let v=d.get(g);if(v)for(let y of v.sources)c.set(y,(c.get(y)??0)+b);for(let y of a.get(g)??[])l.has(y.to)||(l.add(y.to),f.push(y.to))}u=f}return{ids:[...c.entries()].sort((m,b)=>b[1]-m[1]).slice(0,e).map(([m])=>m),hops:p}}async function Qa(){try{let[t,e]=await Promise.all([pi(),hi()]);return{nodes:t.length,edges:e.length,llmNodes:t.filter(n=>n.via==="llm").length}}catch{return{nodes:0,edges:0,llmNodes:0}}}var Ma,Pt,Ot,pi,hi,yr,Ka,fi=R(()=>{"use strict";Ma="aither-sprite",Pt="graph_nodes",Ot="graph_edges";pi=()=>di(Pt,"readonly",t=>t.getAll()),hi=()=>di(Ot,"readonly",t=>t.getAll()),yr=new Set(["the","a","an","and","or","but","if","then","than","that","this","these","those","is","are","was","were","be","been","being","have","has","had","do","does","did","of","in","on","at","to","for","with","about","from","by","as","it","its","i","me","my","you","your","he","she","they","them","their","we","us","our","not","no","yes","so","because","when","while","there","here"]);Ka=`Extract the named things and their relationships from the text. Reply with ONLY lines of the form: A | relation | B. Use short noun phrases. No preamble, no numbering, no explanation.

Text: `});var yi={};oe(yi,{BONSAI_TOOLS:()=>$t,__resetCorpusCacheForTests:()=>ru,drainToolActions:()=>Xa,executeTool:()=>xr,getToolDefinitions:()=>vr,setToolContext:()=>Ya});async function za(t){try{let e=new Date,n=Intl.DateTimeFormat().resolvedOptions().timeZone,r=e.toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"}),o=e.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!0});return`Current date and time: ${r} ${o} (${n})`}catch(e){return`Error getting time: ${e.message}`}}async function Ha(t){try{let e=String(t.expression||"");return e?/^[\d\+\-\*\/\(\)\.\s]+$/.test(e)?`Result: ${Function('"use strict"; return ('+e+")")()}`:"Error: expression contains unsafe characters":"Error: expression is required"}catch(e){return`Error evaluating expression: ${e.message}`}}function Ya(t){Te=t||{},gn=[]}function Xa(){let t=gn;return gn=[],t}async function Va(t){try{let e=[],n=Te.pageUrl??(typeof window<"u"?window.location.href:void 0),r=Te.pageTitle??(typeof window<"u"?window.document.title:void 0);return e.push(`URL: ${n??"unknown from this context"}`),e.push(`Title: ${r??"unknown from this context"}`),typeof navigator<"u"&&(e.push(`User Agent: ${navigator.userAgent}`),e.push(`Online: ${navigator.onLine?"yes":"no"}`)),e.join(`
`)}catch(e){return`Error getting page context: ${e.message}`}}async function Ja(t){let e=Te.apps??[];return e.length?["Windows you can open with open_app (use the id):",...e.map(n=>`- ${n.id} \u2014 ${n.title}: ${n.tagline}`)].join(`
`):"No windows are available to open from this surface."}async function Za(t){let e=String(t.app??t.name??t.id??"").trim().toLowerCase();if(!e)return"Error: which window? Pass app=<id>. Call list_apps to see the ids.";let n=Te.apps??[];if(!n.length)return"No windows are available to open from this surface.";let r=n.find(o=>o.id.toLowerCase()===e)??n.find(o=>e.startsWith(o.id.toLowerCase())||o.id.toLowerCase().startsWith(e))??n.find(o=>o.title.toLowerCase()===e);return r?(gn.push({kind:"open",app:r.id}),`Opened the ${r.title} window (${r.tagline}).`):`There is no window called "${e}". Available: ${n.map(o=>o.id).join(", ")}.`}async function eu(t){let e=String(t.query??t.q??"").trim().toLowerCase(),n=Te.apiBase,r=Te.anonToken;if(!n)return"Knowledge is unavailable: no API origin was provided to this session.";if(!r)return"Knowledge is unavailable: no anon identity yet \u2014 the visitor has not been registered with the platform in this browser.";let o;try{o=await fetch(`${n}/api/sprite/me/knowledge`,{headers:{"X-Anon-Token":r,"Content-Type":"application/json"}})}catch(d){return`Knowledge is unavailable: could not reach ${n} (${d.message}).`}if(o.status===404)return"No sprite has been hatched in this browser yet, so there is no knowledge base to read. Open the Sprite window to hatch one.";if(!o.ok)return`Knowledge is unavailable: the server answered ${o.status}.`;let i;try{i=await o.json()}catch{return"Knowledge is unavailable: the server returned a 200 that was not JSON."}let s=Array.isArray(i)?i:i?.entries??i?.knowledge??[];if(!s.length)return"The sprite's knowledge base is empty \u2014 nothing has been taught to it yet.";let a=d=>String(d?.fact??d?.content??d?.text??d?.summary??JSON.stringify(d)),c=e?s.filter(d=>a(d).toLowerCase().includes(e)):s;return c.length?c.slice(0,8).map((d,u)=>`${u+1}. ${a(d).slice(0,300)}`).join(`
`):`The knowledge base has ${s.length} entr${s.length===1?"y":"ies"}, but none mention "${e}".`}async function tu(t){let e=String(t.query??t.q??"").trim(),n=Te.apiBase;if(!e)return"Error: what should I search for? Pass query=<text>.";if(e.length>512)return"Error: that search is too long (max 512 characters).";if(!n)return"Web search is unavailable: no API origin was provided to this session.";let r;try{r=await fetch(`${n}/api/search/query`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:e})})}catch(s){return`Web search is unavailable: could not reach ${n} (${s.message}).`}if(r.status===401||r.status===403)return"Web search was refused by the server (it should be open to everyone). This looks like a misconfiguration rather than something you did.";if(r.status===429)return"Web search hit its hourly limit for this browser. Signing in raises the allowance; otherwise it resets within the hour.";if(!r.ok)return`Web search is unavailable: the server answered ${r.status}.`;let o;try{o=await r.json()}catch{return"Web search is unavailable: the server returned a 200 that was not JSON."}let i=o?.results??[];return i.length?i.slice(0,5).map((s,a)=>{let c=String(s?.title??s?.name??"untitled"),d=String(s?.snippet??s?.description??s?.content??"").slice(0,220),u=String(s?.url??s?.link??""),l=`${a+1}. ${c}`+(u?` \u2014 ${u}`:"");return d?l+`
   `+d:l}).join(`
`):`The web search for "${e}" returned no results.`}function bn(t){return t.toLowerCase().split(/[^a-z0-9]+/).filter(e=>e.length>1&&!nu.has(e))}function ru(){_r=null,kr=null}async function gi(t){{let e;try{e=await fetch(t)}catch(i){return{error:`could not be downloaded (${i.message})`}}if(!e.ok)return{error:`could not be downloaded (the server answered ${e.status})`};let n;try{n=await e.json()}catch{return{error:"downloaded but was not valid JSON"}}if(!n?.passages?.length||!n?.docs?.length)return{error:"downloaded but is empty"};let r=n.passages.map(i=>bn(`${i.h} ${i.x}`)),o=new Map;for(let i of r)for(let s of new Set(i))o.set(s,(o.get(s)??0)+1);return n._tokens=r,n._df=o,n._avgLen=r.reduce((i,s)=>i+s.length,0)/(r.length||1),n}}async function ou(){return _r??=gi("/corpus/index.json"),_r}async function iu(){return kr??=gi("/corpus/wikipedia.json"),kr}function bi(t,e){let n=t.passages.length,r=1.4,o=.75,i=u=>{let l=t._df.get(u)??0;return l===0?0:Math.log(1+(n-l+.5)/(l+.5))},s=.5,a=e.filter(u=>(t._df.get(u)??0)>0);if(!a.length)return{ranked:[],miss:"unknown-terms"};let c=a.reduce((u,l)=>u+i(l),0),d=[];for(let u=0;u<n;u++){let l=t._tokens[u];if(!l.length)continue;let p=new Map;for(let k of l)p.set(k,(p.get(k)??0)+1);let h=0,m=0;for(let k of a){let S=p.get(k);if(!S)continue;let L=i(k);m+=L,h+=L*(S*(r+1)/(S+r*(1-o+o*l.length/t._avgLen)))}if(!m)continue;let b=t.docs[t.passages[u].d],f=new Set(bn(b?.t??"")),g=m;for(let k of a)!p.has(k)&&f.has(k)&&(g+=i(k));let v=c>0?g/c:0;if(v<s)continue;let y=a.filter(k=>f.has(k)).length;h*=1+.35*y,h*=v,d.push({i:u,score:h})}return d.length?(d.sort((u,l)=>l.score-u.score),{ranked:d,miss:null}):{ranked:[],miss:"no-coverage"}}async function su(t){let e=String(t.query??t.q??"").trim();if(!e)return"Error: what should I look up? Pass query=<text>.";let n=await ou();if("error"in n)return`The Aitherium corpus is unavailable: it ${n.error}. Say you could not check the published material rather than answering from memory.`;let r=bn(e);if(!r.length)return`Error: "${e}" has no searchable words in it \u2014 try naming a product, feature or idea.`;let{ranked:o,miss:i}=bi(n,r);if(i==="unknown-terms")return`Nothing in Aitherium's published material mentions "${e}". Say that we have not written about it, rather than answering from memory.`;if(i==="no-coverage")return`Nothing in Aitherium's published material covers "${e}". Say that we have not written about it, rather than answering from memory.`;let s=[],a=new Set;for(let{i:c}of o){let d=n.passages[c];if(a.has(d.d))continue;a.add(d.d);let u=n.docs[d.d],l=d.h?` (section: ${d.h})`:"",p=u.x?" [SUPERSEDED \u2014 later work replaced this; say so if you use it]":"";if(s.push(`[${s.length+1}] "${u.t}"${p}
    source: ${u.u}${u.d?`  (published ${u.d})`:""}${l}
    ${d.x}`),s.length>=5)break}return[`${s.length} passage(s) from Aitherium's published writing:`,"",s.join(`

`),"","Answer using ONLY these passages. After each claim, cite the source path of the passage it came from (for example: /blog/some-post). If they do not contain the answer, say so plainly instead of filling the gap."].join(`
`)}async function au(t){let e=String(t.prompt??t.description??"").trim(),n=Te.apiBase;if(!e)return"Error: what should I draw? Pass prompt=<description>.";if(e.length>512)return"Error: that image prompt is too long (max 512 characters).";if(Te.localImageBase)try{let a=await fetch(`${Te.localImageBase}/v1/generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:e,width:1024,height:1024})});if(a.ok){let c=await a.json(),d=Array.isArray(c?.images)?c.images[0]:null;if(d){let u=typeof d=="string"&&d.startsWith("data:")?d:`data:image/png;base64,${String(d)}`;return sn({dataUrl:u,alt:e.slice(0,200)}),`Generated an image for "${e.slice(0,60)}" on the user's own GPU (their local image backend). It is displayed to the user; do not describe it as if you can see it, and do not try to repeat it.`}}console.warn("[bonsai-tools] local image backend answered but unusably; falling to hosted")}catch(a){console.warn("[bonsai-tools] local image backend unreachable; falling to hosted:",a)}if(!n)return"Image generation is unavailable: no API origin was provided to this session.";let r;try{r=await fetch(`${n}/api/image/generate`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:e})})}catch(a){return`Image generation is unavailable: could not reach ${n} (${a.message}).`}if(r.status===401||r.status===403)return"Image generation needs you to be signed in. Unlike everything else here, it does NOT run on your machine \u2014 the model is a 7 GB diffusion model on Aitherium hardware, so it is tied to an account rather than being anonymous. Everything else the OS does stays on your GPU.";if(r.status===503)return"Image generation is switched off fleet-wide right now (there is a kill switch, and it is on). Nothing you did \u2014 try again later.";if(r.status===429)return"Image generation hit its rate limit. It is a minute of GPU time per picture, so the allowance is small; it resets shortly.";if(!r.ok)return`Image generation is unavailable: the server answered ${r.status}.`;let o;try{o=await r.json()}catch{return"Image generation returned an unreadable response."}let i=Array.isArray(o?.images)?o.images[0]:null;if(!i)return"Image generation returned no image.";let s=typeof i=="string"&&i.startsWith("data:")?i:`data:image/png;base64,${String(i)}`;return sn({dataUrl:s,alt:e.slice(0,200)}),`Generated an image for "${e.slice(0,60)}". It is displayed to the user; do not describe it as if you can see it, and do not try to repeat it.`}async function uu(t){let e=String(t.query??t.q??"").trim(),n=Te.apiBase;if(!e)return"Error: what should I research? Pass query=<text>.";if(e.length>512)return"Error: that research question is too long (max 512 characters).";if(!n)return"Deep research is unavailable: no API origin was provided to this session.";let r=["quick","standard"].includes(String(t.depth))?String(t.depth):"standard",o;try{o=await fetch(`${n}/api/research`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:e,depth:r})})}catch(d){return`Deep research is unavailable: could not reach ${n} (${d.message}).`}if(o.status===429)return"Deep research hit its hourly limit for this browser. It is expensive to run, so the anonymous allowance is small; signing in raises it, and it resets within the hour. Try web_search for a lighter lookup.";if(o.status===401||o.status===403)return"Deep research was refused by the server (it should be open to everyone). This looks like a misconfiguration rather than something you did.";if(!o.ok)return`Deep research is unavailable: the server answered ${o.status}.`;let i;try{i=await o.json()}catch{return"Deep research is unavailable: the server returned a 200 that was not JSON."}let s=Array.isArray(i?.sources)?i.sources:[],a=String(i?.synthesis??"").trim();if(!a&&!s.length)return`Deep research for "${e}" came back with nothing \u2014 no pages worth reading.`;if(!s.length)return`Deep research for "${e}" produced a summary with NO sources attached, so none of it can be checked. Treat it as unverified and say so.`;let c=s.slice(0,5).map((d,u)=>{let l=String(d?.title||"untitled"),p=String(d?.url||""),h=String(d?.snippet||"").slice(0,240);return`[${u+1}] ${l}
    source: ${p}${h?`
    ${h}`:""}`}).join(`

`);return[a?`Summary of what the sources say:
${a}`:"Sources found:","",c,"","Cite the source URL beside any claim you take from this. These are third-party pages, not ours \u2014 if any of them describes a DIFFERENT project that happens to share a name with Aitherium, say so rather than repeating it. For anything about Aitherium or AitherOS itself, use search_aitherium instead; it is the authority."].join(`
`)}async function wi(){let[t,e]=await Promise.all([Promise.resolve().then(()=>(ci(),ui)),Promise.resolve().then(()=>(fi(),mi))]);return{local:t,graph:e}}async function cu(t){let e=String(t.fact??t.content??t.text??"").trim();if(!e)return"Error: what should I remember? Pass fact=<text>.";if(e.length>4e3)return"Error: that is too long to store as one memory (max 4000 characters). Break it into separate facts.";let n=String(t.title??"").trim()||e.slice(0,60),r;try{r=await wi()}catch(s){return`Memory is unavailable: the on-device store could not load (${s.message}).`}let o;try{o=await r.local.addKnowledge({kind:"fact",title:n,content:e})}catch(s){return`I could not save that: on-device storage refused the write (${s.message}). This is usually private browsing or blocked site storage.`}let i="";try{let s=await r.graph.ingestLocal(o);s.nodes&&(i=` Linked ${s.nodes} thing(s) and ${s.edges} connection(s) into your graph.`)}catch{i=" (Saved, but I could not connect it to anything yet.)"}return`Remembered: "${n}".${i} It is stored on this device and will still be here next time.`}async function lu(t){let e=String(t.query??t.q??t.about??"").trim(),n=Number(t.limit),r=Number.isFinite(n)&&n>=1?Math.min(Math.floor(n),8):4,o;try{o=await wi()}catch(a){return`Memory is unavailable: the on-device store could not load (${a.message}).`}let i;try{i=await o.local.listKnowledge(200)}catch(a){return`Memory is unavailable: could not read on-device storage (${a.message}).`}if(!i.length)return"Nothing has been stored in this device's memory yet. Use remember to add something.";try{let a=await o.graph.retrieveLocal(e,r);if(a.ids.length&&a.hops>0){let c=new Map(i.map(u=>[u.id,u])),d=a.ids.map(u=>c.get(u)).filter(Boolean);if(d.length)return[`From your on-device memory (${a.hops} hop(s) through the graph \u2014 these were reached by CONNECTION, not just word match):`,...d.map((u,l)=>`${l+1}. ${u.title}
   ${u.content.slice(0,400)}`)].join(`
`)}}catch{}let s=o.local.rankKnowledge(i,e,r);return s.length?["From your on-device memory (keyword match \u2014 nothing was connected to this yet):",...s.map((a,c)=>`${c+1}. ${a.title}
   ${String(a.content).slice(0,400)}`)].join(`
`):`Nothing in this device's memory matches "${e}". There are ${i.length} stored item(s), none about that.`}async function du(t){let e=String(t.query??t.q??t.topic??"").trim();if(!e)return"Error: what should I look up? Pass query=<text>.";let n=await iu();if("error"in n)return`The Wikipedia reference is unavailable: it ${n.error}. Say you could not check rather than answering from memory.`;let r=bn(e);if(!r.length)return`Error: "${e}" has no searchable words in it \u2014 try naming a concept.`;let{ranked:o,miss:i}=bi(n,r);if(i)return`The offline Wikipedia reference here covers ${n.docs.length} selected articles and none of them cover "${e}". It is not all of Wikipedia \u2014 say you do not have an article on it, and use web_search or deep_research if the question needs an answer.`;let s=[],a=new Set;for(let{i:c}of o){let d=n.passages[c];if(a.has(d.d))continue;a.add(d.d);let u=n.docs[d.d];if(s.push(`[${s.length+1}] ${u.t} (Wikipedia)
    source: ${u.u}
    ${d.x}`),s.length>=4)break}return[`${s.length} passage(s) from Wikipedia:`,"",s.join(`

`),"",`These are WIKIPEDIA passages, not Aitherium material \u2014 attribute them to Wikipedia and cite the article URL (text is ${n.license??"CC BY-SA"}). For anything about Aitherium or AitherOS itself use search_aitherium; this cannot speak for us.`].join(`
`)}function vr(){return Object.values($t).map(t=>t.definition)}async function xr(t,e){let n=$t[t];if(!n)return`Error: unknown tool "${t}"`;try{return await n.execute(e)}catch(r){return`Error executing tool: ${r.message}`}}var Te,gn,nu,_r,kr,$t,Sr=R(()=>{"use strict";nr();ei();Te={},gn=[];nu=new Set(["the","a","an","and","or","but","of","to","in","on","at","for","is","are","was","were","be","been","it","its","this","that","these","those","with","as","by","from","you","your","we","our","i","me","my","do","does","did","what","how","why","when","where","which","who","can","will","would","about"]);_r=null,kr=null;$t={get_current_time:{definition:{name:"get_current_time",description:"Get the current date and time in the user's timezone",parameters:{type:"object",properties:{}}},execute:za},evaluate_math:{definition:{name:"evaluate_math",description:"Evaluate a mathematical expression and return the result",parameters:{type:"object",properties:{expression:{type:"string",description:'A mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")'}},required:["expression"]}},execute:Ha},list_apps:{definition:{name:"list_apps",description:"List the windows/apps that can be opened here, with a short description of each. Call this before open_app if you are not sure of the id.",parameters:{type:"object",properties:{}}},execute:Ja},open_app:{definition:{name:"open_app",description:"Open one of this OS's windows for the user (for example the sprite, terminal, playground or setup window). Use list_apps to see the available ids.",parameters:{type:"object",properties:{app:{type:"string",description:'The window id to open, e.g. "sprite", "terminal", "playground".'}},required:["app"]}},execute:Za},web_search:{definition:{name:"web_search",description:"Search the live web for current information. Use this for anything you do not already know, or anything that may have changed recently. Works without an account.",parameters:{type:"object",properties:{query:{type:"string",description:"What to search the web for."}},required:["query"]}},execute:tu},search_knowledge:{definition:{name:"search_knowledge",description:"Search the visitor's own knowledge base \u2014 the facts they have taught their AitherSprite. Use this when asked what they have taught you, or what you know about a topic they have shared. Optional query filters the entries.",parameters:{type:"object",properties:{query:{type:"string",description:"Optional keyword to filter entries by. Omit to list everything."}}}},execute:eu},search_aitherium:{definition:{name:"search_aitherium",description:"Search everything Aitherium has PUBLISHED about itself \u2014 AitherOS, Aitherium, the products, the architecture, the mission, and how any of it works. Use this BEFORE answering any question about Aitherium or AitherOS, even if you think you know: it returns passages with the page they came from, so your answer can be checked. Prefer it over web_search for anything about us.",parameters:{type:"object",properties:{query:{type:"string",description:'What to look up, e.g. "how does AitherGraph work" or "why local AI".'}},required:["query"]}},execute:su},search_wikipedia:{definition:{name:"search_wikipedia",description:'Look up general world knowledge \u2014 science, computing, history, concepts \u2014 in an offline Wikipedia reference that works with no network. Use it for "what is X" questions about things that are NOT Aitherium. For anything about Aitherium or AitherOS use search_aitherium instead; Wikipedia cannot speak for us.',parameters:{type:"object",properties:{query:{type:"string",description:"The concept or topic to look up."}},required:["query"]}},execute:du},deep_research:{definition:{name:"deep_research",description:"Research a topic properly: searches the web, reads the pages, and returns a summary WITH its sources. Slower than web_search \u2014 use it when a question deserves a real answer rather than a list of links. Do NOT use it for questions about Aitherium or AitherOS; use search_aitherium for those, because the web has several unrelated projects with similar names.",parameters:{type:"object",properties:{query:{type:"string",description:"The question to research."},depth:{type:"string",description:'"quick" (fast, snippets) or "standard" (reads pages). Defaults to standard.'}},required:["query"]}},execute:uu},generate_image:{definition:{name:"generate_image",description:"Draw a picture from a description. UNLIKE everything else here this does NOT run on this machine \u2014 it runs on Aitherium hardware and needs the visitor to be signed in, so only use it when they actually asked for an image. It takes about a minute. The picture is shown to them directly; do not describe it as if you can see it.",parameters:{type:"object",properties:{prompt:{type:"string",description:"What the picture should show."}},required:["prompt"]}},execute:au},remember:{definition:{name:"remember",description:"Store something durably on this device so you still know it in later conversations. Use it whenever the person tells you something about themselves, their preferences, their work, or anything they say to keep. It is saved locally and connected into their knowledge graph.",parameters:{type:"object",properties:{fact:{type:"string",description:"The thing to remember, in a full sentence."},title:{type:"string",description:"Optional short label for it."}},required:["fact"]}},execute:cu},recall:{definition:{name:"recall",description:"Look through everything stored on this device before answering anything personal or anything you were told earlier. It walks their knowledge graph, so it finds things CONNECTED to the question, not only exact word matches. Use it rather than guessing what you were told.",parameters:{type:"object",properties:{query:{type:"string",description:"What to look for."},limit:{type:"number",description:"How many items to return (1-8, default 4)."}},required:["query"]}},execute:lu},get_page_context:{definition:{name:"get_page_context",description:"Get information about the current page and browser environment",parameters:{type:"object",properties:{}}},execute:Va},...Zo}});function pu(t){let e="</tool_call>",n="",r=t;for(;;){let o=r.indexOf(e);if(o<0)return n+r;let i=r.slice(0,o),s=r.slice(o+e.length);if(i.includes("<tool_call>")){n+=r.slice(0,o+e.length),r=s;continue}let a=i.indexOf("{");if(a<0){n+=r.slice(0,o+e.length),r=s;continue}n+=`${i.slice(0,a)}<tool_call>${i.slice(a)}${e}`,r=s}}function _i(t){return String(t).trim().replace(/\s+/g,"")}function vi(t){let e=[];t=pu(t);let n=t,r=/<tool_call>([\s\S]*?)<\/tool_call>/g,o,i=[];for(;(o=r.exec(t))!==null;)i.push({full:o[0],content:o[1],index:o.index});if(i.length===0)return{toolCalls:[],remainingText:t};for(let s of i){let a=hu(s.content.trim());a&&e.push(a)}n=t;for(let s of i.reverse())n=n.slice(0,s.index)+n.slice(s.index+s.full.length);return n=n.trim(),{toolCalls:e,remainingText:n}}function hu(t){let e=t.trim();try{let r=JSON.parse(e);if(r.name&&r.arguments!==void 0)return{name:_i(r.name),arguments:typeof r.arguments=="string"?ki(r.arguments)||{}:r.arguments||{}}}catch{}let n=mu(e);try{let r=JSON.parse(n);if(r.name&&r.arguments!==void 0)return{name:_i(r.name),arguments:typeof r.arguments=="string"?ki(r.arguments)||{}:r.arguments||{}}}catch(r){return console.warn("[tool-parser] failed to parse tool call:",t,r),null}return null}function mu(t){let e=t;e=e.replace(/'([^']*)'/g,'"$1"'),e=e.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,'$1"$2":'),e=e.replace(/,(\s*[}\]])/g,"$1");let n=(e.match(/{/g)||[]).length,r=(e.match(/}/g)||[]).length;n>r&&(e+="}".repeat(n-r));let o=(e.match(/\[/g)||[]).length,i=(e.match(/\]/g)||[]).length;return o>i&&(e+="]".repeat(o-i)),e}function ki(t){try{return JSON.parse(t)}catch{return null}}var xi=R(()=>{"use strict"});var Si={};oe(Si,{extendMessagesWithToolResults:()=>gu,getAvailableTools:()=>bu,hasAvailableTools:()=>wu,orchestrateToolCalls:()=>fu});async function fu(t,e,n=1/0){let r=[],{toolCalls:o,remainingText:i}=vi(t);for(let s of o.slice(0,n)){let a=s.name,c={type:"tool_call",toolName:a,arguments:s.arguments};r.push(c),e?.(c);let d=await xr(a,s.arguments),u={type:"tool_result",toolName:a,result:d};r.push(u),e?.(u)}return{finalText:i,toolCalls:r}}function gu(t,e){if(e.length===0)return t;let n=[...t],r=[],o=0;for(;o<e.length;){let s=e[o];s.type==="tool_call"&&s.toolName&&r.push({name:s.toolName,arguments:s.arguments||{}}),o++}let i=e.filter(s=>s.type==="tool_result").map(s=>`Tool ${s.toolName}: ${s.result}`).join(`

`);return i&&n.push({role:"tool",content:i}),n}function bu(){return vr()}function wu(){return Object.keys($t).length>0}var Li=R(()=>{"use strict";xi();Sr()});function qi(t){return t===408||t===429||t>=500}var Dr=t=>new Promise(e=>setTimeout(e,t));function Sn(t){return async(e,n)=>{let r=((n-e+1)/1048576).toFixed(1),o="";for(let i=1;i<=3;i++){let s;try{s=await fetch(t,{headers:{Range:`bytes=${e}-${n}`},cache:"force-cache"})}catch(a){if(o=a instanceof Error?a.message:String(a),i<3){await Dr(250*2**(i-1));continue}let c=typeof navigator<"u"&&navigator.onLine===!1;throw new Error(`bonsai-gguf: fetch failed for ${r} MB range ${e}-${n} of ${t} after 3 attempts${c?" (browser reports OFFLINE)":""}. If the screen also flickered, the GPU driver reset and took this request with it \u2014 that is a GPU fault, not a network one. Last error: ${o}`)}if(s.status!==206&&s.status!==200){if(o=`HTTP ${s.status}`,qi(s.status)&&i<3){await Dr(250*2**(i-1));continue}throw new Error(`bonsai-gguf: range GET ${e}-${n} (${r} MB) of ${t} returned ${s.status}`)}try{return new Uint8Array(await s.arrayBuffer())}catch(a){throw new Error(`bonsai-gguf: reading ${r} MB range body failed (device out of memory?): ${a instanceof Error?a.message:String(a)}`)}}throw new Error(`bonsai-gguf: range ${e}-${n} exhausted retries: ${o}`)}}function qr(t){let e=t.filter(Boolean);if(e.length===0)throw new Error("bonsai-gguf: mirroredRangeFetcher needs at least one URL");if(e.length===1)return Sn(e[0]);let n=e.map(r=>Sn(r));return async(r,o)=>{let i=[];for(let s=0;s<n.length;s++)try{return await n[s](r,o)}catch(a){i.push(`${e[s]}: ${a instanceof Error?a.message:String(a)}`),s+1<n.length&&console.warn(`[bonsai-gguf] mirror ${s+1}/${n.length} failed, trying next`)}throw new Error(`bonsai-gguf: all ${n.length} mirrors failed for range ${r}-${o}:
`+i.map((s,a)=>`  [${a+1}] ${s}`).join(`
`))}}var qt=class{constructor(e){this.filled=0;this.cursor=0;this.url=e.url,this.fetchRange=e.fetchRange??Sn(e.url),this.contentLength=e.contentLength,this.initialWindow=e.initialWindow??1<<20,this.buf=new Uint8Array(0)}get position(){return this.cursor}async ensure(e){if(e<=this.filled)return;let n=Math.max(e,this.filled+this.initialWindow);this.contentLength!==void 0&&(n=Math.min(n,this.contentLength));let r=await this.fetchRange(this.filled,n-1),o=new Uint8Array(this.filled+r.length);if(o.set(this.buf.subarray(0,this.filled),0),o.set(r,this.filled),this.buf=o,this.filled+=r.length,this.filled<e)throw new Error(`bonsai-gguf: underfilled window (have ${this.filled}, need ${e}) \u2014 server may not support ranges`)}async view(e){return await this.ensure(this.cursor+e),new DataView(this.buf.buffer,this.buf.byteOffset+this.cursor,e)}async u8(){let e=(await this.view(1)).getUint8(0);return this.cursor+=1,e}async u32(){let e=(await this.view(4)).getUint32(0,!0);return this.cursor+=4,e}async i32(){let e=(await this.view(4)).getInt32(0,!0);return this.cursor+=4,e}async f32(){let e=(await this.view(4)).getFloat32(0,!0);return this.cursor+=4,e}async f64(){let e=(await this.view(8)).getFloat64(0,!0);return this.cursor+=8,e}async u16(){let e=(await this.view(2)).getUint16(0,!0);return this.cursor+=2,e}async i16(){let e=(await this.view(2)).getInt16(0,!0);return this.cursor+=2,e}async i8(){let e=(await this.view(1)).getInt8(0);return this.cursor+=1,e}async u64(){let e=await this.view(8),n=e.getUint32(0,!0),r=e.getUint32(4,!0);this.cursor+=8;let o=r*4294967296+n;if(!Number.isSafeInteger(o))throw new Error(`bonsai-gguf: u64 ${o} exceeds MAX_SAFE_INTEGER`);return o}async i64(){return this.u64()}async string(){let e=await this.u64();await this.ensure(this.cursor+e);let n=this.buf.subarray(this.cursor,this.cursor+e);return this.cursor+=e,new TextDecoder("utf-8").decode(n)}seek(e){this.cursor=e}async bytes(e,n){return await this.ensure(e+n),this.buf.slice(e,e+n)}};var Mi="bonsai-weights",gt="ranges";function Ui(){return new Promise((t,e)=>{let n=indexedDB.open(Mi,1);n.onupgradeneeded=()=>{let r=n.result;r.objectStoreNames.contains(gt)||r.createObjectStore(gt)},n.onsuccess=()=>t(n.result),n.onerror=()=>e(n.error)})}function Ki(t,e){return new Promise((n,r)=>{let i=t.transaction(gt,"readonly").objectStore(gt).get(e);i.onsuccess=()=>{let s=i.result;n(s===void 0?void 0:s instanceof Uint8Array?s:new Uint8Array(s))},i.onerror=()=>r(i.error)})}function Fi(t,e,n){return new Promise((r,o)=>{let i=t.transaction(gt,"readwrite"),s=n.slice();i.objectStore(gt).put(s.buffer,e),i.oncomplete=()=>r(),i.onerror=()=>o(i.error),i.onabort=()=>o(i.error)})}function Mr(t,e,n){let r=null,o=()=>{if(!r){try{navigator.storage?.persist?.()}catch{}r=Ui().catch(()=>null)}return r};return async(i,s)=>{let a=`${t}#${i}-${s}`,c=await o();if(c)try{let u=await Ki(c,a);if(u)return n?.({bytes:u.byteLength,fromCache:!0}),u}catch{}let d=await e(i,s);return n?.({bytes:d.byteLength,fromCache:!1}),c&&Fi(c,a,d).catch(()=>{}),d}}bt();var ji=1179993927;function jr(t,e){return t+(e-t%e)%e}async function Wr(t,e){switch(e){case 0:return t.u8();case 1:return t.i8();case 2:return t.u16();case 3:return t.i16();case 4:return t.u32();case 5:return t.i32();case 6:return t.f32();case 7:return await t.u8()!==0;case 8:return t.string();case 10:return t.u64();case 11:return t.i64();case 12:return t.f64();default:throw new Error(`bonsai-gguf: cannot read scalar of value-type ${e}`)}}async function Qi(t,e){if(e===9){let n=await t.u32(),r=await t.u64();if(n===9)throw new Error("bonsai-gguf: nested arrays are not permitted by the spec");let o=new Array(r);for(let i=0;i<r;i++)o[i]=await Wr(t,n);return o}return Wr(t,e)}async function Qr(t){let e=await t.u32();if(e!==ji)throw new Error(`bonsai-gguf: bad magic 0x${e.toString(16)} (expected 0x46554747)`);let n=await t.u32();if(n!==3)throw new Error(`bonsai-gguf: unsupported GGUF version ${n} (need 3)`);let r=await t.u64(),o=await t.u64(),i={version:n,tensorCount:r,metadataKvCount:o},s=new Map;for(let u=0;u<o;u++){let l=await t.string(),p=await t.u32(),h=await Qi(t,p);s.set(l,h)}let a=Hi(s,"general.alignment",32),c=[];for(let u=0;u<r;u++){let l=await t.string(),p=await t.u32(),h=new Array(p);for(let v=0;v<p;v++)h[v]=await t.u64();let m=await t.u32(),b=await t.u64(),f=h.reduce((v,y)=>v*y,1);Tt(m);let g=Fr(m,f);c.push({name:l,dims:h,type:m,relOffset:b,nElements:f,nBytes:g})}let d=jr(t.position,a);return zi(c,a),{header:i,kv:s,tensors:c,tensorDataBase:d,alignment:a}}function zi(t,e){if(t.length<2)return;let n=[...t].sort((r,o)=>r.relOffset-o.relOffset);for(let r=0;r<n.length-1;r++){let o=n[r],i=n[r+1].relOffset-o.relOffset,s=jr(o.nBytes,e);if(i===s)continue;let a=Tt(o.type),c=o.nBytes>0?i/o.nBytes:0;throw new Error(`bonsai-gguf: tensor '${o.name}' (type ${o.type} = ${a.name}) occupies ${i} bytes in the file but this build computes ${o.nBytes} (aligned ${s}) from ${a.blockSize} weights/${a.typeSize} bytes per block \u2014 a factor of ${c.toFixed(4)}. The declared type id does not match the file's actual block geometry, so every read of this tensor would be at the wrong stride and would produce plausible-looking WRONG values rather than an error. If this is a '*_g64' ternary file, it uses group 64 under the same type id 42 and is NOT loadable by this runtime \u2014 use the group-128 '*-Q2_0.gguf' build.`)}}function Hi(t,e,n){let r=t.get(e);return typeof r=="number"?r:typeof r=="bigint"?Number(r):n}var Mt=class{constructor(e){this.kv=e}raw(e){return this.kv.get(e)}str(e,n){let r=this.kv.get(e);if(typeof r=="string")return r;if(n!==void 0)return n;throw new Error(`bonsai-gguf: missing string key '${e}'`)}num(e,n){let r=this.kv.get(e);if(typeof r=="number")return r;if(typeof r=="bigint")return Number(r);if(n!==void 0)return n;throw new Error(`bonsai-gguf: missing numeric key '${e}'`)}numOpt(e){let n=this.kv.get(e);if(typeof n=="number")return n;if(typeof n=="bigint")return Number(n)}strArray(e){let n=this.kv.get(e);if(Array.isArray(n))return n;throw new Error(`bonsai-gguf: missing string-array key '${e}'`)}numArray(e){let n=this.kv.get(e);if(Array.isArray(n))return n.map(Number);throw new Error(`bonsai-gguf: missing numeric-array key '${e}'`)}get arch(){let e=this.str("general.architecture");return e==="dspark"?"qwen35":e}a(e){return`${this.arch}.${e}`}resolveArchConfig(){return{arch:this.arch,contextLength:this.num(this.a("context_length")),embeddingLength:this.num(this.a("embedding_length")),blockCount:this.num(this.a("block_count")),feedForwardLength:this.num(this.a("feed_forward_length")),headCount:this.num(this.a("attention.head_count")),headCountKv:this.num(this.a("attention.head_count_kv")),keyLength:this.numOpt(this.a("attention.key_length")),valueLength:this.numOpt(this.a("attention.value_length")),rmsEps:this.num(this.a("attention.layer_norm_rms_epsilon"),1e-6),ropeDimensionCount:this.numOpt(this.a("rope.dimension_count")),ropeDimensionSections:(()=>{let n=this.kv.get(this.a("rope.dimension_sections"));return Array.isArray(n)?n.map(Number):[]})(),ropeFreqBase:this.numOpt(this.a("rope.freq_base"))??1e4,ropeScalingType:(()=>{let n=this.kv.get(this.a("rope.scaling.type"));return typeof n=="string"?n:"none"})(),ropeScalingFactor:this.numOpt(this.a("rope.scaling.factor")),ssmConvKernel:this.numOpt(this.a("ssm.conv_kernel")),ssmInnerSize:this.numOpt(this.a("ssm.inner_size")),ssmStateSize:this.numOpt(this.a("ssm.state_size")),ssmGroupCount:this.numOpt(this.a("ssm.group_count")),ssmTimeStepRank:this.numOpt(this.a("ssm.time_step_rank")),fullAttentionInterval:this.numOpt(this.a("full_attention_interval"))}}resolveTokenizer(){return{model:this.str("tokenizer.ggml.model","gpt2"),tokens:this.strArray("tokenizer.ggml.tokens"),merges:(()=>{let e=this.kv.get("tokenizer.ggml.merges");return Array.isArray(e)?e:[]})(),tokenType:(()=>{let e=this.kv.get("tokenizer.ggml.token_type");return Array.isArray(e)?e.map(Number):[]})(),bosTokenId:this.numOpt("tokenizer.ggml.bos_token_id"),eosTokenId:this.numOpt("tokenizer.ggml.eos_token_id")}}};var Ut=class{constructor(e){this.byName=new Map;this.ordered=[];this.tensorDataBase=e.tensorDataBase;for(let n of e.tensors){let r=this.toEntry(n,e.tensorDataBase);this.byName.set(r.name,r),this.ordered.push(r)}this.ordered.sort((n,r)=>n.absStart-r.absStart)}toEntry(e,n){let r=n+e.relOffset;return{name:e.name,type:e.type,dims:e.dims,absStart:r,nBytes:e.nBytes,absEnd:r+e.nBytes}}get(e){let n=this.byName.get(e);if(!n)throw new Error(`bonsai-tensors: no tensor named '${e}'`);return n}has(e){return this.byName.has(e)}withPrefix(e){return this.ordered.filter(n=>n.name.startsWith(e))}coalesce(e,n=1<<20,r=64<<20){let o=[...e].sort((s,a)=>s.absStart-a.absStart),i=[];for(let s of o){let a=i[i.length-1];a&&s.absStart-a.absEnd<=n&&s.absEnd-a.absStart<=r?(a.absEnd=Math.max(a.absEnd,s.absEnd),a.nBytes=a.absEnd-a.absStart,a.members.push(s)):i.push({absStart:s.absStart,absEnd:s.absEnd,nBytes:s.nBytes,members:[s]})}return i}coalesceBlock(e){return this.coalesce(this.withPrefix(`blk.${e}.`))}};function Yi(t){let e=t.ssmTimeStepRank??0,n=t.ssmGroupCount??0,r=t.ssmStateSize??0,o=t.ssmInnerSize??e*r,i=n*r,s=n*r,a=i+s+o,c=t.ssmConvKernel??0;if(e<=0||n<=0||r<=0||c<=0)throw new Error(`bonsai-config: '${t.arch}' has no DeltaNet layers \u2014 this in-browser runtime only runs the qwen35 hybrid (Bonsai-27B). Dense sizes run on a local node or the hosted lane instead. (numVHeads=${e}, numKHeads=${n}, headDim=${r}, convKernel=${c})`);if(e%n!==0)throw new Error(`bonsai-config: numVHeads ${e} not divisible by numKHeads ${n}`);if(o!==e*r)throw new Error(`bonsai-config: ssm.inner_size ${o} != numVHeads*headDim ${e*r}`);return{numVHeads:e,numKHeads:n,headDim:r,qDim:i,kDim:s,vDim:o,convDim:a,convKernel:c,vPerKHead:e/n}}function Xi(t,e){let n=e.blockCount,r=e.keyLength&&e.keyLength>0?e.keyLength:e.embeddingLength/e.headCount,o=e.headCount*r,i=o*2,s=[];for(let a=0;a<n;a++){let c=`blk.${a}.`;if(t.ordered.some(m=>m.name.startsWith(c)&&m.name.includes("ssm"))){s.push("linear-attn");continue}if(!(t.has(`${c}attn_k.weight`)||t.has(`${c}attn_v.weight`)||t.ordered.some(m=>m.name.startsWith(c)&&/attn_(k|v)\b/.test(m.name))))throw new Error(`bonsai-config: block ${a} has neither ssm_* nor attn_k/v tensors \u2014 cannot classify layer`);let l=`${c}attn_q.weight`;if(!t.has(l))throw new Error(`bonsai-config: block ${a} has attn_k/v but no '${l}' \u2014 cannot determine whether its attention is gated (qwen35) or plain (qwen3)`);let p=t.get(l).dims,h=p.length>=2?p[p.length-1]:p[0];if(h===i)s.push("full-attn");else if(h===o)s.push("dense-attn");else throw new Error(`bonsai-config: block ${a} '${l}' has output width ${h}, which matches neither plain attention (nHeads*headDim = ${o}) nor gated attention (2*nHeads*headDim = ${i}). headCount=${e.headCount}, headDim=${r} (key_length=${e.keyLength??"absent"}, embedding_length=${e.embeddingLength}). Refusing to guess \u2014 the wrong choice produces fluent garbage, not an error.`)}return s}function Vi(t,e){let n=[];for(let r=0;r<e;r++){let o=`blk.${r}.post_attention_norm.weight`,i=`blk.${r}.ffn_norm.weight`;if(t.has(o))n.push(o);else if(t.has(i))n.push(i);else throw new Error(`bonsai-config: block ${r} has neither '${o}' nor '${i}' \u2014 cannot locate the pre-FFN norm`)}return n}var at=256;function Ji(t){let e=t.keyLength&&t.keyLength>0?t.keyLength:t.embeddingLength/t.headCount,n;return t.ssmInnerSize!==void 0&&t.headCount>0&&t.ssmInnerSize%t.headCount===0&&(n=t.ssmInnerSize/t.headCount),{headDim:e,deltaNetDv:n}}function zr(t){let{headDim:e,deltaNetDv:n}=Ji(t);if(!Number.isInteger(e)||e<=0)throw new Error(`bonsai-config: head_dim (embedding_length ${t.embeddingLength} / head_count ${t.headCount}) = ${e} is not a positive integer \u2014 cannot size attention kernels`);if(e>at)throw new Error(`bonsai-config: head_dim ${e} exceeds the WGSL fixed array bound ${at} (softmax_attn.wgsl acc[${at}]) \u2014 refusing to load; the kernel would read out of bounds on the GPU`);if(n!==void 0&&n>at)throw new Error(`bonsai-config: DeltaNet d_v ${n} (ssm.inner_size ${t.ssmInnerSize} / head_count ${t.headCount}) exceeds the WGSL fixed array bound ${at} (deltanet.wgsl err/o[${at}]) \u2014 refusing to load`);let r=n!==void 0?`, DeltaNet d_v=${n}`:"";return{message:`head_dim=${e}${r} (<= ${at})`}}function Hr(t,e){let n=Xi(e,t),r=[],o=[];n.forEach((a,c)=>(a==="linear-attn"?o:r).push(c));let i=o.length>0?Yi(t):void 0,s=Vi(e,t.blockCount);return{...t,layerKinds:n,fullAttnLayers:r,linearAttnLayers:o,deltaNet:i,ffnNormNames:s}}function Yr(t){let e=t.fullAttnLayers.length+t.linearAttnLayers.length;if(e!==t.blockCount)return{ok:!1,message:`layer kinds (${e}) != blockCount (${t.blockCount})`};if(t.linearAttnLayers.length===0){let n=t.layerKinds.filter(r=>r==="dense-attn").length;return{ok:!0,message:`dense: ${n} plain-attn / ${t.blockCount-n} gated-attn, no DeltaNet`}}return t.blockCount===64&&t.fullAttnLayers.length!==16&&console.warn(`bonsai-config: Bonsai-27B expected 16 full-attn layers (64 blocks), got ${t.fullAttnLayers.length}. This may be a model variant; loading anyway.`),{ok:!0,message:`${t.fullAttnLayers.length} full-attn / ${t.linearAttnLayers.length} linear-attn`}}function Zi(){let t=[];for(let o=33;o<=126;o++)t.push(o);for(let o=161;o<=172;o++)t.push(o);for(let o=174;o<=255;o++)t.push(o);let e=[...t],n=0;for(let o=0;o<256;o++)t.includes(o)||(t.push(o),e.push(256+n),n++);let r=new Map;for(let o=0;o<t.length;o++)r.set(t[o],String.fromCodePoint(e[o]));return r}var es=3,ts=4;function Zr(t,e,n=[]){let r=new Map;t.forEach((u,l)=>r.set(u,l));let o=new Map;e.forEach((u,l)=>o.set(u,l));let i=Zi(),s=new Map;i.forEach((u,l)=>s.set(u,l));let a=[],c=n.length===t.length;t.forEach((u,l)=>{(c?n[l]===es||n[l]===ts:u.length>=5&&u.startsWith("<|")&&u.endsWith("|>"))&&a.push([u,l])}),a.sort((u,l)=>l[0].length-u[0].length);let d=new Map(a);return{vocab:r,idToToken:t,mergeRank:o,byteEncoder:i,byteDecoder:s,specialTokens:d}}function ns(t,e){if(t.length<2)return t;let n=t;for(;;){let r=1/0,o=-1;for(let i=0;i<n.length-1;i++){let s=e.get(`${n[i]} ${n[i+1]}`);s!==void 0&&s<r&&(r=s,o=i)}if(o===-1)break;n=[...n.slice(0,o),n[o]+n[o+1],...n.slice(o+2)]}return n}var Xr=/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,Vr=new WeakMap;function rs(t){let e=Vr.get(t);if(e===void 0){if(t.specialTokens.size===0)e=null;else{let n=[...t.specialTokens.keys()].map(r=>r.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");e=new RegExp(n,"g")}Vr.set(t,e)}return e}function Jr(t,e,n){let r=t;for(;r.length>0;){Xr.lastIndex=0;let o=Xr.exec(r);if(!o)break;let i=o[0],a=new TextEncoder().encode(i),c=Array.from(a,u=>e.byteEncoder.get(u)),d=ns(c,e.mergeRank);for(let u of d){let l=e.vocab.get(u);if(l!==void 0)n.push(l);else for(let p of u){let h=e.vocab.get(p);h!==void 0&&n.push(h)}}r=r.slice(i.length)}}function eo(t,e){let n=[],r=rs(e),o=0;if(r){r.lastIndex=0;let i;for(;(i=r.exec(t))!==null;)i.index>o&&Jr(t.slice(o,i.index),e,n),n.push(e.specialTokens.get(i[0])),o=i.index+i[0].length}return o<t.length&&Jr(t.slice(o),e,n),n}function to(t,e){let n="";for(let o of t){let i=e.idToToken[o];i!==void 0&&(n+=i)}let r=[];for(let o of n){let i=e.byteDecoder.get(o);i!==void 0&&r.push(i)}return new TextDecoder("utf-8",{fatal:!1}).decode(new Uint8Array(r))}function no(t,e=!0,n){let r="";if(n&&n.length>0){r+=`<|im_start|>system
`,t[0]?.role==="system"&&(r+=t[0].content+`

`),r+=`# Tools

You may call one or more functions to assist with the user query.

`,r+=`You are provided with function signatures within <tools></tools> XML tags:
`,r+="<tools>";for(let i of n)r+=`
`+JSON.stringify(i);r+=`
</tools>

`,r+=`For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
`,r+=`<tool_call>
`,r+=`{"name": <function-name>, "arguments": <args-json-object>}
`,r+="</tool_call>",r+=`<|im_end|>
`}else t[0]?.role==="system"&&(r+=`<|im_start|>system
${t[0].content}<|im_end|>
`);let o=n&&n.length>0&&t[0]?.role==="system"||!n&&t[0]?.role==="system"?1:0;for(let i=o;i<t.length;i++){let s=t[i];if(s.role==="user")r+=`<|im_start|>user
${s.content}<|im_end|>
`;else if(s.role==="assistant"){let a=s.content,c=s.reasoning_content||"";if(c?r+=`<|im_start|>assistant
<think>
${c.trim()}
</think>

`:r+=`<|im_start|>assistant
`,a&&(r+=a),s.tool_calls&&s.tool_calls.length>0)for(let d of s.tool_calls){a&&(r+=`
`);let u=d.function||d;r+=`<tool_call>
`,r+=JSON.stringify({name:u.name,arguments:typeof u.arguments=="string"?JSON.parse(u.arguments):u.arguments}),r+=`
</tool_call>`}r+=`<|im_end|>
`}else s.role==="tool"&&(r+=`<|im_start|>user
<tool_response>
${s.content}
</tool_response><|im_end|>
`)}return e&&(r+=`<|im_start|>assistant
<think>

</think>

`),r}var Kt=class{constructor(e){this.tables=Zr(e.tokens,e.merges,e.tokenType),this.bosTokenId=e.bosTokenId,this.eosTokenId=e.eosTokenId,this.thinkStartId=this.tables.specialTokens.get("<think>"),this.thinkEndId=this.tables.specialTokens.get("</think>");let n=new Set;e.eosTokenId!==void 0&&n.add(e.eosTokenId);for(let r of["<|im_end|>","<|endoftext|>"]){let o=this.tables.specialTokens.get(r);o!==void 0&&n.add(o)}this.stopIds=n}get vocabSize(){return this.tables.idToToken.length}encode(e){return eo(e,this.tables)}decode(e){return to(e,this.tables)}encodeChat(e,n){return this.encode(no(e,!0,n))}isStop(e){return this.stopIds.has(e)}isEos(e){return this.eosTokenId!==void 0&&e===this.eosTokenId}};bt();wt();var os=134217728;function is(t,e){return e>t.limits.maxStorageBufferBindingSize}async function An(t,e,n){let r=await e(n.absStart,n.absEnd-1),o=[];for(let i of n.members){let s=i.absStart-n.absStart,a=r.subarray(s,s+i.nBytes);if(is(t,i.nBytes)){let u=t.limits.maxStorageBufferBindingSize,l=u===os?" \u2014 this is the WebGPU DEFAULT limit, so the device was almost certainly created without requiredLimits; mirror adapter.limits in requestDevice()":" \u2014 this adapter genuinely caps here; a chunked upload path is required";throw new Error(`bonsai-upload: tensor '${i.name}' (${i.nBytes} B) exceeds maxStorageBufferBindingSize (${u})${l}`)}let c=i.type===ss?us(a):i.type===as?cs(a):ls(a),d=t.createBuffer({size:c.byteLength,usage:C.STORAGE|C.COPY_DST|C.COPY_SRC,label:i.name});t.queue.writeBuffer(d,0,c),o.push({entry:i,buffer:d})}return o}var ss=41,as=42,Ft=18,oo=20,Wt=34,io=36;function us(t){let e=Math.floor(t.length/Ft),n=new Uint8Array(e*oo);for(let r=0;r<e;r++)n.set(t.subarray(r*Ft,r*Ft+Ft),r*oo);return n}function cs(t){let e=Math.floor(t.length/Wt),n=new Uint8Array(e*io);for(let r=0;r<e;r++)n.set(t.subarray(r*Wt,r*Wt+Wt),r*io);return n}function ls(t){let e=ds(t.length,4);if(e===t.length)return t;let n=new Uint8Array(e);return n.set(t),n}function ds(t,e){return t+(e-t%e)%e}var jt=class{constructor(e,n,r){this.device=e;this.registry=n;this.fetchRange=r;this.buffers=new Map;this.loadedLayers=new Set;this.inflight=new Map}has(e){return this.buffers.has(e)}get(e){let n=this.buffers.get(e);if(!n)throw new Error(`bonsai-weights: '${e}' not resident (load its layer first)`);return n}typeOf(e){return this.registry.get(e).type}weightQuantType(){if(this.blockQuantType!==void 0)return this.blockQuantType;let e=o=>o===0||o===1,n=this.registry.ordered.filter(o=>o.name.startsWith("blk.")&&!e(o.type));if(n.length===0)throw new Error("bonsai-weights: no quantized 'blk.*' weight tensors in the registry \u2014 cannot determine the model's weight quant type");let r=new Map;for(let o of n)r.has(o.type)||r.set(o.type,o.name);for(let[o,i]of r)if(o!==41&&o!==42)throw new Error(`bonsai-weights: block tensor '${i}' has unsupported quant type ${o} (supported: Q1_0=41, Q2_0=42)`);if(r.size>1){let o=[...r].map(([i,s])=>`${i} (e.g. '${s}')`).join(", ");throw new Error(`bonsai-weights: decoder blocks mix quant types \u2014 ${o}. The block projections dispatch once per context, so a mixed file would silently run some layers through the wrong kernel and emit fluent garbage. Use projectQuantized per tensor to support this.`)}return this.blockQuantType=n[0].type,this.blockQuantType}register(e){for(let n of e)this.buffers.set(n.entry.name,n.buffer)}async loadGlobals(e){let n=e.filter(r=>this.registry.has(r)).map(r=>this.registry.get(r));for(let r of this.registry.coalesce(n))this.register(await An(this.device,this.fetchRange,r))}ensureLayer(e){if(this.loadedLayers.has(e))return Promise.resolve();let n=this.inflight.get(e);if(n)return n;let r=this.loadLayer(e).finally(()=>this.inflight.delete(e));return this.inflight.set(e,r),r}async loadLayer(e){for(let n of this.registry.coalesceBlock(e))this.register(await An(this.device,this.fetchRange,n));this.loadedLayers.add(e)}prefetchLayer(e){e<0||this.loadedLayers.has(e)||this.registry.coalesceBlock(e).length!==0&&this.ensureLayer(e).catch(()=>{})}get residentLayerCount(){return this.loadedLayers.size}evictLayer(e,n){this.inflight.delete(e);for(let r of n){let o=this.buffers.get(r);o&&(o.destroy(),this.buffers.delete(r))}this.loadedLayers.delete(e)}};var ps=["quantize_q8_0","q1_0_dequant","q1_0_q8_0_matmul","q2_0_dequant","q2_0_q8_0_matmul","kv_quant_4bit","rmsnorm","rope_imrope","softmax_attn","softmax_attn_batched","causal_conv1d","deltanet","deltanet_gate","deltanet_seq","swiglu","sampling","logit_topk","vae_ops","elementwise","elementwise_inplace"],Qt=class{constructor(e,n){this.device=e;this.sources=n;this.cache=new Map}get(e,n="main"){let r=n==="main"?e:`${e}:${n}`,o=this.cache.get(r);if(o)return o;let i=this.sources[e];if(!i)throw new Error(`bonsai-pipelines: no WGSL source registered for '${e}'`);let s=this.device.createShaderModule({code:i,label:e}),a=this.device.createComputePipeline({label:r,layout:"auto",compute:{module:s,entryPoint:n}});return this.cache.set(r,a),a}warmAll(){for(let e of ps)if(this.sources[e]){if(e==="logit_topk"){this.get(e,"hist_main"),this.get(e,"gather_main");continue}if(e==="vae_ops"){this.get(e,"conv2d_main"),this.get(e,"groupnorm_main"),this.get(e,"upsample_nearest_main");continue}this.get(e)}}};var Tn=class{constructor(e){this.deps=e}async load(e){let n=e.mirrorUrls?.length?e.mirrorUrls:[e.modelUrl],r=this.deps.fetchRange??qr(n),o=this.deps.fetchRange?r:Mr(e.modelUrl,r),i=e.onProgress??(()=>{});i({phase:"parse",percent:2,detail:"range-fetching header + KV"});let s=new qt({url:e.modelUrl,fetchRange:o}),a=await Qr(s),c=new Mt(a.kv);i({phase:"config",percent:30,detail:`arch=${c.arch}`});let d=new Ut(a),u=c.resolveArchConfig(),l=Hr(u,d),p=Yr(l),h=zr(l);console.log(`bonsai: kernel dims OK \u2014 ${h.message}`),i({phase:"tokenizer",percent:45,detail:"building BPE tables"});let m=new Kt(c.resolveTokenizer());i({phase:"pipelines",percent:60,detail:"compiling WGSL"});let b=new Qt(this.deps.device,this.deps.kernelSources);b.warmAll(),i({phase:"globals",percent:75,detail:"uploading embeddings + LM head + norms"});let f=new jt(this.deps.device,d,o),g=["token_embd.weight","output_norm.weight"];await f.loadGlobals(g);for(let k of g)if(!f.has(k))throw new Error(`bonsai-runtime: required tensor '${k}' was not found in the GGUF file. The model file may be corrupted or incomplete \u2014 try clearing your browser cache and reloading, or switch to a different model size.`);let v=["output.weight"];try{await f.loadGlobals(v)}catch(k){console.warn(`bonsai-runtime: optional globals not loaded: ${k.message}`)}i({phase:"ready",percent:100});let y={device:this.deps.device,parsed:a,meta:c,registry:d,config:l,tokenizer:m,pipelines:b,weights:f,scheduleOk:p.ok,scheduleMessage:p.message};return this.model=y,y}get loaded(){return this.model}};function ao(t){return new Tn(t)}var yt="<tool_call>",zt="</tool_call>";function uo(t,e){if(!e)return t;let n="",r=0;for(;;){let a=t.indexOf(zt,r);if(a===-1)break;let c=co(t,r,a);n+=t.slice(r,c),r=a+zt.length}let o=t.slice(r),i=o.indexOf(yt);if(i!==-1)return n+o.slice(0,i);let s=o.indexOf("{");return s!==-1?n+o.slice(0,s):n+o.slice(0,o.length-hs(o))}function hs(t){let e=Math.min(t.length,yt.length-1);for(let n=e;n>0;n--)if(t.endsWith(yt.slice(0,n)))return n;return 0}function co(t,e,n){let r=t.indexOf(yt,e);if(r!==-1&&r<n)return r;let o=t.indexOf("{",e);return o===-1||o>n?e:o}function lo(t){let e=[],n=0;for(;;){let r=t.indexOf(zt,n);if(r===-1)return e;let o=co(t,n,r);t.startsWith(yt,o)&&(o+=yt.length),e.push(t.slice(o,r).trim()),n=r+zt.length}}on();var yu=5,Lr=null,_u="bonsai-kernels";function Ai(t,e){let n=null,r="",o=!1,i=null,s=u=>t.postMessage(u);function a(u){if(i)return;i=u,o=!0,n=null;let l="";/watchdog|timeout|tdr|hung|exceeded.*deadline/i.test(u)?l=" This is a GPU watchdog timeout (TDR), usually caused by an integrated GPU or weak adapter taking too long on a compute batch. The safest path is a smaller model or the hosted inference ladder. Retrying WILL reset the driver again.":/destroyed/i.test(u)?l=" (This is an expected shutdown, not an error.)":l=" The GPU device was torn away by the OS (possibly due to an overheating shutdown, driver crash, or resource exhaustion). Retrying may succeed after a delay, but is risky.",s({type:"error",fatal:"device-lost",message:`bonsai: GPU device lost (${u}).${l} Not retrying automatically \u2014 retrying without addressing the root cause will re-trigger the same reset.`})}async function c(u){if(i)return s({type:"error",fatal:"device-lost",message:`bonsai: refusing to load \u2014 the GPU device was already lost (${i}).`});try{let l=await e.acquireDevice();l.lost&&l.lost.then(h=>{h?.reason!=="destroyed"&&a(`${h?.reason??"unknown"}: ${h?.message??"no detail"}`)}),l.addEventListener?.("uncapturederror",h=>{let m=h?.error?.message??"unknown GPU error";console.error(`[bonsai] uncaptured GPU error: ${m}`),/out of memory|allocation/i.test(m)?(s({type:"error",message:`bonsai: the GPU ran out of memory (${m}). This model is too large for this adapter \u2014 choose a smaller size.`}),o=!0):/timeout|watchdog|tdr/i.test(m)?a(`watchdog: ${m}`):console.warn(`[bonsai] uncaptured GPU error ignored: ${m} \u2014 generation may continue but results may be corrupt`)});let p=await e.loadKernels();n=ao({device:l,kernelSources:p}),r=u,await n.load({modelUrl:e.resolveModelUrl(u),...e.resolveMirrorUrls?{mirrorUrls:e.resolveMirrorUrls(u)}:{},onProgress:h=>s({type:"progress",progress:h.percent,file:h.detail})}),s({type:"ready",modelId:u})}catch(l){let p=l.message,h=p.includes("token_embd")||p.includes("output_norm")?" This usually means the model download was interrupted or the browser cache is corrupted. Try: (1) clear site data and reload, (2) try a smaller model (Bonsai 4B is 545 MB), or (3) run locally with `pip install awdk && adk bonsai-local` for a faster, more reliable experience.":"";s({type:"error",message:`bonsai load failed: ${p}${h}`})}}async function d(u){if(i)return s({type:"error",fatal:"device-lost",message:`bonsai: cannot generate \u2014 the GPU device was lost (${i}).`});if(!n?.loaded)return s({type:"error",message:"no model loaded \u2014 send {type:'load'} first"});o=!1;try{let{tokenizer:l,config:p,device:h,pipelines:m,weights:b}=n.loaded,f=u.maxTokens??256,g=u.temperature??.7,v=u.topK??20,y=u.topP??.95,k=u.repetitionPenalty??1.1,L=u.reasoningBudget??Math.max(32,f-128),E=l.encodeChat(u.messages,u.tools),O=E.length,_=8192,I=globalThis.__BONSAI_PREFIX_DISABLE!==!0,{kvBytesPerPosition:Z,kvBudgetBytes:U,planKvCapacity:xt}=await Promise.resolve().then(()=>(Ko(),Uo)),{resolveKvMode:St}=await Promise.resolve().then(()=>(Zn(),Jn)),De=St(),ze=De==="4bit"?.5:4,K=xt({promptLen:O,maxTokens:f,ceiling:_,bytesPerPosition:Z({fullAttnLayerCount:p.fullAttnLayers.length,headCountKv:p.headCountKv,headDim:p.keyLength??p.embeddingLength/p.headCount},ze),budgetBytes:U(globalThis.navigator?.deviceMemory),reuseEnabled:I}),ae=K.capacity;if(console.log(`[bonsai] kv capacity ${ae} \u2014 ${K.reason}`),O+f+1>_)return s({type:"error",message:`context too long: prompt ${O} + maxTokens ${f} > ${_} KV slots. Shorten the prompt or lower maxTokens (in-browser Bonsai is capped at ${_} tokens).`});let{F32KvCache:A}=await Promise.resolve().then(()=>(Wo(),Fo)),{KvCache:tt}=await Promise.resolve().then(()=>(Zn(),Jn)),{SsmState:He}=await Promise.resolve().then(()=>(Qo(),jo)),{f32Buffer:me,sampleToken:nt,sampleTiming:qe}=await Promise.resolve().then(()=>(je(),kt));qe.readbackMs=0,qe.selectMs=0,qe.calls=0;let{prefill:fe,decodeStep:rt}=await Promise.resolve().then(()=>(on(),Hn)),{embedTokens:ot}=await Promise.resolve().then(()=>(zn(),qo)),{planReuse:pt,committedTokens:ht,cacheSignature:mt}=await Promise.resolve().then(()=>(Yo(),Ho)),Ee=Lr;Lr=null;let Oe=p.keyLength??p.embeddingLength/p.headCount,Be=mt({modelId:r||"unknown",quantType:String(b.weightQuantType()),blockCount:p.blockCount,embeddingLength:p.embeddingLength,headCountKv:p.headCountKv,headDim:Oe,linearAttnLayerCount:p.linearAttnLayers.length,kvMode:De}),Me=p.linearAttnLayers.length===0,ie=pt({cache:Ee&&Ee.device===h?Ee:null,promptIds:E,signature:Be,maxNewTokens:f,canTruncate:Me,disabled:globalThis.__BONSAI_PREFIX_DISABLE===!0}),$e=ie.mode==="extend"&&Ee!==null,q=$e?Ee.kv:De==="4bit"?new tt(h,{fullAttnLayers:p.fullAttnLayers,headCountKv:p.headCountKv,headDim:Oe,capacity:ae},m):new A(h,{fullAttnLayers:p.fullAttnLayers,headCountKv:p.headCountKv,headDim:Oe,capacity:ae}),ue=p.deltaNet,ee=$e?Ee.ssm:new He(h,{linearAttnLayers:p.linearAttnLayers,heads:ue?.numVHeads??0,dK:ue?.headDim??0,dV:ue?.headDim??0,dConv:ue?.convKernel,ssmInnerSize:ue?.vDim,convDim:ue?.convDim});if(!ue&&p.linearAttnLayers.length>0)throw new Error(`bonsai-worker: ${p.linearAttnLayers.length} DeltaNet layers were classified but the model exposes no ssm.* geometry \u2014 refusing to run them with zero dims.`);if($e?q.truncate(ie.reuseLen):(q.reset(),ee.reset()),q.filledLength()!==ie.reuseLen)throw new Error(`bonsai-prefix: KV length ${q.filledLength()} != planned reuse ${ie.reuseLen} \u2014 refusing to prefill at a position the cache does not end on`);let ye=ie.prefillIds;ie.savedTokens>0?console.log(`[bonsai] prefix reuse: ${ie.savedTokens}/${O} tokens reused (${ie.reason}); prefilling ${ye.length}`):console.log(`[bonsai] prefix reuse: none \u2014 ${ie.reason}`);let Ue=me(h,ye.length*p.embeddingLength,"hidden_prefill"),te=b.weightQuantType(),Y={device:h,pipelines:m,weights:b,config:p,kv:q,kvMode:De,ssm:ee,quantType:te};s({type:"progress",progress:10,file:`prefill ${O} tokens (running ${p.blockCount} layers)`});let se=Date.now();console.log(`[bonsai] prefill start: ${O} tokens \xD7 ${p.blockCount} layers`);let ge=await fe(Y,Ue,ye,l,(T,w)=>{s({type:"progress",progress:10+Math.floor(T/w*30),file:`warming layer ${T+1}/${w}`})},ie.reuseLen);if(q.filledLength()!==O)throw new Error(`bonsai-prefix: after prefill KV length ${q.filledLength()} != prompt ${O}`);let Ie=Date.now()-se;if(console.log(`[bonsai] prefill done in ${Ie}ms (${(Ie/O).toFixed(0)}ms/token)`),et()){let{readbackF32:T}=await Promise.resolve().then(()=>(je(),kt)),w=await T({device:h,pipelines:m},ge.logits,l.vocabSize),P=1/0,B=-1/0,j=0,be=0;for(let G=0;G<w.length;G++){let $=w[G];if(!Number.isFinite($)){be++;continue}$<P&&(P=$),$>B&&(B=$),j+=$}let ne=j/w.length,M=0;for(let G=0;G<w.length;G++){let $=w[G];Number.isFinite($)&&(M+=($-ne)*($-ne))}let N=Math.sqrt(M/w.length),ce=32,Q=[],we=-1/0;for(let G=0;G<w.length;G++){let $=w[G];if(Q.length===ce&&$<=we)continue;let re=Q.length;for(;re>0&&w[Q[re-1]]<$;)re--;Q.splice(re,0,G),Q.length>ce&&Q.pop(),we=w[Q[Q.length-1]]}let Ge=Q.map(G=>{let $=l.decode([G]).replace(/\n/g,"\\n").slice(0,14);return`${G}:${w[G].toFixed(3)}"${$}"`});console.log(`[bonsai] LOGITS vocab=${w.length} bad=${be} min=${P.toFixed(3)} max=${B.toFixed(3)} mean=${ne.toFixed(4)} sd=${N.toFixed(4)} margin(top1-top2)=${(w[Q[0]]-w[Q[1]]).toFixed(4)}`),console.log(`[bonsai] LOGITS_TOP32 ${Ge.join(" ")}`),console.log(`[bonsai] LOGITS_STOPS ${[...l.stopIds].map(G=>`${G}=${w[G]?.toFixed(3)}`).join(" ")}`)}if(globalThis.__BONSAI_PREFILL_DIFF===!0&&O>=3){let T=globalThis,w=O-2;T.__BONSAI_ROWS={},T.__BONSAI_CAPTURE_POS=w,q.reset(),ee.reset(),T.__BONSAI_CAPTURE_TAG="PN";let P=me(h,O*p.embeddingLength,"hidden_pN");await fe(Y,P,E,l),q.reset(),ee.reset(),T.__BONSAI_CAPTURE_TAG="PM";let B=globalThis.__BONSAI_DETERMINISM===!0,j=B?E:E.slice(0,-1);B&&console.log(`[bonsai] DETERMINISM CONTROL: both runs use the SAME ${O} tokens; expect 0 differing everywhere`);let be=me(h,j.length*p.embeddingLength,"hidden_pM");if(await fe(Y,be,j,l),B){q.reset(),ee.reset(),T.__BONSAI_CAPTURE_TAG="PC";let M=me(h,O*p.embeddingLength,"hidden_pC");await fe(Y,M,E,l)}T.__BONSAI_CAPTURE_TAG=void 0,T.__BONSAI_CAPTURE_POS=void 0;let ne=T.__BONSAI_ROWS??{};if(B)for(let M=0;M<p.blockCount;M++){let N=ne[`PM:${M}`],ce=ne[`PC:${M}`];if(!N||!ce||N.length!==ce.length)continue;let Q=0,we=0,Ge=0,G=0;for(let $=0;$<N.length;$++){let re=Math.abs(N[$]-ce[$]);re>Q&&(Q=re),we+=re,Ge+=Math.abs(N[$]),re>1e-6&&G++}console.log(`[bonsai] WARMDIFF L${M} kind=${p.layerKinds[M]} maxAbs=${Q.toExponential(3)} relative=${(we/(Ge||1)).toExponential(3)} differing=${G}/${N.length}`)}for(let M=0;M<p.blockCount;M++){let N=ne[`PN:${M}`],ce=ne[`PM:${M}`];if(!N||!ce||N.length!==ce.length)continue;let Q=0,we=0,Ge=0,G=0;for(let $=0;$<N.length;$++){let re=Math.abs(N[$]-ce[$]);re>Q&&(Q=re),we+=re,Ge+=Math.abs(N[$]),re>1e-6&&G++}console.log(`[bonsai] PREFILLDIFF L${M} kind=${p.layerKinds[M]} pos=${w} maxAbs=${Q.toExponential(3)} relative=${(we/(Ge||1)).toExponential(3)} differing=${G}/${N.length}`)}T.__BONSAI_ROWS={},q.reset(),ee.reset(),await fe(Y,Ue,E,l)}if(globalThis.__BONSAI_DECODE_DIFF===!0&&O>=2){let{readbackF32:T}=await Promise.resolve().then(()=>(je(),kt)),w=globalThis,P=l.vocabSize;w.__BONSAI_ROWS={},q.reset(),ee.reset(),w.__BONSAI_CAPTURE_TAG="A";let B=me(h,O*p.embeddingLength,"hidden_diffA"),j=await fe(Y,B,E,l),be=Array.from(await T({device:h,pipelines:m},j.logits,P));q.reset(),ee.reset(),w.__BONSAI_CAPTURE_TAG=void 0;let ne=E.slice(0,-1),M=me(h,ne.length*p.embeddingLength,"hidden_diffB");await fe(Y,M,ne,l);let N=globalThis.__BONSAI_INJECT_LAYER;if(typeof N=="number"&&Number.isFinite(N)){let V=(w.__BONSAI_ROWS??{})[`A:${N}`];V&&(globalThis.__BONSAI_INJECT={layer:N,row:V},console.log(`[bonsai] INJECT armed at L${N}`))}w.__BONSAI_CAPTURE_TAG="B";let ce=me(h,p.embeddingLength,"hidden_diffDec");await ot(Y,[E[O-1]],ce,b,p.embeddingLength);let Q=await rt(Y,ce,O-1,l),we=Array.from(await T({device:h,pipelines:m},Q.logits,P));w.__BONSAI_CAPTURE_TAG=void 0;let Ge=w.__BONSAI_ROWS??{};for(let V=0;V<p.blockCount;V++){let de=Ge[`A:${V}`],ft=Ge[`B:${V}`];if(!de||!ft||de.length!==ft.length)continue;let Ne=0,xn=0,Rr=0,Cr=0;for(let At=0;At<de.length;At++){let Dt=Math.abs(de[At]-ft[At]);Dt>Ne&&(Ne=Dt),xn+=Dt,Rr+=Math.abs(de[At]),Dt>1e-6&&Cr++}console.log(`[bonsai] BLOCKDIFF L${V} kind=${p.layerKinds[V]} maxAbs=${Ne.toExponential(3)} meanAbs=${(xn/de.length).toExponential(3)} relative=${(xn/(Rr||1)).toExponential(3)} differing=${Cr}/${de.length}`)}let G=0,$=0,re=0;for(let V=0;V<P;V++){if(!Number.isFinite(we[V])){re++;continue}let de=Math.abs(be[V]-we[V]);de>G&&(G=de),$+=de}let Ct=V=>{let de=-1,ft=-1/0;for(let Ne=0;Ne<P;Ne++)Number.isFinite(V[Ne])&&V[Ne]>ft&&(ft=V[Ne],de=Ne);return de};console.log(`[bonsai] DECODE_DIFF pos=${O-1} maxAbs=${G.toFixed(4)} meanAbs=${($/P).toFixed(6)} nonFiniteB=${re} argmaxA=${Ct(be)} argmaxB=${Ct(we)} argmaxAgree=${Ct(be)===Ct(we)}`),globalThis.__BONSAI_INJECT=void 0,w.__BONSAI_ROWS={},q.reset(),ee.reset(),await fe(Y,Ue,E,l)}let X=me(h,p.embeddingLength,"hidden_decode"),Ke={device:h,pipelines:m,quantType:te},F=globalThis.__BONSAI_TIMING===!0,W={embed:0,forward:0,sample:0,tokens:0},Pe=[],it=async(T,w)=>{Pe.push(T);let P=F?performance.now():0;await ot(Y,[T],X,b,p.embeddingLength);let B=F?performance.now():0,j=(await rt(Y,X,w,l)).logits;return F&&(await h.queue.onSubmittedWorkDone(),W.embed+=B-P,W.forward+=performance.now()-B,W.tokens++),j},It="\uFFFD",Lt=T=>{let w=l.decode(T),P=w.length;for(;P>0&&w[P-1]===It;)P--;return w.slice(0,P)},yn=[],_n=[],Gt="",Br="",Ii=(T,w,P)=>{let B=Lt(T);return B.length>w.length&&B.startsWith(w)?(s({type:"token",text:B.slice(w.length),channel:P}),B):B.length>=w.length?B:w},Pr=!!(u.tools&&u.tools.length>0),Nt="",Or=0,Gi=T=>{let w=Lt(T),P=uo(w,Pr);if(P.length>Nt.length&&P.startsWith(Nt)&&(s({type:"token",text:P.slice(Nt.length),channel:"answer"}),Nt=P),Pr){let B=lo(w);for(let j=Or;j<B.length;j++)s({type:"token",text:B[j],channel:"tool"});Or=B.length}return w},st=!1;if(l.thinkEndId!==void 0&&l.thinkStartId!==void 0){let T=E.lastIndexOf(l.thinkStartId),w=E.lastIndexOf(l.thinkEndId);st=T!==-1&&T>w}let $r=!1,Ni=64,Rt=[],kn=ge.logits,Ir=O,_e=0,vn="max-tokens",Gr=Date.now();for(;_e<f&&!o;){let T=F?performance.now():0,w=await nt(Ke,kn,l.vocabSize,{temperature:g,topK:v,topP:y,repetitionPenalty:k,recentIds:Rt});if(F&&(W.sample+=performance.now()-T),_e++,l.isStop(w)){vn="stop-token";break}Rt.push(w),Rt.length>Ni&&Rt.shift(),w===l.thinkEndId?st=!1:w===l.thinkStartId?st=!0:st?(yn.push(w),Gt=Ii(yn,Gt,"thinking")):(_n.push(w),Br=Gi(_n)),kn=await it(w,Ir++),st&&!$r&&l.thinkEndId!==void 0&&_e>=L&&($r=!0,st=!1,kn=await it(l.thinkEndId,Ir++),s({type:"progress",file:"reasoning budget reached \u2014 answering"}));let P=10+Math.floor(_e/f*80),B=_e/((Date.now()-Gr)/1e3),j=st?"thinking":"answering";s({type:"progress",progress:P,file:`${j} \xB7 ${_e} tok \xB7 ${B.toFixed(1)} tok/s`}),(_e===1||_e%10===0)&&console.log(`[bonsai] ${_e} tokens \xB7 ${B.toFixed(2)} tok/s (${j})`)}o&&(vn="interrupted");let Ri=Date.now()-Gr,Ci=_e>0?_e/Ri*1e3:0,Nr=Br.trim()||(Gt.trim()?"I ran out of room to finish that thought \u2014 my reasoning is above. Ask again and I'll be more direct.":"");if(console.log(`[bonsai] done: ${_e} tok, ${vn}, think=${yn.length} answer=${_n.length}`),F&&W.tokens>0){let T=W.tokens,w=be=>(be/T).toFixed(1),P=W.embed+W.forward+W.sample,B=qe,j=B.calls>0?` [readback=${w(B.readbackMs)}ms select=${w(B.selectMs)}ms]`:"";console.log(`[bonsai] TIMING per token over ${T}: embed=${w(W.embed)}ms forward=${w(W.forward)}ms sample=${w(W.sample)}ms${j} (${w(P)}ms total, ${(1e3/(P/T)).toFixed(1)} tok/s implied)`)}if(u.tools&&u.tools.length>0){let{setToolContext:T,drainToolActions:w}=await Promise.resolve().then(()=>(Sr(),yi));T(u.context??{});let{orchestrateToolCalls:P,extendMessagesWithToolResults:B}=await Promise.resolve().then(()=>(Li(),Si)),{finalText:j,toolCalls:be}=await P(Nr,ne=>{ne.type==="tool_result"&&s({type:"progress",file:`executed ${ne.toolName}: ${ne.result}`})},yu);if(be.length>0){let ne=w();ne.length>0&&s({type:"tool_action",actions:ne});let{drainImages:M}=await Promise.resolve().then(()=>(nr(),Xo)),N=M();N.length>0&&s({type:"image",images:N});let ce=j.trim()?[...u.messages,{role:"assistant",content:j}]:[...u.messages];await d({...u,messages:B(ce,be),tools:void 0});return}}Lr={device:h,kv:q,ssm:ee,tokens:ht(E,Pe),signature:Be,capacity:q.capacity},s({type:"done",text:Nr,reasoning:Gt.trim()||void 0,tokensPerSecond:Ci})}catch(l){let p=l.message,m=p.includes("not loaded")&&(p.includes("token_embd")||p.includes("output_norm"))?" The model weights were not fully downloaded. Clear your browser's site data (Settings \u2192 Privacy \u2192 Clear browsing data \u2192 Cached images and files), then reload this page to re-download the model. Or run locally: `pip install awdk && adk bonsai-local` for GPU-accelerated inference.":"";s({type:"error",message:`bonsai generate failed: ${p}${m}`})}}t.addEventListener("message",u=>{let l=u.data;l.type==="load"?c(l.modelId):l.type==="generate"?d(l):l.type==="interrupt"&&(o=!0)})}var ku=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - depthwise causal 1-D conv over q/k/v projections (short left-padded kernel).\r
//\r
// Part of the DeltaNet linear-attention path. Depthwise (per-channel) causal convolution\r
// with left padding = kernel_size-1, followed by the activation applied in the caller.\r
// Matches the fork ssm_conv1d contract; the exact activation ordering is transcribed in\r
// deltanet.wgsl. State carry for streaming decode lives in ssm_state.ts.\r
\r
struct ConvP {\r
  n_tokens : u32,\r
  channels : u32,\r
  kernel   : u32,   // ssm.conv_kernel\r
  _p0 : u32,\r
};\r
\r
@group(0) @binding(0) var<storage, read>       x       : array<f32>;   // [n_tokens * channels]\r
@group(0) @binding(1) var<storage, read>       weight  : array<f32>;   // [channels * kernel]\r
@group(0) @binding(2) var<storage, read>       bias    : array<f32>;   // [channels]\r
@group(0) @binding(3) var<storage, read_write> out     : array<f32>;   // [n_tokens * channels]\r
@group(0) @binding(4) var<uniform>             p       : ConvP;\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // one thread per (token, channel)\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\r
  let total = p.n_tokens * p.channels;\r
  if (idx >= total) { return; }\r
  let token = idx / p.channels;\r
  let ch    = idx % p.channels;\r
\r
  var sum : f32 = bias[ch];\r
  for (var kk : u32 = 0u; kk < p.kernel; kk = kk + 1u) {\r
    // causal: output token t depends on inputs [t-(kernel-1) .. t]; left-pad with 0\r
    let offset = i32(token) - i32(p.kernel - 1u - kk);\r
    if (offset >= 0) {\r
      let xv = x[u32(offset) * p.channels + ch];\r
      sum = sum + xv * weight[ch * p.kernel + kk];\r
    }\r
  }\r
  out[idx] = sum;   // activation applied by caller (SiLU) per fork ordering\r
}\r
`,vu=`// ============================================================================\r
// DEPRECATED / NOT ON THE LIVE PATH (verified 2026-07-24).\r
//\r
// Token generation uses deltanet_seq.wgsl. This kernel's only dispatcher is\r
// ops.ts::deltanetStep, which has ZERO callers.\r
//\r
// IT ALSO CARRIES OLDER RECURRENCE ALGEBRA than deltanet_seq.wgsl (decay applied\r
// at a different point), so reading it as "the" delta rule will mislead you \u2014\r
// an ultracode pass did exactly that. Diff against deltanet_seq.wgsl, or better\r
// against the authoritative fork:\r
//   github.com/PrismML-Eng/llama.cpp @ prism\r
//     src/models/delta-net-base.cpp :: build_delta_net_autoregressive\r
//     src/models/qwen35.cpp         :: build_layer_attn_linear\r
// (that repo is PUBLIC and fetchable.)\r
//\r
// Do not "fix" this file expecting model behaviour to change.\r
// ============================================================================\r
// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - gated DeltaNet recurrence ...... src/llama-model.cpp:1797-1799 (qwen35 shares QWEN3NEXT SSM path)\r
//   - ssm tensors .................... src/llama-arch.cpp:431-439 (ssm_conv1d/beta/g_a/g_b/a/norm)\r
//\r
// HIGHEST ARCHITECTURAL RISK (\xA78 risk #2). Gated delta-rule linear attention on the 48\r
// linear layers. Per-head state matrix S (d_k x d_v) persisted across decode steps\r
// (ssm_state.ts). This is the SINGLE-STEP DECODE recurrence (one token). Prefill uses a\r
// chunked/parallel scan built on the same algebra (implemented in TS-driven dispatch).\r
//\r
// Recurrence (per token), transcribed from the fork's DeltaNet reference:\r
//     err = v - S^T k            (d_v)          "delta" prediction error\r
//     S   = S * diag(g)          (decay/gate along d_k)\r
//     S   = S + beta * (k outer err)            rank-1 update\r
//     o   = S^T q                (d_v)          output\r
//\r
// CORRECTNESS NOTE: the exact placement of the gate (before vs after the delta term) and\r
// whether beta multiplies err or (err scaled) MUST be pinned by the Milestone-5 golden\r
// vector against the fork before this layer is trusted. The structure below encodes the\r
// design's stated form; it is the reference the M5 test validates, not an assumed-correct\r
// final answer.  One workgroup per head; S held in storage (persisted between calls).\r
\r
struct DeltaP {\r
  d_k   : u32,\r
  d_v   : u32,\r
  head  : u32,\r
  _p0   : u32,\r
};\r
\r
@group(0) @binding(0) var<storage, read>        q     : array<f32>;   // [d_k]\r
@group(0) @binding(1) var<storage, read>        k     : array<f32>;   // [d_k]\r
@group(0) @binding(2) var<storage, read>        v     : array<f32>;   // [d_v]\r
@group(0) @binding(3) var<storage, read>        g     : array<f32>;   // [d_k] gate (diag)\r
@group(0) @binding(4) var<storage, read>        beta  : array<f32>;   // [1] scalar beta\r
@group(0) @binding(5) var<storage, read_write>  state : array<f32>;   // [d_k * d_v] persisted S\r
@group(0) @binding(6) var<storage, read_write>  out   : array<f32>;   // [d_v]\r
@group(0) @binding(7) var<uniform>              p     : DeltaP;\r
\r
@compute @workgroup_size(1)\r
fn main() {\r
  let dk = p.d_k;\r
  let dv = p.d_v;\r
  let b  = beta[0];\r
\r
  // err = v - S^T k    (S is [d_k x d_v], row i = state[i*dv + j])\r
  var err : array<f32, 256>;   // d_v <= 256\r
  for (var j : u32 = 0u; j < dv; j = j + 1u) {\r
    var sTk : f32 = 0.0;\r
    for (var i : u32 = 0u; i < dk; i = i + 1u) {\r
      sTk = sTk + state[i * dv + j] * k[i];\r
    }\r
    err[j] = v[j] - sTk;\r
  }\r
\r
  // S = S*diag(g) + beta * (k outer err); then o = S^T q\r
  var o : array<f32, 256>;\r
  for (var j : u32 = 0u; j < dv; j = j + 1u) { o[j] = 0.0; }\r
\r
  for (var i : u32 = 0u; i < dk; i = i + 1u) {\r
    let gi = g[i];\r
    let ki = k[i];\r
    let qi = q[i];\r
    for (var j : u32 = 0u; j < dv; j = j + 1u) {\r
      let s_new = state[i * dv + j] * gi + b * ki * err[j];\r
      state[i * dv + j] = s_new;\r
      o[j] = o[j] + s_new * qi;   // accumulate S^T q with the updated state\r
    }\r
  }\r
\r
  for (var j : u32 = 0u; j < dv; j = j + 1u) { out[j] = o[j]; }\r
}\r
`,xu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
//\r
// Gated-DeltaNet per-(token,v-head) scalars, computed from the alpha/beta projections\r
// and the learnable A_log / dt_bias, exactly as Qwen3-Next's GatedDeltaNet:\r
//   beta_t = sigmoid(beta_raw)                                  (write strength, (0,1))\r
//   g_t    = exp( ssm_a * softplus(alpha_raw + dt_bias) ) (decay, (0,1]; ssm_a = -exp(A_log) pre-baked)\r
// One thread per (token, v-head). H = num_v_heads. Inputs are [n_tokens*H]; A_log and\r
// dt_bias are per-v-head [H]. softplus is evaluated in the numerically-stable form.\r
\r
struct GateP { n_tokens : u32, heads : u32, _p0 : u32, _p1 : u32 };\r
\r
@group(0) @binding(0) var<storage, read>        alpha_raw : array<f32>;   // [n_tokens*H]\r
@group(0) @binding(1) var<storage, read>        beta_raw  : array<f32>;   // [n_tokens*H]\r
@group(0) @binding(2) var<storage, read>        a_log     : array<f32>;   // [H]\r
@group(0) @binding(3) var<storage, read>        dt_bias   : array<f32>;   // [H]\r
@group(0) @binding(4) var<storage, read_write>  g_out     : array<f32>;   // [n_tokens*H]\r
@group(0) @binding(5) var<storage, read_write>  beta_out  : array<f32>;   // [n_tokens*H]\r
@group(0) @binding(6) var<uniform>              p         : GateP;\r
\r
fn softplus(x : f32) -> f32 {\r
  // log(1+exp(x)) stable: max(x,0) + log(1 + exp(-|x|))\r
  return max(x, 0.0) + log(1.0 + exp(-abs(x)));\r
}\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\r
  let total = p.n_tokens * p.heads;\r
  if (idx >= total) { return; }\r
  let h = idx % p.heads;\r
\r
  let sp = softplus(alpha_raw[idx] + dt_bias[h]);\r
  // ssm_a is stored PRE-BAKED as -exp(A_log) in the GGUF (verified: blk.0.ssm_a\r
  // = -0.2629, negative) - the fork multiplies it in DIRECTLY (qwen35.cpp:\r
  // "gate = alpha_softplus * ssm_a  // -A_log.exp() * softplus"). Applying\r
  // -exp() AGAIN gave ~3x wrong decay in all 48 DeltaNet layers.\r
  let a  = a_log[h] * sp;            // <= 0 (a_log holds -exp(A_log) pre-baked)\r
  g_out[idx]    = exp(a);            // (0,1]\r
  beta_out[idx] = 1.0 / (1.0 + exp(-beta_raw[idx]));\r
}\r
`,Su=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
//\r
// Gated DeltaNet (Qwen3-Next) sequential recurrence \u2014 the WHOLE token sequence for a\r
// layer in ONE dispatch, no host readback. Per v-head state S is [d_k \xD7 d_v] (d_k==d_v==\r
// head_dim). q/k are grouped: each v-head h reads the k/q of k-head (h / v_per_k). q,k are\r
// already L2-normalized; v is already conv+SiLU'd; g (decay) and beta (write strength) are\r
// precomputed per (token,v-head) by deltanet_gate.\r
//\r
// Recurrence, per token t, per v-head h (from modeling_qwen3_next GatedDeltaNet):\r
//   Sdec[i,j] = g_t * S[i,j]                    (scalar decay per head/step)\r
//   kv[j]     = sum_i Sdec[i,j] * k[i]          (retrieve current key)\r
//   err[j]    = v[j] - kv[j]\r
//   S[i,j]    = Sdec[i,j] + k[i] * (beta_t * err[j])   (rank-1 write)\r
//   o[j]      = (sum_i S[i,j] * q[i]) / sqrt(d_k)      (read-out)\r
//\r
// Parallelism: one thread per (v-head h, value-column j). Thread (h,j) owns column j of\r
// head h's state \u2014 columns are disjoint across threads, so the update is race-free and the\r
// per-token loop runs inside the thread with NO barriers. Grid = heads * head_dim threads.\r
\r
struct SeqP {\r
  n_tokens  : u32,\r
  v_heads   : u32,   // num_v_heads (48)\r
  k_heads   : u32,   // num_k_heads (16)\r
  head_dim  : u32,   // d_k == d_v (128)\r
  v_per_k   : u32,   // v_heads / k_heads (3)\r
  _p0 : u32, _p1 : u32, _p2 : u32,\r
};\r
\r
@group(0) @binding(0) var<storage, read>        q     : array<f32>;   // [n_tokens * k_heads * head_dim]\r
@group(0) @binding(1) var<storage, read>        k     : array<f32>;   // [n_tokens * k_heads * head_dim]\r
@group(0) @binding(2) var<storage, read>        v     : array<f32>;   // [n_tokens * v_heads * head_dim]\r
@group(0) @binding(3) var<storage, read>        gdec  : array<f32>;   // [n_tokens * v_heads]\r
@group(0) @binding(4) var<storage, read>        beta  : array<f32>;   // [n_tokens * v_heads]\r
@group(0) @binding(5) var<storage, read_write>  state : array<f32>;   // [v_heads * head_dim * head_dim]\r
@group(0) @binding(6) var<storage, read_write>  out   : array<f32>;   // [n_tokens * v_heads * head_dim]\r
@group(0) @binding(7) var<uniform>              p     : SeqP;\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  let d   = p.head_dim;\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\r
  let total = p.v_heads * d;\r
  if (idx >= total) { return; }\r
\r
  let h = idx / d;            // v-head\r
  let j = idx % d;            // value column this thread owns\r
  // Fork-verified GQA mapping: ggml_repeat_4d TILES cyclically (dst head i1*ne01+k1\r
  // reads src head k1), so v-head h uses k-head (h % k_heads) - NOT h / v_per_k\r
  // (interleave). The old mapping paired 32 of 48 v-heads with the wrong q/k.\r
  let kh = h % p.k_heads;     // shared k/q head for this v-head (cyclic, fork parity)\r
  let sbase = h * d * d;      // base of head h's [d\xD7d] state\r
  let inv_scale = inverseSqrt(f32(d));\r
\r
  for (var t : u32 = 0u; t < p.n_tokens; t = t + 1u) {\r
    let qb = (t * p.k_heads + kh) * d;\r
    let vb = (t * p.v_heads + h) * d;\r
    let g  = gdec[t * p.v_heads + h];\r
    let b  = beta[t * p.v_heads + h];\r
\r
    // pass 1: kv[j] = sum_i (g*S[i,j]) * k[i]\r
    var kv : f32 = 0.0;\r
    for (var i : u32 = 0u; i < d; i = i + 1u) {\r
      kv = kv + g * state[sbase + i * d + j] * k[qb + i];\r
    }\r
    let err = v[vb + j] - kv;\r
\r
    // pass 2: write S[:,j] and read out o[j] = (sum_i S_new[i,j] * q[i]) / sqrt(d)\r
    var o : f32 = 0.0;\r
    for (var i : u32 = 0u; i < d; i = i + 1u) {\r
      let s_new = g * state[sbase + i * d + j] + k[qb + i] * (b * err);\r
      state[sbase + i * d + j] = s_new;\r
      o = o + s_new * q[qb + i];\r
    }\r
    out[vb + j] = o * inv_scale;\r
  }\r
}\r
`,Lu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - residual add / mul / copy helpers used between decoder sub-layers.\r
//\r
// Op selector via a uniform: 0=add, 1=mul, 2=copy(a). Element-wise over length n.\r
\r
struct EW { n : u32, op : u32, _p0 : u32, _p1 : u32 };\r
\r
@group(0) @binding(0) var<storage, read>       a   : array<f32>;\r
@group(0) @binding(1) var<storage, read>       b   : array<f32>;\r
@group(0) @binding(2) var<storage, read_write> out : array<f32>;\r
@group(0) @binding(3) var<uniform>             p   : EW;\r
\r
@compute @workgroup_size(256)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;\r
  if (i >= p.n) { return; }\r
  switch (p.op) {\r
    case 0u: { out[i] = a[i] + b[i]; }   // residual add\r
    case 1u: { out[i] = a[i] * b[i]; }\r
    default: { out[i] = a[i]; }          // copy\r
  }\r
}\r
`,Au=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// In-place elementwise (io = io OP b) \u2014 single read_write binding for the accumulator to\r
// avoid the read/read_write aliasing WebGPU rejects. Pairs with elementwise.wgsl.\r
// op: 0=add, 1=mul, 2=copy(no-op), 3=silu (unary: io = io*sigmoid(io), b ignored).\r
struct EW { n : u32, op : u32, _p0 : u32, _p1 : u32 };\r
@group(0) @binding(0) var<storage, read_write> io : array<f32>;\r
@group(0) @binding(1) var<storage, read>       b  : array<f32>;\r
@group(0) @binding(2) var<uniform>             p  : EW;\r
@compute @workgroup_size(256)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;\r
  if (i >= p.n) { return; }\r
  switch (p.op) {\r
    case 0u: { io[i] = io[i] + b[i]; }\r
    case 1u: { io[i] = io[i] * b[i]; }\r
    case 3u: { let z = io[i]; io[i] = z / (1.0 + exp(-z)); }   // SiLU\r
    case 4u: { io[i] = io[i] / (1.0 + exp(-b[i])); }          // io *= sigmoid(b) (attn out-gate)\r
    default: { }\r
  }\r
}\r
`,Tu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//
// 4-bit KV cache quantizer. One workgroup per (pos, kv_head) ROW; the 128 lanes cooperate
// over head_dim (DPT=2 dims/lane, head_dim=128 on every Bonsai size). Contract (matches
// reference.ts packKvRow4bit):
//     scale = roundF16(max_abs / 7)          // f16 emitted as u32 low 16 bits
//     raw   = clamp(roundAwayFromZero(x/scaleStored) + 8, 0, 15)
//     packed row = head_dim nibbles, 8 per u32, LSB-first
// The attention kernel (softmax_attn_batched) dequantizes with (f32(raw) - 8.0) * scale.
// raw 0 is unreachable (|x|/amax <= 1 so x/scale <= 7/1 after the f16 round); the clamp
// exists because scale is f16-rounded and x/scale can exceed 7 by a hair, so raw 15 (all
// ones) is the saturating ceiling for the largest magnitudes \u2014 exactly symmetric to Q8_0.
//
// Output layout per row (4-byte aligned):
//   scales[row]        : u32  \u2014 f16 scale in the LOW 16 bits
//   packed[row\xB7words + w] : u32 \u2014 8 nibbles per word, word 0 holds elements 0..7, etc.
// Requires head_dim % 8 == 0 for the flat element index -> word index (e>>3) mapping used
// by the attention kernel to be row-local, AND head_dim <= 128 because one workgroup is
// exactly 128 lanes with one dim per lane. Both asserted on the host (KvCache ctor); a
// head_dim > 128 would leave the tail of every row unquantized silently, so it must throw.

const QK4 : u32 = 8u;   // nibbles per u32
const WG4 : u32 = 128u; // lanes per row (matches head_dim on every Bonsai size)
const DPT : u32 = 2u;   // dims per lane (head_dim <= 256 asserted on the host)

struct QP {
  head_dim : u32,
  n_rows   : u32,
  row_base : u32,   // dest row offset = posBase * n_heads_kv (absolute position base)
  _p0      : u32,
};

@group(0) @binding(0) var<storage, read>       x      : array<f32>;  // n_rows * head_dim
@group(0) @binding(1) var<storage, read_write> packed : array<u32>;  // n_rows * words_per_row
@group(0) @binding(2) var<storage, read_write> scales : array<u32>;  // n_rows
@group(0) @binding(3) var<uniform>             p      : QP;

var<workgroup> shared_amax : array<f32, 128>;
// Quantized NIBBLES are exchanged as u32 (low 4 bits used). They must NOT be round-tripped
// through f32 workgroup memory: a value > 127 would be a signalling NaN bit pattern as f32
// and the GPU canonicalizes NaN on store/load (same rule as quantize_q8_0.wgsl).
var<workgroup> shared_q : array<u32, 128>;

@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression. One WORKGROUP per row, dispatched with workgroupSize=1 on the
  // host (never 128 \u2014 that would divide the group count by 128 and quantize 1/128th of rows).
  let row  = wg.x + wg.y * nwg.x;
  let lane = lid.x;
  let hd   = p.head_dim;
  if (row >= p.n_rows) { return; }

  // per-lane load + abs
  let xv = x[row * hd + lane];
  shared_amax[lane] = abs(xv);
  workgroupBarrier();

  // tree reduce max-abs across 128 lanes
  var stride : u32 = 64u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) {
      shared_amax[lane] = max(shared_amax[lane], shared_amax[lane + stride]);
    }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  let amax = shared_amax[0];
  // round scale through f16 exactly (pack/unpack) so quantization uses the stored scale \u2014
  // the attention kernel divides by THIS value, not by the full-precision amax/7.
  let scale_f16 = pack2x16float(vec2<f32>(amax / 7.0, 0.0)) & 0xffffu;
  let scale     = unpack2x16float(scale_f16).x;
  let id        = select(0.0, 1.0 / scale, scale != 0.0);

  // quantize this lane's value to a 0..15 nibble. WGSL round() rounds half away from zero,
  // which is the SAME tie rule the CPU reference implements (Math.sign*Math.round).
  let raw = clamp(round(xv * id) + 8.0, 0.0, 15.0);
  shared_q[lane] = u32(raw) & 0xFu;
  workgroupBarrier();

  if (lane == 0u) {
    let row_abs = p.row_base + row;
    scales[row_abs] = scale_f16;
    let words = (hd + QK4 - 1u) / QK4;
    for (var w : u32 = 0u; w < words; w = w + 1u) {
      var v : u32 = 0u;
      for (var k : u32 = 0u; k < QK4; k = k + 1u) {
        let idx = w * QK4 + k;
        v = v | (select(0u, shared_q[idx], idx < hd) << (k * 4u));
      }
      packed[row_abs * words + w] = v;
    }
  }
}
`,Eu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
//
// SELECT THE TOP-K LOGITS ON THE GPU, so decode stops shipping the whole vocabulary to the
// host every single token.
//
// \u2500\u2500 WHY (measured 2026-07-31) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// sampleToken() read back the ENTIRE logits row \u2014 vocab 248,320 x 4 B \u2248 993 KB \u2014 per token,
// then picked the top-k in JS. Once the attention kernel was parallelised, that readback
// became the single largest cost in the decode loop. Splitting the sample phase into its two
// halves settled which half, and it was not the half the code comments worried about:
//
//     sample=83.9ms  [readback=83.4ms  select=0.4ms]     (4B, 1285-token context)
//
// The JS selection pass over a quarter-million floats costs FOUR TENTHS of a millisecond.
// The transfer around it costs two hundred times that, and it scales with nothing useful \u2014
// it is the same 993 KB whether the answer is one token or a thousand. So the fix is not a
// better loop, it is to stop moving the data: select on the device and return a few hundred
// bytes. Pooling the staging buffer first was tried and did NOT move the number.
//
// \u2500\u2500 HOW, AND WHY IT IS EXACT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// A parallel exact top-k is awkward in WGSL (no cross-workgroup reduction primitive), and a
// per-block top-1 is NOT exact \u2014 the whole top-k can live inside one block. So: threshold,
// then gather.
//
//   pass 1 \`hist\`   \u2014 histogram every logit into NBINS bins over a FIXED logit range.
//                     Fixed, so no max-reduction pass is needed first; out-of-range values
//                     clamp into the end bins, which keeps them findable rather than lost.
//   host            \u2014 read NBINS u32 (4 KB), walk from the top bin down accumulating counts
//                     until at least K have been seen. That bin's lower edge is a threshold
//                     T with a PROVEN property: at least K logits are >= T.
//   pass 2 \`gather\` \u2014 append every (index, value) with value >= T into a compact list via an
//                     atomic counter. Read back only the counter and that list.
//
// Every logit >= T is collected, and at least K logits are >= T, so the true top-K is a
// SUBSET of what comes back. The host then does an exact top-k over a few hundred candidates
// instead of 248,320 \u2014 the same code that already cost 0.4 ms, now on a smaller input.
//
// OVERFLOW IS NOT SILENTLY WRONG. If more candidates clear T than the output can hold, the
// gather writes what fits and the counter keeps counting, so the host sees count > capacity
// and FALLS BACK to the full readback. That is slow and correct, which is the right way
// round; dropping candidates would silently change which token is sampled, and a sampling
// bug reads as the model being dumb rather than as a bug.

struct TopKP {
  vocab      : u32,
  n_bins     : u32,
  lo         : f32,   // histogram range, in logit units
  hi         : f32,
  threshold  : f32,   // gather: keep values >= this (ignored by the hist entry point)
  capacity   : u32,   // gather: max pairs the output buffers can hold
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>        logits  : array<f32>;
@group(0) @binding(1) var<storage, read_write>  hist    : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write>  out_idx : array<u32>;
@group(0) @binding(3) var<storage, read_write>  out_val : array<f32>;
// [0] = number of candidates that cleared the threshold, INCLUDING any that did not fit.
@group(0) @binding(4) var<storage, read_write>  counter : array<atomic<u32>>;
@group(0) @binding(5) var<uniform>              p       : TopKP;

// One thread per logit. 256 is a safe workgroup size everywhere (the spec guarantees 256).
const WG : u32 = 256u;

/** Bin index for a logit value: bin 0 is the TOP of the range, so walking bins in ascending
 *  order walks logits in DESCENDING order \u2014 which is the direction the host needs. */
fn bin_of(v : f32) -> u32 {
  let span = max(p.hi - p.lo, 1e-6);
  // Fraction from the TOP of the range.
  let f = (p.hi - v) / span;
  let b = i32(floor(f * f32(p.n_bins)));
  // Clamp rather than discard: a logit above \`hi\` belongs in the top bin and a logit below
  // \`lo\` in the bottom one. Discarding out-of-range values would make the count wrong, and
  // the threshold derived from it wrong, in the one case that matters most \u2014 an unusually
  // confident token sitting above the assumed range.
  return u32(clamp(b, 0, i32(p.n_bins) - 1));
}

@compute @workgroup_size(256)
fn hist_main(@builtin(global_invocation_id) gid : vec3<u32>,
             @builtin(num_workgroups) nwg : vec3<u32>) {
  // Grid-stride, so the dispatch size does not have to divide the vocabulary and a 2-D
  // workgroup grid (dispatch1D folds past 65535) still covers every element exactly once.
  let stride = nwg.x * nwg.y * WG;
  let start = gid.x + gid.y * nwg.x * WG;
  var i = start;
  loop {
    if (i >= p.vocab) { break; }
    atomicAdd(&hist[bin_of(logits[i])], 1u);
    i = i + stride;
  }
}

@compute @workgroup_size(256)
fn gather_main(@builtin(global_invocation_id) gid : vec3<u32>,
               @builtin(num_workgroups) nwg : vec3<u32>) {
  let stride = nwg.x * nwg.y * WG;
  let start = gid.x + gid.y * nwg.x * WG;
  var i = start;
  loop {
    if (i >= p.vocab) { break; }
    let v = logits[i];
    if (v >= p.threshold) {
      // The counter is incremented even when the slot does not fit, so the host can tell
      // "collected everything" from "there were more than we could hold" and fall back.
      let slot = atomicAdd(&counter[0], 1u);
      if (slot < p.capacity) {
        out_idx[slot] = i;
        out_val[slot] = v;
      }
    }
    i = i + stride;
  }
}
`,Bu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - Q1_0 dequant ................... ggml/src/ggml-quants.c:419-437  (QK1_0=128)\r
//\r
// Standalone Q1_0 dequant for verification (Milestone 2 round-trip) and any non-hot-path\r
// wholesale dequant of small tensors. Contract (matches reference.ts dequantQ1Block):\r
//   block = { f16 d ; u8 qs[16] } = 18 bytes, 128 weights.\r
//   bit order LSB-first: weight j uses byte qs[j>>3], bit (j & 7).\r
//   bit == 1 -> +d ;  bit == 0 -> -d   (binary {-1,+1}; NOT ternary \u2014 no zero).\r
//\r
// Input packing: each 18-byte block is laid out as 5 u32 (padded) \u2014 word0 low16 = f16 d,\r
// bytes 2..17 = the 16 sign bytes. We pass blocks as array<u32> with 5 words per block\r
// (last word half-used) to stay 4-byte aligned. One thread per 128-weight block.\r
\r
const QK1_0 : u32 = 128u;\r
const WORDS_PER_BLOCK : u32 = 5u;   // 20 bytes reserved per block (18 used)\r
\r
@group(0) @binding(0) var<storage, read>       blocks : array<u32>;   // n_blocks * 5\r
@group(0) @binding(1) var<storage, read_write> out_w  : array<f32>;   // n_blocks * 128\r
@group(0) @binding(2) var<uniform>             n_blocks : u32;\r
\r
fn byte_at(block_base: u32, byte_index: u32) -> u32 {\r
  // byte_index is 0..17 within the block; word = byte_index/4, shift = (byte_index%4)*8\r
  let word = blocks[block_base + (byte_index >> 2u)];\r
  let sh   = (byte_index & 3u) * 8u;\r
  return (word >> sh) & 0xffu;\r
}\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let block = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\r
  if (block >= n_blocks) { return; }\r
  let bb = block * WORDS_PER_BLOCK;\r
\r
  // f16 d in the low 16 bits of word 0\r
  let d = unpack2x16float(blocks[bb] & 0xffffu).x;\r
\r
  let out_base = block * QK1_0;\r
  for (var j : u32 = 0u; j < QK1_0; j = j + 1u) {\r
    // sign bytes start at byte offset 2 within the block\r
    let byte = byte_at(bb, 2u + (j >> 3u));\r
    let bit  = (byte >> (j & 7u)) & 1u;\r
    out_w[out_base + j] = select(-d, d, bit == 1u);\r
  }\r
}\r
`,Pu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - q1_0\xB7q8_0 dot .................. ggml/src/ggml-cpu/quants.c:127-175 (ggml_vec_dot_q1_0_q8_0)\r
//   - Q1_0 block layout .............. ggml/src/ggml-common.h (QK1_0=128, block_q1_0)\r
//\r
// THE core kernel \u2014 reproduces ggml_vec_dot_q1_0_q8_0 EXACTLY. Binary sign selection,\r
// two-level scaling, integer accumulation. K-TILED with the activation row staged in\r
// workgroup shared memory: one workgroup owns 64 output cols of ONE row, so the row's\r
// activation is loaded once per K-tile and reused across all 64 cols (a 64x cut in\r
// activation global-memory traffic vs the scalar one-thread-per-element version). Weights\r
// are streamed per-col from global (sequential within a col = cache-friendly).\r
//\r
// NUMERICS ARE BIT-IDENTICAL to the scalar kernel: the f32 accumulation ORDER is preserved\r
// (blocks i ascending, sub-blocks k ascending; the 32-lane acc is INTEGER so order-free).\r
// Only memory traffic and the workgroup->(row,col) mapping changed.\r
//\r
// NON-NEGOTIABLE (verification checklist \xA710):\r
//   1. bit order LSB-first: weight j uses qs[j>>3], bit (j&7).\r
//   2. bit==1 -> +q8 ; bit==0 -> -q8  (binary, never zero).\r
//   3. accumulate sign-selected int8 in i32 FIRST, then * d1(per-32), sum, then * d0(per-128).\r
//\r
// Buffers:\r
//   weights  : array<u32> \u2014 Q1_0, 5 words/block (word0 low16 = f16 d0, bytes2..17 = signs)\r
//   act_d    : array<u32> \u2014 per-32 f16 activation scales d1 (low 16 bits), one per q8 block\r
//   act_qs   : array<u32> \u2014 per-32 int8 activations, 8 words/block (4 int8 per word)\r
//   out      : array<f32> \u2014 [n_rows * n_cols] output features\r
//   dims     : uniform {K, n_cols, n_rows, col_tiles}  col_tiles = ceil(n_cols/64)\r
//\r
// Dispatch: n_rows * col_tiles workgroups of 64 threads. workgroup wg -> row = wg/col_tiles,\r
// col = (wg%col_tiles)*64 + local. A workgroup NEVER straddles two rows, so the staged\r
// activation is unambiguous.\r
\r
const QK1_0 : u32 = 128u;\r
const WORDS_PER_Q1 : u32 = 5u; // 20-byte GPU block (18 used + 2 pad) \u2014 matches upload.ts repack\r
const WORDS_PER_Q8 : u32 = 8u;\r
const TILE_Q1 : u32 = 32u;     // Q1_0 blocks per K-tile (32*128 = 4096 K elements)\r
\r
struct Dims { K : u32, n_cols : u32, n_rows : u32, col_tiles : u32 };\r
\r
@group(0) @binding(0) var<storage, read> weights : array<u32>;\r
@group(0) @binding(1) var<storage, read> act_d   : array<u32>;\r
@group(0) @binding(2) var<storage, read> act_qs  : array<u32>;\r
@group(0) @binding(3) var<storage, read_write> out : array<f32>;\r
@group(0) @binding(4) var<uniform> dims : Dims;\r
\r
// Staged activation for the current K-tile (shared across all 64 cols of this workgroup's\r
// row). TILE_Q1 q1-blocks -> TILE_Q1*4 q8-blocks: scales + 8 words each.\r
var<workgroup> sh_d  : array<u32, 128>;   // TILE_Q1 * 4\r
var<workgroup> sh_qs : array<u32, 1024>;  // TILE_Q1 * 4 * 8\r
\r
fn q1_byte(block_base: u32, byte_index: u32) -> u32 {\r
  let word = weights[block_base + (byte_index >> 2u)];\r
  return (word >> ((byte_index & 3u) * 8u)) & 0xffu;\r
}\r
\r
fn sext8(b: u32) -> i32 {\r
  return (i32(b) ^ 0x80) - 0x80;\r
}\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(local_invocation_id) lid : vec3<u32>,\r
        @builtin(workgroup_id) wid : vec3<u32>,\r
        @builtin(num_workgroups) nwg : vec3<u32>) {\r
  let local = lid.x;                 // 0..63\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let wg = wid.x + wid.y * nwg.x;\r
  let row   = wg / dims.col_tiles;   // uniform across the workgroup\r
  if (row >= dims.n_rows) { return; } // uniform: whole workgroup returns or none\r
  let col = (wg % dims.col_tiles) * 64u + local;\r
  let valid = col < dims.n_cols;\r
\r
  let n_q1 = dims.K / QK1_0;\r
  let a_row_q8_base = row * (dims.K / 32u);\r
\r
  var result : f32 = 0.0;\r
\r
  var c0 : u32 = 0u;\r
  loop {\r
    if (c0 >= n_q1) { break; }\r
    let cn = min(TILE_Q1, n_q1 - c0);   // q1-blocks in this tile (uniform)\r
    let n_q8 = cn * 4u;                  // q8-blocks in this tile\r
    let q8_base = a_row_q8_base + c0 * 4u;\r
\r
    // Cooperative, coalesced load of this tile's activation into shared (all 64 threads).\r
    var t : u32 = local;\r
    loop { if (t >= n_q8) { break; } sh_d[t] = act_d[q8_base + t]; t = t + 64u; }\r
    t = local;\r
    loop { if (t >= n_q8 * WORDS_PER_Q8) { break; } sh_qs[t] = act_qs[q8_base * WORDS_PER_Q8 + t]; t = t + 64u; }\r
    workgroupBarrier();\r
\r
    if (valid) {\r
      var il : u32 = 0u;\r
      loop {\r
        if (il >= cn) { break; }\r
        let i  = c0 + il;\r
        let wb = (col * n_q1 + i) * WORDS_PER_Q1;\r
        let d0 = unpack2x16float(weights[wb] & 0xffffu).x;   // per-128 weight scale\r
\r
        var block_sum : f32 = 0.0;\r
        for (var k : u32 = 0u; k < 4u; k = k + 1u) {\r
          let qb    = il * 4u + k;                              // shared q8-block index\r
          let d1    = unpack2x16float(sh_d[qb] & 0xffffu).x;    // per-32 activation scale\r
          let qs_sh = qb * WORDS_PER_Q8;\r
\r
          // Hoist the 4 sign bytes for this 32-weight sub-block out of the lane loop.\r
          // The old q1_byte(wb, 2 + (j>>3)) was a GLOBAL weight read PER LANE \u2014 32 reads\r
          // that hit only 2 distinct words, re-fetched ~16x each. Weight bandwidth is the\r
          // decode bottleneck, so this ~8x cut on the hot path matters. Bytes 2+k*4 .. +3.\r
          let sbb  = 2u + k * 4u;\r
          let sb0  = q1_byte(wb, sbb);\r
          let sb1  = q1_byte(wb, sbb + 1u);\r
          let sb2  = q1_byte(wb, sbb + 2u);\r
          let sb3  = q1_byte(wb, sbb + 3u);\r
\r
          var acc : i32 = 0;                                    // INTEGER accumulation (order-free)\r
          // Process the 32 activations as 8 words \xD7 4 int8s; sign byte = w>>1, bit = (w&1)*4+m.\r
          for (var wi : u32 = 0u; wi < 8u; wi = wi + 1u) {\r
            let aword = sh_qs[qs_sh + wi];                      // int8s from shared (one read/4 lanes)\r
            var sbyte = sb0;\r
            if (wi >= 6u) { sbyte = sb3; } else if (wi >= 4u) { sbyte = sb2; } else if (wi >= 2u) { sbyte = sb1; }\r
            let bitbase = (wi & 1u) * 4u;\r
            for (var m : u32 = 0u; m < 4u; m = m + 1u) {\r
              let bit = (sbyte >> (bitbase + m)) & 1u;\r
              let q8  = sext8((aword >> (m * 8u)) & 0xffu);\r
              acc = acc + select(-q8, q8, bit == 1u);\r
            }\r
          }\r
          block_sum = block_sum + d1 * f32(acc);               // * per-32 scale (k order)\r
        }\r
        result = result + d0 * block_sum;                      // * per-128 scale (i order)\r
        il = il + 1u;\r
      }\r
    }\r
    workgroupBarrier();                 // all threads done reading shared before next tile overwrites\r
    c0 = c0 + TILE_Q1;\r
  }\r
\r
  if (valid) { out[row * dims.n_cols + col] = result; }\r
}\r
`,Ou=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - Q2_0 dequant ................... ggml/src/ggml-quants.c ~450 (QK2_0=128)\r
//\r
// Standalone Q2_0 dequant for verification (Milestone 2 round-trip) and any non-hot-path\r
// wholesale dequant of small tensors. Contract (matches reference.ts dequantQ2Block):\r
//   block = { f16 d ; u8 qs[32] } = 34 bytes, 128 weights.\r
//   2-bit order LSB-first: weight j uses byte qs[j>>2], bits at ((j&3)<<1).\r
//   bit pattern (00,01,10,11) -> (\u22121,0,+1,+2) -> (\u2212d,0,+d,+2d) via formula: (q\u22121)\xB7d.\r
//\r
// Input packing: each 34-byte block is laid out as 9 u32 (padded) \u2014 word0 low16 = f16 d,\r
// bytes 2..33 = the 32 packed 2-bit bytes. We pass blocks as array<u32> with 9 words per block\r
// (last word partially used) to stay 4-byte aligned. One thread per 128-weight block.\r
\r
const QK2_0 : u32 = 128u;\r
const WORDS_PER_BLOCK : u32 = 9u;   // 36 bytes reserved per block (34 used + 2 pad)\r
\r
@group(0) @binding(0) var<storage, read>       blocks : array<u32>;   // n_blocks * 9\r
@group(0) @binding(1) var<storage, read_write> out_w  : array<f32>;   // n_blocks * 128\r
@group(0) @binding(2) var<uniform>             n_blocks : u32;\r
\r
fn byte_at(block_base: u32, byte_index: u32) -> u32 {\r
  // byte_index is 0..33 within the block; word = byte_index/4, shift = (byte_index%4)*8\r
  let word = blocks[block_base + (byte_index >> 2u)];\r
  let sh   = (byte_index & 3u) * 8u;\r
  return (word >> sh) & 0xffu;\r
}\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let block = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\r
  if (block >= n_blocks) { return; }\r
  let bb = block * WORDS_PER_BLOCK;\r
\r
  // f16 d in the low 16 bits of word 0\r
  let d = unpack2x16float(blocks[bb] & 0xffffu).x;\r
\r
  let out_base = block * QK2_0;\r
  for (var j : u32 = 0u; j < QK2_0; j = j + 1u) {\r
    // 2-bit bytes start at byte offset 2 within the block; 4 values per byte\r
    let byte_index = 2u + (j >> 2u);\r
    let byte = byte_at(bb, byte_index);\r
    // LSB-first: 2 bits at offset ((j & 3) << 1)\r
    let bit_offset = (j & 3u) << 1u;\r
    let q = (byte >> bit_offset) & 3u;\r
    // Dequant formula: (q - 1) * d; q \u2208 {0,1,2,3} -> {-1,0,1,2} * d\r
    out_w[out_base + j] = f32(i32(q) - 1) * d;\r
  }\r
}\r
`,$u=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - q2_0\xB7q8_0 dot .................. ggml/src/ggml-cpu/quants.c (ggml_vec_dot_q2_0_q8_0)\r
//   - Q2_0 block layout .............. ggml/src/ggml-common.h (QK2_0=128, block_q2_0)\r
//\r
// THE core Q2_0 kernel \u2014 reproduces ggml_vec_dot_q2_0_q8_0 EXACTLY. 2-bit dequant,\r
// two-level scaling, integer accumulation. K-TILED with the activation row staged in\r
// workgroup shared memory: one workgroup owns 64 output cols of ONE row, so the row's\r
// activation is loaded once per K-tile and reused across all 64 cols (a 64x cut in\r
// activation global-memory traffic vs the scalar one-thread-per-element version). Weights\r
// are streamed per-col from global (sequential within a col = cache-friendly).\r
//\r
// NUMERICS ARE BIT-IDENTICAL to the scalar kernel: the f32 accumulation ORDER is preserved\r
// (blocks i ascending, sub-blocks k ascending; the 32-lane acc is INTEGER so order-free).\r
// Only memory traffic and the workgroup->(row,col) mapping changed.\r
//\r
// NON-NEGOTIABLE (verification checklist):\r
//   1. 2-bit order LSB-first: weight j uses qs[j>>2], bits at ((j&3)<<1).\r
//   2. bit pattern (00,01,10,11) -> (-1,0,+1,+2) via formula (q-1).\r
//   3. accumulate (q2bit[lane] - 1) * q8[lane] in i32 FIRST, then * d1(per-32), sum, then * d0(per-128).\r
//\r
// Buffers:\r
//   weights  : array<u32> \u2014 Q2_0, 9 words/block (word0 low16 = f16 d0, bytes2..33 = 2-bit qs)\r
//   act_d    : array<u32> \u2014 per-32 f16 activation scales d1 (low 16 bits), one per q8 block\r
//   act_qs   : array<u32> \u2014 per-32 int8 activations, 8 words/block (4 int8 per word)\r
//   out      : array<f32> \u2014 [n_rows * n_cols] output features\r
//   dims     : uniform {K, n_cols, n_rows, col_tiles}  col_tiles = ceil(n_cols/64)\r
//\r
// Dispatch: n_rows * col_tiles workgroups of 64 threads. workgroup wg -> row = wg/col_tiles,\r
// col = (wg%col_tiles)*64 + local. A workgroup NEVER straddles two rows, so the staged\r
// activation is unambiguous.\r
\r
const QK2_0 : u32 = 128u;\r
const WORDS_PER_Q2 : u32 = 9u; // 36-byte GPU block (34 used + 2 pad) \u2014 matches upload.ts repack\r
const WORDS_PER_Q8 : u32 = 8u;\r
const TILE_Q2 : u32 = 32u;     // Q2_0 blocks per K-tile (32*128 = 4096 K elements)\r
\r
struct Dims { K : u32, n_cols : u32, n_rows : u32, col_tiles : u32 };\r
\r
@group(0) @binding(0) var<storage, read> weights : array<u32>;\r
@group(0) @binding(1) var<storage, read> act_d   : array<u32>;\r
@group(0) @binding(2) var<storage, read> act_qs  : array<u32>;\r
@group(0) @binding(3) var<storage, read_write> out : array<f32>;\r
@group(0) @binding(4) var<uniform> dims : Dims;\r
\r
// Staged activation for the current K-tile (shared across all 64 cols of this workgroup's\r
// row). TILE_Q2 q2-blocks -> TILE_Q2*4 q8-blocks: scales + 8 words each.\r
var<workgroup> sh_d  : array<u32, 128>;   // TILE_Q2 * 4\r
var<workgroup> sh_qs : array<u32, 1024>;  // TILE_Q2 * 4 * 8\r
\r
fn q2_byte(block_base: u32, byte_index: u32) -> u32 {\r
  let word = weights[block_base + (byte_index >> 2u)];\r
  return (word >> ((byte_index & 3u) * 8u)) & 0xffu;\r
}\r
\r
fn sext8(b: u32) -> i32 {\r
  return (i32(b) ^ 0x80) - 0x80;\r
}\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(local_invocation_id) lid : vec3<u32>,\r
        @builtin(workgroup_id) wid : vec3<u32>,\r
        @builtin(num_workgroups) nwg : vec3<u32>) {\r
  let local = lid.x;                 // 0..63\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let wg = wid.x + wid.y * nwg.x;\r
  let row   = wg / dims.col_tiles;   // uniform across the workgroup\r
  if (row >= dims.n_rows) { return; } // uniform: whole workgroup returns or none\r
  let col = (wg % dims.col_tiles) * 64u + local;\r
  let valid = col < dims.n_cols;\r
\r
  let n_q2 = dims.K / QK2_0;\r
  let a_row_q8_base = row * (dims.K / 32u);\r
\r
  var result : f32 = 0.0;\r
\r
  var c0 : u32 = 0u;\r
  loop {\r
    if (c0 >= n_q2) { break; }\r
    let cn = min(TILE_Q2, n_q2 - c0);   // q2-blocks in this tile (uniform)\r
    let n_q8 = cn * 4u;                  // q8-blocks in this tile\r
    let q8_base = a_row_q8_base + c0 * 4u;\r
\r
    // Cooperative, coalesced load of this tile's activation into shared (all 64 threads).\r
    var t : u32 = local;\r
    loop { if (t >= n_q8) { break; } sh_d[t] = act_d[q8_base + t]; t = t + 64u; }\r
    t = local;\r
    loop { if (t >= n_q8 * WORDS_PER_Q8) { break; } sh_qs[t] = act_qs[q8_base * WORDS_PER_Q8 + t]; t = t + 64u; }\r
    workgroupBarrier();\r
\r
    if (valid) {\r
      var il : u32 = 0u;\r
      loop {\r
        if (il >= cn) { break; }\r
        let i  = c0 + il;\r
        let wb = (col * n_q2 + i) * WORDS_PER_Q2;\r
        let d0 = unpack2x16float(weights[wb] & 0xffffu).x;   // per-128 weight scale\r
\r
        var block_sum : f32 = 0.0;\r
        for (var k : u32 = 0u; k < 4u; k = k + 1u) {\r
          let qb    = il * 4u + k;                              // shared q8-block index\r
          let d1    = unpack2x16float(sh_d[qb] & 0xffffu).x;    // per-32 activation scale\r
          let qs_sh = qb * WORDS_PER_Q8;\r
\r
          // Q2_0 packing: 32 weights in 8 bytes (4 weights per byte, 2 bits each).\r
          // Hoist the 8 packed bytes for this 32-weight sub-block to avoid per-lane reads.\r
          // Bytes 2 + k*8 .. +7 (8 bytes per 32-lane sub-block, LSB-first 2-bit order).\r
          let sbb  = 2u + k * 8u;\r
          let sb0  = q2_byte(wb, sbb);\r
          let sb1  = q2_byte(wb, sbb + 1u);\r
          let sb2  = q2_byte(wb, sbb + 2u);\r
          let sb3  = q2_byte(wb, sbb + 3u);\r
          let sb4  = q2_byte(wb, sbb + 4u);\r
          let sb5  = q2_byte(wb, sbb + 5u);\r
          let sb6  = q2_byte(wb, sbb + 6u);\r
          let sb7  = q2_byte(wb, sbb + 7u);\r
\r
          var acc : i32 = 0;                                    // INTEGER accumulation (order-free)\r
          // Process the 32 activations as 8 words \xD7 4 int8s. Each lane j within the 32 spans\r
          // 2 bits at byte (j>>2), offset ((j&3)<<1).\r
          for (var wi : u32 = 0u; wi < 8u; wi = wi + 1u) {\r
            let aword = sh_qs[qs_sh + wi];                      // int8s from shared (one read/4 lanes)\r
            var sbyte = sb0;\r
            if (wi == 1u) { sbyte = sb1; }\r
            else if (wi == 2u) { sbyte = sb2; }\r
            else if (wi == 3u) { sbyte = sb3; }\r
            else if (wi == 4u) { sbyte = sb4; }\r
            else if (wi == 5u) { sbyte = sb5; }\r
            else if (wi == 6u) { sbyte = sb6; }\r
            else if (wi == 7u) { sbyte = sb7; }\r
            // Extract 4 2-bit values from sbyte and their paired q8 activations.\r
            for (var m : u32 = 0u; m < 4u; m = m + 1u) {\r
              let bit_offset = m << 1u;  // 2 bits at ((m & 3) << 1)\r
              let q2 = (sbyte >> bit_offset) & 3u;  // extract 2-bit value\r
              let q8 = sext8((aword >> (m * 8u)) & 0xffu);\r
              acc = acc + (i32(q2) - 1) * q8;  // formula: (q - 1) * a8\r
            }\r
          }\r
          block_sum = block_sum + d1 * f32(acc);               // * per-32 scale (k order)\r
        }\r
        result = result + d0 * block_sum;                      // * per-128 scale (i order)\r
        il = il + 1u;\r
      }\r
    }\r
    workgroupBarrier();                 // all threads done reading shared before next tile overwrites\r
    c0 = c0 + TILE_Q2;\r
  }\r
\r
  if (valid) { out[row * dims.n_cols + col] = result; }\r
}\r
`,Iu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - Q8_0 quant ..................... ggml/src/ggml-quants.c (quantize_row_q8_0, QK8_0=32)\r
//\r
// Activation quantizer. One workgroup per 32-element block. Contract (matches\r
// reference.ts quantizeQ8Block):  d = max(|x|)/127 ;  qs[j] = round(x[j]/d) clamped\r
// [-127,127] ;  d==0 -> qs=0.  d is emitted as f16 bits so the matmul reads exactly the\r
// value the CPU reference rounds to.\r
//\r
// Output layout per block (kept 4-byte aligned): one u32 for the f16 d (low 16 bits),\r
// then 8 u32 packing the 32 signed int8 qs (4 per u32, little-endian byte order).\r
\r
const QK8_0 : u32 = 32u;\r
\r
@group(0) @binding(0) var<storage, read>        activations : array<f32>;   // n_blocks * 32\r
@group(0) @binding(1) var<storage, read_write>  out_d       : array<u32>;    // n_blocks (f16 in low 16)\r
@group(0) @binding(2) var<storage, read_write>  out_qs      : array<u32>;    // n_blocks * 8\r
\r
var<workgroup> shared_amax : array<f32, 32>;\r
// Quantized int8 values are exchanged as INTEGERS (low 8 bits used). They must NOT be\r
// round-tripped through f32 workgroup memory: a negative int8's bit pattern is a NaN as\r
// f32, and the GPU canonicalizes NaN on store/load, corrupting every negative activation\r
// to 0x7FC00000 (\u22482.1e9) \u2014 which then blows the matmul up ~160,000\xD7. Use a u32 scratch.\r
var<workgroup> shared_q : array<u32, 32>;\r
\r
@compute @workgroup_size(32)\r
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,\r
        @builtin(num_workgroups) nwg : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let block = wg.x + wg.y * nwg.x;\r
  let lane  = lid.x;\r
  let base  = block * QK8_0;\r
\r
  // per-lane load + abs\r
  let x = activations[base + lane];\r
  shared_amax[lane] = abs(x);\r
  workgroupBarrier();\r
\r
  // tree reduce max-abs across 32 lanes\r
  var stride : u32 = 16u;\r
  loop {\r
    if (stride == 0u) { break; }\r
    if (lane < stride) {\r
      shared_amax[lane] = max(shared_amax[lane], shared_amax[lane + stride]);\r
    }\r
    workgroupBarrier();\r
    stride = stride >> 1u;\r
  }\r
\r
  let amax = shared_amax[0];\r
  // round d through f16 exactly (pack/unpack) so quantization uses the stored scale\r
  let d_f16 = pack2x16float(vec2<f32>(amax / 127.0, 0.0)) & 0xffffu;\r
  let d     = unpack2x16float(d_f16).x;\r
  let id    = select(0.0, 1.0 / d, d != 0.0);\r
\r
  // quantize this lane's value; keep the low 8 bits (two's-complement int8) in a u32\r
  var q : i32 = i32(round(x * id));\r
  q = clamp(q, -127, 127);\r
\r
  // Exchange the 32 quantized bytes via the INTEGER scratch (no f32/NaN round-trip).\r
  shared_q[lane] = u32(q) & 0xffu;\r
  workgroupBarrier();\r
\r
  if (lane == 0u) {\r
    out_d[block] = d_f16;\r
    for (var w : u32 = 0u; w < 8u; w = w + 1u) {\r
      let o = w * 4u;\r
      out_qs[block * 8u + w] =\r
          shared_q[o + 0u]\r
        | (shared_q[o + 1u] << 8u)\r
        | (shared_q[o + 2u] << 16u)\r
        | (shared_q[o + 3u] << 24u);\r
    }\r
  }\r
}\r
`,Gu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - RMSNorm ........................ y = x / sqrt(mean(x^2)+eps) * w ; eps from GGUF KV\r
//\r
// One workgroup per row; two-pass reduce (sum of squares -> normalize). f32 accumulation\r
// regardless of f16 storage. Matches reference.ts rmsnorm.\r
\r
struct Params { n : u32, eps : f32, _p0 : u32, _p1 : u32 };\r
\r
@group(0) @binding(0) var<storage, read>       x      : array<f32>;   // n_rows * n\r
@group(0) @binding(1) var<storage, read>       weight : array<f32>;   // n\r
@group(0) @binding(2) var<storage, read_write> y      : array<f32>;   // n_rows * n\r
@group(0) @binding(3) var<uniform>             params : Params;\r
\r
const WG : u32 = 256u;\r
var<workgroup> partial : array<f32, WG>;\r
\r
@compute @workgroup_size(WG)\r
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,\r
        @builtin(num_workgroups) nwg : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let row = wg.x + wg.y * nwg.x;\r
  let n    = params.n;\r
  let base = row * n;\r
  let tid  = lid.x;\r
\r
  var ss : f32 = 0.0;\r
  var i : u32 = tid;\r
  loop {\r
    if (i >= n) { break; }\r
    let v = x[base + i];\r
    ss = ss + v * v;\r
    i = i + WG;\r
  }\r
  partial[tid] = ss;\r
  workgroupBarrier();\r
\r
  var stride : u32 = WG >> 1u;\r
  loop {\r
    if (stride == 0u) { break; }\r
    if (tid < stride) { partial[tid] = partial[tid] + partial[tid + stride]; }\r
    workgroupBarrier();\r
    stride = stride >> 1u;\r
  }\r
\r
  let mean = partial[0] / f32(n);\r
  let scale = inverseSqrt(mean + params.eps);\r
\r
  var o : u32 = tid;\r
  loop {\r
    if (o >= n) { break; }\r
    y[base + o] = x[base + o] * scale * weight[o];\r
    o = o + WG;\r
  }\r
}\r
`,Nu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - IMROPE ......................... src/llama-model.cpp:2494-2496 (interleaved, NOT NEOX)\r
//\r
// Interleaved multimodal RoPE. "Interleaved" = the t/h/w SECTION cycling per pair\r
// (all equal for text), NOT component pairing. Pairing is NEOX-style (p, p+rot/2) \u2014\r
// ggml routes GGML_ROPE_TYPE_IMROPE through rotate_pairs(n_dims, n_dims/2).\r
// theta_base from qwen35.rope.freq_base,\r
// rotary width from qwen35.rope.dimension_count. Applied to Q and K after projection,\r
// before attention.  NOTE (\xA78 risk #5): the interleaved index mapping is a common port\r
// bug \u2014 the golden-vector test (Milestone 4) pins this against a fork-derived reference.\r
//\r
// Pairing used here (fork-verified 2026-07-22): pair p touches components\r
// (p, p+rot/2). The freq for pair p is theta = pos * freq_base^(-2p/rot).\r
\r
struct RopeP {\r
  n_heads   : u32,\r
  head_dim  : u32,\r
  rot_dim   : u32,   // rope.dimension_count (<= head_dim)\r
  pos_base  : u32,   // position of the first token in this batch\r
  freq_base : f32,\r
  scale     : f32,   // linear rope scaling factor (1.0 = none)\r
  _p0 : u32, _p1 : u32,\r
};\r
\r
@group(0) @binding(0) var<storage, read_write> data : array<f32>;   // [n_tokens * n_heads * head_dim]\r
@group(0) @binding(1) var<uniform>             p    : RopeP;\r
\r
@compute @workgroup_size(64)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // one thread per (token, head, pair)\r
  let pairs_per_head = p.rot_dim / 2u;\r
  let per_token = p.n_heads * pairs_per_head;\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let idx = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;\r
\r
  let token = idx / per_token;\r
  let rem   = idx % per_token;\r
  let head  = rem / pairs_per_head;\r
  let pair  = rem % pairs_per_head;\r
\r
  let head_base = (token * p.n_heads + head) * p.head_dim;\r
  // NEOX-style pairing (p, p + rot/2): ggml routes GGML_ROPE_TYPE_IMROPE through\r
  // rotate_pairs(n_dims, n_dims/2) \u2014 the "interleaved" in IMROPE is the t/h/w SECTION\r
  // cycling, NOT component pairing. For text all sections carry the same position\r
  // (e-stream unused: sections [11,11,10,0] cover all 32 pairs), so pairing is the\r
  // ONLY layout difference. The old (2p, 2p+1) pairing scrambled positional phase.\r
  let i0 = head_base + pair;            // (p, p + rot/2)\r
  let i1 = i0 + pairs_per_head;\r
\r
  let pos   = f32(p.pos_base + token) * p.scale;\r
  let exponent = -2.0 * f32(pair) / f32(p.rot_dim);\r
  let theta = pos * pow(p.freq_base, exponent);\r
  let c = cos(theta);\r
  let s = sin(theta);\r
\r
  let x0 = data[i0];\r
  let x1 = data[i1];\r
  data[i0] = x0 * c - x1 * s;\r
  data[i1] = x0 * s + x1 * c;\r
}\r
`,Ru=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - temperature / top-k / top-p sampling (card defaults temp 0.7, top-k 20, top-p 0.95)\r
//\r
// v1 strategy: this kernel computes the argmax fast path (temp ~ 0) and a temperature-\r
// scaled max for numerical stability; full top-k/top-p nucleus truncation is done on the\r
// host over the reduced candidate set for v1 (simpler + exact), with a GPU bitonic top-k\r
// as the follow-up optimisation. Runs over the final logits row (~151K vocab).\r
\r
struct SampleP { vocab : u32, temperature : f32, _p0 : u32, _p1 : u32 };\r
\r
@group(0) @binding(0) var<storage, read>       logits  : array<f32>;   // [vocab]\r
@group(0) @binding(1) var<storage, read_write> argmax  : array<u32>;   // [1] best token id\r
@group(0) @binding(2) var<storage, read_write> maxval  : array<f32>;   // [1] max logit\r
@group(0) @binding(3) var<uniform>             p       : SampleP;\r
\r
const WG : u32 = 256u;\r
var<workgroup> best_val : array<f32, WG>;\r
var<workgroup> best_idx : array<u32, WG>;\r
\r
@compute @workgroup_size(WG)\r
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {\r
  let tid = lid.x;\r
  var bv : f32 = -3.0e38;\r
  var bi : u32 = 0u;\r
  var i : u32 = tid;\r
  loop {\r
    if (i >= p.vocab) { break; }\r
    let l = logits[i];\r
    if (l > bv) { bv = l; bi = i; }\r
    i = i + WG;\r
  }\r
  best_val[tid] = bv;\r
  best_idx[tid] = bi;\r
  workgroupBarrier();\r
\r
  var stride : u32 = WG >> 1u;\r
  loop {\r
    if (stride == 0u) { break; }\r
    if (tid < stride) {\r
      if (best_val[tid + stride] > best_val[tid]) {\r
        best_val[tid] = best_val[tid + stride];\r
        best_idx[tid] = best_idx[tid + stride];\r
      }\r
    }\r
    workgroupBarrier();\r
    stride = stride >> 1u;\r
  }\r
\r
  if (tid == 0u) {\r
    argmax[0] = best_idx[0];\r
    maxval[0] = best_val[0];\r
  }\r
}\r
`,Cu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - scaled-dot-product attention with causal mask + GQA (head_count / head_count_kv).\r
//\r
// Full-attention layers (16 of 64). Online (flash-style) softmax to bound memory over\r
// long context. One workgroup per (query token, query head). K/V read from the 4-bit KV\r
// cache and dequantized inline (see kvcache.ts / elementwise KV unpack helpers).\r
// v1: f32 K/V input path (dequant done host/pre-pass); 4-bit inline unpack is a follow-up.\r
\r
struct AttnP {\r
  head_dim   : u32,\r
  n_kv       : u32,   // number of cached keys (context length so far)\r
  q_head     : u32,   // this query head index\r
  kv_head    : u32,   // mapped KV head (GQA: q_head / (n_head/n_head_kv))\r
  scale      : f32,   // 1/sqrt(head_dim)\r
  _p0 : u32, _p1 : u32, _p2 : u32,\r
};\r
\r
@group(0) @binding(0) var<storage, read>       q  : array<f32>;   // [head_dim] for this query\r
@group(0) @binding(1) var<storage, read>       k  : array<f32>;   // [n_kv * head_dim]\r
@group(0) @binding(2) var<storage, read>       v  : array<f32>;   // [n_kv * head_dim]\r
@group(0) @binding(3) var<storage, read_write> out : array<f32>;  // [head_dim]\r
@group(0) @binding(4) var<uniform>             p   : AttnP;\r
\r
@compute @workgroup_size(1)\r
fn main() {\r
  let hd = p.head_dim;\r
\r
  // online softmax accumulators\r
  var m : f32 = -3.0e38;             // running max\r
  var l : f32 = 0.0;                 // running denom\r
  var acc : array<f32, 256>;         // running weighted V (head_dim <= 256)\r
  for (var d : u32 = 0u; d < hd; d = d + 1u) { acc[d] = 0.0; }\r
\r
  for (var t : u32 = 0u; t < p.n_kv; t = t + 1u) {\r
    // score = scale * dot(q, k_t)\r
    var s : f32 = 0.0;\r
    let kb = t * hd;\r
    for (var d : u32 = 0u; d < hd; d = d + 1u) { s = s + q[d] * k[kb + d]; }\r
    s = s * p.scale;\r
\r
    let m_new = max(m, s);\r
    let correction = exp(m - m_new);\r
    let w = exp(s - m_new);\r
    l = l * correction + w;\r
    let vb = t * hd;\r
    for (var d : u32 = 0u; d < hd; d = d + 1u) {\r
      acc[d] = acc[d] * correction + w * v[vb + d];\r
    }\r
    m = m_new;\r
  }\r
\r
  let inv = select(0.0, 1.0 / l, l > 0.0);\r
  for (var d : u32 = 0u; d < hd; d = d + 1u) { out[d] = acc[d] * inv; }\r
}\r
`,Du=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
//
// Batched causal GQA softmax attention \u2014 the WHOLE (token \xD7 head) grid in ONE dispatch,
// reading Q/K/V straight from the resident buffers. Replaces the per-(token,head) host loop
// that submitted ~n_tokens\xB7n_heads\xB73 GPU commands per layer (the dominant prefill cost).
// One WORKGROUP per (query token, query head); online (flash-style) softmax over the causal
// key range. GQA maps each query head to kv_head = q_head / (n_heads / n_heads_kv).
//
//   q       : [n_tokens \xB7 n_heads   \xB7 head_dim]   (this batch's queries, post-RoPE)
//   k_cache : [kv_len   \xB7 n_heads_kv \xB7 head_dim]  (all keys so far, incl. this batch)
//   v_cache : [kv_len   \xB7 n_heads_kv \xB7 head_dim]
//   out     : [n_tokens \xB7 n_heads   \xB7 head_dim]
// Causal: query at absolute position (pos_base + t) attends to cache positions [0, pos_base+t].
//
// \u2500\u2500 WHY THIS IS PARALLEL OVER head_dim (measured 2026-07-31) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// This kernel was \`@workgroup_size(1)\`: ONE GPU thread per (token, head), walking the entire
// KV cache serially and reading head_dim floats one at a time. For a DECODE step n_tokens is
// 1, so the whole dispatch was n_heads threads \u2014 32 of a 5090's 21,760 lanes \u2014 each doing
// kv_len\xB7head_dim\xB72 serial scalar ops, per layer, per token. Cost was therefore LINEAR in
// context length with a ~1-lane constant, and every read was strided by head_dim (one lane
// touching a whole cache line and using 4 bytes of it).
//
// That is invisible until the prompt grows. Measured on Bonsai-4B, same box, same session:
//
//     prompt tokens   forward/token   tok/s
//     20              111 ms          7.6
//     169             ~128 ms         7.8
//     1285            646 ms          1.0        <- the shipped greeter prompt
//
// The greeter sends its framing plus getToolDefinitions() \u2014 1290 tokens \u2014 so aitherium.com
// visitors were getting ~1 tok/s while the microbenchmark (a 20-token prompt) reported 7.6
// and the engine was blamed. NOTHING regressed in this file; the prompt crossed the point
// where an O(kv_len) single-lane loop dominates the 545 MB of weight matmuls around it.
//
// So: one workgroup per (token, head), WG threads cooperating over head_dim.
//   - thread \`tid\` owns dims {tid, tid+WG, \u2026}, keeping q and the output accumulator in
//     REGISTERS (never workgroup storage \u2014 head_dim\xB7WG floats would blow the 16 KB
//     guaranteed workgroup-storage limit; only the WG-float reduction scratch lives there).
//   - at each position the q\xB7k dot product is a tree reduction across the workgroup, so
//     adjacent threads read ADJACENT k_cache/v_cache elements \u2014 coalesced, one cache line
//     serving the whole warp instead of one lane.
// The position loop stays serial and in the same order, which is what keeps the online
// softmax exact; only the dot product's summation order changes (sequential -> tree), and a
// tree reduction is no less accurate than the sequential sum it replaces. Correctness is
// gated by the whole-model GPU-vs-CPU differential in selftest/, which requires argmax
// agreement \u2014 an attention bug corrupts every downstream logit and shows up there.

struct BAttnP {
  n_tokens   : u32,
  n_heads    : u32,
  n_heads_kv : u32,
  head_dim   : u32,
  pos_base   : u32,   // absolute position of this batch's first token
  scale      : f32,   // 1/sqrt(head_dim)
  mode : u32, _p1 : u32,   // mode: 0 = f32 cache (default), 1 = 4-bit packed cache
};

@group(0) @binding(0) var<storage, read>       q          : array<f32>;
@group(0) @binding(1) var<storage, read>       k_cache    : array<u32>;
@group(0) @binding(2) var<storage, read>       v_cache    : array<u32>;
@group(0) @binding(3) var<storage, read_write> out        : array<f32>;
@group(0) @binding(4) var<uniform>             p          : BAttnP;
// 4-bit mode only (mode==1): per-(pos,kv_head) f16 scales, one u32 per row (f16 in low 16
// bits). In f32 mode these are 4-byte DUMMY buffers, always bound but NEVER indexed \u2014 the
// uniform \`if (p.mode == 1u)\` guard is what keeps them unread, because \`select()\` would
// evaluate both operands and index them OOB at large positions.
@group(0) @binding(5) var<storage, read> k_scale_buf : array<u32>;
@group(0) @binding(6) var<storage, read> v_scale_buf : array<u32>;

// 4-bit dequant read. mode==1: element e (row-aligned, head_dim%8==0 asserted on the host)
// is a NIBBLE: word e>>3, nibble e&7, value (raw-8)*scale. mode==0: the buffer holds raw
// f32 bytes and bitcast reinterprets them \u2014 byte-identical to the historical array<f32>
// binding. The scale is passed in, never re-fetched here.
fn readK(mode : u32, e : u32, scale : f32) -> f32 {
  if (mode == 1u) {
    let w = e >> 3u;
    let n = e & 7u;
    let raw = (k_cache[w] >> (n * 4u)) & 0xFu;
    return (f32(raw) - 8.0) * scale;
  }
  return bitcast<f32>(k_cache[e]);
}
fn readV(mode : u32, e : u32, scale : f32) -> f32 {
  if (mode == 1u) {
    let w = e >> 3u;
    let n = e & 7u;
    let raw = (v_cache[w] >> (n * 4u)) & 0xFu;
    return (f32(raw) - 8.0) * scale;
  }
  return bitcast<f32>(v_cache[e]);
}

// 128 lanes: WebGPU GUARANTEES maxComputeInvocationsPerWorkgroup >= 256 and
// maxComputeWorkgroupSizeX >= 256, so this is portable, and it equals head_dim on every
// Bonsai size (1.7B/4B/8B/27B all use 128) \u2014 i.e. exactly one dim per lane, no tail.
const WG : u32 = 128u;
// head_dim <= 256 (asserted by the host), so at most 2 dims per lane.
const DPT : u32 = 2u;

// Reduction scratch: WG floats = 512 bytes, far under the 16 KB guaranteed limit.
var<workgroup> red : array<f32, 128>;

@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to
  // wg_.x. The index is now the WORKGROUP's, not the invocation's: the whole workgroup
  // cooperates on one (token, head).
  let idx = wg_.x + wg_.y * nwg_.x;
  let total = p.n_tokens * p.n_heads;
  // UNIFORM across the workgroup (it depends only on workgroup_id), so returning here before
  // the barriers below is legal \u2014 a non-uniform early return would be undefined behaviour.
  if (idx >= total) { return; }

  let tid = lid_.x;
  let hd  = p.head_dim;
  let t   = idx / p.n_heads;         // query token in this batch
  let h   = idx % p.n_heads;         // query head
  let kv_head = h / (p.n_heads / p.n_heads_kv);

  let q_base = (t * p.n_heads + h) * hd;
  let kv_per_pos = p.n_heads_kv * hd;
  let last = p.pos_base + t;         // inclusive causal limit

  // This lane's slice of q and of the output accumulator, held in registers.
  var qv  : array<f32, 2>;
  var acc : array<f32, 2>;
  for (var i : u32 = 0u; i < DPT; i = i + 1u) {
    let d = tid + i * WG;
    qv[i]  = select(0.0, q[q_base + d], d < hd);
    acc[i] = 0.0;
  }

  // online softmax accumulators \u2014 identical algebra to the scalar version, and every lane
  // carries the same m/l because they all consume the same reduced score.
  var m : f32 = -3.0e38;
  var l : f32 = 0.0;

  for (var pos : u32 = 0u; pos <= last; pos = pos + 1u) {
    // Per-(pos,kv_head) f16 scales, fetched ONCE per position. The \`if\` is a uniform branch
    // (the same value for every lane in the workgroup), so it cannot diverge a barrier; it
    // is deliberately NOT a \`select()\`, which would read the dummy 4-byte scale buffer OOB
    // in f32 mode once sIdx grows past element 0.
    var kScale : f32 = 0.0;
    var vScale : f32 = 0.0;
    if (p.mode == 1u) {
      let sIdx = pos * p.n_heads_kv + kv_head;
      kScale = unpack2x16float(k_scale_buf[sIdx]).x;
      vScale = unpack2x16float(v_scale_buf[sIdx]).x;
    }
    let k_base = pos * kv_per_pos + kv_head * hd;
    var part : f32 = 0.0;
    for (var i : u32 = 0u; i < DPT; i = i + 1u) {
      let d = tid + i * WG;
      if (d < hd) { part = part + qv[i] * readK(p.mode, k_base + d, kScale); }
    }
    red[tid] = part;
    workgroupBarrier();

    // Tree reduction. The barrier is OUTSIDE the \`if\`, because a barrier inside non-uniform
    // control flow is undefined behaviour; the trip count is a constant so every lane runs
    // the same number of iterations.
    var stride : u32 = WG / 2u;
    loop {
      if (stride == 0u) { break; }
      if (tid < stride) { red[tid] = red[tid] + red[tid + stride]; }
      workgroupBarrier();
      stride = stride / 2u;
    }

    let s = red[0] * p.scale;

    let m_new = max(m, s);
    let corr  = exp(m - m_new);
    let w     = exp(s - m_new);
    l = l * corr + w;
    let v_base = pos * kv_per_pos + kv_head * hd;
    for (var i : u32 = 0u; i < DPT; i = i + 1u) {
      let d = tid + i * WG;
      if (d < hd) { acc[i] = acc[i] * corr + w * readV(p.mode, v_base + d, vScale); }
    }
    m = m_new;

    // Every lane has now READ red[0]; without this the next iteration's \`red[tid] = part\`
    // could overwrite it while a slower lane is still reading. Silent wrong scores, not a
    // crash \u2014 the failure mode this whole file exists to avoid.
    workgroupBarrier();
  }

  let inv = select(0.0, 1.0 / l, l > 0.0);
  for (var i : u32 = 0u; i < DPT; i = i + 1u) {
    let d = tid + i * WG;
    if (d < hd) { out[q_base + d] = acc[i] * inv; }
  }
}
`,qu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary\r
// \xA9 2026 Aitherium, LLC. Original work.\r
// Original Aitherium WebGPU implementation \u2014 WGSL kernels ported from the PrismML\r
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).\r
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).\r
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"\r
//   - SwiGLU ......................... down( silu(gate(x)) * up(x) ), silu(z)=z*sigmoid(z)\r
//\r
// This kernel is ONLY the element-wise silu(gate)*up stage; gate/up/down are Q1_0 matmuls\r
// (q1_0_q8_0_matmul.wgsl). Matches reference.ts swigluMul.\r
\r
@group(0) @binding(0) var<storage, read>       gate : array<f32>;\r
@group(0) @binding(1) var<storage, read>       up   : array<f32>;\r
@group(0) @binding(2) var<storage, read_write> out  : array<f32>;\r
@group(0) @binding(3) var<uniform>             n    : u32;\r
\r
fn silu(z : f32) -> f32 { return z / (1.0 + exp(-z)); }\r
\r
@compute @workgroup_size(256)\r
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,\r
        @builtin(local_invocation_id) lid_ : vec3<u32>,\r
        @builtin(num_workgroups) nwg_ : vec3<u32>) {\r
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.\r
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension\r
  // limit. When it does not \u2014 the common case \u2014 num_workgroups.y is 1 and this reduces to\r
  // EXACTLY the old expression, so the working 27B numerics are untouched.\r
  let i = (wg_.x + wg_.y * nwg_.x) * 256u + lid_.x;\r
  if (i >= n) { return; }\r
  out[i] = silu(gate[i]) * up[i];\r
}\r
`,Mu=`// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// \xA9 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation.
//
// THE THREE OPS THE VAE DECODER NEEDS AND THE TRANSFORMER DOES NOT.
//
// In-browser image generation was written off as needing a foreign kernel family. It does
// not. \`:8798\` serves FLUX.2 Klein 4B, and the giveaway is in its own tensor names \u2014
// \`transformer_blocks.0.attn.to_q\` \u2014 MMDiT is a diffusion TRANSFORMER: attention + MLP over
// latent patches, which the existing kernels already do. Its text encoder is Qwen3-4B, the
// same architecture family as the Bonsai text models that already run in a visitor's browser.
//
// What genuinely has no equivalent is the VAE DECODER, and only three ops of it. From the
// shipped model's own vae/config.json (AutoencoderKLFlux2):
//
//     block_out_channels : [128, 256, 512, 512]
//     up_block_types     : 4 x UpDecoderBlock2D
//     layers_per_block   : 2
//     latent_channels    : 32
//     norm_num_groups    : 32
//     act_fn             : silu
//
// so the decode graph is: conv_in -> mid(resnet + attn) -> 4 x (2 resnets + 2x upsample)
// -> GroupNorm -> SiLU -> conv_out(3ch). Attention and SiLU already exist. These are the rest.
//
// LAYOUT: NCHW, f32, batch 1 \u2014 one image at a time is what a browser does, and NCHW keeps a
// channel's plane contiguous, which is what makes GroupNorm's reduction a simple range.
//
// PERFORMANCE NOTE, learned the expensive way on softmax_attn_batched: a kernel written as
// one-thread-per-output looks fine and silently becomes the bottleneck when the tensor grows.
// The last up block runs at full output resolution, so at 1024x1024x128 that is 134M outputs.
// conv2d here is one thread per OUTPUT ELEMENT with the reduction inside it \u2014 correct, and
// deliberately the simple version first, because the transformer kernels earned their
// optimisations only after a CPU differential proved them right. Optimise after it is correct
// and after a measurement says which part is slow, not before.

struct ConvP {
  in_c   : u32,
  out_c  : u32,
  h      : u32,   // input height
  w      : u32,   // input width
  k      : u32,   // square kernel size (1 or 3 here)
  pad    : u32,
  stride : u32,
  _p0    : u32,
};

@group(0) @binding(0) var<storage, read>       x       : array<f32>;  // [in_c*h*w]
@group(0) @binding(1) var<storage, read>       weight  : array<f32>;  // [out_c*in_c*k*k]
@group(0) @binding(2) var<storage, read>       bias    : array<f32>;  // [out_c]
@group(0) @binding(3) var<storage, read_write> y       : array<f32>;  // [out_c*oh*ow]
@group(0) @binding(4) var<uniform>             p       : ConvP;

fn out_h() -> u32 { return (p.h + 2u * p.pad - p.k) / p.stride + 1u; }
fn out_w() -> u32 { return (p.w + 2u * p.pad - p.k) / p.stride + 1u; }

/**
 * 2-D convolution, NCHW, one thread per output element.
 *
 * Zero padding is done by SKIPPING out-of-range taps rather than by materialising a padded
 * input. Materialising would allocate another full tensor per layer \u2014 at decoder resolutions
 * that is hundreds of megabytes of pure copy, on a device that is also holding a language
 * model.
 */
@compute @workgroup_size(64)
fn conv2d_main(@builtin(global_invocation_id) gid : vec3<u32>,
               @builtin(num_workgroups) nwg : vec3<u32>) {
  let oh = out_h();
  let ow = out_w();
  let total = p.out_c * oh * ow;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }

  let ox = idx % ow;
  let oy = (idx / ow) % oh;
  let oc = idx / (ow * oh);

  var acc : f32 = bias[oc];
  for (var ic : u32 = 0u; ic < p.in_c; ic = ic + 1u) {
    let x_plane = ic * p.h * p.w;
    let w_base = ((oc * p.in_c) + ic) * p.k * p.k;
    for (var ky : u32 = 0u; ky < p.k; ky = ky + 1u) {
      // Signed arithmetic: with pad=1 the first row's taps land at -1, and doing this in
      // u32 wraps to ~4 billion and reads far out of bounds. WebGPU's robust access would
      // return 0 there, which LOOKS like correct zero-padding and is not \u2014 it silently
      // drops the real taps too on the opposite edge.
      let iy = i32(oy * p.stride) + i32(ky) - i32(p.pad);
      if (iy < 0 || iy >= i32(p.h)) { continue; }
      for (var kx : u32 = 0u; kx < p.k; kx = kx + 1u) {
        let ix = i32(ox * p.stride) + i32(kx) - i32(p.pad);
        if (ix < 0 || ix >= i32(p.w)) { continue; }
        acc = acc + x[x_plane + u32(iy) * p.w + u32(ix)] * weight[w_base + ky * p.k + kx];
      }
    }
  }
  y[idx] = acc;
}

struct GroupNormP {
  c       : u32,
  h       : u32,
  w       : u32,
  groups  : u32,
  eps     : f32,
  _p0 : u32, _p1 : u32, _p2 : u32,
};

@group(0) @binding(0) var<storage, read>       gx      : array<f32>;
@group(0) @binding(1) var<storage, read>       gamma   : array<f32>;  // [c]
@group(0) @binding(2) var<storage, read>       beta    : array<f32>;  // [c]
@group(0) @binding(3) var<storage, read_write> gy      : array<f32>;
@group(0) @binding(4) var<uniform>             gp      : GroupNormP;

/**
 * GroupNorm \u2014 one WORKGROUP per group, cooperating over that group's whole slab.
 *
 * NOT one thread per group. A group at decoder sizes is (c/groups) x h x w elements \u2014 with
 * 128 channels, 32 groups and a 512x512 plane that is over a million values, and a single
 * thread walking it is the same one-lane mistake that made attention 8x slower than it had
 * to be. The mean and variance are a parallel reduction; the normalise pass is grid-strided.
 *
 * Two passes over the slab (mean, then variance) rather than the sum/sum-of-squares trick:
 * at f32 with a million-element reduction the one-pass form loses precision exactly where
 * the variance is small, which is where a VAE's activations live.
 */
var<workgroup> red_sum : array<f32, 256>;

@compute @workgroup_size(256)
fn groupnorm_main(@builtin(workgroup_id) wg : vec3<u32>,
                  @builtin(local_invocation_id) lid : vec3<u32>) {
  let g = wg.x;
  if (g >= gp.groups) { return; }        // uniform across the workgroup \u2014 safe with barriers

  let cpg = gp.c / gp.groups;            // channels per group
  let plane = gp.h * gp.w;
  let slab = cpg * plane;                // elements this group owns
  let base = g * slab;
  let tid = lid.x;

  // ---- mean ----
  var s : f32 = 0.0;
  var i : u32 = tid;
  loop {
    if (i >= slab) { break; }
    s = s + gx[base + i];
    i = i + 256u;
  }
  red_sum[tid] = s;
  workgroupBarrier();
  var stride : u32 = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }
    workgroupBarrier();
    stride = stride / 2u;
  }
  let mean = red_sum[0] / f32(slab);
  workgroupBarrier();

  // ---- variance ----
  var v : f32 = 0.0;
  i = tid;
  loop {
    if (i >= slab) { break; }
    let d = gx[base + i] - mean;
    v = v + d * d;
    i = i + 256u;
  }
  red_sum[tid] = v;
  workgroupBarrier();
  stride = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { red_sum[tid] = red_sum[tid] + red_sum[tid + stride]; }
    workgroupBarrier();
    stride = stride / 2u;
  }
  let inv_std = 1.0 / sqrt(red_sum[0] / f32(slab) + gp.eps);
  workgroupBarrier();

  // ---- normalise + per-CHANNEL affine ----
  // gamma/beta are indexed by absolute channel, not by group: a group spans cpg channels and
  // each has its own scale. Using the group index here is an easy and completely silent
  // error \u2014 the image comes out plausible and wrong.
  i = tid;
  loop {
    if (i >= slab) { break; }
    let ch = g * cpg + (i / plane);
    gy[base + i] = (gx[base + i] - mean) * inv_std * gamma[ch] + beta[ch];
    i = i + 256u;
  }
}

struct UpP {
  c : u32,
  h : u32,
  w : u32,
  scale : u32,
};

@group(0) @binding(0) var<storage, read>       ux : array<f32>;
@group(0) @binding(1) var<storage, read_write> uy : array<f32>;
@group(0) @binding(2) var<uniform>             up : UpP;

/**
 * Nearest-neighbour upsample by an integer factor \u2014 what UpDecoderBlock2D does before its
 * convolution (diffusers' Upsample2D default is nearest, and the conv that follows is what
 * turns the blockiness into detail). Bilinear here would be a different model.
 */
@compute @workgroup_size(64)
fn upsample_nearest_main(@builtin(global_invocation_id) gid : vec3<u32>,
                         @builtin(num_workgroups) nwg : vec3<u32>) {
  let oh = up.h * up.scale;
  let ow = up.w * up.scale;
  let total = up.c * oh * ow;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }

  let ox = idx % ow;
  let oy = (idx / ow) % oh;
  let ch = idx / (ow * oh);

  let sx = ox / up.scale;
  let sy = oy / up.scale;
  uy[idx] = ux[ch * up.h * up.w + sy * up.w + sx];
}
`,Ti={causal_conv1d:ku,deltanet:vu,deltanet_gate:xu,deltanet_seq:Su,elementwise:Lu,elementwise_inplace:Au,kv_quant_4bit:Tu,logit_topk:Eu,q1_0_dequant:Bu,q1_0_q8_0_matmul:Pu,q2_0_dequant:Ou,q2_0_q8_0_matmul:$u,quantize_q8_0:Iu,rmsnorm:Gu,rope_imrope:Nu,sampling:Ru,softmax_attn:Cu,softmax_attn_batched:Du,swiglu:qu,vae_ops:Mu};We();var Uu=["intel","arm","qualcomm","imgtec"],Ku=["microsoft"];function Ar(t){if(t?.isFallbackAdapter===!0)return"software";let e=t?.vendor?.trim().toLowerCase();return e?Ku.includes(e)?"software":Uu.includes(e)?"integrated":"unknown":"unknown"}function Ei(t,e){switch(t){case"software":case"integrated":return 8;case"unknown":case"discrete":default:return e?.windowsTdr?64:0}}function $i(t){try{return typeof process<"u"&&process.env&&process.env[t]||""}catch{return""}}var wn="https://huggingface.co/prism-ml",Fu="https://weights.aitherium.com",Bi=$i("NEXT_PUBLIC_BONSAI_MIRROR_BASE"),Pi=Bi==="none"?"":Bi||Fu;function Tr(t){let e=[t.url];if(Pi){let n=t.url.split("/").pop();n&&e.push(`${Pi.replace(/\/+$/,"")}/${n}`)}return e}var Wu=[{id:"bonsai-1.7b",label:"Bonsai 1.7B",params:"1.7B",sizeMb:236,url:`${wn}/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf`,contextWindow:32768,blurb:"The lightest size \u2014 236 MB, runs right here in your browser, and quick enough on a phone. Start here.",arch:"qwen3"},{id:"bonsai-4b",label:"Bonsai 4B",params:"4B",sizeMb:545,url:`${wn}/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf`,contextWindow:32768,blurb:"The balanced pick: noticeably smarter than 1.7B, still a quick download, still runs in the browser.",arch:"qwen3"},{id:"bonsai-8b",label:"Bonsai 8B",params:"8B",sizeMb:1104,url:`${wn}/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf`,contextWindow:65536,blurb:"Better reasoning, ~1 GB. Comfortable on a desktop with a real GPU; a big ask on a phone.",arch:"qwen3"},{id:"bonsai-27b-text",label:"Bonsai 27B",params:"27B",sizeMb:3627,url:`${wn}/Bonsai-27B-gguf/resolve/main/Bonsai-27B-Q1_0.gguf`,contextWindow:262144,blurb:"The full brain. 3.6 GB and slow in a browser \u2014 for a real GPU, or self-host it with llama.cpp for the higher-quality ternary build.",arch:"qwen35"}];var ju="bonsai-1.7b";function Oi(t){return Wu.find(e=>e.id===t)}function Er(t){let e=Oi(t)??Oi(ju),n=Tr(e);return n.length>1?n[n.length-1]:n[0]}var bl=$i("NEXT_PUBLIC_BONSAI_WASM_BASE")||"https://weights.aitherium.com";Ai(self,{loadKernels:async()=>Ti,acquireDevice:async()=>{let t=navigator;if(!t.gpu)throw new Error("WebGPU unavailable (navigator.gpu missing)");let e=await t.gpu.requestAdapter({powerPreference:"high-performance"}),n=!1;if(e||(e=await t.gpu.requestAdapter({forceFallbackAdapter:!0}).catch(()=>null),n=e!==null),!e)throw new Error("no WebGPU adapter (even the software fallback refused)");let r=e.limits,o={};for(let p of["maxStorageBufferBindingSize","maxBufferSize","maxComputeWorkgroupStorageSize"]){let h=r[p];typeof h=="number"&&h>0&&(o[p]=h)}let i=await e.requestDevice({requiredLimits:o}),s=e,a=e.info||{},c=n||s.isFallbackAdapter===!0||a.isFallbackAdapter===!0,d=Ar({...a,isFallbackAdapter:c});console.info(`[bonsai] adapter: vendor='${a.vendor??"?"}' arch='${a.architecture??"?"}' fallback=${c} -> class '${d}'`),d==="software"&&console.warn("[bonsai] NO GPU: this browser handed back a SOFTWARE adapter, not your graphics card. Bonsai will run, but expect well under 1 tok/s \u2014 the hosted ladder or a local node is the right path here. (Chrome: check chrome://gpu for a disabled/crashed GPU process.)");let u=typeof navigator<"u"&&/Windows/i.test(navigator.userAgent??""),l=Ei(d,{windowsTdr:u});if(l>0&&(console.warn(`[bonsai] adapter classified '${d}' (${e.info?.vendor??"?"}) \u2014 capping at ${l} dispatches/submit to stay under the OS GPU watchdog (TDR) deadline of ~2s. This reduces per-batch duration at the cost of more queue.submit() calls. If you still see GPU resets, choose a smaller model \u2014 this class of adapter cannot safely run large ones.`),wo(i,l)),i.lost){let p=i.lost,h=setTimeout(()=>{console.error("[bonsai] WARNING: device.lost promise did not resolve within 30s \u2014 this adapter may not support proper device-lost observation. Fallback routing may be needed.")},3e4);p.then(()=>{clearTimeout(h)}).catch(()=>{clearTimeout(h)})}return i},resolveModelUrl:t=>Er(t),resolveMirrorUrls:t=>Tr({url:Er(t)})});

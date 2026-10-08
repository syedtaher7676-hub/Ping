/* ── Ping Visual FX ── animations.js ──
   Optimized RAF master loop · Landing + App canvas
   Cursor trail · Magnetic CTA · Fun facts · Char counter · Match burst */

(() => {
  const rm = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ── SPLASH REVEAL ─────────────────────────────────────────────
  const splash    = document.getElementById('splashScreen');
  const landing   = document.getElementById('landingPage');
  const chatApp   = document.getElementById('chatApp');
  const splashBar = document.querySelector('.splash-bar-fill');

  function updateLoadingProgress() {
    if (!splashBar) return;
    let progress = 0;
    const startMs = performance.now();
    const durationMs = 220;

    const step = (now) => {
      const elapsed = now - startMs;
      progress = Math.min(100, (elapsed / durationMs) * 100);
      splashBar.style.width = progress.toFixed(1) + '%';

      if (progress < 100) {
        requestAnimationFrame(step);
      } else {
        setTimeout(revealLanding, 60);
      }
    };

    requestAnimationFrame(step);
  }

  function revealLanding() {
    if (splash) {
      splash.style.transition = 'opacity 0.2s cubic-bezier(0, 0, 0.2, 1), transform 0.2s cubic-bezier(0, 0, 0.2, 1), filter 0.2s cubic-bezier(0, 0, 0.2, 1)';
      splash.style.opacity = '0';
      splash.style.transform = 'scale(1.01) translateZ(0)';
      splash.style.filter = 'blur(4px)';
      splash.style.pointerEvents = 'none';

      if (landing) {
        landing.style.transition = 'opacity 0.2s cubic-bezier(0, 0, 0.2, 1), transform 0.2s cubic-bezier(0, 0, 0.2, 1)';
        landing.style.opacity = '1';
        landing.style.transform = 'scale(1) translateZ(0)';
      }

      setTimeout(() => {
        splash.style.display = 'none';
        const sl = document.getElementById('scanLine');
        if (sl && !rm) setTimeout(() => sl.classList.add('fire'), 60);
      }, 200);
    }
  }

  updateLoadingProgress();

  // ─────────────────────────────────────────────────────────────
  //  COLOUR PALETTE
  // ─────────────────────────────────────────────────────────────
  const PAL = [
    'rgba(124,58,237,',  'rgba(219,39,119,',
    'rgba(6,182,212,',   'rgba(157,95,250,',
    'rgba(236,72,153,',  'rgba(59,130,246,',
    'rgba(34,197,94,',   'rgba(251,191,36,',
  ];
  const rc = () => PAL[Math.floor(Math.random() * PAL.length)];

  // ─────────────────────────────────────────────────────────────
  //  LANDING CANVAS — stars + constellation + attract
  // ─────────────────────────────────────────────────────────────
  const lCv  = document.getElementById('particleCanvas');
  const lCtx = lCv ? lCv.getContext('2d') : null;
  let LW = 0, LH = 0;

  if (lCv) {
    const r = () => { LW = lCv.width = innerWidth; LH = lCv.height = innerHeight; };
    addEventListener('resize', r); r();
  }

  class Star {
    constructor() { this.init(true); }
    init(boot = false) {
      this.x = Math.random() * LW;
      this.y = boot ? Math.random() * LH : LH + 10;
      this.r = Math.random() * 2 + .3;
      this.vx = (Math.random() - .5) * .35;
      this.vy = -(Math.random() * .5 + .1);
      this.life = 0; this.max = Math.random() * 200 + 80;
      this.col = rc();
      this.tw = Math.random() * Math.PI * 2;
      this.twS = Math.random() * .04 + .01;
    }
    step() { this.x += this.vx; this.y += this.vy; this.life++; this.tw += this.twS; if (this.life > this.max || this.y < -10) this.init(); }
    draw(c) { const a = Math.sin((this.life/this.max)*Math.PI)*(.6+Math.sin(this.tw)*.2); c.beginPath(); c.arc(this.x,this.y,this.r,0,Math.PI*2); c.fillStyle=this.col+a.toFixed(2)+')'; c.fill(); }
  }

  const isTouchDevice = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
  const isFastMode = () => {
    const cl = document.documentElement.classList;
    return cl.contains('fast-mode') || cl.contains('is-ios') || cl.contains('is-safari') || cl.contains('is-android') || cl.contains('is-mobile') || cl.contains('is-low-end') || isTouchDevice;
  };
  const isLowEndDevice = () => document.documentElement.classList.contains('is-low-end');

  const MAX_L = rm ? 0 : (isLowEndDevice() ? 25 : (isTouchDevice ? 36 : 85));
  const stars  = [];
  if (lCtx) for (let i=0;i<MAX_L;i++) stars.push(new Star());

  function drawConstellation(ctx, pts, maxD, a) {
    if (isFastMode()) return; // Skip O(N^2) CPU overhead on mobile & low-end devices
    ctx.lineWidth = .5;
    for (let i=0; i<pts.length; i+=2) {
      for (let j=i+1; j<pts.length; j+=2) {
        const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.hypot(dx,dy);
        if (d<maxD) { ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y); ctx.strokeStyle=`rgba(124,58,237,${((1-d/maxD)*a).toFixed(3)})`; ctx.stroke(); }
      }
    }
  }

  // ── CURSOR TRAIL ──────────────────────────────────────────────
  const trail = [];
  const TN = (rm || isTouchDevice) ? 0 : 10; // Optimized segments for desktop only
  let mX = -999, mY = -999;
  const TC = ['#9d5ffa','#c084fc','#e879f9','#f472b6','#fb7185','#a78bfa','#60a5fa','#34d399'];
  if (!rm && !isTouchDevice) {
    for (let i=0;i<TN;i++) {
      const d = document.createElement('div'); d.className='cursor-dot';
      d.style.cssText=`background:${TC[i%TC.length]};opacity:${((TN-i)/TN*.6).toFixed(2)};width:${Math.max(2,7-i*.5)}px;height:${Math.max(2,7-i*.5)}px`;
      document.body.appendChild(d); trail.push({el:d, x:-999, y:-999});
    }
    addEventListener('mousemove', e => { mX = e.clientX; mY = e.clientY; });
  }

  // ── GLOW TRACKING CTA (Desktop mouse only to avoid delaying iOS/mobile tap) ──
  const ctaBtn = document.getElementById('startLandingBtn');
  if (ctaBtn && !rm && !isTouchDevice) {
    let bR = null;
    let ctaRaf = null;
    const rbr = () => { bR = ctaBtn.getBoundingClientRect(); };
    ctaBtn.addEventListener('mouseenter', rbr);
    ctaBtn.addEventListener('mousemove', e => {
      if (ctaRaf) return;
      ctaRaf = requestAnimationFrame(() => {
        ctaRaf = null;
        if (!bR) bR = ctaBtn.getBoundingClientRect();
        if (!bR || bR.width === 0 || bR.height === 0) return;
        const xPercent = Math.min(100, Math.max(0, ((e.clientX - bR.left) / bR.width) * 100));
        const yPercent = Math.min(100, Math.max(0, ((e.clientY - bR.top) / bR.height) * 100));
        ctaBtn.style.setProperty('--mx', xPercent.toFixed(1) + '%');
        ctaBtn.style.setProperty('--my', yPercent.toFixed(1) + '%');
      });
    });
    ctaBtn.addEventListener('mouseleave', () => {
      if (ctaRaf) { cancelAnimationFrame(ctaRaf); ctaRaf = null; }
      bR = null;
      ctaBtn.style.setProperty('--mx', '50%');
      ctaBtn.style.setProperty('--my', '50%');
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  APP CANVAS — 3-mode view-aware particle system
  // ─────────────────────────────────────────────────────────────
  const aCv  = document.getElementById('appCanvas');
  const aCtx = aCv ? aCv.getContext('2d') : null;
  let AW = 0, AH = 0;
  let appMode = 'prechat';
  let aParticles = [];

  window.__pingSetAppMode = (mode) => {
    if (appMode === mode) return;
    appMode = mode; rebuild();
  };

  function resizeApp() {
    if (!aCv) return;
    const newW = (chatApp && chatApp.clientWidth) ? chatApp.clientWidth : window.innerWidth;
    const newH = (chatApp && chatApp.clientHeight) ? chatApp.clientHeight : window.innerHeight;
    if (newW !== AW || newH !== AH) {
      AW = aCv.width = newW;
      AH = aCv.height = newH;
      rebuild();
    }
  }
  addEventListener('resize', () => { if (aCv && chatApp?.style.display !== 'none') resizeApp(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (aCv && chatApp?.style.display !== 'none') resizeApp(); });
  }

  class AmbPart {
    constructor() { this.r(); }
    r() { this.x=Math.random()*AW; this.y=Math.random()*AH; this.vx=(Math.random()-.5)*.25; this.vy=(Math.random()-.5)*.25; this.life=0; this.max=Math.random()*350+120; this.rad=Math.random()*1.8+.4; this.col=['rgba(124,58,237,','rgba(157,95,250,','rgba(6,182,212,'][Math.floor(Math.random()*3)]; }
    step() { this.x+=this.vx; this.y+=this.vy; this.life++; if(this.life>this.max) this.r(); }
    draw(c) { const a=Math.sin((this.life/this.max)*Math.PI)*.4; c.beginPath();c.arc(this.x,this.y,this.rad,0,Math.PI*2);c.fillStyle=this.col+a.toFixed(2)+')';c.fill(); }
  }

  class WarpPart {
    constructor() { this.r(); }
    r() {
      const e=Math.floor(Math.random()*4);
      if(e===0){this.x=Math.random()*AW;this.y=-10;} else if(e===1){this.x=AW+10;this.y=Math.random()*AH;} else if(e===2){this.x=Math.random()*AW;this.y=AH+10;} else{this.x=-10;this.y=Math.random()*AH;}
      const dx=AW/2-this.x,dy=AH/2-this.y,dist=Math.hypot(dx,dy)||1,sp=Math.random()*.8+.3;
      this.vx=dx/dist*sp; this.vy=dy/dist*sp;
      this.rad=Math.random()*1.8+.4; this.life=0; this.max=Math.random()*220+60;
      this.col=['rgba(124,58,237,','rgba(6,182,212,','rgba(34,197,94,','rgba(157,95,250,'][Math.floor(Math.random()*4)];
    }
    step() {
      const dx=AW/2-this.x,dy=AH/2-this.y,dist=Math.hypot(dx,dy)||1;
      if(dist>40){this.vx+=dx/dist*.02;this.vy+=dy/dist*.02;}
      this.x+=this.vx;this.y+=this.vy;this.life++;
      if(this.life>this.max||dist<30) this.r();
    }
    draw(c) { const a=Math.sin((this.life/this.max)*Math.PI)*.5; c.beginPath();c.arc(this.x,this.y,this.rad,0,Math.PI*2);c.fillStyle=this.col+a.toFixed(2)+')';c.fill(); }
  }

  class ChatPart {
    constructor() { this.r(true); }
    r(init=false) {
      this.x = Math.random() * AW;
      this.y = init ? Math.random() * AH : AH + Math.random()*50;
      this.vx = (Math.random()-.5)*.5; 
      this.vy = -(Math.random()*.5 + 0.4); 
      this.rad = Math.random()*2 + 0.8; 
      this.life = 0; 
      this.max = Math.random()*600+300;
      this.col = Math.random() < 0.5 ? 'rgba(6,182,212,' : 'rgba(219,39,119,';
    }
    step() { 
      this.x += Math.sin(this.life*0.03)*0.5 + this.vx; 
      this.y += this.vy; 
      this.life++; 
      if(this.y < -30 || this.life > this.max) this.r(); 
    }
    draw(c) { 
      const a = Math.sin((this.life/this.max)*Math.PI) * 0.4; 
      c.beginPath(); c.arc(this.x, this.y, this.rad, 0, Math.PI*2);
      c.fillStyle = this.col + a.toFixed(2) + ')';
      if (!isFastMode()) {
        c.shadowBlur = 15; c.shadowColor = this.col + '0.8)';
        c.fill(); c.shadowBlur = 0;
      } else {
        c.fill();
      }
    }
  }

  let warpPool = [];

  function rebuild() {
    if (!aCtx) return;
    aParticles=[]; warpPool=[];
    if (rm) return;
    const fast = isFastMode();
    const lowEnd = isLowEndDevice();

    if (appMode==='prechat') {
      const count = lowEnd ? 14 : (fast ? 20 : 40);
      for(let i=0;i<count;i++) aParticles.push(new AmbPart());
    } else if (appMode==='waiting') {
      const ambCount = lowEnd ? 10 : (fast ? 14 : 20);
      const warpCount = lowEnd ? 16 : (fast ? 24 : 50);
      for(let i=0;i<ambCount;i++) aParticles.push(new AmbPart());
      for(let i=0;i<warpCount;i++) warpPool.push(new WarpPart());
    } else if (appMode==='chat'||appMode==='chatting'||appMode==='friendDM') {
      const count = lowEnd ? 14 : (fast ? 20 : 45);
      for(let i=0;i<count;i++) aParticles.push(new ChatPart());
    }
  }

  function neuralLines(ctx, pts, maxD, alpha) {
    if (isLowEndDevice()) return; // Skip neural mesh lines on low-end hardware
    ctx.lineWidth=.6;
    const step = isFastMode() ? 3 : 2;
    for(let i=0;i<pts.length;i+=step) for(let j=i+1;j<pts.length;j+=step) {
      const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.hypot(dx,dy);
      if(d<maxD){ ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle=`rgba(124,58,237,${((1-d/maxD)*alpha).toFixed(3)})`;ctx.stroke(); }
    }
  }

  function drawApp() {
    if (!aCtx) return;
    const fast = isFastMode();
    aCtx.clearRect(0,0,AW,AH);
    if (appMode==='prechat') {
      aParticles.forEach(p=>{p.step();p.draw(aCtx);});
      if (!fast) drawConstellation(aCtx, aParticles, 85, .1);
    } else if (appMode==='waiting') {
      aParticles.forEach(p=>{p.step();p.draw(aCtx);});
      warpPool.forEach(p=>{p.step();p.draw(aCtx);});
      neuralLines(aCtx, warpPool,  120, .25);
    } else {
      aParticles.forEach(p=>{p.step();p.draw(aCtx);});
      if (!fast) drawConstellation(aCtx, aParticles, 100, .15);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ANIMATED COUNTER
  // ─────────────────────────────────────────────────────────────
  window.__pingCountUp = (el, target, dur=500) => {
    if (!el || typeof target !== 'number') return;
    if (el._countUpRaf) {
      cancelAnimationFrame(el._countUpRaf);
      el._countUpRaf = null;
    }
    const currentVal = parseInt((el.textContent || '').replace(/[^\d]/g, ''), 10) || 0;
    if (currentVal === target) {
      el.textContent = target > 0 ? target.toLocaleString() : '—';
      return;
    }
    const start = currentVal;
    const t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / dur, 1);
      const val = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
      el.textContent = val > 0 ? val.toLocaleString() : '—';
      if (p < 1) {
        el._countUpRaf = requestAnimationFrame(step);
      } else {
        el._countUpRaf = null;
      }
    };
    el._countUpRaf = requestAnimationFrame(step);
  };

  // ─────────────────────────────────────────────────────────────
  //  CHARACTER COUNTER
  // ─────────────────────────────────────────────────────────────
  const msgInput = document.getElementById('messageInput');
  const charCtr  = document.getElementById('charCounter');
  if (msgInput && charCtr) {
    msgInput.addEventListener('input', () => {
      const rem = 500 - msgInput.value.length;
      if (rem <= 80) { charCtr.textContent=rem; charCtr.className='char-counter '+(rem<=20?'danger':'warn'); }
      else            { charCtr.textContent=''; charCtr.className='char-counter'; }
    });
  }

  const friendMsgInput = document.getElementById('friendMessageInput');
  const friendCharCtr  = document.getElementById('friendCharCounter');
  if (friendMsgInput && friendCharCtr) {
    friendMsgInput.addEventListener('input', () => {
      const rem = 500 - friendMsgInput.value.length;
      if (rem <= 80) { friendCharCtr.textContent=rem; friendCharCtr.className='char-counter '+(rem<=20?'danger':'warn'); }
      else            { friendCharCtr.textContent=''; friendCharCtr.className='char-counter'; }
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  FUN FACTS ROTATOR
  // ─────────────────────────────────────────────────────────────
  const FACTS = [
    ['💡','Match time is usually < 10s'],
    ['🌍','Connecting 150+ countries'],
    ['🔒','No messages are ever stored'],
    ['👻','Zero accounts, 100% anonymous'],
    ['⚡','Real-time WebSocket chat'],
  ];
  let fi=0, ft=null;
  function rotateFact() {
    const te=document.getElementById('funFactText'), ie=document.getElementById('ffIcon');
    if(!te||!ie) return;
    fi=(fi+1)%FACTS.length;
    te.classList.add('fade'); setTimeout(()=>{te.textContent=FACTS[fi][1];ie.textContent=FACTS[fi][0];te.classList.remove('fade');},320);
  }
  const wv = document.getElementById('waitingView');
  if (wv) new MutationObserver(()=>{
    if(wv.style.display==='flex') { if(!ft) ft=setInterval(rotateFact,4000); }
    else { clearInterval(ft); ft=null; }
  }).observe(wv,{attributes:true,attributeFilter:['style']});

  // ─────────────────────────────────────────────────────────────
  //  MASTER RAF LOOP — Optimized
  // ─────────────────────────────────────────────────────────────
  let lastTs = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    if (ts - lastTs < 16) return; // Smooth 60fps refresh rate
    lastTs = ts;

    const chatActive    = chatApp && chatApp.style.display !== 'none';
    const landingActive = landing && landing.style.display !== 'none';
    const keyboardOpen  = document.documentElement.classList.contains('keyboard-open');

    if (landingActive && lCtx && !rm) {
      lCtx.clearRect(0,0,LW,LH);
      stars.forEach(p => { p.step(); p.draw(lCtx); });
      drawConstellation(lCtx, stars, 100, .12);
    }

    if (chatActive && aCtx && !rm && !keyboardOpen) drawApp();

    if (!rm && trail.length && mX > 0) {
      trail[0].x+=(mX-trail[0].x)*.35; trail[0].y+=(mY-trail[0].y)*.35;
      for(let i=1;i<TN;i++){trail[i].x+=(trail[i-1].x-trail[i].x)*.3;trail[i].y+=(trail[i-1].y-trail[i].y)*.3;}
      trail.forEach(d=>{d.el.style.transform=`translate(${d.x-3}px,${d.y-3}px)`;});
    }
  }
  requestAnimationFrame(loop);

  // ── HOOK SOCKET ──
  const checkSocket = setInterval(() => {
    if (window.socket) {
      window.socket.on('matched', () => {
        if (!rm && lCtx) {
           // Small burst only
           const cx=innerWidth/2, cy=innerHeight/2;
           for(let i=0;i<20;i++) { /* simplified matching fx */ }
        }
      });
      clearInterval(checkSocket);
    }
  }, 500);

  // ── APP CANEVAS INIT ──
  if (chatApp) {
    new MutationObserver(() => {
      if (chatApp.style.display !== 'none') resizeApp();
    }).observe(chatApp, {attributes:true, attributeFilter:['style']});
  }

})();

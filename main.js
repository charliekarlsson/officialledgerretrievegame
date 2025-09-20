// Minimal canvas engine tuned for 80x80 tiles and single-frame slicing
(function(){
  // Stage
  const canvas = document.getElementById('game');
  const host = document.getElementById('stageHost');
  const ctx = canvas.getContext('2d');
  function resize(){
    const r = host.getBoundingClientRect();
    canvas.width = Math.max(1, r.width|0);
    canvas.height = Math.max(1, r.height|0);
    ctx.imageSmoothingEnabled = false; // crisp pixels
  }
  window.addEventListener('resize', resize);
  // Resize canvas after stage is fitted by layout script
  window.addEventListener('load', resize);
  setTimeout(resize, 200);
  resize();

  // Config
  const TILE = 80; // each source frame is 80x80
  const SCALE = 4; // on-screen scale factor
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  // Audio gate: allow playback only after user interaction
  let userInteracted = false;
  const unlockAudio = () => { userInteracted = true; };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  // Parse a trailing number in filename as frameCount, e.g., soapidle_12.png or man-attack@6.png
  function parseFrameHint(path){
    try {
      const file = path.split('\\').pop().split('/').pop();
      const name = file.replace(/\.[^.]+$/, '');
      const m = name.match(/(?:[_@-]f?)(\d+)$|([^0-9])(\d+)$/i);
      if (!m) return 0;
      const num = m[1] || m[3];
      const n = parseInt(num, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }

  // SpriteSheet holds a single spritesheet image and grid info
  class SpriteSheet {
    constructor(src, tileW=TILE, tileH=TILE){
      this.image = new Image();
      this.image.src = src;
      this.tileW = tileW; this.tileH = tileH;
  this.cols = 0; this.rows = 0; this.loaded = false;
  this.hintFrameCount = parseFrameHint(src);
      this.image.onload = () => {
        this.loaded = true;
        this.cols = Math.max(1, Math.floor(this.image.width / this.tileW));
        this.rows = Math.max(1, Math.floor(this.image.height / this.tileH));
      };
      this.image.onerror = () => console.error('Failed to load', src);
    }
  }

  // Simple Sound wrapper (safe even if files are missing)
  class Sound {
    constructor(srcOrList, { volume=1, loop=false } = {}){
      this.sources = Array.isArray(srcOrList) ? srcOrList : [srcOrList];
      this.volume = volume; this.loop = loop;
      this._idx = -1; this.audio = null;
  this._playing = false;
      this._selectBest();
    }
    _selectBest(){
      // Prefer first playable by canPlayType, else first
      const test = document.createElement('audio');
      let choice = -1;
      for (let i=0;i<this.sources.length;i++){
        const s = this.sources[i].toLowerCase();
        const ext = s.endsWith('.ogg') ? 'audio/ogg' : s.endsWith('.mp3') ? 'audio/mpeg' : s.endsWith('.wav') ? 'audio/wav' : '';
        if (!ext){ if (choice === -1) choice = i; continue; }
        const ok = test.canPlayType(ext);
        if (ok){ choice = i; break; }
      }
      if (choice === -1 && this.sources.length) choice = 0;
      this._setAudio(choice);
    }
    _setAudio(i){
      if (i === this._idx || i < 0 || i >= this.sources.length) return;
      this._idx = i;
      this.audio = new Audio(this.sources[i]);
      this.audio.preload = 'auto';
      this.audio.loop = this.loop;
      this.audio.volume = this.volume;
      this.audio.onended = () => { this._playing = false; };
      this.audio.onerror = () => {
        // Try next fallback
        const next = this._idx + 1;
        if (next < this.sources.length){
          this._setAudio(next);
        } else {
          // No more fallbacks
          // console.warn('Audio failed for all sources', this.sources);
        }
      };
    }
    play(restart=true){
      if (!userInteracted || !this.audio) return;
      if (this._playing) return; // prevent stacking or interrupting current clip
      try {
        if (restart) this.audio.currentTime = 0;
        const p = this.audio.play();
        if (p && typeof p.then === 'function'){
          p.then(() => { this._playing = true; }).catch(()=>{});
        } else {
          this._playing = true;
        }
      } catch {}
    }
    stop(){ try { this.audio?.pause(); if (this.audio) this.audio.currentTime = 0; this._playing = false; } catch {} }
  }

  // Animation plays frames in row-major order, showing exactly one frame at a time
  class Animation {
    constructor(sheet, { frameCount=0, fps=8, loop=true, allowFlip=true } = {}){
      this.sheet = sheet;
      this.frameCount = frameCount; // 0 = use all tiles
      this.fps = fps; this.loop = loop;
      this.allowFlip = allowFlip;
      this.index = 0; this.acc = 0; this.done = false;
    }
    reset(){ this.index = 0; this.acc = 0; this.done = false; }
    total(){
      const gridTotal = this.sheet.cols * this.sheet.rows;
      const hint = this.sheet.hintFrameCount || 0;
      const chosen = this.frameCount || hint || gridTotal;
      return Math.min(chosen, gridTotal);
    }
    update(dt){
      if (!this.sheet.loaded || this.done) return;
      const total = this.total(); if (total <= 1) return;
      this.acc += dt; const step = 1000/this.fps;
      while (this.acc >= step){
        this.index++; this.acc -= step;
        if (this.index >= total){
          if (this.loop){ this.index = 0; }
          else { this.index = total-1; this.done = true; }
        }
      }
    }
  draw(ctx, x, y, scale=SCALE, flipX=false){
      if (!this.sheet.loaded) return;
      const cols = this.sheet.cols; const rows = this.sheet.rows;
      const fw = this.sheet.tileW, fh = this.sheet.tileH;
      const total = this.total();
      const i = Math.max(0, Math.min(total-1, this.index|0));
      const c = i % cols, r = (i/cols)|0;
      const sx = c*fw, sy = r*fh;
      const dw = fw*scale, dh = fh*scale;
      const dx = (x - dw/2)|0; const dy = (y - dh)|0; // bottom-anchored
  ctx.save();
  const doFlip = flipX && this.allowFlip;
  if (doFlip){
        ctx.scale(-1,1);
        ctx.drawImage(this.sheet.image, sx, sy, fw, fh, -dx - dw, dy, dw, dh);
      } else {
        ctx.drawImage(this.sheet.image, sx, sy, fw, fh, dx, dy, dw, dh);
      }
      ctx.restore();
    }
  }

  // Fighter aggregates animations and draws at a fixed world position
  class Fighter {
    constructor(x, y, facing=1){
      this.x = x; this.y = y; this.facing = facing; this.scale = SCALE;
      this.anim = new Map();
      this.current = 'idle';
      // Combat stats
      this.maxHp = 100; this.hp = this.maxHp; this.damage = 10;
      this.hasHit = false; // prevents multi-hit per attack
  this.stunned = false; // when true, AI/input cannot change state
  this.audio = { walk: null, attack: null, taunt: null };
    }
    add(name, animation){ this.anim.set(name, animation); }
    set(name){
      if (this.stunned && name !== 'taunt') return; // block all but taunt when stunned
      if (this.current === name) return;
      const prev = this.current;
      this.current = name;
      // Reset all animations when switching
      for (const a of this.anim.values()) a.reset();
      // Reset attack bookkeeping on attack start
      if (name === 'attack') this.hasHit = false;
      // Audio hooks
      if (this.audio){
        if (prev === 'walk' && name !== 'walk') this.audio.walk?.stop();
        if (name === 'walk') this.audio.walk?.play(false);
  if (name === 'attack') this.audio.attack?.play(false);
  if (name === 'taunt') this.audio.taunt?.play(false);
      }
    }
    update(dt){
      const a = this.anim.get(this.current); if (!a) return;
      a.update(dt);
      // While stunned, force taunt to remain active
      if (this.stunned && this.current !== 'taunt') { this.set('taunt'); return; }
      if (this.current === 'attack' && a.done) this.set('idle');
    }
  draw(ctx){ const a = this.anim.get(this.current); if (!a) return; a.draw(ctx, this.x, this.y, this.scale, this.facing===-1); }
    // Rect helpers (world space)
    getFrameSize(){
      const a = this.anim.get(this.current) || [...this.anim.values()][0];
      const fw = (a?.sheet.tileW||TILE) * this.scale;
      const fh = (a?.sheet.tileH||TILE) * this.scale;
      return { fw, fh };
    }
    getHurtbox(){
      const { fw, fh } = this.getFrameSize();
      const w = fw * 0.45, h = fh * 0.6;
      const x = this.x - w/2;
      const y = this.y - h;
      return { x, y, w, h };
    }
    isAttackActive(){
      if (this.current !== 'attack') return false;
      const a = this.anim.get('attack'); if (!a || !a.sheet.loaded) return false;
      const total = a.total(); if (total <= 1) return false;
      const start = Math.floor(total * 0.3);
      const end   = Math.ceil(total * 0.7);
      const i = Math.max(0, Math.min(total-1, a.index|0));
      return i >= start && i <= end;
    }
    getHitbox(){
      if (!this.isAttackActive()) return null;
      const { fw, fh } = this.getFrameSize();
      const w = fw * 0.5, h = fh * 0.35;
      const y = this.y - fh * 0.75; // mid-upper body
      const facing = this.facing;
      const left = facing === 1 ? this.x + fw*0.1 : this.x - fw*0.1 - w;
      return { x: left, y, w, h };
    }
    takeDamage(dmg){ this.hp = Math.max(0, this.hp - (dmg|0)); }
    // Force a stun that plays the taunt animation once
  forceTauntStun(){
      if (this.anim.has('taunt')){
        this.stunned = true;
    this.set('taunt');
    // push next attack window out a bit after stun clears
    this._nextAtkAt = performance.now() + 800;
    this.hasHit = false;
      }
    }
  }

  // Scene setup
  let groundOffset = 60; // distance from bottom to ground
  const groundY = () => canvas.height - groundOffset;
  const player = new Fighter(canvas.width*0.33, groundY(), 1);
  const enemy  = new Fighter(canvas.width*0.67, groundY(), -1);
  // Make the enemy tougher (20% more than 150 -> 180)
  enemy.maxHp = 180;
  enemy.hp = enemy.maxHp;
  // Stronger mobile scale down
  const mq = window.matchMedia('(max-width: 680px)');
  function applyScale(){
    if (mq.matches){
      // Mobile: smaller characters and lower ground
      player.scale = 2.0; enemy.scale = 2.0;
      groundOffset = 28;
    } else {
      player.scale = SCALE; enemy.scale = SCALE;
      groundOffset = 60;
    }
  }
  applyScale();
  try { mq.addEventListener('change', applyScale); } catch { mq.addListener(applyScale); }

  // Match state
  let gameState = 'intro'; // 'intro' | 'countdown' | 'ready' | 'fight' | 'ko'
  let round = 1;
  let koAt = 0;
  let koWinner = null; // 'player' | 'enemy' | null
  let countdownEndAt = 0; // timestamp when countdown ends
  let readyPhaseEndAt = 0; // timestamp for ready/fight interstitial
  const centerEl = document.querySelector('.center');
  function setCenter(text){ if (centerEl) centerEl.textContent = text; }
  setCenter(`Round ${round}`);
  function startCountdown(seconds=3){
    gameState = 'countdown';
  koWinner = null;
    const now = performance.now();
    countdownEndAt = now + seconds*1000;
    // Hard stop movement and loops
    player.set('idle'); enemy.set('idle');
    player.audio?.walk?.stop(); enemy.audio?.walk?.stop();
    player.stunned = false; enemy.stunned = false;
  setCenter(`Round ${round}`);
  }
  function endRound(winner){
    if (gameState !== 'fight') return;
    gameState = 'ko';
    koAt = performance.now();
  koWinner = winner;
  // Clear any stun locks so KO animations can take over
  player.stunned = false;
  enemy.stunned = false;
    // Celebrate: winner taunt if available
    const w = winner === 'player' ? player : enemy;
    const l = winner === 'player' ? enemy : player;
    if (winner === 'player'){
      if (enemy.anim.has('giveup')) enemy.set('giveup'); else enemy.set('idle');
      if (player.anim.has('taunt')) player.set('taunt');
    } else {
      if (w.anim.has('taunt')) w.set('taunt'); else w.set('idle');
      l.set('idle');
    }
  player.audio?.walk?.stop();
  enemy.audio?.walk?.stop();
  setCenter('Press R or click to restart');
  }
  function resetRound(){
    round += 1;
    // Reset HP and positions
    player.hp = player.maxHp; enemy.hp = enemy.maxHp;
    player.x = canvas.width*0.33; enemy.x = canvas.width*0.67;
    player.facing = 1; enemy.facing = -1;
    player.set('idle'); enemy.set('idle');
  player.audio?.walk?.stop();
  enemy.audio?.walk?.stop();
    updateHud();
    setCenter(`Round ${round}`);
    startCountdown(3);
  }

  // Sheets (now expecting 80x80 tiles)
  const soapIdle  = new SpriteSheet('spritesheets/Characters/soap/soapidle_1.png', 80, 80);
  const soapAtk   = new SpriteSheet('spritesheets/Characters/soap/soapattack_8.png', 80, 80);
  const soapTaunt = new SpriteSheet('spritesheets/Characters/soap/soaptaunt_6.png', 80, 80);
  const manIdle   = new SpriteSheet('spritesheets/Characters/man/animations/idle/idle_4.png', 80, 80);
  const manWalk   = new SpriteSheet('spritesheets/Characters/man/animations/movement/walkright_6.png', 80, 80);
  const manAtk    = new SpriteSheet('spritesheets/Characters/man/animations/attack/attack_6.png', 80, 80);
  const manTaunt  = new SpriteSheet('spritesheets/Characters/man/animations/taunt/taunt_8.png', 80, 80);
  const manGiveup = new SpriteSheet('spritesheets/Characters/man/animations/giveup/giveup_10.png', 80, 80);

  // Animations (frameCount 0 = all tiles; override if sheets contain extra blank tiles)
  player.add('idle',   new Animation(soapIdle,  { frameCount: 0, fps: 8,  loop: true }));
  player.add('attack', new Animation(soapAtk,   { frameCount: 0, fps: 12, loop: false }));
  player.add('taunt',  new Animation(soapTaunt, { frameCount: 0, fps: 8,  loop: false }));

  enemy.add('idle',    new Animation(manIdle,   { frameCount: 0, fps: 8,  loop: true }));
  enemy.add('walk',    new Animation(manWalk,   { frameCount: 0, fps: 10, loop: true }));
  enemy.add('attack',  new Animation(manAtk,    { frameCount: 0, fps: 10, loop: false }));
  enemy.add('taunt',   new Animation(manTaunt,  { frameCount: 0, fps: 8,  loop: false }));
  enemy.add('giveup',  new Animation(manGiveup, { frameCount: 0, fps: 8,  loop: false }));

  player.set('idle'); enemy.set('idle');

  // Attach sounds (optional files under ./audio)
  function makeSounds(prefix){
    const base = (name) => [
      `audio/${prefix}_${name}.wav`,
      `audio/${prefix}_${name}.mp3`,
      `audio/${prefix}_${name}.ogg`,
    ];
    const isMan = prefix === 'man';
    return {
      walk:   new Sound(base('walk'),   { loop: true, volume: 0.35 }),
      // Lower man attack volume (~15% then another ~15%): 0.9 -> 0.765 -> ~0.65
      attack: new Sound(base('attack'), { volume: isMan ? 0.65 : 0.9 }),
      taunt:  new Sound(base('taunt'),  { volume: 0.9 }),
    };
  }
  player.audio = makeSounds('soap');
  enemy.audio  = makeSounds('man');

  // HUD elements
  const hpP = document.getElementById('hpPlayer');
  const hpE = document.getElementById('hpEnemy');
  function updateHud(){
    if (hpP) hpP.style.width = Math.max(0, Math.min(100, (player.hp/player.maxHp)*100)).toFixed(1) + '%';
    if (hpE) hpE.style.width = Math.max(0, Math.min(100, (enemy.hp/enemy.maxHp)*100)).toFixed(1) + '%';
  }

  // Collision helpers
  function intersects(a,b){ return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  // Input
  const keys = new Set();
  window.addEventListener('keydown', (e)=>{
    const codes = ['ArrowLeft','ArrowRight','Space','KeyT'];
    if (codes.includes(e.code)) { keys.add(e.code); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e)=> keys.delete(e.code));
  // Mobile buttons (present only on small screens)
  const btnAttack = document.getElementById('btnAttack');
  const btnTaunt  = document.getElementById('btnTaunt');
  if (btnAttack) btnAttack.addEventListener('click', ()=>{ if (gameState === 'fight') player.set('attack'); });
  if (btnTaunt) btnTaunt.addEventListener('click', ()=>{ if (gameState === 'fight'){ player.set('taunt'); enemy.forceTauntStun(); } });
  // Restart on R key or click when KO
  window.addEventListener('keydown', (e)=>{
    if (gameState === 'ko' && e.code === 'KeyR') { e.preventDefault(); resetRound(); }
  });
  canvas.addEventListener('click', ()=>{ if (gameState === 'ko') resetRound(); });

  function handleInput(dt){
  if (gameState !== 'fight') return;
    const speed = 160; // px/s
    if (keys.has('ArrowLeft'))  { player.x -= speed*dt/1000; player.facing = -1; }
    if (keys.has('ArrowRight')) { player.x += speed*dt/1000; player.facing = 1; }
    if (keys.has('Space'))      { player.set('attack'); }
    if (keys.has('KeyT'))       {
      player.set('taunt');
  // Stun enemy immediately with taunt animation
  enemy.forceTauntStun();
    }
    player.x = clamp(player.x, 40, canvas.width-40);
  }

  // Loop
  let last = performance.now();
  function loop(now = performance.now()){
    const dt = Math.min(50, now - last); last = now;
    handleInput(dt);
    player.y = groundY(); enemy.y = groundY();
  // Handle countdown state
    if (gameState === 'countdown'){
      // Stay idle and locked until time passes
      if (now >= countdownEndAt){
        // Move into short READY phase
        gameState = 'ready';
        readyPhaseEndAt = now + 1400; // 700ms READY + 700ms FIGHT!
        player.set('idle'); enemy.set('idle');
        player.audio?.walk?.stop(); enemy.audio?.walk?.stop();
      } else {
        // Skip AI and combat while counting down
      }
    }
    // Ready/Fight interstitial (locked)
    if (gameState === 'ready'){
      const elapsed = Math.max(0, (readyPhaseEndAt - now));
      if (elapsed <= 0){
        gameState = 'fight';
        setCenter('');
      }
    }
  // Enemy AI during fight: approach and attack
  if (gameState === 'fight'){
      if (!enemy.stunned){
      const dx = player.x - enemy.x;
      const dist = Math.abs(dx);
      enemy.facing = dx < 0 ? -1 : 1;
  const walkSpeed = 100; // px/s for AI
      const attackRange = 70; // world px
      const withinAttack = dist <= attackRange;
      // Avoid overriding current attack
      if (enemy.current !== 'attack'){
        if (!withinAttack){
          enemy.set('walk');
          enemy.x += Math.sign(dx) * walkSpeed * dt/1000;
        } else {
          enemy.set('idle');
          // Randomized small cooldown via timestamp check stored on enemy
          const nowMs = now;
          if (!enemy._nextAtkAt || nowMs >= enemy._nextAtkAt){
            enemy.set('attack');
            enemy._nextAtkAt = nowMs + 900; // 0.9s between attacks
          }
        }
        enemy.x = clamp(enemy.x, 40, canvas.width-40);
      }
      }
    }

    player.update(dt); enemy.update(dt);
    // Return from taunt to idle only during fight (not during KO)
    if (gameState === 'fight'){
      if (player.current === 'taunt' && player.anim.get('taunt')?.done) player.set('idle');
      if (enemy.current === 'taunt' && enemy.anim.get('taunt')?.done){
        enemy.stunned = false;
        enemy.set('idle');
      }
    }
  if (gameState === 'fight'){
      // Don't override taunt with AI while taunting
      const enemyIsBusy = enemy.stunned || enemy.current === 'attack' || enemy.current === 'taunt';
      if (!enemyIsBusy){
        // Combat AI (approach/attack)
        const dx = player.x - enemy.x;
        const dist = Math.abs(dx);
        enemy.facing = dx < 0 ? -1 : 1;
  const walkSpeed = 100; // px/s
        const attackRange = 70; // px
        const withinAttack = dist <= attackRange;
        if (enemy.current !== 'attack'){
          if (!withinAttack){
            enemy.set('walk');
            enemy.x += Math.sign(dx) * walkSpeed * dt/1000;
          } else {
            enemy.set('idle');
            const nowMs = now;
            if (!enemy._nextAtkAt || nowMs >= enemy._nextAtkAt){
              enemy.set('attack');
              enemy._nextAtkAt = nowMs + 900;
            }
          }
          enemy.x = clamp(enemy.x, 40, canvas.width-40);
        }
      }
      // Combat: player attack hitting enemy
      const pHit = player.getHitbox();
      const eHurt = enemy.getHurtbox();
      if (pHit && !player.hasHit && intersects(pHit, eHurt)){
        enemy.takeDamage(player.damage);
        player.hasHit = true;
      }
      // Enemy attack hitting player
      const eHit = enemy.getHitbox();
      const pHurt = player.getHurtbox();
      if (eHit && !enemy.hasHit && intersects(eHit, pHurt)){
        player.takeDamage(enemy.damage);
        enemy.hasHit = true;
      }
      if (enemy.hp <= 0){ endRound('player'); }
      if (player.hp <= 0){ endRound('enemy'); }
      updateHud();
    } else if (gameState === 'ko'){
      // Wait for user to restart (R key or click)
    }

    // Draw
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const g = ctx.createLinearGradient(0,0,0,canvas.height);
    g.addColorStop(0,'#0f172a'); g.addColorStop(1,'#111827');
    ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#0b1321'; ctx.fillRect(0, groundY(), canvas.width, canvas.height-groundY());

    player.draw(ctx); enemy.draw(ctx);
    // Countdown overlay
    if (gameState === 'countdown'){
      const remainingMs = Math.max(0, countdownEndAt - now);
      const secs = Math.ceil(remainingMs/1000);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      // Number
      ctx.fillStyle = '#93c5fd';
      ctx.font = 'bold 72px system-ui, Segoe UI, Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cx = canvas.width/2;
      const cy = canvas.height/2;
      ctx.fillText(String(secs), cx, cy);
      // Tooltip under the numbers
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 16px system-ui, Segoe UI, Arial';
      ctx.textBaseline = 'top';
      ctx.fillText('Tool-Tip: use taunt to stun the scammer', cx, cy + 40);
      ctx.restore();
    }
    // Ready/Fight overlay
    if (gameState === 'ready'){
      const total = 1400; // ms
      const remaining = Math.max(0, readyPhaseEndAt - now);
      const passed = total - remaining;
      const showFight = passed >= 700; // second half shows FIGHT!
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 64px system-ui, Segoe UI, Arial';
      ctx.fillStyle = showFight ? '#fca5a5' : '#bbf7d0';
      ctx.fillText(showFight ? 'FIGHT!' : 'READY', canvas.width/2, canvas.height/2);
      ctx.restore();
    }
    // Intro dim (game is locked beneath intro panel)
    if (gameState === 'intro'){
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.restore();
    }
    // KO banner overlay
    if (gameState === 'ko'){
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 64px system-ui, Segoe UI, Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const banner = koWinner === 'player' ? 'RETRIEVED' : 'DRAINED';
      ctx.fillText(banner, canvas.width/2, canvas.height/2);
      ctx.font = '600 20px system-ui, Segoe UI, Arial';
      ctx.fillStyle = '#e5e7eb';
  ctx.fillText('Press R or click to restart', canvas.width/2, canvas.height/2 + 48);
      ctx.restore();
    }
    // Optional: debug hitboxes (toggle to true to visualize)
    const DEBUG = false;
    if (DEBUG){
      const hbP = player.getHurtbox(); const hbE = enemy.getHurtbox();
      ctx.save(); ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#22c55e'; ctx.fillRect(hbP.x, hbP.y, hbP.w, hbP.h);
      ctx.fillStyle = '#ef4444'; ctx.fillRect(hbE.x, hbE.y, hbE.w, hbE.h);
      const pAtk = player.getHitbox(); if (pAtk){ ctx.fillStyle = '#fde047'; ctx.fillRect(pAtk.x, pAtk.y, pAtk.w, pAtk.h); }
      ctx.restore();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // Wire Start button to begin countdown from intro screen
  const introEl = document.getElementById('intro');
  const startBtn = document.getElementById('startBtn');
  if (startBtn){
    startBtn.addEventListener('click', () => {
      if (introEl) introEl.style.display = 'none';
      startCountdown(3);
    });
  }
})();

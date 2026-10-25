/* ============ 特效：粒子 / 弹道 / 冲击环 / 飘字 / 光影 ============ */
const FX = {
  scene: null,
  _pMax: 900,
  _pPos: null, _pCol: null, _pSlots: [], _pCursor: 0,
  _points: null,
  _projectiles: [],
  _rings: [], _ringPool: [],
  _texts: [], _textPool: [],
  _punches: [],
  _glowTex: null,
  _lights: [], _decals: [], _flashes: [], _pillars: [], _beams: [],
  _enemyLights: [],
  _geo: null, _snowTex: null,

  init(scene) {
    this.scene = scene;

    // 粒子系统（加色混合，颜色衰减到黑即消失）
    this._pPos = new Float32Array(this._pMax * 3);
    this._pCol = new Float32Array(this._pMax * 3);
    for (let i = 0; i < this._pMax; i++) {
      this._pPos[i * 3 + 1] = -999;
      this._pSlots.push({ active: false, vel: new THREE.Vector3(), life: 0, max: 1, r: 1, g: 1, b: 1, grav: 0 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._pCol, 3));
    this._points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.32, map: this.glowTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this._points.frustumCulled = false;
    scene.add(this._points);

    // 冲击环对象池
    for (let i = 0; i < 10; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.6, 36),
        new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      this._ringPool.push({ mesh: ring, life: 0, max: 1, maxR: 3 });
    }

    // 飘字对象池
    for (let i = 0; i < 16; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false }));
      sprite.visible = false;
      scene.add(sprite);
      this._textPool.push({ sprite, life: 0, max: 1, vy: 0 });
    }

    // 点光闪光池（intensity 0 常驻场景，避免运行时增删灯光触发 shader 重编译）
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 7.5, 2);
      scene.add(l);
      this._lights.push({ light: l, life: 0, max: 1, peak: 2 });
    }

    // 怪物夜光灯光池（同样常驻 intensity 0，按出怪顺序分配给活着的怪）
    for (let i = 0; i < CFG.ENEMY_GLOW.pool; i++) {
      const l = new THREE.PointLight(CFG.ENEMY_GLOW.color, 0, CFG.ENEMY_GLOW.dist, 2);
      scene.add(l);
      this._enemyLights.push(l);
    }

    // 地面光斑池（加色径向渐变贴花）
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
        map: this.glowTexture(), color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this._decals.push({ mesh: m, life: 0, max: 1, maxR: 1 });
    }

    // 快闪光晕池
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture(), color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      s.visible = false;
      scene.add(s);
      this._flashes.push({ sprite: s, life: 0, max: 1, scale: 1 });
    }

    // 圣光柱池（开口圆柱，加色）
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.62, 1, 12, 1, true);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({
        color: 0xffe9a0, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      m.visible = false;
      scene.add(m);
      this._pillars.push({ mesh: m, life: 0, max: 1, h: 3, r: 0.5 });
    }

    // 圣光天降光柱池（升级动画：光柱从天而降 → 照耀 → 消散，各带专用点光）
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({
        color: 0xffe9a0, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      m.visible = false;
      scene.add(m);
      const l = new THREE.PointLight(0xffe9a0, 0, 11, 2);
      scene.add(l);
      this._beams.push({ mesh: m, light: l, life: 0, max: 1, base: new THREE.Vector3(), h: 9, r: 0.55, sparkT: 0 });
    }

    // 弹道共享几何（避免每发 new 泄漏）
    this._geo = {
      arrowShaft: new THREE.CylinderGeometry(0.03, 0.03, 0.62, 5).rotateX(Math.PI / 2),
      arrowTip: new THREE.ConeGeometry(0.05, 0.16, 5).rotateX(Math.PI / 2),
      orb: new THREE.SphereGeometry(0.16, 8, 8)
    };
  },

  /* 径向渐变光点纹理（粒子/光晕共用） */
  glowTexture() {
    if (this._glowTex) return this._glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,.65)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this._glowTex = new THREE.CanvasTexture(c);
    return this._glowTex;
  },

  makeGlow(colorHex, scale = 0.6, boost = 1.2) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture(), color: colorHex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    s.material.color.multiplyScalar(boost);
    s.scale.setScalar(scale);
    return s;
  },

  /* 怪物夜光：按出怪顺序把常驻灯光池分配给活着的怪（白天极弱、黑夜全亮；无怪时平滑熄灭） */
  updateEnemyLights(enemies, dt) {
    const cfg = CFG.ENEMY_GLOW;
    const nightK = 0.35 + 0.65 * (Env.night || 0);
    const lerp = Math.min(1, dt * 8);
    let i = 0;
    for (const e of enemies) {
      if (e.cfg.ownLight || i >= this._enemyLights.length) continue;
      const l = this._enemyLights[i++];
      l.color.setHex(cfg.colors[e.type] || cfg.color);
      const h = e.mesh.userData.height || 1.2;
      l.position.set(e.mesh.position.x, e.mesh.position.y + h * 0.7, e.mesh.position.z);
      l.intensity += (cfg.intensity * nightK - l.intensity) * lerp;
    }
    for (; i < this._enemyLights.length; i++) {
      const l = this._enemyLights[i];
      l.intensity += (0 - l.intensity) * lerp;
    }
  },

  /* 六角雪花纹理（减速状态图标用） */
  snowTexture() {
    if (this._snowTex) return this._snowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.translate(32, 32);
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.save();
      ctx.rotate(a);
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -26); ctx.stroke();
      ctx.lineWidth = 2.6;
      for (const [len, spread] of [[15, 7], [23, 5]]) {   // 主枝两侧的分叉
        ctx.beginPath();
        ctx.moveTo(0, -len); ctx.lineTo(-spread, -len - spread * 0.9);
        ctx.moveTo(0, -len); ctx.lineTo(spread, -len - spread * 0.9);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
    this._snowTex = new THREE.CanvasTexture(c);
    return this._snowTex;
  },

  /* 雪花状态图标（减速） */
  makeSnow(colorHex, scale = 0.55) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.snowTexture(), color: colorHex, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    s.scale.setScalar(scale);
    return s;
  },

  /* ---------- 粒子爆发 ---------- */
  burst(pos, colorHex, opts = {}) {
    const count = opts.count || 10;
    const speed = opts.speed || 3;
    const life = opts.life || 0.6;
    const grav = opts.gravity !== undefined ? opts.gravity : 5;
    const col = new THREE.Color(colorHex);
    const up = opts.up !== undefined ? opts.up : 0.5;

    for (let n = 0; n < count; n++) {
      const i = this._pCursor;
      this._pCursor = (this._pCursor + 1) % this._pMax;
      const p = this._pSlots[i];
      p.active = true;
      p.max = p.life = life * Utils.rand(0.6, 1.2);
      p.grav = grav;
      const theta = Utils.rand(0, Math.PI * 2);
      const phi = Math.acos(Utils.rand(-1, 1));
      const s = speed * Utils.rand(0.35, 1);
      p.vel.set(Math.sin(phi) * Math.cos(theta) * s, Math.cos(phi) * s + up * s, Math.sin(phi) * Math.sin(theta) * s);
      const k = Utils.rand(0.7, 1.1);
      p.r = col.r * k; p.g = col.g * k; p.b = col.b * k;
      this._pPos[i * 3] = pos.x + Utils.rand(-0.1, 0.1);
      this._pPos[i * 3 + 1] = pos.y + Utils.rand(-0.1, 0.1);
      this._pPos[i * 3 + 2] = pos.z + Utils.rand(-0.1, 0.1);
    }
  },

  /* ---------- 弹道 ---------- */
  // kind: 'frost' | 'arrow' | 'shadow'；color/scale 可按英雄等级覆盖默认色与体积；target 为敌人对象，onHit(命中位置)
  projectile(opts) {
    let mesh;
    if (opts.kind === 'arrow') {
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this._geo.arrowShaft, MatCache.get(0xc9a06a)));
      const tip = new THREE.Mesh(this._geo.arrowTip, new THREE.MeshBasicMaterial({ color: 0xdfe8ff }));
      tip.position.z = 0.38;
      mesh.add(tip);
      const gl = this.makeGlow(opts.color || 0x9d7bff, 0.4);
      gl.position.z = 0.3;
      mesh.add(gl);
      if (opts.scale && opts.scale !== 1) mesh.scale.setScalar(opts.scale);
    } else {
      const color = opts.color || (opts.kind === 'shadow' ? 0xb04ae8 : 0x8fd8ff);
      mesh = new THREE.Mesh(
        this._geo.orb,
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      mesh.material.color.setHex(color).lerp(new THREE.Color(0xffffff), 0.4).multiplyScalar(1.5);
      mesh.add(this.makeGlow(color, 1.0 * (opts.scale || 1)));
      if (opts.scale && opts.scale !== 1) mesh.scale.setScalar(opts.scale);
    }
    mesh.position.copy(opts.from);
    this.scene.add(mesh);

    this._projectiles.push({
      mesh, kind: opts.kind, color: opts.color || null,
      target: opts.target, speed: opts.speed || 10,
      onHit: opts.onHit, life: 4,
      last: opts.target ? opts.target.mesh.position.clone() : opts.from.clone(),
      trailT: 0,
      trailEvery: opts.kind === 'arrow' ? 0.07 : 0.035
    });
  },

  /* ---------- 冲击环 ---------- */
  ring(pos, colorHex, maxRadius = 3, life = 0.5) {
    const r = this._ringPool.find(r => r.life <= 0) || this._ringPool[0];
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, (pos.y || 0) + 0.08, pos.z);
    r.mesh.material.color.setHex(colorHex).multiplyScalar(1.5);
    r.life = r.max = life;
    r.maxR = maxRadius;
    r.mesh.scale.setScalar(0.2);
  },

  /* ---------- 点光闪光：快起慢落，照亮周围地面与角色 ---------- */
  light(pos, colorHex, opts = {}) {
    const e = this._lights.find(l => l.life <= 0) || this._lights[0];
    e.light.position.copy(pos);
    e.light.color.setHex(colorHex);
    e.peak = opts.intensity !== undefined ? opts.intensity : CFG.FX.light.intensity;
    e.light.distance = opts.dist || CFG.FX.light.dist;
    e.life = e.max = opts.life || CFG.FX.light.life;
    e.light.intensity = e.peak;
  },

  /* ---------- 地面光斑贴花：命中区域 / 奉献圈 ---------- */
  groundGlow(pos, colorHex, radius = 1.5, life = 0.55) {
    const d = this._decals.find(d => d.life <= 0) || this._decals[0];
    d.mesh.visible = true;
    d.mesh.position.set(pos.x, 0.07, pos.z);
    d.mesh.material.color.setHex(colorHex).multiplyScalar(1.35);
    d.life = d.max = life;
    d.maxR = radius;
    d.mesh.scale.setScalar(radius * 0.35);
    d.mesh.material.opacity = 0.85;
  },

  /* ---------- 快闪光晕：施法口 / 命中点爆闪 ---------- */
  flash(pos, colorHex, scale = 1.2, life = 0.28) {
    const g = this._flashes.find(g => g.life <= 0) || this._flashes[0];
    g.sprite.visible = true;
    g.sprite.position.copy(pos);
    g.sprite.material.color.setHex(colorHex).multiplyScalar(1.5);
    g.life = g.max = life;
    g.scale = scale;
    g.sprite.scale.setScalar(scale * 0.5);
    g.sprite.material.opacity = 1;
  },

  /* ---------- 圣光柱：竖直光柱冲天 ---------- */
  pillar(pos, colorHex, opts = {}) {
    const p = this._pillars.find(p => p.life <= 0) || this._pillars[0];
    const h = opts.height || 3.2, r = opts.radius || 0.5;
    p.mesh.visible = true;
    p.mesh.position.set(pos.x, h / 2, pos.z);
    p.mesh.scale.set(r / 0.5, h, r / 0.5);
    p.mesh.material.color.setHex(colorHex).multiplyScalar(1.4);
    p.life = p.max = opts.life || 0.32;
    p.h = h; p.r = r;
    p.mesh.material.opacity = 0.75;
  },

  /* ---------- 圣光天降（升级动画）：光柱自天而降 → 照耀英雄 → 消散 ---------- */
  // pos 为英雄脚下锚点；opts: { radius, height, life, onShine(照耀开始回调一次) }
  holyBeam(pos, colorHex, opts = {}) {
    const b = this._beams.find(b => b.life <= 0) || this._beams[0];
    b.h = opts.height || 9;
    b.r = opts.radius || 0.55;
    b.base.copy(pos);                       // 英雄脚下
    b.life = b.max = opts.life || 1.8;
    b.sparkT = 0;
    b.color = colorHex;
    b.onShine = opts.onShine || null;
    b.shineFired = false;
    b.mesh.visible = true;
    b.mesh.material.color.setHex(colorHex).multiplyScalar(1.35);
    b.light.color.setHex(colorHex);
    b.light.intensity = 0;
    this._applyBeamPhase(b, 0);
  },

  // 按 elapsed 推进光柱三阶段：降落(0~0.3s) / 照耀(0.3~1.25s) / 消散(1.25s~)
  _applyBeamPhase(b, e) {
    const m = b.mesh, h = b.h;
    const topY = b.base.y + h;
    if (e < 0.3) {                          // ① 从天而降：顶端钉在天上，底端向下延伸到英雄
      const k = e / 0.3;
      const sy = 0.04 + 0.96 * k * k * (3 - 2 * k);
      m.scale.set(b.r / 0.5, sy * h, b.r / 0.5);
      m.position.set(b.base.x, topY - sy * h / 2, b.base.z);
      m.material.opacity = 0.85 * k;
    } else if (e < 1.25) {                  // ② 照耀：全柱脉冲，金光笼罩英雄
      if (!b.shineFired) { b.shineFired = true; if (b.onShine) b.onShine(); }
      const pulse = 0.78 + 0.1 * Math.sin(e * 14);
      m.scale.set(b.r / 0.5, h, b.r / 0.5);
      m.position.set(b.base.x, topY - h / 2, b.base.z);
      m.material.opacity = 0.85 * pulse;
      b.light.intensity = Math.min((e - 0.3) / 0.15, 1) * 3.2;
    } else {                                // ③ 消散：淡出 + 微微扩散
      const k = Math.max(1 - (e - 1.25) / (b.max - 1.25), 0);
      const spread = 1 + 0.5 * (1 - k);
      m.scale.set((b.r / 0.5) * spread, h, (b.r / 0.5) * spread);
      m.position.set(b.base.x, topY - h / 2, b.base.z);
      m.material.opacity = 0.85 * k;
      b.light.intensity = 3.2 * k * k;
    }
  },

  /* ---------- 飘字 ---------- */
  floatText(pos, text, color = '#ffd257', size = 1) {
    const t = this._textPool.find(t => t.life <= 0) || this._textPool[0];
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 46px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.strokeText(text, 128, 50);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(canvas);
    if (t.sprite.material.map) t.sprite.material.map.dispose();
    t.sprite.material.map = tex;
    t.sprite.material.needsUpdate = true;
    t.sprite.visible = true;
    t.sprite.position.set(pos.x, pos.y, pos.z);
    t.sprite.scale.set(2.6 * size, 0.98 * size, 1);
    t.life = t.max = 1.35;
    t.vy = 1.1;
  },

  /* ---------- 受击缩放反馈 ---------- */
  punch(mesh) {
    this._punches.push({ mesh, t: 0.14, base: mesh.userData.baseScale || 1 });
  },

  update(dt) {
    // 粒子
    for (let i = 0; i < this._pMax; i++) {
      const p = this._pSlots[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this._pPos[i * 3 + 1] = -999;
        continue;
      }
      p.vel.y -= p.grav * dt;
      this._pPos[i * 3] += p.vel.x * dt;
      this._pPos[i * 3 + 1] += p.vel.y * dt;
      this._pPos[i * 3 + 2] += p.vel.z * dt;
      if (this._pPos[i * 3 + 1] < 0.03) { this._pPos[i * 3 + 1] = 0.03; p.vel.y *= -0.35; p.vel.x *= 0.8; p.vel.z *= 0.8; }
      const k = Math.max(p.life / p.max, 0);
      this._pCol[i * 3] = p.r * k;
      this._pCol[i * 3 + 1] = p.g * k;
      this._pCol[i * 3 + 2] = p.b * k;
    }
    this._points.geometry.attributes.position.needsUpdate = true;
    this._points.geometry.attributes.color.needsUpdate = true;

    // 弹道
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const pr = this._projectiles[i];
      pr.life -= dt;
      if (pr.target && pr.target.alive) pr.last.copy(pr.target.mesh.position).y += 0.55;
      const to = pr.last;
      const dir = new THREE.Vector3().subVectors(to, pr.mesh.position);
      const dist = dir.length();
      const step = pr.speed * dt;

      pr.trailT -= dt;
      if (pr.trailT <= 0) {
        pr.trailT = pr.trailEvery;
        const tc = pr.color || (pr.kind === 'shadow' ? 0xb04ae8 : pr.kind === 'arrow' ? 0xcfd8e8 : 0x8fd8ff);
        this.burst(pr.mesh.position, tc, { count: 1, speed: 0.4, life: 0.3, gravity: 0, up: 0 });
      }
      if (dist <= step + 0.25 || pr.life <= 0) {
        if (pr.onHit && pr.life > 0) pr.onHit(pr.mesh.position.clone());
        this.scene.remove(pr.mesh);
        this._projectiles.splice(i, 1);
        continue;
      }
      dir.normalize();
      pr.mesh.position.addScaledVector(dir, step);
      if (pr.kind === 'arrow') {
        pr.mesh.lookAt(to);
      } else {
        pr.mesh.rotation.y += dt * 6;
      }
    }

    // 冲击环
    for (const r of this._ringPool) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = Math.max(r.life / r.max, 0);
      const grow = 1 - k;
      r.mesh.scale.setScalar(0.2 + grow * r.maxR);
      r.mesh.material.opacity = k * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }

    // 点光闪光（平方衰减）
    for (const e of this._lights) {
      if (e.life <= 0) continue;
      e.life -= dt;
      const k = Math.max(e.life / e.max, 0);
      e.light.intensity = e.peak * k * k;
      if (e.life <= 0) e.light.intensity = 0;
    }

    // 地面光斑（扩散 + 淡出）
    for (const d of this._decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const k = Math.max(d.life / d.max, 0);
      d.mesh.scale.setScalar(d.maxR * (0.35 + 0.65 * (1 - k)));
      d.mesh.material.opacity = k * 0.85;
      if (d.life <= 0) d.mesh.visible = false;
    }

    // 快闪光晕（放大 + 淡出）
    for (const g of this._flashes) {
      if (g.life <= 0) continue;
      g.life -= dt;
      const k = Math.max(g.life / g.max, 0);
      g.sprite.scale.setScalar(g.scale * (0.5 + (1 - k) * 0.8));
      g.sprite.material.opacity = k;
      if (g.life <= 0) g.sprite.visible = false;
    }

    // 圣光柱（收缩淡出）
    for (const p of this._pillars) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = Math.max(p.life / p.max, 0);
      p.mesh.material.opacity = k * 0.75;
      p.mesh.scale.x = p.mesh.scale.z = (p.r / 0.5) * (0.6 + 0.4 * k);
      if (p.life <= 0) p.mesh.visible = false;
    }

    // 圣光天降（升级动画）：照耀阶段金粒上升 + 地面金环，三阶段推进，结束时圣光消失
    for (const b of this._beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const e = b.max - Math.max(b.life, 0);
      this._applyBeamPhase(b, e);
      if (e >= 0.3 && e < 1.25) {
        b.sparkT -= dt;
        if (b.sparkT <= 0) {              // 圣光笼罩：金粒自英雄脚下升腾
          b.sparkT = 0.1;
          const ang = Utils.rand(0, Math.PI * 2), rr = Utils.rand(0.1, b.r + 0.3);
          this.burst(new THREE.Vector3(b.base.x + Math.cos(ang) * rr, b.base.y + 0.3, b.base.z + Math.sin(ang) * rr),
            b.color, { count: 2, speed: 0.6, life: 0.7, gravity: -1.6, up: 2.2 });
        }
        if (!b.ringFired || b.ringFired < e - 0.55) {   // 照耀期间每 0.55s 一圈地面金环
          b.ringFired = e;
          this.ring(b.base, b.color, b.r * 4.5, 0.6);
        }
      }
      if (b.life <= 0) { b.mesh.visible = false; b.light.intensity = 0; b.ringFired = 0; }
    }

    // 飘字
    for (const t of this._textPool) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.sprite.position.y += t.vy * dt;
      t.vy *= 0.96;
      t.sprite.material.opacity = Math.min(t.life / (t.max * 0.45), 1);
      if (t.life <= 0) t.sprite.visible = false;
    }

    // 受击缩放
    for (let i = this._punches.length - 1; i >= 0; i--) {
      const p = this._punches[i];
      p.t -= dt;
      const k = Math.max(p.t / 0.14, 0);
      p.mesh.scale.setScalar(p.base * (1 + 0.22 * k));
      if (p.t <= 0) this._punches.splice(i, 1);
    }
  }
};

/* ============ 游戏核心：状态机 / 战斗 / 交互 / 主循环 ============ */
const HINT_DEFAULT = '点击英雄查看技能与射程　|　左键拖拽旋转视角　|　右键平移　|　滚轮缩放　|　空格：下一波　Esc：取消';
const SLOW_TINT = new THREE.Color(0x9fd4ff);   // 减速冰蓝染色
const POISON_COLOR = 0x7ed957;                 // 毒箭毒雾/状态图标（区别于暗言术紫）

const Game = {
  state: {
    points: CFG.START_POINTS, lives: CFG.LIVES, wave: 0, kills: 0,
    level: 1, phase: 'arrange', speed: 1, paused: false
  },
  order: ['mage', 'hunter', 'paladin', 'priest'],   // 站位 1-4 的英雄排列顺序
  heroLevels: { mage: 1, hunter: 1, paladin: 1, priest: 1 },
  heroXp: { mage: 0, hunter: 0, paladin: 0, priest: 0 },   // 各英雄当前经验（击杀者获得）
  selectedTower: null,
  towers: [],
  enemies: [],
  spawnQueue: [],
  waveClock: 0,
  waveTimer: Infinity,   // build 阶段倒计时（手动开波时为无限）
  time: 0,

  renderer: null, scene: null, camera: null, cam: null,
  raycaster: null, mouseNDC: new THREE.Vector2(),
  hoverPlot: null,
  selectRing: null, _downPos: null,

  /* ================= 初始化 ================= */
  init() {
    const container = document.getElementById('game-container');

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x88b6dd);
    this.scene.fog = new THREE.Fog(0x88b6dd, 75, 160);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
    this.cam = new CamControls(this.camera, this.renderer.domElement);
    this.cam.theta = CFG.CAMERA.theta; this.cam.phi = CFG.CAMERA.phi; this.cam.radius = CFG.CAMERA.radius;
    this.cam.target.set(...CFG.CAMERA.target);
    this.cam.updateCamera();

    World.init(this.scene);
    FX.init(this.scene);
    UI.init(this);

    // Bloom 辉光后处理（CFG.FX.bloom.enabled 可整体关闭回退直渲）
    if (CFG.FX.bloom.enabled && THREE.EffectComposer) {
      const b = CFG.FX.bloom;
      this.composer = new THREE.EffectComposer(this.renderer);
      this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), b.strength, b.radius, b.threshold
      );
      this.composer.addPass(this.bloomPass);
    }

    this.raycaster = new THREE.Raycaster();
    this._bindPointer();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('pointerdown', () => AudioSys.init(), { once: false });

    UI.setPoints(this.state.points);
    UI.setLives(this.state.lives);
    UI.setWave(0);
    UI.setKills(0);
    this._placeHeroes();   // 布阵预览：4 位英雄先站上城墙坑位
    UI.showArrange();

    const clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      const ph = this.state.phase;
      if (!this.state.paused && ph !== 'over') {
        const sdt = dt * this.state.speed;
        this.time += sdt;
        FX.update(sdt);                 // 特效在布阵/结算阶段也保持（升级特效不再冻结）
        this._updateTowers(sdt);        // 英雄待机/施法动画（场上无敌人时只会空转待机）
        if (ph !== 'inter' && ph !== 'arrange') {
          this._updateWaves(sdt);
          this._updateEnemies(sdt);
          World.update(sdt, this.time);
        }
      }
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    };
    loop();
  },

  /* ================= 指针交互 ================= */
  _bindPointer() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', (e) => {
      this.mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this._updateHover();
    });
    dom.addEventListener('pointerdown', (e) => { this._downPos = { x: e.clientX, y: e.clientY, button: e.button }; });
    dom.addEventListener('pointerup', (e) => {
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
      const btn = this._downPos.button;
      this._downPos = null;
      if (btn !== 0 || moved > 6) return;
      this.mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this._handleClick();
    });
  },

  _pickPlot() {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const pads = World.plots.map(p => p.pad);
    const hits = this.raycaster.intersectObjects(pads, false);
    return hits.length ? hits[0].object.userData.plot : null;
  },

  _updateHover() {
    const plot = this._pickPlot();
    if (plot !== this.hoverPlot) {
      if (this.hoverPlot) World.setPlotHover(this.hoverPlot, false);
      this.hoverPlot = plot;
      if (plot) World.setPlotHover(plot, true);
    }
  },

  _handleClick() {
    const ph = this.state.phase;
    if (ph === 'over' || ph === 'inter' || ph === 'arrange') return;
    const plot = this._pickPlot();
    if (!plot || !plot.tower) { this.deselectTower(); return; }
    this.selectTower(plot.tower);
  },

  /* ================= 英雄布阵 / 升级 ================= */
  _placeHeroes() {
    for (const t of this.towers) {
      if (t.group) this.scene.remove(t.group);
      t.plot.tower = null;
      t.plot.ring.visible = true;
    }
    this.towers = [];
    World.plots.forEach((plot, i) => {
      const type = this.order[i];
      const tower = { type, level: this.heroLevels[type], plot, group: null, head: null, cooldown: 0.3 };
      this._spawnTowerMesh(tower);
      plot.tower = tower;
      plot.ring.visible = false;
      this.towers.push(tower);
    });
  },

  // 交换两个坑位的英雄（站位顺序即 order 数组）
  swapSlots(i, j) {
    if (i === j || i < 0 || j < 0 || i >= this.order.length || j >= this.order.length) return;
    [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    this._placeHeroes();
    AudioSys.play('build');
  },

  // 关卡结算画面：用积分购买经验（满级不可用）
  buyXp(type) {
    if (this.state.phase !== 'inter') return;
    const t = this.towers.find(tw => tw.type === type);
    if (!t || t.level >= CFG.TOWERS[type].levels.length) return;
    const { price, xp } = CFG.XP_BUY;
    if (this.state.points < price) { UI.toast('积分不足', true); return; }
    this.state.points -= price;
    UI.setPoints(this.state.points);
    this._grantXp(type, xp);
    UI.refreshSquad();
  },

  // 击杀者获得经验；经验条满自动升级（可跨多级，溢出经验结转）
  _grantXp(type, amount) {
    if (!amount) return;
    const t = this.towers.find(tw => tw.type === type);
    if (!t) return;
    const need = CFG.XP.need;
    this.heroXp[type] += amount;
    while (t.level < need.length + 1 && this.heroXp[type] >= need[t.level - 1]) {
      this.heroXp[type] -= need[t.level - 1];
      this._levelUpHero(t);
    }
    this._updateXpBar(t);
    UI.updateXp(type);
  },

  // 经验驱动自动升级：圣光从天而降照耀英雄，照耀结束后圣光消散
  _levelUpHero(t) {
    const cfg = CFG.TOWERS[t.type];
    this.heroLevels[t.type]++;
    t.level = this.heroLevels[t.type];
    this._spawnTowerMesh(t);
    const pos = new THREE.Vector3(t.plot.x, t.plot.y, t.plot.z);
    FX.holyBeam(pos, 0xffe9a0, { radius: 0.55, height: 9, life: 1.8 });
    FX.burst(pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffe98a,
      { count: 24, speed: 4, life: 0.8, gravity: -1.2, up: 1.5 });
    FX.floatText(new THREE.Vector3(t.plot.x, t.plot.y + 3.2, t.plot.z), '⬆ 升级！', '#ffd257', 1.2);
    AudioSys.play('upgrade');
    UI.toast(`${cfg.name} 达到 ${t.level} 级！`);
    this._updateXpBar(t);
    if (this.selectedTower === t) UI.showTowerPanel(t);
  },

  // 当前经验条进度（满级时为 1）
  _xpFrac(t) {
    const need = CFG.XP.need[t.level - 1];
    return need ? Math.min(this.heroXp[t.type] / need, 1) : 1;
  },

  // 英雄头顶经验条（3D）
  _updateXpBar(t) {
    if (!t.xpFg) return;
    const frac = this._xpFrac(t);
    const maxed = t.level >= CFG.TOWERS[t.type].levels.length;
    t.xpFg.scale.x = Math.max((t.xpBarW - 0.04) * frac, 0.001);
    t.xpFg.material.color.setHex(maxed || frac >= 1 ? 0xffe98a : 0xffd257);
  },

  _spawnTowerMesh(tower) {
    if (tower.group) this.scene.remove(tower.group);
    const group = Characters.buildTower(tower.type, tower.level);
    group.position.set(tower.plot.x, tower.plot.y, tower.plot.z);
    group.rotation.y = -Math.PI / 2;   // 面向城墙外（西侧来敌）
    group.userData.head.userData.baseScale = group.userData.head.scale.x;
    this.scene.add(group);
    tower.group = group;
    tower.head = group.userData.head;

    // 头顶经验条（暗底金条，满级隐藏）
    const barW = 0.9;
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x2a2115 }));
    bg.scale.set(barW, 0.13, 1);
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd257 }));
    fg.center.set(0, 0.5);
    fg.position.x = -barW / 2 + 0.02;
    fg.scale.set(barW - 0.04, 0.075, 1);
    const bar = new THREE.Group();
    bar.add(bg, fg);
    bar.position.y = 2.85;
    group.add(bar);
    tower.xpBar = bar;
    tower.xpFg = fg;
    tower.xpBarW = barW;
    this._updateXpBar(tower);
  },

  selectTower(tower) {
    this.selectedTower = tower;
    this._showSelectRing();
    UI.showTowerPanel(tower);
  },
  deselectTower() {
    this.selectedTower = null;
    if (this.selectRing) { this.scene.remove(this.selectRing); this.selectRing = null; }
    UI.hideTowerPanel();
  },
  _showSelectRing() {
    if (this.selectRing) this.scene.remove(this.selectRing);
    const t = this.selectedTower;
    const r = CFG.TOWERS[t.type].levels[t.level - 1].range;
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.08, r, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.set(t.plot.x, 0.09, t.plot.z);
    this.scene.add(this.selectRing);
  },

  /* ================= 波次 ================= */
  callNextWave() {
    if (this.state.phase !== 'build') return;
    if (isFinite(this.waveTimer) && this.waveTimer > 0) {
      const bonus = CFG.callBonus(this.waveTimer);
      this.state.points += bonus;
      UI.setPoints(this.state.points);
      UI.toast(`紧急召唤奖励 +🏅${bonus}`);
    }
    this._startWave();
  },

  _startWave() {
    this.state.wave++;
    const def = CFG.WAVES[this.state.wave - 1];
    const mult = CFG.hpMult(this.state.wave);
    this.spawnQueue = [];
    for (const grp of def) {
      for (let i = 0; i < grp.count; i++) {
        this.spawnQueue.push({ type: grp.type, at: grp.delay + i * grp.gap, mult });
      }
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    this.waveClock = 0;
    this.state.phase = 'wave';
    UI.showWaveButton(null);
    UI.setWave(this.state.wave);

    const bossNames = { 10: '巫妖', 15: '深渊火魔王', 20: '巫妖王' };
    if (bossNames[this.state.wave]) {
      UI.banner(`⚔ 第 ${this.state.wave} 波 — ${bossNames[this.state.wave]} 现身！`, true);
      AudioSys.play('boss_horn');
    } else {
      UI.banner(`⚔ 第 ${this.state.wave} 波来袭`);
      AudioSys.play('horn');
    }
  },

  _updateWaves(dt) {
    if (this.state.phase === 'build') {
      if (isFinite(this.waveTimer)) {
        this.waveTimer -= dt;
        UI.setWaveTimer(this.waveTimer);
        if (this.waveTimer <= 0) this._startWave();
      }
      return;
    }
    // 出怪
    this.waveClock += dt;
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveClock) {
      const s = this.spawnQueue.shift();
      this._spawnEnemy(s.type, s.mult);
    }
    // 波次通关判定
    if (!this.spawnQueue.length && !this.enemies.length) {
      if (this.state.wave >= CFG.TOTAL_WAVES) { this._gameOver(true); return; }
      // 整关完成 → 暂停，进入关卡结算（展示技能/射程卡牌，用积分升级）
      const level = CFG.LEVELS[this.state.level - 1];
      if (this.state.wave >= level.to) {
        const bonus = CFG.levelBonus(this.state.level);
        this.state.points += bonus;
        UI.setPoints(this.state.points);
        UI.toast(`${level.name} 完成！奖励 +🏅${bonus}`);
        AudioSys.play('coin');
        this.state.phase = 'inter';
        UI.showLevelScreen();
        return;
      }
      const bonus = CFG.waveBonus(this.state.wave);
      this.state.points += bonus;
      UI.setPoints(this.state.points);
      UI.toast(`第 ${this.state.wave} 波已击退！奖励 +🏅${bonus}`);
      AudioSys.play('coin');
      this.state.phase = 'build';
      this.waveTimer = CFG.WAVE_BREAK;
      UI.showWaveButton(`⚔ 召唤第 ${this.state.wave + 1} 波`, CFG.callBonus(CFG.WAVE_BREAK));
    }
  },

  /* ================= 敌人 ================= */
  _spawnEnemy(type, mult) {
    const cfg = CFG.ENEMIES[type];
    const mesh = Characters.buildEnemy(type);
    mesh.scale.setScalar(cfg.scale);
    mesh.userData.baseScale = cfg.scale;
    const p = World.track.pointAt(0);
    mesh.position.set(p.x, cfg.flying ? 2.4 : 0, p.z);
    this.scene.add(mesh);

    // 头顶血条
    const bar = new THREE.Group();
    const bw = cfg.boss ? 1.7 : 1.0;
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x38100e }));
    bg.scale.set(bw, 0.16, 1);
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x3edb5a }));
    fg.center.set(0, 0.5);
    fg.position.x = -bw / 2 + 0.03;
    fg.scale.set(bw - 0.06, 0.1, 1);
    bar.add(bg, fg);
    bar.position.y = mesh.userData.height + 0.55;
    if (cfg.boss) bar.scale.setScalar(1.15);
    mesh.add(bar);

    // 状态图标（雪花 = 减速；光点 = 持续伤害：暗言术紫 / 毒箭绿）
    const slowIcon = FX.makeSnow(0xbfe6ff, 0.55);
    slowIcon.position.set(0.42, mesh.userData.height + 0.32, 0);
    slowIcon.visible = false;
    mesh.add(slowIcon);
    const dotIcon = FX.makeGlow(0xb04ae8, 0.45);
    dotIcon.position.set(-0.42, mesh.userData.height + 0.32, 0);
    dotIcon.visible = false;
    mesh.add(dotIcon);

    this.enemies.push({
      type, cfg, mesh, barBg: bg, barFg: fg, barW: bw,
      hp: cfg.hp * mult, maxHp: cfg.hp * mult,
      dist: 0, alive: true,
      slowUntil: 0, slowFactor: 0, stunUntil: 0, dots: [],
      animT: mesh.userData.animOffset || 0,   // 动画时间按实际移速积累：减速步态变慢、眩晕定格
      slowTinted: false, slowFxT: 0, ownMats: false,
      yOff: cfg.flying ? 2.4 : (cfg.hover || 0),
      slowIcon, dotIcon
    });
  },

  _updateEnemies(dt) {
    const track = World.track;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // DoT（暗言术：痛，击杀经验归牧师）
      let dotSrc = null;
      for (let d = e.dots.length - 1; d >= 0; d--) {
        const dot = e.dots[d];
        if (this.time > dot.until) { e.dots.splice(d, 1); continue; }
        e.hp -= dot.dps * dt;
        dotSrc = dot.src || 'priest';
        dot.fxT = (dot.fxT || 0) - dt;
        if (dot.fxT <= 0) {          // 持续伤害蚕食：低频上浮雾滴（猎人毒绿 / 暗言术紫）
          dot.fxT = 0.4;
          FX.burst(e.mesh.position.clone().add(new THREE.Vector3(0, 0.7, 0)),
            dot.src === 'hunter' ? POISON_COLOR : 0xb04ae8,
            { count: 1, speed: 0.5, life: 0.55, gravity: -1.5, up: 1.2 });
        }
      }
      if (e.hp <= 0) { this._killEnemy(e, dotSrc); continue; }

      // 移动（眩晕 / 减速）
      const stunned = this.time < e.stunUntil;
      const slowed = this.time < e.slowUntil;
      const eff = stunned ? 0 : e.cfg.speed * (slowed ? 1 - e.slowFactor : 1);
      e.dist += eff * dt;
      if (e.dist >= track.length) { this._leak(e); continue; }

      const p = track.pointAt(e.dist);
      const p2 = track.pointAt(Math.min(e.dist + 0.45, track.length));
      e.mesh.position.set(p.x, e.yOff, p.z);
      if (e.cfg.flying) e.mesh.position.y = 2.4 + Math.sin(this.time * 3 + e.mesh.userData.animOffset) * 0.18;
      e.mesh.rotation.y = Math.atan2(p2.x - p.x, p2.z - p.z);
      // 动画时间按实际移速比例积累：被减速时步态变慢，眩晕时定格
      e.animT += dt * (eff / e.cfg.speed);
      e.mesh.userData.anim(e.animT, eff > 0 ? 1 : 0);

      // 减速表现：本体冰蓝染色 + 雪花图标旋转脉冲 + 低频冰晶飘落；结束恢复原色
      if (slowed && !e.slowTinted) this._setSlowTint(e, true);
      if (!slowed && e.slowTinted) this._setSlowTint(e, false);
      if (slowed) {
        e.slowFxT -= dt;
        if (e.slowFxT <= 0) {
          e.slowFxT = 0.45;
          FX.burst(e.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xbfe6ff,
            { count: 1, speed: 0.35, life: 0.6, gravity: 2.2 });
        }
        e.slowIcon.material.rotation += dt * 1.6;
        e.slowIcon.scale.setScalar(0.55 * (1 + Math.sin(this.time * 7) * 0.13));
      }
      // 血条与状态图标
      const frac = Utils.clamp(e.hp / e.maxHp, 0, 1);
      e.barFg.scale.x = Math.max((e.barW - 0.06) * frac, 0.001);
      e.barFg.material.color.setHex(frac > 0.5 ? 0x3edb5a : frac > 0.25 ? 0xf0c73a : 0xe84a3a);
      e.slowIcon.visible = slowed;
      // 持续伤害图标随来源变色：猎人毒绿 / 暗言术紫
      e.dotIcon.visible = e.dots.length > 0;
      if (e.dots.length) e.dotIcon.material.color.setHex(
        e.dots.some(d => d.src === 'hunter') ? POISON_COLOR : 0xb04ae8);
    }
  },

  // src：伤害来源英雄类型（击杀经验归击杀者）
  damageEnemy(e, amount, src) {
    if (!e.alive) return;
    const dmg = amount * (1 - (e.cfg.armor || 0));
    e.hp -= dmg;
    FX.punch(e.mesh);
    if (e.hp <= 0) this._killEnemy(e, src);
  },

  _killEnemy(e, src) {
    e.alive = false;
    this.scene.remove(e.mesh);
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.state.points += e.cfg.points;
    this.state.kills++;
    if (src) this._grantXp(src, e.cfg.xp || 0);
    const pos = e.mesh.position.clone();
    pos.y += e.yOff + 0.8;
    const deathColors = {
      murloc: 0x5fbf5f, boar: 0x8a5c34, ghoul: 0xa8a894, gargoyle: 0x9a9aa4,
      orc: 0x6a8a4a, lich: 0x5fe8ff, abyssal: 0xff7a1e, lichking: 0x5fe8ff
    };
    FX.burst(pos, deathColors[e.type] || 0xcccccc, { count: e.cfg.boss ? 30 : 12, speed: e.cfg.boss ? 6 : 3.5, life: 0.7 });
    FX.floatText(pos, `+${e.cfg.points}`, '#ffd257', e.cfg.boss ? 1.3 : 1);
    AudioSys.play(e.cfg.boss ? 'death' : 'hit');
    AudioSys.play('coin');
    UI.setPoints(this.state.points);
    UI.setKills(this.state.kills);
  },

  /* ---------- 减速触发与本体表现 ---------- */

  // 寒冰箭减速命中触发：施加减速并给出可辨识的触发反馈
  _applySlow(e, lv) {
    const wasActive = this.time < e.slowUntil;
    e.slowUntil = this.time + lv.slowDur;
    e.slowFactor = Math.max(lv.slow, wasActive ? e.slowFactor : 0);
    const pos = e.mesh.position.clone();
    pos.y += 0.7;
    FX.burst(pos, 0xbfe6ff, { count: 5, speed: 1.6, life: 0.4, gravity: 4 });
  },

  // 毒箭命中：必附毒（毒伤无视护甲）；同一目标最多 2 层猎人毒，超限则刷新最早一层
  _applyPoison(e, lv) {
    const mine = e.dots.filter(d => d.src === 'hunter');
    if (mine.length >= 2) {
      mine[0].dps = lv.poison;
      mine[0].until = this.time + lv.poisonDur;
    } else {
      e.dots.push({ dps: lv.poison, until: this.time + lv.poisonDur, src: 'hunter' });
    }
    const pos = e.mesh.position.clone();
    pos.y += 0.7;
    FX.burst(pos, POISON_COLOR, { count: 5, speed: 1.6, life: 0.4, gravity: 3 });
  },

  // 减速染色开/关：材质按个体克隆后染冰蓝，结束时恢复原色
  _setSlowTint(e, on) {
    e.slowTinted = on;
    e.slowFxT = 0;
    if (on) this._ensureOwnMaterials(e);
    e.mesh.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.color || m.userData.baseColor === undefined) continue;
        if (on) {
          m.color.copy(m.userData.baseColor).lerp(SLOW_TINT, 0.45);
          if (m.emissive) m.emissive.setHex(0x123048);
        } else {
          m.color.copy(m.userData.baseColor);
          if (m.emissive) m.emissive.setHex(m.userData.baseEmissive || 0x000000);
        }
      }
    });
  },

  // MatCache 材质全局共享：被减速的敌人改为持有克隆材质，染色才不会串到同类
  _ensureOwnMaterials(e) {
    if (e.ownMats) return;
    e.ownMats = true;
    e.mesh.traverse(o => {
      if (!o.isMesh || !o.material) return;
      if (Array.isArray(o.material)) o.material = o.material.map(m => this._cloneMat(m));
      else o.material = this._cloneMat(o.material);
    });
  },

  _cloneMat(m) {
    const c = m.clone();
    c.userData.baseColor = m.color.clone();
    if (c.emissive) c.userData.baseEmissive = m.emissive.getHex();
    return c;
  },

  _leak(e) {
    e.alive = false;
    this.scene.remove(e.mesh);
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.state.lives--;
    UI.setLives(this.state.lives);
    const gate = new THREE.Vector3(22.5, 2, 0);
    FX.burst(gate, 0xff4a3a, { count: 14, speed: 4, life: 0.6 });
    FX.floatText(gate, '-1 ❤', '#ff7d6e', 1.2);
    AudioSys.play('leak');
    if (this.state.lives <= 0) this._gameOver(false);
  },

  _gameOver(win) {
    this.state.phase = 'over';
    UI.showWaveButton(null);
    AudioSys.play(win ? 'victory' : 'defeat');
    UI.showEnd(win, {
      level: this.state.level, wave: this.state.wave,
      kills: this.state.kills, points: this.state.points
    });
  },

  /* ================= 塔攻击 ================= */
  _auraMult(x, z) {
    let mult = 1;
    for (const t of this.towers) {
      if (t.type !== 'priest') continue;
      const lv = CFG.TOWERS.priest.levels[t.level - 1];
      if (Utils.distXZ(x, z, t.plot.x, t.plot.z) <= lv.auraRange) mult += lv.aura;
    }
    return mult;
  },

  _findTarget(tower, range) {
    let best = null, bestDist = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (Utils.distXZ(tower.plot.x, tower.plot.z, e.mesh.position.x, e.mesh.position.z) > range) continue;
      if (e.dist > bestDist) { bestDist = e.dist; best = e; }
    }
    return best;
  },

  _updateTowers(dt) {
    const castDur = CFG.FX.castDur;
    for (const t of this.towers) {
      const cfg = CFG.TOWERS[t.type];
      const lv = cfg.levels[t.level - 1];
      const fx = cfg.fx[t.level - 1];
      t.head.userData.anim(this.time + t.plot.x, 0, t.castT > 0 ? 1 - t.castT / castDur : 0);
      if (t.castT > 0) t.castT = Math.max(0, t.castT - dt);

      // 头顶经验条：满级隐藏，经验满时脉冲提示即将圣光升级
      if (t.xpBar) {
        t.xpBar.visible = t.level < cfg.levels.length;
        const full = this._xpFrac(t) >= 1;
        t.xpBar.scale.setScalar(full ? 1 + Math.sin(this.time * 6) * 0.1 : 1);
      }

      // 蓄力到位 → 释放（伤害 / 弹道在动作 58% 处结算）
      if (t.pending && t.castT <= castDur * 0.42) { this._releaseShot(t, lv); continue; }

      t.cooldown -= dt;
      if (t.cooldown > 0) continue;

      if (t.type === 'mage') {
        const target = this._findTarget(t, lv.range);
        if (!target) continue;
        t.cooldown = lv.rate;
        this._faceHead(t, target);
        t.castT = castDur;
        t.pending = { target, mult: this._auraMult(t.plot.x, t.plot.z) };
        FX.light(this._anchorPos(t), fx.color, { intensity: 1.1 * fx.boost, dist: 4.5, life: castDur });
        AudioSys.play('shoot_frost');

      } else if (t.type === 'hunter') {
        const target = this._findTarget(t, lv.range);
        if (!target) continue;
        t.cooldown = lv.rate;
        this._faceHead(t, target);
        t.castT = castDur;
        t.pending = { target, mult: this._auraMult(t.plot.x, t.plot.z) };

      } else if (t.type === 'paladin') {
        const target = this._findTarget(t, lv.range);
        if (!target) continue;
        t.cooldown = lv.rate;
        t.castT = castDur;
        t.pending = { mult: this._auraMult(t.plot.x, t.plot.z) };
        FX.light(new THREE.Vector3(t.plot.x, 1.4, t.plot.z), fx.color, { intensity: 0.9 * fx.boost, dist: 4, life: castDur });

      } else if (t.type === 'priest') {
        const target = this._findTarget(t, lv.range);
        if (!target) continue;
        t.cooldown = lv.rate;
        this._faceHead(t, target);
        t.castT = castDur;
        t.pending = { target, mult: this._auraMult(t.plot.x, t.plot.z) };
        FX.light(this._anchorPos(t), fx.color, { intensity: 1.0 * fx.boost, dist: 4.5, life: castDur });
        AudioSys.play('shoot_shadow');
      }
    }
  },

  /* 武器锚点的世界坐标（弹道出手位置，自动跟随转向 / 施法动作 / 等级缩放） */
  _anchorPos(t) {
    const v = new THREE.Vector3();
    if (t.head.userData.anchor) {
      t.head.userData.anchor.getWorldPosition(v);
      return v;
    }
    return v.set(t.plot.x, t.plot.y + 1.9, t.plot.z);
  },

  /* 蓄力完成：发射弹道 / 结算范围伤害，并触发命中光影（光影颜色与强度随英雄等级增强） */
  _releaseShot(t, lv) {
    const p = t.pending;
    t.pending = null;
    const mult = p.mult;
    const fx = CFG.TOWERS[t.type].fx[t.level - 1];

    if (t.type === 'mage') {
      const target = p.target;
      if (!target || !target.alive) return;
      FX.flash(this._anchorPos(t), fx.color, 0.9 * fx.boost, 0.25);
      FX.projectile({
        from: this._anchorPos(t), kind: 'frost', speed: 11, target,
        color: fx.color, scale: fx.boost,
        onHit: (pos) => {
          FX.burst(pos, fx.color, { count: Math.round(16 * fx.boost), speed: 4.5, life: 0.55 });
          FX.light(pos, fx.color, { intensity: 2.4 * fx.boost, dist: lv.splash * 2.4 });
          FX.groundGlow(pos, fx.color, lv.splash * (0.9 + 0.25 * fx.boost), 0.5);
          for (const e of this.enemies) {
            if (!e.alive) continue;
            if (Utils.distXZ(pos.x, pos.z, e.mesh.position.x, e.mesh.position.z) <= lv.splash) {
              this.damageEnemy(e, lv.dmg * mult, 'mage');
              // 减速为概率触发（触发率随等级提升，封顶 25%，见 config）
              if (e.alive && Math.random() < lv.slowChance) this._applySlow(e, lv);
            }
          }
          AudioSys.play('hit');
        }
      });

    } else if (t.type === 'hunter') {
      const target = p.target;
      if (!target || !target.alive) return;
      FX.flash(this._anchorPos(t), 0xdfe8ff, 0.5, 0.16);
      FX.projectile({
        from: this._anchorPos(t), kind: 'arrow', speed: 15, target,
        color: fx.color, scale: fx.boost,
        onHit: (pos) => {
          FX.burst(pos, 0xffe2a8, { count: Math.round(6 * fx.boost), speed: 2.8, life: 0.32, gravity: 3 });
          FX.light(pos, 0xffe2a8, { intensity: 1.1 * fx.boost, dist: 3.5, life: 0.25 });
          if (target.alive) this.damageEnemy(target, lv.dmg * mult, 'hunter');
          // 2 级解锁毒箭：命中必附毒（持续掉血由 DoT 结算，无视护甲）
          if (target.alive && lv.poison) {
            FX.burst(pos, POISON_COLOR, { count: Math.round(4 * fx.boost), speed: 2.2, life: 0.45, gravity: 2.5 });
            this._applyPoison(target, lv);
          }
          AudioSys.play('hit');
        }
      });
      AudioSys.play('shoot_arrow');

    } else if (t.type === 'paladin') {
      // 落锤瞬间：圣光柱 + 金色奉献圈 + 双层冲击环 + 强点光（随等级增强）
      const gx = t.plot.x, gz = t.plot.z;
      const halo = new THREE.Color(fx.color).lerp(new THREE.Color(0xffffff), 0.45).getHex();
      FX.pillar(new THREE.Vector3(gx, 0, gz), fx.color, { radius: 0.55 * fx.boost, height: 3.6, life: 0.3 });
      FX.groundGlow(new THREE.Vector3(gx, 0, gz), fx.color, lv.range * 1.15, 0.6);
      FX.ring(new THREE.Vector3(gx, 0, gz), fx.color, lv.range * 1.25, 0.45);
      FX.ring(new THREE.Vector3(gx, 0, gz), halo, lv.range * 0.85, 0.32);
      FX.light(new THREE.Vector3(gx, 1.4, gz), fx.color, { intensity: 3.2 * fx.boost, dist: lv.range * 1.8, life: 0.4 });
      FX.burst(new THREE.Vector3(gx, 1.0, gz), fx.color, { count: Math.round(14 * fx.boost), speed: 4.5, life: 0.45 });
      FX.punch(t.head);
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Utils.distXZ(gx, gz, e.mesh.position.x, e.mesh.position.z) <= lv.range) {
          this.damageEnemy(e, lv.dmg * mult, 'paladin');
          if (e.alive) e.stunUntil = this.time + lv.stun;
        }
      }
      AudioSys.play('consecrate');

    } else if (t.type === 'priest') {
      const target = p.target;
      if (!target || !target.alive) return;
      FX.flash(this._anchorPos(t), fx.color, 0.7 * fx.boost, 0.22);
      FX.projectile({
        from: this._anchorPos(t), kind: 'shadow', speed: 9, target,
        color: fx.color, scale: fx.boost,
        onHit: (pos) => {
          FX.burst(pos, fx.color, { count: Math.round(10 * fx.boost), speed: 3.2, life: 0.5, gravity: 0 });
          FX.light(pos, fx.color, { intensity: 1.6 * fx.boost, dist: 4.5 });
          FX.groundGlow(pos, fx.color, 1.2, 0.5);
          if (target.alive) {
            target.dots.push({ dps: (lv.dot * mult) / 5, until: this.time + 5, src: 'priest' });
            if (target.dots.length > 4) target.dots.shift();
          }
          AudioSys.play('hit');
        }
      });
    }
  },

  _faceHead(tower, target) {
    const dx = target.mesh.position.x - tower.plot.x;
    const dz = target.mesh.position.z - tower.plot.z;
    tower.head.rotation.y = Math.atan2(dx, dz) - tower.group.rotation.y;
  },

  /* ================= 流程控制 ================= */
  // 布阵界面：确认阵容，开始第 1 关
  startGame() {
    if (this.state.phase !== 'arrange') return;
    this.state.phase = 'build';
    this.waveTimer = Infinity;
    UI.hideArrange();
    UI.showWaveButton('⚔ 开始第 1 波', 0);
    UI.setHint(HINT_DEFAULT);
  },

  // 关卡结算界面：开启下一关
  nextLevel() {
    if (this.state.phase !== 'inter') return;
    this.state.level++;
    this.state.phase = 'build';
    this.waveTimer = Infinity;
    UI.hideLevelScreen();
    UI.showWaveButton(`⚔ 开始 ${CFG.LEVELS[this.state.level - 1].name}`, 0);
    UI.setWave(this.state.wave);
    UI.setHint(HINT_DEFAULT);
  },

  /* ================= 通用按钮 ================= */
  toggleSpeed() {
    this.state.speed = this.state.speed === 1 ? 2 : 1;
    UI.setSpeedLabel(this.state.speed);
  },
  togglePause() {
    const ph = this.state.phase;
    if (ph === 'over' || ph === 'inter' || ph === 'arrange') return;
    this.state.paused = !this.state.paused;
    UI.setPauseLabel(this.state.paused);
  },
  toggleMute() {
    AudioSys.init();
    UI.setMuteLabel(AudioSys.toggleMute());
  }
};

window.addEventListener('DOMContentLoaded', () => Game.init());

/* ============ 游戏核心：状态机 / 战斗 / 交互 / 主循环 ============ */
const HINT_DEFAULT = '点击英雄查看技能与射程　|　1-4：英雄群攻技能　|　左键拖拽旋转视角　|　右键平移　|　滚轮缩放　|　空格：下一波　Esc：取消';
const SLOW_TINT = new THREE.Color(0x9fd4ff);   // 减速冰蓝染色
const POISON_COLOR = 0x7ed957;                 // 毒箭毒雾/状态图标（区别于暗影紫）

/* 运行时画一把 32×32 剑生成光标（PNG data URI，各浏览器通用；热点在剑尖，落点与系统箭头一致） */
function makeSwordCursor() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  const DARK = 'rgba(38,24,12,0.92)';

  // 剑刃路径：剑尖 (3.5,3.5) 朝左上，刃基在 (19.5,19.5)，刃宽约 5.4px
  const blade = new Path2D();
  blade.moveTo(3.5, 3.5);
  blade.lineTo(5.4, 1.6); blade.lineTo(21.4, 17.6); blade.lineTo(17.6, 21.4);
  blade.closePath();

  // 第一遍：深色加粗底稿当外描边，带轻微投影保证在明亮地形上可见
  g.fillStyle = DARK; g.strokeStyle = DARK;
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 2; g.shadowOffsetY = 1;
  g.fill(blade); g.lineWidth = 2; g.stroke(blade);
  g.lineWidth = 5.4; g.beginPath(); g.moveTo(25.4, 17.6); g.lineTo(17.6, 25.4); g.stroke();   // 护手
  g.lineWidth = 5;   g.beginPath(); g.moveTo(22.9, 22.9); g.lineTo(26.8, 26.8); g.stroke();   // 握柄
  g.beginPath(); g.arc(28, 28, 3.2, 0, Math.PI * 2); g.fill();                                // 柄头
  g.shadowColor = 'transparent';

  // 第二遍：真实上色
  const steel = g.createLinearGradient(21.4, 17.6, 17.6, 21.4);
  steel.addColorStop(0, '#f7f9ff'); steel.addColorStop(0.55, '#c3ccdd'); steel.addColorStop(1, '#8f9cb5');
  g.fillStyle = steel; g.fill(blade);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(5, 5); g.lineTo(17, 17); g.stroke();                                // 刃脊高光
  const gold = g.createLinearGradient(26, 18, 18, 26);
  gold.addColorStop(0, '#eed08a'); gold.addColorStop(1, '#a8741f');
  g.strokeStyle = gold; g.lineWidth = 3.8;
  g.beginPath(); g.moveTo(25.4, 17.6); g.lineTo(17.6, 25.4); g.stroke();                      // 护手
  g.strokeStyle = '#7a4e28'; g.lineWidth = 3.2;
  g.beginPath(); g.moveTo(22.9, 22.9); g.lineTo(26.8, 26.8); g.stroke();                      // 握柄
  g.fillStyle = gold;
  g.beginPath(); g.arc(28, 28, 2.4, 0, Math.PI * 2); g.fill();                                // 柄头
  return `url(${cv.toDataURL('image/png')}) 3 3, auto`;
}

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

  // 技能瞄准态：非空表示正在选择地面施放点（范围圈跟随鼠标，左键施放 / 右键或 Esc 取消）
  aiming: null, aimRing: null, aimDisc: null,
  _groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),

  /* ================= 初始化 ================= */
  init() {
    const container = document.getElementById('game-container');

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    document.body.style.cursor = makeSwordCursor();   // 游戏画面内光标变剑（UI 按钮自身的 pointer 会覆盖）

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x88b6dd);
    this.scene.fog = new THREE.Fog(0x88b6dd, CFG.ENV.FOG.near, CFG.ENV.FOG.far);   // 昼夜/天气由 Env 每帧驱动

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
    this.cam = new CamControls(this.camera, this.renderer.domElement);
    this.cam.theta = CFG.CAMERA.theta; this.cam.phi = CFG.CAMERA.phi; this.cam.radius = CFG.CAMERA.radius;
    this.cam.target.set(...CFG.CAMERA.target);
    this.cam.updateCamera();

    World.init(this.scene);
    FX.init(this.scene);
    Env.init(this.scene);
    Env.setScene(CFG.SCENES[CFG.LEVELS[0].scene]);
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
        Env.update(sdt);                // 昼夜/天气在布阵、结算阶段也流动
        FX.update(sdt);                 // 特效在布阵/结算阶段也保持（升级特效不再冻结）
        this._updateTowers(sdt);        // 英雄待机/施法动画（场上无敌人时只会空转待机）
        World.update(sdt, this.time);
        FX.updateEnemyLights(this.enemies, sdt);   // 怪物夜光跟随（布阵/结算阶段也跑，灯光平滑熄灭）
        UI.setEnv();
        UI.updateSkillCds();
        if (this.aiming && this.state.phase !== 'wave') this.cancelAim();   // 波次结束等自动退出瞄准
        if (ph !== 'inter' && ph !== 'arrange') {
          this._updateWaves(sdt);
          this._updateEnemies(sdt);
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
      this._updateAimReticle();
    });
    dom.addEventListener('pointerdown', (e) => { this._downPos = { x: e.clientX, y: e.clientY, button: e.button }; });
    dom.addEventListener('pointerup', (e) => {
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
      const btn = this._downPos.button;
      this._downPos = null;
      if (btn === 2) {   // 右键：取消瞄准（与相机平移并存）
        if (this.aiming) this.cancelAim();
        return;
      }
      if (btn !== 0 || moved > 6) return;
      this.mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      // 瞄准中：左键点击地面 = 在该位置施放（点选英雄等常规交互被消费）
      if (this.aiming) {
        const pos = this.aiming.pos;
        if (pos && this.castSkill(this.aiming.type, pos)) this.cancelAim();
        return;
      }
      this._handleClick();
    });
  },

  /* ---------- 技能瞄准（地面指定施放点） ---------- */

  // 鼠标射线与地面(y=0)交点，钳制在地图范围内
  _groundPoint() {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this._groundPlane, p)) return null;
    p.x = Utils.clamp(p.x, -30, 30);
    p.z = Utils.clamp(p.z, -20, 20);
    p.y = 0;
    return p;
  },

  beginAim(type) {
    const t = this.towers.find(tw => tw.type === type);
    if (!t || this.state.paused) return;
    if (this.state.phase !== 'wave') { UI.toast('技能需在战斗中施放', true); return; }
    if (t.skillCd > 0) { UI.toast(`${CFG.TOWERS[type].skill.name} 冷却中 ${Math.ceil(t.skillCd)}s`, true); return; }
    if (this.aiming && this.aiming.type === type) { this.cancelAim(); return; }   // 再按一次取消
    const sk = CFG.TOWERS[type].skill;
    this.aiming = { type };
    this._buildAimReticle(sk.radius, CFG.TOWERS[type].clsColor);
    this._updateAimReticle();
    UI.setAimingBtn(type);
    UI.setHint(`点击地面释放 ${CFG.TOWERS[type].skill.icon} ${CFG.TOWERS[type].skill.name}　|　左键：施放　右键 / Esc：取消`);
  },

  cancelAim() {
    if (!this.aiming) return;
    this.aiming = null;
    this._removeAimReticle();
    UI.setAimingBtn(null);
    UI.setHint(HINT_DEFAULT);
  },

  _buildAimReticle(radius, colorCss) {
    this._removeAimReticle();
    const col = new THREE.Color(colorCss);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.14, radius, 48),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12; disc.position.y = 0.1;
    this.scene.add(ring, disc);
    this.aimRing = ring; this.aimDisc = disc;
  },

  _removeAimReticle() {
    for (const m of [this.aimRing, this.aimDisc]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose(); m.material.dispose();
    }
    this.aimRing = this.aimDisc = null;
  },

  _updateAimReticle() {
    if (!this.aiming || !this.aimRing) return;
    const p = this._groundPoint();
    if (!p) return;
    this.aiming.pos = p;
    this.aimRing.position.set(p.x, 0.12, p.z);
    this.aimDisc.position.set(p.x, 0.1, p.z);
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
      const tower = { type, level: this.heroLevels[type], plot, group: null, head: null, cooldown: 0.3, skillCd: 0 };
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

  // 头顶条工厂：整根条（暗底 + 左锚定彩色填充）画进同一张贴图，单 Sprite 渲染——
  // 任意视角下底板与填充天然重合为一根条，扣血/涨经验从右往左
  _makeBar(barW, barH, trackColor) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 16;
    const ctx = cv.getContext('2d');
    const css = (hex) => '#' + hex.toString(16).padStart(6, '0');
    const tex = new THREE.CanvasTexture(cv);
    ctx.fillStyle = css(trackColor);
    ctx.fillRect(0, 0, 128, 16);
    tex.needsUpdate = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sprite.scale.set(barW, barH, 1);
    const group = new THREE.Group();
    group.add(sprite);
    let lastFrac = -1, lastColor = 0;
    return {
      group,
      // frac/颜色都没变时跳过重绘（每帧调用无开销）
      draw(frac, colorHex) {
        if (frac === lastFrac && colorHex === lastColor) return;
        lastFrac = frac; lastColor = colorHex;
        ctx.fillStyle = css(trackColor);
        ctx.fillRect(0, 0, 128, 16);
        const w = Math.round(124 * frac);
        if (w > 0) {
          ctx.fillStyle = css(colorHex);
          ctx.fillRect(2, 2, w, 12);
        }
        tex.needsUpdate = true;
      }
    };
  },

  // 英雄头顶经验条（3D）
  _updateXpBar(t) {
    if (!t.xpDraw) return;
    const frac = this._xpFrac(t);
    const maxed = t.level >= CFG.TOWERS[t.type].levels.length;
    t.xpDraw(frac, maxed || frac >= 1 ? 0xffe98a : 0xffd257);
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

    // 头顶经验条（单贴图条：暗底金条画在同一张贴图里，左锚定，满级隐藏）
    const bar = this._makeBar(0.9, 0.13, 0x2a2115);
    bar.group.position.y = 2.85;
    group.add(bar.group);
    tower.xpBar = bar.group;
    tower.xpDraw = bar.draw;
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
    const lv = CFG.LEVELS[this.state.level - 1];
    this.spawnQueue = [];
    let rr = 0;
    for (const grp of def) {
      // 组未指派路线时按当前关路线数轮转分配
      const route = grp.route !== undefined ? grp.route : (rr++ % (lv.routes || 1));
      for (let i = 0; i < grp.count; i++) {
        this.spawnQueue.push({ type: grp.type, at: grp.delay + i * grp.gap, mult, route });
      }
      // 精英怪：小怪组末尾压阵 1 只（Boss 组不加）
      if (!CFG.ENEMIES[grp.type].boss) {
        this.spawnQueue.push({ type: grp.type, at: grp.delay + grp.count * grp.gap, mult, route, elite: true });
      }
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    this.waveClock = 0;
    this.state.phase = 'wave';
    UI.showWaveButton(null);
    UI.setWave(this.state.wave);

    // 每波按场景天气池换一轮天气
    Env.rollWeather();
    const w = CFG.WEATHER[Env.weather];
    const wx = `　${w.icon} ${w.label}`;

    const bossNames = { 10: '巫妖', 15: '深渊火魔王', 20: '亡灵之王' };
    if (bossNames[this.state.wave]) {
      UI.banner(`⚔ 第 ${this.state.wave} 波 — ${bossNames[this.state.wave]} 现身！${wx}`, true);
      AudioSys.play('boss_horn');
    } else {
      UI.banner(`⚔ 第 ${this.state.wave} 波来袭${wx}`);
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
      this._spawnEnemy(s.type, s.mult, s.route || 0, s.elite);
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
  _spawnEnemy(type, mult, route = 0, elite = false) {
    const cfg = CFG.ENEMIES[type];
    // 全局难度强化 + 精英倍率（护甲存实例：cfg 为共享配置，各怪 armor 不同）
    const buff = CFG.ENEMY_BUFF;
    const hp = cfg.hp * mult * buff.hpMult * (elite ? CFG.ELITE.hpMult : 1);
    const armor = Math.min(1, ((cfg.armor || 0) + buff.armorAdd) * (elite ? CFG.ELITE.armorMult : 1));
    const scale = cfg.scale * (elite ? CFG.ELITE.scale : 1);
    const mesh = Characters.buildEnemy(type);
    mesh.scale.setScalar(scale);
    mesh.userData.baseScale = scale;
    const track = World.tracks[route] || World.tracks[0];
    const p = track.pointAt(0);
    mesh.position.set(p.x, cfg.flying ? 2.4 : 0, p.z);
    this.scene.add(mesh);
    World.pulsePortal(route);   // 传送门光晕脉冲 + 出怪粒子
    FX.burst(new THREE.Vector3(p.x, 1.6, p.z), 0x6effa0, { count: 8, speed: 2.5, life: 0.5, gravity: 0 });

    // 头顶血条（单贴图条：暗底 + 彩色填充画在同一张贴图里，任意视角都是一条，扣血从右往左）
    const bw = cfg.boss ? 1.7 : elite ? 1.35 : 1.0;
    const hpBar = this._makeBar(bw, 0.16, 0x38100e);
    if (cfg.boss) hpBar.group.scale.setScalar(1.15);
    hpBar.group.position.y = mesh.userData.height + 0.55;
    mesh.add(hpBar.group);

    // 状态图标（雪花 = 减速；光点 = 持续伤害：暗影紫 / 毒箭绿）
    const slowIcon = FX.makeSnow(0xbfe6ff, 0.55);
    slowIcon.position.set(0.42, mesh.userData.height + 0.32, 0);
    slowIcon.visible = false;
    mesh.add(slowIcon);
    const dotIcon = FX.makeGlow(0xb04ae8, 0.45);
    dotIcon.position.set(-0.42, mesh.userData.height + 0.32, 0);
    dotIcon.visible = false;
    mesh.add(dotIcon);

    // 夜光光晕：加色贴片随本体移动，死亡时随 mesh 一起移除（精英为专属红色大光晕）
    const glowCfg = CFG.ENEMY_GLOW;
    const halo = elite
      ? FX.makeGlow(CFG.ELITE.haloColor, CFG.ELITE.haloScale, 1.0)
      : FX.makeGlow(glowCfg.colors[type] || glowCfg.color, cfg.boss ? glowCfg.haloBoss : glowCfg.halo, 1.0);
    halo.material.opacity = elite ? CFG.ELITE.haloOpacity : glowCfg.haloOpacity;
    halo.position.y = (mesh.userData.height || 1.2) * 0.55;
    mesh.add(halo);

    this.enemies.push({
      type, cfg, mesh, bar: hpBar,
      hp: hp, maxHp: hp,
      armor, elite,
      track, progress: 0,        // progress = dist/track.length，跨路线可比（索敌用）
      dist: 0, alive: true,
      slowUntil: 0, slowFactor: 0, stunUntil: 0, dots: [],
      animT: mesh.userData.animOffset || 0,   // 动画时间按实际移速积累：减速步态变慢、眩晕定格
      slowTinted: false, slowFxT: 0, ownMats: false,
      yOff: cfg.flying ? 2.4 : (cfg.hover || 0),
      slowIcon, dotIcon
    });
  },

  _updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // DoT（暗影侵蚀，击杀经验归牧师）
      let dotSrc = null;
      for (let d = e.dots.length - 1; d >= 0; d--) {
        const dot = e.dots[d];
        if (this.time > dot.until) { e.dots.splice(d, 1); continue; }
        e.hp -= dot.dps * dt;
        dotSrc = dot.src || 'priest';
        dot.fxT = (dot.fxT || 0) - dt;
        if (dot.fxT <= 0) {          // 持续伤害蚕食：低频上浮雾滴（猎人毒绿 / 暗影紫）
          dot.fxT = 0.4;
          FX.burst(e.mesh.position.clone().add(new THREE.Vector3(0, 0.7, 0)),
            dot.src === 'hunter' ? POISON_COLOR : 0xb04ae8,
            { count: 1, speed: 0.5, life: 0.55, gravity: -1.5, up: 1.2 });
        }
      }
      if (e.hp <= 0) { this._killEnemy(e, dotSrc); continue; }

      // 移动（眩晕 / 减速 / 天气：雪与暴雪只拖慢地面单位，飞行单位不受影响）
      const stunned = this.time < e.stunUntil;
      const slowed = this.time < e.slowUntil;
      const weatherSlow = e.cfg.flying ? 1 : Env.play.enemySpeedMult;
      const eff = stunned ? 0 : e.cfg.speed * (slowed ? 1 - e.slowFactor : 1) * weatherSlow;
      e.dist += eff * dt;
      if (e.dist >= e.track.length) { this._leak(e); continue; }

      e.progress = e.dist / e.track.length;
      const p = e.track.pointAt(e.dist);
      const p2 = e.track.pointAt(Math.min(e.dist + 0.45, e.track.length));
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
      e.bar.draw(frac, frac > 0.5 ? 0x3edb5a : frac > 0.25 ? 0xf0c73a : 0xe84a3a);
      e.slowIcon.visible = slowed;
      // 持续伤害图标随来源变色：猎人毒绿 / 暗影紫
      e.dotIcon.visible = e.dots.length > 0;
      if (e.dots.length) e.dotIcon.material.color.setHex(
        e.dots.some(d => d.src === 'hunter') ? POISON_COLOR : 0xb04ae8);
    }
  },

  // src：伤害来源英雄类型（击杀经验归击杀者）
  damageEnemy(e, amount, src) {
    if (!e.alive) return;
    const crit = Math.random() < CFG.CRIT.chance;
    if (crit) amount *= CFG.CRIT.mult;
    const dmg = amount * (1 - (e.armor || 0));
    e.hp -= dmg;
    FX.punch(e.mesh);
    this._damageText(e, dmg, crit);
    if (e.hp <= 0) this._killEnemy(e, src);
  },

  // 伤害飘字：白色小字为普通命中，红色大字为暴击（护甲减免后的实际扣血），与击杀金色加分飘字区分
  _damageText(e, dmg, crit) {
    const pos = e.mesh.position.clone();
    pos.y += e.yOff + (crit ? 1.15 : 0.8);
    pos.x += (Math.random() - 0.5) * 0.7;   // 溅射/AoE 多目标同帧飘字错开
    if (crit) {
      FX.floatText(pos, `暴击 ${Math.round(dmg)}`, '#ff4a2a', 1.5);
      FX.burst(e.mesh.position.clone(), 0xff5a2a, { count: 6, speed: 3, life: 0.35 });
    } else {
      FX.floatText(pos, `${Math.round(dmg)}`, '#f0e6d2', 0.8);
    }
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
    const end = e.track.pointAt(e.track.length - 1.5);
    const gate = new THREE.Vector3(end.x, 2, end.z);
    FX.burst(gate, 0xff4a3a, { count: 14, speed: 4, life: 0.6 });
    FX.floatText(gate, '-1 ❤', '#ff7d6e', 1.2);
    AudioSys.play('leak');
    if (this.state.lives <= 0) this._gameOver(false);
  },

  _gameOver(win) {
    this.state.phase = 'over';
    this.cancelAim();
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
    range *= Env.play.towerRangeMult;   // 天气影响射程（雨天略降，config 可调）
    let best = null, bestProgress = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (Utils.distXZ(tower.plot.x, tower.plot.z, e.mesh.position.x, e.mesh.position.z) > range) continue;
      // 多路线长度不同，按进度（而非里程）选最靠前的敌人
      if (e.progress > bestProgress) { bestProgress = e.progress; best = e; }
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
      if (t.skillCd > 0) t.skillCd = Math.max(0, t.skillCd - dt);

      // 头顶经验条：满级隐藏，经验满时脉冲提示即将圣光升级
      if (t.xpBar) {
        t.xpBar.visible = t.level < cfg.levels.length;
        const full = this._xpFrac(t) >= 1;
        t.xpBar.scale.setScalar(full ? 1 + Math.sin(this.time * 6) * 0.1 : 1);
      }

      // 蓄力到位 → 释放（伤害 / 弹道在动作 58% 处结算）
      if (t.pending && t.castT <= castDur * 0.42) { this._releaseShot(t, lv); continue; }
      if (t.pending) continue;   // 蓄力中（含主动技能）不再索敌，避免普攻覆盖技能

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

    // 主动群攻技能：复用蓄力-释放节奏，动作 58% 处结算（以瞄准的地面位置为中心）
    if (p.skill) { this._releaseSkill(t, lv, mult, p.pos); return; }

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
            // 暗影侵蚀攻击同样参与暴击：暴击时整段 DoT 总伤害翻倍
            const crit = Math.random() < CFG.CRIT.chance;
            const total = lv.dot * mult * (crit ? CFG.CRIT.mult : 1);
            target.dots.push({ dps: total / 5, until: this.time + 5, src: 'priest' });
            if (target.dots.length > 4) target.dots.shift();
            this._damageText(target, total, crit);
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

  /* ================= 主动群攻技能（手动瞄准地面位置施放，独立 CD） ================= */

  // 瞄准确认后在指定地面位置施放：设技能 CD 并挂 pending，复用蓄力-释放机制（动作 58% 处结算）。
  // 技能优先：可打断普攻蓄力（该次普攻作废），索敌侧已保证技能 pending 不会被普攻覆盖
  castSkill(type, pos) {
    const t = this.towers.find(tw => tw.type === type);
    if (!t || this.state.paused) return false;
    if (this.state.phase !== 'wave') { UI.toast('技能需在战斗中施放', true); return false; }
    if (t.skillCd > 0) { UI.toast(`${CFG.TOWERS[type].skill.name} 冷却中 ${Math.ceil(t.skillCd)}s`, true); return false; }
    t.skillCd = CFG.TOWERS[type].skill.cd;
    t.castT = CFG.FX.castDur;
    t.head.rotation.y = Math.atan2(pos.x - t.plot.x, pos.z - t.plot.z) - t.group.rotation.y;
    t.pending = { skill: true, mult: this._auraMult(t.plot.x, t.plot.z), pos };
    return true;
  },

  /* 技能结算：以指定地面位置为中心的大范围群攻，各英雄专属机制（伤害/特效随等级成长） */
  _releaseSkill(t, lv, mult, pos) {
    const sk = CFG.TOWERS[t.type].skill;
    const fx = CFG.TOWERS[t.type].fx[t.level - 1];
    const gx = pos.x, gz = pos.z;
    const center = new THREE.Vector3(gx, 0, gz);
    const halo = new THREE.Color(fx.color).lerp(new THREE.Color(0xffffff), 0.45).getHex();
    // 施放瞬间到结算约有 0.24s 蓄力间隔，先对存活者快照，结算时再逐个校验
    const hits = this.enemies.filter(e => e.alive &&
      Utils.distXZ(gx, gz, e.mesh.position.x, e.mesh.position.z) <= sk.radius);

    if (t.type === 'mage') {
      // 冰霜新星：双层冰环爆发，重创 + 强制减速
      FX.ring(center, fx.color, sk.radius * 1.05, 0.5);
      FX.ring(center, halo, sk.radius * 0.7, 0.35);
      FX.groundGlow(center, fx.color, sk.radius * 1.1, 0.7);
      FX.burst(new THREE.Vector3(gx, 1.0, gz), fx.color, { count: Math.round(26 * fx.boost), speed: 6, life: 0.6, up: 1.5 });
      FX.light(new THREE.Vector3(gx, 1.4, gz), fx.color, { intensity: 3.0 * fx.boost, dist: sk.radius * 1.8, life: 0.45 });
      for (const e of hits) {
        this.damageEnemy(e, lv.dmg * sk.dmgMult * mult, 'mage');
        if (e.alive) this._applySlow(e, sk);
      }
      AudioSys.play('shoot_frost');

    } else if (t.type === 'hunter') {
      // 箭雨：范围内每个敌人上空落下一支强箭
      FX.groundGlow(center, fx.color, sk.radius * 1.05, 0.8);
      FX.ring(center, fx.color, sk.radius, 0.5);
      for (const e of hits) {
        FX.projectile({
          from: e.mesh.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 9, (Math.random() - 0.5) * 2)),
          kind: 'arrow', speed: 22, target: e, color: 0xffe2a8, scale: fx.boost * 1.4,
          onHit: () => {
            if (!e.alive) return;
            FX.burst(e.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xffe2a8, { count: 8, speed: 3.2, life: 0.35, gravity: 3 });
            this.damageEnemy(e, lv.dmg * sk.dmgMult * mult, 'hunter');
          }
        });
      }
      AudioSys.play('shoot_arrow');

    } else if (t.type === 'paladin') {
      // 圣光风暴：放大版奉献冲击，重创 + 长眩晕
      FX.pillar(center, fx.color, { radius: 0.8 * fx.boost, height: 5.5, life: 0.4 });
      FX.groundGlow(center, fx.color, sk.radius * 1.1, 0.7);
      FX.ring(center, fx.color, sk.radius * 1.15, 0.55);
      FX.ring(center, halo, sk.radius * 0.8, 0.4);
      FX.light(new THREE.Vector3(gx, 1.4, gz), fx.color, { intensity: 3.6 * fx.boost, dist: sk.radius * 1.8, life: 0.45 });
      FX.burst(new THREE.Vector3(gx, 1.0, gz), fx.color, { count: Math.round(22 * fx.boost), speed: 5.5, life: 0.5 });
      FX.punch(t.head);
      for (const e of hits) {
        this.damageEnemy(e, lv.dmg * sk.dmgMult * mult, 'paladin');
        if (e.alive) e.stunUntil = this.time + sk.stun;
      }
      AudioSys.play('consecrate');

    } else if (t.type === 'priest') {
      // 暗影灾变：暗影席卷，直伤 + 持续蚕食（沿用普攻 4 层上限）
      FX.pillar(center, fx.color, { radius: 0.8 * fx.boost, height: 5, life: 0.35 });
      FX.groundGlow(center, fx.color, sk.radius * 1.05, 0.7);
      FX.ring(center, fx.color, sk.radius * 1.05, 0.5);
      FX.light(new THREE.Vector3(gx, 1.4, gz), fx.color, { intensity: 3.2 * fx.boost, dist: sk.radius * 1.7, life: 0.45 });
      FX.burst(new THREE.Vector3(gx, 1.0, gz), fx.color, { count: Math.round(20 * fx.boost), speed: 5, life: 0.55 });
      for (const e of hits) {
        this.damageEnemy(e, lv.dot * sk.dmgMult * mult, 'priest');
        if (e.alive) {
          e.dots.push({ dps: lv.dot * sk.dotMult * mult / 5, until: this.time + 5, src: 'priest' });
          if (e.dots.length > 4) e.dots.shift();
        }
      }
      AudioSys.play('shoot_shadow');
    }
  },

  /* ================= 流程控制 ================= */
  // 布阵界面：确认阵容，开始第 1 关
  startGame() {
    if (this.state.phase !== 'arrange') return;
    this.state.phase = 'build';
    this.waveTimer = Infinity;
    UI.hideArrange();
    UI.showSkillBar();
    UI.showWaveButton('⚔ 开始第 1 波', 0);
    UI.setHint(HINT_DEFAULT);
  },

  // 关卡结算界面：开启下一关（重建场景主题环境，解锁更多路线）
  nextLevel() {
    if (this.state.phase !== 'inter') return;
    const prevRoutes = CFG.LEVELS[this.state.level - 1].routes || 1;
    this.state.level++;
    const lv = CFG.LEVELS[this.state.level - 1];
    World.build(this.state.level - 1);
    Env.setScene(CFG.SCENES[lv.scene]);
    this.state.phase = 'build';
    this.waveTimer = Infinity;
    UI.hideLevelScreen();
    UI.showSkillBar();
    UI.showWaveButton(`⚔ 开始 ${lv.name}`, 0);
    UI.setWave(this.state.wave);
    UI.setHint(HINT_DEFAULT);
    // 新路线开启提示
    const nowRoutes = lv.routes || 1;
    if (nowRoutes > prevRoutes) {
      const names = CFG.ROUTES.slice(prevRoutes, nowRoutes).map(r => r.name).join('、');
      UI.banner(`🚪 ${names}传送门开启！兵分多路来袭！`);
      AudioSys.play('boss_horn');
    }
  },

  /* ================= 调试热键（T：时刻+4h　W：切换天气） ================= */
  debugTime() {
    Env.setTime(Env.time + 4);
    UI.toast(`时刻跳转 ⏰ ${Env.clockLabel()}`);
  },
  debugWeather() {
    const w = Env.cycleWeather();
    UI.toast(`天气切换 ${CFG.WEATHER[w].icon} ${CFG.WEATHER[w].label}`);
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

/* ============ 环境：昼夜循环 / 太阳月亮星辰 / 雨雪雾天气 / 闪电 ============ */
/* 数值均在 config.js：CFG.ENV（昼夜关键帧）、CFG.WEATHER（天气参数）、SCENES[*].weather（天气池） */
const Env = {
  scene: null,
  time: 8,              // 游戏内时刻（小时，0-24）
  timeLock: null,       // 非 null 时锁定时刻（冰封关永夜）
  weather: 'clear',     // 当前目标天气
  night: 0,             // 夜晚系数 0-1（World 火炬/传送门夜光增益、星星亮度）
  play: { towerRangeMult: 1, enemySpeedMult: 1 },   // 天气玩法数值（随过渡插值）

  _wFrom: 'clear', _wT: 1,        // 天气过渡：from → weather，_wT 0→1
  _weatherPool: null, _lastWeather: null,
  _stars: null, _sunSprite: null, _moonSprite: null,
  _rain: null, _snow: null, _snowVel: null, _snowPh: null,
  _mists: [],
  _lightningT: 8, _flash: 0,
  _cA: null, _cB: null, _cS: null,

  init(scene) {
    this.scene = scene;
    if (!scene.fog) scene.fog = new THREE.Fog(0x88b6dd, CFG.ENV.FOG.near, CFG.ENV.FOG.far);
    this._cA = new THREE.Color(); this._cB = new THREE.Color(); this._cS = new THREE.Color();
    this._buildStars(scene);
    this._buildSunMoon(scene);
    this._buildRain(scene);
    this._buildSnow(scene);
    this._buildGroundMist(scene);
    this.setWeather('clear', true);
  },

  /* 换关时由 Game 调用：应用场景主题的时刻 / 天气池 / 常驻雾 */
  setScene(theme) {
    this.time = theme.timeStart;
    this.timeLock = theme.timeLock || null;
    this._weatherPool = theme.weather || [['clear', 1]];
    this._lastWeather = null;
    for (const m of this._mists) {
      m.userData.base = 0.03 + (theme.mist || 0) * 0.09;
      m.material.color.setHex(theme.mistColor || 0xaebfd0);
    }
    if (World.hemi) World.hemi.groundColor.setHex(theme.hemiGround || 0x3a5a2a);
    this.setWeather(this._weatherPool[0][0], true);
    this._lastWeather = this.weather;
  },

  update(dt) {
    if (this.timeLock === null) {
      this.time = (this.time + dt * 24 / CFG.ENV.DAY_LENGTH) % 24;
    }
    this._wT = Math.min(1, this._wT + dt / CFG.WEATHER.TRANSITION);
    // 天气玩法数值（随淡入淡出插值，1 为无影响）
    const f = this._wT;
    const gpF = CFG.WEATHER[this._wFrom].gameplay, gpT = CFG.WEATHER[this.weather].gameplay;
    this.play.towerRangeMult = Utils.lerp(gpF ? gpF.towerRange : 1, gpT ? gpT.towerRange : 1, f);
    this.play.enemySpeedMult = Utils.lerp(gpF ? gpF.enemySpeed : 1, gpT ? gpT.enemySpeed : 1, f);

    this._updateLightning(dt);
    this._applySky();
    this._updateRain(dt);
    this._updateSnow(dt);
    this._updateMist(dt, this.time);
  },

  /* ---------- 昼夜天空 / 光照 / 雾 ---------- */
  _applySky() {
    const keys = CFG.ENV.KEYS;
    const t = this.time;
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[i + 1];
    const k = Utils.clamp((t - a.t) / ((b.t - a.t) || 1), 0, 1);

    this._cA.setHex(a.sky); this._cB.setHex(b.sky);
    const sky = this._cA.lerp(this._cB, k);
    this._cS.setHex(a.sunC).lerp(this._cB.setHex(b.sunC), k);
    let sunI = Utils.lerp(a.sunI, b.sunI, k);
    const hemiI = Utils.lerp(a.hemi, b.hemi, k);

    // 天气削弱光照（随混合权重叠加）；闪电瞬间拉亮
    const dim = 1 - 0.28 * this._wAmount('rain') - 0.38 * this._wAmount('blizzard')
                  - 0.12 * this._wAmount('snow') - 0.08 * this._wAmount('mist');
    sunI = sunI * dim + this._flash * 5;
    if (this._flash > 0) sky.lerp(this._cB.setHex(0xdce8ff), this._flash * 0.45);

    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    // 雾距离随天气拉近（迷雾 / 暴雪能见度骤降）
    const fm = Utils.lerp(CFG.WEATHER[this._wFrom].fogMult, CFG.WEATHER[this.weather].fogMult, this._wT);
    this.scene.fog.near = CFG.ENV.FOG.near * fm;
    this.scene.fog.far = CFG.ENV.FOG.far * fm;

    if (World.hemi) {
      World.hemi.color.copy(sky);
      World.hemi.intensity = hemiI * dim + this._flash * 0.3;
    }
    if (World.sun) {
      World.sun.color.copy(this._cS);
      World.sun.intensity = sunI;
    }

    // 太阳/月亮绕场旋转（高度角按 sin 曲线，夜里走月亮路径），阴影随之流动
    const dayT = (this.time - 6 + 24) % 24;          // 距日出小时数
    const isDay = dayT < 12;
    const frac = (isDay ? dayT : dayT - 12) / 12;    // 半程进度 0-1
    const raw = Math.sin(Math.PI * frac);
    const elevA = Utils.lerp(0.30, 1.25, Math.max(raw, 0));
    const azA = Utils.lerp(-2.0, 2.0, frac) + (isDay ? 0 : Math.PI);
    const R = 40;
    const cx = Math.cos(elevA) * Math.cos(azA) * R;
    const cy = Math.sin(elevA) * R;
    const cz = Math.cos(elevA) * Math.sin(azA) * R;
    if (World.sun) World.sun.position.set(cx, cy, cz);

    // 夜晚系数：白天 0 → 黄昏 0.5 → 深夜 1（sunRaw 夜里为负）
    const sunRaw = Math.sin(Math.PI * dayT / 12);
    this.night = Utils.clamp(0.5 - sunRaw * 1.4, 0, 1);
    World.night = this.night;

    // 太阳 / 月亮辉光与星辰：(cx,cy,cz) 恒为「当前天体」位置——白天是太阳、夜晚是月亮，
    // 另一个天体在地平线下且透明度为 0
    if (this._sunSprite) {
      this._sunSprite.position.set(cx, cy, cz).normalize().multiplyScalar(140);
      this._sunSprite.material.opacity = Utils.clamp(sunRaw * 4, 0, 1) * 0.85;
    }
    if (this._moonSprite) {
      this._moonSprite.position.set(cx, cy, cz).normalize().multiplyScalar(140);
      this._moonSprite.material.opacity = Utils.clamp(-sunRaw * 4, 0, 1) * 0.9;
    }
    if (this._stars) this._stars.material.opacity = this.night * 0.9;
  },

  /* ---------- 天气调度 ---------- */
  // 每波开始时按当前关天气池加权抽取（池内多项时不与上一个重复），返回天气类型
  rollWeather() {
    const pool = this._weatherPool || [['clear', 1]];
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = Math.random() * total, pick = pool[0][0];
    for (const [name, w] of pool) { if ((r -= w) <= 0) { pick = name; break; } }
    if (pick === this._lastWeather && pool.length > 1) {
      const idx = pool.findIndex(p => p[0] === pick);
      pick = pool[(idx + 1) % pool.length][0];
    }
    this._lastWeather = pick;
    this.setWeather(pick);
    return pick;
  },

  setWeather(type, instant = false) {
    if (!CFG.WEATHER[type] || type === this.weather) return;
    this._wFrom = instant ? type : this.weather;
    this.weather = type;
    this._wT = instant ? 1 : 0;
  },

  // 某天气当前的混合权重 0-1（过渡期间两项各占一部分）
  _wAmount(type) {
    const f = Utils.clamp(this._wT, 0, 1);
    return (this._wFrom === type ? 1 - f : 0) + (this.weather === type ? f : 0);
  },

  /* ---------- 闪电（雨天随机，纯视觉） ---------- */
  _updateLightning(dt) {
    if (this._wAmount('rain') > 0.5 && CFG.WEATHER.LIGHTNING) {
      this._lightningT -= dt;
      if (this._lightningT <= 0) {
        this._lightningT = Utils.rand(7, 18);
        this._flash = 1;
      }
    }
    this._flash = Math.max(0, this._flash - dt * 5);
  },

  /* ---------- 雨 ---------- */
  _rainTexture() {
    if (this._rainTex) return this._rainTex;
    const c = document.createElement('canvas');
    c.width = 8; c.height = 48;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 48);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.3, 'rgba(255,255,255,.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(4, 46); ctx.stroke();
    this._rainTex = new THREE.CanvasTexture(c);
    return this._rainTex;
  },

  _buildRain(scene) {
    const N = CFG.WEATHER.rain.count;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Utils.rand(-48, 48);
      pos[i * 3 + 1] = Utils.rand(0, 26);
      pos[i * 3 + 2] = Utils.rand(-34, 34);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: this._rainTexture(), size: CFG.WEATHER.rain.size, color: 0x9db8d4,
      transparent: true, opacity: 0, depthWrite: false
    });
    this._rain = new THREE.Points(geo, mat);
    this._rain.frustumCulled = false;
    this._rain.visible = false;
    scene.add(this._rain);
  },

  _updateRain(dt) {
    const w = this._wAmount('rain');
    const r = this._rain;
    if (w <= 0.01) { r.visible = false; return; }
    r.visible = true;
    r.material.opacity = 0.38 * w;
    const arr = r.geometry.attributes.position.array;
    const fall = CFG.WEATHER.rain.fall;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= fall * dt;
      if (arr[i + 1] < 0) {
        arr[i + 1] += 26;
        arr[i] = Utils.rand(-48, 48);
        arr[i + 2] = Utils.rand(-34, 34);
      }
    }
    r.geometry.attributes.position.needsUpdate = true;
  },

  /* ---------- 雪 / 暴雪（共用一套粒子，drawRange 区分密度） ---------- */
  _buildSnow(scene) {
    const N = CFG.WEATHER.blizzard.count;
    const pos = new Float32Array(N * 3);
    this._snowVel = new Float32Array(N);
    this._snowPh = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Utils.rand(-48, 48);
      pos[i * 3 + 1] = Utils.rand(0, 22);
      pos[i * 3 + 2] = Utils.rand(-34, 34);
      this._snowVel[i] = Utils.rand(0.75, 1.25);
      this._snowPh[i] = Utils.rand(0, 6.28);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: FX.snowTexture(), size: CFG.WEATHER.snow.size, color: 0xeef4ff,
      transparent: true, opacity: 0, depthWrite: false
    });
    this._snow = new THREE.Points(geo, mat);
    this._snow.frustumCulled = false;
    this._snow.visible = false;
    scene.add(this._snow);
  },

  _updateSnow(dt) {
    const wS = this._wAmount('snow'), wB = this._wAmount('blizzard');
    const w = wS + wB;
    const s = this._snow;
    if (w <= 0.01) { s.visible = false; return; }
    s.visible = true;
    s.geometry.setDrawRange(0, Math.round(CFG.WEATHER.snow.count * wS + CFG.WEATHER.blizzard.count * wB));
    s.material.opacity = 0.85 * Math.min(w, 1);
    s.material.size = Utils.lerp(CFG.WEATHER.snow.size, CFG.WEATHER.blizzard.size, wB / (w || 1));
    const fall = Utils.lerp(CFG.WEATHER.snow.fall, CFG.WEATHER.blizzard.fall, wB / (w || 1));
    const drift = Utils.lerp(CFG.WEATHER.snow.drift, CFG.WEATHER.blizzard.drift, wB / (w || 1));
    const arr = s.geometry.attributes.position.array;
    const time = this.time * 40;   // 随游戏时间推进的摆动相位（与昼夜同一时钟）
    for (let i = 0; i < arr.length; i += 3) {
      const v = this._snowVel[i / 3], ph = this._snowPh[i / 3];
      arr[i + 1] -= fall * v * dt;
      arr[i] += (Math.sin(time * 0.0012 + ph) * drift + drift * 0.4) * dt;
      if (arr[i + 1] < 0) {
        arr[i + 1] += 22;
        arr[i] = Utils.rand(-48, 48);
        arr[i + 2] = Utils.rand(-34, 34);
      }
      if (arr[i] > 48) arr[i] -= 96;
    }
    s.geometry.attributes.position.needsUpdate = true;
  },

  /* ---------- 地面雾团（雾天气增强 / 沼泽与冰封关常驻薄雾） ---------- */
  _buildGroundMist(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: FX.glowTexture(), color: 0xaebfd0, transparent: true, opacity: 0, depthWrite: false
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Utils.rand(0, 6.28);
      const sx = Utils.rand(9, 16);
      m.scale.set(sx, sx * Utils.rand(0.6, 0.9), 1);
      m.position.set(Utils.rand(-28, 28), 0.3 + i * 0.04, Utils.rand(-18, 18));
      m.userData = {
        ph: Utils.rand(0, 6.28), spd: Utils.rand(0.05, 0.16),
        ox: m.position.x, oz: m.position.z, r: Utils.rand(1.5, 4.5), base: 0
      };
      scene.add(m);
      this._mists.push(m);
    }
  },

  _updateMist(dt, time) {
    const wMist = this._wAmount('mist');
    for (const m of this._mists) {
      const u = m.userData;
      const a = time * u.spd + u.ph;
      m.position.x = u.ox + Math.cos(a) * u.r;
      m.position.z = u.oz + Math.sin(a * 0.8) * u.r;
      m.material.opacity = (u.base + wMist * 0.12) * (0.8 + Math.sin(time * 0.5 + u.ph) * 0.2);
    }
  },

  /* ---------- 星辰 / 日月 ---------- */
  _buildStars(scene) {
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Utils.rand(0, Math.PI * 2);
      const e = Utils.rand(0.06, 1.4);
      const r = 165;
      pos[i * 3] = Math.cos(e) * Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.cos(e) * Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcfe0ff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    this._stars = new THREE.Points(geo, mat);
    this._stars.frustumCulled = false;
    scene.add(this._stars);
  },

  _buildSunMoon(scene) {
    const mk = (colorHex, scale) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: FX.glowTexture(), color: colorHex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      s.scale.set(scale, scale, 1);
      scene.add(s);
      return s;
    };
    this._sunSprite = mk(0xffd9a0, 30);
    this._moonSprite = mk(0xdfe8ff, 15);
  },

  /* ---------- 调试 / UI 辅助 ---------- */
  setTime(h) { this.time = ((h % 24) + 24) % 24; },
  cycleWeather() {
    const order = ['clear', 'rain', 'snow', 'blizzard', 'mist'];
    const next = order[(order.indexOf(this.weather) + 1) % order.length];
    this.setWeather(next);
    this._lastWeather = next;
    return next;
  },
  weatherLabel() {
    const w = CFG.WEATHER[this.weather];
    return `${w.icon} ${w.label}`;
  },
  clockLabel() {
    const h = Math.floor(this.time), m = Math.floor((this.time % 1) * 60);
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
  }
};

/* ============ 3D 场景：地形 / 道路 / 传送门 / 王城大门 / 建造基座 ============ */
/* 环境层（地面/道路/装饰/传送门）按关卡主题可整体重建：World.build(levelIdx) */
const MatCache = {
  _m: {},
  /* 通用材质：Phong 逐片元光照（点光闪光才能真正照亮场景），低高光保持原有哑光观感 */
  get(color, emissive = 0x000000, emissiveIntensity = 1) {
    const key = 'p' + color + '_' + emissive + '_' + emissiveIntensity;
    if (!this._m[key]) {
      this._m[key] = new THREE.MeshPhongMaterial({
        color, emissive, emissiveIntensity,
        specular: 0x0a0a0a, shininess: 10
      });
      this._m[key].userData.cached = true;   // 全局共享，World 重建时不释放
    }
    return this._m[key];
  },
  /* 金属/盔甲件：高 specular 出高光，可开 flatShading 出低模棱面感 */
  metal(color, opts = {}) {
    const key = 'm' + color + '_' + JSON.stringify(opts);
    if (!this._m[key]) {
      this._m[key] = new THREE.MeshPhongMaterial({
        color,
        specular: opts.specular !== undefined ? opts.specular : 0x8a8a8a,
        shininess: opts.shininess !== undefined ? opts.shininess : 42,
        flatShading: !!opts.flat,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 1
      });
      this._m[key].userData.cached = true;
    }
    return this._m[key];
  }
};

const World = {
  scene: null,
  plots: [],
  tracks: [],          // 当前启用的路线（PathTrack[]，按关卡 routes 数截取）
  track: null,         // 主路（tracks[0]）别名
  theme: null,
  hemi: null, sun: null,
  night: 0,            // 夜晚系数（由 Env 每帧写入，火炬/传送门夜光增益）
  _env: null,          // 可重建的环境组
  _portalFx: [],
  _torchLights: [],

  init(scene) {
    this.scene = scene;
    this._lights(scene);
    this._plots(scene);
    this._stormwindGate(scene);
    this.build(0);
  },

  /* ---------- 关卡环境重建（主题 + 启用路线数） ---------- */
  build(levelIdx) {
    const lv = CFG.LEVELS[levelIdx] || CFG.LEVELS[0];
    const theme = CFG.SCENES[lv.scene];
    this.theme = theme;

    // 释放旧环境层的几何体与非共享材质
    if (this._env) {
      this._env.traverse(o => {
        if (!o.isMesh && !o.isPoints) return;
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) if (m && !m.userData.cached) m.dispose();
      });
      this.scene.remove(this._env);
    }
    const env = this._env = new THREE.Group();
    this.scene.add(env);

    this.tracks = CFG.ROUTES.slice(0, lv.routes || 1).map(r => new PathTrack(r.path));
    this.track = this.tracks[0];
    this._portalFx = [];

    this._ground(env, theme);
    this._path(env, theme);
    this._decor(env, theme);
    for (let i = 0; i < this.tracks.length; i++) this._darkPortal(env, i);
  },

  /* ---------- 光照（hemi/sun 引用交给 Env 驱动昼夜） ---------- */
  _lights(scene) {
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a5a2a, 0.55);
    scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xfff2d8, 0.75);
    sun.position.set(-18, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    this.sun = sun;
  },

  /* ---------- 地面 ---------- */
  _ground(env, theme) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.GROUND_W, CFG.GROUND_D),
      MatCache.get(theme.ground)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    env.add(ground);

    // 随机深浅斑块，打破单调
    for (let i = 0; i < 34; i++) {
      const c = new THREE.Mesh(
        new THREE.CircleGeometry(Utils.rand(1.6, 4.2), 7),
        MatCache.get(theme.patches[i % theme.patches.length])
      );
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = Utils.rand(0, 6.28);
      c.position.set(Utils.rand(-30, 30), 0.015, Utils.rand(-20, 20));
      if (c.position.x * c.position.x + c.position.z * c.position.z < 4) continue;
      c.receiveShadow = true;
      env.add(c);
    }
  },

  /* ---------- 石板路（逐路线铺设；多路汇合段去重防 z-fighting） ---------- */
  _path(env, theme) {
    const used = new Set();
    for (const tr of this.tracks) {
      const pts = tr.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = Utils.distXZ(a.x, a.z, b.x, b.z);
        const n = Math.ceil(len / 1.35);
        const ang = Math.atan2(b.x - a.x, b.z - a.z);
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const key = Math.round(x * 2) + ',' + Math.round(z * 2);
          if (used.has(key)) continue;
          used.add(key);
          const tile = new THREE.Mesh(
            new THREE.BoxGeometry(1.28, 0.14, 1.28),
            MatCache.get(theme.pathTiles[j % theme.pathTiles.length])
          );
          tile.position.set(x, 0.07, z);
          tile.rotation.y = ang + Utils.rand(-0.08, 0.08);
          tile.receiveShadow = true;
          env.add(tile);
        }
      }
    }
  },

  /* ---------- 建造基座（城墙顶站位，一次构建不随主题重建） ---------- */
  _plots(scene) {
    for (const [x, y, z] of CFG.PLOTS) {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.56, 0.18, 8),
        MatCache.get(0x8a8072)
      );
      pad.position.set(x, y + 0.09, z);
      pad.receiveShadow = true;
      scene.add(pad);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.44, 0.05, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.85 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.2, z);
      scene.add(ring);

      const plot = { x, y, z, pad, ring, tower: null };
      pad.userData.plot = plot;
      this.plots.push(plot);
    }
  },

  /* ---------- 树木与岩石（按主题变体；避让所有已启用路线） ---------- */
  _decor(env, theme) {
    const minDistToPaths = (x, z) => {
      let best = Infinity;
      for (const tr of this.tracks) best = Math.min(best, tr.distTo(x, z));
      return best;
    };
    const farFromAll = (x, z, pathMin = 2.6, plotMin = 2.2) =>
      minDistToPaths(x, z) > pathMin &&
      CFG.PLOTS.every(p => Utils.distXZ(x, z, p[0], p[2]) > plotMin);

    // 半透明冰晶材质（icecrown 主题）
    const iceMat = theme.treeType === 'ice' ? new THREE.MeshPhongMaterial({
      color: 0xa8d4ec, transparent: true, opacity: 0.72,
      shininess: 90, specular: 0x9fd8ff, emissive: 0x16344a
    }) : null;

    let tries = 0, placed = 0;
    while (placed < theme.trees && tries++ < 400) {
      const x = Utils.rand(-30, 30), z = Utils.rand(-19, 19);
      if (!farFromAll(x, z)) continue;
      const tree = this._buildTree(theme.treeType, Utils.rand(0.8, 1.5), iceMat);
      tree.position.set(x, 0, z);
      tree.rotation.y = Utils.rand(0, 6.28);
      env.add(tree);
      placed++;
    }

    placed = 0; tries = 0;
    while (placed < theme.rocks && tries++ < 300) {
      const x = Utils.rand(-30, 30), z = Utils.rand(-19, 19);
      if (!farFromAll(x, z)) continue;
      const s = Utils.rand(0.5, 1.4);
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(s, 0),
        MatCache.get(Utils.pick(theme.rockColors))
      );
      rock.position.set(x, s * 0.45, z);
      rock.rotation.set(Utils.rand(0, 3), Utils.rand(0, 3), Utils.rand(0, 3));
      rock.castShadow = true;
      env.add(rock);
      placed++;
    }
  },

  // 主题树：pine 松树 / snowPine 雪松 / dead 枯树 / ice 冰晶
  _buildTree(type, s, iceMat) {
    const tree = new THREE.Group();
    if (type === 'pine' || type === 'snowPine') {
      const snow = type === 'snowPine';
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1.1 * s, 6),
        MatCache.get(snow ? 0x4a3826 : 0x6d4a2a)
      );
      trunk.position.y = 0.55 * s;
      trunk.castShadow = true;
      tree.add(trunk);
      const greens = snow ? [0xe8f0f6, 0xd8e4ee] : [0x2d5a25, 0x376b2c];
      let cy = 1.0 * s;
      for (let k = 0; k < 3; k++) {
        const r = (1.35 - k * 0.35) * s, h = (1.5 - k * 0.22) * s;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), MatCache.get(greens[k % 2]));
        cone.position.y = cy + h * 0.4;
        cy += h * 0.55;
        cone.castShadow = true;
        tree.add(cone);
      }
    } else if (type === 'dead') {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14 * s, 0.3 * s, 1.7 * s, 5),
        MatCache.get(0x4a3a28)
      );
      trunk.position.y = 0.85 * s;
      trunk.castShadow = true;
      tree.add(trunk);
      for (let k = 0; k < 3; k++) {
        const bl = (0.7 - k * 0.15) * s;
        const branch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05 * s, 0.09 * s, bl, 4),
          MatCache.get(0x42342a)
        );
        branch.position.y = (1.1 + k * 0.35) * s;
        branch.rotation.z = Utils.rand(0.5, 1.1) * (k % 2 ? 1 : -1);
        branch.rotation.y = Utils.rand(0, 6.28);
        branch.castShadow = true;
        tree.add(branch);
      }
    } else {   // ice 冰晶
      const main = new THREE.Mesh(new THREE.ConeGeometry(0.42 * s, 2.2 * s, 5), iceMat);
      main.position.y = 1.1 * s;
      main.castShadow = true;
      tree.add(main);
      for (let k = 0; k < 2; k++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.22 * s, (0.9 - k * 0.25) * s, 5), iceMat
        );
        spike.position.set(Utils.rand(-0.4, 0.4) * s, (0.4 + k * 0.3) * s, Utils.rand(-0.4, 0.4) * s);
        spike.rotation.z = Utils.rand(-0.5, 0.5);
        tree.add(spike);
      }
    }
    return tree;
  },

  /* ---------- 传送门（每条路线一座，朝向各自入场方向） ---------- */
  _darkPortal(env, routeIdx) {
    const tr = this.tracks[routeIdx];
    const p0 = tr.pts[0], p1 = tr.pts[1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / len, dirZ = dz / len;

    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0x2a2438, emissive: 0x0e2a12, emissiveIntensity: 0.8 });

    for (const sz of [-2.9, 2.9]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 7.2, 1.5), stone);
      pillar.position.set(0, 3.6, sz);
      pillar.castShadow = true;
      g.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 2.0), stone);
      cap.position.set(0, 7.4, sz);
      g.add(cap);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 7.3), stone);
    lintel.position.y = 8.0;
    g.add(lintel);

    // 绿色传送门（盘面法线朝向入场方向）
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.55, 32),
      new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.y = 3.2;
    glow.rotation.y = Math.PI / 2;
    g.add(glow);

    const glow2 = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 32),
      new THREE.MeshBasicMaterial({ color: 0xd8ffe6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow2.position.y = 3.2;
    glow2.rotation.y = Math.PI / 2;
    g.add(glow2);

    // 符文地面
    const rune = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    rune.rotation.x = -Math.PI / 2;
    rune.position.y = 0.03;
    g.add(rune);

    const light = new THREE.PointLight(0x44ff88, 1.4, 16);
    light.position.set(1.5, 3, 0);
    g.add(light);

    // 传送门粒子
    const N = 110;
    const pos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x6effa0, size: 0.22, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push({
        ang: Utils.rand(0, 6.28), ry: Utils.rand(2.7, 3.1), rz: Utils.rand(0.4, 2.4),
        sp: Utils.rand(0.8, 2.2), drift: Utils.rand(-0.3, 0.3)
      });
    }
    g.add(pts);

    // 立在路线起点后方，盘面朝向行进方向
    g.position.set(p0.x - dirX * 0.8, 0, p0.z - dirZ * 0.8);
    g.rotation.y = Math.atan2(-dirZ, dirX);
    env.add(g);

    this._portalFx.push({
      group: g, glow, glow2, light, pts, data, seed: routeIdx * 2.1, pulse: 0
    });
  },

  // 出怪时由 Game 调用：传送门光晕脉冲
  pulsePortal(routeIdx) {
    const fx = this._portalFx[routeIdx];
    if (fx) fx.pulse = 1;
  },

  // 传送门世界坐标（出怪特效用）
  portalPos(routeIdx) {
    const fx = this._portalFx[routeIdx];
    if (!fx) return new THREE.Vector3(0, 2, 0);
    return new THREE.Vector3(fx.group.position.x, 2.2, fx.group.position.z);
  },

  /* ---------- 王城大门（终点，一次构建） ---------- */
  _stormwindGate(scene) {
    const g = new THREE.Group();
    const white = MatCache.get(0xd8d3c4);
    const blue = MatCache.get(0x3a5f9e);

    // 城墙（中间留给路径）
    for (const sz of [-5.4, 5.4]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.8, WALL_H, 6.8), white);
      wall.position.set(0, WALL_H / 2, sz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);
      // 城垛（靠迎敌侧边沿，墙顶内侧留给英雄站位）
      for (let k = -2; k <= 2; k++) {
        const mer = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), white);
        mer.position.set(-0.45, WALL_H + 0.35, sz + k * 1.3);
        g.add(mer);
      }
    }

    // 门柱与横梁
    for (const sz of [-2.2, 2.2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, WALL_H, 0.9), white);
      p.position.set(0, WALL_H / 2, sz);
      p.castShadow = true;
      g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 5.3), white);
    beam.position.y = WALL_H + 0.5;
    beam.castShadow = true;
    g.add(beam);

    // 双塔 + 蓝色锥顶
    for (const sz of [-9.2, 9.2]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.0, 5.6, 8), white);
      tower.position.set(0, 2.8, sz);
      tower.castShadow = true;
      g.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 8), blue);
      roof.position.set(0, 6.8, sz);
      roof.castShadow = true;
      g.add(roof);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshLambertMaterial({ color: 0x3a5f9e, side: THREE.DoubleSide }));
      flag.position.set(0, 8.8, sz);
      g.add(flag);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), MatCache.get(0x777770));
      pole.position.set(0, 8.2, sz);
      g.add(pole);
    }

    // 火炬（立于门外墙面前侧，避开门前汇合的南北两路行军线）
    for (const sz of [-3.6, 3.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.2, 5), MatCache.get(0x5a4226));
      post.position.set(-1.2, 1.1, sz);
      g.add(post);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa63d });
      flameMat.color.multiplyScalar(1.5);   // 配 Bloom 轻微泛光
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.55, 6),
        flameMat
      );
      flame.position.set(-1.2, 2.4, sz);
      g.add(flame);
      const tl = new THREE.PointLight(0xff9a3d, 0.9, 9);
      tl.position.set(-1.2, 2.6, sz);
      g.add(tl);
      this._torchLights.push({ light: tl, flame, seed: Utils.rand(0, 10) });
    }

    g.position.set(24.2, 0, 0);
    scene.add(g);
  },

  /* ---------- 每帧动画 ---------- */
  update(dt, time) {
    const nightBoost = 1 + this.night * 1.2;
    // 空基座金环呼吸
    for (const plot of this.plots) {
      if (!plot.tower) {
        const s = 1 + Math.sin(time * 2.4 + plot.x) * 0.07;
        plot.ring.scale.setScalar(s);
      }
    }
    // 各路线传送门光晕 + 粒子漩涡（夜晚更亮，出怪时脉冲）
    for (const fx of this._portalFx) {
      fx.glow.material.opacity = (0.42 + Math.sin(time * 3.2 + fx.seed) * 0.12) * nightBoost
        + fx.pulse * 0.3;
      fx.glow2.material.opacity = (0.35 + Math.sin(time * 4.1 + fx.seed) * 0.1) * nightBoost;
      fx.light.intensity = (1.4 + Math.sin(time * 2.3 + fx.seed) * 0.25) * nightBoost + fx.pulse * 2.2;
      fx.pulse = Math.max(0, fx.pulse - dt * 2.2);
      const pos = fx.pts.geometry.attributes.position.array;
      for (let i = 0; i < fx.data.length; i++) {
        const d = fx.data[i];
        d.ang += d.sp * dt;
        pos[i * 3] = d.drift * Math.sin(time * 1.7 + i);
        pos[i * 3 + 1] = 3.2 + Math.cos(d.ang) * d.ry;
        pos[i * 3 + 2] = Math.sin(d.ang) * d.rz;
      }
      fx.pts.geometry.attributes.position.needsUpdate = true;
    }
    // 火炬闪烁（夜晚更亮）
    for (const t of this._torchLights) {
      const f = 0.75 + Math.sin(time * 11 + t.seed) * 0.18 + Math.sin(time * 23 + t.seed * 2) * 0.07;
      t.light.intensity = f * nightBoost;
      t.flame.scale.y = f;
    }
  },

  setPlotHover(plot, on) {
    if (!plot || plot.tower) return;
    plot.ring.material.color.setHex(on ? 0x9fffb0 : 0xffd257);
  }
};

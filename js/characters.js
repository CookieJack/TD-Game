/* ============ 角色建模：4 位英雄塔 + 8 种敌人（低多边形程序化建模，面向 +Z） ============ */
const Characters = {};

(function () {
  /* ---------- 几何辅助 ---------- */
  function M(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  const box = (w, h, d, mat, x, y, z) => M(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cyl = (rt, rb, h, mat, x, y, z, seg = 8) => M(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
  const sph = (r, mat, x, y, z, seg = 10) => M(new THREE.SphereGeometry(r, seg, seg), mat, x, y, z);
  const cone = (r, h, mat, x, y, z, seg = 8) => M(new THREE.ConeGeometry(r, h, seg), mat, x, y, z);

  function legPair(mat, x, y0, len, r = 0.09) {
    const l = cyl(r, r * 1.15, len, mat, -x, y0 + len / 2, 0);
    const rr = cyl(r, r * 1.15, len, mat, x, y0 + len / 2, 0);
    return [l, rr];
  }

  /* 发光件：亮度乘 boost，配合 Bloom 后处理产生辉光 */
  function glowMat(hex, boost = 1.2) {
    const m = new THREE.MeshBasicMaterial({ color: hex });
    m.color.multiplyScalar(boost);
    return m;
  }
  const ease = k => k * k * (3 - 2 * k);

  /* 袖臂：肩部圆柱袖，从肩垂到腰侧（武器仍独立挂身体，动作时同步摆动） */
  function arm(mat, x, y, len = 0.5, r = 0.09, tilt = 0.22) {
    const g = new THREE.Group();
    g.position.set(x, y, 0.02);
    g.rotation.x = tilt;
    g.add(cyl(r, r * 0.8, len, mat, 0, -len / 2, 0));
    return g;
  }

  /* ================= 英雄塔 ================= */

  // 亡灵法师：苍白骨相 + 深蓝法袍 + 冰霜法杖
  Characters.buildMage = function (level) {
    const g = new THREE.Group();
    const robeMat = MatCache.get(0x2b3a66), trimMat = MatCache.get(0x1c2745);
    const boneMat = MatCache.get(0xcfd3c4);
    const iceGlow = glowMat(0x9fe8ff, 1.25);

    const robe = cone(0.62, 1.25, robeMat, 0, 0.62, 0, 9);
    g.add(robe);
    g.add(cyl(0.34, 0.4, 0.5, trimMat, 0, 1.15, 0));           // 上身
    const head = sph(0.29, boneMat, 0, 1.62, 0);
    g.add(head);
    const hood = cone(0.42, 0.55, trimMat, 0, 1.85, -0.05, 9);  // 兜帽
    hood.rotation.x = -0.18;
    g.add(hood);
    for (const sx of [-0.1, 0.1]) g.add(sph(0.05, glowMat(0x7fd4ff, 1.15), sx, 1.64, 0.24, 6)); // 幽蓝眼
    for (const sx of [-0.42, 0.42]) {                            // 肩甲 + 冰棱
      const s = sph(0.17, trimMat, sx, 1.38, 0);
      s.scale.y = 0.8;
      g.add(s);
      for (let i = 0; i < 3; i++) {
        const spike = cone(0.035, 0.14 + i * 0.045, iceGlow, sx + (i - 1) * 0.075, 1.52 + i * 0.05, -0.02, 4);
        spike.rotation.z = sx * (0.25 + i * 0.15);
        g.add(spike);
      }
    }
    // 腰际符文饰带：衬环 + 6 枚发光符文
    g.add(cyl(0.5, 0.53, 0.06, trimMat, 0, 0.78, 0, 9));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rune = box(0.07, 0.1, 0.02, glowMat(0x54c8ff, 1.2), Math.sin(a) * 0.5, 0.87, Math.cos(a) * 0.5);
      rune.rotation.y = a;
      g.add(rune);
    }

    const armL = arm(trimMat, -0.4, 1.3, 0.5, 0.085);           // 袖臂
    const armR = arm(trimMat, 0.44, 1.32, 0.5, 0.085);
    g.add(armL, armR);

    // 冰霜法杖（右手侧，施法时前指）
    const staff = new THREE.Group();
    staff.add(cyl(0.035, 0.035, 1.7, MatCache.get(0x4a3626), 0, 0.1, 0, 6));
    const crystal = M(new THREE.OctahedronGeometry(0.19), iceGlow, 0, 1.05, 0);
    staff.add(crystal);
    const crystalGlow = FX.makeGlow(0x9fe8ff, 0.55);
    crystal.add(crystalGlow);
    staff.add(sph(0.09, glowMat(0x7fd4ff, 1.15), 0, 0.9, 0, 6));
    staff.position.set(0.5, 0.55, 0.12);
    staff.rotation.z = -0.12;
    g.add(staff);

    g.userData.anim = (t, moving, castK = 0) => {
      crystal.rotation.y = t * 2.2;
      crystal.position.y = 1.05 + Math.sin(t * 2.5) * 0.05;
      armL.rotation.x = 0.22 + Math.sin(t * 1.6 + 1) * 0.04;
      g.rotation.z = Math.sin(t * 1.6) * 0.02;
      if (castK > 0) {
        // 蓄力举杖 → 戳刺 → 收回
        let k;
        if (castK < 0.55) k = ease(castK / 0.55);
        else if (castK < 0.72) k = 1 + Math.sin((castK - 0.55) / 0.17 * Math.PI) * 0.14;
        else k = 1 - ease((castK - 0.72) / 0.28);
        armR.rotation.x = 0.22 - 1.05 * k;
        staff.rotation.x = 1.05 * k;
        staff.position.y = 0.55 + 0.22 * k;
        crystalGlow.scale.setScalar(0.55 * (1 + 0.9 * Math.min(k, 1)));
        crystalGlow.material.opacity = 0.9;
      } else {
        armR.rotation.x = 0.22 + Math.sin(t * 1.6) * 0.03;
        staff.rotation.x = 0;
        staff.position.y = 0.55;
        crystalGlow.scale.setScalar(0.55);
        crystalGlow.material.opacity = 0.75 + Math.sin(t * 3) * 0.15;
      }
    };
    g.userData.anchor = crystal;

    // 3 级专属：悬浮冰晶
    if (level >= 3) {
      const ice = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85 }));
      ice.material.color.multiplyScalar(1.4);
      ice.castShadow = true;
      ice.position.set(0, 2.5, 0);
      g.add(ice);
      const base = g.userData.anim;
      g.userData.anim = (t, moving, castK) => { base(t, moving, castK); ice.rotation.y = -t * 1.8; ice.position.y = 2.5 + Math.sin(t * 2) * 0.09; };
    }
    return g;
  };

  // 精灵猎人：紫肤 + 绿色皮甲 + 长弓
  Characters.buildHunter = function (level) {
    const g = new THREE.Group();
    const skin = MatCache.get(0x8a68b8), armor = MatCache.get(0x3f6b34), dark = MatCache.get(0x2d4d26);
    const hair = MatCache.get(0xe8e4d8);
    const leather = MatCache.metal(0x6b4a26, { flat: true });

    const [l1, l2] = legPair(dark, 0.16, 0, 0.62, 0.1);
    g.add(l1, l2);
    g.add(box(0.56, 0.62, 0.34, armor, 0, 0.95, 0));           // 胸甲
    g.add(box(0.6, 0.14, 0.38, dark, 0, 1.28, 0));             // 肩带
    g.add(cyl(0.1, 0.12, 0.06, leather, 0, 1.0, 0.19, 6));     // 护心镜
    g.add(sph(0.045, glowMat(0x9d7bff, 1.25), 0, 1.0, 0.23, 6)); // 月纹徽记
    const head = sph(0.27, skin, 0, 1.6, 0.02);
    g.add(head);
    const h = sph(0.29, hair, 0, 1.66, -0.1);                  // 银白长发
    h.scale.set(1, 1.1, 1);
    g.add(h);
    for (const sx of [-0.24, 0.24]) {                          // 精灵长耳
      const ear = cone(0.07, 0.34, skin, sx * 1.5, 1.78, -0.05, 5);
      ear.rotation.z = sx > 0 ? -0.5 : 0.5;
      g.add(ear);
    }
    for (const sx of [-0.09, 0.09]) g.add(sph(0.035, glowMat(0xb8ff5a, 1.2), sx, 1.62, 0.25, 6)); // 发光绿眼

    // 弓（-X 侧，弓面转向 +Z，箭指敌人）
    const armR = arm(dark, -0.44, 1.3, 0.5, 0.08);
    g.add(armR);
    const bow = new THREE.Group();
    const arc = M(new THREE.TorusGeometry(0.55, 0.04, 6, 14, Math.PI), MatCache.metal(0x8a5c2e, { flat: true }), 0, 0, 0);
    arc.rotation.z = -Math.PI / 2;
    bow.add(arc);
    bow.add(cyl(0.012, 0.012, 1.1, MatCache.get(0xd8d3c4), 0, 0, 0, 4)); // 弓弦
    for (const sy of [-0.52, 0.52]) bow.add(sph(0.04, glowMat(0x9d7bff, 1.25), 0, sy, 0, 5)); // 弓梢月光石
    // 搭在弦上的待发箭（拉弓时后移，放箭时隐去）
    const nock = new THREE.Group();
    const ns = cyl(0.018, 0.018, 0.6, MatCache.get(0xc9a06a), 0.3, 0, 0.05, 5);
    ns.rotation.z = -Math.PI / 2;
    nock.add(ns);
    const nt = M(new THREE.ConeGeometry(0.04, 0.12, 5), glowMat(0xdfe8ff, 1.15), 0.64, 0, 0.05, 5);
    nt.rotation.z = -Math.PI / 2;
    nock.add(nt);
    bow.add(nock);
    bow.position.set(-0.42, 1.0, 0.18);
    bow.rotation.y = -Math.PI / 2 + 0.18;
    g.add(bow);
    // 背上箭袋（箭羽两色）
    const quiver = cyl(0.1, 0.1, 0.5, MatCache.get(0x6b4a26), 0.22, 1.25, -0.22, 6);
    quiver.rotation.x = 0.35;
    g.add(quiver);
    for (let i = 0; i < 3; i++) {
      const f = cone(0.035, 0.14, i % 2 ? glowMat(0x9d7bff, 1.3) : MatCache.get(0xe8e4d8), 0.22 + (i - 1) * 0.05, 1.55, -0.32 - (i - 1) * 0.02, 4);
      f.rotation.x = -0.5;
      g.add(f);
    }

    g.userData.anim = (t, moving, castK = 0) => {
      const w = Math.sin(t * 9);
      l1.rotation.x = w * 0.55 * moving;
      l2.rotation.x = -w * 0.55 * moving;
      g.position.y = Math.sin(t * 2.3) * 0.018;                // 呼吸起伏（始终生效）
      bow.rotation.z = Math.sin(t * 1.8) * 0.025;
      if (castK > 0) {
        // 举弓瞄准 → 拉弓放箭 → 后坐收回
        if (castK < 0.5) {
          const e = ease(castK / 0.5);
          bow.position.y = 1.0 + 0.15 * e;
          nock.position.x = -0.22 * e;
          nock.visible = true;
        } else {
          bow.position.y = 1.15;
          nock.visible = false;
          const rec = castK < 0.68 ? Math.sin((castK - 0.5) / 0.18 * Math.PI) : 0;
          bow.position.z = 0.18 + rec * 0.1;
        }
        if (castK > 0.92) {
          nock.visible = true;
          nock.position.x = 0;
          bow.position.y = 1.0;
          bow.position.z = 0.18;
        }
      } else {
        nock.visible = true;
        nock.position.x = 0;
        bow.position.set(-0.42, 1.0, 0.18);
      }
    };
    g.userData.anchor = nt;   // 弹道从箭尖发出

    if (level >= 3) {
      // 3 级专属：猎人宠物（小豹猫，加项圈与发光眼）
      const pet = new THREE.Group();
      const fur = MatCache.get(0xc98f4a);
      const pb = sph(0.24, fur, 0, 0.26, 0);
      pb.scale.set(1.5, 0.9, 1);
      pet.add(pb);
      pet.add(sph(0.14, fur, 0.36, 0.34, 0));
      for (const sx of [-0.1, 0.1]) pet.add(cone(0.045, 0.1, MatCache.get(0x8a5c2e), 0.36 + sx * 0.5, 0.5, 0, 4));
      for (const sz of [-0.06, 0.06]) pet.add(sph(0.028, glowMat(0xb8ff5a, 1.2), 0.47, 0.37, sz, 5)); // 发光眼
      const collar = M(new THREE.TorusGeometry(0.13, 0.022, 5, 10), leather, 0.26, 0.26, 0);
      collar.rotation.y = Math.PI / 2;
      pet.add(collar);
      const tail = cone(0.045, 0.26, fur, -0.4, 0.28, 0, 5);
      tail.rotation.z = -0.7;
      pet.add(tail);
      pet.position.set(-0.85, 0, 0.35);
      g.add(pet);
      const base = g.userData.anim;
      g.userData.anim = (t, moving, castK) => {
        base(t, moving, castK);
        pet.position.y = Math.abs(Math.sin(t * 6)) * 0.05;      // 宠物常驻蹦跳
        tail.rotation.y = Math.sin(t * 10) * 0.35;              // 摆尾
      };
    }
    return g;
  };

  // 人类圣骑士：金银重甲 + 盾 + 战锤
  Characters.buildPaladin = function (level) {
    const g = new THREE.Group();
    const silver = MatCache.metal(0xb8bcc4, { flat: true });
    const silverDark = MatCache.get(0x8a8e96);
    const gold = MatCache.metal(0xd4af37, { flat: true });
    const dark = MatCache.get(0x5a5e66), skin = MatCache.get(0xe8b88a);
    const capeMat = new THREE.MeshPhongMaterial({ color: 0x2a4a8a, side: THREE.DoubleSide, specular: 0x111111, shininess: 6 });

    const [l1, l2] = legPair(dark, 0.19, 0, 0.6, 0.12);
    g.add(l1, l2);
    g.add(box(0.72, 0.7, 0.44, silver, 0, 0.95, 0));           // 胸甲
    g.add(box(0.76, 0.16, 0.48, gold, 0, 1.32, 0));            // 金色腰带
    const cape = M(new THREE.PlaneGeometry(0.7, 1.0), capeMat, 0, 0.95, -0.28);
    cape.rotation.x = 0.1;
    g.add(cape);
    cape.add(box(0.7, 0.06, 0.015, gold, 0, -0.47, 0.01));     // 披风金边
    const head = sph(0.27, skin, 0, 1.58, 0);
    g.add(head);
    const helm = sph(0.3, silver, 0, 1.63, -0.02);
    helm.scale.set(1.02, 0.9, 1.02);
    g.add(helm);
    g.add(box(0.5, 0.08, 0.4, gold, 0, 1.72, 0.12));           // 金盔檐
    for (const sx of [-0.11, 0, 0.11]) g.add(cone(0.032, 0.13, gold, sx, 1.92, -0.02, 4)); // 冠刺
    g.add(box(0.24, 0.045, 0.02, glowMat(0x9ac8ff, 1.2), 0, 1.6, 0.29)); // 面甲缝发光眼
    for (const sx of [-0.46, 0.46]) {                          // 大金肩甲
      const s = sph(0.22, gold, sx, 1.28, 0);
      s.scale.y = 0.75;
      g.add(s);
    }

    const armL = arm(silverDark, -0.46, 1.28, 0.5, 0.095);     // 左臂（扶盾）
    const armR = arm(silverDark, 0.46, 1.3, 0.48, 0.095);      // 右臂（抡锤）
    g.add(armL, armR);

    // 左手巨盾 + 圣光徽记
    const shield = new THREE.Group();
    shield.add(box(0.12, 0.95, 0.7, silver, 0, 0, 0));
    shield.add(box(0.14, 0.6, 0.14, gold, -0.01, 0, 0));
    const emblem = cyl(0.17, 0.17, 0.03, glowMat(0xffd257, 1.15), -0.075, 0.18, 0, 14);
    emblem.rotation.z = Math.PI / 2;
    shield.add(emblem);
    shield.position.set(-0.5, 0.95, 0.1);
    g.add(shield);

    // 右手战锤 + 圣光纹
    const hammer = new THREE.Group();
    hammer.add(cyl(0.045, 0.045, 1.15, MatCache.get(0x4a3626), 0, 0, 0, 6));
    hammer.add(box(0.34, 0.34, 0.42, silver, 0, 0.62, 0));
    hammer.add(box(0.36, 0.07, 0.44, glowMat(0xffd257, 1.15), 0, 0.62, 0));
    hammer.add(box(0.36, 0.12, 0.44, gold, 0, 0.48, 0));
    const headGlow = FX.makeGlow(0xffd257, 0.4);
    headGlow.position.set(0, 0.62, 0);
    hammer.add(headGlow);
    hammer.position.set(0.52, 0.85, 0.08);
    hammer.rotation.z = -0.35;
    g.add(hammer);

    g.userData.anim = (t, moving, castK = 0) => {
      const w = Math.sin(t * 8);
      l1.rotation.x = w * 0.5 * moving;
      l2.rotation.x = -w * 0.5 * moving;
      cape.rotation.x = 0.1 + Math.sin(t * 2) * 0.035;
      armL.rotation.x = 0.22 + Math.sin(t * 1.5 + 0.5) * 0.03;
      hammer.rotation.z = -0.35 + Math.sin(t * 1.5) * 0.04;
      if (castK > 0) {
        // 抡锤过顶 → 砸地 → 收势
        if (castK < 0.5) {
          armR.rotation.x = 0.22 - 2.5 * ease(castK / 0.5);
        } else if (castK < 0.68) {
          const e = (castK - 0.5) / 0.18;
          armR.rotation.x = -2.28 + 1.85 * e * e;
        } else {
          armR.rotation.x = -0.43 + 0.65 * ease((castK - 0.68) / 0.32);
        }
      } else {
        armR.rotation.x = 0.22 + Math.sin(t * 1.5 + 1.2) * 0.035;
      }
    };

    if (level >= 3) {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.035, 6, 20),
        glowMat(0xffd257, 1.2)
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 2.05;
      g.add(halo);
      const base = g.userData.anim;
      g.userData.anim = (t, moving, castK) => { base(t, moving, castK); halo.rotation.z = t * 1.5; };
    }
    return g;
  };

  // 精灵牧师：红白法袍 + 金发 + 暗影法球
  Characters.buildPriest = function (level) {
    const g = new THREE.Group();
    const robe = MatCache.get(0x9e2333), white = MatCache.get(0xe8e2d4);
    const skin = MatCache.get(0xf2cba0), hairM = MatCache.get(0xe8c84a);
    const goldTrim = MatCache.get(0xd4af37);
    const shadowGlow = glowMat(0xb04ae8, 1.2);

    const gown = cone(0.6, 1.3, robe, 0, 0.65, 0, 9);
    g.add(gown);
    g.add(cyl(0.3, 0.38, 0.55, robe, 0, 1.18, 0));
    g.add(box(0.34, 0.5, 0.05, white, 0, 1.15, 0.36));          // 白色圣袍前襟
    g.add(box(0.05, 0.5, 0.055, goldTrim, -0.17, 1.15, 0.36));  // 前襟金线镶边
    g.add(box(0.05, 0.5, 0.055, goldTrim, 0.17, 1.15, 0.36));
    g.add(cyl(0.575, 0.6, 0.07, goldTrim, 0, 0.1, 0, 9));       // 袍摆金环
    const head = sph(0.27, skin, 0, 1.66, 0);
    g.add(head);
    const hair = sph(0.3, hairM, 0, 1.74, -0.07);
    hair.scale.set(1.02, 1.05, 1);
    g.add(hair);
    const bun = sph(0.12, hairM, 0, 1.95, -0.18);
    g.add(bun);
    // 悬浮圣光头环
    const haloGrp = new THREE.Group();
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.026, 6, 18), glowMat(0xffd257, 1.2));
    halo.rotation.x = Math.PI / 2;
    haloGrp.add(halo);
    haloGrp.position.set(0, 2.18, -0.05);
    g.add(haloGrp);

    const armL = arm(robe, -0.4, 1.32, 0.5, 0.085);
    const armR = arm(robe, 0.46, 1.34, 0.5, 0.085);
    g.add(armL, armR);

    // 法杖（金顶，施法时举起）
    const staff = new THREE.Group();
    staff.add(cyl(0.032, 0.032, 1.75, goldTrim, 0, 0.1, 0, 6));
    const orb = sph(0.11, glowMat(0xffcf5f, 1.2), 0, 1.0, 0, 8);
    staff.add(orb);
    const orbGlow = FX.makeGlow(0xffcf5f, 0.5);
    orb.add(orbGlow);
    const ring = M(new THREE.TorusGeometry(0.17, 0.025, 6, 16), goldTrim, 0, 1.0, 0);
    staff.add(ring);
    staff.position.set(0.48, 0.55, 0.1);
    staff.rotation.z = -0.1;
    g.add(staff);

    // 环绕暗影法球（各带微光）
    const orbs = [];
    for (let i = 0; i < 2; i++) {
      const o = sph(0.09, shadowGlow, 0, 1.4, 0, 6);
      o.add(FX.makeGlow(0xb04ae8, 0.3));
      g.add(o);
      orbs.push(o);
    }
    g.userData.anim = (t, moving, castK = 0) => {
      let radius = 0.55;
      if (castK > 0) {
        // 法球收拢蓄力 → 迸发 → 回位；举杖
        if (castK < 0.55) radius = 0.55 - 0.29 * ease(castK / 0.55);
        else if (castK < 0.7) radius = 0.26 + 0.5 * ease((castK - 0.55) / 0.15);
        else radius = 0.76 - 0.21 * ease((castK - 0.7) / 0.3);
        armR.rotation.x = 0.22 - 1.6 * ease(Math.min(castK / 0.55, 1));
        staff.rotation.x = 0.55 * ease(Math.min(castK / 0.55, 1));
        staff.position.y = 0.55 + 0.3 * ease(Math.min(castK / 0.55, 1));
      } else {
        armR.rotation.x = 0.22 + Math.sin(t * 1.4) * 0.03;
        staff.rotation.x = 0;
        staff.position.y = 0.55;
      }
      orbs.forEach((o, i) => {
        const a = t * 2.2 + i * Math.PI;
        o.position.set(Math.cos(a) * radius, 1.35 + Math.sin(t * 3 + i) * 0.12, Math.sin(a) * radius);
      });
      orb.position.y = 1.0 + Math.sin(t * 2.6) * 0.05;
      haloGrp.position.y = 2.18 + Math.sin(t * 2) * 0.045;
      haloGrp.rotation.y = t * 0.8;
      g.rotation.z = Math.sin(t * 1.5) * 0.018;
    };
    g.userData.anchor = orb;

    if (level >= 3) {
      const third = sph(0.09, shadowGlow, 0.55, 1.35, 0, 6);
      third.add(FX.makeGlow(0xb04ae8, 0.3));
      g.add(third);
      orbs.push(third);
    }
    return g;
  };

  /* 塔整体：基座 + 角色 */
  Characters.buildTower = function (type, level) {
    const cfg = CFG.TOWERS[type];
    const group = new THREE.Group();

    const pedestal = cyl(0.55, 0.62, 0.42, MatCache.get(0x8a8072), 0, 0.21, 0, 9);
    group.add(pedestal);
    const trim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.57, 0.57, 0.08, 9),
      new THREE.MeshBasicMaterial({ color: cfg.clsColor })
    );
    trim.position.y = 0.42;
    group.add(trim);

    const head = Characters['build' + type.charAt(0).toUpperCase() + type.slice(1)](level);
    head.scale.setScalar(1 + (level - 1) * 0.09);
    head.position.y = 0.42;
    group.add(head);

    group.userData.head = head;
    group.userData.type = type;
    group.userData.level = level;
    return group;
  };

  /* ================= 敌人 ================= */

  // 鱼人
  Characters.buildMurloc = function () {
    const g = new THREE.Group();
    const skin = MatCache.get(0x4a9e4a), belly = MatCache.get(0x8fc47a);
    const eye = new THREE.MeshBasicMaterial({ color: 0xffffff }), pupil = new THREE.MeshBasicMaterial({ color: 0x111111 });

    const body = sph(0.42, skin, 0, 0.55, 0);
    body.scale.set(0.9, 1.05, 0.8);
    g.add(body);
    const bellyMesh = sph(0.34, belly, 0, 0.45, 0.14);
    bellyMesh.scale.set(0.85, 0.9, 0.6);
    g.add(bellyMesh);
    const fin = cone(0.16, 0.4, skin, 0, 1.05, -0.1, 4);
    g.add(fin);
    for (const sx of [-0.18, 0.18]) {
      g.add(sph(0.1, eye, sx, 0.78, 0.32, 6));
      g.add(sph(0.045, pupil, sx, 0.78, 0.41, 5));
    }
    const [l1, l2] = legPair(skin, 0.18, 0, 0.3, 0.08);
    g.add(l1, l2);
    g.userData.anim = (t, mv) => {
      const w = Math.sin(t * 11);
      l1.rotation.x = w * 0.7 * mv; l2.rotation.x = -w * 0.7 * mv;
      g.rotation.z = w * 0.08 * mv;
      g.position.y = Math.abs(w) * 0.05 * mv;
    };
    g.userData.height = 1.35;
    return g;
  };

  // 野猪
  Characters.buildBoar = function () {
    const g = new THREE.Group();
    const fur = MatCache.get(0x7a5230), dark = MatCache.get(0x5c3d22);
    const tusk = MatCache.get(0xe8e2d4);

    const body = sph(0.5, fur, 0, 0.55, 0);
    body.scale.set(0.85, 0.8, 1.35);
    g.add(body);
    const mane = box(0.16, 0.22, 0.9, dark, 0, 1.0, 0);
    g.add(mane);
    const head = sph(0.32, fur, 0, 0.55, 0.62);
    head.scale.set(0.9, 0.85, 1);
    g.add(head);
    const snout = cyl(0.14, 0.18, 0.25, dark, 0, 0.5, 0.95, 7);
    snout.rotation.x = Math.PI / 2;
    g.add(snout);
    for (const sx of [-0.16, 0.16]) {
      const t = cone(0.05, 0.22, tusk, sx, 0.42, 0.85, 5);
      t.rotation.x = -1.1;
      g.add(t);
    }
    const legs = [];
    for (const [sx, sz] of [[-0.22, 0.3], [0.22, 0.3], [-0.22, -0.3], [0.22, -0.3]]) {
      const leg = cyl(0.08, 0.09, 0.42, dark, sx, 0.21, sz, 5);
      legs.push(leg);
      g.add(leg);
    }
    g.userData.anim = (t, mv) => {
      legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 10 + i * Math.PI / 2) * 0.5 * mv; });
      g.position.y = Math.abs(Math.sin(t * 10)) * 0.04 * mv;
    };
    g.userData.height = 1.3;
    return g;
  };

  // 食尸鬼
  Characters.buildGhoul = function () {
    const g = new THREE.Group();
    const skin = MatCache.get(0xa8a894), dark = MatCache.get(0x6e6a58);
    const eye = new THREE.MeshBasicMaterial({ color: 0xff3a2a });

    const torso = box(0.5, 0.6, 0.32, skin, 0, 0.85, 0);
    torso.rotation.x = 0.28;                                     // 驼背前倾
    g.add(torso);
    const head = sph(0.24, skin, 0, 1.22, 0.26);
    g.add(head);
    for (const sx of [-0.09, 0.09]) g.add(sph(0.045, eye, sx, 1.26, 0.44, 5));
    const jaw = box(0.2, 0.08, 0.16, dark, 0, 1.1, 0.42);
    g.add(jaw);
    const arms = [];
    for (const sx of [-0.3, 0.3]) {
      const arm = cyl(0.06, 0.05, 0.75, skin, sx, 0.72, 0.18, 5);
      arm.rotation.x = 0.5;
      arms.push(arm);
      g.add(arm);
      // 利爪
      const claw = cone(0.04, 0.14, dark, sx, 0.36, 0.42, 4);
      claw.rotation.x = Math.PI;
      g.add(claw);
    }
    const [l1, l2] = legPair(skin, 0.14, 0, 0.62, 0.08);
    g.add(l1, l2);
    g.userData.anim = (t, mv) => {
      const w = Math.sin(t * 8);
      l1.rotation.x = w * 0.5 * mv; l2.rotation.x = -w * 0.5 * mv;
      arms.forEach((a, i) => { a.rotation.x = 0.5 + Math.sin(t * 8 + i * Math.PI) * 0.3 * mv; });
      g.position.y = Math.abs(w) * 0.05 * mv;
      torso.rotation.x = 0.28 + Math.sin(t * 4) * 0.03;
    };
    g.userData.height = 1.75;
    return g;
  };

  // 石像鬼（飞行）
  Characters.buildGargoyle = function () {
    const g = new THREE.Group();
    const stone = MatCache.get(0x7d7d88), dark = MatCache.get(0x55555e);
    const eye = new THREE.MeshBasicMaterial({ color: 0x66ff88 });

    const body = sph(0.36, stone, 0, 0, 0);
    body.scale.set(0.85, 1, 1);
    g.add(body);
    const head = sph(0.22, stone, 0, 0.32, 0.1);
    g.add(head);
    for (const sx of [-0.09, 0.09]) {
      g.add(sph(0.04, eye, sx, 0.36, 0.28, 5));
      const horn = cone(0.05, 0.2, dark, sx * 1.8, 0.5, 0, 4);
      horn.rotation.z = sx > 0 ? -0.5 : 0.5;
      g.add(horn);
    }
    // 双翼（拍打）
    const wings = [];
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      const mem = M(new THREE.PlaneGeometry(0.85, 0.5), new THREE.MeshLambertMaterial({ color: 0x55555e, side: THREE.DoubleSide }), 0.45 * sx, 0.1, -0.05);
      mem.rotation.x = -Math.PI / 2;
      wing.add(mem);
      const bone = box(0.85, 0.05, 0.05, dark, 0.42 * sx, 0.12, 0);
      wing.add(bone);
      wing.position.set(0.18 * sx, 0.15, 0);
      wing.rotation.y = sx * 0.35;
      g.add(wing);
      wings.push(wing);
    }
    const claws = cyl(0.05, 0.03, 0.3, dark, 0, -0.35, 0.1, 5);
    g.add(claws);
    g.userData.anim = (t, mv) => {
      const f = Math.sin(t * 14) * 0.55;
      wings[0].rotation.z = f + 0.15;
      wings[1].rotation.z = -f - 0.15;
      claws.rotation.x = Math.sin(t * 7) * 0.2;
    };
    g.userData.height = 1.0;
    return g;
  };

  // 兽人步兵
  Characters.buildOrc = function () {
    const g = new THREE.Group();
    const skin = MatCache.get(0x5a7a3a), armor = MatCache.get(0x6e4a2a);
    const dark = MatCache.get(0x4a3018), metal = MatCache.get(0x8a8d92);
    const tusk = MatCache.get(0xe8e2d4);

    const [l1, l2] = legPair(dark, 0.2, 0, 0.6, 0.12);
    g.add(l1, l2);
    const torso = box(0.78, 0.68, 0.46, armor, 0, 0.95, 0);
    g.add(torso);
    g.add(box(0.8, 0.14, 0.48, dark, 0, 0.72, 0));              // 腰带
    const head = sph(0.3, skin, 0, 1.55, 0.03);
    g.add(head);
    const jaw = box(0.3, 0.12, 0.22, skin, 0, 1.42, 0.16);
    g.add(jaw);
    for (const sx of [-0.1, 0.1]) {                             // 獠牙
      const t = cone(0.04, 0.14, tusk, sx, 1.4, 0.26, 4);
      g.add(t);
    }
    const pad = sph(0.24, metal, -0.44, 1.25, 0);               // 单边铁肩甲
    pad.scale.y = 0.7;
    g.add(pad);
    // 战斧
    const axe = new THREE.Group();
    axe.add(cyl(0.04, 0.04, 1.2, dark, 0, 0, 0, 5));
    const blade = box(0.06, 0.34, 0.42, metal, 0.14, 0.52, 0);
    axe.add(blade);
    axe.position.set(0.5, 0.75, 0.05);
    axe.rotation.z = -0.4;
    g.add(axe);

    g.userData.anim = (t, mv) => {
      const w = Math.sin(t * 7);
      l1.rotation.x = w * 0.5 * mv; l2.rotation.x = -w * 0.5 * mv;
      axe.rotation.z = -0.4 + Math.sin(t * 7 + 1) * 0.15 * mv;
      g.position.y = Math.abs(w) * 0.04 * mv;
    };
    g.userData.height = 2.1;
    return g;
  };

  // 巫妖（精英，漂浮）
  Characters.buildLich = function () {
    const g = new THREE.Group();
    const robe = MatCache.get(0x1e2a4a), trim = MatCache.get(0x14203a);
    const bone = MatCache.get(0xd8dce4);
    const eye = new THREE.MeshBasicMaterial({ color: 0x5fe8ff });

    const gown = cone(0.72, 1.5, robe, 0, 0.75, 0, 9);
    g.add(gown);
    g.add(cyl(0.3, 0.42, 0.55, trim, 0, 1.5, 0));
    const skull = sph(0.28, bone, 0, 1.95, 0);
    g.add(skull);
    for (const sx of [-0.1, 0.1]) g.add(sph(0.05, eye, sx, 1.98, 0.24, 5));
    const crown = cyl(0.3, 0.26, 0.18, MatCache.get(0xd4af37), 0, 2.22, 0, 8);
    g.add(crown);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const spike = cone(0.04, 0.18, MatCache.get(0xd4af37), Math.cos(a) * 0.24, 2.38, Math.sin(a) * 0.24, 4);
      g.add(spike);
    }
    for (const sx of [-0.5, 0.5]) {                              // 尖肩
      const s = cone(0.14, 0.42, trim, sx, 1.62, 0, 5);
      s.rotation.z = sx > 0 ? -0.4 : 0.4;
      g.add(s);
    }
    // 冰霜法杖
    const staff = new THREE.Group();
    staff.add(cyl(0.03, 0.03, 1.6, MatCache.get(0x3a4a6a), 0, 0, 0, 5));
    staff.add(sph(0.12, new THREE.MeshBasicMaterial({ color: 0x5fe8ff }), 0, 0.92, 0, 6));
    staff.position.set(0.55, 0.9, 0.1);
    staff.rotation.z = -0.15;
    g.add(staff);

    g.userData.anim = (t) => {
      g.position.y = 0.35 + Math.sin(t * 2.2) * 0.12;            // 漂浮
      staff.children[1].position.y = 0.92 + Math.sin(t * 3) * 0.06;
      gown.rotation.y = Math.sin(t) * 0.05;
    };
    g.userData.height = 2.9;
    g.userData.hover = 0.35;
    return g;
  };

  // 深渊火魔王（Boss）
  Characters.buildAbyssal = function () {
    const g = new THREE.Group();
    const flesh = MatCache.get(0x6e2018), dark = MatCache.get(0x431208);
    const lava = new THREE.MeshBasicMaterial({ color: 0xff7a1e });
    const eye = new THREE.MeshBasicMaterial({ color: 0xffe25f });

    const [l1, l2] = legPair(dark, 0.3, 0, 0.8, 0.18);
    g.add(l1, l2);
    const torso = sph(0.75, flesh, 0, 1.5, 0);
    torso.scale.set(1.1, 1.15, 0.9);
    g.add(torso);
    for (let i = 0; i < 5; i++) {                                // 熔岩裂纹
      const crack = box(0.08, Utils.rand(0.3, 0.6), 0.06, lava, Utils.rand(-0.4, 0.4), Utils.rand(1.1, 1.9), 0.62);
      g.add(crack);
    }
    const head = sph(0.34, dark, 0, 2.35, 0.1);
    g.add(head);
    for (const sx of [-0.12, 0.12]) g.add(sph(0.06, eye, sx, 2.4, 0.4, 5));
    for (const sx of [-0.2, 0.2]) {                              // 弯角
      const horn = cone(0.09, 0.55, dark, sx * 1.6, 2.7, 0, 5);
      horn.rotation.z = sx > 0 ? -0.7 : 0.7;
      g.add(horn);
    }
    const arms = [];
    for (const sx of [-0.85, 0.85]) {
      const arm = cyl(0.16, 0.2, 1.0, flesh, sx, 1.45, 0.1, 6);
      arm.rotation.z = sx > 0 ? -0.25 : 0.25;
      arms.push(arm);
      g.add(arm);
    }
    const light = new THREE.PointLight(0xff7a1e, 1.1, 8);
    light.position.y = 1.6;
    g.add(light);

    g.userData.anim = (t, mv) => {
      const w = Math.sin(t * 5);
      l1.rotation.x = w * 0.4 * mv; l2.rotation.x = -w * 0.4 * mv;
      arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 5 + i * Math.PI) * 0.25 * mv; });
      g.position.y = Math.abs(w) * 0.07 * mv;
      light.intensity = 1 + Math.sin(t * 6) * 0.25;
    };
    g.userData.height = 3.4;
    return g;
  };

  // 亡灵之王（最终 Boss）
  Characters.buildLichking = function () {
    const g = new THREE.Group();
    const armor = MatCache.get(0x3a3f4a), dark = MatCache.get(0x23262e);
    const bone = MatCache.get(0xd8dce8);
    const eye = new THREE.MeshBasicMaterial({ color: 0x5fe8ff });
    const capeMat = new THREE.MeshLambertMaterial({ color: 0x14203a, side: THREE.DoubleSide });

    const [l1, l2] = legPair(dark, 0.28, 0, 0.85, 0.16);
    g.add(l1, l2);
    g.add(box(1.0, 0.95, 0.6, armor, 0, 1.45, 0));
    g.add(box(1.06, 0.18, 0.64, bone, 0, 1.0, 0));               // 白金腰扣
    const cape = M(new THREE.PlaneGeometry(1.1, 1.7), capeMat, 0, 1.3, -0.4);
    cape.rotation.x = 0.08;
    g.add(cape);
    const head = sph(0.32, bone, 0, 2.15, 0.03);
    g.add(head);
    const helm = sph(0.36, armor, 0, 2.2, 0);
    helm.scale.set(1.05, 0.95, 1.05);
    g.add(helm);
    for (const sx of [-0.11, 0.11]) g.add(sph(0.055, eye, sx, 2.14, 0.32, 5));
    for (const sx of [-0.24, 0.24]) {                            // 王冠尖角
      const horn = cone(0.07, 0.42, bone, sx * 1.9, 2.62, 0, 4);
      horn.rotation.z = sx > 0 ? -0.35 : 0.35;
      g.add(horn);
    }
    for (const sx of [-0.62, 0.62]) {                            // 尖肩甲
      const s = cone(0.2, 0.6, armor, sx, 1.85, 0, 5);
      s.rotation.z = sx > 0 ? -0.3 : 0.3;
      g.add(s);
    }
    // 冰霜魔剑
    const sword = new THREE.Group();
    sword.add(cyl(0.045, 0.045, 0.7, dark, 0, -0.3, 0, 5));
    sword.add(box(0.14, 0.12, 0.28, bone, 0, 0.08, 0));
    const blade = box(0.05, 1.7, 0.16, MatCache.get(0xb8c4d8), 0, 1.0, 0);
    sword.add(blade);
    const glowEdge = box(0.055, 1.72, 0.05, new THREE.MeshBasicMaterial({ color: 0x5fe8ff, transparent: true, opacity: 0.7 }), 0, 1.0, 0);
    sword.add(glowEdge);
    sword.position.set(0.72, 0.7, 0.12);
    sword.rotation.z = -0.22;
    g.add(sword);

    const light = new THREE.PointLight(0x5fe8ff, 1.0, 9);
    light.position.y = 2.2;
    g.add(light);

    g.userData.anim = (t, mv) => {
      const w = Math.sin(t * 4.5);
      l1.rotation.x = w * 0.35 * mv; l2.rotation.x = -w * 0.35 * mv;
      sword.rotation.z = -0.22 + Math.sin(t * 4.5 + 1) * 0.1 * mv;
      g.position.y = Math.abs(w) * 0.04 * mv + Math.sin(t * 1.5) * 0.02;
      light.intensity = 0.9 + Math.sin(t * 3) * 0.3;
    };
    g.userData.height = 3.8;
    return g;
  };

  const ENEMY_BUILDERS = {
    murloc: Characters.buildMurloc,
    boar: Characters.buildBoar,
    ghoul: Characters.buildGhoul,
    gargoyle: Characters.buildGargoyle,
    orc: Characters.buildOrc,
    lich: Characters.buildLich,
    abyssal: Characters.buildAbyssal,
    lichking: Characters.buildLichking
  };

  Characters.buildEnemy = function (type) {
    const g = ENEMY_BUILDERS[type]();
    g.userData.type = type;
    g.userData.animOffset = Utils.rand(0, 6.28);
    return g;
  };
})();

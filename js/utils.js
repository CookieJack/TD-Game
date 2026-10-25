/* ============ 工具函数 / 路径 / 相机控制 ============ */
const Utils = {
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(this.rand(a, b + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  lerp(a, b, t) { return a + (b - a) * t; },
  // XZ 平面距离
  distXZ(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
};

/* 折线路径：敌人沿此行进，pointAt(里程) 插值出位置与朝向 */
class PathTrack {
  constructor(points) {
    this.pts = points.map(p => ({ x: p[0], z: p[1] }));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const d = Utils.distXZ(this.pts[i - 1].x, this.pts[i - 1].z, this.pts[i].x, this.pts[i].z);
      this.cum.push(this.cum[i - 1] + d);
    }
    this.length = this.cum[this.cum.length - 1];
  }
  // 返回 {x, z, dx, dz}，dx/dz 为归一化朝向
  pointAt(dist) {
    const d = Utils.clamp(dist, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const segLen = this.cum[i] - this.cum[i - 1] || 0.0001;
    const t = (d - this.cum[i - 1]) / segLen;
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 0.0001;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: dx / len, dz: dz / len };
  }
  // 某点到路径中心线的最近距离（用于摆装饰时避让）
  distTo(ax, az) {
    let best = Infinity;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const abx = b.x - a.x, abz = b.z - a.z;
      const apx = ax - a.x, apz = az - a.z;
      const segLen2 = abx * abx + abz * abz || 0.0001;
      const t = Utils.clamp((apx * abx + apz * abz) / segLen2, 0, 1);
      best = Math.min(best, Utils.distXZ(ax, az, a.x + abx * t, a.z + abz * t));
    }
    return best;
  }
}

/* 轻量轨道相机：左键拖拽旋转 / 右键平移 / 滚轮缩放 */
class CamControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0, 0);
    this.theta = -Math.PI / 2;       // 水平角（从 +x 起）
    this.phi = 0.95;                 // 俯仰角
    this.radius = 30;
    this.minPhi = 0.25; this.maxPhi = 1.32;
    this.minR = 12; this.maxR = 55;
    this.bounds = { x: 26, z: 18 };

    this.dragBtn = -1;
    this.lastX = 0; this.lastY = 0;

    dom.addEventListener('mousedown', e => {
      if (e.button === 0 || e.button === 2) {
        this.dragBtn = e.button;
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => { this.dragBtn = -1; });
    window.addEventListener('mousemove', e => {
      if (this.dragBtn === -1) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (this.dragBtn === 0) {
        this.theta -= dx * 0.005;
        this.phi = Utils.clamp(this.phi - dy * 0.004, this.minPhi, this.maxPhi);
      } else {
        // 右键平移：沿相机水平朝向移动注视点
        const s = this.radius * 0.0016;
        const fx = Math.sin(this.theta), fz = Math.cos(this.theta);
        this.target.x += (-dx * fz - dy * fx) * s;
        this.target.z += (dx * fx - dy * fz) * s;
        this.target.x = Utils.clamp(this.target.x, -this.bounds.x, this.bounds.x);
        this.target.z = Utils.clamp(this.target.z, -this.bounds.z, this.bounds.z);
      }
      this.updateCamera();
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      this.radius = Utils.clamp(this.radius + e.deltaY * 0.02, this.minR, this.maxR);
      this.updateCamera();
    }, { passive: false });
    dom.addEventListener('contextmenu', e => e.preventDefault());

    this.updateCamera();
  }
  updateCamera() {
    const sinP = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinP * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinP * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }
}

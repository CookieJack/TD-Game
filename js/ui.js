/* ============ UI：小队卡牌 / 布阵与关卡结算 / 状态栏 / 提示 ============ */
const UI = {
  game: null,
  _toastTimer: null, _bannerTimer: null,
  _selSlot: null,   // 交换站位时选中的卡

  init(game) {
    this.game = game;
    this._bind();
  },

  /* ---------- 小队卡牌（布阵 / 关卡结算共用） ---------- */
  _renderSquad(container, canBuy) {
    const g = this.game;
    container.innerHTML = '';
    g.order.forEach((type, i) => {
      const cfg = CFG.TOWERS[type];
      const tower = g.towers.find(t => t.type === type);
      const lv = tower ? tower.level : 1;
      const maxed = lv >= cfg.levels.length;
      const cur = cfg.levels[lv - 1];
      const need = CFG.XP.need[lv - 1];
      const xp = g.heroXp[type] || 0;
      const frac = maxed ? 1 : Math.min(xp / need, 1);
      // 关卡结算画面附加积分购买经验按钮（满级 / 积分不足为禁用态）
      let buyHtml = '';
      if (canBuy && !maxed) {
        const afford = g.state.points >= CFG.XP_BUY.price;
        buyHtml = `<div class="buy-btn${afford ? '' : ' disabled'}">🏅${CFG.XP_BUY.price} 买 ${CFG.XP_BUY.xp} 经验</div>`;
      } else if (canBuy) {
        buyHtml = `<div class="buy-btn disabled">已满级</div>`;
      }
      const card = document.createElement('div');
      card.className = 'squad-card';
      card.dataset.type = type;
      card.innerHTML = `
        <div class="slot-tag">站位 ${i + 1}</div>
        <div class="card-portrait" style="background:linear-gradient(180deg, ${cfg.clsColor}44, #221709)">${cfg.icon}</div>
        <div class="card-name">${cfg.name}</div>
        <div class="card-role">${cfg.role}　<span class="card-lv">${'★'.repeat(lv)}${'☆'.repeat(cfg.levels.length - lv)}</span></div>
        <div class="card-xp"><div class="card-xp-fill" style="width:${(frac * 100).toFixed(1)}%"></div></div>
        <div class="card-xp-text">${maxed ? '⬆ 已满级' : `经验 ${Math.floor(xp)} / ${need}　满级自动升级`}</div>
        <div class="card-skill">${cfg.desc}</div>
        <div class="card-stat">${cfg.statLine(cur).split('\n').join('<br>')}</div>
        ${buyHtml}
      `;
      card.addEventListener('click', () => this._onCardClick(i, card));
      const buyBtn = card.querySelector('.buy-btn');
      if (buyBtn && !buyBtn.classList.contains('disabled')) {
        buyBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();   // 不触发卡牌的交换站位
          this.game.buyXp(type);
        });
      }
      container.appendChild(card);
    });
  },

  // 点击两张卡交换站位
  _onCardClick(i, card) {
    if (this._selSlot === null) {
      this._selSlot = i;
      card.classList.add('swap-sel');
      return;
    }
    if (this._selSlot === i) { this._clearSel(); return; }
    const prev = this._selSlot;
    this._clearSel();
    this.game.swapSlots(prev, i);
    this.refreshSquad();
  },
  _clearSel() {
    this._selSlot = null;
    document.querySelectorAll('.squad-card.swap-sel').forEach(c => c.classList.remove('swap-sel'));
  },

  // 站位变化 / 升级后重画当前屏幕的小队卡
  refreshSquad() {
    this._clearSel();
    if (!document.getElementById('arrange-screen').classList.contains('hidden')) {
      this._renderSquad(document.getElementById('squad-arrange'));
    } else if (!document.getElementById('level-screen').classList.contains('hidden')) {
      this._renderSquad(document.getElementById('squad-level'), true);
      document.getElementById('level-points').textContent = this.game.state.points;
    }
  },

  /* ---------- 布阵界面 ---------- */
  showArrange() {
    this._renderSquad(document.getElementById('squad-arrange'));
    document.getElementById('arrange-screen').classList.remove('hidden');
  },
  hideArrange() { document.getElementById('arrange-screen').classList.add('hidden'); },

  /* ---------- 关卡结算界面 ---------- */
  showLevelScreen() {
    const lv = this.game.state.level;
    const level = CFG.LEVELS[lv - 1];
    const next = CFG.LEVELS[lv] ? `　·　下一关：${CFG.LEVELS[lv].name}` : '';
    document.getElementById('level-title').textContent = `${level.name} 完成！`;
    document.getElementById('level-sub').innerHTML =
      `当前积分 🏅<span id="level-points">${this.game.state.points}</span>　·　积分可为英雄购买经验，点击两张卡可交换站位${next}`;
    document.getElementById('btn-next-level').textContent =
      CFG.LEVELS[lv] ? `▶ 开启 ${CFG.LEVELS[lv].name}` : '▶ 开启下一关';
    this._renderSquad(document.getElementById('squad-level'), true);
    document.getElementById('level-screen').classList.remove('hidden');
  },
  hideLevelScreen() { document.getElementById('level-screen').classList.add('hidden'); },

  /* ---------- 事件绑定 ---------- */
  _bind() {
    const g = this.game;
    document.getElementById('btn-wave').addEventListener('click', () => g.callNextWave());
    document.getElementById('btn-speed').addEventListener('click', () => g.toggleSpeed());
    document.getElementById('btn-pause').addEventListener('click', () => g.togglePause());
    document.getElementById('btn-mute').addEventListener('click', () => g.toggleMute());
    document.getElementById('tp-close').addEventListener('click', () => g.deselectTower());
    document.getElementById('btn-start-game').addEventListener('click', () => g.startGame());
    document.getElementById('btn-next-level').addEventListener('click', () => g.nextLevel());
    document.getElementById('btn-restart').addEventListener('click', () => location.reload());

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'Escape') { g.deselectTower(); this._clearSel(); }
      else if (k === ' ') { e.preventDefault(); g.callNextWave(); }
      else if (k === 'p' || k === 'P') g.togglePause();
    });
  },

  /* ---------- 数值刷新 ---------- */
  setPoints(v) {
    document.getElementById('points-value').textContent = v;
  },
  setLives(v) {
    const el = document.getElementById('lives-value');
    el.textContent = v;
    el.style.color = v <= 5 ? '#ff5d4a' : '';
  },
  // 顶栏显示当前关卡与波次进度
  setWave(cur) {
    const lv = CFG.LEVELS[Math.min(this.game.state.level, CFG.LEVELS.length) - 1];
    const inLevel = Math.min(Math.max(cur - lv.from + 1, 0), lv.to - lv.from + 1);
    document.getElementById('wave-value').textContent = `${lv.name.split(' ')[0]} 波 ${inLevel}/${lv.to - lv.from + 1}`;
  },
  setKills(v) { document.getElementById('kills-value').textContent = v; },
  setSpeedLabel(x) { document.getElementById('btn-speed').textContent = `▶ ${x}x`; },
  setPauseLabel(paused) {
    document.getElementById('btn-pause').textContent = paused ? '▶' : '⏸';
    document.getElementById('pause-mask').classList.toggle('hidden', !paused);
  },
  setMuteLabel(muted) { document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊'; },
  setHint(text) { document.getElementById('hint-bar').textContent = text; },

  /* ---------- 波次按钮 ---------- */
  showWaveButton(text, bonus) {
    const btn = document.getElementById('btn-wave');
    const timer = document.getElementById('wave-timer');
    if (!text) { btn.classList.add('hidden'); timer.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.textContent = text;
    if (bonus !== undefined && bonus > 0) {
      timer.classList.remove('hidden');
      timer.textContent = `立即召唤可获 🏅${bonus} 奖励`;
    } else {
      timer.classList.add('hidden');
    }
  },
  setWaveTimer(seconds) {
    const timer = document.getElementById('wave-timer');
    if (!timer.classList.contains('hidden')) {
      timer.textContent = `${Math.ceil(seconds)}s 后自动来袭 · 立即召唤可获奖励`;
    }
  },

  /* ---------- 横幅 / 提示 ---------- */
  banner(text, isBoss = false) {
    const b = document.getElementById('banner');
    b.textContent = text;
    b.classList.toggle('boss', isBoss);
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.add('hidden'), 2300);
  },
  toast(text, error = false) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.toggle('error', error);
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), 1700);
  },

  /* ---------- 塔面板（查看属性 + 经验进度） ---------- */
  showTowerPanel(tower) {
    const cfg = CFG.TOWERS[tower.type];
    document.getElementById('tower-panel').classList.remove('hidden');
    document.getElementById('tp-portrait').textContent = cfg.icon;
    document.getElementById('tp-portrait').style.background =
      `linear-gradient(180deg, ${cfg.clsColor}44, #221709)`;
    document.getElementById('tp-name').textContent = cfg.name;
    document.getElementById('tp-level').textContent =
      '★'.repeat(tower.level) + '☆'.repeat(cfg.levels.length - tower.level);

    const lv = cfg.levels[tower.level - 1];
    document.getElementById('tp-stats').innerHTML =
      cfg.statLine(lv).split('\n').map(s => `<div>${s}</div>`).join('');
    document.getElementById('tp-desc').textContent = cfg.desc;
    this._fillPanelXp(tower);
  },

  _fillPanelXp(tower) {
    const g = this.game;
    const maxed = tower.level >= CFG.TOWERS[tower.type].levels.length;
    const frac = g._xpFrac(tower);
    document.getElementById('tp-xp-fill').style.width = `${(frac * 100).toFixed(1)}%`;
    document.getElementById('tp-xp-text').textContent = maxed
      ? '⬆ 已满级'
      : (frac >= 1 ? '⬆ 经验已满，即将圣光升级！' : `经验 ${Math.floor(g.heroXp[tower.type])} / ${CFG.XP.need[tower.level - 1]}`);
  },
  hideTowerPanel() { document.getElementById('tower-panel').classList.add('hidden'); },

  // 经验变化时同步可见界面（塔面板 / 结算卡牌）
  updateXp(type) {
    const g = this.game;
    if (g.selectedTower && g.selectedTower.type === type &&
        !document.getElementById('tower-panel').classList.contains('hidden')) {
      this._fillPanelXp(g.selectedTower);
    }
    if (!document.getElementById('level-screen').classList.contains('hidden')) this.refreshSquad();
  },

  /* ---------- 结算 ---------- */
  showEnd(win, stats) {
    const screen = document.getElementById('end-screen');
    const title = document.getElementById('end-title');
    title.textContent = win ? '胜 利' : '失 败';
    title.classList.toggle('lose', !win);
    document.getElementById('end-sub').textContent = win
      ? '巫妖王已被击败，艾泽拉斯恢复和平！'
      : '暴风城陷落了……集结英雄，再次防守！';
    document.getElementById('end-stats').innerHTML = `
      <div>坚守波次 <b>${stats.wave} / ${CFG.TOTAL_WAVES}</b></div>
      <div>消灭敌人 <b>${stats.kills}</b></div>
      <div>剩余积分 <b>🏅${stats.points}</b></div>`;
    screen.classList.remove('hidden');
  }
};

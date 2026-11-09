/* Joule hero — grid-in-motion scene.
   Power plants (left) → market node with live day-ahead price curve (center) → AI datacenters (right).
   Energy pulses ride right-angle pipe runs (arc-length parameterised — constant speed through elbows);
   flow density and datacenter load follow the price:
   cheap hours surge, peak hours thin out. One loop = one compressed day (DURATION seconds).
   Zero dependencies, seeded PRNG, deterministic loop: render(t) is a pure function of t. */
(function () {
  'use strict';

  var DURATION = 24; /* seconds per loop — the verifier greps this constant */

  var canvas = document.getElementById('hero-fx');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  /* ---------- seeded PRNG (mulberry32) — bare Math.random is banned ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20261109);

  /* ---------- palette ---------- */
  var BG = '#0A0A0B';
  var INK = '244,244,242';
  var LIME = '201,254,110';
  var CYAN = '140,220,255';
  var AMBER = '255,196,96';

  /* ---------- geometry: two layouts, picked by aspect at resize ---------- */
  var PLANTS, MARKET, DCS, PIPES_IN, PIPES_OUT, FAR_PIPES, PULSES_IN, PULSES_OUT, PULSES_REV, SCALE;

  function buildLayout() {
    var portrait = window.matchMedia && window.matchMedia('(max-width:900px)').matches; /* same switch as the CSS panel */
    if (portrait) {
      PLANTS = [
        { x: 0.100, y: 0.220, type: 'wind',    label: 'WIND' },
        { x: 0.090, y: 0.500, type: 'nuclear', label: 'BASE' },
        { x: 0.115, y: 0.780, type: 'solar',   label: 'SOLAR' }
      ];
      MARKET = { x: 0.500, y: 0.500, w: 0.340, h: 0.440, label: 'DAY-AHEAD' };
      DCS = [
        { x: 0.885, y: 0.200, load: 0.9,  label: 'DC · DUB' },
        { x: 0.900, y: 0.500, load: 1.0,  label: 'DC · FRA' },
        { x: 0.880, y: 0.790, load: 0.75, label: 'DC · PAR' }
      ];
      SCALE = 1.5;
    } else {
      /* desktop: right half of the hero, full vertical spread */
      PLANTS = [
        { x: 0.560, y: 0.130, type: 'wind',    label: 'WIND' },
        { x: 0.545, y: 0.430, type: 'nuclear', label: 'BASE' },
        { x: 0.570, y: 0.720, type: 'solar',   label: 'SOLAR' }
      ];
      MARKET = { x: 0.755, y: 0.430, w: 0.130, h: 0.300, label: 'DAY-AHEAD' };
      DCS = [
        { x: 0.935, y: 0.140, load: 0.9,  label: 'DC · DUB' },
        { x: 0.950, y: 0.450, load: 1.0,  label: 'DC · FRA' },
        { x: 0.930, y: 0.740, load: 0.75, label: 'DC · PAR' }
      ];
      SCALE = 1.35;
    }
    /* pipe runs: 90° elbow routing into terminal ports on the console edges;
       jx/kx = jog columns per pipe (0 = straight shot, no jog) */
    var portY = [MARKET.y - 0.09, MARKET.y, MARKET.y + 0.09];
    var mL = MARKET.x - MARKET.w / 2, mR = MARKET.x + MARKET.w / 2;
    var jx = portrait ? [0.240, 0, 0.256] : [0.648, 0, 0.664];
    var kx = portrait ? [0.770, 0, 0.786] : [0.882, 0, 0.866];
    PIPES_IN = PLANTS.map(function (p, i) {
      return { plant: p, pts: route(p, { x: mL, y: portY[i] }, jx[i]) };
    });
    PIPES_OUT = DCS.map(function (d, i) {
      return { pts: route({ x: mR, y: portY[i] }, d, kx[i]) };
    });
    PIPES_IN.concat(PIPES_OUT).forEach(cachePipe);
    /* far "shadow" layer geometry: same network scaled around the market, offset */
    var fcx = MARKET.x, fcy = MARKET.y, fsc = 0.52;
    FAR_PIPES = PIPES_IN.concat(PIPES_OUT).map(function (pipe) {
      var fp = { pts: pipe.pts.map(function (f) { return { x: fcx + (f.x - fcx) * fsc + 0.050, y: fcy + (f.y - fcy) * fsc - 0.050 }; }) };
      cachePipe(fp);
      return fp;
    });
    PULSES_IN = []; PULSES_OUT = []; PULSES_REV = [];
    PIPES_IN.forEach(function (pipe, i) {
      for (var k = 0; k < 4; k++) PULSES_IN.push({ pipe: pipe, phase: (k / 4 + i * 0.13) % 1, laps: 2 + i });
    });
    PIPES_OUT.forEach(function (pipe, i) {
      var fp = FAR_PIPES[PIPES_IN.length + i];
      for (var k = 0; k < 5; k++) PULSES_OUT.push({ pipe: pipe, fp: fp, phase: (k / 5 + i * 0.07) % 1, laps: 3 + i });
      /* reverse flow: datacenters sell back into the market when the price is high */
      for (var k2 = 0; k2 < 3; k2++) PULSES_REV.push({ pipe: pipe, phase: (k2 / 3 + i * 0.19) % 1, laps: 2 + i });
    });
    /* per-window seeded jitter — fresh PRNG per layout so resize stays deterministic */
    var r2 = mulberry32(20261109 + (portrait ? 7 : 0));
    DCS.forEach(function (dc) {
      dc.win = [];
      for (var r = 0; r < 4; r++) for (var c = 0; c < 7; c++) {
        dc.win.push({ r: r, c: c, jit: 0.55 + r2() * 0.45, fq: 1 + Math.floor(r2() * 2), ph: r2() * Math.PI * 2, on: r2() < 0.72 });
      }
    });
  }

  /* ambient particle field (RunPod-style, but restrained + periodic drift) */
  var MOTES = [];
  for (var m = 0; m < 80; m++) {
    var r = rand();
    MOTES.push({
      x: rand(), y: rand(),
      size: 0.6 + rand() * 1.6,
      ax: 0.004 + rand() * 0.012,          /* gentle oscillation amplitude (fraction of W) */
      ay: 0.006 + rand() * 0.018,          /* fraction of H — oscillation is seam-free by construction */
      fq: 1 + Math.floor(rand() * 2),      /* integer frequency => perfect loop */
      tw: 1 + Math.floor(rand() * 3),      /* integer twinkle frequency */
      ph: rand() * Math.PI * 2,
      ph2: rand() * Math.PI * 2,
      col: r < 0.62 ? INK : (r < 0.86 ? LIME : CYAN),
      base: 0.05 + rand() * 0.16
    });
  }

  /* ---------- day-ahead price curve: periodic, u in [0,1) ---------- */
  function price(u) {
    var dip = Math.exp(-Math.pow((u - 0.55) / 0.075, 2));   /* midday solar collapse */
    var peak = Math.exp(-Math.pow((u - 0.80) / 0.050, 2));  /* evening peak */
    var morn = Math.exp(-Math.pow((u - 0.33) / 0.060, 2));  /* morning ramp */
    var p = 0.46 + 0.20 * morn + 0.52 * peak - 0.34 * dip
          + 0.05 * Math.sin(2 * Math.PI * 3 * u) + 0.03 * Math.sin(2 * Math.PI * 7 * u);
    return Math.max(0.04, Math.min(1, p));
  }
  /* dispatch signal: inverse of price, shaped — how hard Joule pushes load */
  function dispatch(u) {
    var d = 1.18 - 1.25 * price(u);
    return Math.max(0.06, Math.min(1, d));
  }

  /* ---------- glow sprite ---------- */
  function makeSprite(rgb) {
    var s = document.createElement('canvas'); s.width = s.height = 64;
    var g = s.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.25, 'rgba(' + rgb + ',0.85)');
    grad.addColorStop(0.6, 'rgba(' + rgb + ',0.22)');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return s;
  }
  var SPRITE_LIME = makeSprite(LIME);
  var SPRITE_CYAN = makeSprite(CYAN);
  var SPRITE_AMBER = makeSprite(AMBER);

  /* ---------- sizing ---------- */
  var W = 0, H = 0, DPR = 1, IS_PORTRAIT = false, FS = 9;
  function resize() {
    var rect = canvas.getBoundingClientRect(); /* the canvas's own CSS box, not the hero's */
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, rect.width); H = Math.max(1, rect.height);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    buildLayout();
    IS_PORTRAIT = window.matchMedia && window.matchMedia('(max-width:900px)').matches;
    FS = IS_PORTRAIT ? 11 : 9;
  }

  /* pipe helpers — axis-aligned waypoint runs */
  function route(a, b, jogX) { /* a → horizontal → jog column → vertical → b; 90° elbows only */
    if (!jogX) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    return [{ x: a.x, y: a.y }, { x: jogX, y: a.y }, { x: jogX, y: b.y }, { x: b.x, y: b.y }];
  }
  function cachePipe(pipe) { /* pixel waypoints + arc-length table (rebuilt on resize) */
    var px = pipe.pts.map(function (f) { return { x: f.x * W, y: f.y * H }; });
    var cum = [0];
    for (var i = 1; i < px.length; i++) cum.push(cum[i - 1] + Math.abs(px[i].x - px[i - 1].x) + Math.abs(px[i].y - px[i - 1].y));
    pipe.px = px; pipe.cum = cum; pipe.len = cum[cum.length - 1] || 1;
    pipe.bends = []; /* interior elbows + their arc-positions — junction boxes & flash */
    for (var j = 1; j < px.length - 1; j++) pipe.bends.push({ x: px[j].x, y: px[j].y, s: cum[j] / pipe.len });
  }
  function ppoint(pipe, s) { /* position at arc-fraction s: constant speed through elbows */
    var d = Math.max(0, Math.min(1, s)) * pipe.len, i = 1;
    while (i < pipe.cum.length - 1 && pipe.cum[i] < d) i++;
    var f = (d - pipe.cum[i - 1]) / ((pipe.cum[i] - pipe.cum[i - 1]) || 1);
    return { x: pipe.px[i - 1].x + (pipe.px[i].x - pipe.px[i - 1].x) * f,
             y: pipe.px[i - 1].y + (pipe.px[i].y - pipe.px[i - 1].y) * f };
  }
  function strokePipe(pts, width, style) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineJoin = 'round'; ctx.lineWidth = width; ctx.strokeStyle = style; ctx.stroke();
  }

  /* ---------- scene render: pure function of t ---------- */
  var parX = 0, parY = 0; /* mouse parallax (not part of deterministic loop) */
  function render(t) {
    var u = ((t / DURATION) % 1 + 1) % 1;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(parX, parY);

    /* vignette glow behind market */
    var vg = ctx.createRadialGradient(MARKET.x * W, MARKET.y * H, 0, MARKET.x * W, MARKET.y * H, W * 0.24);
    vg.addColorStop(0, 'rgba(' + LIME + ',0.05)');
    vg.addColorStop(1, 'rgba(' + LIME + ',0)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    /* ambient motes */
    for (var i = 0; i < MOTES.length; i++) {
      var mo = MOTES[i];
      var my = mo.y + mo.ay * Math.sin(mo.fq * 2 * Math.PI * u + mo.ph2);
      var mx = mo.x + mo.ax * Math.sin(mo.fq * 2 * Math.PI * u + mo.ph);
      var tw = 0.5 + 0.5 * Math.sin(mo.tw * 2 * Math.PI * u + mo.ph);
      ctx.fillStyle = 'rgba(' + mo.col + ',' + (mo.base * (0.4 + 0.6 * tw)).toFixed(3) + ')';
      ctx.fillRect(mx * W, my * H, mo.size, mo.size);
    }

    /* far "shadow grid" layer for depth: same network, scaled around the market, offset, faint */
  function drawFarLayer(u) {
    function T(f) { return { x: MARKET.x + (f.x - MARKET.x) * 0.52 + 0.050, y: MARKET.y + (f.y - MARKET.y) * 0.52 - 0.050 }; }
    ctx.save();
    ctx.translate(-parX * 0.5, -parY * 0.5); /* half the parallax of the near layer */
    ctx.globalAlpha = 0.26;
    FAR_PIPES.forEach(function (fp) { strokePipe(fp.px, 1, 'rgba(' + INK + ',0.10)'); });
    PLANTS.forEach(function (p) {
      var f = T(p);
      ctx.fillStyle = 'rgba(' + CYAN + ',0.5)';
      ctx.fillRect(f.x * W - 1, f.y * H - 1, 2, 2);
    });
    DCS.forEach(function (d) {
      var f = T(d);
      ctx.strokeStyle = 'rgba(' + INK + ',0.4)';
      ctx.strokeRect(f.x * W - 3, f.y * H - 2, 6, 4);
    });
    ctx.globalCompositeOperation = 'lighter';
    PULSES_OUT.forEach(function (p) {
      var s = (p.phase + p.laps * u) % 1;
      drawPulse(ppoint(p.fp, s), SPRITE_LIME, 3, 0.30);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  drawFarLayer(u);

  /* pipe runs: faint wide underlay + bright hairline core, round joins at the elbows */
    PIPES_IN.concat(PIPES_OUT).forEach(function (pipe) {
      strokePipe(pipe.px, 2.5, 'rgba(' + INK + ',0.05)');
      strokePipe(pipe.px, 1, 'rgba(' + INK + ',0.16)');
    });
    ctx.lineWidth = 1;

    /* terminal ports on the console edges, end nodes at plants/DCs, junction boxes at elbows */
    PIPES_IN.forEach(function (pipe) {
      drawPort(pipe.px[pipe.px.length - 1], CYAN);
      drawNode(pipe.px[0]);
    });
    PIPES_OUT.forEach(function (pipe) {
      drawPort(pipe.px[0], LIME);
      drawNode(pipe.px[pipe.px.length - 1]);
    });
    PIPES_IN.concat(PIPES_OUT).forEach(function (pipe) {
      ctx.strokeStyle = 'rgba(' + INK + ',0.30)';
      pipe.bends.forEach(function (b) { ctx.strokeRect(b.x - 2.5, b.y - 2.5, 5, 5); });
    });

    /* energy pulses (ghost trails; elbow flashes collected for the junction boxes) */
    var dNow = dispatch(u);
    var flashes = [];
    ctx.globalCompositeOperation = 'lighter';
    PULSES_IN.forEach(function (p) {
      var s = (p.phase + p.laps * u) % 1;
      /* generation side always produces; solar follows the day */
      var gen = 1;
      if (p.pipe.plant.type === 'solar') gen = 0.15 + 0.85 * Math.max(0, Math.sin(Math.PI * ((u + 0.27) % 1)));
      drawPulseTrail(p.pipe, s, SPRITE_CYAN, 9 * (0.35 + 0.65 * gen), 0.55 * gen + 0.07, 1);
      flashes.push({ pipe: p.pipe, s: s, k: gen, sprite: SPRITE_CYAN });
    });
    PULSES_OUT.forEach(function (p) {
      var s = (p.phase + p.laps * u) % 1;
      var glow = 0.22 + 0.78 * dNow;
      drawPulseTrail(p.pipe, s, SPRITE_LIME, 10 * glow, 0.68 * glow, 1);
      flashes.push({ pipe: p.pipe, s: s, k: glow, sprite: SPRITE_LIME });
    });
    /* reverse pulses: export to grid when price is high (smoothstep gate) */
    var ex = price(u);
    ex = Math.max(0, Math.min(1, (ex - 0.52) / 0.23));
    ex = ex * ex * (3 - 2 * ex);
    if (ex > 0.01) {
      PULSES_REV.forEach(function (p) {
        var s = 1 - ((p.phase + p.laps * u) % 1); /* right-to-left */
        drawPulseTrail(p.pipe, s, SPRITE_AMBER, 7 * ex, 0.55 * ex, -1);
        flashes.push({ pipe: p.pipe, s: s, k: ex, sprite: SPRITE_AMBER });
      });
    }
    /* junction boxes light up as pulses pass the elbows */
    flashes.forEach(function (fl) {
      for (var bi = 0; bi < fl.pipe.bends.length; bi++) {
        var bd = fl.pipe.bends[bi];
        var dd = (fl.s - bd.s) / 0.016;
        var g = Math.exp(-dd * dd) * fl.k;
        if (g > 0.04) drawGlow(bd.x, bd.y, fl.sprite, 3 + 5 * g, 0.55 * g);
      }
    });
    ctx.globalCompositeOperation = 'source-over';

    /* plants */
    PLANTS.forEach(function (p) { drawPlant(p, u); });

    /* market node */
    drawMarket(u, dNow);

    /* datacenters */
    DCS.forEach(function (dc) { drawDC(dc, u, dNow); });

    ctx.restore();

    /* bottom fade so the scene melts into the text zone (desktop only — mobile panel stands alone) */
    if (!IS_PORTRAIT) {
      var fg = ctx.createLinearGradient(0, H * 0.80, 0, H);
      fg.addColorStop(0, 'rgba(10,10,11,0)');
      fg.addColorStop(1, 'rgba(10,10,11,0.85)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, H * 0.80, W, H * 0.20);
    }
  }

  function drawPulse(pt, sprite, size, alpha) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sprite, pt.x - size, pt.y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
  }

  function drawPort(pt, col) { /* console-edge terminal: filled socket + rim */
    ctx.fillStyle = 'rgba(' + col + ',0.20)';
    ctx.fillRect(pt.x - 3, pt.y - 3, 6, 6);
    ctx.strokeStyle = 'rgba(' + col + ',0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pt.x - 3.5, pt.y - 3.5, 7, 7);
  }

  function drawNode(pt) { /* plant/DC pipe end: plain node square */
    ctx.strokeStyle = 'rgba(' + INK + ',0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pt.x - 2, pt.y - 2, 4, 4);
  }

  /* pulse with a two-ghost trail — direction-aware (REV pulses travel backwards) */
  function drawPulseTrail(pipe, s, sprite, size, alpha, dir) {
    drawPulse(ppoint(pipe, s), sprite, size, alpha);
    var s1 = s - dir * 0.012, s2 = s - dir * 0.024;
    if (s1 >= 0 && s1 <= 1) drawPulse(ppoint(pipe, s1), sprite, size * 0.62, alpha * 0.40);
    if (s2 >= 0 && s2 <= 1) drawPulse(ppoint(pipe, s2), sprite, size * 0.36, alpha * 0.18);
  }

  function drawPlant(p, u) {
    var x = p.x * W, y = p.y * H;
    var R = Math.min(W, H) * 0.017 * SCALE;
    ctx.strokeStyle = 'rgba(' + INK + ',0.35)';
    ctx.lineWidth = 1;

    if (p.type === 'wind') {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + R * 2.6); ctx.stroke();
      var ang = 2 * Math.PI * 6 * u; /* integer laps => seamless loop */
      ctx.strokeStyle = 'rgba(' + CYAN + ',0.75)';
      for (var b = 0; b < 3; b++) {
        var a = ang + b * 2 * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * R * 1.5, y + Math.sin(a) * R * 1.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(' + CYAN + ',0.9)';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3); /* nacelle */
      drawGlow(x, y, SPRITE_CYAN, R * 0.9, 0.5);
    } else if (p.type === 'nuclear') {
      var breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * u);
      /* cooling tower: flared rim with inner lip, hyperbolic waist, plinth base, shading seam */
      var tw = R * 1.15, th = R * 2.1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(' + LIME + ',0.7)';
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.88, y - th); ctx.lineTo(x + tw * 0.88, y - th);   /* flared rim */
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + LIME + ',0.28)';
      ctx.beginPath();                                                        /* inner lip — sells the opening */
      ctx.moveTo(x - tw * 0.62, y - th + 2); ctx.quadraticCurveTo(x, y - th + 5, x + tw * 0.62, y - th + 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + LIME + ',0.7)';
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.88, y - th);
      ctx.quadraticCurveTo(x - tw * 0.50, y - th * 0.05, x - tw, y + th * 0.9);
      ctx.moveTo(x + tw * 0.88, y - th);
      ctx.quadraticCurveTo(x + tw * 0.50, y - th * 0.05, x + tw, y + th * 0.9);
      ctx.stroke();
      /* light-side shading seam */
      ctx.strokeStyle = 'rgba(' + LIME + ',0.18)';
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.55, y - th * 0.75);
      ctx.quadraticCurveTo(x - tw * 0.30, y, x - tw * 0.62, y + th * 0.85);
      ctx.stroke();
      /* plinth + ground shadow */
      ctx.strokeStyle = 'rgba(' + INK + ',0.4)';
      ctx.beginPath(); ctx.moveTo(x - tw * 1.12, y + th); ctx.lineTo(x + tw * 1.12, y + th); ctx.stroke();
      /* containment dome at base right */
      ctx.strokeStyle = 'rgba(' + LIME + ',0.45)';
      ctx.beginPath(); ctx.arc(x + tw * 1.7, y + th, R * 0.5, Math.PI, 0); ctx.stroke();
      drawGlow(x, y - th * 0.35, SPRITE_LIME, R * (0.55 + 0.2 * breath), 0.35 + 0.25 * breath);
      /* steam plume: three elliptical puffs, staggered, integer loop */
      var pu = (2 * u) % 1;
      ctx.fillStyle = 'rgba(' + INK + ',' + (0.12 + 0.08 * breath) + ')';
      ctx.beginPath(); ctx.ellipse(x - R * 0.3, y - th - R * (0.4 + pu * 1.2), R * 0.30, R * 0.20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(' + INK + ',' + (0.08 + 0.05 * breath) + ')';
      ctx.beginPath(); ctx.ellipse(x + R * 0.15, y - th - R * (0.9 + pu * 1.2), R * 0.24, R * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(' + INK + ',' + (0.05 + 0.03 * breath) + ')';
      ctx.beginPath(); ctx.ellipse(x + R * 0.5, y - th - R * (1.35 + pu * 1.2), R * 0.18, R * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      /* solar panel: framed glass with cell matrix, glint following the sun, twin-leg stand */
      var shine = 0.15 + 0.85 * Math.max(0, Math.sin(Math.PI * ((u + 0.27) % 1)));
      ctx.save();
      ctx.translate(x, y); ctx.rotate(-0.16);
      var pw = R * 2.2, ph = R * 1.45;
      /* frame */
      ctx.strokeStyle = 'rgba(' + AMBER + ',' + (0.4 + 0.4 * shine) + ')';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
      /* glass inset */
      ctx.strokeStyle = 'rgba(' + INK + ',0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-pw / 2 + 2, -ph / 2 + 2, pw - 4, ph - 4);
      /* 3×2 cell matrix with faint fill; one glint cell tracks the sun */
      var cw3 = (pw - 4) / 3, ch2 = (ph - 4) / 2;
      var gi = Math.floor(shine * 5.99); /* 0..5, day-driven */
      for (var cc = 0; cc < 3; cc++) for (var rr = 0; rr < 2; rr++) {
        var on = (cc + rr * 3) === gi;
        ctx.fillStyle = 'rgba(' + AMBER + ',' + (on ? 0.22 * shine : 0.05 * shine) + ')';
        ctx.fillRect(-pw / 2 + 2 + cc * cw3 + 0.5, -ph / 2 + 2 + rr * ch2 + 0.5, cw3 - 1, ch2 - 1);
      }
      /* top-edge sun catch */
      ctx.strokeStyle = 'rgba(' + AMBER + ',' + (0.5 * shine) + ')';
      ctx.beginPath(); ctx.moveTo(-pw / 2, -ph / 2); ctx.lineTo(pw / 2, -ph / 2); ctx.stroke();
      ctx.restore();
      /* twin-leg stand + ground line (unrotated) */
      ctx.strokeStyle = 'rgba(' + INK + ',0.35)';
      ctx.beginPath();
      ctx.moveTo(x - pw * 0.18, y + ph * 0.35); ctx.lineTo(x - pw * 0.26, y + ph * 0.35 + R * 1.0);
      ctx.moveTo(x + pw * 0.18, y + ph * 0.35); ctx.lineTo(x + pw * 0.26, y + ph * 0.35 + R * 1.0);
      ctx.moveTo(x - pw * 0.42, y + ph * 0.35 + R * 1.0); ctx.lineTo(x + pw * 0.42, y + ph * 0.35 + R * 1.0);
      ctx.stroke();
      drawGlow(x, y, SPRITE_LIME, R * 0.5 * shine + R * 0.1, 0.45 * shine);
      drawLabel(p.label, x, y + R * 3.2);
      return;
    }
    drawLabel(p.label, x, y + R * 3.4);
  }

  function drawGlow(x, y, sprite, size, alpha) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawLabel(txt, x, y) {
    ctx.font = '500 ' + FS + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(' + INK + ',0.48)';
    ctx.fillText(txt, x, y);
  }

  function drawMarket(u, dNow) {
    var x = MARKET.x * W, y = MARKET.y * H;
    var w = MARKET.w * W, h = MARKET.h * H;
    var lx = x - w / 2, ty = y - h / 2;
    var px = price(u);
    var hour = Math.floor(u * 24);
    var hh = (hour < 10 ? '0' : '') + hour + ':00';
    var eur = Math.round(12 + px * 210);

    /* panel glow behind the card */
    drawGlow(x, y, SPRITE_LIME, w * 0.9, 0.10);

    /* panel body: mostly solid — an instrument, not a doodle */
    ctx.fillStyle = 'rgba(13,14,13,0.86)';
    ctx.fillRect(lx, ty, w, h);
    ctx.strokeStyle = 'rgba(' + LIME + ',0.24)';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 0.5, ty + 0.5, w - 1, h - 1);
    ctx.strokeStyle = 'rgba(' + INK + ',0.06)';
    ctx.strokeRect(lx + 3.5, ty + 3.5, w - 7, h - 7);

    /* corner brackets */
    var k = Math.min(w, h) * 0.10;
    ctx.strokeStyle = 'rgba(' + LIME + ',0.85)';
    [[lx, ty, 1, 1], [lx + w, ty, -1, 1], [lx, ty + h, 1, -1], [lx + w, ty + h, -1, -1]].forEach(function (c) {
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * k, c[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c[0], c[1] + c[3] * k);
      ctx.stroke();
    });

    var hdr = h * 0.17;             /* header strip */
    var ftr = h * 0.21;             /* axis labels + dispatch meter */
    var pad = w * 0.08;
    var gx0 = lx + pad, gy = ty + hdr + pad * 0.35;
    var gw = w - pad * 2, gh = h - hdr - ftr - pad * 0.5;

    /* scanline sweep, clipped to panel — one pass per loop (seam-free) */
    ctx.save();
    ctx.beginPath(); ctx.rect(lx, ty, w, h); ctx.clip();
    var sy = ty + (u % 1) * h;
    var sg = ctx.createLinearGradient(0, sy - 9, 0, sy + 9);
    sg.addColorStop(0, 'rgba(' + LIME + ',0)');
    sg.addColorStop(0.5, 'rgba(' + LIME + ',0.045)');
    sg.addColorStop(1, 'rgba(' + LIME + ',0)');
    ctx.fillStyle = sg;
    ctx.fillRect(lx, sy - 9, w, 18);
    ctx.restore();

    /* header: live dot + label + hour, value big on line 2 */
    ctx.strokeStyle = 'rgba(' + INK + ',0.09)';
    ctx.beginPath(); ctx.moveTo(lx, ty + hdr); ctx.lineTo(lx + w, ty + hdr); ctx.stroke();
    var blink = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2 * u);
    ctx.fillStyle = 'rgba(' + LIME + ',' + (0.35 + 0.55 * blink).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(lx + pad * 0.85, ty + hdr * 0.34, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.font = '500 ' + FS + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(' + INK + ',0.45)';
    ctx.fillText(MARKET.label, lx + pad * 0.85 + 7, ty + hdr * 0.34 + 3);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(' + INK + ',0.5)';
    ctx.fillText(hh, lx + w - pad * 0.85, ty + hdr * 0.34 + 3);
    ctx.textAlign = 'left';
    ctx.font = '600 ' + (FS + 3) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(' + LIME + ',0.95)';
    ctx.fillText('€' + eur + '/MWh', lx + pad * 0.85, ty + hdr * 0.86);

    /* chart grid: € levels + hour ticks */
    ctx.font = '500 ' + (FS - 1) + 'px "IBM Plex Mono", monospace';
    [50, 100, 150, 200].forEach(function (v) {
      var yy = gy + (1 - (v - 12) / 210) * gh;
      ctx.strokeStyle = 'rgba(' + INK + ',0.05)';
      ctx.beginPath(); ctx.moveTo(gx0, yy); ctx.lineTo(gx0 + gw, yy); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(' + INK + ',0.20)';
      ctx.fillText(String(v), gx0 + 2, yy - 2);
    });
    /* bottom axis */
    ctx.strokeStyle = 'rgba(' + INK + ',0.12)';
    ctx.beginPath(); ctx.moveTo(gx0, gy + gh); ctx.lineTo(gx0 + gw, gy + gh); ctx.stroke();
    ctx.textAlign = 'center';
    [0, 6, 12, 18, 24].forEach(function (hr) {
      var xx = gx0 + (hr / 24) * gw;
      ctx.beginPath(); ctx.moveTo(xx, gy + gh); ctx.lineTo(xx, gy + gh + 3); ctx.stroke();
      ctx.fillStyle = 'rgba(' + INK + ',0.22)';
      ctx.fillText((hr < 10 ? '0' : '') + hr, xx, gy + gh + FS + 2);
    });

    /* area fill under the price curve */
    ctx.beginPath();
    for (var s = 0; s <= 60; s++) {
      var uu = s / 60;
      var cpx = gx0 + uu * gw;
      var cpy = gy + (1 - price(uu)) * gh;
      if (s === 0) ctx.moveTo(cpx, cpy); else ctx.lineTo(cpx, cpy);
    }
    ctx.lineTo(gx0 + gw, gy + gh); ctx.lineTo(gx0, gy + gh); ctx.closePath();
    var ag = ctx.createLinearGradient(0, gy, 0, gy + gh);
    ag.addColorStop(0, 'rgba(' + LIME + ',0.15)');
    ag.addColorStop(1, 'rgba(' + LIME + ',0)');
    ctx.fillStyle = ag;
    ctx.fill();
    /* curve */
    ctx.beginPath();
    for (var s2 = 0; s2 <= 60; s2++) {
      var uu2 = s2 / 60;
      var qx = gx0 + uu2 * gw;
      var qy = gy + (1 - price(uu2)) * gh;
      if (s2 === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.strokeStyle = 'rgba(' + LIME + ',0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* "now" crosshair + axis marker */
    var cx = gx0 + u * gw;
    var cy = gy + (1 - px) * gh;
    ctx.strokeStyle = 'rgba(' + INK + ',0.26)';
    ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx, gy + gh); ctx.stroke();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(' + INK + ',0.18)';
    ctx.beginPath(); ctx.moveTo(gx0, cy); ctx.lineTo(gx0 + gw, cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(' + LIME + ',0.85)';
    ctx.beginPath();
    ctx.moveTo(cx, gy + gh + 1); ctx.lineTo(cx - 3, gy + gh + 6); ctx.lineTo(cx + 3, gy + gh + 6);
    ctx.closePath(); ctx.fill();
    drawGlow(cx, cy, SPRITE_LIME, 8, 0.95);

    /* dispatch meter: segmented bar + % + flow direction */
    var my = ty + h - ftr * 0.42;
    ctx.font = '500 ' + (FS - 1) + 'px "IBM Plex Mono", monospace';
    var exporting = px > 0.62;
    var labW = IS_PORTRAIT ? 0 : w * 0.30;
    if (!IS_PORTRAIT) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(' + INK + ',0.40)';
      ctx.fillText('DISPATCH', lx + pad * 0.85, my + 3);
    }
    var resR = 36; /* reserved right zone for the % / EXPORT readout */
    var segX = lx + pad * 0.85 + labW;
    var nSeg = 14, segW = (lx + w - pad * 0.85 - resR - segX) / nSeg;
    var lit = Math.round(dNow * nSeg);
    for (var sg2 = 0; sg2 < nSeg; sg2++) {
      ctx.fillStyle = sg2 < lit
        ? 'rgba(' + LIME + ',0.85)'
        : 'rgba(' + INK + ',0.10)';
      ctx.fillRect(segX + sg2 * segW, my - 3, segW - 1.5, 5);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = exporting ? 'rgba(' + AMBER + ',0.9)' : 'rgba(' + LIME + ',0.8)';
    ctx.fillText(exporting ? 'EXPORT' : Math.round(dNow * 100) + '%', lx + w - pad * 0.85, my + 3);
  }

  function drawDC(dc, u, dNow) {
    var x = dc.x * W, y = dc.y * H;
    var bw = Math.min(W, H) * 0.052 * SCALE, bh = bw * 0.78;
    var load = Math.max(0.08, Math.min(1, dNow * dc.load + 0.06));
    var bx = x - bw / 2, by = y - bh / 2;

    /* soft backglow scaled by load */
    drawGlow(x, y, SPRITE_LIME, bw * (0.55 + 0.5 * load), 0.10 + 0.10 * load);

    /* building body: solid fill + outline (reads as a structure, not a wireframe) */
    ctx.fillStyle = 'rgba(13,14,13,0.78)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(' + INK + ',0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    /* parapet roof line + two roof vents */
    ctx.strokeStyle = 'rgba(' + INK + ',0.22)';
    ctx.beginPath(); ctx.moveTo(bx + 2, by + bh * 0.14); ctx.lineTo(bx + bw - 2, by + bh * 0.14); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + INK + ',0.35)';
    ctx.strokeRect(bx + bw * 0.16, by - bh * 0.07, bw * 0.14, bh * 0.07);
    ctx.strokeRect(bx + bw * 0.62, by - bh * 0.07, bw * 0.14, bh * 0.07);
    /* ground shadow */
    ctx.strokeStyle = 'rgba(' + INK + ',0.18)';
    ctx.beginPath(); ctx.moveTo(bx - bw * 0.10, by + bh); ctx.lineTo(bx + bw * 1.10, by + bh); ctx.stroke();
    /* door */
    ctx.strokeRect(x - bw * 0.06, by + bh - bh * 0.16, bw * 0.12, bh * 0.16);

    /* facade LED matrix inside an inset panel — brightness follows dispatch */
    var cols = 7, rows = 4;
    var fx = bx + bw * 0.13, fy = by + bh * 0.24;
    var fw = bw * 0.74, fh = bh * 0.56;
    ctx.strokeStyle = 'rgba(' + INK + ',0.14)';
    ctx.strokeRect(fx, fy, fw, fh);
    var gx = fw / cols, gy2 = fh / rows;
    for (var i = 0; i < dc.win.length; i++) {
      var wn = dc.win[i];
      if (!wn.on) continue;
      var fl = 0.8 + 0.2 * Math.sin(wn.fq * 2 * Math.PI * u + wn.ph);
      var a = load * wn.jit * fl;
      ctx.fillStyle = 'rgba(' + LIME + ',' + (a * 0.95).toFixed(3) + ')';
      ctx.fillRect(fx + wn.c * gx + gx / 2 - 1.2, fy + wn.r * gy2 + gy2 / 2 - 1.2, 2.4, 2.4);
    }
    /* status glow on roof edge */
    drawGlow(x, by, SPRITE_LIME, bw * 0.35 * load + 2, 0.35 * load);
    drawLabel(dc.label, x, by + bh + 12);
  }

  /* ---------- loop / hooks ---------- */
  var raf = null, t0 = -1, running = false, visible = true, seekT = null;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now) {
    if (t0 < 0) t0 = now;
    render((now - t0) / 1000);
    if (running) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduced || !visible || document.hidden || seekT != null) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  window.addEventListener('resize', function () { resize(); if (reduced || !running) render(seekT != null ? seekT : 14.4); });
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      visible = en[0].isIntersecting;
      visible ? start() : stop();
    }, { threshold: 0.02 }).observe(canvas);
  }
  window.addEventListener('mousemove', function (e) {
    parX = (e.clientX / window.innerWidth - 0.5) * -14;
    parY = (e.clientY / window.innerHeight - 0.5) * -8;
  }, { passive: true });

  resize();

  /* deterministic hooks for verification: jump anywhere in the loop; ?t=N freezes that frame on load */
  window.__seek = function (t) { seekT = t; stop(); resize(); render(t); };
  window.__SCENE_READY__ = true;

  var qs = /[?&]t=([0-9.]+)/.exec(location.search || '');
  if (qs) { window.__seek(parseFloat(qs[1])); }
  else if (reduced) { render(14.4); } else { start(); }
})();

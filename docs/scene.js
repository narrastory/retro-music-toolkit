"use strict";
// Living pixel cave behind the page: a top-down underground scene in the
// spirit of mining-sandbox games. Drawn procedurally at low resolution and
// scaled up with nearest-neighbour sampling, so every light band and spore
// is a real pixel. The cave takes on the biome of the playing track, and the
// Core pulses on that track's beat.
(() => {
  const canvas = document.querySelector("#cave");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const TILE = 8;

  const BIOMES = {
    idle: {
      core: "#62f0cf",
      glow: "#62f0cf",
      warm: "#ffb347",
      moss: "#3d5a3a",
      floor: "#1b1822",
      spore: "#9ff5de",
    },
    moss: {
      core: "#a6ea6c",
      glow: "#c4f28a",
      warm: "#ffc65c",
      moss: "#4f7a33",
      floor: "#1b2119",
      spore: "#d9f79a",
    },
    crystal: {
      core: "#72e4ff",
      glow: "#b892ff",
      warm: "#8fd8ff",
      moss: "#2f4a74",
      floor: "#151a2e",
      spore: "#c9f3ff",
    },
    lava: {
      core: "#ff6d3a",
      glow: "#ffb02e",
      warm: "#ff8a3d",
      moss: "#6a2a1c",
      floor: "#241413",
      spore: "#ffd06a",
    },
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const toRgb = (b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, hex(v)]));
  let from = toRgb(BIOMES.idle),
    to = from,
    blendStart = 0;
  const palette = (now) => {
    const t = Math.min(1, (now - blendStart) / 1400);
    const e = t * t * (3 - 2 * t);
    return Object.fromEntries(
      Object.keys(to).map((k) => [k, mix(from[k], to[k], e)]),
    );
  };

  // Deterministic randomness: the cave looks the same on every visit.
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lattice = new Map();
  const cell = (x, y) => {
    const k = x * 7919 + y;
    if (!lattice.has(k)) lattice.set(k, rand());
    return lattice.get(k);
  };
  const smooth = (x, y) => {
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = cell(x0, y0) + (cell(x0 + 1, y0) - cell(x0, y0)) * sx;
    const b = cell(x0, y0 + 1) + (cell(x0 + 1, y0 + 1) - cell(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };

  let W = 0,
    H = 0,
    cols = 0,
    rows = 0,
    map = [],
    core = { x: 0, y: 0 },
    torches = [],
    ores = [],
    spores = [],
    base = null;

  function generate() {
    seed = 0x5eed;
    lattice.clear();
    cols = Math.ceil(W / TILE) + 1;
    rows = Math.ceil(H / TILE) + 1;
    core = { x: Math.round(cols * 0.7), y: Math.round(rows * 0.46) };
    map = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        const n =
          smooth(x / 5.5, y / 5.5) * 0.65 + smooth(x / 2.2, y / 2.2) * 0.35;
        // Open chamber around the Core and a winding tunnel across the cave.
        const dx = (x - core.x) / 9,
          dy = (y - core.y) / 6;
        const chamber = dx * dx + dy * dy < 1;
        const tunnelY = rows * 0.52 + Math.sin(x / 4.5) * rows * 0.12;
        const tunnel = Math.abs(y - tunnelY) < 2.2 + smooth(x / 3, 9) * 1.5;
        const shaft =
          Math.abs(x - cols * 0.28 - Math.sin(y / 3) * 2) < 1.8 && y < tunnelY;
        row.push(!(chamber || tunnel || shaft || n < 0.4));
      }
      map.push(row);
    }
    const wall = (x, y) =>
      y < 0 || y >= rows || x < 0 || x >= cols ? true : map[y][x];
    // The hero text sits lower left; keep that area free of bright lights.
    const quiet = (x, y) => x < cols * 0.56 && y > rows * 0.42;
    torches = [];
    ores = [];
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        if (
          wall(x, y) &&
          !wall(x, y + 1) &&
          rand() < (quiet(x, y) ? 0.04 : 0.18)
        )
          ores.push({
            x,
            y,
            phase: rand() * 6.28,
            bits: Array.from({ length: 4 }, () => [
              Math.floor(rand() * 7),
              Math.floor(rand() * 4),
            ]),
          });
        if (
          !wall(x, y) &&
          wall(x, y - 1) &&
          rand() < 0.3 &&
          !quiet(x, y) &&
          Math.hypot(x - core.x, y - core.y) > 6 &&
          torches.every((t) => Math.hypot(t.x - x, t.y - y) > 7)
        )
          torches.push({ x, y, phase: rand() * 6.28 });
      }
    spores = Array.from({ length: Math.round((W * H) / 2200) }, () => ({
      x: rand() * W,
      y: rand() * H,
      speed: 2 + rand() * 5,
      drift: rand() * 6.28,
      twinkle: rand() * 6.28,
    }));
    base = null;
  }

  // Static layer: stone walls with lit top faces and dark front faces,
  // dirt floor with pebbles. Rebuilt only when the biome floor colour moves.
  function paintBase(p) {
    base = base ?? document.createElement("canvas");
    base.width = W;
    base.height = H;
    const g = base.getContext("2d");
    const wall = (x, y) =>
      y < 0 || y >= rows || x < 0 || x >= cols ? true : map[y][x];
    seed = 0xc0ffee;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const px = x * TILE,
          py = y * TILE;
        if (wall(x, y)) {
          const shade = 0.9 + smooth(x * 1.7, y * 1.7) * 0.2;
          g.fillStyle = rgb(
            mix([62, 53, 74], [92, 80, 104], (shade - 0.9) * 5),
          );
          g.fillRect(px, py, TILE, TILE);
          // Speckle the stone top.
          for (let i = 0; i < 3; i++) {
            g.fillStyle =
              rand() < 0.5 ? "rgba(255,240,220,0.06)" : "rgba(0,0,0,0.18)";
            g.fillRect(
              px + Math.floor(rand() * 7),
              py + Math.floor(rand() * 7),
              1,
              1,
            );
          }
          if (!wall(x, y - 1)) {
            g.fillStyle = "rgba(255,236,210,0.16)";
            g.fillRect(px, py, TILE, 1);
          }
          if (!wall(x, y + 1)) {
            // Front face of the raised block, visible from the camera angle.
            g.fillStyle = "#2a2232";
            g.fillRect(px, py + TILE - 4, TILE, 4);
            g.fillStyle = "#1d1724";
            g.fillRect(px, py + TILE - 2, TILE, 1);
            g.fillStyle = "#120e18";
            g.fillRect(px, py + TILE - 1, TILE, 1);
          }
          if (!wall(x - 1, y)) {
            g.fillStyle = "rgba(0,0,0,0.25)";
            g.fillRect(px, py, 1, TILE);
          }
        } else {
          const n = smooth(x / 3 + 40, y / 3);
          g.fillStyle = rgb(p.floor);
          g.fillRect(px, py, TILE, TILE);
          // Moss as scattered pixels, denser where the noise is high.
          const tufts = n > 0.55 ? Math.round((n - 0.55) * 40) : 0;
          for (let i = 0; i < tufts; i++) {
            g.fillStyle = rgb(p.moss, 0.6 + rand() * 0.4);
            g.fillRect(
              px + Math.floor(rand() * 8),
              py + Math.floor(rand() * 8),
              1 + (rand() < 0.3 ? 1 : 0),
              1,
            );
          }
          if (rand() < 0.35) {
            g.fillStyle = "rgba(255,255,255,0.05)";
            g.fillRect(
              px + Math.floor(rand() * 6),
              py + Math.floor(rand() * 6),
              2,
              1,
            );
          }
          if (wall(x, y - 1)) {
            g.fillStyle = "rgba(0,0,0,0.35)";
            g.fillRect(px, py, TILE, 2);
          }
        }
      }
    base.floorKey = p.floor.join() + p.moss.join();
  }

  const dark = document.createElement("canvas");
  const dctx = dark.getContext("2d");
  // Hard-edged light bands: pixel lighting rather than a smooth falloff.
  function light(g, x, y, r, rgbColor, alpha) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const bands = [
      [0, 1],
      [0.34, 1],
      [0.35, 0.72],
      [0.6, 0.72],
      [0.61, 0.42],
      [0.82, 0.42],
      [0.83, 0.16],
      [1, 0],
    ];
    for (const [stop, a] of bands)
      grad.addColorStop(stop, rgb(rgbColor, a * alpha));
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  let player = null; // { tempo, time() } of the playing track
  function draw(now) {
    const p = palette(now);
    if (!base || base.floorKey !== p.floor.join() + p.moss.join()) paintBase(p);
    const t = now / 1000;
    ctx.drawImage(base, 0, 0);

    // Beat pulse: 1 on the beat, decaying until the next.
    let beat = 0.25 + 0.12 * Math.sin(t * 1.6);
    if (player) {
      const phase = ((player.time() * player.tempo) / 60) % 1;
      beat = 0.35 + Math.exp(-phase * 5) * 0.65;
    }

    // Ore veins glow softly in their walls.
    for (const o of ores) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 1.3 + o.phase);
      ctx.fillStyle = rgb(p.glow, 0.5 + 0.5 * pulse);
      for (const [bx, by] of o.bits)
        ctx.fillRect(o.x * TILE + bx, o.y * TILE + by, 1, 1);
    }
    // Torches: post, flickering flame.
    for (const tr of torches) {
      const x = tr.x * TILE + 3,
        y = tr.y * TILE + 1;
      ctx.fillStyle = "#5b3b25";
      ctx.fillRect(x, y + 2, 2, 4);
      const f = Math.sin(t * 9 + tr.phase) > 0 ? 1 : 0;
      ctx.fillStyle = rgb(p.warm);
      ctx.fillRect(x, y - f, 2, 2 + f);
      ctx.fillStyle = "#fff4c2";
      ctx.fillRect(x + (f ? 1 : 0), y + 1, 1, 1);
    }
    // The Core: a stepped stone pedestal with a gem that breathes with the
    // music. Drawn on a 2-pixel grid so it reads as the scene's centrepiece.
    const cx = core.x * TILE,
      cy = core.y * TILE;
    const block = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(cx + x * 2, cy + y * 2, w * 2, h * 2);
    };
    block(-9, -6, 18, 14, "#4a4058");
    block(-7, -8, 14, 18, "#4a4058");
    block(-9, -6, 18, 1, "#6c5f7c");
    block(-7, -8, 14, 1, "#6c5f7c");
    block(-9, 6, 18, 2, "#2a2232");
    block(-7, 9, 14, 1, "#1d1724");
    block(-6, -5, 12, 10, "#241d2e");
    // Rune lights on the pedestal pick up the biome colour.
    for (const [rx, ry] of [
      [-8, -1],
      [7, -1],
      [-1, 7],
      [0, 7],
    ])
      block(rx, ry, 1, 1, rgb(p.glow, 0.5 + beat * 0.5));
    const gem = [
      [0, -5, 1],
      [-1, -4, 3],
      [-2, -3, 5],
      [-3, -2, 7],
      [-3, -1, 7],
      [-2, 0, 5],
      [-1, 1, 3],
      [0, 2, 1],
    ];
    const lift = beat > 0.8 ? -1 : 0;
    for (const [ox, oy, w] of gem)
      block(ox, oy + lift, w, 1, rgb(mix(p.core, [255, 255, 255], beat * 0.3)));
    block(-3, -2 + lift, 3, 1, rgb(mix(p.core, [255, 255, 255], 0.55)));
    block(-1, -4 + lift, 1, 1, "#ffffff");

    // Spores and embers drift upward and twinkle.
    const dt = Math.min(0.1, (now - (draw.last ?? now)) / 1000);
    draw.last = now;
    for (const s of spores) {
      s.y -= s.speed * dt;
      s.x += Math.sin(t * 0.7 + s.drift) * 3 * dt;
      if (s.y < -2) {
        s.y = H + 2;
        s.x = Math.random() * W;
      }
      const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2 + s.twinkle));
      ctx.fillStyle = rgb(p.spore, a);
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }

    // Darkness with light cut out, then coloured light added on top.
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = "rgba(6,4,12,0.74)";
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = "destination-out";
    light(dctx, cx, cy, 76 + beat * 16, [0, 0, 0], 1);
    for (const tr of torches)
      light(
        dctx,
        tr.x * TILE + 4,
        tr.y * TILE + 2,
        40 + Math.sin(t * 7 + tr.phase) * 1.5,
        [0, 0, 0],
        0.95,
      );
    for (const o of ores)
      light(dctx, o.x * TILE + 4, o.y * TILE + 4, 14, [0, 0, 0], 0.55);
    ctx.drawImage(dark, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    light(ctx, cx, cy, 52 + beat * 18, p.core, 0.12 + beat * 0.12);
    for (const tr of torches)
      light(ctx, tr.x * TILE + 4, tr.y * TILE + 2, 34, p.warm, 0.13);
    for (const o of ores)
      light(ctx, o.x * TILE + 4, o.y * TILE + 4, 10, p.glow, 0.08);
    ctx.globalCompositeOperation = "source-over";
  }

  function resize() {
    const scale = Math.max(
      2,
      Math.round(Math.max(innerHeight / 200, innerWidth / 380)),
    );
    W = Math.ceil(innerWidth / scale);
    H = Math.ceil(innerHeight / scale);
    canvas.width = W;
    canvas.height = H;
    dark.width = W;
    dark.height = H;
    generate();
    draw(performance.now());
  }

  // ~15 fps: enough for flicker and drift, in keeping with pixel animation.
  let raf = 0,
    lastFrame = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - lastFrame < 66) return;
    lastFrame = now;
    draw(now);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (reduced.matches || document.hidden) draw(performance.now() + 2000);
    else raf = requestAnimationFrame(loop);
  }

  addEventListener("resize", () => {
    clearTimeout(resize.timer);
    resize.timer = setTimeout(resize, 150);
  });
  document.addEventListener("visibilitychange", start);
  reduced.addEventListener?.("change", start);
  resize();
  start();

  window.caveScene = {
    /** Switch the cave to a biome; pass a player to pulse the Core on its beat. */
    play(biome, tempo, time) {
      from = palette(performance.now());
      to = toRgb(BIOMES[biome] ?? BIOMES.idle);
      blendStart = performance.now();
      player = time ? { tempo, time } : null;
      if (reduced.matches) setTimeout(() => draw(performance.now() + 2000), 0);
    },
    rest() {
      player = null;
    },
  };
})();

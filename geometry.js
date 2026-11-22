"use strict";
const LithoGeometry = (() => {
  const tau = Math.PI * 2;
  function roundPoint(u, v, thickness, options, scale = 1, sweep = tau) {
    const angle = (u - 0.5) * sweep;
    const radius = options.width * scale / 2 + thickness;
    return [Math.sin(angle) * radius, (v - 0.5) * options.height, Math.cos(angle) * radius];
  }
  function smoothStep(start, end, v) {
    const t = Math.min(1, Math.max(0, (v - start) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function vessel(label, icon, variants) {
    const defaultVariant = Object.keys(variants)[0];
    return {
      label, icon, closed: true, field: "base-thickness", preserveAspect: true, floor: true, variants,
      point(u, v, thickness, options) {
        const variant = Object.hasOwn(variants, options.variant) ? options.variant : defaultVariant;
        return roundPoint(u, v, thickness, options, variants[variant].scale(v));
      }
    };
  }

  // Each profile maps the photo coordinates and outward thickness to millimetres.
  const profiles = {
    flat: { label: "Plana", icon: "▱", closed: false,
      point: (u, v, t, o) => [(u - 0.5) * o.width, (v - 0.5) * o.height, t] },
    cylinder: { label: "Cilíndrica", icon: "◉", closed: true, preserveAspect: true, point: roundPoint },
    cone: { label: "Cónica", icon: "△", closed: true, field: "top",
      point: (u, v, t, o) => roundPoint(u, v, t, o, 1 - v * (1 - o.top / 100)) },
    polygon: { label: "Poligonal", icon: "⬡", closed: true, field: "sides",
      segments: (count, o) => Math.ceil(count / o.sides) * o.sides,
      point(u, v, t, o) {
        const face = u * o.sides;
        const side = Math.floor(face);
        const fraction = face - side;
        const a = (side / o.sides - 0.5) * tau;
        const b = a + tau / o.sides;
        const radius = o.width / 2 + t / Math.cos(Math.PI / o.sides);
        return [
          radius * (Math.sin(a) * (1 - fraction) + Math.sin(b) * fraction),
          (v - 0.5) * o.height,
          radius * (Math.cos(a) * (1 - fraction) + Math.cos(b) * fraction)
        ];
      } },
    arc: { label: "Arco", icon: "◠", closed: false, field: "arc-angle", preserveAspect: true,
      surfaceWidth: o => Math.PI * o.width * o["arc-angle"] / 360,
      point: (u, v, t, o) => roundPoint(u, v, t, o, 1, tau * o["arc-angle"] / 360) },
    candle: vessel("Portavelas", "⊔", {
      round: { label: "Redondo", scale: v => 1 + 0.1 * v },
      bowl: { label: "Cuenco", scale: v => 1 + 0.36 * Math.sin(Math.PI * v / 2) },
      tulip: { label: "Tulipa", scale: v => 1 - 0.18 * Math.sin(Math.PI * v) ** 2 + 0.3 * v ** 2 },
      barrel: { label: "Barril", scale: v => 1 + 0.31 * Math.sin(Math.PI * v) - 0.04 * v }
    }),
    vase: vessel("Florero", "⚱", {
      classic: { label: "Clásico", scale: v => 1 + 0.28 * Math.sin(Math.PI * v) ** 2 -
        0.36 * smoothStep(0.46, 0.82, v) + 0.18 * smoothStep(0.85, 1, v) },
      bottle: { label: "Botella", scale: v => 1 + 0.14 * smoothStep(0, 0.22, v) -
        0.65 * smoothStep(0.53, 0.78, v) + 0.06 * smoothStep(0.91, 1, v) },
      amphora: { label: "Ánfora", scale: v => 1 + 0.55 * Math.sin(Math.PI * v) ** 2 -
        0.23 * smoothStep(0.54, 0.87, v) + 0.12 * smoothStep(0.91, 1, v) },
      trumpet: { label: "Trompeta", scale: v => 1 - 0.26 * Math.sin(Math.PI * v) ** 2 + 0.45 * v ** 3 }
    })
  };

  function surfaceWidth(options) {
    const profile = profiles[options.shape];
    return profile.surfaceWidth?.(options) ?? options.width * (profile.closed ? Math.PI : 1);
  }

  function borderRamp(width) {
    return Math.min(0.6, width * 0.3);
  }

  function edgeSamples(size, width, ramp) {
    const inside = width / size;
    const end = (width + ramp) / size;
    return [inside, end, 1 - end, 1 - inside];
  }

  function refine(samples, marks) {
    for (const mark of marks) {
      samples = samples.filter(value => Math.abs(value - mark) > 1e-7);
      samples.push(mark);
    }
    return samples.sort((a, b) => a - b);
  }

  function build(options, sample, resolution = 180, connection = null) {
    const profile = profiles[options.shape];
    const surface = surfaceWidth(options);
    const ratio = surface / options.height;
    const panels = options.panels || 1;
    const horizontal = Math.max(32, panels * 24, Math.round(resolution * Math.min(1, ratio)));
    const baseColumns = profile.segments ? profile.segments(horizontal, options) : Math.ceil(horizontal / panels) * panels;
    const baseRows = Math.max(24, Math.round(resolution * Math.min(1, 1 / ratio)));
    let positions = connection?.positions ?? Array.from({ length: baseColumns + Number(!profile.closed) }, (_, x) => x / baseColumns);
    let rows = Array.from({ length: baseRows + 1 }, (_, y) => y / baseRows);
    const border = options.border;
    const ramp = border ? borderRamp(border.width) : 0;
    if (border) {
      rows = refine(rows, edgeSamples(options.height, border.width, ramp));
      if (!profile.closed) positions = refine(positions, edgeSamples(surface, border.width, ramp));
    }
    const innerStart = connection?.height ?? (profile.floor ? options["base-thickness"] : 0);
    const innerV = innerStart / options.height;
    if (innerStart) rows = refine(rows, [innerV]);
    const innerRow = rows.indexOf(innerV);
    const columns = positions.length;
    const nx = columns - Number(!profile.closed);
    const ny = rows.length - 1;
    const layer = columns * rows.length;
    const vertices = new Float32Array((layer * 2 + (profile.floor ? 2 : 0)) * 4);
    const triangles = [];
    for (let y = 0; y <= ny; y++) {
      for (let x = 0; x < columns; x++) {
        const u = positions[x], v = rows[y];
        let tone = sample(u, 1 - v, options);
        if (profile.closed && panels === 1) {
          // Blend both photo edges into one shared, continuous relief seam.
          const blend = Math.max(0, 1 - Math.min(u, 1 - u) * 26);
          if (blend) tone += ((sample(0, 1 - v, options) + sample(1, 1 - v, options)) / 2 - tone) * blend;
        }
        let thickness = options.min + (options.max - options.min) * (options.invert ? tone : 1 - tone);
        if (border) {
          let edgeDistance = Math.min(v, 1 - v) * options.height;
          if (!profile.closed) edgeDistance = Math.min(edgeDistance, Math.min(u, 1 - u) * surface);
          const amount = Math.max(0, Math.min(1, (border.width + ramp - edgeDistance) / ramp));
          thickness += (options.max + border.rise - thickness) * amount;
        }
        const index = y * columns + x;
        vertices.set([...profile.point(u, v, thickness, options), thickness], index * 4);
        vertices.set([...profile.point(u, v, 0, options), thickness], (index + layer) * 4);
      }
    }

    function quad(a, b, c, d) {
      triangles.push(a, b, c, a, c, d);
    }
    function rim(a, b) {
      quad(b, a, a + layer, b + layer);
    }
    if (profile.floor) {
      const underside = layer * 2;
      const floorTop = underside + 1;
      vertices.set([0, -options.height / 2, 0, options["base-thickness"]], underside * 4);
      vertices.set([0, -options.height / 2 + innerStart, 0, options["base-thickness"]], floorTop * 4);
      for (let x = 0; x < nx; x++) {
        const next = (x + 1) % columns;
        const inner = layer + innerRow * columns;
        triangles.push(next, x, underside, inner + x, inner + next, floorTop);
      }
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const a = y * columns + x;
        const b = y * columns + (x + 1) % columns;
        const c = b + columns, d = a + columns;
        quad(a, b, c, d);
        if (y >= innerRow) quad(a + layer, d + layer, c + layer, b + layer);
        if (y === 0 && !innerStart) rim(a, b);
        if (y === ny - 1) rim(c, d);
        if (!profile.closed && x === 0) rim(d, a);
        if (!profile.closed && x === nx - 1) rim(b, c);
      }
    }
    const mesh = { vertices, triangles: Uint32Array.from(triangles), options };
    if (connection) {
      mesh.outerRing = Array.from({ length: columns }, (_, index) => index);
      mesh.innerRing = mesh.outerRing.map(index => index + layer + innerRow * columns);
    }
    return mesh;
  }

  function stl({ vertices, triangles, options, bedY = -options.height / 2 }) {
    const buffer = new ArrayBuffer(84 + triangles.length / 3 * 50);
    const data = new DataView(buffer);
    new Uint8Array(buffer).set(new TextEncoder().encode("LITUM3D Studio | millimeters"));
    data.setUint32(80, triangles.length / 3, true);
    function vertex(index) {
      const offset = index * 4;
      const x = vertices[offset], y = vertices[offset + 1], z = vertices[offset + 2];
      return options.shape === "flat" ? [x, y, z] : [x, -z, y - bedY];
    }
    for (let i = 0; i < triangles.length; i += 3) {
      const a = vertex(triangles[i]), b = vertex(triangles[i + 1]), c = vertex(triangles[i + 2]);
      const u = b.map((value, index) => value - a[index]);
      const v = c.map((value, index) => value - a[index]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal) || 1;
      const offset = 84 + i / 3 * 50;
      [...normal.map(value => value / length), ...a, ...b, ...c].forEach((value, index) => {
        data.setFloat32(offset + index * 4, value, true);
      });
    }
    return buffer;
  }
  return { profiles, build, borderRamp, surfaceWidth, stl };
})();
if (typeof module !== "undefined") module.exports = LithoGeometry;

"use strict";
const LithoGeometry = (() => {
  const tau = Math.PI * 2;
  function roundPoint(u, v, thickness, options, scale = 1) {
    const angle = (u - 0.5) * tau;
    const radius = options.width * scale / 2 + thickness;
    return [Math.sin(angle) * radius, (v - 0.5) * options.height, Math.cos(angle) * radius];
  }
  // Each profile maps the photo coordinates and outward thickness to millimetres.
  const profiles = {
    flat: { label: "Plana", icon: "▱", closed: false,
      point: (u, v, t, o) => [(u - 0.5) * o.width, (v - 0.5) * o.height, t] },
    cylinder: { label: "Cilíndrica", icon: "◉", closed: true, point: roundPoint },
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
      } }
  };

  function build(options, sample, resolution = 180, connection = null) {
    const profile = profiles[options.shape];
    const circumference = options.width * (profile.closed ? Math.PI : 1);
    const ratio = circumference / options.height;
    const panels = options.panels || 1;
    const horizontal = Math.max(32, panels * 24, Math.round(resolution * Math.min(1, ratio)));
    const positions = connection?.positions;
    const nx = positions?.length ?? (profile.segments ? profile.segments(horizontal, options) : Math.ceil(horizontal / panels) * panels);
    const ny = Math.max(24, Math.round(resolution * Math.min(1, 1 / ratio)));
    const joinV = connection ? connection.height / options.height : 0;
    const joinRow = connection ? Math.max(1, Math.round(joinV * ny)) : 0;
    const columns = nx + Number(!profile.closed);
    const layer = columns * (ny + 1);
    const vertices = new Float32Array(layer * 2 * 4);
    const triangles = [];
    for (let y = 0; y <= ny; y++) {
      // Place an inner-wall ring exactly at the height of the integral mount.
      const innerV = joinRow === 0 ? y / ny : y <= joinRow ? y / joinRow * joinV :
        joinV + (y - joinRow) / (ny - joinRow) * (1 - joinV);
      for (let x = 0; x < columns; x++) {
        const u = positions ? positions[x] : x / nx, v = y / ny;
        let tone = sample(u, 1 - v);
        if (profile.closed && panels === 1) {
          // Blend both photo edges into one shared, continuous relief seam.
          const blend = Math.max(0, 1 - Math.min(u, 1 - u) * 26);
          if (blend) tone += ((sample(0, 1 - v) + sample(1, 1 - v)) / 2 - tone) * blend;
        }
        const thickness = options.min + (options.max - options.min) * (options.invert ? tone : 1 - tone);
        const index = y * columns + x;
        vertices.set([...profile.point(u, v, thickness, options), thickness], index * 4);
        vertices.set([...profile.point(u, innerV, 0, options), thickness], (index + layer) * 4);
      }
    }

    function quad(a, b, c, d) {
      triangles.push(a, b, c, a, c, d);
    }
    function rim(a, b) {
      quad(b, a, a + layer, b + layer);
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const a = y * columns + x;
        const b = y * columns + (x + 1) % columns;
        const c = b + columns, d = a + columns;
        quad(a, b, c, d);
        if (y >= joinRow) quad(a + layer, d + layer, c + layer, b + layer);
        if (y === 0 && !joinRow) rim(a, b);
        if (y === ny - 1) rim(c, d);
        if (!profile.closed && x === 0) rim(d, a);
        if (!profile.closed && x === nx - 1) rim(b, c);
      }
    }
    const mesh = { vertices, triangles: Uint32Array.from(triangles), options };
    if (joinRow) {
      mesh.outerRing = Array.from({ length: columns }, (_, index) => index);
      mesh.innerRing = mesh.outerRing.map(index => index + layer + joinRow * columns);
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
  return { profiles, build, stl };
})();
if (typeof module !== "undefined") module.exports = LithoGeometry;

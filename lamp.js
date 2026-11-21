"use strict";
const LampMount = (() => {
  const tau = 2 * Math.PI;
  const shelfHeight = 2;

  function supports(shape) {
    return ["cylinder", "cone", "polygon"].includes(shape);
  }

  function build(shade, { opening, height, wall, arms, armWidth, clearance }, joined = false) {
    if (!supports(shade.shape)) throw new Error("Elige una geometría envolvente para generar el soporte.");
    if (height > shade.height) throw new Error("La altura del soporte debe caber dentro de la litofanía.");
    const polygon = shade.shape === "polygon";
    const baseRadius = shade.width / 2;
    const topRadius = shade.shape === "cone" ? baseRadius * (1 - height / shade.height * (1 - shade.top / 100)) : baseRadius;
    const apothemFactor = polygon ? Math.cos(Math.PI / shade.sides) : 1;
    const hub = opening / 2 + wall;
    const narrowestRim = topRadius * apothemFactor - clearance - wall;
    if (narrowestRim <= hub + 0.5) {
      throw new Error("El aro central no cabe. Reduce su diámetro, grosor o altura, o amplía la litofanía.");
    }

    const period = tau / arms;
    const armHalf = Math.atan2(armWidth / 2, (hub + narrowestRim) / 2);
    if (armHalf * 2 >= period - 0.02) throw new Error("Reduce el ancho o el número de brazos.");
    const ringResolution = joined ? 380 : 192;
    const angles = Array.from({ length: ringResolution }, (_, i) => i * tau / ringResolution);
    if (polygon) for (let side = 0; side < shade.sides; side++) angles.push(side * tau / shade.sides);
    for (let arm = 0; arm < arms; arm++) {
      angles.push((arm * period + armHalf) % tau, (arm * period - armHalf + tau) % tau);
    }
    const columns = angles.sort((a, b) => a - b).filter((angle, index, all) => index === 0 || angle - all[index - 1] > 1e-7);
    const n = columns.length;
    const vertices = new Float32Array(n * 3 * 5 * 4);
    const triangles = [];
    const base = -shade.height / 2;
    const vertex = (x, y, r) => (y * 5 + r) * n + (x + n) % n;
    const heightLevels = [base - shelfHeight, base, base + height];
    for (let x = 0; x < n; x++) {
      const angle = columns[x];
      const around = polygon ? (angle % (tau / shade.sides)) - Math.PI / shade.sides : 0;
      const radialFactor = apothemFactor / Math.cos(around);
      const shelfEnd = (baseRadius + (shade.max + 0.6) / apothemFactor) * radialFactor;
      for (let y = 0; y < 3; y++) {
        const fit = ((y === 2 ? topRadius : baseRadius) - clearance / apothemFactor) * radialFactor;
        const radii = [opening / 2, hub, fit - wall * radialFactor / apothemFactor, fit, shelfEnd];
        radii.forEach((radius, r) => {
          vertices.set([Math.sin(angle - Math.PI) * radius, heightLevels[y],
            Math.cos(angle - Math.PI) * radius, -1], vertex(x, y, r) * 4);
        });
      }
    }
    const hasArm = columns.map((angle, x) => {
      const middle = (angle + (columns[x + 1] ?? tau)) / 2;
      return Math.abs((middle + period / 2) % period - period / 2) < armHalf;
    });
    const filled = (x, y, r) => (
      y >= 0 && y < 2 && r >= 0 && r < 4 &&
      (r === 0 || r === 2 || (r === 1 && hasArm[(x + n) % n]) || (r === 3 && y === 0))
    );
    function quad(a, b, c, d) {
      triangles.push(a, b, c, a, c, d);
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < 2; y++) {
        for (let r = 0; r < 4; r++) {
          if (!filled(x, y, r)) continue;
          const a = vertex(x, y, r + 1), b = vertex(x + 1, y, r + 1);
          const c = vertex(x + 1, y + 1, r + 1), d = vertex(x, y + 1, r + 1);
          const e = vertex(x, y, r), f = vertex(x + 1, y, r);
          const g = vertex(x + 1, y + 1, r), h = vertex(x, y + 1, r);
          if (!filled(x, y, r + 1) && !(joined && y === 1 && r === 2)) quad(a, b, c, d);
          if (!filled(x, y, r - 1)) quad(e, h, g, f);
          const joinRing = (y === 0 && r === 3) || (y === 1 && r === 2);
          if (!filled(x, y + 1, r) && !(joined && joinRing)) quad(d, c, g, h);
          if (!filled(x, y - 1, r)) quad(b, a, e, f);
          if (!filled(x - 1, y, r)) quad(a, d, h, e);
          if (!filled(x + 1, y, r)) quad(c, b, f, g);
        }
      }
    }
    const mesh = { vertices, triangles: Uint32Array.from(triangles), options: shade, bedY: base - shelfHeight };
    if (joined) {
      mesh.outerRing = columns.map((_, x) => vertex(x, 1, 4));
      mesh.innerRing = columns.map((_, x) => vertex(x, 2, 2));
      const sector = tau / shade.sides;
      mesh.connection = { height, positions: columns.map(angle => {
        if (!polygon) return angle / tau;
        // A polygon profile uses linear distance along each face, while
        // the mount uses the angle of the ray intersecting that face.
        const side = Math.floor(angle / sector);
        const delta = angle - (side + 0.5) * sector;
        const along = 0.5 + Math.tan(delta) / (2 * Math.tan(sector / 2));
        return (side + along) / shade.sides;
      }) };
    }
    return mesh;
  }

  function join(shade, mount) {
    const offset = shade.vertices.length / 4;
    const vertices = new Float32Array(shade.vertices.length + mount.vertices.length);
    vertices.set(shade.vertices);
    vertices.set(mount.vertices, shade.vertices.length);
    const seams = [];
    function connect(first, second) {
      // Each pair lies on the same radial line, including polygon corners.
      for (let i = 0; i < first.length; i++) {
        const next = (i + 1) % first.length;
        seams.push(first[i], first[next], second[i], first[next], second[next], second[i]);
      }
    }
    connect(mount.outerRing.map(index => index + offset), shade.outerRing);
    connect(shade.innerRing, mount.innerRing.map(index => index + offset));
    const triangles = new Uint32Array(shade.triangles.length + mount.triangles.length + seams.length);
    triangles.set(shade.triangles);
    for (let i = 0; i < mount.triangles.length; i++) triangles[shade.triangles.length + i] = mount.triangles[i] + offset;
    triangles.set(seams, shade.triangles.length + mount.triangles.length);
    return { vertices, triangles, options: shade.options, bedY: mount.bedY };
  }
  return { supports, build, join };
})();
if (typeof module !== "undefined") module.exports = LampMount;

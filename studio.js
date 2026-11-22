"use strict";
const $ = id => document.getElementById(id);
const canvas = $("view");
const { profiles, build, borderRamp, surfaceWidth, stl } = LithoGeometry;
const controls = ["width", "height", "sides", "top", "min", "max"];
const shapeFields = ["arc-angle", "base-thickness"];
const vesselShapes = Object.keys(profiles).filter(key => profiles[key].variants);
const shapeNotes = {
  arc: "Pantalla curva abierta. El soporte circular encaja bajo el arco y se exporta por separado.",
  candle: "Para velas LED. El recipiente queda abierto por arriba.",
  vase: "Florero para flores secas o con un recipiente interior para el agua."
};
const initialCamera = { yaw: -0.33, pitch: 0.19, zoom: 1 };
const camera = { ...initialCamera };
let shape = "flat";
let backlight = true;
let mesh, mountMesh, frame, renderer;
let activePhoto = 0;
let polygonFaces = 6;
const photoPositions = { cylinder: 1, arc: 1, candle: 1, vase: 1 };
const photos = [];
const pendingImports = [];
const toneControls = ["brightness", "contrast", "exposure"];
const photoControls = ["photo-zoom", ...toneControls];
const mountControls = {
  opening: "opening", height: "mount-height", wall: "wall", arms: "arms",
  armWidth: "arm-width", clearance: "clearance"
};
const presetKey = "litum3d-presets-v1";
const presetFields = [...controls, ...Object.values(mountControls), "flat-photos", "light"];
const borderFields = ["border-width", "border-rise"];
let importVersion = 0;

function landscape() {
  const image = document.createElement("canvas");
  image.width = 720;
  image.height = 510;
  const ctx = image.getContext("2d");
  let seed = 322;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const sky = ctx.createLinearGradient(0, 0, 0, 340);
  sky.addColorStop(0, "#999");
  sky.addColorStop(1, "#f6f6f6");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 720, 510);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(525, 137, 64, 0, 2 * Math.PI);
  ctx.fill();
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = "#ffffff30";
    ctx.fillRect(random() * 720, random() * 273, 4 + random() * 46, 1);
  }
  const ridges = [
    { level: 202, color: "#b1b1b1", peaks: [[165, 138, 137], [280, 208, 148], [398, 157, 118], [590, 102, 122]] },
    { level: 333, color: "#737373", peaks: [[155, 176, 238], [299, 139, 158], [527, 112, 158], [675, 95, 125]] },
    { level: 434, color: "#444", peaks: [[85, 70, 162], [253, 87, 174], [630, 94, 202]] }
  ];
  for (const ridge of ridges) {
    ctx.fillStyle = ridge.color;
    ctx.beginPath();
    ctx.moveTo(0, 510);
    for (let x = 0; x <= 720; x += 3) {
      const peak = Math.max(...ridge.peaks.map(([center, lift, span]) => lift * Math.max(0, 1 - Math.abs(x - center) / span)));
      const rough = 6 * Math.sin(x * 0.071) + 4 * Math.cos(x * 0.173) + 5 * random();
      ctx.lineTo(x, ridge.level - peak + rough);
    }
    ctx.lineTo(720, 510);
    ctx.fill();
  }
  function tree(x, y, height) {
    ctx.fillStyle = random() > 0.4 ? "#282828" : "#363636";
    ctx.fillRect(x - 1, y - height * 0.45, 2, height * 0.5);
    for (let branch = 0; branch < 5; branch++) {
      const tip = y - height + branch * height * 0.13;
      const spread = height * (0.079 + branch * 0.029);
      ctx.beginPath();
      ctx.moveTo(x, tip);
      ctx.lineTo(x + spread, tip + height * 0.38);
      ctx.lineTo(x, tip + height * 0.31);
      ctx.lineTo(x - spread, tip + height * 0.42);
      ctx.fill();
    }
  }
  for (let i = 0; i < 125; i++) {
    const x = random() * 720;
    tree(x, 441 + 15 * Math.sin(x / 80) + random() * 62, 32 + random() * 61);
  }
  return image;
}

function setImage(image, label) {
  const longest = Math.max(image.width, image.height);
  const bitmap = document.createElement("canvas");
  bitmap.width = Math.max(2, Math.round(image.width / longest * 512));
  bitmap.height = Math.max(2, Math.round(image.height / longest * 512));
  const context = bitmap.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(image, 0, 0, bitmap.width, bitmap.height);
  const photo = {
    original: bitmap, label, rotation: 0, mirrored: false,
    invert: false, brightness: 0, contrast: 0, exposure: 0, "photo-zoom": 100
  };
  updateImage(photo);
  return photo;
}

function updateImage(photo) {
  const { original, rotation, mirrored, invert } = photo;
  const bitmap = document.createElement("canvas");
  const swapped = rotation % 2 === 1;
  bitmap.width = swapped ? original.height : original.width;
  bitmap.height = swapped ? original.width : original.height;
  const context = bitmap.getContext("2d", { willReadFrequently: true });
  context.translate(bitmap.width / 2, bitmap.height / 2);
  context.scale(mirrored ? -1 : 1, 1);
  context.rotate(rotation * Math.PI / 2);
  context.drawImage(original, -original.width / 2, -original.height / 2);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const tones = new Float32Array(image.width * image.height);
  const exposure = 2 ** photo.exposure;
  const brightness = photo.brightness / 200;
  const contrast = 2 ** (photo.contrast / 50);
  for (let pixel = 0; pixel < tones.length; pixel++) {
    const offset = pixel * 4;
    const tone = (image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722) / 255;
    const adjusted = Math.min(1, Math.max(0, (tone * exposure + brightness - 0.5) * contrast + 0.5));
    tones[pixel] = invert ? 1 - adjusted : adjusted;
    const gray = tones[pixel] * 255;
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = gray;
  }
  context.putImageData(image, 0, 0);
  photo.raster = { width: image.width, height: image.height, tones };
  photo.preview = bitmap;
}

function panelCount() {
  if (shape === "flat") return Number($("flat-photos").value);
  if (Object.hasOwn(photoPositions, shape)) return photoPositions[shape];
  return shape === "polygon" ? polygonFaces : 1;
}

function photoLayout(options) {
  const profile = profiles[options.shape];
  if (!profile.preserveAspect) return null;
  const span = surfaceWidth(options) / options.panels;
  if (!profile.floor) return { aspect: span / options.height };

  // The vessel widens and narrows. Measure along its side and fit to the
  // narrowest row so a photo at 100% stays inside its position.
  const steps = 128;
  const radii = Array.from({ length: steps + 1 }, (_, row) => profile.point(0.5, 1 - row / steps, 0, options)[2]);
  const lengths = [0];
  for (let row = 1; row <= steps; row++) {
    lengths.push(lengths[row - 1] + Math.hypot(options.height / steps, radii[row] - radii[row - 1]));
  }
  const minimum = Math.min(...radii);
  const total = lengths[steps];
  return {
    aspect: span * (minimum / (options.width / 2)) / total,
    map(v) {
      const row = v * steps;
      const index = Math.min(steps - 1, Math.floor(row)), fraction = row - index;
      const radius = radii[index] + (radii[index + 1] - radii[index]) * fraction;
      const length = lengths[index] + (lengths[index + 1] - lengths[index]) * fraction;
      return { v: length / total, widthScale: radius / minimum };
    }
  };
}

function showPhoto() {
  const photo = photos[activePhoto];
  const label = photo?.label ?? "Sin foto";
  $("photo-name").textContent = label;
  $("photo-name").title = label;
  $("remove-photo").hidden = !photo || panelCount() === 1;
  $("invert").checked = photo?.invert ?? false;
  $("invert").disabled = !photo;
  $("image-editor").hidden = !photo;
  const thumb = $("thumb");
  const preview = thumb.getContext("2d");
  preview.fillStyle = "#101110";
  preview.fillRect(0, 0, thumb.width, thumb.height);
  if (photo) {
    const bitmap = photo.preview;
    const originalAspect = bitmap.width / bitmap.height;
    const fitted = photoLayout({
      shape, width: $("width").valueAsNumber, height: $("height").valueAsNumber,
      panels: panelCount(), "arc-angle": $("arc-angle").valueAsNumber,
      variant: $(shape + "-profile")?.value
    })?.aspect;
    const aspect = fitted > 0 && Number.isFinite(fitted) ? fitted : originalAspect;
    const height = Math.min(thumb.height, thumb.width / aspect);
    const width = height * aspect;
    const left = (thumb.width - width) / 2, top = (thumb.height - height) / 2;
    const scale = Math.min(width / bitmap.width, height / bitmap.height) * photo["photo-zoom"] / 100;
    preview.save();
    preview.beginPath();
    preview.rect(left, top, width, height);
    preview.clip();
    preview.fillStyle = "#fff";
    preview.fillRect(left, top, width, height);
    preview.drawImage(bitmap, (thumb.width - bitmap.width * scale) / 2,
      (thumb.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    preview.restore();
  }
  for (const id of photoControls) {
    $(id).value = photo?.[id] ?? $(id).defaultValue;
    const unit = id === "exposure" ? " EV" : id === "photo-zoom" ? " %" : "";
    $(id + "-value").textContent = $(id).valueAsNumber.toLocaleString("es") + unit;
  }
  $("mirror-image").setAttribute("aria-pressed", String(photo?.mirrored ?? false));
}

function renderSlots() {
  const count = panelCount();
  activePhoto = Math.min(activePhoto, count - 1);
  $("flat-photos-field").hidden = shape !== "flat";
  const adjustable = Object.hasOwn(photoPositions, shape);
  $("wrap-photos-field").hidden = !adjustable;
  $("wrap-photos-count").textContent = count === 1 ? "1 posición de foto" : count + " posiciones de foto";
  $("wrap-remove").disabled = count === 1;
  $("file").multiple = adjustable || shape === "flat" || shape === "polygon";
  $("photo-hint").textContent = $("file").multiple ? "Selecciona o arrastra fotos" : "Selecciona o arrastra una foto";
  const slots = $("photo-slots");
  slots.hidden = count === 1;
  slots.replaceChildren();
  if (count > 1) for (let index = 0; index < count; index++) {
    const button = document.createElement("button");
    const title = (shape === "polygon" ? "Cara " : "Posición ") + (index + 1);
    button.type = "button";
    button.textContent = title;
    button.title = photos[index]?.label ?? "Sin foto";
    button.setAttribute("aria-label", title + " · " + button.title);
    button.setAttribute("aria-pressed", String(index === activePhoto));
    button.dataset.filled = String(Boolean(photos[index]));
    button.onclick = () => {
      activePhoto = index;
      for (const slot of slots.children) slot.setAttribute("aria-pressed", String(slot === button));
      showPhoto();
    };
    slots.append(button);
  }
  showPhoto();
}

function samplePhoto(index, u, v, aspect = null, widthScale = 1) {
  const photo = photos[index];
  if (!photo) return 1;
  const raster = photo.raster;
  const zoom = photo["photo-zoom"] / 100;
  const ratio = aspect ? aspect / (raster.width / raster.height) : 1;
  u = 0.5 + (u - 0.5) * Math.max(1, ratio) * widthScale / zoom;
  v = 0.5 + (v - 0.5) * Math.max(1, 1 / ratio) / zoom;
  if (u < 0 || v < 0 || u > 1 || v > 1) return 1;
  const x = u * (raster.width - 1), y = v * (raster.height - 1);
  const ix = Math.floor(x), iy = Math.floor(y);
  function luminance(column, row) {
    return raster.tones[row * raster.width + column];
  }
  const right = Math.min(ix + 1, raster.width - 1), lower = Math.min(iy + 1, raster.height - 1);
  const upperTone = luminance(ix, iy) * (1 - x + ix) + luminance(right, iy) * (x - ix);
  const lowerTone = luminance(ix, lower) * (1 - x + ix) + luminance(right, lower) * (x - ix);
  return upperTone * (1 - y + iy) + lowerTone * (y - iy);
}

function sample(u, v, options, layout = photoLayout(options)) {
  const count = options.panels;
  const mapped = layout?.map?.(v);
  const row = mapped?.v ?? v;
  const widthScale = mapped?.widthScale ?? 1;
  const aspect = layout?.aspect;
  if (count === 1) return samplePhoto(0, u, row, aspect, widthScale);
  const section = u * count;
  const seam = Math.round(section);
  if (Math.abs(section - seam) < 1e-8 &&
      (profiles[options.shape].closed || (seam > 0 && seam < count))) {
    const left = (seam + count - 1) % count;
    return (samplePhoto(left, 1, row, aspect, widthScale) + samplePhoto(seam % count, 0, row, aspect, widthScale)) / 2;
  }
  const index = Math.min(count - 1, Math.floor(section));
  return samplePhoto(index, section - index, row, aspect, widthScale);
}

function buildPhotoMesh(options, resolution, connection) {
  const layout = photoLayout(options);
  return build(options, (u, v) => sample(u, v, options, layout), resolution, connection);
}

function settings() {
  const options = { shape, panels: panelCount() };
  if (profiles[shape].variants) options.variant = $(shape + "-profile").value;
  const field = profiles[shape].field;
  const activeControls = shapeFields.includes(field) ? [...controls, field] : controls;
  for (const id of activeControls) {
    const input = $(id);
    if (!input.validity.valid || input.value === "") {
      throw new Error("Revisa los límites de las dimensiones y el grosor.");
    }
    options[id] = input.valueAsNumber;
  }
  if (options.max <= options.min) throw new Error("El grosor máximo debe superar al mínimo.");
  if ($("border-enabled").checked) {
    const widthInput = $("border-width"), riseInput = $("border-rise");
    if (!widthInput.value || !riseInput.value || !widthInput.validity.valid || !riseInput.validity.valid) {
      throw new Error("Revisa el ancho y la altura del borde.");
    }
    const width = widthInput.valueAsNumber, rise = riseInput.valueAsNumber;
    const span = profiles[shape].closed ? options.height : Math.min(surfaceWidth(options), options.height);
    if (2 * (width + borderRamp(width)) >= span) {
      throw new Error("Reduce el ancho del borde para dejar espacio para la imagen.");
    }
    options.border = { width, rise };
  }
  return options;
}

function regenerate() {
  $("border-options").hidden = !$("border-enabled").checked;
  $("border-note").textContent = profiles[shape].closed ?
    "En los cantos superior e inferior. La altura se suma al grosor máximo." :
    "En todo el contorno abierto. La altura se suma al grosor máximo.";
  $("border-note").removeAttribute("data-invalid");
  try {
    mesh = buildPhotoMesh(settings());
  } catch (error) {
    $("status").textContent = error.message;
    if ($("border-enabled").checked && error.message.includes("borde")) {
      $("border-note").textContent = error.message;
      $("border-note").dataset.invalid = "true";
    }
    $("export").disabled = true;
    $("lamp-export").disabled = true;
    $("lamp-join").disabled = true;
    $("lamp-view").disabled = true;
    return;
  }
  $("export").disabled = false;
  $("status").textContent = renderer ? "Las fotografías se procesan en tu navegador." : "Vista 3D no disponible. Puedes seguir exportando STL.";
  const { width, height } = mesh.options;
  $("size").textContent = `${shape !== "flat" ? "Ø " : ""}${width} × ${height} mm`;
  updateMount();
}

function mountSettings() {
  const options = {};
  for (const [key, id] of Object.entries(mountControls)) {
    const input = $(id);
    if (!input.validity.valid || input.value === "") throw new Error("Revisa las medidas del soporte.");
    options[key] = input.valueAsNumber;
  }
  return options;
}

function updateMount() {
  const active = LampMount.supports(shape) && $("lamp-enabled").checked;
  $("lamp-options").hidden = !active;
  const fit = $("lamp-fit");
  fit.textContent = "Mide el paso del portalámparas para ajustar el orificio.";
  fit.dataset.invalid = "false";
  mountMesh = null;
  if (active) {
    try {
      mountMesh = LampMount.build(settings(), mountSettings());
    } catch (error) {
      fit.dataset.invalid = "true";
      fit.textContent = error.message;
    }
  }
  $("lamp-export").disabled = !mountMesh;
  $("lamp-join").disabled = !mountMesh || !LampMount.supportsJoined(shape);
  $("lamp-view").disabled = !mountMesh || !renderer;
  renderer?.upload(mesh, mountMesh);
  redraw();
}

function createRenderer() {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true });
  if (!gl) return null;
  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
    layout(location=0) in vec4 point;
    uniform vec4 orbit;
    uniform vec4 view;
    out vec3 position;
    out vec3 model;
    out float thickness;
    void main() {
      vec3 p=point.xyz*view.x;
      model=p;
      vec3 q=vec3(orbit.x*p.x+orbit.y*p.z,p.y,-orbit.y*p.x+orbit.x*p.z);
      position=vec3(q.x,orbit.z*q.y-orbit.w*q.z,orbit.w*q.y+orbit.z*q.z);
      float depth=3.3-position.z;
      gl_Position=vec4(position.x*view.y,position.y*view.z,depth*1.078-0.83,depth);
      thickness=point.w;
    }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec3 position;
    in vec3 model;
    in float thickness;
    uniform vec4 material;
    uniform bool floorPass;
    out vec4 color;
    void main() {
      if(floorPass) {
        vec2 scaled=model.xz*9.0;
        vec2 grid=abs(fract(scaled-0.5)-0.5)/max(fwidth(scaled),0.001);
        float line=1.0-min(min(grid.x,grid.y),1.0);
        float fade=1.0-smoothstep(0.7,2.4,length(model.xz));
        float shadow=0.40*exp(-dot(model.xz,model.xz)*9.0);
        color=vec4(mix(vec3(0.022,0.018,0.013),vec3(0.48,0.38,0.29),line),max(shadow,fade*line*0.28));
        return;
      }
      vec3 normal=normalize(cross(dFdx(position),dFdy(position)));
      float diffuse=max(dot(normal,normalize(vec3(-0.4,0.65,1.0))),0.0);
      vec3 relief=vec3(0.86,0.80,0.70)*(0.30+0.70*diffuse);
      if(thickness<0.0) {
        color=vec4(vec3(0.85,0.62,0.40)*(0.48+0.52*diffuse),1.0);
        return;
      }
      float transmission=exp(-0.77*thickness);
      vec3 warm=vec3(1.0,0.68,0.36)*pow(transmission,0.65)*material.x*1.35;
      vec3 lit=relief*0.30 + warm;
      color=vec4(mix(relief,lit,material.y),1.0);
    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const uniforms = Object.fromEntries(["orbit", "view", "material", "floorPass"].map(key => [key, gl.getUniformLocation(program, key)]));
  const vertex = gl.createBuffer(), triangles = gl.createBuffer(), floor = gl.createBuffer();
  let count = 0;
  function useVertex(buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  }
  return {
    upload(next, support) {
      let points = next.vertices;
      let indices = next.triangles;
      if (support) {
        points = new Float32Array(next.vertices.length + support.vertices.length);
        points.set(next.vertices);
        points.set(support.vertices, next.vertices.length);
        indices = new Uint32Array(next.triangles.length + support.triangles.length);
        indices.set(next.triangles);
        const offset = next.vertices.length / 4;
        for (let i = 0; i < support.triangles.length; i++) indices[next.triangles.length + i] = support.triangles[i] + offset;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
      gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangles);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      count = indices.length;
      const edge = Math.max(next.options.width, next.options.height) * 3;
      const bottom = (support?.bedY ?? -next.options.height / 2) - 1.4;
      gl.bindBuffer(gl.ARRAY_BUFFER, floor);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -edge, bottom, -edge, 0, -edge, bottom, edge, 0, edge, bottom, -edge, 0,
        edge, bottom, -edge, 0, -edge, bottom, edge, 0, edge, bottom, edge, 0
      ]), gl.STATIC_DRAW);
    },
    draw() {
      const pixelRatio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * pixelRatio), height = Math.round(canvas.clientHeight * pixelRatio);
      if (!width || !height) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.uniform4f(uniforms.orbit, Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch));
      const aspect = width / height;
      const fit = 4.5 * camera.zoom * Math.min(1, aspect);
      gl.uniform4f(uniforms.view, 1 / Math.max(mesh.options.width, mesh.options.height), fit / aspect, fit, 0);
      gl.uniform4f(uniforms.material, Number($("light").value) / 100, Number(backlight), 0, 0);
      useVertex(vertex);
      gl.uniform1i(uniforms.floorPass, 0);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
      if (camera.pitch < -0.18) return;
      useVertex(floor);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(uniforms.floorPass, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND);
    }
  };
}

function redraw() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { if (mesh) renderer?.draw(); });
}

function chooseShape(key) {
  shape = key;
  for (const button of $("shapes").children) button.setAttribute("aria-pressed", String(button.dataset.shape === key));
  const selected = profiles[key];
  $("lamp-toggle").hidden = !LampMount.supports(key);
  $("lamp-unavailable").hidden = LampMount.supports(key);
  $("lamp-options").hidden = !LampMount.supports(key) || !$("lamp-enabled").checked;
  $("lamp-join").hidden = !LampMount.supportsJoined(key);
  $("width-caption").textContent = key === "flat" ? "Ancho" : "Diámetro base";
  $("shape-note").hidden = !shapeNotes[key];
  $("shape-note").textContent = shapeNotes[key] ?? "";
  for (const vessel of vesselShapes) $(vessel + "-profile-field").hidden = vessel !== key;
  for (const field of ["sides", "top", ...shapeFields]) {
    $(field + "-field").hidden = selected.field !== field;
    if (selected.field !== field && (!$(field).validity.valid || !$(field).value)) {
      $(field).value = field === "sides" ? polygonFaces : $(field).defaultValue;
    }
  }
  renderSlots();
  regenerate();
}

function readPresets() {
  const stored = JSON.parse(localStorage.getItem(presetKey) ?? "[]");
  if (!Array.isArray(stored)) return [];
  return stored.filter(preset => preset && typeof preset.name === "string" &&
    Object.hasOwn(profiles, preset.shape) && preset.values &&
    presetFields.every(id => typeof preset.values[id] === "string"));
}

function updatePresetButtons() {
  const selected = Boolean($("preset-list").value);
  $("preset-load").disabled = !selected;
  $("preset-remove").disabled = !selected;
}

function showPresets(presets, selected = "") {
  const list = $("preset-list");
  list.replaceChildren(new Option("Seleccionar", ""));
  for (const preset of presets) list.add(new Option(preset.name, preset.name));
  list.value = presets.some(preset => preset.name === selected) ? selected : "";
  updatePresetButtons();
}

function refreshPresets() {
  try {
    showPresets(readPresets(), $("preset-list").value);
  } catch {
    $("preset-status").textContent = "No se pudo acceder a los preajustes de este navegador.";
  }
}

function writePresets(presets, selected, message) {
  localStorage.setItem(presetKey, JSON.stringify(presets));
  showPresets(presets, selected);
  $("preset-status").textContent = message;
}

$("preset-form").onsubmit = event => {
  event.preventDefault();
  const name = $("preset-name").value.trim();
  if (!name) {
    $("preset-status").textContent = "Escribe un nombre para el preajuste.";
    return;
  }
  const lamp = LampMount.supports(shape) && $("lamp-enabled").checked;
  try {
    settings();
    if (lamp && !mountMesh) throw new Error("Revisa las medidas del soporte antes de guardar.");
  } catch (error) {
    $("preset-status").textContent = error.message;
    return;
  }
  try {
    const presets = readPresets();
    const previous = presets.findIndex(preset => preset.name === name);
    const fields = [...presetFields, ...borderFields, ...shapeFields, ...vesselShapes.map(key => key + "-profile")];
    const values = Object.fromEntries(fields.map(id => {
      const control = $(id);
      return [id, control.validity.valid && control.value ? control.value : control.defaultValue];
    }));
    const preset = { name, shape, lamp, backlight, border: $("border-enabled").checked, photoPositions, values };
    if (previous < 0) presets.push(preset);
    else presets[previous] = preset;
    writePresets(presets, name, previous < 0 ? "Preajuste guardado." : "Preajuste actualizado.");
  } catch {
    $("preset-status").textContent = "No se pudo guardar el preajuste en este navegador.";
  }
};

$("preset-list").onchange = updatePresetButtons;
$("preset-load").onclick = () => {
  try {
    const preset = readPresets().find(item => item.name === $("preset-list").value);
    if (!preset) { refreshPresets(); return; }
    for (const id of presetFields) $(id).value = preset.values[id];
    for (const id of [...borderFields, ...shapeFields]) $(id).value = preset.values[id] ?? $(id).defaultValue;
    for (const key of vesselShapes) {
      const id = key + "-profile";
      const variant = preset.values[id];
      $(id).value = Object.hasOwn(profiles[key].variants, variant) ? variant : $(id).options[0].value;
    }
    $("border-enabled").checked = preset.border === true;
    polygonFaces = $("sides").valueAsNumber;
    for (const key of Object.keys(photoPositions)) {
      const count = preset.photoPositions?.[key] ?? (key === "cylinder" ? preset.cylinderPhotos : 1);
      photoPositions[key] = Number.isSafeInteger(count) && count > 0 ? count : 1;
    }
    $("lamp-enabled").checked = preset.lamp === true;
    $("preset-name").value = preset.name;
    $("light-value").textContent = $("light").value + " %";
    lighting(preset.backlight === true);
    chooseShape(preset.shape);
    $("preset-status").textContent = "Preajuste cargado. Ya puedes añadir tus fotos.";
  } catch {
    $("preset-status").textContent = "No se pudo cargar el preajuste.";
  }
};

$("preset-remove").onclick = () => {
  try {
    const name = $("preset-list").value;
    writePresets(readPresets().filter(preset => preset.name !== name), "", "Preajuste borrado.");
    if ($("preset-name").value === name) $("preset-name").value = "";
  } catch {
    $("preset-status").textContent = "No se pudo borrar el preajuste.";
  }
};

window.addEventListener("storage", event => {
  if (event.key === presetKey || event.key === null) refreshPresets();
});

async function importPhotos(files) {
  if (!files.length) return;
  const version = ++importVersion;
  if (shape === "flat" && files.length > 1) {
    $("flat-photos").value = Math.max(panelCount(), Math.min(3, files.length));
  }
  if (Object.hasOwn(photoPositions, shape)) photoPositions[shape] = Math.max(photoPositions[shape], files.length);
  const capacity = panelCount();
  const start = files.length === 1 ? activePhoto : 0;
  const selected = files.slice(0, capacity - start);
  if (files.length > 1) activePhoto = 0;
  const results = await Promise.all(selected.map(async (file, offset) => {
    const index = start + offset;
    pendingImports[index] = version;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (pendingImports[index] !== version) return "superseded";
      photos[index] = setImage(image, file.name);
      return "loaded";
    } catch {
      return "failed";
    } finally {
      URL.revokeObjectURL(url);
    }
  }));
  renderSlots();
  regenerate();
  if (version !== importVersion || $("export").disabled) return;
  const loaded = results.filter(result => result === "loaded").length;
  const failed = results.filter(result => result === "failed").length;
  const skipped = files.length - selected.length;
  const feedback = [];
  if (loaded) feedback.push(loaded === 1 ? "1 foto cargada" : loaded + " fotos cargadas");
  if (failed) feedback.push(failed + " archivos sin abrir. Prueba con JPG, PNG o WebP.");
  if (skipped) feedback.push(skipped + " archivos fuera del límite (" + capacity + ")");
  if (feedback.length) $("status").textContent = feedback.join(" · ");
}

for (const [key, profile] of Object.entries(profiles)) {
  const button = document.createElement("button");
  button.dataset.shape = key;
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = profile.icon;
  button.append(icon, profile.label);
  button.addEventListener("click", () => chooseShape(key));
  $("shapes").append(button);
}
for (const key of vesselShapes) {
  const select = $(key + "-profile");
  for (const [value, variant] of Object.entries(profiles[key].variants)) select.add(new Option(variant.label, value));
  select.onchange = () => { showPhoto(); regenerate(); };
}
for (const id of [...controls, ...shapeFields]) $(id).addEventListener("input", () => {
  if (id === "sides" && $("sides").value && $("sides").validity.valid) {
    polygonFaces = $("sides").valueAsNumber;
    renderSlots();
  }
  if (profiles[shape].preserveAspect && ["width", "height", "arc-angle"].includes(id)) showPhoto();
  regenerate();
});
$("flat-photos").onchange = () => { renderSlots(); regenerate(); };
$("wrap-add").onclick = () => {
  activePhoto = photoPositions[shape]++;
  renderSlots();
  regenerate();
};
$("wrap-remove").onclick = () => {
  if (photoPositions[shape] <= 1) return;
  photoPositions[shape]--;
  renderSlots();
  regenerate();
};
for (const id of ["border-enabled", ...borderFields]) $(id).addEventListener("input", regenerate);
function editImage() {
  const photo = photos[activePhoto];
  if (!photo) return;
  for (const id of photoControls) photo[id] = $(id).valueAsNumber;
  photo.invert = $("invert").checked;
  updateImage(photo);
  showPhoto();
  regenerate();
}
for (const id of [...photoControls, "invert"]) $(id).addEventListener("input", editImage);
$("rotate-image").onclick = () => {
  const photo = photos[activePhoto];
  photo.rotation = (photo.rotation + 1) % 4;
  editImage();
};
$("mirror-image").onclick = () => {
  const photo = photos[activePhoto];
  photo.mirrored = !photo.mirrored;
  editImage();
};
$("reset-image").onclick = () => {
  for (const id of photoControls) $(id).value = $(id).defaultValue;
  Object.assign(photos[activePhoto], { rotation: 0, mirrored: false });
  $("invert").checked = false;
  editImage();
};
for (const id of ["lamp-enabled", ...Object.values(mountControls)]) $(id).addEventListener("input", updateMount);
$("lamp-view").onclick = () => {
  Object.assign(camera, { ...initialCamera, pitch: -1.25 });
  redraw();
};
$("file").addEventListener("change", event => {
  importPhotos(Array.from(event.target.files));
  event.target.value = "";
});
const drop = $("drop");
drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", event => {
  event.preventDefault();
  drop.classList.remove("over");
  importPhotos(Array.from(event.dataTransfer.files));
});
$("remove-photo").onclick = () => {
  pendingImports[activePhoto] = ++importVersion;
  photos[activePhoto] = undefined;
  renderSlots();
  regenerate();
};
function lighting(enabled) {
  backlight = enabled;
  $("lit").setAttribute("aria-pressed", String(enabled));
  $("solid").setAttribute("aria-pressed", String(!enabled));
  $("light").disabled = !enabled;
  redraw();
}
$("solid").onclick = () => lighting(false);
$("lit").onclick = () => lighting(true);
$("light").oninput = event => {
  $("light-value").textContent = event.target.value + " %";
  redraw();
};
function zoom(factor) {
  camera.zoom = Math.max(0.45, Math.min(2.4, camera.zoom * factor));
  redraw();
}
function rotate(yaw, pitch) {
  camera.yaw += yaw;
  camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch + pitch));
  redraw();
}
$("closer").onclick = () => zoom(1.17);
$("farther").onclick = () => zoom(1 / 1.17);
$("home").onclick = () => { Object.assign(camera, initialCamera); redraw(); };
let drag;
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || drag) return;
  canvas.setPointerCapture(event.pointerId);
  drag = event;
});
canvas.addEventListener("pointermove", event => {
  if (drag?.pointerId !== event.pointerId) return;
  rotate((event.clientX - drag.clientX) * 0.009, (event.clientY - drag.clientY) * 0.009);
  drag = event;
});
canvas.addEventListener("lostpointercapture", () => { drag = null; });
canvas.addEventListener("wheel", event => { event.preventDefault(); zoom(Math.exp(-event.deltaY * 0.001)); }, { passive: false });
canvas.addEventListener("keydown", event => {
  const actions = {
    ArrowLeft: () => rotate(-0.1, 0), ArrowRight: () => rotate(0.1, 0),
    ArrowUp: () => rotate(0, -0.1), ArrowDown: () => rotate(0, 0.1),
    "+": () => zoom(1.17), "-": () => zoom(1 / 1.17)
  };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
});
function downloadMesh(object, name, label) {
  const url = URL.createObjectURL(new Blob([stl(object)], { type: "model/stl" }));
  const link = document.createElement("a");
  link.download = name + ".stl";
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  $("status").textContent = label + " · " + new Intl.NumberFormat("es").format(object.triangles.length / 3) + " triángulos";
}
function exportName() {
  const visible = photos.slice(0, panelCount()).filter(Boolean);
  if (visible.length > 1) return visible.length + "-fotos";
  return visible[0]?.label.replace(/\.[^.]+$/, "") || "litofania";
}
$("export").onclick = () => {
  try {
    downloadMesh(buildPhotoMesh(settings(), 380), `litum3d-${exportName()}-${shape}`, "Litofanía STL preparada");
  } catch (error) {
    $("status").textContent = error.message;
  }
};
$("lamp-export").onclick = () => {
  if (mountMesh) downloadMesh(mountMesh, `litum3d-soporte-${exportName()}-${shape}`, "Soporte STL preparado");
};
$("lamp-join").onclick = () => {
  try {
    const shade = settings();
    const options = mountSettings();
    const mount = LampMount.build(shade, options, true);
    const screen = buildPhotoMesh(shade, 380, mount.connection);
    const joined = LampMount.join(screen, mount);
    downloadMesh(joined, `litum3d-lampara-${exportName()}-${shape}`, "Pieza unida STL preparada");
  } catch (error) {
    $("status").textContent = error.message;
  }
};
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  renderer = null;
  regenerate();
});
function startViewer() {
  try { renderer = createRenderer(); } catch (error) { console.error(error); }
}
canvas.addEventListener("webglcontextrestored", () => { startViewer(); regenerate(); });
new ResizeObserver(redraw).observe(canvas);
startViewer();
photos[0] = setImage(landscape(), "Montañas · Ejemplo");
chooseShape(shape);
refreshPresets();

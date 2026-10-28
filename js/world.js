import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, smoothstep, createNoise, mulberry32 } from './utils.js';

const SUN_DIR = new THREE.Vector3(0.45, 0.55, 0.62).normalize();

function makeCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const random = mulberry32(7719);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 34; i++) {
    const x = 90 + random() * 330;
    const y = 90 + random() * 80;
    const r = 28 + random() * 74;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.45, 'rgba(255,252,246,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWaterNormalTexture(noise) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const sample = (x, y) => noise.fbm(x * 0.075, y * 0.075, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      const nx = -dx * 6;
      const ny = -dy * 6;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const index = (y * size + x) * 4;
      image.data[index] = ((nx / length) * 0.5 + 0.5) * 255;
      image.data[index + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      image.data[index + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(70, 70);
  return texture;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.size = 6000;
    this.half = this.size / 2;
    this.segments = 240;
    this.waterLevel = 0;
    this.noise = createNoise(20261027);
    this.runway = { x: 0, z: 0, width: 38, length: 440, altitude: 42 };
    this.cloudGroups = [];
    this.spawn = { position: new THREE.Vector3(0, 292, 250), heading: 0 };

    this._buildEnvironment();
    this._buildTerrain();
    this._buildWater();
    this._buildAirport();
    this._buildTrees();
    this._buildClouds();
    this._buildMap();
  }

  // ---------------------------------------------------------------------------
  // Terreno
  // ---------------------------------------------------------------------------

  heightAt(x, z) {
    const noise = this.noise;
    const warpX = noise.fbm(x * 0.00034 + 11.3, z * 0.00034 - 7.7, 3);
    const warpZ = noise.fbm(x * 0.00034 - 5.1, z * 0.00034 + 3.9, 3);
    const base = noise.fbm(x * 0.00112 + warpX * 0.4, z * 0.00112 + warpZ * 0.4, 6);
    const ridge =
      1 - Math.abs(noise.fbm(x * 0.0026 + 40.2, z * 0.0026 - 17.6, 4) * 2 - 1);

    let height = (base - 0.5) * 520 + 18 + Math.pow(ridge, 2.2) * 390;

    // La isla se hunde suavemente en el mar en los bordes del mundo.
    const distance = Math.hypot(x, z) / 2900;
    height -= smoothstep(0.72, 1.3, distance) * 320;

    // Meseta del aeródromo.
    const airport = smoothstep(300, 620, Math.hypot(x, z));
    height = lerp(this.runway.altitude, height, airport);

    return height;
  }

  _slopeAtFromData(heights, index, i, j, step) {
    const n = this.segments + 1;
    const left = heights[j * n + Math.max(0, i - 1)];
    const right = heights[j * n + Math.min(this.segments, i + 1)];
    const down = heights[Math.max(0, j - 1) * n + i];
    const up = heights[Math.min(this.segments, j + 1) * n + i];
    return Math.hypot((right - left) / (2 * step), (up - down) / (2 * step));
  }

  _buildTerrain() {
    const n = this.segments;
    const step = this.size / n;
    const count = (n + 1) * (n + 1);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const heights = new Float32Array(count);
    const indices = new Uint32Array(n * n * 6);

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const index = j * (n + 1) + i;
        const x = -this.half + i * step;
        const z = -this.half + j * step;
        const y = this.heightAt(x, z);
        heights[index] = y;
        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = z;
      }
    }

    const sand = new THREE.Color(0xd0bd8a);
    const seabed = new THREE.Color(0x355b55);
    const grass = new THREE.Color(0x557a38);
    const grassDark = new THREE.Color(0x3e6330);
    const dry = new THREE.Color(0x8a8652);
    const rock = new THREE.Color(0x716d63);
    const snow = new THREE.Color(0xe7edf2);
    const color = new THREE.Color();

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const index = j * (n + 1) + i;
        const h = heights[index];
        const slope = this._slopeAtFromData(heights, index, i, j, step);

        if (h < -1) {
          color.copy(sand).lerp(seabed, clamp(-h / 55, 0, 0.92));
        } else if (h < 16) {
          color.copy(sand).lerp(dry, smoothstep(5, 16, h) * 0.35);
        } else if (h < 130) {
          color.copy(grassDark).lerp(grass, smoothstep(20, 90, h));
          color.lerp(dry, clamp((h - 75) / 90, 0, 0.4));
        } else if (h < 245) {
          color.copy(grass).lerp(rock, smoothstep(130, 245, h));
        } else if (h < 355) {
          color.copy(rock);
        } else {
          color.copy(rock).lerp(snow, smoothstep(355, 430, h));
        }

        if (slope > 0.48) color.lerp(rock, clamp((slope - 0.48) * 1.15, 0, 0.8));

        const variation = 0.9 + this.noise.fbm(-4000 + i * 0.31, -4000 + j * 0.31, 3) * 0.2;
        color.multiplyScalar(variation);
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
      }
    }

    let pointer = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        indices[pointer++] = a;
        indices[pointer++] = c;
        indices[pointer++] = b;
        indices[pointer++] = b;
        indices[pointer++] = c;
        indices[pointer++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
      envMapIntensity: 0.3,
    });

    this.terrain = new THREE.Mesh(geometry, material);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    this.heights = heights;
    this.grid = n + 1;
  }

  // ---------------------------------------------------------------------------
  // Cielo, luz y agua
  // ---------------------------------------------------------------------------

  _buildEnvironment() {
    this.scene.fog = new THREE.FogExp2(0xc8d4da, 0.00016);

    const skyGeometry = new THREE.SphereGeometry(9000, 32, 18);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2e5f96) },
        horizonColor: { value: new THREE.Color(0xf2c690) },
        sunColor: { value: new THREE.Color(0xfff0c9) },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        varying vec3 vDirection;
        void main() {
          vec3 dir = normalize(vDirection);
          float heightMix = clamp(dir.y, 0.0, 1.0);
          vec3 color = mix(horizonColor, topColor, pow(heightMix, 0.42));
          float sun = pow(max(dot(dir, sunDir), 0.0), 420.0);
          float glow = pow(max(dot(dir, sunDir), 0.0), 9.0);
          color += sunColor * (sun * 1.6 + glow * 0.16);
          color = mix(color, vec3(0.90, 0.82, 0.70), pow(1.0 - heightMix, 10.0) * 0.32);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x4a4633, 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffe2b0, 2.35);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 1400;
    this.sunLight.shadow.camera.left = -260;
    this.sunLight.shadow.camera.right = 260;
    this.sunLight.shadow.camera.top = 260;
    this.sunLight.shadow.camera.bottom = -260;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.6;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Pequeña luz de relleno para que el avión no quede a contraluz.
    this.fillLight = new THREE.DirectionalLight(0x9ac7ff, 0.35);
    this.fillLight.position.set(0.6, 0.35, 0.8);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);
  }

  _buildWater() {
    const normalMap = makeWaterNormalTexture(this.noise);
    const material = new THREE.MeshStandardMaterial({
      color: 0x174d60,
      metalness: 0.42,
      roughness: 0.24,
      normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      transparent: true,
      opacity: 0.94,
    });
    const geometry = new THREE.PlaneGeometry(14000, 14000, 1, 1);
    this.water = new THREE.Mesh(geometry, material);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = this.waterLevel;
    this.water.receiveShadow = false;
    this.waterNormalMap = normalMap;
    this.scene.add(this.water);
  }

  // ---------------------------------------------------------------------------
  // Aeródromo
  // ---------------------------------------------------------------------------

  _buildAirport() {
    const group = new THREE.Group();
    const alt = this.runway.altitude;
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.88 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x77796f, roughness: 0.95 });
    const white = new THREE.MeshBasicMaterial({ color: 0xd9d9cf });
    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x39434a,
      metalness: 0.55,
      roughness: 0.4,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x8fcfdf,
      metalness: 0.2,
      roughness: 0.12,
      transparent: true,
      opacity: 0.75,
    });

    const runway = new THREE.Mesh(
      new THREE.BoxGeometry(this.runway.width, 0.6, this.runway.length),
      asphalt
    );
    runway.position.set(0, alt + 0.25, 0);
    runway.receiveShadow = true;
    group.add(runway);

    const apron = new THREE.Mesh(new THREE.BoxGeometry(150, 0.4, 110), concrete);
    apron.position.set(110, alt + 0.22, 30);
    apron.receiveShadow = true;
    group.add(apron);

    // Líneas de eje.
    for (let z = -190; z <= 190; z += 26) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 12), white);
      dash.position.set(0, alt + 0.57, z);
      group.add(dash);
    }

    // Umbrales y bordes.
    for (let i = -4; i <= 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 10), white);
      bar.position.set(i * 3.5, alt + 0.57, -205);
      group.add(bar);
      const bar2 = bar.clone();
      bar2.position.z = 205;
      group.add(bar2);
    }
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 430), white);
      edge.position.set(side * (this.runway.width / 2 - 1.2), alt + 0.57, 0);
      group.add(edge);
    }

    // Balizas.
    const lightGeometry = new THREE.SphereGeometry(0.45, 6, 5);
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffc86b });
    const lightCount = 22;
    const lights = new THREE.InstancedMesh(lightGeometry, lightMaterial, lightCount * 2);
    const dummy = new THREE.Object3D();
    let lightIndex = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < lightCount; i++) {
        const z = -this.runway.length / 2 + 10 + (i * (this.runway.length - 20)) / (lightCount - 1);
        dummy.position.set(side * (this.runway.width / 2 + 1), alt + 0.9, z);
        dummy.updateMatrix();
        lights.setMatrixAt(lightIndex++, dummy.matrix);
      }
    }
    lights.instanceMatrix.needsUpdate = true;
    group.add(lights);

    // Hangares.
    for (const [x, z, rotation] of [
      [122, -40, 0],
      [122, 115, 0],
    ]) {
      const hangar = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(52, 16, 36), darkMetal);
      body.position.y = 8;
      body.castShadow = true;
      body.receiveShadow = true;
      hangar.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(55, 1.2, 39), concrete);
      roof.position.y = 16.4;
      roof.castShadow = true;
      hangar.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 12, 28), asphalt);
      door.position.set(-26.2, 6, 0);
      hangar.add(door);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 30), new THREE.MeshBasicMaterial({ color: 0xd6a33d }));
      stripe.position.set(-26.5, 12.5, 0);
      hangar.add(stripe);
      hangar.position.set(x, alt, z);
      hangar.rotation.y = rotation;
      group.add(hangar);
    }

    // Torre de control.
    const tower = new THREE.Group();
    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.4, 28, 10), concrete);
    towerBase.position.y = 14;
    towerBase.castShadow = true;
    tower.add(towerBase);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), glass);
    cabin.position.y = 30;
    tower.add(cabin);
    const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.8, 11.5), darkMetal);
    cabinRoof.position.y = 32.9;
    tower.add(cabinRoof);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 5), darkMetal);
    antenna.position.y = 37.8;
    tower.add(antenna);
    tower.position.set(-105, alt, 168);
    group.add(tower);

    // Manga de viento.
    const windsock = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 9, 6),
      new THREE.MeshStandardMaterial({ color: 0xddd8c8 })
    );
    pole.position.y = 4.5;
    windsock.add(pole);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 5.2, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xf06a35,
        roughness: 0.8,
        side: THREE.DoubleSide,
      })
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(-2.6, 8.4, 0);
    windsock.add(sock);
    windsock.position.set(38, alt, -192);
    this.windsock = windsock;
    group.add(windsock);

    // Un par de casetas junto a la pista.
    for (const [x, z, sx, sz] of [
      [-45, -110, 12, 9],
      [55, 176, 9, 7],
    ]) {
      const shed = new THREE.Mesh(new THREE.BoxGeometry(sx, 4.5, sz), concrete);
      shed.position.set(x, alt + 2.25, z);
      shed.castShadow = true;
      shed.receiveShadow = true;
      group.add(shed);
      const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(sx + 1.5, 0.5, sz + 1.5), darkMetal);
      shedRoof.position.set(x, alt + 4.7, z);
      group.add(shedRoof);
    }

    this.scene.add(group);
    this.airport = group;
  }

  // ---------------------------------------------------------------------------
  // Vegetación y rocas
  // ---------------------------------------------------------------------------

  _buildTrees() {
    const random = mulberry32(998123);
    const maxTrees = 2400;
    const trunkGeometry = new THREE.CylinderGeometry(0.24, 0.48, 3, 5);
    const foliageGeometry = new THREE.ConeGeometry(2.2, 8, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x59412c, roughness: 1 });
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, maxTrees);
    const foliage = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, maxTrees);
    trunks.frustumCulled = false;
    foliage.frustumCulled = false;
    trunks.receiveShadow = true;
    foliage.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const green = new THREE.Color();
    let placed = 0;
    let attempts = 0;
    while (placed < maxTrees && attempts < maxTrees * 8) {
      attempts++;
      const x = (random() * 2 - 1) * 2850;
      const z = (random() * 2 - 1) * 2850;
      const h = this.heightAt(x, z);
      if (h < 14 || h > 205) continue;
      if (Math.hypot(x, z) < 520) continue;
      if (this._roughSlope(x, z) > 0.55) continue;
      const scale = 0.65 + random() * 1.15;
      const rotation = random() * Math.PI * 2;

      dummy.position.set(x, h + 1.5 * scale, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);

      dummy.position.y = h + 6.1 * scale;
      dummy.updateMatrix();
      foliage.setMatrixAt(placed, dummy.matrix);

      green.setHSL(0.26 + random() * 0.05, 0.33 + random() * 0.18, 0.19 + random() * 0.11);
      foliage.setColorAt(placed, green);
      placed++;
    }

    trunks.count = placed;
    foliage.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    this.scene.add(trunks, foliage);

    // Rocas en laderas altas.
    const rockCount = 280;
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x77746b, roughness: 0.95 });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
    rocks.frustumCulled = false;
    let rockIndex = 0;
    attempts = 0;
    while (rockIndex < rockCount && attempts < 5000) {
      attempts++;
      const x = (random() * 2 - 1) * 2800;
      const z = (random() * 2 - 1) * 2800;
      const h = this.heightAt(x, z);
      if (h < 150) continue;
      const scale = 2 + random() * 8;
      dummy.position.set(x, h + scale * 0.25, z);
      dummy.rotation.set(random() * 3, random() * 3, random() * 3);
      dummy.scale.set(scale, scale * (0.5 + random() * 0.5), scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockIndex++, dummy.matrix);
    }
    rocks.count = rockIndex;
    rocks.instanceMatrix.needsUpdate = true;
    this.scene.add(rocks);
  }

  _roughSlope(x, z) {
    const sample = 40;
    const dx = this.heightAt(x + sample, z) - this.heightAt(x - sample, z);
    const dz = this.heightAt(x, z + sample) - this.heightAt(x, z - sample);
    return Math.hypot(dx, dz) / (sample * 2);
  }

  _buildClouds() {
    const texture = makeCloudTexture();
    const random = mulberry32(4711);
    for (let i = 0; i < 30; i++) {
      const group = new THREE.Group();
      const pieces = 2 + Math.floor(random() * 3);
      for (let p = 0; p < pieces; p++) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0.34 + random() * 0.26,
          depthWrite: false,
          fog: true,
          color: 0xfff8ee,
        });
        const sprite = new THREE.Sprite(material);
        const width = 320 + random() * 420;
        sprite.scale.set(width, width * (0.34 + random() * 0.16), 1);
        sprite.position.set((random() - 0.5) * width * 0.9, (random() - 0.5) * 40, (random() - 0.5) * width * 0.4);
        group.add(sprite);
      }
      group.position.set(
        (random() * 2 - 1) * 3400,
        430 + random() * 480,
        (random() * 2 - 1) * 3400
      );
      group.userData.speed = 3 + random() * 7;
      this.cloudGroups.push(group);
      this.scene.add(group);
    }
  }

  _buildMap() {
    const size = this.grid;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    const sea = [18, 60, 72];
    const sand = [196, 179, 133];
    const grass = [72, 105, 60];
    const rock = [112, 107, 97];
    const snow = [226, 233, 239];

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const h = this.heights[j * size + i];
        const left = this.heights[j * size + Math.max(0, i - 1)];
        const right = this.heights[j * size + Math.min(size - 1, i + 1)];
        const shade = clamp(1 + (right - left) * 0.004, 0.78, 1.16);
        let rgb;
        if (h < 0) rgb = sea;
        else if (h < 18) rgb = sand;
        else if (h < 210) rgb = grass;
        else if (h < 380) rgb = rock;
        else rgb = snow;
        const index = (j * size + i) * 4;
        image.data[index] = clamp(rgb[0] * shade, 0, 255);
        image.data[index + 1] = clamp(rgb[1] * shade, 0, 255);
        image.data[index + 2] = clamp(rgb[2] * shade, 0, 255);
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    this.mapCanvas = canvas;
  }

  // ---------------------------------------------------------------------------
  // Consultas y actualización
  // ---------------------------------------------------------------------------

  groundHeightAt(x, z) {
    return Math.max(this.waterLevel, this.heightAt(x, z));
  }

  isOnRunway(x, z) {
    return (
      Math.abs(x - this.runway.x) < this.runway.width / 2 + 6 &&
      Math.abs(z - this.runway.z) < this.runway.length / 2 + 12
    );
  }

  getSpawn() {
    const position = this.spawn.position.clone();
    position.y = this.groundHeightAt(position.x, position.z) + 235;
    return { position, heading: this.spawn.heading };
  }

  update(dt, elapsed, camera) {
    if (this.sky) this.sky.position.copy(camera.position);

    if (this.waterNormalMap) {
      this.waterNormalMap.offset.x = elapsed * 0.006;
      this.waterNormalMap.offset.y = elapsed * 0.0035;
    }

    for (const cloud of this.cloudGroups) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 3600) cloud.position.x = -3600;
    }

    if (this.windsock) {
      this.windsock.rotation.y = Math.sin(elapsed * 0.7) * 0.12;
    }

    if (this.airport) {
      // Parpadeo suave de las balizas.
      const pulse = 0.85 + Math.sin(elapsed * 3) * 0.15;
      this.airport.children.forEach((child) => {
        if (child.isInstancedMesh) child.material.opacity = pulse;
      });
    }
  }
}

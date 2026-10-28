import * as THREE from '../vendor/three.module.js';
import { clamp, damp } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function shadowify(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = false;
    }
  });
}

export function createAircraftModel(bodyColor = 0xd7523e) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.35,
    roughness: 0.36,
  });
  const whiteMaterial = new THREE.MeshStandardMaterial({
    color: 0xeeeae0,
    metalness: 0.22,
    roughness: 0.42,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x272d33,
    metalness: 0.55,
    roughness: 0.4,
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x8bd8ec,
    metalness: 0.1,
    roughness: 0.06,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });

  // Fuselaje.
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 4.4, 8, 18), bodyMaterial);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.z = 0.25;
  group.add(fuselage);

  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 3.1, 6, 12), whiteMaterial);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, -0.38, 0.3);
  belly.scale.set(1, 0.7, 1);
  group.add(belly);

  // Cabina.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12), glassMaterial);
  canopy.scale.set(0.82, 0.55, 1.45);
  canopy.position.set(0, 0.62, -0.45);
  group.add(canopy);

  const canopyFrame = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 6, 20), darkMaterial);
  canopyFrame.rotation.x = Math.PI / 2;
  canopyFrame.position.set(0, 0.74, 0.15);
  group.add(canopyFrame);

  // Alas.
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.16, 2.15), whiteMaterial);
    wing.position.set(side * 3.05, 0.02, 0.05);
    wing.rotation.z = -side * 0.055;
    group.add(wing);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.19, 2.05), bodyMaterial);
    tip.position.set(side * 5.75, -0.13, 0.05);
    tip.rotation.z = -side * 0.055;
    group.add(tip);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 2.16), bodyMaterial);
    stripe.position.set(side * 4.1, 0.02, 0.05);
    stripe.rotation.z = -side * 0.055;
    group.add(stripe);

    const navLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3b30 : 0x35ff74 })
    );
    navLight.position.set(side * 5.98, -0.05, 0.05);
    group.add(navLight);
  }

  // Cola.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.7, 1.15), bodyMaterial);
  fin.position.set(0, 1.0, 2.45);
  fin.rotation.x = -0.16;
  group.add(fin);

  const finAccent = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.55, 1.0), whiteMaterial);
  finAccent.position.set(0, 1.55, 2.5);
  finAccent.rotation.x = -0.16;
  group.add(finAccent);

  const stabilizer = new THREE.Mesh(new THREE.BoxGeometry(4.15, 0.13, 1.0), whiteMaterial);
  stabilizer.position.set(0, 0.22, 2.65);
  group.add(stabilizer);

  for (const side of [-1, 1]) {
    const tailTip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.95), bodyMaterial);
    tailTip.position.set(side * 1.85, 0.22, 2.65);
    group.add(tailTip);
  }

  // Morro y hélice.
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.74, 0.75, 18), whiteMaterial);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.z = -2.55;
  group.add(cowl);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.65, 12), bodyMaterial);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -3.05;
  group.add(spinner);

  const propeller = new THREE.Group();
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2125, roughness: 0.5 });
  for (const rotation of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.55, 0.05), bladeMaterial);
    blade.rotation.z = rotation;
    propeller.add(blade);
  }
  propeller.position.z = -3.22;
  group.add(propeller);

  const blurDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.28, 28),
    new THREE.MeshBasicMaterial({
      color: 0xcfd8dc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  blurDisc.position.z = -3.22;
  group.add(blurDisc);

  // Tren de aterrizaje.
  const gearMaterial = new THREE.MeshStandardMaterial({ color: 0x888c8e, metalness: 0.7, roughness: 0.4 });
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 6), gearMaterial);
    strut.position.set(side * 1.32, -0.78, 0.2);
    strut.rotation.z = side * 0.1;
    group.add(strut);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12), wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.4, -1.27, 0.2);
    group.add(wheel);
  }

  const noseStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.75, 6), gearMaterial);
  noseStrut.position.set(0, -0.85, -1.95);
  group.add(noseStrut);
  const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 10), wheelMaterial);
  noseWheel.rotation.z = Math.PI / 2;
  noseWheel.position.set(0, -1.22, -1.95);
  group.add(noseWheel);

  const tailLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  tailLight.position.set(0, 0.55, 3.05);
  group.add(tailLight);

  shadowify(group);

  group.userData = {
    propeller,
    blurDisc,
    leftTip: new THREE.Vector3(-5.95, -0.05, 0.05),
    rightTip: new THREE.Vector3(5.95, -0.05, 0.05),
  };

  return group;
}

export class PlayerAircraft {
  constructor(scene, world) {
    this.world = world;
    this.group = createAircraftModel();
    scene.add(this.group);
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.throttle = 0.7;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.grounded = false;
    this.crashed = false;
    this.stalled = false;
    this.agl = 0;
    this.landingCooldown = 0;
    this.events = {};

    this._tmpForward = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpVec = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._initTrails(scene);
  }

  _initTrails(scene) {
    this.trailLength = 70;
    this.trailPoints = [
      Array.from({ length: this.trailLength }, () => new THREE.Vector3()),
      Array.from({ length: this.trailLength }, () => new THREE.Vector3()),
    ];
    this.trailLines = [];
    for (let i = 0; i < 2; i++) {
      const positions = new Float32Array(this.trailLength * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      scene.add(line);
      this.trailLines.push(line);
    }
  }

  reset(spawn) {
    this.position.copy(spawn.position);
    this.quaternion.setFromEuler(this._euler.set(0, spawn.heading, 0));
    this.velocity.set(0, 0, 0);
    this.speed = 92;
    this.throttle = 0.72;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.grounded = false;
    this.crashed = false;
    this.stalled = false;
    this.landingCooldown = 2;
    this.group.visible = true;
    this.trailLines.forEach((line) => {
      line.visible = true;
    });
    this.syncModel();
    this._resetTrails();
  }

  _resetTrails() {
    const left = this._tipPosition(this.group.userData.leftTip, this._tmpVec);
    const right = this._tipPosition(this.group.userData.rightTip, new THREE.Vector3());
    for (let i = 0; i < this.trailLength; i++) {
      this.trailPoints[0][i].copy(left);
      this.trailPoints[1][i].copy(right);
    }
    this._writeTrail(0);
    this._writeTrail(1);
  }

  _tipPosition(local, target) {
    return target.copy(local).applyQuaternion(this.quaternion).add(this.position);
  }

  _writeTrail(index) {
    const attribute = this.trailLines[index].geometry.getAttribute('position');
    const points = this.trailPoints[index];
    for (let i = 0; i < points.length; i++) {
      attribute.setXYZ(i, points[i].x, points[i].y, points[i].z);
    }
    attribute.needsUpdate = true;
    this.trailLines[index].geometry.computeBoundingSphere();
  }

  _shiftTrail(index) {
    const points = this.trailPoints[index];
    for (let i = points.length - 1; i > 0; i--) points[i].copy(points[i - 1]);
  }

  syncModel() {
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
  }

  update(dt, axes, elapsed) {
    if (this.crashed) return;

    const forward = this._tmpForward.copy(FORWARD).applyQuaternion(this.quaternion).normalize();
    const up = this._tmpUp.copy(UP).applyQuaternion(this.quaternion).normalize();
    const right = this._tmpRight.copy(RIGHT).applyQuaternion(this.quaternion).normalize();

    // Potencia.
    this.throttle = clamp(this.throttle + axes.throttleDelta * dt * 0.55, 0, 1);

    // Velocidad: empuje, resistencia y gravedad en el eje de morro.
    if (!this.grounded) {
      const thrust = this.throttle * 34;
      const drag = 0.00255 * this.speed * this.speed + (axes.brake ? 0.012 * this.speed * this.speed : 0);
      const gravityAlong = -9.81 * forward.y * 0.62;
      this.speed = clamp(this.speed + (thrust - drag + gravityAlong) * dt, 0, 142);
    } else {
      const thrust = this.throttle * 30;
      const friction = axes.brake ? 14 : 4.2;
      this.speed = clamp(this.speed + (thrust - friction - this.speed * 0.035) * dt, 0, 110);
    }

    if (this.grounded) {
      this._updateGround(dt, axes);
      this.syncModel();
      this._updateVisual(dt, elapsed);
      return;
    }

    // Control.
    const pitchTarget = axes.pitch * 0.95;
    const rollTarget = axes.roll * 2.35;
    const yawTarget = axes.yaw * 0.7;
    this.pitchRate = damp(this.pitchRate, pitchTarget, 7, dt);
    this.rollRate = damp(this.rollRate, rollTarget, 6.5, dt);
    this.yawRate = damp(this.yawRate, yawTarget, 6, dt);

    const bankTurn = -right.y * this.speed * 0.0036;
    const totalYaw = this.yawRate + bankTurn;

    this._tmpQuat.setFromAxisAngle(AXIS_X, this.pitchRate * dt);
    this.quaternion.multiply(this._tmpQuat);
    this._tmpQuat.setFromAxisAngle(AXIS_Z, -this.rollRate * dt);
    this.quaternion.multiply(this._tmpQuat);
    this._tmpQuat.setFromAxisAngle(AXIS_Y, -totalYaw * dt);
    this.quaternion.multiply(this._tmpQuat);

    this.stalled = this.speed < 52;
    if (this.stalled) {
      const intensity = 1 - this.speed / 52;
      this._tmpQuat.setFromAxisAngle(AXIS_X, -1.55 * intensity * dt);
      this.quaternion.multiply(this._tmpQuat);
      this._tmpQuat.setFromAxisAngle(AXIS_Z, Math.sin(elapsed * 7) * 0.25 * intensity * dt);
      this.quaternion.multiply(this._tmpQuat);
    }

    this.quaternion.normalize();

    // Velocidad y sustentación arcade.
    const lift = clamp(this.speed / 64, 0, 1);
    const knifeEdge = (1 - clamp(up.y, 0, 1)) * 17;
    const sink = Math.pow(1 - lift, 2) * 46 + knifeEdge;
    this.velocity.copy(forward).multiplyScalar(this.speed);
    this.velocity.y -= sink;

    // Borde del mundo.
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y > 2600) {
      this.position.y = 2600;
      this.velocity.y = Math.min(this.velocity.y, 0);
    }

    // Colisión con el terreno.
    const ground = this.world.groundHeightAt(this.position.x, this.position.z) + 1.9;
    this.agl = this.position.y - ground;
    if (this.position.y <= ground) {
      const sinkRate = -this.velocity.y;
      const upright = up.y > 0.82;
      const onRunway = this.world.isOnRunway(this.position.x, this.position.z);
      if (onRunway && upright && sinkRate < 9.5 && this.speed < 140 && this.landingCooldown <= 0) {
        this.position.y = ground;
        this.grounded = true;
        this.velocity.set(0, 0, 0);
        this.speed = Math.min(this.speed, 108);
        this.pitchRate = 0;
        this.rollRate = 0;
        this.yawRate = 0;
        const heading = Math.atan2(forward.x, -forward.z);
        this.quaternion.setFromEuler(this._euler.set(0, heading, 0));
        this.stalled = false;
        this.events.onLanding?.();
      } else {
        this.position.y = ground;
        this.crashed = true;
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        this.events.onCrash?.({
          x: this.position.x,
          y: this.position.y,
          z: this.position.z,
          speed: this.speed,
        });
      }
    }

    this.syncModel();
    this._updateVisual(dt, elapsed);
    this._updateTrails();

    this.landingCooldown = Math.max(0, this.landingCooldown - dt);
  }

  _updateGround(dt, axes) {
    this.landingCooldown = Math.max(0, this.landingCooldown - dt);
    const ground = this.world.groundHeightAt(this.position.x, this.position.z) + 1.9;
    this.position.y = ground;
    this.agl = 0;

    const forward = this._tmpForward.copy(FORWARD).applyQuaternion(this.quaternion).normalize();
    const heading = Math.atan2(forward.x, -forward.z);
    this.quaternion.setFromEuler(this._euler.set(0, heading, 0));
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.stalled = false;

    const steering = axes.yaw + axes.roll * 0.8;
    if (Math.abs(this.speed) > 2) {
      this._tmpQuat.setFromAxisAngle(AXIS_Y, -steering * 0.55 * dt);
      this.quaternion.multiply(this._tmpQuat);
    }

    this.position.addScaledVector(forward, this.speed * dt);
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z) + 1.9;

    if (this.speed > 46 && axes.pitch > 0.35 && this.throttle > 0.45) {
      this.grounded = false;
      this.position.y += 1.4;
      this._tmpQuat.setFromAxisAngle(AXIS_X, 0.09);
      this.quaternion.multiply(this._tmpQuat);
      this.landingCooldown = 1.2;
      this.events.onTakeoff?.();
    }

    if (this.speed < 0.4 && this.throttle < 0.05) this.speed = 0;
  }

  _updateVisual(dt, elapsed) {
    const userData = this.group.userData;
    userData.propeller.rotation.z += dt * (10 + this.throttle * 95);
    userData.blurDisc.material.opacity = this.throttle > 0.15 ? 0.06 + this.throttle * 0.13 : 0;
    this.group.traverse((child) => {
      if (child.isMesh && child.material && child.material.color) {
        const hex = child.material.color.getHex();
        if (hex === 0xff3b30 || hex === 0x35ff74 || hex === 0xffffff) {
          if (child.geometry && child.geometry.type === 'SphereGeometry') {
            child.visible = Math.sin(elapsed * 7 + (hex === 0xff3b30 ? 0 : 1.7)) > -0.55;
          }
        }
      }
    });
  }

  _updateTrails() {
    if (this.speed < 34 || this.grounded) {
      this._resetTrails();
      return;
    }
    const left = this._tipPosition(this.group.userData.leftTip, this._tmpVec);
    const right = this._tipPosition(this.group.userData.rightTip, new THREE.Vector3());
    const lastLeft = this.trailPoints[0][0];
    if (lastLeft.distanceToSquared(left) > 0.6 * 0.6) {
      this._shiftTrail(0);
      this.trailPoints[0][0].copy(left);
      this._writeTrail(0);
      this._shiftTrail(1);
      this.trailPoints[1][0].copy(right);
      this._writeTrail(1);
    }
  }
}

function makeLabelSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(7, 14, 20, 0.6)';
  ctx.beginPath();
  ctx.roundRect(20, 24, 472, 80, 24);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = '600 48px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#f6fbff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 18), 256, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(18, 4.5, 1);
  return sprite;
}

export class RemoteAircraft {
  constructor(scene, id, name, colorHex = 0x67c7d9) {
    this.id = id;
    this.name = name;
    this.color = new THREE.Color(colorHex);
    this.group = createAircraftModel(colorHex);
    scene.add(this.group);
    this.position = new THREE.Vector3(0, 260, 0);
    this.targetPosition = this.position.clone();
    this.quaternion = new THREE.Quaternion();
    this.targetQuaternion = new THREE.Quaternion();
    this.speed = 0;
    this.hasState = false;
    this.group.visible = false;
    this.label = makeLabelSprite(name, `#${this.color.getHexString()}`);
    this.label.visible = false;
    scene.add(this.label);
  }

  setState(position, quaternion, speed) {
    this.targetPosition.copy(position);
    this.targetQuaternion.copy(quaternion);
    this.speed = speed;
    if (!this.hasState) {
      this.hasState = true;
      this.position.copy(position);
      this.quaternion.copy(quaternion);
      this.group.visible = true;
      this.label.visible = true;
    }
  }

  update(dt, elapsed) {
    if (!this.hasState) return;
    const factor = 1 - Math.exp(-dt * 9);
    this.position.lerp(this.targetPosition, factor);
    this.quaternion.slerp(this.targetQuaternion, factor);
    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
    this.group.userData.propeller.rotation.z += dt * (8 + Math.min(this.speed, 120) * 0.8);
    this.group.userData.blurDisc.material.opacity = 0.1;
    this.label.position.copy(this.position);
    this.label.position.y += 5.4;
  }

  dispose(scene) {
    scene.remove(this.group);
    scene.remove(this.label);
    this.label.material.map?.dispose();
    this.label.material.dispose();
  }
}

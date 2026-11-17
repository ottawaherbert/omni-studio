import * as THREE from 'three';
import type { PrevisObject, PrevisPose, PrevisFrame } from '../../clients/previsClient';

type State = PrevisFrame['states'][string];
export interface ActorSupport { height: number; normal: THREE.Vector3; objectId: string }
export interface ActorMotion {
  distance?: number; direction?: THREE.Vector3;
  transition?: { from: PrevisPose; mix: number };
  support?: (point: THREE.Vector3, referenceY: number, maxStep: number) => ActorSupport | undefined;
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const up = v(0, 1, 0), forward = v(0, 0, 1);
const sides = ['left', 'right'] as const;
const sign = (side: typeof sides[number]) => side === 'left' ? -1 : 1;
/** A prop uses metre offsets and keeps its own dimensions, independent of actor body proportions. */
export function rigidSocketMatrix(socket: THREE.Object3D) {
  socket.updateWorldMatrix(true, false); const rotation = new THREE.Quaternion();
  for(let node:THREE.Object3D|null=socket;node;node=node.parent)rotation.premultiply(node.quaternion);
  return new THREE.Matrix4().compose(socket.getWorldPosition(new THREE.Vector3()),rotation,new THREE.Vector3(1,1,1));
}

function part(name: string, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
/** One stable, two-segment rig for every pose. Sole Y=0 is the authored support plane. */
export function createActorRig(object: PrevisObject) {
  const root = new THREE.Group(), body = new THREE.Group(); body.name = 'actor-body';
  root.userData.objectId = object.id; root.userData.actorRig = true;
  body.scale.set(object.size[0] / .6, object.size[1] / 1.8, object.size[2] / .4); root.add(body);
  const material = new THREE.MeshStandardMaterial({ color: object.color, roughness: .9 });
  body.add(part('pelvis', new THREE.SphereGeometry(.075, 12, 8), material));
  body.add(part('torso', new THREE.CylinderGeometry(.16, .13, 1, 12), material));
  body.add(part('neck', new THREE.CylinderGeometry(.055, .055, 1, 10), material));
  body.add(part('head', new THREE.SphereGeometry(.12, 16, 12), material));
  body.add(part('nose', new THREE.BoxGeometry(.035, .035, .065), material));
  const waist = new THREE.Object3D(); waist.name = 'socket:waist'; body.add(waist);
  for (const side of sides) {
    for (const [name, radius] of [['thigh', .065], ['shin', .05]] as const)
      body.add(part(`${name}:${side}`, new THREE.CylinderGeometry(radius, radius, 1, 10), material));
    body.add(part(`knee:${side}`, new THREE.SphereGeometry(.066, 10, 8), material));
    body.add(part(`ankle:${side}`, new THREE.SphereGeometry(.055, 10, 8), material));
    body.add(part(`shoulder:${side}`, new THREE.SphereGeometry(.075, 10, 8), material));
    const foot = part(`foot:${side}`, new THREE.BoxGeometry(.13, .09, .25), material);
    foot.geometry.computeBoundingBox(); foot.userData.soleOffset = -foot.geometry.boundingBox!.min.y;
    foot.userData.sole = true; body.add(foot);
    const arm = new THREE.Group(); arm.name = `arm:${side}`;
    arm.add(part(`upperArm:${side}`, new THREE.CylinderGeometry(.043, .043, 1, 10), material));
    arm.add(part(`forearm:${side}`, new THREE.CylinderGeometry(.038, .038, 1, 10), material));
    arm.add(part(`elbow:${side}`, new THREE.SphereGeometry(.045, 10, 8), material));
    arm.add(part(`hand:${side}`, new THREE.BoxGeometry(.075, .1, .055), material));
    const socket = new THREE.Object3D(); socket.name = `socket:${side}Hand`; arm.add(socket); body.add(arm);
  }
  updateActorRig(root, object, {}, 0); return root;
}

function segment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const delta = b.clone().sub(a); mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.y = Math.max(delta.length(), .001); mesh.quaternion.setFromUnitVectors(up, delta.normalize());
}
/** Analytic two-bone solve; clamping is reported rather than silently claiming a target was reached. */
function joint(a: THREE.Vector3, target: THREE.Vector3, upper: number, lower: number, pole: THREE.Vector3) {
  const delta = target.clone().sub(a), requested = delta.length();
  const distance = THREE.MathUtils.clamp(requested, Math.abs(upper - lower) + .0001, upper + lower - .0001);
  const direction = requested > 1e-8 ? delta.divideScalar(requested) : v(0, -1, 0);
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) bend.copy(v(0, 0, 1).cross(direction));
  if (bend.lengthSq() < 1e-8) bend.copy(v(1, 0, 0));
  bend.normalize(); const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  return { elbow: a.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along))),
    end: a.clone().addScaledVector(direction, distance), error: Math.abs(requested - distance) };
}

function posePoints(pose: PrevisPose, phase: number, stride: number, direction: THREE.Vector3) {
  const sitting = pose === 'sit', crouch = pose === 'crouch', kneel = pose === 'kneel', lean = pose === 'lean';
  const hip = sitting ? v(0, .525, -.06) : crouch ? v(0, .58, -.22) : kneel ? v(0, .44, .27) : v(0, .96, 0);
  const shoulders = hip.clone().add(lean ? v(0, .21, .43) : crouch ? v(0, .47, .14) : v(0, .51, .015));
  const head = shoulders.clone().add(lean ? v(0, .11, .18) : v(0, .21, .015));
  const feet = sides.map(side => {
    const s = sign(side), foot = v(s * .12, 0, sitting ? .42 : .06);
    if (pose === 'walk' || pose === 'run') {
      const p = ((phase + (s > 0 ? .5 : 0)) % 1 + 1) % 1, stance = .6;
      const travel = p < stance ? (.3 - p) * stride : (-.3 + .6 * (p - stance) / (1 - stance)) * stride;
      foot.addScaledVector(direction, travel);
      if (p >= stance) foot.y = Math.sin(Math.PI * (p - stance) / (1 - stance)) * (pose === 'run' ? .19 : .12);
    }
    return foot;
  });
  const hands = sides.map(side => {
    const s = sign(side);
    if (lean || sitting) return v(s * .25, 1.02, sitting ? .45 : .61);
    if (pose === 'reach') return v(s * .25, 1.25, .55);
    const hand = shoulders.clone().add(v(s * .27, -.54, .04));
    if (pose === 'walk' || pose === 'run') hand.z -= Math.sin(phase * Math.PI * 2) * s * .15;
    return hand;
  });
  return { hip, shoulders, head, feet, hands };
}

/** Deterministic at any sample time, including after scrubbing, cuts and resumed capture. */
export function updateActorRig(root: THREE.Group | THREE.Object3D, object: PrevisObject, state: State, time: number, motion: ActorMotion = {}) {
  const body = root.getObjectByName('actor-body')!; if (!body) return;
  const pose = state.pose || object.pose, scale = body.scale;
  const stride = (pose === 'run' ? 1.5 : 1.15) * scale.y;
  const phase = motion.distance === undefined ? time * (pose === 'run' ? 1.6 : .9) : motion.distance / stride;
  const direction = (motion.direction?.clone().normalize() || forward.clone()).divide(scale).multiplyScalar(scale.y);
  const points = posePoints(pose, phase, stride / scale.y, direction);
  const seat = (p: ReturnType<typeof posePoints>, name: PrevisPose) => { if (name === 'sit' && object.seatHeight !== undefined) { const delta = object.seatHeight / scale.y - .45; for (const key of ['hip','shoulders','head'] as const) p[key].y += delta; p.hands.forEach(h => h.y += delta); } };
  seat(points, pose);
  if (motion.transition && motion.transition.from !== pose) {
    const previous = posePoints(motion.transition.from, phase, stride / scale.y, direction);
    seat(previous, motion.transition.from);
    const mix = THREE.MathUtils.smoothstep(motion.transition.mix, 0, 1);
    for (const key of ['hip', 'shoulders', 'head'] as const) points[key].lerpVectors(previous[key], points[key], mix);
    for (let i = 0; i < 2; i++) { points.feet[i].lerpVectors(previous.feet[i], points.feet[i], mix); points.hands[i].lerpVectors(previous.hands[i], points.hands[i], mix); }
  }
  root.updateMatrixWorld(true); body.updateMatrixWorld(true);
  const inverse = body.matrixWorld.clone().invert(), supports: Array<ActorSupport | undefined> = [];
  const footNormals: THREE.Vector3[] = [], originalLift = points.feet.map(p => p.y);
  for (let i = 0; i < 2; i++) {
    const local = points.feet[i], world = local.clone().applyMatrix4(body.matrixWorld);
    const reference = root.getWorldPosition(new THREE.Vector3()).y;
    const support = motion.support?.(world, reference, object.grounding?.maxStep ?? .35); supports.push(support);
    if (support && object.grounding?.mode === 'surface') {
      world.y = support.height + originalLift[i] * scale.y;
      local.copy(world.applyMatrix4(inverse));
    }
    footNormals.push(support?.normal || up);
  }
  if (object.grounding?.mode === 'surface') {
    const delta = Math.max(...points.feet.map((p, i) => p.y - originalLift[i]));
    for (const key of ['hip', 'shoulders', 'head'] as const) points[key].y += delta;
    points.hands.forEach(p => p.y += delta);
  }
  if (pose === 'walk' || pose === 'run' || object.grounding?.mode === 'surface' && pose !== 'sit' && pose !== 'kneel') {
    // Preserve planted feet by lowering the pelvis, rather than stretching a leg or lifting its sole.
    const ceiling = Math.min(...points.feet.map((foot, i) => {
      const dx = points.hip.x + sign(sides[i]) * .12 - foot.x, dz = points.hip.z - (foot.z - .03);
      return foot.y + .13 + Math.sqrt(Math.max(0, .859 * .859 - dx * dx - dz * dz));
    }));
    const drop = Math.min(0, ceiling - points.hip.y);
    for (const key of ['hip', 'shoulders', 'head'] as const) points[key].y += drop;
    points.hands.forEach(p => p.y += drop);
  }
  root.userData.actorContacts = []; root.userData.actorReach = [];
  root.getObjectByName('pelvis')!.position.copy(points.hip);
  segment(root.getObjectByName('torso')!, points.hip.clone().add(v(0, .04, 0)), points.shoulders);
  segment(root.getObjectByName('neck')!, points.shoulders, points.head);
  root.getObjectByName('head')!.position.copy(points.head);
  root.getObjectByName('nose')!.position.copy(points.head).add(v(0, 0, .13));
  root.getObjectByName('socket:waist')!.position.copy(points.hip).add(v(.2, 0, 0));
  for (let i = 0; i < 2; i++) {
    const side = sides[i], s = sign(side), sole = points.feet[i], foot = root.getObjectByName(`foot:${side}`)!;
    const soleOffset = foot.userData.soleOffset as number;
    foot.position.copy(sole).add(v(0, soleOffset, 0)); foot.quaternion.identity();
    if (object.grounding?.mode === 'surface' && supports[i]) {
      const normal = footNormals[i].clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(body.matrixWorld).transpose()).normalize();
      foot.quaternion.setFromUnitVectors(up, normal);
      foot.position.copy(sole).add(v(0, soleOffset, 0).applyQuaternion(foot.quaternion));
    }
    const hip = points.hip.clone().add(v(s * .12, 0, 0)), ankle = sole.clone().add(v(0, .13, -.03));
    root.getObjectByName(`ankle:${side}`)!.position.copy(ankle);
    const leg = joint(hip, ankle, .43, .43, v(0, 0, 1));
    const mix = motion.transition ? THREE.MathUtils.smoothstep(motion.transition.mix, 0, 1) : 1;
    const kneelWeight = pose === 'kneel' ? mix : motion.transition?.from === 'kneel' ? 1 - mix : 0;
    const knee = leg.elbow.clone().lerp(v(s * .12, sole.y + .066, sole.z + .46), kneelWeight);
    knee.y=Math.max(knee.y,sole.y+.066);
    segment(root.getObjectByName(`thigh:${side}`)!, hip, knee);
    segment(root.getObjectByName(`shin:${side}`)!, knee, ankle);
    root.getObjectByName(`knee:${side}`)!.position.copy(knee);
    const grounded = originalLift[i] < 1e-7;
    root.userData.actorContacts.push({ side, grounded, supportId: supports[i]?.objectId, requested: sole.toArray() });
    if (pose !== 'kneel' && leg.error > .008) root.userData.actorReach.push({ part: `leg:${side}`, error: leg.error * scale.y });
    const arm = root.getObjectByName(`arm:${side}`)!, shoulder = points.shoulders.clone().add(v(s * .22, 0, 0));
    root.getObjectByName(`shoulder:${side}`)!.position.copy(shoulder);
    arm.position.copy(shoulder); arm.rotation.set(0, 0, 0);
    const target = state[side === 'left' ? 'leftHand' : 'rightHand'];
    const hand = target ? new THREE.Vector3(...target).divide(scale) : points.hands[i];
    const pole = state[side === 'left' ? 'leftElbow' : 'rightElbow'];
    const solve = joint(new THREE.Vector3(), hand.clone().sub(shoulder), .30, .29, pole ? new THREE.Vector3(...pole) : v(s * .7, -.6, -.25));
    segment(root.getObjectByName(`upperArm:${side}`)!, new THREE.Vector3(), solve.elbow);
    segment(root.getObjectByName(`forearm:${side}`)!, solve.elbow, solve.end);
    root.getObjectByName(`elbow:${side}`)!.position.copy(solve.elbow);
    const palm = root.getObjectByName(`hand:${side}`)!, socket = root.getObjectByName(`socket:${side}Hand`)!;
    palm.position.copy(solve.end); socket.position.copy(solve.end);
    const grip = state[side === 'left' ? 'leftHandRotation' : 'rightHandRotation'];
    palm.rotation.set(...(grip || [0, 0, 0])); socket.rotation.copy(palm.rotation);
    const legacy = state[side === 'left' ? 'leftArm' : 'rightArm'];
    if (!target && legacy) arm.rotation.set(...legacy);
    if (target && solve.error > .008) root.userData.actorReach.push({ part: `hand:${side}`, error: solve.error * scale.y, target });
  }
  body.updateMatrixWorld(true);
}

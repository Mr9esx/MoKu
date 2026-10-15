import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createAssemblyTransformControls } from "./assemblyTransformControls";
import {
  buildAssemblyModel,
  geometrySignature,
  transformPoint,
} from "../core/assemblyGeometry";
import {
  viewQuaternion,
  orientationPosition,
  interpolateViewQuaternion,
  dragViewQuaternion,
} from "./viewCubeGeometry";
import { weakSnap } from "../core/assemblyGuidance";
import type {
  Assembly,
  AssemblyAnalysis,
  AssemblyItem,
  PlacementCandidate,
  Rotation3,
  Vec3,
} from "../core/assemblyTypes";
import type { Project } from "../core/types";
import {
  disposeObject,
  visibleSnapTarget,
  type AssemblyReference,
} from "./assemblySceneUtils";

export type SceneState = {
  project: Project;
  assembly: Assembly;
  selected: string | null;
  candidates: PlacementCandidate[];
  analysis: AssemblyAnalysis | null;
  magnet: boolean;
  xray: boolean;
  exploded: boolean;
  blocked: boolean;
  preview: AssemblyItem | null;
  candidateId: string | null;
  hiddenPartIds?: string[];
  machiningFace?: "front" | "back" | null;
  referenceMarkers?: { partId: string; reference: AssemblyReference }[];
  installationPreview?: {
    partId: string;
    position: Vec3;
    collisionPositions?: number[];
  } | null;
};
export type SceneCallbacks = {
  select: (id: string | null) => void;
  preview: (pose: AssemblyItem | null) => void;
  commit: (pose: AssemblyItem) => void;
  snap: (id: string | null) => void;
  error: (message: string) => void;
  orientation?: (rotation: Rotation3) => void;
};
type Entry = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  edge: THREE.LineSegments;
  key: string;
};
type DirectDrag = {
  id: string;
  original: AssemblyItem;
  start: { x: number; y: number };
  point: THREE.Vector3;
  plane: THREE.Plane;
  moved: boolean;
  movable: boolean;
  pointerId: number;
};
const vector = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);
const poseOf = (group: THREE.Group, id: string): AssemblyItem => ({
  partId: id,
  position: { x: group.position.x, y: group.position.y, z: group.position.z },
  rotation: {
    x: group.quaternion.x,
    y: group.quaternion.y,
    z: group.quaternion.z,
    w: group.quaternion.w,
  },
});
const geometry = (positions: number[]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
};
export function createAssemblyScene(
  container: HTMLDivElement,
  callbacks: SceneCallbacks,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor("#f7f5ed");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "三维装配场景");
  renderer.domElement.tabIndex = 0;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000000);
  camera.up.set(0, 0, 1);
  camera.position.set(240, -300, 220);
  scene.add(new THREE.HemisphereLight("#fffdf4", "#9aa0b0", 2.5));
  const light = new THREE.DirectionalLight("#ffffff", 2.8);
  light.position.set(120, -150, 300);
  scene.add(light);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(60, 60, 25);
  orbit.enableDamping = false;
  const transform = createAssemblyTransformControls(camera, renderer.domElement);
  scene.add(transform.helper);
  const grid = new THREE.GridHelper(2000, 80, "#bac1cf", "#e3e4e4");
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.15;
  scene.add(grid);
  const axes = new THREE.AxesHelper(50);
  axes.setColors("#3861b4", "#658774", "#7e879b");
  scene.add(axes);
  const entries = new Map<string, Entry>(),
    overlays = new THREE.Group(),
    ghosts = new THREE.Group();
  scene.add(overlays, ghosts);
  let state: SceneState | null = null,
    disposed = false,
    frame = 0,
    direct: DirectDrag | null = null,
    gizmoOriginal: AssemblyItem | null = null;
  let held: string | null = null,
    alt = false,
    applyingSnap = false,
    fitOnce = false;
  let hovered: string | null = null;
  let gizmoPointerId: number | null = null;
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let orientationFrame = 0;
  const lastOrientation = new THREE.Quaternion(0, 0, 0, 0);
  const render = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
      if (Math.abs(lastOrientation.dot(camera.quaternion)) < 1 - 1e-12) {
        lastOrientation.copy(camera.quaternion);
        callbacks.orientation?.({
          x: camera.quaternion.x,
          y: camera.quaternion.y,
          z: camera.quaternion.z,
          w: camera.quaternion.w,
        });
      }
    });
  };
  const projectPoint = (p: Vec3) => {
    const q = vector(p).project(camera),
      r = renderer.domElement.getBoundingClientRect();
    return { x: ((q.x + 1) * r.width) / 2, y: ((1 - q.y) * r.height) / 2 };
  };
  const setRay = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
  };
  const pick = (e: PointerEvent) => {
    setRay(e);
    return ray.intersectObjects(
      [...entries.values()].filter((v) => v.group.visible).map((v) => v.mesh),
      false,
    )[0];
  };
  function highlightEntries() {
    for (const [id, entry] of entries) {
      const selected = state?.selected === id,
        over = hovered === id;
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      material.color.set(selected ? "#cfad76" : over ? "#ead5ae" : "#dfc89f");
      const edge = entry.edge.material as THREE.LineBasicMaterial;
      edge.color.set(selected || over ? "#315cb9" : "#a18a63");
      edge.opacity = selected ? 1 : over ? 0.85 : 0.55;
      edge.depthTest = !selected;
      entry.edge.renderOrder = selected ? 10 : 0;
    }
  }
  const transformPointer = (event: PointerEvent) => {
    setRay(event);
    return { x: mouse.x, y: mouse.y, button: event.button };
  };
  const clear = (group: THREE.Group) => {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  };
  function updateOverlays() {
    clear(overlays);
    clear(ghosts);
    if (!state) return;
    if (!state.exploded)
      for (const region of state.installationPreview?.collisionPositions
        ? [{ positions: state.installationPreview.collisionPositions }]
        : (state.analysis?.collisions ?? [])) {
        if (!region.positions.length) continue;
        const mesh = new THREE.Mesh(
          geometry(region.positions),
          new THREE.MeshBasicMaterial({
            color: "#e73a39",
            transparent: true,
            opacity: 0.78,
            side: THREE.DoubleSide,
            depthTest: !state.xray,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        );
        mesh.renderOrder = 8;
        overlays.add(mesh);
        const border = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 25),
          new THREE.LineBasicMaterial({
            color: "#ad171d",
            depthTest: !state.xray,
          }),
        );
        border.renderOrder = 9;
        overlays.add(border);
      }
    // Errors on specific features get a precise contour, not a whole-object red fill.
    for (const issue of state.analysis?.issues ?? []) {
      if (issue.kind === "collision" || issue.severity !== "error") continue;
      const fit = issue.constraintId
        ? state.assembly.fits.find((f) => f.id === issue.constraintId)
        : undefined;
      if (!fit) continue;
      const part = state.project.parts.find((p) => p.id === fit.receiverId),
        item = state.assembly.items.find((i) => i.partId === fit.receiverId);
      if (!part || !item) continue;
      const contour =
        fit.feature.kind === "pocket"
          ? part.pockets[fit.feature.index]?.outline
          : part.holes[fit.feature.index];
      if (!contour) continue;
      const points = [...contour, contour[0]].map((p) =>
        vector(transformPoint({ ...p, z: part.thickness + 0.05 }, item)),
      );
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: "#d83032",
          depthTest: !state.xray,
        }),
      );
      line.renderOrder = 7;
      overlays.add(line);
    }
    addReferenceMarks();
    const selectedPart = state.project.parts.find(
      (p) => p.id === state!.selected,
    );
    if (
      !selectedPart ||
      state.hiddenPartIds?.includes(selectedPart.id) ||
      state.exploded ||
      state.installationPreview
    )
      return;
    const model = buildAssemblyModel(
      selectedPart,
      state.assembly.pocketFaces[selectedPart.id],
    );
    const visible = state.candidates
      .filter(
        (c) =>
          c.status !== "invalid" &&
          !state!.hiddenPartIds?.includes(c.receiverId),
      )
      .slice(0, 10);
    for (const candidate of visible) {
      const active = candidate.id === (held ?? state.candidateId),
        valid = candidate.status === "valid";
      const group = new THREE.Group();
      group.position.copy(vector(candidate.pose.position));
      group.quaternion.set(
        candidate.pose.rotation.x,
        candidate.pose.rotation.y,
        candidate.pose.rotation.z,
        candidate.pose.rotation.w,
      );
      const g = geometry(model.positions);
      if (active) {
        const mesh = new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({
            color: valid ? "#f3c934" : "#8793a9",
            transparent: true,
            opacity: valid ? 0.32 : 0.12,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        group.add(mesh);
      }
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 25),
        valid
          ? new THREE.LineBasicMaterial({
              color: "#cd9e04",
              transparent: true,
              opacity: active ? 1 : 0.5,
              depthTest: false,
            })
          : new THREE.LineDashedMaterial({
              color: "#9aa6b4",
              dashSize: 2,
              gapSize: 2,
              transparent: true,
              opacity: active ? 1 : 0.5,
              depthTest: false,
            }),
      );
      edge.computeLineDistances();
      edge.renderOrder = 5;
      group.add(edge);
      if (!active) g.dispose();
      ghosts.add(group);
      if (candidate.feature) {
        const receiver = state.project.parts.find(
            (p) => p.id === candidate.receiverId,
          ),
          host = state.assembly.items.find(
            (i) => i.partId === candidate.receiverId,
          );
        const contour =
          candidate.feature.kind === "pocket"
            ? receiver?.pockets[candidate.feature.index]?.outline
            : receiver?.holes[candidate.feature.index];
        if (receiver && host && contour) {
          const config = state.assembly.pocketFaces[receiver.id],
            face =
              candidate.feature.kind === "pocket"
                ? config?.faces[candidate.feature.index]
                : "front";
          const z = face === "back" ? -0.05 : receiver.thickness + 0.05;
          const points = [...contour, contour[0]].map((p) =>
            vector(transformPoint({ ...p, z }, host)),
          );
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            valid
              ? new THREE.LineBasicMaterial({
                  color: "#e3af08",
                  depthTest: false,
                })
              : new THREE.LineDashedMaterial({
                  color: "#9aa6b4",
                  dashSize: 2,
                  gapSize: 2,
                  depthTest: false,
                }),
          );
          line.computeLineDistances();
          line.renderOrder = 7;
          ghosts.add(line);
        }
      }
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(3, 4.2, 28),
        new THREE.MeshBasicMaterial({
          color: valid ? "#f3bc1f" : "#9aa6b4",
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      ring.position.copy(vector(candidate.target));
      ring.renderOrder = 6;
      ghosts.add(ring);
    }
    if (held && state.preview) {
      const c = state.candidates.find((c) => c.id === held);
      if (c) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            vector(state.preview.position),
            vector(c.pose.position),
          ]),
          new THREE.LineBasicMaterial({ color: "#d4a418", depthTest: false }),
        );
        line.renderOrder = 10;
        overlays.add(line);
      }
    }
  }
  function addReferenceMarks() {
    if (!state || state.exploded || state.installationPreview) return;
    for (const marker of state.referenceMarkers ?? []) {
      const entry = entries.get(marker.partId);
      if (!entry?.group.visible) continue;
      entry.group.updateMatrixWorld(true);
      const point = entry.group.localToWorld(vector(marker.reference.position));
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(2, 12, 8),
        new THREE.MeshBasicMaterial({
          color: marker.partId === state.selected ? "#315cb9" : "#e4b61a",
          depthTest: false,
        }),
      );
      dot.position.copy(point);
      dot.renderOrder = 12;
      overlays.add(dot);
      if (marker.reference.normal) {
        const direction = vector(marker.reference.normal).applyQuaternion(
          entry.group.quaternion,
        );
        const arrow = new THREE.ArrowHelper(
          direction,
          point,
          20,
          "#315cb9",
          5,
          3,
        );
        (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
        (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
        arrow.line.renderOrder = arrow.cone.renderOrder = 12;
        overlays.add(arrow);
      }
    }
    const entry = state.selected ? entries.get(state.selected) : null;
    const part = state.project.parts.find((p) => p.id === state!.selected);
    if (!entry?.group.visible || !part) return;
    const center = new THREE.Vector3(
      part.width / 2,
      part.height / 2,
      part.thickness / 2,
    );
    const direction = state.machiningFace === "back" ? -1 : 1;
    const local = new THREE.Group();
    local.position.copy(entry.group.position);
    local.quaternion.copy(entry.group.quaternion);
    const axes = new THREE.AxesHelper(
      Math.min(25, Math.max(part.width, part.height) / 3),
    );
    axes.setColors("#3861b4", "#658774", "#7e879b");
    (axes.material as THREE.LineBasicMaterial).depthTest = false;
    axes.renderOrder = 12;
    local.add(axes);
    if (state.machiningFace) {
      const model = buildAssemblyModel(
          part,
          state.assembly.pocketFaces[part.id],
        ),
        z = direction > 0 ? part.thickness : 0;
      const facePositions: number[] = [];
      for (let i = 0; i < model.positions.length; i += 9)
        if (
          [2, 5, 8].every((k) => Math.abs(model.positions[i + k] - z) < 0.001)
        )
          facePositions.push(...model.positions.slice(i, i + 9));
      if (facePositions.length) {
        const face = new THREE.Mesh(
          geometry(facePositions),
          new THREE.MeshBasicMaterial({
            color: "#4266c0",
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
          }),
        );
        face.position.z = direction * 0.03;
        face.renderOrder = 11;
        local.add(face);
      }
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, direction),
        center,
        Math.max(25, part.thickness * 2),
        direction > 0 ? "#3861b4" : "#b98122",
        6,
        3,
      );
      (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
      (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
      arrow.line.renderOrder = arrow.cone.renderOrder = 12;
      local.add(arrow);
    }
    overlays.add(local);
  }
  function addDimensionMarks() {
    if (!state?.analysis?.bounds || state.exploded || state.installationPreview)
      return;
    const { min, max } = state.analysis.bounds;
    for (const issue of state.analysis.issues) {
      if (issue.kind !== "dimension" || issue.severity !== "error") continue;
      const axis = issue.message.startsWith("宽")
        ? "x"
        : issue.message.startsWith("深")
          ? "y"
          : issue.message.startsWith("高")
            ? "z"
            : null;
      if (!axis) continue;
      const start = { ...min },
        end = { ...min };
      if (axis === "x") {
        start.y -= 12;
        end.y -= 12;
      } else {
        start.x -= 12;
        end.x -= 12;
      }
      end[axis] = max[axis];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([vector(start), vector(end)]),
        new THREE.LineBasicMaterial({ color: "#d83032", depthTest: false }),
      );
      line.renderOrder = 10;
      overlays.add(line);
    }
  }
  function stopOrientation() {
    if (!orientationFrame) return;
    cancelAnimationFrame(orientationFrame);
    orientationFrame = 0;
    camera.up.set(0, 0, 1);
    orbit.enabled = true;
    if (!disposed) {
      orbit.update();
      camera.updateMatrixWorld(true);
      render();
    }
  }
  function orient(direction: Vec3) {
    stopOrientation();
    cancelDrag();
    const from = camera.quaternion.clone(),
      to = viewQuaternion(direction);
    if (from.angleTo(to) < 0.001) return;
    const focus = orbit.target.clone(),
      radius = camera.position.distanceTo(focus) || 1;
    const started = performance.now();
    orbit.enabled = false;
    const tick = (now: number) => {
      if (disposed) return;
      const t = Math.min(1, (now - started) / 500),
        ease = 1 - Math.pow(1 - t, 3);
      const q = interpolateViewQuaternion(from, to, ease);
      camera.position.copy(orientationPosition(q, focus, radius));
      camera.up.set(0, 1, 0).applyQuaternion(q);
      camera.quaternion.copy(q);
      render();
      if (t < 1) orientationFrame = requestAnimationFrame(tick);
      else {
        orientationFrame = 0;
        camera.up.set(0, 0, 1);
        orbit.enabled = true;
        orbit.update();
        render();
      }
    };
    orientationFrame = requestAnimationFrame(tick);
  }
  function orbitView(dx: number, dy: number) {
    if (disposed) return;
    stopOrientation();
    cancelDrag();
    const q = dragViewQuaternion(camera.quaternion, dx, dy);
    const radius = camera.position.distanceTo(orbit.target) || 1;
    camera.position.copy(orientationPosition(q, orbit.target, radius));
    camera.up.set(0, 0, 1);
    orbit.update();
    render();
  }
  function fit(kind: "all" | "selected" | "front" | "side" | "top" = "all") {
    stopOrientation();
    cancelDrag();
    const box = new THREE.Box3();
    if (kind === "selected" && state?.selected) {
      const e = entries.get(state.selected);
      if (e) box.setFromObject(e.group);
    } else
      entries.forEach((e) => {
        if (e.group.visible) box.expandByObject(e.group);
      });
    if (box.isEmpty())
      box.setFromCenterAndSize(
        new THREE.Vector3(50, 50, 0),
        new THREE.Vector3(120, 120, 60),
      );
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      radius = Math.max(size.x, size.y, size.z, 60);
    const aspect = Math.min(camera.aspect, 1),
      distance =
        (radius /
          (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect)) *
        1.9;
    const direction =
      kind === "front"
        ? new THREE.Vector3(0, -1, 0.00001)
        : kind === "side"
          ? new THREE.Vector3(1, 0, 0.00001)
          : kind === "top"
            ? new THREE.Vector3(0, -0.00001, 1)
            : new THREE.Vector3(1, -1.4, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(0.05, distance / 10000);
    camera.far = Math.max(10000, distance * 100);
    camera.updateProjectionMatrix();
    orbit.target.copy(center);
    orbit.update();
    render();
  }
  function update(next: SceneState) {
    const draggedId = direct?.id ?? gizmoOriginal?.partId;
    const draggedItem = next.assembly.items.find(item => item.partId === draggedId);
    if (draggedId && (
      next.blocked || next.exploded || next.installationPreview ||
      next.selected !== draggedId || next.hiddenPartIds?.includes(draggedId) ||
      !draggedItem || draggedItem.locked
    )) cancelDrag();
    state = next;
    const wanted = new Set(next.assembly.items.map((i) => i.partId));
    for (const [id, e] of entries)
      if (!wanted.has(id)) {
        scene.remove(e.group);
        disposeObject(e.group);
        entries.delete(id);
      }
    next.assembly.items.forEach((item, index) => {
      const part = next.project.parts.find((p) => p.id === item.partId);
      if (!part) return;
      const key =
        geometrySignature(part) +
        JSON.stringify(next.assembly.pocketFaces[part.id] ?? {});
      let entry = entries.get(part.id);
      if (!entry || entry.key !== key) {
        if (entry) {
          scene.remove(entry.group);
          disposeObject(entry.group);
        }
        const model = buildAssemblyModel(
          part,
          next.assembly.pocketFaces[part.id],
        );
        const group = new THREE.Group(),
          mesh = new THREE.Mesh(
            geometry(model.positions),
            new THREE.MeshStandardMaterial({
              color: "#d8bd91",
              roughness: 0.85,
              metalness: 0,
              side: THREE.DoubleSide,
            }),
          );
        mesh.userData.partId = part.id;
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 30),
          new THREE.LineBasicMaterial({
            color: "#a18a63",
            transparent: true,
            opacity: 0.65,
          }),
        );
        group.add(mesh, edge);
        scene.add(group);
        entry = { group, mesh, edge, key };
        entries.set(part.id, entry);
      }
      if (!(
        direct?.id === item.partId || gizmoOriginal?.partId === item.partId
      )) {
        const pose = next.preview?.partId === item.partId ? next.preview : item;
        entry.group.position.copy(vector(pose.position));
        entry.group.quaternion.set(
          pose.rotation.x,
          pose.rotation.y,
          pose.rotation.z,
          pose.rotation.w,
        );
        if (next.exploded)
          entry.group.position.add(
            new THREE.Vector3(
              index * part.thickness * 3,
              0,
              index * part.thickness * 1.5,
            ),
          );
        if (next.installationPreview?.partId === item.partId)
          entry.group.position.copy(vector(next.installationPreview.position));
      }
      entry.group.visible = !next.hiddenPartIds?.includes(part.id);
      const selected = next.selected === part.id,
        material = entry.mesh.material as THREE.MeshStandardMaterial;
      material.color.set(selected ? "#c8aa78" : "#dfc89f");
      material.transparent = next.xray;
      material.opacity = next.xray ? 0.35 : 1;
      material.depthWrite = !next.xray;
      (entry.edge.material as THREE.LineBasicMaterial).color.set(
        selected ? "#2146b5" : "#a18a63",
      );
      (entry.edge.material as THREE.LineBasicMaterial).opacity = selected
        ? 0.95
        : 0.55;
    });
    const item = next.assembly.items.find((i) => i.partId === next.selected),
      entry = next.selected ? entries.get(next.selected) : null;
    if (
      entry &&
      entry.group.visible &&
      item &&
      !item.locked &&
      !next.blocked &&
      !next.exploded &&
      !next.installationPreview
    ) {
      transform.attach(entry.group);
      for (const control of transform.controls)
        control.setRotationSnap(alt ? null : Math.PI / 2);
    } else transform.detach();
    highlightEntries();
    updateOverlays();
    addDimensionMarks();
    if (!fitOnce && entries.size) {
      fitOnce = true;
      fit();
    }
    render();
  }
  function snapPose(raw: AssemblyItem, axes = "XYZ") {
    if (!state) return raw;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const obstacles = [...entries]
      .filter(([id, e]) => id !== raw.partId && e.group.visible)
      .map(([, e]) => e.mesh);
    const eligible = state.candidates.filter((c) => {
      if (state!.hiddenPartIds?.includes(c.receiverId)) return false;
      let anchor = c.target;
      if (c.feature) {
        const receiver = state!.project.parts.find(
          (p) => p.id === c.receiverId,
        );
        const host = state!.assembly.items.find(
          (i) => i.partId === c.receiverId,
        );
        const contour =
          c.feature.kind === "pocket"
            ? receiver?.pockets[c.feature.index]?.outline
            : receiver?.holes[c.feature.index];
        if (receiver && host && contour?.length) {
          const config = state!.assembly.pocketFaces[receiver.id];
          const back =
            c.feature.kind === "pocket" &&
            config?.faces[c.feature.index] === "back";
          anchor = transformPoint(
            {
              x: contour.reduce((sum, p) => sum + p.x, 0) / contour.length,
              y: contour.reduce((sum, p) => sum + p.y, 0) / contour.length,
              z: back ? -0.03 : receiver.thickness + 0.03,
            },
            host,
          );
        }
      }
      return visibleSnapTarget(anchor, camera, obstacles);
    });
    const snapped = weakSnap(raw, eligible, {
      enabled: state.magnet,
      suspended: alt,
      heldId: held,
      axes,
      project: projectPoint,
    });
    held = snapped.candidateId;
    callbacks.snap(held);
    return snapped.pose;
  }
  for (const control of transform.controls) {
    const onObjectChange = () => {
      if (!state || !gizmoOriginal || applyingSnap || transform.active !== control || !control.object) return;
      const group = control.object as THREE.Group;
      let pose = poseOf(group, gizmoOriginal.partId);
      if (control.mode === "translate")
        pose = snapPose(pose, control.axis ?? "XYZ");
      applyingSnap = true;
      group.position.copy(vector(pose.position));
      applyingSnap = false;
      callbacks.preview(pose);
      render();
    };
    control.addEventListener("objectChange", onObjectChange);
    control.addEventListener("mouseDown", () => {
      if (!state?.selected) return;
      const item = state.assembly.items.find((i) => i.partId === state!.selected);
      if (item) {
        gizmoOriginal = structuredClone(item);
        held = null;
        orbit.enabled = false;
      }
    });
    control.addEventListener("mouseUp", () => {
      if (!gizmoOriginal) return;
      const entry = entries.get(gizmoOriginal.partId);
      const original = gizmoOriginal;
      gizmoOriginal = null;
      held = null;
      orbit.enabled = true;
      if (entry) {
        const pose = poseOf(entry.group, original.partId);
        callbacks.preview(null);
        callbacks.snap(null);
        callbacks.commit(pose);
      }
      render();
    });
    control.addEventListener("change", render);
  }
  const onDown = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      !state ||
      state.blocked ||
      state.exploded ||
      state.installationPreview
    )
      return;
    const hit = pick(event);
    if (transform.down(transformPointer(event))) {
      gizmoPointerId = event.pointerId;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      event.stopImmediatePropagation();
      return;
    }
    const id = hit?.object.userData.partId as string | undefined;
    const item = state.assembly.items.find((i) => i.partId === id);
    if (!hit || !item) return;
    callbacks.select(item.partId);
    direct = {
      id: item.partId,
      original: structuredClone(item),
      start: { x: event.clientX, y: event.clientY },
      point: hit.point.clone(),
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z),
      moved: false,
      movable: !item.locked,
      pointerId: event.pointerId,
    };
    orbit.enabled = false;
    renderer.domElement.style.cursor = item.locked ? "pointer" : "grabbing";
    renderer.domElement.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation();
  };
  let clickStart: { x: number; y: number; pointerId: number } | null = null;
  const onCapture = (event: PointerEvent) => {
    if (direct || transform.active) {
      event.stopImmediatePropagation();
      return;
    }
    stopOrientation();
    clickStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    onDown(event);
  };
  const onMove = (event: PointerEvent) => {
    if (transform.active) {
      event.stopImmediatePropagation();
      if (event.pointerId === gizmoPointerId)
        transform.move(transformPointer(event));
      return;
    }
    if (!direct) {
      const overGizmo = transform.hover(transformPointer(event));
      const hit = pick(event),
        id = hit?.object.userData.partId ?? null;
      if (id !== hovered) {
        hovered = id;
        highlightEntries();
        render();
      }
      renderer.domElement.style.cursor = overGizmo || id ? "grab" : "default";
      return;
    }
    event.stopImmediatePropagation();
    if (event.pointerId !== direct.pointerId) return;
    if (!direct.movable) return;
    setRay(event);
    if (
      !direct.moved &&
      Math.hypot(
        event.clientX - direct.start.x,
        event.clientY - direct.start.y,
      ) < 4
    )
      return;
    direct.moved = true;
    const point = new THREE.Vector3();
    if (!ray.ray.intersectPlane(direct.plane, point)) return;
    const delta = point.sub(direct.point),
      raw = {
        ...direct.original,
        position: {
          x: direct.original.position.x + delta.x,
          y: direct.original.position.y + delta.y,
          z: direct.original.position.z,
        },
      };
    const pose = snapPose(raw, "XY"),
      entry = entries.get(direct.id);
    if (entry) entry.group.position.copy(vector(pose.position));
    callbacks.preview(pose);
    render();
  };
  const onLeave = () => {
    if (direct || gizmoOriginal) return;
    hovered = null;
    transform.clearHover();
    renderer.domElement.style.cursor = "default";
    highlightEntries();
    render();
  };
  const onUp = (event: PointerEvent) => {
    if (transform.active) {
      event.stopImmediatePropagation();
      if (event.pointerId !== gizmoPointerId) return;
      transform.up();
      gizmoPointerId = null;
      clickStart = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId))
        renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grab";
      return;
    }
    if (direct) {
      event.stopImmediatePropagation();
      if (event.pointerId !== direct.pointerId) return;
      const drag = direct;
      direct = null;
      orbit.enabled = true;
      renderer.domElement.style.cursor = "grab";
      held = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId))
        renderer.domElement.releasePointerCapture(event.pointerId);
      const entry = entries.get(drag.id);
      if (drag.moved && entry) {
        callbacks.preview(null);
        callbacks.snap(null);
        callbacks.commit(poseOf(entry.group, drag.id));
      } else callbacks.select(drag.id);
      render();
      return;
    }
    if (gizmoOriginal) return;
    if (
      clickStart &&
      Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) <=
        4
    )
      callbacks.select(pick(event)?.object.userData.partId ?? null);
  };
  function cancelDrag() {
    const original = direct?.original ?? gizmoOriginal;
    if (!original && !transform.active) return false;
    // Clear our transaction before Three dispatches reset/mouseUp events.
    gizmoOriginal = null;
    transform.reset();
    const entry = original ? entries.get(original.partId) : null;
    if (entry && original) {
      entry.group.position.copy(vector(original.position));
      entry.group.quaternion.set(
        original.rotation.x,
        original.rotation.y,
        original.rotation.z,
        original.rotation.w,
      );
    }
    const pointerId = direct?.pointerId ?? gizmoPointerId ?? clickStart?.pointerId;
    if (
      pointerId !== undefined &&
      renderer.domElement.hasPointerCapture(pointerId)
    )
      renderer.domElement.releasePointerCapture(pointerId);
    clickStart = null;
    gizmoPointerId = null;
    direct = null;
    renderer.domElement.style.cursor = "default";
    gizmoOriginal = null;
    held = null;
    orbit.enabled = true;
    callbacks.preview(null);
    callbacks.snap(null);
    render();
    return true;
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Alt") {
      alt = event.type === "keydown";
      for (const control of transform.controls)
        control.setRotationSnap(alt ? null : Math.PI / 2);
    }
    if (event.key === "Escape" && event.type === "keydown" && cancelDrag()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onBlur = () => {
    stopOrientation();
    alt = false;
    cancelDrag();
  };
  renderer.domElement.addEventListener("wheel", stopOrientation, {
    capture: true,
    passive: true,
  });
  renderer.domElement.addEventListener("pointerdown", onCapture, true);
  renderer.domElement.addEventListener("pointermove", onMove, true);
  renderer.domElement.addEventListener("pointerup", onUp, true);
  renderer.domElement.addEventListener("pointercancel", cancelDrag);
  renderer.domElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  window.addEventListener("blur", onBlur);
  orbit.addEventListener("change", render);
  const resize = () => {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (direct || gizmoOriginal) cancelDrag();
    renderer.setSize(r.width, r.height);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  render();
  return {
    update,
    fit,
    orient,
    orbitView,
    cancelDrag,
    dispose() {
      disposed = true;
      stopOrientation();
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("wheel", stopOrientation, true);
      renderer.domElement.removeEventListener("pointerdown", onCapture, true);
      renderer.domElement.removeEventListener("pointermove", onMove, true);
      renderer.domElement.removeEventListener("pointerup", onUp, true);
      renderer.domElement.removeEventListener("pointercancel", cancelDrag);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      transform.dispose();
      orbit.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

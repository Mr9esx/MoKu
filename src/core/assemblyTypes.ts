export type Vec3 = { x: number; y: number; z: number };
export type Rotation3 = Vec3 & { w: number };
export type AssemblyItem = { partId: string; position: Vec3; rotation: Rotation3; locked?: boolean };
export type PocketFace = 'front' | 'back';
export type PocketFaces = { signature: string; faces: Record<number, PocketFace> };
export type FitConstraint = {
  id: string; partId: string; receiverId: string;
  feature: { kind: 'pocket' | 'hole'; index: number }; maleEdge: number;
  insertionDepth: number; minClearance: number; maxClearance: number;
  partSignature: string; receiverSignature: string;
};
export type AssemblyStep = { partId: string; direction: Vec3; distance: number };
export type Assembly = {
  items: AssemblyItem[]; pocketFaces: Record<string, PocketFaces>;
  targets: { width?: number; depth?: number; height?: number; tolerance: number };
  fits: FitConstraint[]; steps: AssemblyStep[]; sparePartIds: string[];
};
export type ConvexCell = { vertices: Vec3[]; faces: number[][]; /** True only on the actual material boundary, never a decomposition seam. */ boundaryFaces?: boolean[]; /** Complete physical boundary normals at each vertex, shared across adjacent cells. */ boundaryNormals?: Vec3[][] };
export type Bounds3 = { min: Vec3; max: Vec3 };
export type AssemblyModel = { partId: string; positions: number[]; cells: ConvexCell[]; complete: boolean; issues: string[]; bounds: Bounds3 };
export type AssemblyIssue = { id: string; kind: 'collision'|'dimension'|'fit'|'geometry'|'missing'|'installation'|'machining'; severity: 'error'|'pending'|'warning'; message: string; partIds: string[]; position?: Vec3; constraintId?: string; /** First continuously detected blocked motion pose and its real overlap mesh. */ movingPosition?: Vec3; collisionPositions?: number[] };
/** Manufacturing advice is separate from the geometric proofs used by magnets and fits. */
export type AssemblyMachiningWarning = AssemblyIssue & { kind: 'machining'; severity: 'warning'; target: string; cornerCount: number; /** Positions on the cutting face, in part-local coordinates, so drag previews stay aligned. */ localPositions: Vec3[] };
export type CollisionRegion = { partIds: [string,string]; positions: number[] };
export type AssemblyAnalysis = { issues: AssemblyIssue[]; machiningWarnings?: AssemblyMachiningWarning[]; collisions: CollisionRegion[]; bounds: Bounds3|null; complete: boolean; checkedPairs: number };
export type ContactGeometry = { source: ConvexCell[]; obstacles: { cells: ConvexCell[]; bounds: Bounds3 }[]; targets: Assembly['targets']; rules?: { project: import('./types').Project; assembly: Assembly } };
export type AssemblyContact = {
  kind: 'groove' | 'surface'; sourceAnchor: Vec3; targetAnchor: Vec3; normal: Vec3;
  sourceTriangles?: Vec3[]; targetTriangles?: Vec3[];
  sourceEdge?: number; depth?: number; face?: PocketFace;
  slideAxis?: Vec3; slideRange?: number;
  geometry: ContactGeometry;
};
export type PlacementCandidate = { id: string; partId: string; receiverId: string; pose: AssemblyItem; target: Vec3; label: string; status: 'valid'|'incomplete'|'invalid'; message?: string; feature?: {kind:'pocket'|'hole';index:number}; contact?: AssemblyContact; insertion?: { maleEdge: number; depth: number; width: number; clearance: number; sourceAnchor: Vec3; receiverAnchor: Vec3; direction: Vec3; geometryChecked: boolean } };
export const CONTACT_EPSILON = 0.01;
export function emptyAssembly(): Assembly {
  return {items:[],pocketFaces:{},targets:{tolerance:0.5},fits:[],steps:[],sparePartIds:[]};
}

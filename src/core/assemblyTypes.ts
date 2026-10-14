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
export type ConvexCell = { vertices: Vec3[]; faces: number[][]; /** True only on the actual material boundary, never a decomposition seam. */ boundaryFaces?: boolean[] };
export type Bounds3 = { min: Vec3; max: Vec3 };
export type AssemblyModel = { partId: string; positions: number[]; cells: ConvexCell[]; complete: boolean; issues: string[]; bounds: Bounds3 };
export type AssemblyIssue = { id: string; kind: 'collision'|'dimension'|'fit'|'geometry'|'missing'|'installation'; severity: 'error'|'pending'; message: string; partIds: string[]; position?: Vec3; constraintId?: string; /** First continuously detected blocked motion pose and its real overlap mesh. */ movingPosition?: Vec3; collisionPositions?: number[] };
export type CollisionRegion = { partIds: [string,string]; positions: number[] };
export type AssemblyAnalysis = { issues: AssemblyIssue[]; collisions: CollisionRegion[]; bounds: Bounds3|null; complete: boolean; checkedPairs: number };
export type PlacementCandidate = { id: string; partId: string; receiverId: string; pose: AssemblyItem; target: Vec3; label: string; status: 'valid'|'incomplete'|'invalid'; message?: string; feature?: {kind:'pocket'|'hole';index:number} };
export const CONTACT_EPSILON = 0.01;
export function emptyAssembly(): Assembly {
  return {items:[],pocketFaces:{},targets:{tolerance:0.5},fits:[],steps:[],sparePartIds:[]};
}

import ClipperLib from "clipper-lib";
import type {DrawingShape,DrawingRule} from "./drawingTypes";
import type {Point} from "./types";
import {validContour} from "./geometry";
import { effectiveDrawingShape } from "./drawingNormalization";
const SCALE=100000;
export type PocketGeometry={points:Point[];centerline?:Point[];width?:number;boundaryClosedByUser?:boolean};
/** A role assignment never fabricates geometry: open slots require a declared representation. */
export function pocketGeometry(shape:DrawingShape,rule:DrawingRule):PocketGeometry {
 shape=effectiveDrawingShape(shape,rule);
 if(shape.closed) {
  if(rule.pocketGeometry==="centerline") throw Error("闭合环请使用区域边界；中心路径仅接受开放线");
  if(!shape.valid||!validContour(shape.points)) throw Error("槽区域自交或无效");
  return {points:shape.points};
 }
 if(!shape.pathValid||shape.points.length<2||shape.points.some((p,i)=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||(i>0&&Math.hypot(p.x-shape.points[i-1].x,p.y-shape.points[i-1].y)<1e-6))) throw Error("开放槽路径无效，请修正分支或重复点");
 if(rule.pocketGeometry==="close-boundary") {
  if(!validContour(shape.points)) throw Error("连接两端后无法形成有效槽区域，可能自交或面积为零；请选择中心路径或补齐边界");
  return {points:shape.points,boundaryClosedByUser:true};
 }
 if(rule.pocketGeometry!=="centerline") throw Error("开放铣槽请选择画法：中心路径，或直线连接两端成区域");
 const width=rule.slotWidth;
 if(!Number.isFinite(width)||!(width!>0)) throw Error("请填写大于 0 的槽宽（mm）");
 if(shape.points.some(p=>Math.abs(p.x*SCALE)>1e14||Math.abs(p.y*SCALE)>1e14)||width!*SCALE>1e14) throw Error("槽尺寸超出可计算范围");
 const offset=new ClipperLib.ClipperOffset(2,0.025*SCALE);
 offset.AddPath(shape.points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)})),ClipperLib.JoinType.jtRound,ClipperLib.EndType.etOpenRound);
 const paths:ClipperLib.Paths=[]; offset.Execute(paths,width!*SCALE/2);
 if(paths.length!==1) throw Error("中心路径展开后产生多个边界，请拆分或定义闭合槽区域");
 if(paths[0].length>4096) throw Error("槽展开后超过 4096 个顶点，请简化或拆分路径");
 const points=paths[0].map(p=>({x:p.X/SCALE,y:p.Y/SCALE}));
 if(!validContour(points)) throw Error("槽宽无法形成有效区域，请核对路径与槽宽");
 return {points,centerline:shape.points,width};
}

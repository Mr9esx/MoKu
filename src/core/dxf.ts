import {readDrawing} from "./drawingDocument";
import {compileDrawing} from "./drawingReview";
import type {ImportOptions} from "./drawingReview";
export type {ImportOptions} from "./drawingReview";
/** Legacy convenience API: the interactive importer reviews the source document first. */
export function parseDxf(text:string,name="导入图纸",options:ImportOptions={}) {
 return compileDrawing(readDrawing(text,name,options),{inferStock:true,...options});
}

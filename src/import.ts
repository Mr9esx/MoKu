import { workbench } from "./store";
import type { ImportOptions } from "./core/dxf";
let importer: Worker | null = null;
export function cancelImportDrawing() {
  importer?.terminate();
  importer = null;
  workbench.getState().cancelImport();
}
/** Read and parse a draft only. Confirmation is the sole workspace transaction. */
export async function importDrawing(file?: File, options: ImportOptions = {}) {
  const id = workbench.getState().beginImport();
  importer?.terminate();
  importer = null;
  try {
    if (file && file.size > 2 * 1024 * 1024)
      throw new Error("DXF 文件上限为 2 MB，请拆分图纸后导入。");
    const text = file
      ? await file.text()
      : await fetch("/sample.dxf").then((r) => {
          if (!r.ok) throw Error("示例图纸读取失败");
          return r.text();
        });
    if (workbench.getState().importRun !== id) return;
    const w = new Worker(new URL("./core/import.worker.ts", import.meta.url), {
      type: "module",
    });
    importer = w;
    w.onmessage = (e) => {
      w.terminate();
      if (importer === w) importer = null;
      if (e.data.error) workbench.getState().failImport(id, e.data.error);
      else workbench.getState().previewImport(id, e.data.project);
    };
    w.onerror = () => {
      w.terminate();
      if (importer === w) importer = null;
      workbench.getState().failImport(id, "图纸读取失败，请检查 DXF 格式。");
    };
    w.postMessage({ text, name: file?.name ?? "示例 · sample.dxf", options });
  } catch (error) {
    workbench
      .getState()
      .failImport(id, error instanceof Error ? error.message : String(error));
  }
}

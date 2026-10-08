import { parseDxf, type ImportOptions } from "./dxf";
self.onmessage = (
  e: MessageEvent<{ text: string; name: string; options?: ImportOptions }>,
) => {
  try {
    self.postMessage({
      project: parseDxf(e.data.text, e.data.name, e.data.options),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

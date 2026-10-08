import { parseDxf } from "./dxf";
self.onmessage = (e: MessageEvent<{ text: string; name: string }>) => {
  try {
    self.postMessage({ project: parseDxf(e.data.text, e.data.name) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

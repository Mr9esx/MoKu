import { readDrawing } from "./drawingDocument";
import type { ImportOptions } from "./drawingReview";
self.onmessage = (
  e: MessageEvent<{ text: string; name: string; options?: ImportOptions }>,
) => {
  try {
    self.postMessage({
      document: readDrawing(e.data.text, e.data.name, e.data.options),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

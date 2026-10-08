type Size = { width: number; height: number };
type Insets = { left: number; right: number; top: number; bottom: number };

/** Fit in the unobscured area without shrinking the drawing's actual viewport. */
export function fitCanvasViewport(
  content: Size,
  viewport: Size,
  insets: Insets,
) {
  const width = Math.max(1, viewport.width),
    height = Math.max(1, viewport.height);
  const availableWidth = Math.max(1, width - insets.left - insets.right);
  const availableHeight = Math.max(1, height - insets.top - insets.bottom);
  const scale = Math.min(
    availableWidth / Math.max(1, content.width),
    availableHeight / Math.max(1, content.height),
  );
  return {
    x: -(insets.left + (availableWidth - content.width * scale) / 2) / scale,
    y: -(insets.top + (availableHeight - content.height * scale) / 2) / scale,
    width: width / scale,
    height: height / scale,
  };
}

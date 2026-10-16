type Size = { width: number; height: number };
type Insets = { left: number; right: number; top: number; bottom: number };
export type CanvasViewport = Size & { x: number; y: number };

/** Match OrbitControls wheel sensitivity, including trackpad pinch events. */
export function wheelZoomFactor(
  event: { deltaY: number; deltaMode: number; ctrlKey?: boolean },
  controlKeyDown = false,
) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
  const delta = event.deltaY * unit * (event.ctrlKey && !controlKeyDown ? 10 : 1);
  return Math.pow(0.95, Math.max(-1000, Math.min(1000, delta)) * 0.01);
}

/** Scale around a drawing point while keeping its screen position fixed. */
export function zoomCanvasViewport(
  view: CanvasViewport,
  anchor: { x: number; y: number },
  factor: number,
  limits: { minWidth: number; maxWidth: number },
): CanvasViewport {
  const width = Math.max(limits.minWidth, Math.min(limits.maxWidth, view.width / factor));
  const ratio = width / view.width;
  return {
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
    width,
    height: view.height * ratio,
  };
}

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

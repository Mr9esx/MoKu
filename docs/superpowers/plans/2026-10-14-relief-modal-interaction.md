# 清角/T骨弹窗交互 Implementation Plan

**Goal:** 用户可以直接操作预览图，清楚区分加工选择、查看位置和清角参数。

**Architecture:** `JoineryCanvas` 只负责预览交互，`JoineryPanel` 负责加工状态与提交。复用现有画布适配函数，在同一模块添加可验证的指针锚定缩放函数。

**Tech Stack:** React 19、TypeScript、SVG、ResizeObserver、Vitest；无新增依赖。

## Global Constraints

- 名称保持清角/T骨；保留识别修正、原图、几何验证及单次撤销事务。
- 开始显示完整零件；加工轮廓只有一个列表；查看与加工勾选分开。
- 拖动超过 4 px 不触发点击；角点使用屏幕固定尺寸。
- 与用户正在使用的本地工作区协作，保留已有修改。

## Task 1: 指针缩放与预览画布

- [x] 在 `tests/canvas-viewport.test.ts` 写出锚点、最小最大宽度和不变形缩放的失败回归并运行。
- [x] 在 `src/core/canvasViewport.ts` 实现 `zoomCanvasViewport(view, anchor, factor, limits)`，保持锚点相对屏幕坐标，边界通过宽度约束。
- [x] 新增 `src/components/JoineryCanvas.tsx`：适配整体/所选/角点、滚轮缩放、指针拖动、拖动抑制点击、宽命中轮廓、固定像素角点。
- [x] 运行视图和清角回归。

## Task 2: 参数侧栏与联动

- [x] 修改 `JoineryPanel.tsx`，删除视图下拉框，使用轮廓列表；明确分组，勾选与定位分开，悬停联动。
- [x] 重整 `joineryPanel.css`，保持现有纸色、蓝色图纸与橙色清角；桌面左右布局、小屏上下布局。
- [x] 浏览器实测 P27：初始整体、选择大孔、窄槽、滚轮与按钮、拖动、角点定位不改选择、参数不重置视图、取消、应用与撤销。
- [x] 运行 `pnpm build`、`pnpm exec vitest run --maxWorkers=1`，记录结果并保存截图。

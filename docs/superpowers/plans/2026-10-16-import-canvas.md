# 导入预览画布 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在当前会话逐项实现，用户已授权执行。

**Goal:** 把浏览、选择和用途操作收进预览画布，简化左侧工具区。

**Architecture:** 新增 DrawingCanvas 管理 SVG 视野和手势，复用 canvasViewport 的适配与缩放。DrawingReview 保持用途规则与右侧联动的所有权；ImportDrawingPreview 用同一画布提供只读浏览。

**Tech Stack:** React 19、TypeScript、SVG、Vitest、现有 lucide-react。

## Global Constraints

- 不增加依赖，保留现有清角相关未提交修改。
- 只有确认导入才写入工作项目。
- 单击不改变视野；双击和右侧定位才放大。
- 拖动不误选，Shift 多选可跨图层，取消最后一个选择不得变为选择整层。
- 保留加工规则已有参数；槽深和槽宽继续通过右侧填写。

### Task 1: 可测试的视野与选择行为

**Files:** 新增 src/core/drawingCanvas.ts、tests/drawing-canvas.test.ts。

- [x] 测试先行：fitDrawingCanvas(points, viewport) 过滤非有限坐标，将 CAD Y 翻转到 SVG 坐标，按真实容器比例适配；空内容有有限视野。
- [x] 测试先行：selectDrawingShape(ids, id, extend) 普通点击替换选择，Shift 增减选择，取消最后一个返回空数组。
- [x] 运行 `pnpm exec vitest run tests/drawing-canvas.test.ts` 观察失败。
- [x] 最小实现复用 fitCanvasViewport，断言使用手算坐标与固定数组。
- [x] 重跑目标测试。

### Task 2: 画布交互与用途操作条

**Files:** 新增 src/components/DrawingCanvas.tsx；修改 DrawingReview.tsx、ImportDrawingPreview.tsx、drawingReview.css。

- [x] 新增有 ResizeObserver 的 SVG 画布，管理视野、指针拖动及 4 px 拖动阈值；原生非 passive wheel 处理平移和指针锚定缩放。
- [x] 添加画布内加减缩放和适应全图，以及键盘 + / - / 0；Esc 优先取消选择或拖动。
- [x] 原图选择与视野分离，右侧定位通过明确 focus 请求驱动画布；Shift 选择跨图层，真正空选择为 null。
- [x] 加入选中后的用途下拉、忽略和详细设置，通过 resolveDrawingRule 读取每个图形的完整规则，仅更新 role；批量表单原有的清空参数语义不变。
- [x] 顶部保留预览切换，单位与空间移到右侧图纸设置；底部整合数量、选择状态与折叠图例。
- [x] 导入效果复用只读画布浏览，保持板材切换与待放置零件图库。

### Task 3: 验证与交付

- [x] 运行 `pnpm test` 和 `pnpm build`，记录实际结果。
- [x] 浏览器验证单击视野不变、双击定位、拖动不误选、跨图层多选及最后取消、用途与右侧一致、导入效果浏览、取消不提交。
- [x] 验证窄屏画布工具条和固定底部按钮可用，恢复浏览器尺寸。
- [x] README 更新对应操作说明，记录验证结果，保存截图供审阅。

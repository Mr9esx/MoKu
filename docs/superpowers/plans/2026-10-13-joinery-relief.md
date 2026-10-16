# 榫卯清角 Implementation Plan

> **For agentic workers:** Use inline execution for this plan. Preserve the current workspace's existing edits.

**Goal:** 导入图纸后给已有榫槽添加真实狗骨 / T 骨清角轮廓，首页保留统一图纸入口。

**Architecture:** 独立 joineryRelief.ts 负责候选角点、清角圆和布尔运算。Store 提供一次可撤销的应用事务，JoineryPanel 负责局部预览；现有画布、排版、导出直接消费修改后的 Part。

**Tech Stack:** React、TypeScript、Zustand、现有 clipper-lib、Vitest。

## Global Constraints

- 只在导入后的项目编辑工具中增加入口，不创建首页能力分类。
- 支持直角内角、狗骨 / T 骨、0.1–100 mm 刀具直径；弦误差不超过 0.005 mm。
- 源图不修改，应用可撤销；搜索中和只读视图不允许应用。
- 不增加依赖，不覆盖已有未提交工作。

## Task 1: 清角几何与事务

Files: src/core/joineryRelief.ts、src/store.ts、tests/joinery-relief.test.ts。

Interfaces: reliefTargets(part) 返回加工目标与可选角点；previewRelief(part, input) 返回新 Part 和清角圆；applyRelief(partId, input) 返回 boolean。

- [x] 编写几何与 Store 测试，使用独立手工尺寸验证角点、面积、绕向、无效几何、源图和撤销；运行 `pnpm exec vitest run tests/joinery-relief.test.ts` 确认缺失功能失败。
- [x] 实现角点检测、圆心计算、整数坐标布尔运算、结果独立验证与 Store 单次事务。
- [x] 运行同一测试文件并修复实际失败；扩展测试捕获有意义的边界问题。

## Task 2: 图纸编辑入口与交互

Files: src/components/JoineryPanel.tsx、src/components/joineryPanel.css、src/components/PartCanvas.tsx、src/components/DrawingOverview.tsx、src/core/export.ts、src/components/WorkspaceDialogs.tsx、src/components/ContextInspector.tsx、src/components/ResourcePanel.tsx、src/App.tsx、src/components/EmptyWorkbench.tsx、index.html、README.md。

- [x] 增加项目内清角弹窗，提供零件 / 轮廓选择、刀具直径、样式、方向、逐角按钮、局部预览、应用和取消。
- [x] 将入口加入导入后顶栏与零件信息栏；沿用弹窗聚焦和键盘行为。
- [x] 调整首页标题、三步介绍和元信息，维持统一导入入口。
- [x] 独立零件导入后直接展示图纸、图纸概览与编辑入口，提供不依赖排版的零件 SVG 导出。
- [x] 运行几何 / 编辑 / 排版导出相关测试与 `pnpm build`；使用浏览器验证导入、预览、应用、撤销、T 骨和窄屏布局。
- [x] 在验证文档记录结果与既有失败，提供可见预览。

实施完成。最终验证：30 文件 / 481 项串行回归通过，生产构建通过；浏览器验证包含独立图纸导入、狗骨 / T 骨、实际轮廓应用与撤销、无板材编辑、独立导出入口及 390 × 844 窄屏操作。详见 [验证记录](../../analysis/2026-10-13-joinery-relief-verification.md)。

## 用户确认的入口调整

- [x] 清角入口移到选中零件后的画布底部工具栏，移除顶部和信息栏重复入口；名称改为“内角清角”。
- [x] 编辑器固定选中的零件，手机选择后留在画布。
- [x] 验证选中 / 取消选择、只读禁用、打开目标、桌面与手机操作；运行相关回归和生产构建。

## 2026-10-14 识别与轮廓选择修正

- [x] 用真实 P27 复现槽口误标、大孔 R3 圆角漏识别；补充先失败的回归。
- [x] 分开全部可查看轮廓与有效清角候选；预览图支持直接点选孔槽。
- [x] 排除贴边槽口，合并共线分段的空间判断，恢复普通直角圆角的虚拟角点；不重复处理已有狗骨 / T 骨。
- [x] 验证部分圆角替换、绕向与闭合接缝、外轮廓开口槽、椭圆排除及边界保护。
- [x] 浏览器验证 P27 大孔的四个位置、槽口零候选、单角 T 骨应用和准确撤销；28 项清角测试及全量 488 项串行回归通过，生产构建通过。

详见 [识别修正验证](../../analysis/2026-10-14-relief-recognition-verification.md)。

# Right Panel Density Implementation Plan

**Goal:** 将用户确认的右侧 Demo 接入正式工作台。

**Architecture:** 继续使用 LayoutAnalysis 和 ContextInspector 以及现有 store 操作。原生 details 收纳规格、加工与低频操作；组件本地状态控制候选对比和基准，真实指标由现有几何函数计算。

**Tech Stack:** React 19、TypeScript、现有 CSS、Vitest、原生浏览器验证。

## Global Constraints

- 保持侧栏 286 px，选中/取消不改变画布尺寸；现有蓝橙与粗宋体保持。
- 摘要显示轮廓利用率、使用/库存板数和已放数量；成功校验仅在底部，异常保持显式。
- 候选默认对比，概览与对比切换；保留资源集合/待放数量差异说明以及画布顶部应用/放弃。
- 预览 96×124 px；加工与来源、更多操作共享 12 px 字号、字重和颜色。
- 保留只读、兼容板材、旋转、锁定、复制数量验证、删除与撤销业务约束。

## Task 1: 概览与候选

- [x] 修改 src/components/LayoutAnalysis.tsx：每板 details，指标详情，候选概览/对比页签与当前/原图基准。移除成功提示及常驻三视图表格。
- [x] 修改 src/App.tsx：候选创建/移除时初始化对应概览组件；空状态只显示居中引导；底部统一排版检查入口。
- [x] 修改 src/styles.css：摘要、列表、同级折叠入口、页签与底部说明。
- [x] 浏览器验证示例 53 个零件、3 张板、85.4%，展开板材与指标详情；生成候选、切换基准并应用/撤销。

## Task 2: 零件信息

- [x] 修改 src/components/ContextInspector.tsx：预览与名称/尺寸并排；板厚材质标签、位置、锁定旋转常驻；加工与来源和复制删除收纳。
- [x] 修改 src/styles.css：固定面板外框、可滚动正文、页脚、96×124 px 预览、统一折叠入口，移动端触摸尺寸。
- [x] 浏览器验证选择、展开、复制后待放置/兼容板选择、只读禁用、删除撤销和返回概览。

## Task 3: 验证和交付

- [x] 运行 pnpm test、pnpm build、git diff --check。
- [x] 原生浏览器核对空状态、问题检查详情、窄屏信息页；保存正式工作台截图并记录 docs/verification.md。
- [x] 更新 README 与 docs/design/right-panel-density-proposal.md 的实现状态。

本次修改为展示重组；使用现有业务回归并核对真实浏览器交互，不新增映射样式或复述实现的测试。

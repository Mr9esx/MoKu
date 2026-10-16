# 固定信息栏 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在当前会话执行；用户已确认同时整理两个工作区。

**Goal:** 为画布与信息栏建立独立空间，消除控件和详情的覆盖。

**Architecture:** App 和 AssemblyCanvas 各增加一个 preview-main 包装所有画布元素，preview-information 保持其兄弟节点。共用 workspacePreview.css 定义两列布局和窄屏单区切换；SVG 与 WebGL 观察真实容器的现有 ResizeObserver 继续负责尺寸。

**Tech Stack:** React 19、TypeScript、CSS Grid、SVG、Three.js、Vitest。

## Global Constraints

- 不增加依赖，不改动装配数据模型与既有加工轮廓。
- 空态、选中与详情切换不改变右侧信息栏宽度。
- 900px 及以下保留既有资源 / 画布 / 信息导航。
- 不修改其他未提交清角工作，不提交现有项目状态。

### Task 1: 建立独立的画布与信息区域

- [x] 读取并记录旧布局：preview-information 覆盖渲染区，224px / 304px 简版与详情宽度变化。
- [x] src/App.tsx：把标题、StockCanvas / PartCanvas、编辑工具、视图切换和候选条放入 preview-main，信息区留在外面。
- [x] src/components/AssemblyCanvas.tsx：把渲染 host、标题、图例、反馈、视角与编辑工具及空态放入 preview-main，信息区留在外面。
- [x] src/components/workspacePreview.css：两列网格；信息栏相对定位、统一尺寸、内部滚动；删除信息栏宽度推算的工具偏移。
- [x] 浏览器断言主画布与信息栏矩形不相交，详情展开与收起时主画布尺寸完全一致。

### Task 2: 控件与空态适配

- [x] 小画布容器中把缩放控件或立方体置于单独高度，避免底部工具条相交。
- [x] 使用画布容器查询来限制组装标题、图例和操作提示的占位。
- [x] src/components/AssemblyInspector.tsx：无选择时显示组装概览与已放数量，保留必要检查和规则入口；空态画布保留单处引导。
- [x] 900px 及以下改为同格切换主画布与信息栏，测试资源 / 画布 / 信息导航和详情入口。

### Task 3: 验证与记录

- [x] 检查桌面、1024px 与 320px 的排版、组装、选中及详情状态，验证矩形边界和视野适配。
- [x] `pnpm exec vitest run --maxWorkers=2` 与 `pnpm build`。
- [x] 独立只读代码审查，修复确定性问题后复验。
- [x] README 更新分区描述，保存实际截图与验证记录，恢复浏览器默认尺寸。

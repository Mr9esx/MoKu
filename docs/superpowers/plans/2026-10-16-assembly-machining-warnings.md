# 成品组装刀口提示 Implementation Plan

**Goal:** 在成品组装中提示图纸未画清角/T 骨的内直角，并定位到零件上的实际位置。

**Architecture:** 复用二维清角的真实轮廓识别，将制造风险放入独立的 `machiningWarnings`，不混入实体碰撞和磁吸的几何证明。主分析 worker 启用此检查；候选位置的重复几何检测不执行它。现有装配信息显示简短入口，详情复用问题列表，选中零件以黄色角标定位。

**Tech Stack:** TypeScript、React、Three.js、Vitest。

## Constraints

- 没有刀具直径/加工方式，不推测实际刀具圆角，也不宣称必然无法安装。
- 检查已加入组装的零件；按槽、孔、外轮廓分组；已有 Dogbone/T-bone、圆孔和有意画出的圆角不提示“未画刀口”。
- 只检查图中的内直角，提示使用圆柱铣刀时的加工风险，并引导回二维补画或确认加工方式。
- 不修改图纸、磁吸结果、配合声明和已有冲突判定。保留工作区中其他未提交修改。

## Implementation

- [x] 新增 `tests/assembly-machining.test.ts`，先验证缺失提示失败，再覆盖部分/完整清角、T 骨、圆孔/圆角、外轮廓凹角、开口槽、加工面、变换、备用零件和检测隔离。
- [x] 新增 `src/core/assemblyMachining.ts`；扩展 `assemblyTypes.ts` 的可选警告结果；`assemblyChecks.ts` 按选项运行，`assembly.worker.ts` 启用。
- [x] `AssemblyInspector.tsx` 增加紧凑提示和复用的定位列表；独立 `assemblyMachining.css` 避免覆盖正在编辑的样式。
- [x] `assemblyScene.ts` 按零件当前位姿绘制黄色角标；隐藏/爆炸图/安装播放时避免错误位置。
- [x] 运行针对性测试、全量测试和构建；在浏览器用公开示例验证提示、定位、补画后的更新；请求独立代码复核并处理问题。

验证记录：`docs/analysis/2026-10-16-assembly-machining-verification.md`。

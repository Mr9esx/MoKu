# 2D 与 3D 常用快捷键 Implementation Plan

**Goal:** 为现有二维排版和三维组装操作增加一致、可发现的快捷键，保留输入、弹窗、只读和拖动保护。

**Architecture:** 一个共享解码器解析按键与保护条件；App 处理工作区切换和二维动作，AssemblyWorkspace 处理三维动作。视图命令通过已有请求机制交给各画布，编辑继续经过现有 store 的检查与撤销事务。

**Tech Stack:** React、TypeScript、Zustand、Three.js、Vitest。

## 按键约定

| 范围 | 快捷键 | 操作 |
| --- | --- | --- |
| 通用 | Ctrl/⌘ Z、Esc、? / F1 | 撤销、取消、帮助 |
| 通用 | Alt 2 / Alt 3 | 切换二维 / 三维 |
| 通用 | Ctrl/⌘ O、Ctrl/⌘ Shift E | 打开导入 / 导出弹窗 |
| 两种画布 | F、Shift F / 0、+ / − | 定位所选（无所选则全部）、适应全部、缩放 |
| 两种编辑 | 方向键、Shift 方向键 | X/Y 轴微调 1 / 10 mm |
| 两种编辑 | R / Shift R、L、M | 绕 Z 旋转 ±90°、锁定、磁吸 |
| 二维 | V、H、Ctrl/⌘ D、Delete / Backspace | 选择、平移、复制一个、删除零件 |
| 三维 | Delete / Backspace | 移出场景并保留零件库 |
| 三维 | PageUp / PageDown、Shift 加速 | Z 轴微调 1 / 10 mm |
| 三维 | X / Y / Z（Shift 反向） | 绕对应世界轴旋转 ±90° |
| 三维 | T、B、1 / 3 / 7 / 9 | 透视、爆炸、前 / 右 / 上 / 等轴视图 |

## 任务

- [x] 新增 `src/core/keyboardShortcuts.ts` 和 `tests/keyboard-shortcuts.test.ts`，验证映射、修饰键、IME、自动重复及已有编辑检查。
- [x] 在 `assemblyEditing.ts` 增加可测试的快捷编辑变换，保留锁定、有限坐标与真实四元数语义。
- [x] 接入 App、AssemblyWorkspace、StockCanvas 和 AssemblyCanvas；隐藏画布不响应，拖动期间仅允许取消和临时 Alt 行为。
- [x] 操作帮助按通用 / 二维 / 三维分组展示，增加工具提示与可访问快捷键标记。
- [x] 运行针对性和完整测试、构建、独立代码审查；浏览器实测编辑、撤销、输入保护和工作区隔离，保存页面证据。

## 约束

输入框、文本编辑、下拉选择、输入法组合输入、已有事件处理均不劫持；Ctrl/⌘ Shift Z 不误执行撤销。切换原图和候选视图后不编辑二维图纸；排版搜索和弹窗期间不执行编辑。按键和按钮使用同一数据检查，精确微调不会被弱磁吸覆盖。

## 验证记录

- 新增 10 项解码/真实 store 测试：macOS Option 数字键的物理 code、两工作区命令隔离、修饰键、IME、已处理事件、输入目标、按住重复、真实布局几何和只读限制、复制删除撤销、世界轴四元数与锁定。
- 全量 `pnpm exec vitest run --maxWorkers=1`：47 个文件、658 项通过。随后修复视图请求重新挂载重放、保留搜索期间的镜头快捷键；最终针对性复测 18 个文件、186 项通过，生产构建通过。
- 3D 页面：ArrowRight / Shift ArrowUp / PageUp 从 (70.4,20,6) 到 (71.4,30,7)；R 旋转成功且撤销仅恢复旋转；L 锁定后方向键不移动；Delete 移出仅保留库并能撤销；T/B 显示状态切换正确。
- 2D 页面：SVG 坐标从 (6,6) 到 (7,16)，即向右 1 mm、向上 10 mm；R 到 90°；L 锁定后轮廓不变；原图 Delete 不删除；当前排版 Delete 删除并可撤销；Cmd D 复制一个且 Cmd Z 恢复。
- F 定位所选，0 复位后 + 到 120%。切到 3D 后按 0/M 再切回，2D 仍为 120% 且磁吸保持开启；3D 坐标未被 2D 微调改动。
- 浏览器复现并修复 StockCanvas 重挂载重放旧 zoom-in：使用已消费 seq 拦截，返回当前排版保持新画布 100%，一次 + 到 120%。独立审查复核通过。
- 搜索输入中输入 m/Delete/方向键未修改场景；帮助弹窗中 Delete/M 未删除选中零件或切换磁吸；Cmd O / Cmd Shift E 分别打开导入 / 导出弹窗。
- 原生键盘实测 H/V 工具切换、Shift Slash 打开帮助、Option 3 切换三维、7 上视图及 + 放大。拖动期间的键盘捕获保护由源码审查覆盖，未进行同时按住鼠标的原生键盘实测。
- 页面证据：`docs/design/workspace-shortcuts-help.png`、`docs/design/workspace-shortcuts-modes.png`；独立只读审查无阻断问题。

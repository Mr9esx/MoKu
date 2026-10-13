# 通用 DXF 导入实施计划 · 2026-10-12

目标：任意图层先读取为本地几何草稿，通过图层/轮廓用途核对后构建 Project，兼容现有示例，不增加图层名称特例。

架构：dxf-parser 解码 → drawingDocument 归一几何 → drawingReview 用途/诊断 → project 构建。Worker 负责读取；界面核对是草稿编辑，确认才写工作区。沿用原有材料、板厚、单位、间距和几何验证。

## 约束

- 文件只在浏览器本机处理；当前目录已有用户改动，原地编辑，不重置、不提交其他工作。
- 不确定内环不能自动变通孔；未知实体必须留诊断，不能静默漏件。
- 同文件重解析保留输入；不同文件重置核对。保存命名配置只能保存规则，不能保存图纸。
- 0.025 mm 曲线采样误差、4096/50000 顶点预算、1000 件上限继续约束实际转换。

## 任务 1：文档与几何草稿

文件：新增 src/core/drawingDocument.ts、tests/drawing-import.test.ts；提取 src/core/dxf.ts 几何和领域构建边界。

接口：`readDrawing(text, name, options): DrawingDocument`，输出带稳定 id、图层、空间、闭合状态、源实体和诊断的路径/文字；`DrawingDocument` 与 `Project` 分离。

- [x] 先测试任意图层名能读取原尺寸，未确定的内环仍保留，视口/标注不会成为零件，未知加工实体有诊断。
- [x] 实现实体归一，展开块（含基点/旋转/镜像/缩放/实例 id），椭圆与样条离散；开放链留诊断；空间筛选和原始坐标检查。
- [x] 运行新用例和现有 DXF 用例，核对实际位置、面积、数量以及非平面/预算拒绝。

## 任务 2：用途核对及领域构建

文件：新增 src/core/drawingReview.ts，修改 src/core/dxf.ts（薄的直接导入入口），保留纯领域构建和编号关联。

接口：`compileDrawing(document, options, layerRules, shapeRules): Project`；规则 role 为 unknown/outer/hole/pocket/stock/ignore，depth 与 thickness 是单独数值。未确定或加工诊断阻止编译，仍可读取草稿。

- [x] 测试同名任意图层映射后可导入，混合图层按轮廓覆盖、明确排除辅助线、缺槽深/重复轮廓/归属冲突不能提交。
- [x] 把现有命名约定改为兼容预设，原图层名和 id 保留；任何候选名称不直接决定深度/板厚。
- [x] 运行既有事务/源图/排版回归；使用层级核对构建原坐标的 Project。

## 任务 3：Worker、事务、核对界面与模板

文件：src/core/import.worker.ts、src/import.ts、src/store.ts、src/components/ImportPreview.tsx；新增源图预览/图层核对组件，src/styles.css。

- [x] Store 单独保存 DrawingDocument 草稿；旧 previewImport 调用仍兼容测试，cancel/失败/迟到消息不影响当前项目。
- [x] 源图先展示全部路径，模型/布局选择，图层行批量选择用途；点击图层高亮，点击轮廓可单独覆盖；仅未确定字段要求核对。
- [x] 原单位/厚度/材质分别确认；命名模板保存规则并可重用，同文件重解析保留人工设置。当前示例直接显示已识别的旧预设。
- [x] 浏览器验证陌生图层文件、同层内外环、普通文件/示例、图层与单轮廓覆盖、取消/确认、窄屏固定操作栏；模板保存/恢复通过纯函数用例验证。
- [x] 运行 TypeScript/Vite、全量 Vitest、git diff --check，更新支持范围及浏览器截图。


## 实施结果

- 新增 drawingDocument / drawingCurves / drawingReview / drawingProject / drawingTemplates；旧 dxf.ts 变为兼容入口。领域几何归属检查独立提取，未修改 SVGnest 排版算法。
- 新增 29 个文档几何测试、11 个语义/事务回归及 32 个模板用例。全量 25 文件、343 项通过（串行运行以避免并发构建/几何测试干扰原有 2 秒性能断言），TypeScript/Vite 与 diff 检查通过。
- 浏览器验证任意 TOP-CUT-INSIDE 图层与另一普通 Router 图层，逐层与逐个映射产生真实 100×70 mm 零件、圆孔和 3 mm 椭圆槽；确认后仅新增待放置零件，不虚构板材。相同文件切换厘米得到 200×100 mm 且保留 12 mm 手工板厚，更换文件恢复 20×10 mm 与自动声明单位、清空旧元数据。
- 模板保存/恢复及恶意配置边界由纯函数用例验证，不往用户 localStorage 写测试模板。320×740 浏览器下文档宽 320、弹窗宽 296，无横向溢出；操作区与滚动内容相距 16 px。控制台无 warning/error。
- 原示例仍为 3 板 / 53 件 / 28 孔 / 29 槽，坐标与面积通过独立旧用例复核。用户原始 CAD 文件本轮未作为测试输入，不能据此保证所有 CAD 画法已支持。
- 截图：import-generic-review.png、import-generic-confirmed.png、import-generic-mobile.png。

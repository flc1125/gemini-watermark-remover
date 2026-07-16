# 同 Anchor 低瑕疵候选视觉诊断设计

## 背景

最新 424 张近期样本报告中仍有 111 张被归类为 `residual-risk`。它们不是单一暗色问题：参考区域亮度分布为暗背景 37 张、中间亮度 13 张、亮背景 61 张；其中 96/192/192 与 48/96/96 两个标准几何簇合计 67 张，说明下一步的主要矛盾并非普遍定位失败。

利用新增的 `qualitySignals.imperfections` 重新检查 top-N 后，发现 26/111 张同时满足：

- 候选与当前 top-1 的最终 `x/y/width/height` 完全相同；
- 候选 `imperfections.score` 更低；
- 候选 `evidenceLoss` 不高于当前值加 `0.05`；
- 候选 `damageLoss` 不高于当前值加 `0.05`。

这 26 张平均可降低约 `0.68` 的 imperfection score，24 张表现为固定/高优先候选压住了后生成候选。但状态变化主要是 `clean → clean` 或 `visible-residual → visible-residual`，粗粒度 `qualityStatus` 无法证明实际视觉更好。此前定点样本也已证明，较低聚合分数可能把深色实体残影转换为亮色边缘残影，因此不能直接把“最低 imperfection score”上线为排序规则。

## 目标

- 对这 26 张样本生成可复跑的“原图、当前 top-1、同 anchor 低瑕疵候选”三联图。
- 保留每个候选的结构化 anchor、family、source、alpha/profile、quality losses、imperfection components 和输出像素。
- 将视觉结论标成 `alternative-better`、`tie` 或 `current-better`，识别可安全推广的同质子簇。
- 测量现有候选池的真实排序改善上限，再决定是否设计生产排序规则。

本轮是诊断阶段，不改变生产 top-1、处理结果、retry、fail-closed 或候选生成。

## 方案比较

### 方案 A：诊断采集回调与 26 张三联图（采用）

在候选执行完成后提供一个默认关闭的同步诊断回调。回调只把结构化 hypothesis、quality signals 和候选输出交给本地诊断脚本，不写入公开 meta，也不改变默认执行路径。脚本据此生成三联图和报告。

优点是可以直接看到当前与备选的真实像素差异，结论可复跑；默认行为不变。代价是需要增加一个小型诊断接口和专用 runner。

### 方案 B：直接让 imperfection score 参与生产排序

实现最短，但会在没有视觉证据时把暗洞、亮边和梯度残影压成单一标量。已有样本说明这种替换可能只是瑕疵类型转换，因此不采用。

### 方案 C：立即开发 48/96 或 96/192 新 alpha/render 模型

可能帮助候选池内没有更好解的约 85 张样本，但会混淆“已有好候选未选中”和“候选生成能力不足”两个问题。应在测清排序上限后再做，因此本轮不采用。

## 诊断接口

### 回调位置

`runImageWatermarkPipeline()` 已在每个 hypothesis 执行后得到：

- `hypothesis`；
- `completedCandidate.result.imageData`；
- `qualitySignals`。

在上述对象形成后调用可选的 `options.onCandidateCompleted(candidate)`。默认不传回调时不做额外复制、不向 meta 暴露 ImageData、不增加候选数量。

### 回调约束

- 回调只用于本地诊断，不作为稳定 SDK 输出契约。
- 回调收到同步对象引用；需要保留像素时由调用者立即编码或自行复制。
- 回调异常不得把一个成功候选改成 execution failure，也不得改变最终排序。异常计数只在 debug timings 中记录为 `candidateDiagnosticErrorCount`。
- 不把候选 ImageData 塞入 `candidateSummaries`，防止元数据体积和内存泄漏。

## 26 张筛选规则

诊断 runner 读取当前 424 报告，只处理 `classification === 'residual-risk'` 的记录。每张重新执行当前生产管线并捕获 completed candidates，然后使用结构化 `hypothesis.trial.position ?? hypothesis.position` 比较 anchor，不解析 candidate ID。

对每张图：

1. 用最终 `meta.selectedCandidate.id` 找到当前 top-1 捕获对象；
2. 限定与当前 top-1 的 `x/y/width/height` 完全相同；
3. 限定 `imperfections.score` 更低；
4. 限定 `evidenceLoss <= selected.evidenceLoss + 0.05`；
5. 限定 `damageLoss <= selected.damageLoss + 0.05`；
6. 从剩余候选中选择 imperfection score 最低者作为视觉对照。

`0.05` 仅是诊断集筛选容差，不是生产排序阈值。若重跑后样本不再满足条件，报告为 `not-reproduced`，不得静默换入其他 anchor。

## 产物

输出目录：

` .artifacts/same-anchor-imperfection-review/ `

包含：

- `report.json`：输入报告哈希、样本计数、候选身份、结构化 anchor、所有相关质量信号和视觉结论；
- `triplets/<basename>.png`：原图、当前 top-1、备选候选的同区域等比例裁剪；
- `contact-sheet.png`：26 张总览，按 48/96、96/192、其他几何分组；
- `review.json`：每张 `alternative-better | tie | current-better | unclear` 与简短原因；
- `summary.json`：按几何、背景亮度、残影类型、family 转换汇总人工结论。

三联图每列使用相同 crop、缩放算法和颜色编码，不加会遮挡像素的标签；候选身份写入相邻 JSON。

## 数据流

424 报告 → 识别诊断候选范围 → 逐图运行当前管线并通过回调捕获全部 completed candidates → 结构化同 anchor 筛选 → 编码当前/备选输出 → 生成三联图与总览 → 视觉复核 → 按子簇汇总结论。

诊断 runner 不修改源样本、gold baseline、生产输出或 424 合并报告。

## 测试与验收

### 自动测试

- 未提供回调时，管线结果与当前行为完全一致。
- 回调对每个成功 completed candidate 调用一次，包含 hypothesis、result 和 qualitySignals。
- 回调抛错时，候选仍保留并正常参与排序；debug timings 增加错误计数。
- 失败候选不调用 completed callback。
- runner 使用结构化位置判断同 anchor，不使用 candidate ID 解析。

### 数据验收

- 当前报告识别的 26 张全部进入 runner；若数量变化，报告差异而不是硬凑 26 张。
- 每张 current candidate ID 与生产结果一致。
- 每张 alternative 与 current anchor 完全相同。
- 每张都生成可读取三联图，且没有尺寸错位。
- 报告保留 evidence、residual、damage、imperfection score/components 的前后差值。

### 视觉验收

- 每张必须检查星形主体、四个尖角、alpha 边缘、黑洞、白边、纹理损伤和邻近真实内容。
- `alternative-better` 必须是整体可见瑕疵更弱，不能只因某个指标降低。
- `tie` 表示正常观看尺度难以区分，不用放大噪点强行分胜负。
- `unclear` 不得进入后续生产规则训练或阈值推导。

## 后续决策门

完成 26 张复核后再选择下一条路线：

- 若存在特征一致、视觉胜率高且没有 current-better 的子簇，为该子簇单独编写生产排序设计；
- 若低 imperfection 候选经常只是残影类型转换，保持现有排序，调整 imperfection 表达或研究感知评分；
- 对没有可用备选的剩余样本，再按 48/96、96/192、背景亮度和残影形态进入 alpha edge / antialiasing / render-model 调查。

本规格不预设 26 张都应换候选，也不把诊断筛选容差直接生产化。

## 非目标

- 不修改 discovery penalty、final score 权重或 clean dominance 规则。
- 不新增 alpha gain/profile、定位候选或后处理算法。
- 不更新 gold baseline。
- 不扩大到跨 anchor 候选比较。
- 不向用户界面展示诊断回调或原始候选像素。

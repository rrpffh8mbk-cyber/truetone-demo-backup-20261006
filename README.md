# TrueTone — Consumer Trust & Virtual Try-on Demo

这是欧莱雅美妆科技黑客松 TrueTone 的**完整消费者端 Demo 骨架**，不再是轻量色号卡片展示。

公开预览：
https://rrpffh8mbk-cyber.github.io/truetone-demo/

## 消费者主流程

首页从购买决策出发，只有三个核心入口：

1. **上传自拍，看看色号在当前照片中可能怎么呈现**
2. **上传试色图片，核验内容是否值得参考**
3. **搜索已有色号，查看跨平台真实性 / 参考价值报告**

另有：
- 色号对比
- 相似色号方向推荐
- Top 3 最值得参考证据
- 深唇 / 浅唇 / 素颜反馈筛选
- SKU / product line 边界提示
- 社媒 vs 电商颜色趋势
- 消费者色差关键词与复购/负向体验权重
- 创作者 / 品牌透明度建议

## 真实分析模块

公开版不是随机 UI。

- `agents.js`：基于 MediaPipe 唇部遮罩的真实像素 HSV/亮度/饱和度分析（支持蓝色、紫色等非红色唇色）、环形 Hue 距离、固定评分规则、跨图一致性、消费者报告与 Agent 4 建议
- `lips.js`：分析与试妆共用的 Face Mesh 识别、最大人脸选择和 outer lip − inner mouth 遮罩；未识别到唇部时不生成唇色评分
- `tests/lips-regression.html`：唇部 ROI 浏览器回归检查，运行方法见 `tests/README.md`
- `tryon.js`：MediaPipe Face Mesh 唇部 landmarks，outer lip − inner mouth polygon mask，局部 alpha blending；不做人脸身份识别
- `prompts/TRUE_TONE_AGENT_SYSTEM.md`：后续在 Base44 backend 中使用的最终 runtime system instructions
- `DATA_PROVENANCE.md`：当前数据来源、统计规模与公开版边界

## 数据

完整离线结构化处理覆盖：
- YSL #610
- YSL #1936
- Lancôme #274
- Lancôme #275
- 小红书 + 淘宝评论 / 问大家 / SKU / 图片与视频元数据

公开 GitHub Pages 不无差别重发团队抓取的全部高分辨率图片和原视频；原始大文件应转入 Base44 Storage / 对象存储。页面不会为了“看起来完整”而伪造媒体、评论或评测指标。

## Base44 / Base Code

建议直接连接本仓库。下一阶段由 Base44 提供安全 backend / storage，把：
`TRUE_TONE_AGENT_SYSTEM.md` → runtime Agent
并把完整原始媒体文件放进受控 Storage，而不是暴露 API key 或所有原图在 GitHub Pages。

## Ground Truth

项目计划中的人工 ground truth 尚未随原始数据包完成，因此当前版本不会虚构 Accuracy / F1 / 人工一致率。

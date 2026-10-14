# Ulia 旧版接入：线上发布候选

2026-10-13。候选已发布并安装；本记录保留精确发布范围、候选验证和线上核对结果。

## 已核对的目标

- Heroku 应用：`guiidata`，当前生产 release **v81**，源码基线 `86172a7bcf7e37716d9c2747ce64b4a5706c9820`。
- 课程：ID **133** / `cmpm80h-wi27`，`CMPM 80H — Human Centered AI (Winter 2027)`，教师 **Mimi Rapoport**。
- 当前有一份 Week 0 test survey，ID277 / public ID `IWGjrx7F38MQ`。保留这份问卷及已有回答。
- 线上两套 `ulia-conversational-v1` / `ulia-likert-v1` 尚不存在，尚未绑定目标课程。
- 课程原有 Word 与证书下载均已开启，referral关闭；此次保持其设置。
- 线上 `oaiKey` 已配置；仅检查存在性，没有读取或输出其内容。

## 待批准的精确发布与安装

1. 将这次 scoped backend archive 发布到 `guiidata`，以v81为基线。仅包含旧接口适配、迁移0045、实际 orchestrator及其纯验证依赖，两套原始fixtures和安装命令。保留旧 Django4.2.7、Procfile、其他接口与已有默认模型；不发布当前 backend/main 的19个其他未推送commit，不升级到React/canonical部署。
2. 在静态站点 `GUII-Lab/GUII-Lab.github.io` 当前main发布本次8个文件：6个产品文件和2个回归测试。保留原界面和全站其他内容；`leai-formmode.js` 只包含本次3个 server-answer renderer分支，不带入原工作区的其他未提交改动。未新建分支。
3. 只新增迁移 `datapipeline.0045_legacy_orchestration`。它新增两张状态/receipt表及FeedbackMessage可空字段与约束，不迁移或改写已有回答。
4. 在该应用设置 `LEAI_LEGACY_ORCHESTRATION_ENABLED=1` 与 `LEAI_LEGACY_ORCHESTRATION_COURSES=cmpm80h-wi27`，只允许这节课启用。
5. 执行一次安装命令的read-only dry-run，再 `install_legacy_ulia_reflections cmpm80h-wi27 --apply`。新增两份独立Ulia问卷，随后逐条读回课程/schema/public ID/数量并验证原界面链接。遇到schema冲突或重复歧义会中止。
6. 发布后验证线上资源hash、旧Week0问卷仍存在、两份新问卷入口和provider路径，再交付两条确认的链接。真实学生数据不用于测试。

## 候选验证

- 完整后端：**319/319 PASS**（生产基线依赖，非原工作区923套件）。
- 完整前端Node：**74/74 PASS**（干净发布基线，非原工作区98套件）；Python **14/14 PASS**。
- Django check / migration drift check通过。`collectstatic`通过：125文件copied，375post-processed。
- 发布候选实页 **8项PASS**：两套冻结会话和原Word/PDF下载，一个新真实provider回合，Analyzer修改后的评分，Firefox/WebKit390×844两套恢复。没有provider mock。
- 两份DOCX逐项匹配原始11题与当前冻结答案；两份证书均一页、无回答内容。数据库读回52messages/24student/24receipts/22results/2certificates，范围只限这两个已完成synthetic session。
- 初次脚本错误地假设同一浏览器会话再次显示consent；页面正确恢复了已完成会话。另一次候选启动未加载本地provider配置而503。已修正验证脚本/本地启动环境后PASS，两次失败记录保留，未改产品代码掩盖失败。
- 物理mic/touch、native Word布局未验；已知Minor storage恢复提示仍延后。这些边界没有因为candidate验证而消失。

## 冻结产物

候选目录：`.web-verify/ulia-release-20261013/`。`manifest.json`列出每个变更文件SHA256；`hosted-readback.json`记录线上只读核对；`browser-evidence/evidence.json`及`database-output-audit.json`记录实页与输出核验。

后端archive SHA256：`febbdd0f7f77aafebcb9e2a6b167cb349982ae46a3d095fb1aa1a893a17004fd`。

发布将使用现有Heroku登录和[官方source/build API](https://devcenter.heroku.com/articles/build-and-release-using-the-api)，避免把本地main额外commit推入生产。build成功会自动release，故未提前调用build API。此候选验证只证明本地runtime，不等于线上安装完成。

## 实际发布结果

用户已批准发布与安装。Heroku v82代码/v83配置成功，Pages commit15dd98fa与workflow38493227035成功；22后端/8前端文件hash逐项匹配。course133现有3问卷：Week0保留，新增[Ulia conversational](https://guii-lab.github.io/LEAI/feedback.html?id=K4Nd9vJOEGGv)与[Ulia Likert](https://guii-lab.github.io/LEAI/feedback.html?id=A6KreGhTnRlg)，完整schema与重复只读安装检查一致。

线上6入口和2次真实provider首题内存检查通过。另经用户授权，发布后对正式两问卷各运行一个临时合成完整对话：20项 scoped criteria 全部通过，涵盖两种 schema、真实 AI 对话、澄清/跳过/模糊评分/否定回答、答案修订、刷新恢复、幂等重放、stale 409、Word/PDF、证书及 Firefox/WebKit mobile restoration。每个 session 28 条消息、13 条学生回合、13 个 receipts、11 项结果、1 个证书；输出逐项核对。测试后清除 2 个 session、56 条消息、26 个 receipts、2 个测试证书；独立回读为 0，正式的 3 份问卷保留。临时测试报告、截图、转录和候选副本在 wrap-up 清除。

生产发布记录：Heroku `guiidata` v82 代码、v83 配置；GitHub Pages commit `15dd98fa04f3321be311d1600a1e0b138306c517`。没有发布 backend 原有的 19 个无关本地 commits。两条正式入口：

- conversational: https://guii-lab.github.io/LEAI/feedback.html?id=K4Nd9vJOEGGv
- Likert: https://guii-lab.github.io/LEAI/feedback.html?id=A6KreGhTnRlg

物理 mic/touch 与原生 Word 排版仍未测；两组测试只支持已列出的行为，不代表全局模型正确率。

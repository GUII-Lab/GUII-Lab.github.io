# 旧版 LEAI：可读 debug 发布候选

验证收尾：2026-10-14。

状态：本地实现与验证完成；尚未发布。目标只为 `cmpm80h-wi27`，保留旧 HTML 界面及两套 Ulia 问卷。

## 研究员看到什么

面板沿用之前 React 版名称 **Recorded schema state**。

- 聊天首先展示当前阶段、题目原文及序号、本轮动作、下一步和已记录题数。真实请求中显示“Waiting for the server”，响应保存后显示新的已保存阶段。
- review 显示同一份已保存记录；每个回合可展开看之前/之后的阶段、结果变化、答案消息编号和覆盖目标。评分包含真实量表文字；未回答、部分回答、拒绝回答、不知道和不适用分别显示。
- 模型及耗时属于可展开的辅助信息。没有常驻 JSON 或代码块；**Export debug JSON** 下载完整记录。
- OFF 期间的缺失记录明确标出，不重构旧历史。准备 review 与已提交是两个不同阶段。

## 权限与保存范围

现有课程密码登录视为 Researcher；不新增角色。后端签发八小时、限定课程的 token，密码变化会撤销它。生产使用独立 `LEAI_LEGACY_DEBUG_SIGNING_KEY` 配置；缺少配置就不签发 debug 权限，不沿用旧源码中的 Django 签名密钥。学生请求不携带 debug token，不获得 debug 状态。

课程开关默认 OFF；生产 allowlist 仅 `cmpm80h-wi27`。成功回合的状态与消息/重试收据在同一事务保存；失败、过期请求与非法输入只记录事件，不保存被拒绝的回答。关闭 debug 后正常聊天仍可保存回答。

## 已验证证据与边界

- 当前真实生产基线 `guiidata` v83，slug `c5b45cce-601c-4fb4-96fc-e9c00c4b0e6b`。生产源码读取曾被自动审批拒绝；用户之后明确批准只读传输，已仅保存到本机私有目录，线上没有更改。
- 实际生产源码加本次改动的候选：**334 tests PASS**，生产 `requirements.txt`、本机 Python **3.12.8**，保留生产 `.python-version=3.12`；Django check、migration drift check PASS。
- 更完整的本地冻结后端：**938 tests PASS**。
- 前端相关测试 **13 PASS**；完整 Node **92 PASS / 12 blocked**，阻塞均为既有 V12 原型测试缺少指定 Puppeteer Chrome 程序。旧静态站没有 build 步骤。前端 Python 17 项此前通过，相关源码未修改。
- 实际 Chrome 聊天验证两套本地问卷；应用内浏览器实际 Analyzer review 验证 11 题完整换行、无 JSON 展示块、无面板横向溢出。
- 在原有本地文本测试会话提交第三条回答：实时“Waiting for the server”后更新到 P4、version4、3/11 recorded；review 读同一服务端状态。此前非法输入没有推进状态；Likert 4 显示为 4 — Agree；关闭期间的历史缺口有明确提示。
- JSON 按钮实际下载文件；读回文件的会话版本、题目数与事件数一致，未包含认证 token。没有截图或录屏。
- 原本已批准的本地文本会话继续完成全 11 题：前三题认真回答、其余明确拒答。真实文档下载触发提交后无需刷新就显示 Submitted；review 同样显示 version12 / 14 events / 11 results。独立数据库核对：2 sessions / 30 messages / 13 receipts / 16 debug events，两段研究同意均为 false。临时开启的本地下载设置已恢复。
- 独立审查发现并修复了提交后不刷新、NULL 课程错误回归和 finalization 读取旧开关的问题；回归测试先失败后通过，二次审查未发现剩余 Important 问题。
- 没有线上 debug 验收、移动端/独立 WebKit/Firefox 验收或完整十一题 Likert 浏览器运行声明。原有六段生产测试对话仍保留；不能补出过去未保存的 debug 事件。

## 待批准的发布动作

1. 使用已有 Heroku 连接配置专用 debug 签名密钥（只在私有环境变量中生成/保存）与 `LEAI_LEGACY_DEBUG_COURSES=cmpm80h-wi27`。
2. 以 v83 为基线，通过 Heroku source/build API 发布本机私有 archive。只改变下述 9 个后端文件；保留原 Django、Python 主版本、Procfile、其他服务及配置。原 Procfile 已有 release-phase `python manage.py migrate`，候选只新增 migration0046，迁移成功后新 web release 才接收请求。
3. 将前端这次六个产品文件和对应测试/阶段说明的 focused commits 发布到 GitHub Pages；不带入其他工作区改动，不推送 backend/main 的其他未发布 commit。
4. 只为 `cmpm80h-wi27` 开启持久开关，核对唯一课程、其他课程默认 OFF；检查线上教师 login/settings、学生无 debug、聊天/review/导出同源记录。现有 Week 0 问卷、回答与六轮测试日志保留。

后端变更：`datapipeline/leai_legacy_debug.py`、`leai_legacy_orchestration.py`、`leai_legacy_orchestration_views.py`、`models.py`、`urls.py`、`views.py`、`migrations/0046_legacy_debug.py`、`tests/test_legacy_debug.py`、`guiidatapipelines/settings.py`。

前端产品文件：`LEAI/leai-debug.js`、`leai-shared.js`、`leai-orchestration.js`、`feedback.html`、`FeedbackAnalyzer.html`、`PromptDesigner.html`。

候选 archive SHA256：`311df6e9fb91397c8fc203eeed5f8af76e218ba96d858b8db6935329f27d5e85`。

私有证据与逐文件 SHA256：`.context/ulia-debug-2026-10-13/`。候选、凭据、原始测试对话及全量 debug 导出不放进 Git/Linear。

本地 source commits：frontend `02acd9c`；backend `b8c11ce`。均未推送或发布。

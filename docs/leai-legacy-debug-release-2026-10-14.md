# 旧版 LEAI：可读 debug 发布与六轮重测

验证收尾：2026-10-14。

状态：用户授权的 scoped 发布与六轮真实浏览器重测已完成。仅 `cmpm80h-wi27` 开启 debug；旧 HTML 界面及两套 Ulia 问卷保留。

发布前 2026-10-14 线上只读核对：当时为 guiidata v83 / migration0045，debug 表不存在。原六段测试共 192 条消息，未保存历史逐回合状态，不能补写为当时记录。用户授权：没有记录则重跑六段并软删除旧六段。新增软归档保留数据库原行、消息编号、状态和收据；默认查询／分析／恢复入口隐藏，受保护管理命令可恢复。只处理已核对的六段，消息数量必须仍为 192 才允许写入。

## 本次线上结果

- Heroku **v85** 发布成功，migration0046/0047 已应用；仅课程 133 / `cmpm80h-wi27` debug ON，version2，其他课程 OFF。
- GitHub Pages 产品 revision **dd4050fd30716fe4f04182a6924f1b70c59b9877**；workflow38592750320成功，七个产品文件与已提交内容逐字节相同。未推送 backend/main 的其他未发布工作。
- 按用户最新顺序，先软归档旧六段，再在实际生产页面用原测试回答重跑两套问卷 × 认真／rude／没想法。六段均到达全11题的 review 阶段；未触发最终文档下载/提交。
- 新六段共 **85条学生回答、182条消息、93条状态事件**。独立数据库逐条核对消息序号、学生/AI关联、处理前后版本、收据、原回答来源；**182/182消息有对应真实记录，缺口0**。开场两条AI消息共用initial state，其余每对学生/AI消息关联同一回合的JSON。
- 认真、rude、没想法分别为 Conversational 26/24/36条消息、Rate and reflect 26/24/46条消息。没有想法的评分轮没有编造未提供的分数；认真评分轮全部保存4。可选研究同意六段均false。
- Conversational没想法轮有两次真实请求失败，原输入通过页面Send重试恢复；失败事件保留、状态没有推进、成功回答没有重复保存。完整结束证明记录和恢复通过，不代替研究员对追问措辞和对话效果的判断。
- 结束后再查旧记录：**6段/192条全部仍保留且已软归档**，归档时间早于新六段开始。其他课程和Week0问卷未处理。
- 实际浏览器刷新新认真聊天，26条消息和完成状态全部恢复；匿名学生可见debug为0。刷新后数据库总数仍182/93，无重复。当前生产教师登录后的逐回复面板/导出未在本次重测中实际操作，不能以本地验证代替这项验收。
- 本次无截图、录屏。原六轮的本地比较/标注材料保留，没有静默替换；新会话清单与逐条核对收据在本机忽略目录中。

## 研究员看到什么

面板沿用之前 React 版名称 **Recorded schema state**。

- 聊天首先展示当前阶段、题目原文及序号、本轮动作、下一步和已记录题数。真实请求中显示“Waiting for the server”，响应保存后显示新的已保存阶段。
- 每条 AI 回复下面显示该回复对应的已保存状态；展开可看之前/之后的阶段、结果变化、答案消息编号和覆盖目标。通过 resume link 重访同一聊天即可 review。评分包含真实量表文字；未回答、部分回答、拒绝回答、不知道和不适用分别显示。
- 一个回合的 JSON 关联学生消息与 AI 回复编号，保存处理前／后的状态、动作、版本与时间；开场两条 AI 消息共享真实保存的 initial state。按实际消息／回合记录，不把正文每个句子重复存成独立状态。
- Analyzer 消息历史不展示 schema/debug，保留 resume link；题目／答案汇总默认折叠。课程开关移到 Customizations 的 Experimental 弹窗，使用原有 Save 按钮。
- 模型及耗时属于可展开的辅助信息。没有常驻 JSON 或代码块；**Export debug JSON** 下载完整记录。
- OFF 期间的缺失记录明确标出，不重构旧历史。准备 review 与已提交是两个不同阶段。

## 权限与保存范围

现有课程密码登录视为 Researcher；不新增角色。后端签发八小时、限定课程的 token，密码变化会撤销它。生产使用独立 `LEAI_LEGACY_DEBUG_SIGNING_KEY` 配置；缺少配置就不签发 debug 权限，不沿用旧源码中的 Django 签名密钥。学生请求不携带 debug token，不获得 debug 状态。

课程开关默认 OFF；生产 allowlist 仅 `cmpm80h-wi27`。成功回合的状态与消息/重试收据在同一事务保存；失败、过期请求与非法输入只记录事件，不保存被拒绝的回答。关闭 debug 后正常聊天仍可保存回答。

## 已验证证据与边界

- 发布前真实生产基线 `guiidata` v83，slug `c5b45cce-601c-4fb4-96fc-e9c00c4b0e6b`。生产源码读取曾被自动审批拒绝；用户之后明确批准只读传输，已仅保存到本机私有目录，线上没有更改。
- 实际生产源码加最新 debug／软归档的候选：**338 tests PASS**，保留原生产 `requirements.txt`、`.python-version=3.12` 和 Procfile；Django check、migration drift check PASS。软归档默认 dry-run、精确课程／全部 session／消息数量保护、原行恢复、读路径隐藏、处理中归档拒绝迟到回答都有回归测试。
- 前期更完整的本地冻结后端 **938 tests PASS** 属于 debug 版，未包含后加的软归档；最新归档验证以实际生产基线的 338 项为准。
- 最新前端 debug／transport **14 PASS**；完整 Node **94 PASS / 12 failures**，失败均为既有 V12 原型测试缺少指定 Puppeteer Chrome 程序。旧静态站没有 build 步骤。前端 Python 17 项此前通过，相关源码未修改。
- 实际 Chrome 聊天验证两套本地问卷；应用内浏览器实际 Analyzer review 验证 11 题完整换行、无 JSON 展示块、无面板横向溢出。
- 在原有本地文本测试会话提交第三条回答：实时“Waiting for the server”后更新到 P4、version4、3/11 recorded；review 读同一服务端状态。此前非法输入没有推进状态；Likert 4 显示为 4 — Agree；关闭期间的历史缺口有明确提示。
- JSON 按钮实际下载文件；读回文件的会话版本、题目数与事件数一致，未包含认证 token。没有截图或录屏。
- 原本已批准的本地文本会话继续完成全 11 题：前三题认真回答、其余明确拒答。真实文档下载触发提交后无需刷新就显示 Submitted；review 同样显示 version12 / 14 events / 11 results。独立数据库核对：2 sessions / 30 messages / 13 receipts / 16 debug events，两段研究同意均为 false。临时开启的本地下载设置已恢复。
- 独立审查发现并修复了提交后不刷新、NULL 课程错误回归和 finalization 读取旧开关的问题；回归测试先失败后通过，二次审查未发现剩余 Important 问题。
- 最新应用内浏览器真实 Customizations：Experimental 开关 OFF→Save→重开仍 OFF，ON→Save→重开仍 ON；其余三个设置保持关闭。真实 Analyzer：答案汇总默认折叠，展开保留全部 11 题，resume link 按钮仍在，debug 面板为零。独立数据库仍为 2 sessions / 30 messages / 13 receipts / 16 debug events，课程 debug ON、配置 version6；研究同意仍 false。提示文字对比度已修复，新增 debug 长标签使用正常大小写（真实浏览器 13.6px / text-transform:none）。
- 后续设计 hook 的 10 项提示已分流：新增 debug 大写标签已修复；原有 4 条大写长标签和 2 处 10.56px 预览文字保留待用户确认扩展修复范围。仅为本页登记 3 个例外：保留原版 Inter 字体和 LEAI 登录品牌标识、忽略未用于本页的共享紫色色盘规则误报。没有全局关闭规则、没有隐藏上述 6 项实际可读性提示；原有阴影／条纹两条 advisory 保留。
- 逐回复映射、历史缺口和配置版本冲突的回归测试通过；最新五文件独立代码审查未发现 Important 问题。新开的本地聊天页要求重新勾选 Terms / Privacy，已请求确认但尚未勾选；本次逐回复浏览器验证尚未执行，不以先前整体面板验证代替。
- 软归档独立审查发现：过滤 Manager 会使旧单条／bulk 写入保护漏掉归档会话，改绑 schema 后可重新写入。已以真实已注册端点重现、改用 all_objects 保护、回归通过并复审关闭。最终新入口返回 410 session_archived，旧链接显示归档提示；不会承诺重试可保存。开场序号 1 映射到真实 started event，缺失事件仍显示 unavailable。最终复审未发现新的具体问题。
- 早期本地阶段尚无线上 debug 验收或完整十一题 Likert 浏览器运行。当前六段生产数据记录和11题对话验收见上方线上结果；本次未新增移动端/独立 WebKit/Firefox或生产教师面板验收。旧六段已软归档保留，不能补出过去未保存的 debug 事件。

## 已授权并执行的发布范围（原候选）

1. 使用已有 Heroku 连接配置专用 debug 签名密钥（只在私有环境变量中生成/保存）与 `LEAI_LEGACY_DEBUG_COURSES=cmpm80h-wi27`。
2. 以 v83 为基线，通过 Heroku source/build API 发布本机私有 archive。只改变下述 12 个后端文件；保留原 Django、Python 主版本、Procfile、其他服务及配置。原 Procfile 已有 release-phase `python manage.py migrate`，候选新增 migration0046（debug）和0047（可恢复归档），迁移成功后新 web release 才接收请求。
3. 将前端这次七个产品文件和对应测试/阶段说明的 focused commits 发布到 GitHub Pages；不带入其他工作区改动，不推送 backend/main 的其他未发布 commit。
4. 只为 `cmpm80h-wi27` 开启持久开关，核对唯一课程、其他课程默认 OFF。用户最新明确顺序：**先软归档原六段及其 192 条消息，再重跑**。独立核对普通查询中已隐藏、原行与消息数仍保留、可恢复；不硬删，不处理其他课程／回答／Week 0 问卷。
5. 在浏览器上重新跑两套问卷 × 认真／rude／没想法，共六段完整合成对话。开始前确认本次 Terms／Privacy 勾选，可选研究同意保持关闭；不截图、不录屏。保存每条回答、每个回合 JSON 和对应消息编号，独立数据库核对所有消息与事件覆盖，没有缺口才算记录验收通过。对话质量按具体观察报告，不把完整结束当作表达效果通过。
6. 新六段确认全部消息／事件已保存，检查学生无 debug、聊天逐回复状态／resume review／导出同源记录。再核对原六段仍只软归档、原 192 条消息完整保留；重测证据与归档操作清单仅保存本机私有目录。

后端变更：`datapipeline/leai_legacy_debug.py`、`leai_legacy_orchestration.py`、`leai_legacy_orchestration_views.py`、`models.py`、`urls.py`、`views.py`、`migrations/0046_legacy_debug.py`、`migrations/0047_legacy_session_archive.py`、`management/commands/archive_legacy_sessions.py`、`tests/test_legacy_debug.py`、`tests/test_legacy_archive.py`、`guiidatapipelines/settings.py`。

前端产品文件：`LEAI/leai-debug.js`、`leai-shared.js`、`leai-orchestration.js`、`feedback.html`、`FeedbackAnalyzer.html`、`PromptDesigner.html`、`Customizations.html`。

最新 debug／archive 候选 SHA256：`d0783ef8dc2520517204be0c2c6a9d2267e9dd901ef316c12be5be54a2551c55`。原仅 debug 候选保留为历史快照，不再用于本次发布。

私有证据与逐文件 SHA256：`.context/ulia-debug-2026-10-13/`。候选、凭据、原始测试对话及全量 debug 导出不放进 Git/Linear。

Source commits：frontend `02acd9c`、`c8575cb`、`963aed4`、`dd4050f` 已随批准范围发布；backend `b8c11ce`、`db77701` 为 focused 本地提交，生产通过审核过的私有 archive 发布，未整体推送后端仓库。

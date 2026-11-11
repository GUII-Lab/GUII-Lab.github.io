# 原始 LEAI 静态前端接入 Ulia AI orchestrator

日期：2026-10-13。状态：已实现、发布并安装到目标 winter 80 课程；保留原静态界面。

## 用户已确认的目标

保留 `GUII-Lab.github.io/LEAI/` 静态 HTML 老版界面，接入已经做好的学生 AI orchestrator，使教师能选择、创建并使用 Ulia 的两套 schema。Linear 归属现有 **LEAI Instructor UI Modernization** 项目。

用户进一步指定将两套 schema 用到 winter 的 80 课程。课程身份需要通过真实记录或用户提供的准确 ID 核对，不能把测试 fixture 的 Winter 2027 标签当作线上课程身份。绑定只新增两套独立问卷，不替换已存在的 schema、survey 或学生回答。

“接入”包括教师选取 schema、学生实际聊天、后端保存每轮回答和状态、刷新恢复、按题查看与下载。不是仅将 JSON 加进下拉框，也不是迁移到 React。

## 当前源码依据

## 收尾结果

两套 Ulia schema 已经通过原 LEAI 学生页面接入现有 AI orchestrator，并安装到 `cmpm80h-wi27`。原 Week 0 问卷及回答保留。后端代码发布到 Heroku `guiidata`，GitHub Pages 前端发布为 focused commit `15dd98fa04f3321be311d1600a1e0b138306c517`。

发布后以两套正式问卷各运行一个临时合成对话，20 项 scoped 检查全部通过；两套对话覆盖澄清、跳过、模糊评分、否定回答、修改既有回答、刷新恢复、幂等重试、过期版本、Word/PDF 下载、证书锁定及 Firefox/WebKit 手机宽度恢复。检查后删除了本次测试的 2 个 session、56 条消息、26 条重试收据和 2 个测试证书；独立回读确认没有残留，正式问卷仍为 3 份。临时截图、对话记录和报告已在本阶段 wrap-up 清除。

尚未验证物理麦克风输入、触屏手势和原生 Word 页面排版；浏览器存储不可用时仍缺少明确恢复提示。详细计数和行为边界保存在本地 `.context/ulia-execution-ledger.md`，不保留测试参与者式逐字转录或截图。

前端：

- `LEAI/PromptDesigner.html`：已有 Structured Reflection 的 schema 选择、预览、创建、编辑及链接。
- `LEAI/feedback.html`：已有匿名 session、consent、聊天、dictation、恢复、进度、completion 和下载界面。
- `LEAI/leai-formmode.js`：旧 `sections.fields` 引擎，会在浏览器生成指令和推进状态；它不是本次要复用的新 orchestrator。
- `LEAI/leai-shared.js`：已有共享 API、会话和分析基础设施。

后端路径均相对于 `/Users/harveyli/Documents/GitHub/guiidatapipelines/`：

- `leai/fixtures/ulia_conversational.json` 与 `ulia_likert.json`：各有 Planning、Monitoring、Evaluation 三部分，按 P1–P4、M1–M4、E1–E3 排列 11 题。
- `datapipeline/orchestration_client.py`：真实 Responses orchestrator 调用，当前 prompt 版本为 `orchestrator-v6-conversational-likert`；包含语义更新、工具预算、修复、deadline 和 usage metrics。
- `leai/services/orchestration.py`：`TurnProposal`、`preview_proposal`，验证回答引用、覆盖、修改、评分证据、问题顺序和追问预算。
- `leai/api/orchestrated_turns.py`：canonical session 的原子保存、版本检查和幂等示例。不能直接把其中 canonical Course/ResponseSession/SurveyOccurrence 当作旧模型使用。
- `datapipeline/models.py`、`views.py`、`urls.py`：旧 Course、FeedbackGPT、FormSchema、FeedbackMessage 和旧接口。
- `datapipeline/leai_analysis.py`：旧分析有按 AI 的 Area 标题划分 section 的路径。新 orchestrator 不保证这种标题，必须使用实际保存的题目证据。

以上是当前本地源码事实，不代表当前线上版本已经具备这些接口。

## 接入方式

建议采用 **旧模型与旧页面加后端适配层，复用同一 orchestrator 核心**。

旧课程、survey ID、匿名 session 和教师入口继续工作。新适配层只负责把旧数据转换为 orchestrator 的输入，调用现有 provider/validator，并把返回结果原子保存到旧数据体系。schema 原文与新引擎规则只有一个来源。

另一个方式是让旧界面直接使用 canonical `/api/v1/`，但需要处理不同课程、survey、教师认证和已有响应归属，会扩大成数据迁移。把新规则复制到浏览器则会出现两套规则和无法可信恢复的客户端状态。两者都不符合本次保留原系统、复用既有逻辑的目标。

这次需要增加后端状态与接口，属于架构接入，而不再只是局部 schema 替换。

## Schema 登记与教师流程

1. 两个原始 fixture 保持原文、顺序、response kind、量表、coverage targets 和 probe budget 完整。
2. 为旧 FormSchema 增加显式、带版本的 orchestrator envelope：`engine: orchestrator-v1` 和 `protocol: <原始 fixture>`。原始 protocol 内不注入旧 metadata，否则会违反其严格校验。
3. envelope 的外层 section/field 信息可由 protocol 自动投影，供旧预览与分析描述使用。投影不参与控制问答；题目原文永远从 protocol 读取。
4. 增加旧版专用的 opt-in 登记命令，默认 dry-run；只登记两套 schema，不自动创建真实课程或发布真实 survey。重复执行必须幂等，遇到同名但不同内容记录时报冲突，不能覆盖。
5. 教师继续使用原 Structured Reflection 下拉框、预览、创建按钮和链接。对这两套协议，旧自由 system instructions 字段显示 schema 管理的内容并只读，避免让教师误以为可改写固定问卷。其他 schema 的字段行为沿用原样。
6. 两套 fixture 的开场包含特定课程及 weeks 3/4，不能擅自泛化。教师预览须显示原文，实际聊天使用原文。跨课程改写是另外的明确操作。

## 后端状态与接口

增加独立的旧版 orchestrated session 及 turn receipt，归属于旧 FeedbackGPT。session 保存匿名 session ID、冻结的 schema/protocol/hash、consent、flow state、turn version、稳定消息 sequence 和最终结果 snapshot。新 session 固定首次使用的协议；后续 FormSchema 改动不能静默改变已经开始的问答。

接口位于旧 `/datapipeline/api/` 下，按功能集中在独立 adapter 模块；共享 API base 不改为 `/v1/`。

- **Start/resume**：输入 survey public ID 与旧匿名 session 标识，校验开放时间、关闭状态和 consent。首次创建保存 intro 与第一题一次；再次请求返回真实已保存的 transcript、flow 和进度。
- **Turn**：接收新文本、expected version 与稳定 request ID。历史、protocol、证据和当前题只从后端读取，不接受浏览器替换。
- **Outputs/finalize**：以保存的状态决定是否 review ready，从真实证据生成按题回答及评分；在原有下载动作中确认/冻结最终结果。聊天本身不能自动 finalize。

每轮调用同一 `run_orchestration` 和 `preview_proposal`。provider 执行期间不长期持有数据库锁；提交时锁 session，重新检查版本、survey 开放状态和最新 referral policy，然后一次保存用户消息、AI 消息、flow state 和 receipt。

重复 request ID 不重复保存；相同 ID 不同请求返回冲突；旧版本请求返回冲突并要求读取当前状态；provider 失败或 proposal 无效不推进、不落半轮答案。重试沿用同一 request ID，浏览器保留未成功文本。

沿用旧匿名 session 的访问方式和 consent 分界，不引入实名。新接口不把 session 标识放入 query string。模型 diagnostics 不混入学生回答、公开恢复 payload 或 Analyzer 正文。

## 学生界面

在 `feedback.html` 内按后端返回的 engine 标志分流。Ulia 路径通过一个新共享 JS adapter 调用上述接口，使用原 `appendMessage`、原输入框、发送、mic、busy、进度及下载组件。其消息由服务器保存，渲染时使用已有 `skipPersist` 能力，避免又走旧 `storeData` 保存一遍。

此路径不调用旧 `beforeTurn` / `afterTurn`，不裁掉服务器历史，不把旧 tone gates 拼进新 orchestrator，也不从聊天文字或 `[END]` 猜测完成。

Likert 版继续通过自然语言聊天回答，例如评分及理由在一句话内。评分没有明确证据时不能推断；只有评分时按原 orchestrator 规则追问理由。不新增评分控件，不把 declined/unknown/not applicable 变成中间分。

保留原主问题原文与次序。对澄清、跨题信息、修改旧答案、混合意图、有限追问、referral 和 review ready，复用新 orchestrator 当前行为。review ready 后仍允许修改，直到原下载动作完成最终确认。

刷新只恢复后端保存的状态。网络失败保留输入和可重试状态；survey 关闭时停止发送，不能提交迟到的 AI 结果。加载失败明确显示错误，不能悄悄降级到旧引擎。

## Analyzer 与下载

原始 transcript 继续保存为 FeedbackMessage，以供原界面读取；同时从 orchestrator 当前有效证据生成按 section/item 的结构化视图。一个回答可涉及多题，不能只用“回答时屏幕上的题”当作唯一归属。

修改或撤回之后，Analyzer、导出和下载使用更新后的有效证据及评分，不把被 supersede 的内容继续计入。旧日志仍保留用于追溯；不会批量回填历史回答。

按题结果由 backend 生成，前端的 Ulia 下载不再调用旧 AI extractSlots 对 transcript 重猜一遍。沿用原下载格式及课程开关，不为本次另造一种报告界面。旧证书样式与唯一代码逻辑保留；Ulia eligibility 由后端真实完成状态决定，不能相信客户端传入的 complete。

## 预期改动文件范围

前端：`LEAI/PromptDesigner.html`、`feedback.html`；新增 `leai-orchestration.js` 和对应测试。按实际数据合同需要调整 `leai-shared.js` / `FeedbackAnalyzer.html` 的结构化读取路径，不改页面布局和无关 copy。旧 `leai-formmode.js` 继续服务既有 schema。

后端：新增旧版 orchestration adapter、schema 登记命令、session/receipt 模型与 migration；修改旧 `models.py`、`urls.py` 和 `views.py` 的有界调用点，以及 analysis/completion/output 的相应读取点；新增相关测试。保持现有 orchestrator 核心和 Ulia fixtures 不变。

两个 checkout 都在现有 main 上工作。前端大量已有 dirty 内容需逐项保留；后端当前 main 比 origin ahead 19，不能把它们顺手 push。后端在当前可写工作区之外，实施时需要按工具权限处理该目录的写入，不能绕过 sandbox。

## 验收

1. 在真实旧 PromptDesigner 页面选取两套 schema 并创建隔离本地 survey，链接打开原 feedback 页面，布局与输入行为保持原样。
2. 两套协议都实际走新 provider/orchestrator，主题 11 个精确 ID/原文顺序、3 个 section 与源 fixture 一致；每个 applicable Likert 评分有原始学生证据。
3. 实测澄清不产生假回答、短但充分回答前进、否定回答、跨题信息、评分缺失、评分无理由、修改早前回答、拒答、追问预算及 review ready 后修改。
4. 中途刷新、重复发送、网络失败重试、跨 survey session、stale version、survey 关闭及迟到结果均无重复、错归属或半轮保存。
5. 每次最终 walkthrough 核对全部数据库消息、有效题目结果、评分/证据、session 和 receipt 数量。HTTP 200 不能代替读回。
6. 原 Analyzer 与下载内容读回一致，旧证书布局与课程设置保留；其按题归属来自服务器证据而不是 Area 标题或对话顺序猜测。
7. 在真实页面使用 Playwright/MCP 真实点击/输入，至少 Chromium 与 WebKit/Firefox 可用时验证 desktop/mobile；记录截图及 HTML verification report。真实 mic 是否可用单独说明。
8. 执行全部已有 Node tests、后端相关与完整 Django tests/checks、JS syntax 和 migration consistency checks。静态仓库没有产品 build 命令，不伪造 build PASS；Python 环境使用 uv。

本轮实现与验收先限定本地隔离数据。QA/Production 写入、schema 安装、生产开启 flag、push 或部署不由本设计自动授权；线上可用需要完整候选与明确发布授权。现有 orchestrator 配置限定 local/QA，不能偷偷把原生产网站开启。

## 自审

已检查：目标与旧界面一致；复用的是新 conversational orchestrator 而非旧字段引擎；量表由聊天输入；schema 原文受保护；存储与分析归属使用服务器实际证据；防重复、失败恢复和关闭检查有明确合同；新老模型不混用；本地实现与线上发布界限明确。用户已批准本设计，执行计划需包含 winter 课程身份核对与限定绑定。

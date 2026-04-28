# 按钮
btn-upload = 📁 上传文件
btn-help = ❓ 帮助

# /start
welcome =
    欢迎使用 DirectPort Bot！

    • 上传商品文件（.xlsx 或 .csv）
    • 选择所需列
    • 获取处理结果

    请选择操作：

# /help
help =
    📋 Excel 文件格式：

    列（第一行为表头）：
    1. 商品描述/名称
    2. 数量
    3. 单价（美元）
    4. 重量（公斤）

    支持格式：.xlsx

    命令：
    /start — 欢迎
    /help — 帮助信息
    /language — 更改语言

# 菜单
upload-prompt = 请发送 .xlsx 或 .csv 格式的文件

# 文件上传
unsupported-format = 仅支持 .xlsx 和 .csv 格式。请将文件另存为其中一种格式后重新发送。
file-too-large = 文件大于 40 MB。如果其中包含较多图片，请另存为不含图片的版本；如行数过多，请拆分为多个文件。
uploading = 📥 正在下载文件…
file-accepted = 📄 文件「{ $fileName }」已接受处理。
    通常需要 5–10 分钟。我会在此对话中发送进度更新和最终结果。
upload-error = 文件上传失败，可能是临时故障。请稍后再试一次。

# 列选择
session-expired = 会话已过期，请重新发送文件。
column-selected = ✅ { $header }

    请选择包含{ $label }的列：
column-label-price = 价格
column-label-weight = 重量
column-label-quantity = 数量
all-columns-selected = ✅ { $header }

    所有列已选择，正在处理...
empty-file = 文件不包含数据，请检查格式。
doc-accepted = 📄 文件「{ $fileName }」已接受处理（{ $rows } 行）。
    处理完成后会通知您。
doc-send-error = 发送文档时出错，请重试。

# 通知
notif-rejected = ⛔ 文档无法自动处理。

    检测到的问题：
    { $reasons }

    您可以这样做：
    • 根据上述列表修正文件后重新上传
    • 或联系操作员，由人工进行人工审核与协助
notif-rejected-default = 文件中不包含适合办理报关的数据。
notif-failed = ❌ 文档处理失败。

    { $detail }

    如果重试仍未解决，请联系操作员，我们会一起处理。
notif-failed-retry = 我方系统暂时出现问题，请过几分钟后再次上传文件。
notif-success =
    ✅ 文档处理完成！

    文件中已添加以下列：
    • 商品编码（ТН ВЭД）
    • 关税和增值税税率
    • 关税和增值税金额
    • 物流佣金
    • 计算状态和备注
notif-success-contact =
    ✅ 文档处理完成！

    请联系我们获取结果。
notif-send-failed = ⚠️ 文档已处理，但文件未能发送。
    请稍后再试，或联系操作员，我们会人工发送结果给您。
notif-processed-with-errors =
    ⚠️ 文档已处理，但部分行仍存在分类错误。

    暂时不发送结果文件 — 操作员会进行审核，并主动与您联系。
notif-code-review-required =
    🔎 文档已转交操作员人工审核。

    部分行的 HS 编码系统无法自信地匹配，已自动转交人工审核。
    审核完成后，结果会发送到此对话中。

notif-stage-classifying = 🏷 正在匹配 HS 编码（{ $count } 项）…

# /language
language-prompt = 请选择语言：
language-set = 语言已设为中文。

# 文档状态
status-parsing = 识别中
status-pending = 等待处理
status-processing = 处理中
status-processed = 已处理
status-processed_with_errors = 处理有错误
status-failed = 错误
status-requires_review = 需要审核
status-code_review_required = 需要审核编码
status-rejected = 已拒绝

# API 错误代码 — 每条文本均含「发生了什么」+「应当如何处理」
error-FILE_REQUIRED = 未检测到附加文件。请发送 .xlsx 或 .csv 格式的表格。
error-UNSUPPORTED_FORMAT = 我们仅支持 .xlsx 和 .csv 格式。请将文件另存为其中之一后重新上传。
error-DOCUMENT_NOT_FOUND = 该文档已不可用，可能已被删除。请重新上传文件。
error-PARSING_FAILED = 无法识别表格结构。请确认文件包含表头行以及名称、价格、重量、数量等列，且顶部没有合并单元格或空白分隔行。
error-PROCESSING_FAILED = 文档处理出现故障，多为临时问题。请过几分钟后再试。
error-MISSING_FILE_BUFFER = 文件已不在服务器上（可能已超过保存期）。请重新上传文件。
error-AI_UNAVAILABLE = AI 服务暂时不可用，通常出现在高峰时段。请在 5–10 分钟后重试。
error-AI_TIMEOUT = AI 处理超时。文件很可能过大 — 请将其拆分为若干较小的文件。
error-FILE_CORRUPTED = 无法打开文件 — 可能已损坏或受密码保护。请在 Excel 中打开后另存为新副本，再重新上传。
error-FILE_TOO_BIG = 文件内容对 AI 来说过大。请删除单元格中的多余文本，或将文件拆分为若干部分。
error-unknown = 发生意外错误。请重试 — 若反复出现，请联系操作员。

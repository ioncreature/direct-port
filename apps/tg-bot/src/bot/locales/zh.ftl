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
unsupported-format = 仅支持 .xlsx 和 .csv 文件
uploading = 📥 正在下载文件...
file-accepted = 📄 文件「{ $fileName }」已接受处理。
    处理完成后会通知您。
upload-error = 文件处理出错，请重试。

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
notif-rejected = ⛔ 文档无法处理。

    原因：
    { $reasons }

    请修正文件后重新上传。
notif-rejected-default = 文件不包含适合报关的数据。
notif-failed = ❌ 文档处理出错。
    { $detail }
notif-failed-retry = 请重新上传文件。
notif-success =
    ✅ 文档处理完成！

    文件中已添加以下列：
    • 商品编码（ТН ВЭД）
    • 关税和增值税税率
    • 关税和增值税金额
    • 物流佣金
    • 计算状态和备注
notif-send-failed = ⚠️ 文档已处理，但无法发送文件，请稍后重试。

# /language
language-prompt = 请选择语言：
language-set = 语言已设为中文。

# API 错误代码
error-FILE_REQUIRED = 未附加文件，请发送 .xlsx 或 .csv 文件。
error-UNSUPPORTED_FORMAT = 仅支持 .xlsx 和 .csv 文件。
error-DOCUMENT_NOT_FOUND = 未找到文档。
error-PROCESSING_FAILED = 文档处理出错。
error-unknown = 发生意外错误，请重试。

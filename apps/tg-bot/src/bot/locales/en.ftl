# Buttons
btn-upload = 📁 Upload file
btn-help = ❓ Help

# /start
welcome =
    Welcome to DirectPort Bot!

    • Upload a product file (.xlsx or .csv)
    • Select the required columns
    • Get the processing result

    Choose an action:

# /help
help =
    📋 Excel file format:

    Columns (header in the first row):
    1. Product description
    2. Quantity
    3. Unit price (USD)
    4. Weight (kg)

    Supported formats: .xlsx

    Commands:
    /start — welcome
    /help — this help
    /language — change language

# Menu
upload-prompt = Send me a file in .xlsx or .csv format

# File upload
unsupported-format = Only .xlsx and .csv files are supported
uploading = 📥 Downloading file...
file-accepted = 📄 File "{ $fileName }" accepted for processing.
    You will be notified when done.
upload-error = Error processing file. Please try again.

# Column selection
session-expired = Session expired. Please send the file again.
column-selected = ✅ { $header }

    Select the column with { $label }:
column-label-price = price
column-label-weight = weight
column-label-quantity = quantity
all-columns-selected = ✅ { $header }

    All columns selected. Processing...
empty-file = File contains no data. Check the format.
doc-accepted = 📄 File "{ $fileName }" accepted for processing ({ $rows } rows).
    You will be notified when done.
doc-send-error = Error sending the document. Please try again.

# Notifications
notif-rejected = ⛔ The document cannot be processed.

    Reasons:
    { $reasons }

    Fix the file and upload again.
notif-rejected-default = The file does not contain data suitable for customs declaration.
notif-failed = ❌ Error processing document.
    { $detail }
notif-failed-retry = Try uploading the file again.
notif-success =
    ✅ Document processed!

    Added columns:
    • TN VED code
    • Duty and VAT rates
    • Duty and VAT amounts
    • Logistics commission
    • Calculation status and notes
notif-send-failed = ⚠️ Document processed, but failed to send the file. Please try later.

# /language
language-prompt = Choose your language:
language-set = Language set to English.

# API error codes
error-FILE_REQUIRED = No file attached. Please send an .xlsx or .csv file.
error-UNSUPPORTED_FORMAT = Only .xlsx and .csv files are supported.
error-DOCUMENT_NOT_FOUND = Document not found.
error-PROCESSING_FAILED = Error processing the document.
error-unknown = An unexpected error occurred. Please try again.

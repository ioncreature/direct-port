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
unsupported-format = Only .xlsx and .csv are supported. Save the file in one of these formats and try again.
file-too-large = The file is larger than 40 MB. If it contains many images — re-save it without them; if many rows — split it into several files.
uploading = 📥 Downloading file…
file-accepted = 📄 File "{ $fileName }" accepted for processing.
    This usually takes 5–10 minutes. I'll send progress updates and the final result here.
upload-error = Failed to upload the file — likely a temporary glitch. Please try again in a minute.

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
notif-rejected = ⛔ The document could not be processed automatically.

    What we found:
    { $reasons }

    What you can do:
    • Fix the file based on the list above and upload it again
    • Or contact an operator — they will review the document manually
notif-rejected-default = The file doesn't contain data suitable for a customs declaration.
notif-failed = ❌ Could not process the document.

    { $detail }

    If retrying doesn't help — please contact an operator and we'll sort it out.
notif-failed-retry = Something went wrong on our side. Please try uploading the file again in a couple of minutes.
notif-success =
    ✅ Document processed!

    Added columns:
    • TN VED code
    • Duty and VAT rates
    • Duty and VAT amounts
    • Logistics commission
    • Calculation status and notes
notif-success-contact =
    ✅ Document processed successfully!

    Please contact us to get the results.
notif-send-failed = ⚠️ Document processed, but the file couldn't be sent.
    Try again later or contact an operator — we'll deliver the result manually.
notif-processed-with-errors =
    ⚠️ Document processed, but some rows still have classification errors.

    We're holding off on sending the file — an operator will review it and get back to you.
notif-code-review-required =
    🔎 Document accepted for operator review.

    The system wasn't confident enough about the HS codes for some rows, so the document was automatically routed to a human operator.
    Once the review is done, we'll send the result here.

notif-stage-classifying = 🏷 Matching HS codes ({ $count } items)…

# /language
language-prompt = Choose your language:
language-set = Language set to English.

# Document statuses
status-parsing = Parsing
status-pending = Pending
status-processing = Processing
status-processed = Processed
status-processed_with_errors = Processed with errors
status-failed = Error
status-requires_review = Requires review
status-code_review_required = Code review required
status-rejected = Rejected

# API error codes — each text: "what happened" + "what to do"
error-FILE_REQUIRED = No file attached. Please send a table in .xlsx or .csv format.
error-UNSUPPORTED_FORMAT = We only support .xlsx and .csv. Save the file in one of these formats and try again.
error-DOCUMENT_NOT_FOUND = This document is no longer available — it may have been deleted. Please upload the file again.
error-PARSING_FAILED = Could not recognize the table structure. Make sure the file has a header row and columns for name, price, weight and quantity — without merged cells or empty separators on top.
error-PROCESSING_FAILED = Document processing failed. This is most likely a temporary issue — please retry in a couple of minutes.
error-MISSING_FILE_BUFFER = The file is no longer stored on the server (storage period may have expired). Please upload the document again.
error-AI_UNAVAILABLE = The AI service is temporarily unavailable. This happens during peak load — please retry in 5–10 minutes.
error-AI_TIMEOUT = AI processing took too long. The file is most likely too large — split it into several smaller files.
error-FILE_CORRUPTED = Could not open the file — it may be corrupted or password-protected. Open it in Excel, save a fresh copy, and try again.
error-FILE_TOO_BIG = The file content is too large for the AI. Remove extra text from cells or split the file into parts.
error-unknown = An unexpected error occurred. Please try again — if it keeps happening, contact an operator.

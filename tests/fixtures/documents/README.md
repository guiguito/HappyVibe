# §31 document fixtures

Copied from the `firecrawl/anydoc` upstream test corpus (MIT), commit shallow-cloned
2026-09-03, plus `notes.txt` written here. Upstream paths:

| here | upstream `tests/fixtures/…` |
|---|---|
| sample.docx | docx/text.docx |
| sample.doc | doc/text.doc |
| sample.xlsx | xlsx/sheet.xlsx |
| sample.xls | xls/sheet.xls |
| sample.xlsb | xlsb/handmade-sheet.xlsb |
| sample.pptx | pptx/pres.pptx |
| sample.ppt | ppt/handmade-multimaster.ppt |
| sample.odt | odt/text.odt |
| sample.ods | ods/sheet.ods |
| sample.odp | odp/pres.odp |
| sample.rtf | rtf/text.rtf |
| sample.epub | epub/book.epub |
| text.pdf | pdf/text.pdf |
| mixed.pdf | pdf/handmade-mixed.pdf (one image-only page + text pages — the pin decision, #144/#162) |
| scanned.pdf | pdf/handmade-scanned.pdf (image-only throughout) |
| encrypted.odt | malformed/encrypted--errors.odt |
| table.csv | csv/sheet.csv (present so the suite can prove CSV is REFUSED — decision K) |
| notes.txt | written here, same reason |

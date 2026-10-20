**1.1.1**: fixes the reader tool bar in **Scroll** mode (and on smaller or scaled screens).

**Downloads**
* `MambaReader-Setup-1.1.1-x64.exe`: the installer. It installs per user to `%LOCALAPPDATA%\Programs\Mamba Reader`.
* `MambaReader-Portable-1.1.1-x64.exe`: a single exe, no install needed.
* `MambaReader-1.1.1-win-x64.zip`: the unpacked app.

The builds are not code-signed. If SmartScreen warns you, click **More info → Run anyway**.

**Fixed**
* **The reader header was squashed.** The **Edit PDF** button added in 1.1.0 stretched to fill the whole header row. Everything else got squeezed:
  * the Flip/Scroll switch was cut to "Fli", so in Scroll mode the active **Scroll** button could not be seen;
  * the book title shrank to one letter and **Export** wrapped onto two lines;
  * at 125 %/150 % Windows scaling, fullscreen, the reading timer, the theme and the language switch fell off the window.
* **Header controls now keep their normal size.** Only the book title shortens. Anything that still does not fit goes into a **⋯** menu, and it moves back when the window gets wider. This also works in Arabic (right to left).
* **Switching Flip ↔ Scroll keeps the exact page you were on.** Before, it could jump back one page because of the two-page spread.

**Tests**
A new layout check runs on `windows-latest` for every build. It covers both modes on 1366×768, 1280×720, 1920×1080 and ~1000 px wide windows, at 100/125/150 % scaling. It:
* uses the bounding box of every control to check it is visible, inside the window, not covered and not overlapping its neighbours;
* checks that pages do not overlap;
* adds a highlight and a comment on every page in Scroll mode;
* switches modes and checks that page, tool and annotations are kept.

---

**1.1.0**: a visual, offline **PDF editor**. Click **Edit PDF** in the reader bar, or use **Edit PDF** in Mamba Convert, which starts `Mamba Reader.exe --edit <file>` or `mamba-reader://edit?path=…`.

**Downloads**
* `MambaReader-Setup-1.1.0-x64.exe`: the installer. It installs per user to `%LOCALAPPDATA%\Programs\Mamba Reader`.
* `MambaReader-Portable-1.1.0-x64.exe`: a single exe, no install needed.
* `MambaReader-1.1.0-win-x64.zip`: the unpacked app.

The builds are not code-signed. If SmartScreen warns you, click **More info → Run anyway**.

**PDF editor**
* **Edit text:** click a line, retype it or delete it. The line is retyped in the closest standard font (Helvetica, Times or Courier) at the same size, colour, weight and position. Text that cannot be matched is covered and retyped.
* **Text boxes:** add new text with font, size, colour, bold, italic and alignment. Any language works, including Swedish and Arabic.
* **Images:** select, move, resize, delete or replace existing images, and insert new ones.
* **Whiteout and redact.** Redaction truly removes the text and image content underneath, then draws a black box.
* **Signatures:** draw one with mouse or pen, type it in a handwriting font, or import an image (white background removed). Signatures are saved for reuse. You can also place **initials** and **date** stamps, then move and resize them.
* **Pages:** add, delete, drag to reorder, rotate, insert a blank page, and merge another PDF.
* **Forms:** fill the PDF's own form fields (text, checkbox, radio and dropdown).
* **Undo/redo** with Ctrl Z and Ctrl Y.
* **Saving:**
  * **Save** writes a new file, `<name> (edited).pdf`, next to the original.
  * **Save as…** lets you choose the file.
  * The original is only overwritten if you pick it yourself in *Save as…*.

**Known limits**
* **Scanned PDFs** contain only images, so there is no text to edit and no OCR. Use whiteout plus a text box instead.
* **Edited text uses a standard font.** Text is edited line by line in the closest standard font. The PDF's embedded font is not reused, and paragraphs do not reflow.
* **Non-Latin new text is an image.** New text outside Latin-1 (e.g. Arabic) is embedded as a sharp image, so it cannot be selected.
* **Merged PDFs lose their form fields.** The pages are kept.
* **Redaction over overlapping images.** If an image overlaps another, redacting it blanks those pixels instead of removing the whole image.

The build was verified on `windows-latest`:
* editor engine tests (22);
* an editor UI test driven by real mouse and keyboard input (29 checks, saved PDF re-read and verified);
* the existing self-test and UI test;
* install, plus `--edit` and `mamba-reader://edit` handoff.

---

**1.0.1**: installer fix. The installer now closes a running Mamba Reader with a simple per-user step, replacing electron-builder's process check, which intermittently crashed the installer (0xC0000005). No app changes.

The first release of **Mamba Reader**, a free, offline Windows reader with annotations.

**Downloads**
* `MambaReader-Setup-1.0.1-x64.exe`: the installer. It installs per user to `%LOCALAPPDATA%\Programs\Mamba Reader` and registers `mamba-reader://` and *Open with*.
* `MambaReader-Portable-1.0.1-x64.exe`: a single exe, no install needed.
* `MambaReader-1.0.1-win-x64.zip`: the unpacked app.

The builds are not code-signed. If SmartScreen warns you, click **More info → Run anyway**.

**What it does**
* Library shelf with covers, progress, resume and tags.
* Reads PDF, EPUB, MOBI, FB2, CBZ, XPS, images and Mamba Convert flipbooks.
* Page-flip view with spreads, scroll mode, zoom, thumbnails, outline and full-text search.
* Annotations:
  * highlights, underline and strikethrough;
  * pen, marker and eraser;
  * sticky notes and comments;
  * text boxes, shapes and arrows; bookmarks.
* Annotations panel with filters. Export notes to MD, TXT or a PDF summary, or export an annotated PDF copy.
* Vocabulary list with your own translations, a reading timer, and light, sepia and dark themes. English and Arabic (RTL).
* Autosave to sidecar JSON; your originals are never modified. Backup export and import.

The build was verified on the `windows-latest` runner:
* packaged self-test and UI test;
* silent install, with the install path and registry keys checked;
* argv and protocol handoff into the single running instance;
* uninstall removes the registry keys.

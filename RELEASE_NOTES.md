First release of **Mamba Reader**, a free, offline Windows reader with annotations.

**Downloads**
* `MambaReader-Setup-1.0.0-x64.exe`: the installer. It installs per user to `%LOCALAPPDATA%\Programs\Mamba Reader` and registers `mamba-reader://` and *Open with*.
* `MambaReader-Portable-1.0.0-x64.exe`: a single exe, no install needed.
* `MambaReader-1.0.0-win-x64.zip`: the unpacked app.

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

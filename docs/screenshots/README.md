# Layout screenshots (Flip vs Scroll)

Made by `test/ui-layout.js` (run with `npm run test:ui`, and on CI for every build).
File names: `<mode>-<screen>@<Windows scaling %>.png`. The screen is the physical resolution; the window is that minus
~80 px for title bar + taskbar, divided by the scale factor (the app's minimum window is 900×600 CSS px).

- `before/` — v1.1.0: the header row is squashed (Edit PDF button stretched to fill it), the mode switch shows only
  “Fli” (the Scroll button is clipped away), labels wrap, and at 125 %/150 % fullscreen/timer/theme/language are off-window.
- `after/` — v1.1.1: controls keep their size, the book title shortens, and anything that does not fit is in the ⋯ menu
  (`*-more-menu.png` shows it open). `*-arabic.png` is the right-to-left layout.

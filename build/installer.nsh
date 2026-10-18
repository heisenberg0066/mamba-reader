; Simple per-user "close the running app" step instead of electron-builder's GetProcessInfo/System-plugin
; check, which intermittently crashed silent installs (0xC0000005) on Windows Server 2025 runners.
!macro customCheckAppRunning
  nsExec::Exec '"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"'
  Pop $0
  Sleep 500
!macroend

; Mamba Reader — per-user (HKCU) registration: mamba-reader:// protocol + "Open with" entries.
; Never takes over the default PDF handler; it only adds Mamba Reader to the "Open with" list.
!macro mrAssoc EXT
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "MambaReader.Book" ""
  WriteRegStr HKCU "Software\Classes\Applications\Mamba Reader.exe\SupportedTypes" ".${EXT}" ""
!macroend
!macro mrUnassoc EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "MambaReader.Book"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\mamba-reader" "" "URL:Mamba Reader"
  WriteRegStr HKCU "Software\Classes\mamba-reader" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\mamba-reader\DefaultIcon" "" "$INSTDIR\Mamba Reader.exe,0"
  WriteRegStr HKCU "Software\Classes\mamba-reader\shell\open\command" "" '"$INSTDIR\Mamba Reader.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\MambaReader.Book" "" "Mamba Reader book"
  WriteRegStr HKCU "Software\Classes\MambaReader.Book\DefaultIcon" "" "$INSTDIR\Mamba Reader.exe,0"
  WriteRegStr HKCU "Software\Classes\MambaReader.Book\shell\open\command" "" '"$INSTDIR\Mamba Reader.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\Mamba Reader.exe" "FriendlyAppName" "Mamba Reader"
  WriteRegStr HKCU "Software\Classes\Applications\Mamba Reader.exe\DefaultIcon" "" "$INSTDIR\Mamba Reader.exe,0"
  WriteRegStr HKCU "Software\Classes\Applications\Mamba Reader.exe\shell\open\command" "" '"$INSTDIR\Mamba Reader.exe" "%1"'
  !insertmacro mrAssoc "pdf"
  !insertmacro mrAssoc "epub"
  !insertmacro mrAssoc "cbz"
  !insertmacro mrAssoc "xps"
  !insertmacro mrAssoc "oxps"
  !insertmacro mrAssoc "fb2"
  !insertmacro mrAssoc "mobi"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; electron-builder also runs this during an update; the new installer writes the keys again afterwards.
  DeleteRegKey HKCU "Software\Classes\mamba-reader"
  DeleteRegKey HKCU "Software\Classes\MambaReader.Book"
  DeleteRegKey HKCU "Software\Classes\Applications\Mamba Reader.exe"
  !insertmacro mrUnassoc "pdf"
  !insertmacro mrUnassoc "epub"
  !insertmacro mrUnassoc "cbz"
  !insertmacro mrUnassoc "xps"
  !insertmacro mrUnassoc "oxps"
  !insertmacro mrUnassoc "fb2"
  !insertmacro mrUnassoc "mobi"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

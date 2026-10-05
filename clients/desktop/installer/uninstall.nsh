; Included by electron-builder's NSIS installer (electron-builder.yml, nsis.include).
; The app writes these for the current user at first run; the uninstaller removes them.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\GigaCAD"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\GigaCAD"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\GigaCAD"
!macroend

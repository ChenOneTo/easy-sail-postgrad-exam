; ==========================================================================
; Tauri NSIS installer hooks
;
; Purpose: keep productName / installer filename in English
; ("Easy Sail Exam") while showing the Chinese name under the
; installed shortcuts.
;
; The Chinese display name is written with ${U+XXXX} escapes so this file
; stays pure ASCII and is immune to NSIS source-encoding issues.
;   轻 U+8F7B  舟 U+821F  考 U+8003  研 U+7814  台 U+53F0
;   -> "轻舟考研台"
; ==========================================================================

!include "LogicLib.nsh"

!define APP_DISPLAY_NAME "${U+8F7B}${U+821F}${U+8003}${U+7814}${U+53F0}"

; Runs after files, registry entries and shortcuts have been created.
!macro NSIS_HOOK_POSTINSTALL
  ; Desktop shortcut: rename default English name to Chinese
  ${If} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
    Rename "$DESKTOP\${PRODUCTNAME}.lnk" "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
  ${EndIf}

  ; Start Menu shortcut (no startMenuFolder configured -> Programs root)
  ${If} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
    Rename "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
  ${EndIf}
!macroend

; Runs before the uninstaller removes anything: clean up the Chinese links.
!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
!macroend

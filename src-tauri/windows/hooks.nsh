; ==========================================================================
; Tauri NSIS installer hooks
;
; Purpose: keep productName / installer filename in English
; ("Easy Sail Exam") while everything the user sees after installation
; (desktop / Start Menu shortcuts in "程序和功能") uses the Chinese name.
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
  ; 桌面快捷方式：英文名 -> 中文名
  ${If} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
    Rename "$DESKTOP\${PRODUCTNAME}.lnk" "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
  ${EndIf}

  ; 开始菜单快捷方式（未配置 startMenuFolder 时位于「程序」根目录）
  ${If} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
    Rename "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
  ${EndIf}

  ; 「控制面板 -> 程序和功能」中的显示名：按 DisplayName 匹配当前产品名后改写。
  ; 逐用户安装写 HKCU，全机器安装写 HKLM（无权限时写入静默失败，不影响安装）。
  StrCpy $0 0
  ns_hkcu_loop:
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" ns_hklm_start
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCmp $2 "${PRODUCTNAME}" 0 ns_hkcu_next
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName" "${APP_DISPLAY_NAME}"
    Goto ns_done
  ns_hkcu_next:
    IntOp $0 $0 + 1
    Goto ns_hkcu_loop

  ns_hklm_start:
  StrCpy $0 0
  ns_hklm_loop:
    EnumRegKey $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" ns_done
    ReadRegStr $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCmp $2 "${PRODUCTNAME}" 0 ns_hklm_next
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName" "${APP_DISPLAY_NAME}"
    Goto ns_done
  ns_hklm_next:
    IntOp $0 $0 + 1
    Goto ns_hklm_loop

  ns_done:
!macroend

; Runs before the uninstaller removes anything: clean up the Chinese links.
!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
!macroend

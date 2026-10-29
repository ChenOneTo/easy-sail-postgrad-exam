; ==========================================================================
; Tauri NSIS installer hooks
;
; 目标：productName 保持英文 "Easy Sail Exam"（决定安装包与安装目录名，保持 ASCII），
; 但安装后系统里看到的快捷方式和「程序和功能」条目使用中文「轻舟考研台」。
;
; 两个关键约束：
; 1. 本文件被 include 在模板 `!define PRODUCTNAME` 之前，函数体在编译期立即展开，
;    因此函数内不能使用 ${PRODUCTNAME}；产品英文名在此重复定义，
;    修改 tauri.conf.json 的 productName 时需同步改 APP_NAME_EN。
; 2. 交互式安装时，桌面快捷方式由「完成页」的复选框（CreateOrUpdateDesktopShortcut）
;    在安装结束后创建，晚于 NSIS_HOOK_POSTINSTALL，只能在 .onGUIEnd 里改名；
;    静默 / 被动安装没有完成页，桌面快捷方式在 Section 内创建，POSTINSTALL 即可处理。
;    因此两处都做改名，幂等且互不冲突。
;
; 中文名用 ${U+XXXX} 转义书写，保持本文件纯 ASCII，规避 NSIS 源文件编码问题。
;   轻 U+8F7B  舟 U+821F  考 U+8003  研 U+7814  台 U+53F0  -> "轻舟考研台"
; ==========================================================================

!include "LogicLib.nsh"

!define APP_NAME_EN "Easy Sail Exam"
!define APP_DISPLAY_NAME "${U+8F7B}${U+821F}${U+8003}${U+7814}${U+53F0}"

; 把指定目录下以英文产品名命名的 .lnk 改名为中文名
!macro RenameShortcutIn DIR
  ${If} ${FileExists} "${DIR}\${APP_NAME_EN}.lnk"
    Delete "${DIR}\${APP_DISPLAY_NAME}.lnk"
    Rename "${DIR}\${APP_NAME_EN}.lnk" "${DIR}\${APP_DISPLAY_NAME}.lnk"
  ${EndIf}
!macroend

; Runs after files, registry entries and shortcuts have been created.
!macro NSIS_HOOK_POSTINSTALL
  ; 开始菜单 + 桌面（静默 / 被动安装时桌面快捷方式此时已存在）
  SetShellVarContext current
  !insertmacro RenameShortcutIn $SMPROGRAMS
  !insertmacro RenameShortcutIn $DESKTOP

  SetShellVarContext all
  !insertmacro RenameShortcutIn $SMPROGRAMS
  !insertmacro RenameShortcutIn $DESKTOP
  SetShellVarContext current

  ; 「控制面板 -> 程序和功能」显示名：按 DisplayName 匹配当前英文产品名后改写
  StrCpy $0 0
  dn_hkcu_loop:
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" dn_hklm_start
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCmp $2 "${APP_NAME_EN}" 0 dn_hkcu_next
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName" "${APP_DISPLAY_NAME}"
    Goto dn_done
  dn_hkcu_next:
    IntOp $0 $0 + 1
    Goto dn_hkcu_loop

  dn_hklm_start:
  StrCpy $0 0
  dn_hklm_loop:
    EnumRegKey $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" dn_done
    ReadRegStr $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCmp $2 "${APP_NAME_EN}" 0 dn_hklm_next
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName" "${APP_DISPLAY_NAME}"
    Goto dn_done
  dn_hklm_next:
    IntOp $0 $0 + 1
    Goto dn_hklm_loop

  dn_done:
!macroend

; 安装器 GUI 关闭时执行：兜住「完成页创建桌面快捷方式」这条路径
Function .onGUIEnd
  SetShellVarContext current
  !insertmacro RenameShortcutIn $DESKTOP

  SetShellVarContext all
  !insertmacro RenameShortcutIn $DESKTOP
  SetShellVarContext current
FunctionEnd

; Runs before the uninstaller removes anything：卸载器按英文名删 lnk，中文名需自己清理
!macro NSIS_HOOK_PREUNINSTALL
  SetShellVarContext current
  Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
  Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"

  SetShellVarContext all
  Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}.lnk"
  Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
  SetShellVarContext current
!macroend

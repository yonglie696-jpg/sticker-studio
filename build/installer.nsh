; 卸载时询问是否删除本机数据（角色、专辑、API Key、生成的图片和缓存）。
; 升级覆盖安装（isUpdated）和静默卸载时一律不删，免得用户升级后数据没了。
; 数据目录由 Electron 按 package.json 的 name 决定：%APPDATA%\sticker-studio-public
; 本文件必须保存为带 BOM 的 UTF-8，否则 NSIS 会把中文当成本地代码页读成乱码。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除表情包工坊的本机数据？$\r$\n$\r$\n包括：角色、专辑、填过的 API Key、生成的图片和导出的文件，删除后无法恢复。$\r$\n只是重装或升级的话，请选「否」。$\r$\n$\r$\n数据位置：$APPDATA\sticker-studio-public" /SD IDNO IDYES`
      SetShellVarContext current
      RMDir /r "$APPDATA\sticker-studio-public"
      RMDir /r "$APPDATA\表情包工坊"
      RMDir /r "$LOCALAPPDATA\sticker-studio-public-updater"
      ${If} ${FileExists} "$APPDATA\sticker-studio-public\*.*"
        MessageBox MB_OK|MB_ICONEXCLAMATION "有些数据文件正被占用，没能删干净。$\r$\n请关掉表情包工坊后，手动删除这个文件夹：$\r$\n$APPDATA\sticker-studio-public"
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend

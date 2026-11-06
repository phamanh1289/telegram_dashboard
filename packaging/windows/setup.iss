; Windows installer around dist/stage/Telegram Dashboard (built by scripts/package.py).
;   ISCC /DVersion=1.2.3 packaging\windows\setup.iss
; Per-user install (no admin) into %LOCALAPPDATA%\Programs so Settings > Update can write new versions.
; Running a newer Setup over an old install works too: it adds versions\<ver> and rewrites "current";
; data\ (Telegram session, settings, database) is never touched, also kept on uninstall.

#define Src "..\..\dist\stage\Telegram Dashboard"

[Setup]
AppId={{6E0B7C1E-5B2A-4C1D-9C5E-7A4D2F1B8E31}
AppName=Telegram Dashboard
AppVersion={#Version}
AppPublisher=Telegram Dashboard
DefaultDirName={localappdata}\Programs\Telegram Dashboard
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=TelegramDashboard-{#Version}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Telegram Dashboard
; {app} goes on the user PATH so `mydashboard start` works in a new cmd/PowerShell window
ChangesEnvironment=yes

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Check: NeedsAddPath(ExpandConstant('{app}'))

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#Src}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Telegram Dashboard"; Filename: "{app}\Start Dashboard Telegram.bat"; WorkingDir: "{app}"
Name: "{autodesktop}\Telegram Dashboard"; Filename: "{app}\Start Dashboard Telegram.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Start Dashboard Telegram.bat"; Description: "Open Telegram Dashboard"; Flags: postinstall nowait shellexec skipifsilent

[UninstallDelete]
; versions added later by in-app updates are not in the install log
Type: filesandordirs; Name: "{app}\versions"
Type: files; Name: "{app}\current"

[Code]
function NeedsAddPath(Dir: string): Boolean;
var Cur: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Cur) then
    Cur := '';
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Cur) + ';') = 0;
end;

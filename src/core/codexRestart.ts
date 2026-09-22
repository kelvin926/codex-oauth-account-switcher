export function buildCodexTerminationScript(): string {
  return [
    "$ErrorActionPreference = 'Stop';",
    "$names = @('ChatGPT', 'Codex');",
    '$codexProcesses = @(Get-Process -Name $names -ErrorAction SilentlyContinue);',
    'if ($codexProcesses.Count -eq 0) { return }',
    '$windows = @($codexProcesses | Where-Object { $_.MainWindowHandle -ne 0 });',
    '$windows | ForEach-Object { $null = $_.CloseMainWindow() };',
    '$deadline = (Get-Date).AddSeconds(12);',
    'do {',
    '  Start-Sleep -Milliseconds 250;',
    '  $remaining = @(Get-Process -Name $names -ErrorAction SilentlyContinue);',
    '} while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline);',
    'if ($remaining.Count -gt 0) { $remaining | Stop-Process -Force -ErrorAction Stop };',
    'Start-Sleep -Milliseconds 500;',
    '$remaining = @(Get-Process -Name $names -ErrorAction SilentlyContinue);',
    'if ($remaining.Count -gt 0) { throw "ChatGPT/Codex 프로세스를 완전히 종료하지 못했습니다." }'
  ].join(' ');
}

export function buildCodexRuntimeScript(): string {
  return [
    "$ErrorActionPreference = 'Stop';",
    "$names = @('ChatGPT', 'Codex');",
    '$processes = @(Get-Process -Name $names -ErrorAction SilentlyContinue);',
    '$windows = @($processes | Where-Object { $_.MainWindowHandle -ne 0 });',
    '$latest = $processes | Sort-Object StartTime -Descending | Select-Object -First 1;',
    '@{',
    '  isOpen = $processes.Count -gt 0;',
    '  processCount = $processes.Count;',
    "  latestStartTime = if ($latest) { $latest.StartTime.ToUniversalTime().ToString('o') } else { $null }",
    '} | ConvertTo-Json -Compress'
  ].join(' ');
}

// Use out-of-process COM activation: the short-lived PowerShell host must not own
// the activated app's launch arguments. No Explorer or shell:AppsFolder is involved.
export function buildWindowsActivationTypeScript(): string {
  return `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISwitcherApplicationActivationManager {
  [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
    [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}
public static class SwitcherAppActivation {
  [DllImport("ole32.dll", PreserveSig = true)]
  static extern int CoCreateInstance(ref Guid clsid, IntPtr outer, uint context,
    ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out ISwitcherApplicationActivationManager manager);
  public static uint Activate(string appId) {
    Guid clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
    Guid iid = new Guid("2e941141-7f97-4756-ba1d-9decde894a3d");
    ISwitcherApplicationActivationManager manager;
    Marshal.ThrowExceptionForHR(CoCreateInstance(ref clsid, IntPtr.Zero, 4, ref iid, out manager));
    try {
      uint processId;
      Marshal.ThrowExceptionForHR(manager.ActivateApplication(appId, null, 2, out processId));
      return processId;
    } finally { Marshal.ReleaseComObject(manager); }
  }
}
'@`;
}

export function buildCodexLaunchScript(): string {
  return [
    "$ErrorActionPreference = 'Stop';",
    buildWindowsActivationTypeScript(),
    "$package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1;",
    "if (-not $package) { $package = Get-AppxPackage -Name 'OpenAI.ChatGPT' | Sort-Object Version -Descending | Select-Object -First 1 };",
    'if (-not $package) { throw "ChatGPT/Codex 설치를 찾을 수 없습니다. 시작 메뉴에서 직접 실행해 주세요." };',
    '$manifest = $package | Get-AppxPackageManifest;',
    '$apps = @($manifest.Package.Applications.Application);',
    "$candidates = @($apps | Where-Object { $_.Extensions.Extension.Protocol.Name -contains 'codex' });",
    'if ($candidates.Count -eq 0) {',
    "  $candidates = @($apps | Where-Object { [System.IO.Path]::GetFileName([string]$_.Executable) -match '^(ChatGPT|Codex)\\.exe$' });",
    '};',
    'if ($candidates.Count -ne 1) { throw "ChatGPT/Codex 실행 항목을 하나로 식별하지 못했습니다. 시작 메뉴에서 직접 실행해 주세요." };',
    '$appId = [string]$candidates[0].Id;',
    "if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($package.PackageFamilyName)) { throw 'Invalid application identity' };",
    '$target = "$($package.PackageFamilyName)!$appId";',
    '$null = [SwitcherAppActivation]::Activate($target);'
  ].join('\n');
}

export function toCodexTerminationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('완전히 종료하지 못했습니다')) {
    return 'ChatGPT/Codex가 아직 종료되지 않았습니다. 작업 저장이 끝난 뒤 다시 시도해 주세요.';
  }

  if (message.toLowerCase().includes('access is denied')) {
    return '실행 중인 ChatGPT/Codex가 더 높은 권한으로 열려 있어 종료할 수 없습니다. 계정 전환기를 관리자 권한으로 다시 실행하거나 앱을 직접 종료해 주세요.';
  }

  return 'ChatGPT/Codex 종료 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}


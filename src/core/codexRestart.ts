export function buildCodexTerminationScript(): string {
  return [
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

export function buildCodexLaunchScript(): string {
  return [
    "$package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue |",
    '  Sort-Object Version -Descending | Select-Object -First 1;',
    'if ($package) {',
    '  $manifest = $package | Get-AppxPackageManifest;',
    '  $appId = [string]$manifest.Package.Applications.Application.Id;',
    '  $target = "shell:AppsFolder\\$($package.PackageFamilyName)!$appId";',
    "  Start-Process 'explorer.exe' -ArgumentList $target;",
    '} else {',
    "  Start-Process 'codex://';",
    '}'
  ].join(' ');
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

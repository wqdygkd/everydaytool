import { exec } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { logger } from '../../../../backend/utils/logger.ts'

const execAsync = promisify(exec)

export async function focusChromeWindow(pid: number): Promise<boolean> {
  if (!pid) return false

  try {
    if (process.platform === 'win32') {
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          }
"@
        $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p -and $p.MainWindowHandle -ne 0) {
          [Win32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
          [Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
        }
      `
      await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`)
      return true
    }

    if (process.platform === 'darwin') {
      await execAsync(`osascript -e 'tell application "Google Chrome" to activate'`)
      return true
    }

    await execAsync(`wmctrl -ia $(wmctrl -lp | awk '$3 == ${pid} {print $1; exit}')`)
    return true
  } catch (error) {
    logger.warn('Failed to focus Chrome window', { pid, error: (error as Error).message })
    return false
  }
}

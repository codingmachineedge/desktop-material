import { randomBytes } from 'crypto'
import { Stats } from 'fs'
import { link, lstat, rename, unlink } from 'fs/promises'
import { isAbsolute, join, normalize, resolve } from 'path'
import { Repository } from '../../models/repository'
import { coerceToString } from './coerce-to-string'
import { execFile } from '../exec-file'

/** A fresh lock may still belong to a process that has not updated it yet. */
export const MinimumStaleRepositoryLockAgeMs = 30_000

export interface IRepositoryLockFileSystem {
  readonly lstat: (path: string) => Promise<Stats>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly unlink: (path: string) => Promise<void>
  readonly link: (existingPath: string, newPath: string) => Promise<void>
}

const defaultFileSystem: IRepositoryLockFileSystem = {
  lstat,
  rename,
  unlink,
  link,
}

export type RepositoryLockOwnershipProbe = (path: string) => Promise<void>

type RestartManagerProbeRunner = (path: string) => Promise<string>

const RestartManagerProbeScript = String.raw`
$ErrorActionPreference = 'Stop'
$encodedPath = [Environment]::GetEnvironmentVariable('DESKTOP_MATERIAL_LOCK_PATH_BASE64')
if ([String]::IsNullOrWhiteSpace($encodedPath)) { throw 'Missing lock path.' }
$lockPath = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encodedPath))
if ([String]::IsNullOrWhiteSpace($lockPath)) { throw 'Invalid lock path.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DesktopMaterialRestartManager
{
    private const int ErrorMoreData = 234;

    [StructLayout(LayoutKind.Sequential)]
    public struct UniqueProcess
    {
        public int ProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    public enum ApplicationType
    {
        Unknown = 0,
        MainWindow = 1,
        OtherWindow = 2,
        Service = 3,
        Explorer = 4,
        Console = 5,
        Critical = 1000
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ProcessInfo
    {
        public UniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string ApplicationName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string ServiceShortName;
        public ApplicationType Type;
        public uint Status;
        public uint TerminalSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool Restartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmStartSession(out uint session, int flags, string key);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmRegisterResources(
        uint session,
        uint fileCount,
        string[] fileNames,
        uint applicationCount,
        UniqueProcess[] applications,
        uint serviceCount,
        string[] serviceNames);

    [DllImport("rstrtmgr.dll")]
    private static extern int RmGetList(
        uint session,
        out uint needed,
        ref uint count,
        [In, Out] ProcessInfo[] processes,
        ref uint rebootReasons);

    [DllImport("rstrtmgr.dll")]
    private static extern int RmEndSession(uint session);

    public static int CountProcessesUsing(string path)
    {
        uint session;
        int result = RmStartSession(out session, 0, Guid.NewGuid().ToString("N"));
        if (result != 0) { throw new InvalidOperationException("RmStartSession failed: " + result); }

        try
        {
            result = RmRegisterResources(session, 1, new[] { path }, 0, null, 0, null);
            if (result != 0) { throw new InvalidOperationException("RmRegisterResources failed: " + result); }

            uint needed = 0;
            uint count = 0;
            uint rebootReasons = 0;
            result = RmGetList(session, out needed, ref count, null, ref rebootReasons);
            if (result == 0) { return 0; }
            if (result != ErrorMoreData || needed == 0)
            {
                throw new InvalidOperationException("RmGetList failed: " + result);
            }

            ProcessInfo[] processes = new ProcessInfo[needed];
            count = needed;
            result = RmGetList(session, out needed, ref count, processes, ref rebootReasons);
            if (result != 0) { throw new InvalidOperationException("RmGetList failed: " + result); }
            return checked((int)count);
        }
        finally
        {
            RmEndSession(session);
        }
    }
}
'@

$count = [DesktopMaterialRestartManager]::CountProcessesUsing($lockPath)
if ($count -eq 0) { 'CLEAR' } else { 'ACTIVE:' + $count }
`

async function runRestartManagerProbe(path: string): Promise<string> {
  const encodedCommand = Buffer.from(
    RestartManagerProbeScript,
    'utf16le'
  ).toString('base64')
  const encodedPath = Buffer.from(path, 'utf16le').toString('base64')
  const { stdout } = await execFile(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedCommand,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        DESKTOP_MATERIAL_LOCK_PATH_BASE64: encodedPath,
      },
    }
  )
  return stdout
}

/**
 * Fail closed unless Windows Restart Manager proves no process currently uses
 * the lock. The path is base64-encoded in a child environment variable and the
 * fixed probe is passed to PowerShell without a shell-interpreted command.
 */
export async function assertRepositoryLockHasNoActiveWindowsHandles(
  path: string,
  run: RestartManagerProbeRunner = runRestartManagerProbe
): Promise<void> {
  if (!__WIN32__) {
    throw new Error(
      'Desktop could not verify repository lock ownership on this platform. Stop all Git and IDE processes, then retry.'
    )
  }

  let result: string
  try {
    result = (await run(path)).trim()
  } catch {
    throw new Error(
      'Desktop could not verify which process owns the repository lock. Stop all Git and IDE processes, then retry.'
    )
  }

  if (result === 'CLEAR') {
    return
  }
  if (/^ACTIVE:[1-9]\d{0,5}$/.test(result)) {
    throw new Error(
      'The repository lock is still in use by an active process. Stop all Git and IDE processes, then retry.'
    )
  }
  throw new Error(
    'Desktop received an uncertain repository lock ownership result. Stop all Git and IDE processes, then retry.'
  )
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function isStaleRegularLock(lock: Stats, now: number): string | null {
  if (!lock.isFile() || lock.isSymbolicLink()) {
    return 'The repository lock is not a regular file.'
  }
  if (now - lock.mtimeMs < MinimumStaleRepositoryLockAgeMs) {
    return 'The repository lock is still recent. Wait for the active Git operation to finish, then retry.'
  }
  return null
}

function isSameFile(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.birthtimeMs === after.birthtimeMs
  )
}

async function restoreWithoutOverwrite(
  quarantinePath: string,
  lockPath: string,
  fs: IRepositoryLockFileSystem
): Promise<void> {
  try {
    // Hard-link creation is atomic and fails if a new Git process already made
    // another index.lock. Unlike rename, it can never overwrite that new lock.
    await fs.link(quarantinePath, lockPath)
  } catch (error) {
    throw new Error(
      `The lock changed while it was being checked. Its quarantined file was preserved at ${quarantinePath}. (${String(
        error
      )})`
    )
  }

  try {
    await fs.unlink(quarantinePath)
  } catch (error) {
    throw new Error(
      `The repository lock was restored, but its quarantine copy could not be removed from ${quarantinePath}. (${String(
        error
      )})`
    )
  }
}

function comparablePath(path: string): string {
  const value = normalize(resolve(path))
  return __WIN32__ ? value.toLowerCase() : value
}

/** Require Git's stderr to name this repository's exact index lock. */
export function gitErrorReferencesRepositoryIndexLock(
  error: {
    readonly result: {
      readonly stderr: string | Buffer
      readonly stdout: string | Buffer
    }
  },
  repository: Repository
): boolean {
  const output = `${coerceToString(error.result.stderr)}\n${coerceToString(
    error.result.stdout
  )}`
  const expected = comparablePath(join(repository.resolvedGitDir, 'index.lock'))
  const quotedIndexLock = /['"]([^'"\r\n]*index\.lock)['"]/gi
  for (const match of output.matchAll(quotedIndexLock)) {
    const reported = match[1]
    const candidate = comparablePath(
      isAbsolute(reported) ? reported : resolve(repository.path, reported)
    )
    if (candidate === expected) {
      return true
    }
  }
  return false
}

/**
 * Atomically quarantine and remove only this worktree's stale `index.lock`.
 * Symlinks, non-files, and recently touched locks are rejected. Renaming in the
 * same Git directory prevents a second click from deleting a newly-created lock.
 */
export async function removeStaleRepositoryLock(
  repository: Repository,
  now: number = Date.now(),
  fs: IRepositoryLockFileSystem = defaultFileSystem,
  ownershipProbe: RepositoryLockOwnershipProbe = assertRepositoryLockHasNoActiveWindowsHandles
): Promise<string | null> {
  const lockPath = join(repository.resolvedGitDir, 'index.lock')
  let lock: Stats
  try {
    lock = await fs.lstat(lockPath)
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }
  const rejection = isStaleRegularLock(lock, now)
  if (rejection !== null) {
    throw new Error(rejection)
  }
  await ownershipProbe(lockPath)

  const quarantinePath = `${lockPath}.desktop-material-${randomBytes(
    8
  ).toString('hex')}.remove`
  try {
    await fs.rename(lockPath, quarantinePath)
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }

  let quarantined: Stats
  try {
    quarantined = await fs.lstat(quarantinePath)
  } catch (error) {
    throw new Error(
      `The repository lock was quarantined but could not be rechecked at ${quarantinePath}. (${String(
        error
      )})`
    )
  }
  const quarantineRejection = isStaleRegularLock(quarantined, now)
  if (quarantineRejection !== null || !isSameFile(lock, quarantined)) {
    await restoreWithoutOverwrite(quarantinePath, lockPath, fs)
    throw new Error(
      quarantineRejection ??
        'The repository lock changed while it was being checked, so it was restored.'
    )
  }

  try {
    await ownershipProbe(quarantinePath)
  } catch (error) {
    await restoreWithoutOverwrite(quarantinePath, lockPath, fs)
    throw error
  }

  try {
    await fs.unlink(quarantinePath)
  } catch (error) {
    await restoreWithoutOverwrite(quarantinePath, lockPath, fs)
    throw error
  }
  return lockPath
}

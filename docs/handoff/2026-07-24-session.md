# Session handoff — Cheap LFS test + feature wave + audio / 交接文件

Date: 2026-07-24. gh CLI is LOCKED to **DingDingChae** — do NOT `gh auth switch` and do not let Cheap LFS / push-fallback change it.

## 1. Cheap LFS end-to-end test (primary task, IN PROGRESS)

- Test repo: `C:\Users\Administrator\Documents\GitHub\bambustudio-deps-cheaplfs-test` (a copy of BambuStudio `deps`, 9.5 GB / ~212k files). 3 nested `.git` dirs were compressed to `nested-dotgit.tar.gz`.
- Published PRIVATE on GitHub as **codingmachineedge/bambustudio-deps-cheaplfs-test** (repo + `origin` remote created by the installed app; seed push had NOT landed as of handoff).
- ~211,715 small files committed LOCALLY in **10,000-file batches** (per user). The **10 files >100 MiB stay uncommitted** on purpose — they must go through the app's **Cheap LFS auto-pin** (GitHub hard-rejects >100 MiB on a normal push). Big-file list: `scratchpad/batch-commit.log.big`.
- **CRITICAL root cause found:** committing this many files makes git `maintenance run --auto` fire a `--geometric` repack (`pack-objects` burned 1100s CPU) that hangs everything, plus stale `index.lock`. FIX (already applied to the test repo config): `gc.auto=0`, `maintenance.auto=false`, `git maintenance unregister`, per-op `-c gc.auto=0`, and remove stale `.git/index.lock` before each op. Keep this when resuming.

### Remaining test steps (for next agent)
1. Confirm all small-file batches committed (`git -C <testrepo> status` should show only the 10 big files untracked).
2. Push the batched commits **through the installed app as codingmachineedge** (CLI push is wired to `gh auth git-credential` = DingDingChae → wrong account/403). The app becomes responsive once files are committed (status is fast).
3. Commit the 10 big files **in the app** → Cheap LFS auto-pin → Release upload → push.
4. Fresh-clone the repo and verify the big files materialize.

### App driving notes (Lowlevel MCP)
- The app is the **installed CI build** `GitHubDesktop` v3.6.3-beta3-**zadtjbevjx** at `%LOCALAPPDATA%\GitHubDesktop` (production build → token service "GitHub" → userData "GitHub Desktop" → **codingmachineedge already authenticated**). Do NOT try to run the dev build (its token service is "GitHub Desktop Dev" and has no account; Electron also won't render on the off-screen desktop).
- Session 1 was `tscon`'d to console so foreground input works; drive via `mcp__lowlevel-computer-use__*` (window title "… - Desktop Material"). Background/PostMessage clicks do NOT work in Chromium — use foreground `mouse_click` with screen coords.

## 2. App bug findings from the test (report/fix)
- Severe sluggishness on a 211k-file repo: `getStatus` 9–11s repeated; `git lfs track --json` 35s; publish push hangs.
- Recurring "A background action stopped unexpectedly" toast = repeated `ENOENT: Could not list worktrees` from the app polling a **deleted** repo (`…\bambu-build-fresh-clone`). Should stop polling missing repos.
- Transient "No local changes" shown while the huge status is still computing (~9s).
- Commit progress is generic ("committing files") and looks stuck on large commits.
- Ollama manager exists but is buried under Preferences → Copilot (not a standalone item). Cheap LFS settings ARE in Repository Settings → "Build & run" tab (label, not "Cheap LFS", is why it seemed missing).

## 3. Feature wave (desktop-material) — branches to integrate into `main`
Pushed branches: **feat/settings-search**, **feat/audio-system**. In worktrees (may still be building / push if committed): **feat/tab-overflow-dropdown**, **feat/local-actions-runner**. #14/#13 = **feat/batching-filecount-progress** (agent's changes were UNCOMMITTED in the main checkout, waiting on its real-Git suite `bwrbsf1dm`).

**Main-checkout contamination:** `C:\Users\Administrator\Documents\GitHub\desktop-material` working tree has MIXED uncommitted changes — the #14 batching files PLUS stray settings-search/tab-overflow files (`?? app/src/lib/settings-search/`, `M preferences.tsx`, `M repository-tab-strip.tsx`, etc.). Integration: let the #14 agent commit ONLY its own files to its branch first, then discard main's stray duplicates (they live on the feature branches) and merge the feature branches into `main` one at a time, resolving conflicts (hotspots: `i18n-resources.ts`, `app-store.ts`), run full `node script/test.mjs`, then push.

Worktrees: `git -C <main> worktree list` shows wf_17e033cc-cb9-4..7. Clean them up after integrating.

## 4. Audio assets (on THIS branch under `app/static/audio/`)
244 files + `manifest.json`: for **82 events** (13 generic + 8 build/run + **60 git errors**), each has English (`en-US-AriaNeural`) + HK Cantonese (`zh-HK-HiuMaanNeural`) narration MP3 + a unique synthesized **melody** WAV. Generators: `scratchpad/gen_tts.py`, `scratchpad/gen_audio.py` (edge-tts installed via `py -m pip install --user edge-tts`).

Audio feature requirements (task #9, wire in mega wave):
- Played-language selector: **English / Cantonese / Both** (both = EN then Cantonese).
- **No overlap** — serialized narration queue, one voice at a time, skip/replace stale.
- Infrequent (debounce + cooldown), funny-level-aware tone, **error lines stay plain**.

## 5. Global instructions (agent-global-memory repo)
`C:\Users\Administrator\Documents\GitHub\agent-global-memory`. Funny-level slider (1–5, independent EN/Cantonese, tone-only) is ALREADY present. Funny-slider agent had uncommitted edits in progress. **Narrator spec NOT yet added** (task #6) — add: optional TTS narrator, user-selectable EN/Cantonese/both, natural voices, infrequent/non-overlapping, funny-level-aware, errors clear, off by default.

## 6. Task backlog (#6–#16)
#6 global-instructions funny slider (done) + narrator spec (pending) · #7 tab-overflow→dropdown · #8 settings search · #9 TTS narrator (assets done; wire) · #10 sound effects · #11 repo-themed music · #12 local Actions runner · #13 detailed commit progress · #14 batching 10k/1.5GB/auto-push + gc-disable · #15 auto-fix errors · #16 native large-repo handling (gc/maintenance-off, nested-.git auto-compress, force-include, lock retry, async status). User wants a "mega wave" to finish ALL and push, then updated global instructions shown.

## 7. Running agents at handoff
Workflow `w2tfmsqgq` (5 feature agents) and the #14/#13 agent may still be finishing — let them complete; their branches are the source of truth over the contaminated main working tree.

## 8. Confirmed final state at handoff
- Batch commits DONE: test repo has **23 commits**, exactly **10 files untracked** (the >100 MiB Cheap LFS targets). Small files fully committed locally; still need the app push (as codingmachineedge) + big-file auto-pin + fresh-clone.
- Audio + this handoff pushed on branch **feat/audio-narration-assets** (base 108549f7e). Bundle audio into the audio feature during integration.
- gh active account verified = DingDingChae. Test repo git config has gc.auto=0 + maintenance.auto=false (keep).

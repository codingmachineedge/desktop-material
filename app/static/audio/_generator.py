# Comprehensive Desktop Material audio: per-event narration (EN + HK Cantonese, neural edge-tts)
# + a unique synthesized melody per event (pure-Python WAV). Errors keep a plain, clear tone.
import asyncio, json, os, math, wave, struct, hashlib
import edge_tts

BASE = r"C:\Users\ADMINI~1\AppData\Local\Temp\claude\C--Users-Administrator-Documents-GitHub-desktop-material--claude-worktrees-bug-check-d1e431\1e610246-6c80-46cd-b3b6-13670e2510be\scratchpad\audio"
EN_VOICE = "en-US-AriaNeural"
YUE_VOICE = "zh-HK-HiuMaanNeural"

# category: 'info' | 'success' | 'progress' | 'error'
# (id, category, English, HK Cantonese)
GENERIC = [
    ("welcome",           "info",     "Welcome back to Desktop Material.", "歡迎返嚟 Desktop Material。"),
    ("commit-created",    "success",  "Commit created.",                    "Commit 搞掂喇。"),
    ("changes-committed", "success",  "Your changes are committed.",        "你嘅改動已經 commit 好晒。"),
    ("push-complete",     "success",  "Pushed to origin. Nice work.",       "已經 push 上 origin，做得好。"),
    ("fetch-start",       "progress", "Fetching the latest changes.",       "而家幫你攞緊最新嘅改動。"),
    ("up-to-date",        "info",     "You're all caught up.",              "全部都係最新，唔使更新。"),
    ("pull-complete",     "success",  "Pull complete.",                     "Pull 完成喇。"),
    ("branch-switched",   "info",     "Branch switched.",                   "已經幫你轉咗 branch。"),
    ("cheaplfs-restored", "success",  "Large files restored.",              "大檔已經還原好晒。"),
    ("publish-start",     "progress", "Publishing your repository.",        "而家幫你 publish 個 repo。"),
    ("publish-done",      "success",  "Repository published.",              "個 repo publish 咗喇。"),
    ("batch-pushed",      "success",  "Batch pushed. Moving on.",           "呢批 push 咗，繼續落去。"),
    ("all-done",          "success",  "All done.",                          "全部搞掂。"),
]

BUILD_RUN = [
    ("br-detecting",  "progress", "Detecting how to build.",       "偵測緊點樣 build。"),
    ("br-gitignore",  "progress", "Updating gitignore.",           "更新緊 gitignore。"),
    ("br-installing", "progress", "Installing dependencies.",      "安裝緊啲相依套件。"),
    ("br-building",   "progress", "Building your project.",        "Build 緊你個 project。"),
    ("br-running",    "progress", "Running your project.",         "Run 緊你個 project。"),
    ("br-succeeded",  "success",  "Build and run succeeded.",      "Build 同 run 都成功。"),
    ("br-failed",     "error",    "Build or run failed.",          "Build 或者 run 失敗咗。"),
    ("br-cancelled",  "info",     "Build and run cancelled.",      "Build 同 run 取消咗。"),
]

# 60 dugite GitError types -> clear EN + Cantonese. All category 'error' (plain tone).
GIT_ERRORS = [
    ("err-bad-config-value",          "There's a bad value in your Git config.",            "你 Git config 有個值唔啱。"),
    ("err-ssh-key-audit",             "Your SSH key needs verifying.",                       "你個 SSH key 要驗證先得。"),
    ("err-ssh-auth-failed",           "SSH authentication failed.",                          "SSH 驗證失敗。"),
    ("err-ssh-permission-denied",     "SSH permission denied.",                              "SSH 冇權限。"),
    ("err-https-auth-failed",         "Sign-in failed. Check your credentials.",             "登入失敗，檢查你嘅帳號密碼。"),
    ("err-remote-disconnect",         "The remote disconnected.",                            "遠端斷咗線。"),
    ("err-host-down",                 "The server looks down.",                              "個伺服器好似 down 咗。"),
    ("err-rebase-conflicts",          "Rebase conflicts. Resolve them to continue.",         "Rebase 有衝突，解決咗先繼續。"),
    ("err-merge-conflicts",           "Merge conflicts. Resolve them to continue.",          "合併有衝突，解決咗先繼續。"),
    ("err-https-repo-not-found",      "Repository not found.",                               "揾唔到個 repository。"),
    ("err-ssh-repo-not-found",        "Repository not found over SSH.",                      "SSH 揾唔到個 repository。"),
    ("err-push-not-fast-forward",     "Push rejected. Pull the latest changes first.",       "Push 俾人拒絕，先 pull 最新改動。"),
    ("err-branch-deletion-failed",    "Couldn't delete that branch.",                        "刪唔到個 branch。"),
    ("err-default-branch-deletion",   "You can't delete the default branch.",                "預設 branch 刪唔到。"),
    ("err-revert-conflicts",          "Revert conflicts to resolve.",                        "還原有衝突要解決。"),
    ("err-empty-rebase-patch",        "The rebase patch is empty.",                          "Rebase 個 patch 係空嘅。"),
    ("err-no-matching-remote-branch", "No matching remote branch.",                          "冇對應嘅遠端 branch。"),
    ("err-no-existing-remote-branch", "That remote branch doesn't exist.",                   "個遠端 branch 唔存在。"),
    ("err-nothing-to-commit",         "There's nothing to commit.",                          "冇嘢好 commit。"),
    ("err-no-submodule-mapping",      "Missing submodule mapping.",                          "冇 submodule 對應。"),
    ("err-submodule-missing",         "The submodule repository is missing.",                "Submodule 個 repository 唔見咗。"),
    ("err-invalid-submodule-sha",     "The submodule SHA is invalid.",                       "Submodule 個 SHA 唔啱。"),
    ("err-local-permission-denied",   "Permission denied on a local file.",                  "本機檔案冇權限。"),
    ("err-invalid-merge",             "That merge isn't valid.",                             "呢個合併唔啱。"),
    ("err-invalid-rebase",            "That rebase isn't valid.",                            "呢個 rebase 唔啱。"),
    ("err-non-ff-merge-empty",        "Can't merge into an empty branch.",                   "空嘅 branch 唔可以咁合併。"),
    ("err-patch-does-not-apply",      "The patch doesn't apply cleanly.",                    "個 patch 貼唔到落去。"),
    ("err-branch-already-exists",     "That branch already exists.",                         "個 branch 已經存在。"),
    ("err-bad-revision",              "That revision doesn't exist.",                        "個 revision 揾唔到。"),
    ("err-not-a-git-repo",            "This folder isn't a Git repository.",                 "呢個資料夾唔係 Git repository。"),
    ("err-unrelated-histories",       "These histories are unrelated.",                      "兩段歷史冇關係，唔可以直接合併。"),
    ("err-lfs-attribute-mismatch",    "An LFS attribute doesn't match.",                     "有個 LFS 屬性對唔上。"),
    ("err-branch-rename-failed",      "Couldn't rename the branch.",                         "改唔到 branch 個名。"),
    ("err-path-does-not-exist",       "That path doesn't exist.",                            "個路徑唔存在。"),
    ("err-invalid-object-name",       "That object name is invalid.",                        "個 object 名唔啱。"),
    ("err-outside-repository",         "That path is outside the repository.",               "個路徑喺 repository 外面。"),
    ("err-lock-file-exists",          "A lock file already exists.",                         "已經有個 lock 檔。"),
    ("err-no-merge-to-abort",         "There's no merge to abort.",                          "冇合併可以取消。"),
    ("err-local-changes-overwritten", "Your local changes would be overwritten.",            "你本機嘅改動會俾覆蓋。"),
    ("err-unresolved-conflicts",      "There are unresolved conflicts.",                     "仲有衝突未解決。"),
    ("err-gpg-sign-failed",           "GPG couldn't sign the commit.",                       "GPG 簽唔到個 commit。"),
    ("err-conflict-modify-deleted",   "A file was modified and deleted in different branches.", "有檔案喺唔同 branch 一邊改一邊刪。"),
    ("err-push-file-size-limit",      "A file is too big to push.",                          "有檔案太大，push 唔到。"),
    ("err-hex-branch-rejected",       "That branch name was rejected.",                      "呢個 branch 名俾人拒絕。"),
    ("err-force-push-rejected",       "Force push was rejected.",                            "強制 push 俾人拒絕。"),
    ("err-invalid-ref-length",        "That reference name is too long.",                    "個 reference 名太長。"),
    ("err-protected-needs-review",    "This branch requires a review.",                      "呢個 branch 要人 review 先得。"),
    ("err-protected-force-push",      "You can't force push a protected branch.",            "受保護嘅 branch 唔可以強制 push。"),
    ("err-protected-delete",          "You can't delete a protected branch.",                "受保護嘅 branch 唔可以刪。"),
    ("err-protected-required-status", "Required checks haven't passed.",                     "必要嘅檢查未過。"),
    ("err-push-private-email",        "Your email is private. Adjust your Git settings.",    "你個 email 係私隱，改一下 Git 設定。"),
    ("err-config-lock-exists",        "The Git config is locked.",                           "Git config 俾鎖住咗。"),
    ("err-remote-already-exists",     "That remote already exists.",                         "個 remote 已經存在。"),
    ("err-tag-already-exists",        "That tag already exists.",                            "個 tag 已經存在。"),
    ("err-merge-with-local-changes",  "Commit or stash your changes before merging.",        "合併前先 commit 或者 stash 你嘅改動。"),
    ("err-rebase-with-local-changes", "Commit or stash your changes before rebasing.",       "Rebase 前先 commit 或者 stash 你嘅改動。"),
    ("err-merge-commit-no-mainline",  "This merge commit needs a mainline.",                 "呢個合併 commit 要指定 mainline。"),
    ("err-unsafe-directory",          "Git flagged this folder as unsafe.",                  "Git 話呢個資料夾唔安全。"),
    ("err-path-not-in-ref",           "That path isn't in this revision.",                   "呢個 revision 冇呢個路徑。"),
    ("err-push-secret-detected",      "A secret was detected in your push.",                 "Push 入面揾到機密資料。"),
]

EVENTS = (
    [(i, c, e, y) for (i, c, e, y) in GENERIC] +
    [(i, c, e, y) for (i, c, e, y) in BUILD_RUN] +
    [(i, "error", e, y) for (i, e, y) in GIT_ERRORS]
)

# ---------- melody synthesis (pure python) ----------
SR = 44100
PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]  # major pentatonic degrees (semitones)

def midi_to_freq(m):
    return 440.0 * (2 ** ((m - 69) / 12.0))

def synth_note(freq, dur):
    n = int(dur * SR)
    out = []
    for i in range(n):
        t = i / SR
        env = math.exp(-4.5 * t / dur)                 # bell-ish decay
        atk = min(1.0, t / 0.006)                       # short attack, no click
        s = env * atk * (0.60 * math.sin(2*math.pi*freq*t)
                         + 0.28 * math.sin(2*math.pi*2*freq*t)
                         + 0.12 * math.sin(2*math.pi*3*freq*t))
        out.append(s)
    return out

def melody_for(event_id, category):
    h = hashlib.sha256(event_id.encode("utf-8")).digest()
    n_notes = 3 + (h[0] % 2)                            # 3 or 4 notes
    idxs = [h[i + 1] % len(PENTA) for i in range(n_notes)]
    if category == "error":
        idxs = sorted(idxs, reverse=True)              # descending
        base = 55                                      # lower register
    elif category == "success":
        idxs = sorted(idxs)                            # ascending
        base = 64
    elif category == "progress":
        idxs = [idxs[0], (idxs[0] + 2) % len(PENTA)]   # gentle two-note
        base = 62
    else:  # info
        base = 62
    dur = 0.16
    samples = []
    for k, ix in enumerate(idxs):
        freq = midi_to_freq(base + PENTA[ix])
        samples.extend(synth_note(freq, dur))
        samples.extend([0.0] * int(0.02 * SR))         # tiny gap
    peak = max(1e-6, max(abs(s) for s in samples))
    scale = 0.85 / peak
    return b"".join(struct.pack("<h", int(max(-1, min(1, s * scale)) * 32767)) for s in samples)

def write_wav(path, pcm):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm)

# ---------- generation ----------
async def synth_tts(text, voice, path):
    await edge_tts.Communicate(text, voice).save(path)

async def main():
    os.makedirs(BASE, exist_ok=True)
    manifest = []
    for cid, cat, en, yue in EVENTS:
        await synth_tts(en, EN_VOICE, os.path.join(BASE, cid + ".en.mp3"))
        await synth_tts(yue, YUE_VOICE, os.path.join(BASE, cid + ".yue.mp3"))
        write_wav(os.path.join(BASE, cid + ".melody.wav"), melody_for(cid, cat))
        manifest.append({
            "id": cid, "category": cat,
            "en": {"text": en, "voice": EN_VOICE, "file": cid + ".en.mp3"},
            "yue": {"text": yue, "voice": YUE_VOICE, "file": cid + ".yue.mp3"},
            "melody": cid + ".melody.wav",
        })
        print("done", cid)
    with open(os.path.join(BASE, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"voices": {"en": EN_VOICE, "yue": YUE_VOICE},
                   "categories": ["info", "success", "progress", "error"],
                   "events": manifest}, f, ensure_ascii=False, indent=2)
    print("ALL DONE events:", len(manifest))

asyncio.run(main())

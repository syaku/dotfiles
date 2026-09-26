# dotfiles: chezmoi 操作手順の経緯

実行時には読み込まれない。規範本文は `~/.claude/rules/dotfiles-chezmoi.md`。

## `paths` 付きのまま据え置く理由

> 2026-09-06 の判断。この rule の中心（target を直接編集しない）は `~/.claude/hooks/chezmoi-source-guard.sh` が exit 2 で止めるので、rule が読み込まれなくても守られる。rule が足すのは止められた後の手順で、それは hook の stderr にも出る。paths 付きの rule は長いセッションで読み込まれないことがある（`/knowledge-placement` の「paths 付き rules の書き方」）が、毎回読み込む側へ移す理由には足りないと判断した。

#!/usr/bin/env bash

# AeroSpace の workspace 切替イベントで呼ばれる。
# 引数 $1: この item が担当する workspace ID
# 環境変数 $FOCUSED_WORKSPACE: aerospace.toml の exec-on-workspace-change で渡される
# 環境変数 $NAME: sketchybar が自動で渡す item 名 (space.<sid>)

if [ -z "$FOCUSED_WORKSPACE" ]; then
    FOCUSED_WORKSPACE=$(aerospace list-workspaces --focused)
fi

if [ "$1" = "$FOCUSED_WORKSPACE" ]; then
    sketchybar --set "$NAME" \
        background.drawing=on \
        background.color=0xff89b4fa \
        label.color=0xff1e1e2e
else
    sketchybar --set "$NAME" \
        background.drawing=off \
        label.color=0xffcdd6f4
fi
